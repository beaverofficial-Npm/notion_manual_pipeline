import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

// 발행 진행 상태 폴링 — 프론트가 3초마다 호출해 진행바/완료/실패를 그린다.
// 발행은 워커가 백그라운드로 돌리므로(연결 무관), 상태의 진실은 항상 이 DB 값이다.
export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  const [{ data: task }, { data: run }] = await Promise.all([
    supabase.from('manual_tasks').select('status').eq('id', taskId).maybeSingle(),
    supabase
      .from('manual_publish_runs')
      .select('status,progress,error_message,created_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // task 자체가 사라짐(삭제/오래된 화면) → 프론트가 이걸 보고 안내 + 목록 갱신
  if (!task) {
    return NextResponse.json({ taskExists: false, taskStatus: null, publishStatus: null });
  }

  const progress = (run?.progress ?? {}) as { done?: number; total?: number; label?: string; pageId?: string; url?: string | null };
  return NextResponse.json({
    taskExists: true,
    taskStatus: task.status, // publishing | published | review_required | failed ...
    publishStatus: run?.status ?? null, // queued | running | succeeded | failed | cancelled | null
    progress: { done: progress.done ?? 0, total: progress.total ?? 0, label: progress.label ?? '' },
    error: run?.error_message ?? null,
    pageId: progress.pageId ?? null,
    url: progress.url ?? null,
  });
}
