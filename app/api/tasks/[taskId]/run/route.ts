import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { getManualProject } from '@/lib/pipeline/tasks';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

function startInlineConversionWorker(jobId: string) {
  // 기본은 상주 worker(poll-loop)가 큐를 처리한다. 폴러 없이 즉시 spawn 으로 돌리려면 INLINE_WORKER=1.
  if (process.env.INLINE_WORKER !== '1') return;

  const child = spawn(process.execPath, ['scripts/worker/run-conversion-job.mjs', jobId], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });

  child.unref();
}

export async function POST(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  const { data: task, error: taskError } = await supabase
    .from('manual_tasks')
    .select('id,current_run_number,status')
    .eq('id', taskId)
    .single();

  if (taskError || !task) {
    return NextResponse.json({ message: taskError?.message ?? '작업을 찾지 못했습니다.' }, { status: 404 });
  }

  if (task.status === 'running' || task.status === 'publishing') {
    return NextResponse.json({ message: '이미 실행 중인 작업입니다.' }, { status: 409 });
  }

  // 큐 폭주 방어: 이 작업에 이미 대기/실행 중인 변환 job 이 있으면 새로 만들지 않는다.
  // (fetch 실패로 재클릭이 반복되면 같은 작업에 job 이 수십 개 쌓여 컨테이너를 마비시켰음)
  const { data: activeJob } = await supabase
    .from('manual_conversion_jobs')
    .select('id')
    .eq('task_id', taskId)
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle();
  if (activeJob) {
    return NextResponse.json({ message: '이미 변환이 진행/대기 중입니다.' }, { status: 409 });
  }

  const { data: sourceFile, error: sourceError } = await supabase
    .from('manual_source_files')
    .select('id')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (sourceError || !sourceFile) {
    return NextResponse.json({ message: sourceError?.message ?? '원본 PPT 파일이 없습니다.' }, { status: 400 });
  }

  const nextRunNumber = (task.current_run_number ?? 0) + 1;

  const { data: job, error: jobError } = await supabase
    .from('manual_conversion_jobs')
    .insert({
      task_id: taskId,
      source_file_id: sourceFile.id,
      run_number: nextRunNumber,
      status: 'queued',
    })
    .select('id,run_number,status')
    .single();

  if (jobError || !job) {
    return NextResponse.json({ message: jobError?.message ?? 'PPT 분석을 시작하지 못했습니다.' }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('manual_tasks')
    .update({
      status: 'running',
      current_run_number: nextRunNumber,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (updateError) {
    return NextResponse.json({ message: updateError.message }, { status: 500 });
  }

  startInlineConversionWorker(job.id);

  const project = await getManualProject(taskId);

  return NextResponse.json({ job, project }, { status: 201 });
}
