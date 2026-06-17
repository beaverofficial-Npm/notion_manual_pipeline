import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  const { data: slides, error: slideError } = await supabase
    .from('manual_slides')
    .select('id,slide_number,title,render_path,review_status,warnings')
    .eq('task_id', taskId)
    .order('slide_number');

  if (slideError) {
    return NextResponse.json({ message: slideError.message }, { status: 500 });
  }

  const slideRows = slides ?? [];
  const slideIds = slideRows.map((slide) => slide.id);

  let assets: Array<{
    id: string;
    slide_id: string;
    kind: string;
    label: string;
    crop_box: unknown;
    review_status: string;
    confidence: number | null;
  }> = [];

  if (slideIds.length > 0) {
    const { data: assetRows, error: assetError } = await supabase
      .from('manual_assets')
      .select('id,slide_id,kind,label,crop_box,review_status,confidence')
      .in('slide_id', slideIds)
      .order('created_at');

    if (assetError) {
      return NextResponse.json({ message: assetError.message }, { status: 500 });
    }

    assets = assetRows ?? [];
  }

  const assetsBySlideId = new Map<string, typeof assets>();
  for (const asset of assets) {
    const current = assetsBySlideId.get(asset.slide_id) ?? [];
    current.push(asset);
    assetsBySlideId.set(asset.slide_id, current);
  }

  const signedUrlByPath = new Map<string, string>();
  const renderPaths = slideRows.map((slide) => slide.render_path).filter(Boolean) as string[];

  for (const renderPath of renderPaths) {
    const { data } = await supabase.storage.from('manual-renders').createSignedUrl(renderPath, 60 * 10);
    if (data?.signedUrl) {
      signedUrlByPath.set(renderPath, data.signedUrl);
    }
  }

  return NextResponse.json({
    slides: slideRows.map((slide) => ({
      ...slide,
      render_url: slide.render_path ? signedUrlByPath.get(slide.render_path) ?? null : null,
      assets: assetsBySlideId.get(slide.id) ?? [],
    })),
  });
}
