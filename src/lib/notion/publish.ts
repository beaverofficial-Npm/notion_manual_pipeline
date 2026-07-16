// 발행 "미리보기" 전용 모듈. 실제 발행 실행은 scripts/worker/publish-core.mjs 가 담당한다
// (트리거 route 가 큐에 넣고 워커가 백그라운드 처리 — 연결 무관, 진행은 publish_run.progress).
import 'server-only';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { selectInChunks } from '@/lib/supabase/chunked';
import { presignGetUrls } from '@/lib/storage/source-storage';
import { type PercentBox } from '@/lib/notion/assets';

interface ManualTaskRow {
  id: string;
  title: string;
  target_notion_page_id: string | null;
  target_notion_data_source_id: string | null;
}

interface CategoryRow {
  id: string;
  title: string;
  sort_order: number;
}

interface FunctionRow {
  id: string;
  category_id: string;
  title: string;
  sort_order: number;
}

interface SlideRow {
  id: string;
  function_id: string | null;
  slide_number: number;
  render_path: string | null;
  review_status: string;
}

interface BlockRow {
  id: string;
  slide_id: string | null;
  sort_order: number;
  kind: string;
  content: BlockContent;
  review_status: string;
}

interface AssetRow {
  id: string;
  slide_id: string;
  label: string;
  crop_box: PercentBox | null;
  storage_path: string | null;
  review_status: string;
}

interface BlockChild {
  kind: 'bulleted' | 'callout' | 'paragraph';
  text: string;
}

interface BlockContent {
  kind: string;
  text?: string;
  number?: number | null;
  marker?: string; // PPT 원본 스텝 마커: ')' 또는 '.'
  prefix?: string | null; // 원본 스텝 라벨 전체: "1.", "1)", "1-1." (계층번호 포함)
  children?: BlockChild[];
  rows?: string[][];
}

