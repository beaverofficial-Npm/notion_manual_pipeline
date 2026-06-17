import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

// 진행 중인 변환을 중단한다: 대기/실행 중 job 을 취소 처리하고 task 를 failed 로 되돌려 삭제·재분석이 가능하게 한다.
export async function POST(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  const { error: jobError } = await supabase
    .from('manual_conversion_jobs')
    .update({ status: 'cancelled', error_message: '사용자가 변환을 중단했습니다.', finished_at: new Date().toISOString() })
    .eq('task_id', taskId)
    .in('status', ['queued', 'running']);
  if (jobError) {
    return NextResponse.json({ message: jobError.message }, { status: 500 });
  }

  const { error: taskError } = await supabase
    .from('manual_tasks')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', taskId);
  if (taskError) {
    return NextResponse.json({ message: taskError.message }, { status: 500 });
  }

  return NextResponse.json({ id: taskId, status: 'failed' });
}
