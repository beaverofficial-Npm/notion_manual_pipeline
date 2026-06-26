import 'server-only';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { cropRender, loadRender, storeCroppedAsset, uploadImageToNotion, type PercentBox } from '@/lib/notion/assets';

const NOTION_VERSION = '2022-06-28';
const MAX_CHILDREN_PER_REQUEST = 100;

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
  review_status: string;
}

interface BlockChild {
  kind: 'bulleted' | 'callout' | 'paragraph';
  text: string;
}

interface BlockContent {
  kind: string;
  text?: string;
  children?: BlockChild[];
  rows?: string[][];
}

type NotionBlock = Record<string, unknown>;

function requireNotionToken() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error('NOTION_TOKEN이 비어 있습니다. Notion integration secret을 .env에 설정해야 발행할 수 있습니다.');
  }
  return token;
}

export function extractNotionPageId(value: string | null | undefined): string {
  if (!value) return '';
  const compact = value.trim().replace(/-/g, '');
  const match = compact.match(/[0-9a-fA-F]{32}/);
  if (!match) return '';
  const id = match[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function richText(content: string) {
  return [{ type: 'text', text: { content: (content ?? '').slice(0, 2000) } }];
}

function childBlock(child: BlockChild): NotionBlock {
  if (child.kind === 'callout') {
    return { object: 'block', type: 'callout', callout: { rich_text: richText(child.text), icon: { type: 'emoji', emoji: '⚠️' }, color: 'yellow_background' } };
  }
  if (child.kind === 'bulleted') {
    return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(child.text) } };
  }
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(child.text) } };
}

function tableBlock(rows: string[][]): NotionBlock | null {
  const cleaned = rows.filter((row) => row.length > 0);
  if (!cleaned.length) return null;
  const width = Math.max(...cleaned.map((row) => row.length));
  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: cleaned.map((row) => ({
        object: 'block',
        type: 'table_row',
        table_row: {
          cells: Array.from({ length: width }, (_, index) => richText(row[index] ?? '')),
        },
      })),
    },
  };
}

function renderContentBlock(block: BlockContent): NotionBlock[] {
  switch (block.kind) {
    case 'numbered_list': {
      const children = (block.children ?? []).map(childBlock);
      return [
        {
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: richText(block.text ?? ''),
            ...(children.length ? { children } : {}),
          },
        },
      ];
    }
    case 'bulleted_list':
      return [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(block.text ?? '') } }];
    case 'callout':
      return [
        {
          object: 'block',
          type: 'callout',
          callout: { rich_text: richText(block.text ?? ''), icon: { type: 'emoji', emoji: '⚠️' }, color: 'yellow_background' },
        },
      ];
    case 'table': {
      const table = tableBlock(block.rows ?? []);
      return table ? [table] : [];
    }
    case 'paragraph':
    default:
      return block.text ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(block.text) } }] : [];
  }
}

function imageBlock(fileUploadId: string): NotionBlock {
  return { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: fileUploadId } } };
}

function headingBlock(level: 1 | 2 | 3, text: string): NotionBlock {
  const type = `heading_${level}` as const;
  return { object: 'block', type, [type]: { rich_text: richText(text) } };
}

async function notionRequest<T>(token: string, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? `Notion API 요청 실패 (${response.status})`);
  return body as T;
}

