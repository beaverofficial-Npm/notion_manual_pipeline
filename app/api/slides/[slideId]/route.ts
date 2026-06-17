import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    slideId: string;
  }>;
}

async function refreshTaskStatus(taskId: string) {
  const supabase = createServiceSupabaseClient();
  const { data: slides } = await supabase.from('manual_slides').select('review_status').eq('task_id', taskId);
  const activeSlides = (slides ?? []).filter((slide) => slide.review_status !== 'excluded');
  const allApproved = activeSlides.length > 0 && activeSlides.every((slide) => slide.review_status === 'approved');

  await supabase
    .from('manual_tasks')
    .update({
      status: allApproved ? 'ready_to_publish' : 'review_required',
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { slideId } = await context.params;
  const supabase = createServiceSupabaseClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.title === 'string') {
    updates.title = body.title.trim() || null;
  }

  if (typeof body.review_status === 'string') {
    updates.review_status = body.review_status;
  }

  const { data, error } = await supabase
    .from('manual_slides')
    .update(updates)
    .eq('id', slideId)
    .select('id,task_id,slide_number,title,render_path,review_status,warnings')
    .single();

  if (error || !data) {
    return NextResponse.json({ message: error?.message ?? '슬라이드를 저장하지 못했습니다.' }, { status: 500 });
  }

  await refreshTaskStatus(data.task_id);

  return NextResponse.json({ slide: data });
}
