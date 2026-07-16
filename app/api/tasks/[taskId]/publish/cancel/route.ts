import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

// 발행 취소(명시적 의도만 중단) — 대기(queued)면 즉시 취소, 진행(running)이면 취소 표시를 남기고
// 워커가 다음 진행 기록 시점에 감지해 중단한다. 새로고침/창닫기는 발행에 영향을 주지 않는다.
export async function POST(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  const { data: run } = await supabase
    .from('manual_publish_runs')
    .select('id,status')
    .eq('task_id', taskId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!run) {
    return NextResponse.json({ message: '진행 중인 발행이 없습니다.' }, { status: 404 });
  }

  const { error } = await supabase
    .from('manual_publish_runs')
    .update({ status: 'cancelled', error_message: '사용자가 발행을 취소했습니다.', finished_at: run.status === 'queued' ? new Date().toISOString() : null })
    .eq('id', run.id)
    .in('status', ['queued', 'running']);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  // 대기 중이었다면 워커가 집기 전이므로 task 상태도 바로 되돌린다(진행 중이면 워커가 감지 후 되돌림).
  if (run.status === 'queued') {
    await supabase.from('manual_tasks').update({ status: 'review_required', updated_at: new Date().toISOString() }).eq('id', taskId).eq('status', 'publishing');
  }

  return NextResponse.json({ cancelled: true, runId: run.id });
}