export function extractNotionPageId(value: string | null | undefined): string {
  if (!value) return '';
  const compact = value.trim().replace(/-/g, '');
  const match = compact.match(/[0-9a-fA-F]{32}/);
  if (!match) return '';
  const id = match[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

interface FetchResult {
  task: ManualTaskRow;
  parentPageId: string;
  categories: CategoryRow[];
  functionsByCategory: Map<string, FunctionRow[]>;
  slidesByFunction: Map<string, SlideRow[]>;
  blocksBySlide: Map<string, BlockRow[]>;
  assetsBySlide: Map<string, AssetRow[]>;
}

async function fetchPublishData(taskId: string): Promise<FetchResult> {
  const supabase = createServiceSupabaseClient();

  const { data: task, error: taskError } = await supabase
    .from('manual_tasks')
    .select('id,title,target_notion_page_id,target_notion_data_source_id')
    .eq('id', taskId)
    .single();
  if (taskError || !task) throw new Error(taskError?.message ?? '작업을 찾지 못했습니다.');

  const parentPageId = extractNotionPageId((task as ManualTaskRow).target_notion_page_id ?? (task as ManualTaskRow).target_notion_data_source_id);
  if (!parentPageId) throw new Error('Notion 대상 페이지 URL 또는 page id가 필요합니다.');

  const [{ data: categories }, { data: functions }, { data: slides }, { data: blocks }] = await Promise.all([
    supabase.from('manual_categories').select('id,title,sort_order').eq('task_id', taskId).order('sort_order'),
    supabase.from('manual_functions').select('id,category_id,title,sort_order').eq('task_id', taskId).order('sort_order'),
    supabase
      .from('manual_slides')
      .select('id,function_id,slide_number,render_path,review_status')
      .eq('task_id', taskId)
      .not('function_id', 'is', null)
      .neq('review_status', 'excluded')
      .order('slide_number'),
    supabase
      .from('manual_notion_blocks')
      .select('id,slide_id,sort_order,kind,content,review_status')
      .eq('task_id', taskId)
      .neq('review_status', 'excluded')
      .order('sort_order'),
  ]);

  const slideRows = (slides ?? []) as SlideRow[];
  const slideIds = slideRows.map((slide) => slide.id);
  // .in() 한 방은 큰 덱(200장+)에서 "URI too long" 으로 빈 결과가 됨 → 청크 조회.
  const assetRows = await selectInChunks<AssetRow>(slideIds, (chunk) =>
    supabase
      .from('manual_assets')
      .select('id,slide_id,label,crop_box,storage_path,review_status')
      .in('slide_id', chunk)
      .neq('review_status', 'excluded')
      .order('created_at'),
  );

  const functionsByCategory = new Map<string, FunctionRow[]>();
  for (const fn of (functions ?? []) as FunctionRow[]) {
    const current = functionsByCategory.get(fn.category_id) ?? [];
    current.push(fn);
    functionsByCategory.set(fn.category_id, current);
  }

  const slidesByFunction = new Map<string, SlideRow[]>();
  for (const slide of slideRows) {
    if (!slide.function_id) continue;
    const current = slidesByFunction.get(slide.function_id) ?? [];
    current.push(slide);
    slidesByFunction.set(slide.function_id, current);
  }

  const blocksBySlide = new Map<string, BlockRow[]>();
  for (const block of (blocks ?? []) as BlockRow[]) {
    if (!block.slide_id) continue;
    const current = blocksBySlide.get(block.slide_id) ?? [];
    current.push(block);
    blocksBySlide.set(block.slide_id, current);
  }

  const assetsBySlide = new Map<string, AssetRow[]>();
  for (const asset of assetRows) {
    const current = assetsBySlide.get(asset.slide_id) ?? [];
    current.push(asset);
    assetsBySlide.set(asset.slide_id, current);
  }

  return {
    task: task as ManualTaskRow,
    parentPageId,
    categories: (categories ?? []) as CategoryRow[],
    functionsByCategory,
    slidesByFunction,
    blocksBySlide,
    assetsBySlide,
  };
}

// 발행 미리보기: 페이지를 만들지 않고, 실제로 들어갈 블록 위계와 이미지(렌더 + crop_box)를
// 기능 단위로 그대로 돌려준다. 발행과 동일한 읽기 순서(슬라이드별 블록 → 이미지)를 따른다.
export async function buildPublishPreview(taskId: string) {
  const supabase = createServiceSupabaseClient();
  const data = await fetchPublishData(taskId);

  // 이미지 미리보기용 signed URL — 두 종류를 배치 서명한다(순차 서명은 큰 덱에서 타임아웃 병력).
  //  - capture(레거시): 렌더 PNG + crop_box → manual-renders
  //  - group_bake(현행): 이미 구워진 에셋 PNG(storage_path) → manual-assets
  const renderPaths = new Set<string>();
  const assetPaths = new Set<string>();
  for (const slides of data.slidesByFunction.values()) {
    for (const slide of slides) {
      for (const asset of data.assetsBySlide.get(slide.id) ?? []) {
        if (asset.storage_path) assetPaths.add(asset.storage_path);
        else if (asset.crop_box && slide.render_path) renderPaths.add(slide.render_path);
      }
    }
  }
  const signedUrlByPath = await presignGetUrls([...renderPaths]);
  const signedUrlByAssetPath = await presignGetUrls([...assetPaths]);

  const categories = data.categories
    .map((category) => {
      const functions = (data.functionsByCategory.get(category.id) ?? [])
        .map((fn) => {
          const slides = data.slidesByFunction.get(fn.id) ?? [];
          const blocks: Array<{ kind: string; text: string; number?: number | null; marker?: string; prefix?: string | null; children: BlockChild[]; rows?: string[][] }> = [];
          const images: Array<{ renderUrl: string; cropBox: PercentBox; label: string }> = [];

          for (const slide of slides) {
            for (const block of data.blocksBySlide.get(slide.id) ?? []) {
              blocks.push({
                kind: block.content.kind,
                text: block.content.text ?? '',
                number: block.content.number,
                marker: block.content.marker,
                prefix: block.content.prefix,
                children: block.content.children ?? [],
                rows: block.content.rows,
              });
            }
            for (const asset of data.assetsBySlide.get(slide.id) ?? []) {
              if (asset.storage_path) {
                // group_bake: 구워진 이미지 그대로(발행에 들어가는 바로 그 파일)
                const assetUrl = signedUrlByAssetPath.get(asset.storage_path);
                if (assetUrl) images.push({ renderUrl: assetUrl, cropBox: { left: 0, top: 0, width: 100, height: 100 }, label: asset.label });
              } else if (asset.crop_box && slide.render_path) {
                // capture(레거시): 렌더 + crop_box
                const renderUrl = signedUrlByPath.get(slide.render_path);
                if (renderUrl) images.push({ renderUrl, cropBox: asset.crop_box, label: asset.label });
              }
            }
          }

          return { id: fn.id, title: fn.title, slideCount: slides.length, blocks, images };
        })
        .filter((fn) => fn.slideCount > 0);
      return { id: category.id, title: category.title, functions };
    })
    .filter((category) => category.functions.length > 0);

  return {
    parentPageId: data.parentPageId,
    pageTitle: data.task.title,
    categories,
    categoryCount: categories.length,
    functionCount: categories.reduce((sum, category) => sum + category.functions.length, 0),
  };
}