async function createPage(token: string, parentPageId: string, title: string, children: NotionBlock[]) {
  const head = children.slice(0, MAX_CHILDREN_PER_REQUEST);
  const page = await notionRequest<{ id: string; url?: string }>(token, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      properties: { title: { title: richText(title) } },
      children: head,
    }),
  });

  for (let index = MAX_CHILDREN_PER_REQUEST; index < children.length; index += MAX_CHILDREN_PER_REQUEST) {
    const chunk = children.slice(index, index + MAX_CHILDREN_PER_REQUEST);
    await notionRequest(token, `/blocks/${page.id}/children`, { method: 'PATCH', body: JSON.stringify({ children: chunk }) });
  }

  return page;
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
  let assetRows: AssetRow[] = [];
  if (slideIds.length) {
    const { data: assets } = await supabase
      .from('manual_assets')
      .select('id,slide_id,label,crop_box,review_status')
      .in('slide_id', slideIds)
      .neq('review_status', 'excluded')
      .order('created_at');
    assetRows = (assets ?? []) as AssetRow[];
  }

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

  // 이미지 미리보기를 위한 렌더 signed URL
  const renderPaths = new Set<string>();
  for (const slides of data.slidesByFunction.values()) {
    for (const slide of slides) {
      if (slide.render_path && (data.assetsBySlide.get(slide.id)?.length ?? 0) > 0) renderPaths.add(slide.render_path);
    }
  }
  const signedUrlByPath = new Map<string, string>();
  for (const renderPath of renderPaths) {
    const { data: signed } = await supabase.storage.from('manual-renders').createSignedUrl(renderPath, 60 * 30);
    if (signed?.signedUrl) signedUrlByPath.set(renderPath, signed.signedUrl);
  }

  const categories = data.categories
    .map((category) => {
      const functions = (data.functionsByCategory.get(category.id) ?? [])
        .map((fn) => {
          const slides = data.slidesByFunction.get(fn.id) ?? [];
          const blocks: Array<{ kind: string; text: string; children: BlockChild[]; rows?: string[][] }> = [];
          const images: Array<{ renderUrl: string; cropBox: PercentBox; label: string }> = [];

          for (const slide of slides) {
            for (const block of data.blocksBySlide.get(slide.id) ?? []) {
              blocks.push({
                kind: block.content.kind,
                text: block.content.text ?? '',
                children: block.content.children ?? [],
                rows: block.content.rows,
              });
            }
            const renderUrl = slide.render_path ? signedUrlByPath.get(slide.render_path) : undefined;
            if (renderUrl) {
              for (const asset of data.assetsBySlide.get(slide.id) ?? []) {
                if (asset.crop_box) images.push({ renderUrl, cropBox: asset.crop_box, label: asset.label });
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

export interface PublishProgress {
  done: number;
  total: number;
  label: string;
}

export async function publishTaskToNotion(taskId: string, onProgress?: (p: PublishProgress) => void, signal?: AbortSignal) {
  const token = requireNotionToken();
  const supabase = createServiceSupabaseClient();
  const data = await fetchPublishData(taskId);

  // 진행 총량 = 정리할 기능 수 + 노션 페이지 작성 1
  let total = 1;
  for (const category of data.categories) {
    total += (data.functionsByCategory.get(category.id) ?? []).filter((fn) => (data.slidesByFunction.get(fn.id) ?? []).length > 0).length;
  }
  let done = 0;
  const report = (label: string) => onProgress?.({ done, total, label });

  const { data: publishRun, error: runError } = await supabase
    .from('manual_publish_runs')
    .insert({
      task_id: taskId,
      status: 'running',
      target_page_id: data.parentPageId,
      payload: { pageTitle: data.task.title },
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (runError || !publishRun) throw new Error(runError?.message ?? '발행 이력을 생성하지 못했습니다.');

  await supabase.from('manual_tasks').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', taskId);

  try {
    let functionCount = 0;
    let imageCount = 0;

    // 한 장의 매뉴얼 페이지로 구성한다(서브페이지 깊이 이동 없음).
    // 카테고리 heading_1 → 기능 heading_2 → 내용/이미지 순으로 평면 배치한다.
    // 헤딩이 있으면 노션이 우측 사이드 아웃라인(목차)을 자동으로 띄우므로, 본문 앞단의 목차 블록은 넣지 않는다.
    const children: NotionBlock[] = [];

    for (const category of data.categories) {
      const functions = (data.functionsByCategory.get(category.id) ?? []).filter(
        (fn) => (data.slidesByFunction.get(fn.id) ?? []).length > 0,
      );
      if (!functions.length) continue;

      children.push(headingBlock(1, `📕 ${category.title}`));

      for (const fn of functions) {
        if (signal?.aborted) throw new Error('CANCELLED');
        report(`정리 중: ${fn.title}`);
        children.push(headingBlock(2, fn.title));

        const slides = data.slidesByFunction.get(fn.id) ?? [];
        for (const slide of slides) {
          for (const block of data.blocksBySlide.get(slide.id) ?? []) {
            children.push(...renderContentBlock(block.content));
          }
          const assets = data.assetsBySlide.get(slide.id) ?? [];
          if (assets.length && slide.render_path) {
            const renderBuffer = await loadRender(slide.render_path);
            for (const asset of assets) {
              if (!asset.crop_box) continue;
              const cropped = await cropRender(renderBuffer, asset.crop_box);
              await storeCroppedAsset(taskId, asset.id, cropped);
              const fileUploadId = await uploadImageToNotion(token, cropped, `${asset.id}.png`);
              children.push(imageBlock(fileUploadId));
              imageCount += 1;
            }
          }
        }

        children.push({ object: 'block', type: 'divider', divider: {} });
        functionCount += 1;
        done += 1;
        report(`정리 중: ${fn.title}`);
      }
    }

    report('노션 페이지 작성 중');
    const hub = await createPage(token, data.parentPageId, data.task.title, children);
    done += 1;
    report('노션 페이지 작성 중');

    const { error: mappingError } = await supabase.from('manual_notion_mappings').insert([
      { publish_run_id: publishRun.id, local_entity_type: 'task', local_entity_id: taskId, notion_page_id: hub.id, notion_block_id: null },
    ]);
    if (mappingError) throw new Error(mappingError.message);

    await supabase.from('manual_publish_runs').update({ status: 'succeeded', finished_at: new Date().toISOString() }).eq('id', publishRun.id);
    await supabase.from('manual_tasks').update({ status: 'published', updated_at: new Date().toISOString() }).eq('id', taskId);

    return { publishRunId: publishRun.id as string, pageId: hub.id, url: hub.url ?? null, functionCount, imageCount };
  } catch (error) {
    const cancelled = signal?.aborted || (error instanceof Error && error.message === 'CANCELLED');
    const message = cancelled ? '발행이 취소되었습니다.' : error instanceof Error ? error.message : 'Notion 발행에 실패했습니다.';
    await supabase
      .from('manual_publish_runs')
      .update({ status: cancelled ? 'cancelled' : 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', publishRun.id);
    // 취소면 다시 검수할 수 있도록 review_required 로 되돌린다.
    await supabase
      .from('manual_tasks')
      .update({ status: cancelled ? 'review_required' : 'failed', updated_at: new Date().toISOString() })
      .eq('id', taskId);
    throw error;
  }
}
