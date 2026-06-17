import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    slideId: string;
  }>;
}

function normalizeCropBox(value: unknown) {
  if (!value || typeof value !== 'object') {
    return { left: 12, top: 18, width: 76, height: 56 };
  }

  const source = value as Record<string, unknown>;
  const left = Number(source.left);
  const top = Number(source.top);
  const width = Number(source.width);
  const height = Number(source.height);

  if ([left, top, width, height].some((item) => Number.isNaN(item))) {
    return { left: 12, top: 18, width: 76, height: 56 };
  }

  return {
    left: Math.max(0, Math.min(100, left)),
    top: Math.max(0, Math.min(100, top)),
    width: Math.max(1, Math.min(100, width)),
    height: Math.max(1, Math.min(100, height)),
  };
}

export async function POST(request: Request, context: RouteContext) {
  const { slideId } = await context.params;
  const supabase = createServiceSupabaseClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: slide, error: slideError } = await supabase.from('manual_slides').select('job_id').eq('id', slideId).single();

  if (slideError || !slide) {
    return NextResponse.json({ message: slideError?.message ?? '슬라이드를 찾지 못했습니다.' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('manual_assets')
    .insert({
      slide_id: slideId,
      job_id: slide.job_id,
      kind: typeof body.kind === 'string' ? body.kind : 'screenshot',
      label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : '수동 추가 영역',
      crop_box: normalizeCropBox(body.crop_box),
      source_element_ids: [],
      included_annotation_ids: [],
      review_status: 'pending',
      review_reason: 'manual',
      confidence: 1,
    })
    .select('id,slide_id,kind,label,crop_box,review_status,confidence')
    .single();

  if (error || !data) {
    return NextResponse.json({ message: error?.message ?? '영역을 추가하지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ asset: data }, { status: 201 });
}
