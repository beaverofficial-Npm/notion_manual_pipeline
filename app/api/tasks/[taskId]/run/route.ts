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
  // 컨테이너(Railway 등)에 LibreOffice/Poppler가 있으면 같은 인스턴스에서 변환을 처리한다.
  // 바이너리가 없는 환경(예: Vercel)이나 별도 worker 서비스를 쓸 때는 INLINE_WORKER=0 으로 끈다.
  if (process.env.INLINE_WORKER === '0') return;

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
