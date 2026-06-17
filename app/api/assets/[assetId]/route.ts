import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    assetId: string;
  }>;
}

function normalizeCropBox(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Record<string, unknown>;
  const left = Number(source.left);
  const top = Number(source.top);
  const width = Number(source.width);
  const height = Number(source.height);

  if ([left, top, width, height].some((item) => Number.isNaN(item))) {
    return null;
  }

  return {
    left: Math.max(0, Math.min(100, left)),
    top: Math.max(0, Math.min(100, top)),
    width: Math.max(1, Math.min(100, width)),
    height: Math.max(1, Math.min(100, height)),
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const { assetId } = await context.params;
  const supabase = createServiceSupabaseClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.label === 'string') {
    updates.label = body.label.trim() || '추출 영역';
  }

  if (typeof body.kind === 'string') {
    updates.kind = body.kind;
  }

  if (typeof body.review_status === 'string') {
    updates.review_status = body.review_status;
  }

  const cropBox = normalizeCropBox(body.crop_box);
  if (cropBox) {
    updates.crop_box = cropBox;
  }

  const { data, error } = await supabase
    .from('manual_assets')
    .update(updates)
    .eq('id', assetId)
    .select('id,slide_id,kind,label,crop_box,review_status,confidence')
    .single();

  if (error || !data) {
    return NextResponse.json({ message: error?.message ?? '영역을 수정하지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ asset: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { assetId } = await context.params;
  const supabase = createServiceSupabaseClient();

  const { error } = await supabase.from('manual_assets').delete().eq('id', assetId);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: assetId });
}
