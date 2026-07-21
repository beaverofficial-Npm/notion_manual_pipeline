import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { extractNotionPageId } from '@/lib/notion/publish';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

// 기본은 상주 worker(poll-loop)가 발행 큐를 처리한다. 폴러 없이 즉시 spawn 하려면 INLINE_WORKER=1.
function startInlinePublishWorker(runId: string) {
  if (process.env.INLINE_WORKER !== '1') return;
  const child = spawn(process.execPath, ['scripts/worker/run-publish-job.mjs', runId], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

// 발행을 큐에 넣고 즉시 리턴한다(스트리밍 실행 아님). 워커가 연결과 무관하게 끝까지 처리하고
// 진행을 publish_run.progress 에 기록 → 프론트는 /publish/status 를 폴링한다.
export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const notionLink = typeof body.notionTarget === 'string' ? body.notionTarget.trim() : '';
  const excludedFnIds = Array.isArray(body.excludedFnIds) ? body.excludedFnIds.filter((v) => typeof v === 'string') : [];

  // ── validation 1: 대상 task 가 아직 존재하고 발행 가능한 상태인가 ──
  const { data: task, error: taskError } = await supabase
    .from('manual_tasks')
    .select('id,status,target_notion_page_id,target_notion_data_source_id')
    .eq('id', taskId)
    .maybeSingle();
  if (taskError) return NextResponse.json({ message: taskError.message }, { status: 500 });
  if (!task) {
    return NextResponse.json({ message: '이 작업을 찾을 수 없습니다. 삭제되었거나 오래된 화면일 수 있어요. 새로고침 해주세요.' }, { status: 404 });
  }

  // 링크 미입력이면 이 작업에 저장된 대상 페이지로 재발행(다시 내보내기 시 링크 재입력 불필요).
  const pageId = extractNotionPageId(notionLink) || extractNotionPageId(task.target_notion_page_id ?? task.target_notion_data_source_id);
  if (!pageId) {
    return NextResponse.json({ message: 'Notion 페이지 URL 또는 ID가 올바르지 않습니다. 링크를 다시 확인해 주세요.' }, { status: 400 });
  }
  if (task.status === 'running') {
    return NextResponse.json({ message: '아직 변환 중입니다. 변환이 끝난 뒤 발행할 수 있어요.' }, { status: 409 });
  }
  if (task.status === 'publishing') {
    return NextResponse.json({ message: '이미 발행이 진행 중입니다. 잠시만 기다려 주세요.' }, { status: 409 });
  }

  // ── validation 2: 이미 대기/진행 중인 발행이 있으면 중복 시작 금지 ──
  const { data: active } = await supabase
    .from('manual_publish_runs')
    .select('id')
    .eq('task_id', taskId)
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle();
  if (active) {
    return NextResponse.json({ message: '이미 발행이 진행 중입니다. 잠시만 기다려 주세요.' }, { status: 409 });
  }

  // 발행 입력을 이 시점의 최신 성공 변환 job에 고정한다.
  // 이후 task에 다른 run이 생겨도 워커는 이 job의 slides/assets/blocks만 읽는다.
  const { data: conversionJob, error: conversionJobError } = await supabase
    .from('manual_conversion_jobs')
    .select('id,run_number')
    .eq('task_id', taskId)
    .eq('status', 'succeeded')
    .order('run_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conversionJobError) {
    return NextResponse.json({ message: `발행할 변환 결과를 확인하지 못했습니다: ${conversionJobError.message}` }, { status: 500 });
  }
  if (!conversionJob) {
    return NextResponse.json({ message: '성공한 변환 결과가 없어 발행할 수 없습니다. 먼저 변환을 완료해 주세요.' }, { status: 409 });
  }

  // ── validation 3: 노션 페이지에 integration 이 연결돼 접근 가능한가(발행 전에 미리 확인) ──
  // 이게 없으면 발행을 다 돌리고 나서야 "페이지 못 찾음" 에러가 떠서 사용자가 오래 헤맨다.
  const notionToken = process.env.NOTION_TOKEN;
  if (notionToken) {
    try {
      const check = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        headers: { Authorization: `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28' },
      });
      if (!check.ok) {
        const info = (await check.json().catch(() => ({}))) as { message?: string };
        const msg =
          check.status === 404
            ? '이 페이지에는 발행할 수 없어요. 이 도구는 비버 서비스디자인팀 노션 워크스페이스의 페이지에만 발행할 수 있습니다. 해당 워크스페이스 안의 페이지 링크가 맞는지 확인해 주세요.'
            : info.message ?? '노션 페이지를 확인하지 못했습니다.';
        return NextResponse.json({ message: msg }, { status: 400 });
      }
    } catch {
      // 노션 확인 자체가 네트워크 오류면 통과시키고 발행 단계에서 처리(발행 워커가 최종 검증).
    }
  }

  // 대상 페이지 저장
  const { error: updateError } = await supabase.from('manual_tasks').update({ target_notion_page_id: pageId, updated_at: new Date().toISOString() }).eq('id', taskId);
  if (updateError) return NextResponse.json({ message: updateError.message }, { status: 500 });

  // 큐에 넣기(queued)
  const { data: run, error: runError } = await supabase
    .from('manual_publish_runs')
    .insert({
      task_id: taskId,
      status: 'queued',
      target_page_id: pageId,
      payload: { notionTarget: notionLink, excludedFnIds, conversionJobId: conversionJob.id },
      progress: { done: 0, total: 0, label: '대기 중' },
    })
    .select('id')
    .single();
  if (runError || !run) return NextResponse.json({ message: runError?.message ?? '발행을 시작하지 못했습니다.' }, { status: 500 });

  await supabase.from('manual_tasks').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', taskId);
  startInlinePublishWorker(run.id as string);

  return NextResponse.json({ runId: run.id }, { status: 201 });
}
