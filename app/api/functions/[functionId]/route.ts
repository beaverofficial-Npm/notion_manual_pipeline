import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    functionId: string;
  }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { functionId } = await context.params;
  const supabase = createServiceSupabaseClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.title === 'string' && body.title.trim()) {
    updates.title = body.title.trim();
  }
  if (typeof body.review_status === 'string') {
    updates.review_status = body.review_status;
  }

  const { data, error } = await supabase
    .from('manual_functions')
    .update(updates)
    .eq('id', functionId)
    .select('id,category_id,title,sort_order,review_status')
    .single();

  if (error || !data) {
    return NextResponse.json({ message: error?.message ?? '기능을 수정하지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ function: data });
}
