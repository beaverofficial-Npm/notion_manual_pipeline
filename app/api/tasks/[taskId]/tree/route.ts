import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

const RENDER_BUCKET = 'manual-renders';

// 검수 화면용 계층 트리: 카테고리 → 기능 → 슬라이드(+크롭 후보, 블록 요약).
export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  const { data: task, error: taskError } = await supabase
    .from('manual_tasks')
    .select('id,title,status,target_notion_page_id')
    .eq('id', taskId)
    .single();
  if (taskError || !task) {
    return NextResponse.json({ message: taskError?.message ?? '작업을 찾지 못했습니다.' }, { status: 404 });
  }

  const [{ data: categories }, { data: functions }, { data: slides }, { data: blocks }] = await Promise.all([
    supabase.from('manual_categories').select('id,title,sort_order').eq('task_id', taskId).order('sort_order'),
    supabase.from('manual_functions').select('id,category_id,title,sort_order,review_status').eq('task_id', taskId).order('sort_order'),
    supabase
      .from('manual_slides')
      .select('id,slide_number,title,render_path,slide_role,category_id,function_id,review_status')
      .eq('task_id', taskId)
      .order('slide_number'),
    supabase
      .from('manual_notion_blocks')
      .select('id,slide_id,kind,content,sort_order,review_status')
      .eq('task_id', taskId)
      .order('sort_order'),
  ]);

  const slideRows = slides ?? [];
  const slideIds = slideRows.map((slide) => slide.id);

  let assetRows: Array<{
    id: string;
    slide_id: string;
    kind: string;
    label: string;
    crop_box: unknown;
    review_status: string;
    confidence: number | null;
  }> = [];
  if (slideIds.length) {
    const { data: assets } = await supabase
      .from('manual_assets')
      .select('id,slide_id,kind,label,crop_box,review_status,confidence')
      .in('slide_id', slideIds)
      .order('created_at');
    assetRows = assets ?? [];
  }

  // 렌더 signed URL
  const signedUrlByPath = new Map<string, string>();
  for (const renderPath of slideRows.map((slide) => slide.render_path).filter(Boolean) as string[]) {
    const { data } = await supabase.storage.from(RENDER_BUCKET).createSignedUrl(renderPath, 60 * 30);
    if (data?.signedUrl) signedUrlByPath.set(renderPath, data.signedUrl);
  }

  const assetsBySlide = new Map<string, typeof assetRows>();
  for (const asset of assetRows) {
    const current = assetsBySlide.get(asset.slide_id) ?? [];
    current.push(asset);
    assetsBySlide.set(asset.slide_id, current);
  }

  const blocksBySlide = new Map<string, Array<{ id: string; kind: string; content: unknown }>>();
  for (const block of blocks ?? []) {
    const current = blocksBySlide.get(block.slide_id ?? '') ?? [];
    current.push({ id: block.id, kind: block.kind, content: block.content });
    blocksBySlide.set(block.slide_id ?? '', current);
  }

  const slidesByFunction = new Map<string, typeof slideRows>();
  const unassignedSlides: typeof slideRows = [];
  for (const slide of slideRows) {
    if (slide.function_id) {
      const current = slidesByFunction.get(slide.function_id) ?? [];
      current.push(slide);
      slidesByFunction.set(slide.function_id, current);
    } else {
      unassignedSlides.push(slide);
    }
  }

  function decorateSlide(slide: (typeof slideRows)[number]) {
    return {
      id: slide.id,
      slide_number: slide.slide_number,
      title: slide.title,
      slide_role: slide.slide_role,
      review_status: slide.review_status,
      render_url: slide.render_path ? signedUrlByPath.get(slide.render_path) ?? null : null,
      assets: assetsBySlide.get(slide.id) ?? [],
      blocks: blocksBySlide.get(slide.id) ?? [],
    };
  }

  const functionsByCategory = new Map<string, typeof functions>();
  for (const fn of functions ?? []) {
    const current = functionsByCategory.get(fn.category_id) ?? [];
    current.push(fn);
    functionsByCategory.set(fn.category_id, current);
  }

  const tree = (categories ?? []).map((category) => ({
    id: category.id,
    title: category.title,
    functions: (functionsByCategory.get(category.id) ?? []).map((fn) => ({
      id: fn.id,
      title: fn.title,
      review_status: fn.review_status,
      slides: (slidesByFunction.get(fn.id) ?? []).map(decorateSlide),
    })),
  }));

  return NextResponse.json({
    task: { id: task.id, title: task.title, status: task.status },
    tree,
    excludedSlides: unassignedSlides.map(decorateSlide),
  });
}
