import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    categoryId: string;
  }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { categoryId } = await context.params;
  const supabase = createServiceSupabaseClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.title === 'string' && body.title.trim()) {
    updates.title = body.title.trim();
  }

  const { data, error } = await supabase
    .from('manual_categories')
    .update(updates)
    .eq('id', categoryId)
    .select('id,title,sort_order')
    .single();

  if (error || !data) {
    return NextResponse.json({ message: error?.message ?? '카테고리를 수정하지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ category: data });
}
