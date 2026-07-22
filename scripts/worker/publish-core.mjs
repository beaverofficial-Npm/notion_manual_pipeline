// 발행 실행 코어 — 프레임워크 무관(순수 node ESM). supabase client·token 을 인자로 주입받는다.
// 웹 트리거 route 는 이 코어를 직접 실행하지 않고 큐에만 넣고, 워커(run-publish-job.mjs)가 이 코어로 발행한다.
// 연결이 끊겨도 워커가 끝까지 돌리고 진행을 publish_run.progress 에 기록 → 프론트는 그걸 폴링한다.
import sharp from 'sharp';
import { downloadSource as getObject } from './source-storage.mjs';

const NOTION_VERSION = '2022-06-28';
const MAX_CHILDREN_PER_REQUEST = 100;
const PUBLISH_MAX_WIDTH = Number(process.env.NOTION_IMAGE_MAX_WIDTH ?? 540);

sharp.cache(false);
sharp.concurrency(1);

// ── Notion page id 정규화 ──
export function extractNotionPageId(value) {
  if (!value) return '';
  const compact = String(value).trim().replace(/-/g, '');
  const match = compact.match(/[0-9a-fA-F]{32}/);
  if (!match) return '';
  const id = match[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

// ── 노션 블록 빌더(순수) ──
function richText(content) {
  return [{ type: 'text', text: { content: (content ?? '').slice(0, 2000) } }];
}
function childBlock(child) {
  if (child.kind === 'callout') return { object: 'block', type: 'callout', callout: { rich_text: richText(child.text), icon: { type: 'emoji', emoji: '⚠️' }, color: 'yellow_background' } };
  if (child.kind === 'bulleted') return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(child.text) } };
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(child.text) } };
}
function tableBlock(rows) {
  const cleaned = (rows ?? []).filter((row) => row.length > 0);
  if (!cleaned.length) return null;
  const width = Math.max(...cleaned.map((row) => row.length));
  return {
    object: 'block', type: 'table',
    table: { table_width: width, has_column_header: true, has_row_header: false,
      children: cleaned.map((row) => ({ object: 'block', type: 'table_row', table_row: { cells: Array.from({ length: width }, (_, i) => richText(row[i] ?? '')) } })) },
  };
}
function renderContentBlock(block) {
  switch (block.kind) {
    case 'numbered_list': {
      const children = (block.children ?? []).map(childBlock);
      if (typeof block.number === 'number') {
        return [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(`${block.prefix ?? `${block.number}${block.marker ?? '.'}`} ${block.text ?? ''}`), ...(children.length ? { children } : {}) } }];
      }
      return [{ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(block.text ?? ''), ...(children.length ? { children } : {}) } }];
    }
    case 'bulleted_list': return [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(block.text ?? '') } }];
    case 'callout': return [{ object: 'block', type: 'callout', callout: { rich_text: richText(block.text ?? ''), icon: { type: 'emoji', emoji: '⚠️' }, color: 'yellow_background' } }];
    case 'table': { const t = tableBlock(block.rows ?? []); return t ? [t] : []; }
    case 'paragraph': default: return block.text ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(block.text) } }] : [];
  }
}
function imageBlock(fileUploadId) {
  return { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: fileUploadId } } };
}
function headingBlock(level, text) {
  const type = `heading_${level}`;
  return { object: 'block', type, [type]: { rich_text: richText(text) } };
}

// ── 노션 API(순수 fetch, 429/5xx 재시도) ──
async function notionFetchWithRetry(url, init, tries = 4) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    lastStatus = res.status;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 8000)));
  }
  throw new Error(`노션 요청 반복 실패 (마지막 상태 ${lastStatus})`);
}
async function notionRequest(token, path, init) {
  const res = await notionFetchWithRetry(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION, ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `Notion API 요청 실패 (${res.status})`);
  return body;
}
async function createPage(token, parentPageId, title, children) {
  const head = children.slice(0, MAX_CHILDREN_PER_REQUEST);
  const page = await notionRequest(token, '/pages', {
    method: 'POST',
    body: JSON.stringify({ parent: { type: 'page_id', page_id: parentPageId }, properties: { title: { title: richText(title) } }, children: head }),
  });
  for (let i = MAX_CHILDREN_PER_REQUEST; i < children.length; i += MAX_CHILDREN_PER_REQUEST) {
    await notionRequest(token, `/blocks/${page.id}/children`, { method: 'PATCH', body: JSON.stringify({ children: children.slice(i, i + MAX_CHILDREN_PER_REQUEST) }) });
  }
  return page;
}
async function uploadImageToNotion(token, buffer, filename) {
  const created = await (await notionFetchWithRetry('https://api.notion.com/v1/file_uploads', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
    body: JSON.stringify({ filename, content_type: 'image/png' }),
  })).json().catch(() => ({}));
  if (!created.id) throw new Error(created.message ?? '파일 업로드 생성 실패');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), filename);
  const sendRes = await notionFetchWithRetry(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION }, body: form,
  });
  if (!sendRes.ok) { const e = await sendRes.json().catch(() => ({})); throw new Error(e.message ?? `파일 업로드 전송 실패 (${sendRes.status})`); }
  return created.id;
}

// ── 이미지(sharp + R2) ──
async function resizeForPublish(buffer) {
  if (!Number.isFinite(PUBLISH_MAX_WIDTH) || PUBLISH_MAX_WIDTH <= 0) return buffer;
  const meta = await sharp(buffer).metadata();
  if (!meta.width || meta.width <= PUBLISH_MAX_WIDTH) return buffer;
  return sharp(buffer).resize({ width: PUBLISH_MAX_WIDTH }).png().toBuffer();
}
// ── 데이터 조회(supabase 주입) ──
async function selectInChunks(ids, fetch, chunkSize = 100) {
  if (!ids.length) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map((c) => fetch(c)));
  const rows = [];
  for (const { data, error } of results) { if (error) throw new Error(error.message); rows.push(...(data ?? [])); }
  return rows;
}
export async function fetchPublishData(supabase, taskId, conversionJobId) {
  if (!conversionJobId) throw new Error('conversionJobId is required for publishing.');
  const { data: conversionJob, error: conversionJobError } = await supabase
    .from('manual_conversion_jobs')
    .select('id,task_id,status,run_number')
    .eq('id', conversionJobId)
    .single();
  if (conversionJobError || !conversionJob) {
    throw new Error(conversionJobError?.message ?? `변환 job을 찾지 못했습니다: ${conversionJobId}`);
  }
  if (conversionJob.task_id !== taskId) throw new Error('발행 run의 conversion job이 task와 일치하지 않습니다.');
  if (conversionJob.status !== 'succeeded') throw new Error('성공한 conversion job만 발행할 수 있습니다.');

  const { data: task, error: taskError } = await supabase.from('manual_tasks').select('id,title,target_notion_page_id,target_notion_data_source_id').eq('id', taskId).single();
  if (taskError || !task) throw new Error(taskError?.message ?? '작업을 찾지 못했습니다.');
  const parentPageId = extractNotionPageId(task.target_notion_page_id ?? task.target_notion_data_source_id);
  if (!parentPageId) throw new Error('Notion 대상 페이지 URL 또는 page id가 필요합니다.');

  const { data: slides, error: slidesError } = await supabase
    .from('manual_slides')
    .select('id,function_id,slide_number,render_path,review_status')
    .eq('task_id', taskId)
    .eq('job_id', conversionJobId)
    .not('function_id', 'is', null)
    .neq('review_status', 'excluded')
    .order('slide_number');
  if (slidesError) throw new Error(slidesError.message);
  const slideRows = slides ?? [];
  const slideIds = slideRows.map((slide) => slide.id);
  const functionIds = [...new Set(slideRows.map((slide) => slide.function_id).filter(Boolean))];

  const [functions, blocks, assetRows] = await Promise.all([
    selectInChunks(functionIds, (chunk) =>
      supabase
        .from('manual_functions')
        .select('id,category_id,title,sort_order')
        .eq('task_id', taskId)
        .in('id', chunk)
        .order('sort_order')),
    selectInChunks(slideIds, (chunk) =>
      supabase
        .from('manual_notion_blocks')
        .select('id,slide_id,sort_order,kind,content,review_status')
        .eq('task_id', taskId)
        .in('slide_id', chunk)
        .neq('review_status', 'excluded')
        .order('sort_order')),
    selectInChunks(slideIds, (chunk) =>
      supabase
        .from('manual_assets')
        .select('id,slide_id,label,storage_path,review_status')
        .eq('job_id', conversionJobId)
        .in('slide_id', chunk)
        .eq('kind', 'group_bake')
        .neq('review_status', 'excluded')
        .order('created_at')),
  ]);
  const categoryIds = [...new Set(functions.map((fn) => fn.category_id).filter(Boolean))];
  const categories = await selectInChunks(categoryIds, (chunk) =>
    supabase
      .from('manual_categories')
      .select('id,title,sort_order')
      .eq('task_id', taskId)
      .in('id', chunk)
      .order('sort_order'));
  categories.sort((a, b) => a.sort_order - b.sort_order);
  functions.sort((a, b) => a.sort_order - b.sort_order);
  blocks.sort((a, b) => a.sort_order - b.sort_order);

  const functionsByCategory = new Map(), slidesByFunction = new Map(), blocksBySlide = new Map(), assetsBySlide = new Map();
  for (const fn of functions) { const c = functionsByCategory.get(fn.category_id) ?? []; c.push(fn); functionsByCategory.set(fn.category_id, c); }
  for (const s of slideRows) { if (!s.function_id) continue; const c = slidesByFunction.get(s.function_id) ?? []; c.push(s); slidesByFunction.set(s.function_id, c); }
  for (const b of blocks) { if (!b.slide_id) continue; const c = blocksBySlide.get(b.slide_id) ?? []; c.push(b); blocksBySlide.set(b.slide_id, c); }
  for (const a of assetRows) { const c = assetsBySlide.get(a.slide_id) ?? []; c.push(a); assetsBySlide.set(a.slide_id, c); }
  return { task, conversionJob, parentPageId, categories, functionsByCategory, slidesByFunction, blocksBySlide, assetsBySlide };
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) { const i = cursor; cursor += 1; await worker(items[i], i); }
  });
  await Promise.all(runners);
}

// ── 발행 실행(코어) — 워커가 claim 한 publishRunId 로 실행. 진행은 publish_run.progress 에 기록 ──
export async function publishToNotion({ supabase, token, taskId, publishRunId, conversionJobId }) {
  let data;
  try {
    data = await fetchPublishData(supabase, taskId, conversionJobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : '발행 입력 검증에 실패했습니다.';
    await supabase
      .from('manual_publish_runs')
      .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', publishRunId);
    await supabase
      .from('manual_tasks')
      .update({ status: 'review_required', updated_at: new Date().toISOString() })
      .eq('id', taskId);
    throw error;
  }
  let total = 1;
  for (const category of data.categories) total += (data.functionsByCategory.get(category.id) ?? []).filter((fn) => (data.slidesByFunction.get(fn.id) ?? []).length > 0).length;
  let done = 0;
  let lastReport = 0;
  // 진행 기록 겸 취소 감지: status 가 여전히 running 일 때만 갱신되게 조건을 걸고,
  // 갱신된 행이 없으면(=사용자가 cancelled 로 바꿈) 즉시 중단한다.
  const writeProgress = async (label, force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < 800) return; // DB update 를 0.8초 간격으로 throttle
    lastReport = now;
    const { data: updated } = await supabase
      .from('manual_publish_runs')
      .update({ progress: { done, total, label } })
      .eq('id', publishRunId)
      .eq('status', 'running')
      .select('id')
      .maybeSingle();
    if (!updated) throw new Error('CANCELLED');
  };

  try {
    await supabase.from('manual_tasks').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', taskId);

    // 이미지 병렬 선업로드
    const imageJobs = [];
    for (const category of data.categories) {
      for (const fn of (data.functionsByCategory.get(category.id) ?? []).filter((f) => (data.slidesByFunction.get(f.id) ?? []).length > 0)) {
        for (const slide of data.slidesByFunction.get(fn.id) ?? []) {
          for (const asset of data.assetsBySlide.get(slide.id) ?? []) {
            if (asset.storage_path) imageJobs.push(asset);
          }
        }
      }
    }
    const uploadedByAssetId = new Map();
    let uploadedCount = 0;
    await runPool(imageJobs, 6, async (asset) => {
      let buffer = await getObject(asset.storage_path);
      buffer = await resizeForPublish(buffer);
      const fileUploadId = await uploadImageToNotion(token, buffer, `${asset.id}.png`);
      uploadedByAssetId.set(asset.id, fileUploadId);
      uploadedCount += 1;
      await writeProgress(`이미지 업로드 ${uploadedCount}/${imageJobs.length}`);
    });

    // 페이지 children 구성
    const children = [];
    let functionCount = 0, imageCount = 0;
    for (const category of data.categories) {
      const functions = (data.functionsByCategory.get(category.id) ?? []).filter((fn) => (data.slidesByFunction.get(fn.id) ?? []).length > 0);
      if (!functions.length) continue;
      children.push(headingBlock(1, `📕 ${category.title}`));
      const categoryNorm = category.title.replace(/\s+/g, '').toLowerCase();
      for (const fn of functions) {
        if (fn.title.replace(/\s+/g, '').toLowerCase() !== categoryNorm) children.push(headingBlock(2, fn.title));
        for (const slide of data.slidesByFunction.get(fn.id) ?? []) {
          for (const asset of data.assetsBySlide.get(slide.id) ?? []) {
            const fileUploadId = uploadedByAssetId.get(asset.id);
            if (!fileUploadId) continue;
            children.push(imageBlock(fileUploadId)); imageCount += 1;
          }
          for (const block of data.blocksBySlide.get(slide.id) ?? []) children.push(...renderContentBlock(block.content));
          children.push({ object: 'block', type: 'divider', divider: {} });
        }
        functionCount += 1; done += 1;
        await writeProgress(`정리 중: ${fn.title}`);
      }
    }

    await writeProgress('노션 페이지 작성 중', true);
    const hub = await createPage(token, data.parentPageId, data.task.title, children);
    done = total;

    await supabase.from('manual_notion_mappings').insert([{ publish_run_id: publishRunId, local_entity_type: 'task', local_entity_id: taskId, notion_page_id: hub.id, notion_block_id: null }]);
    await supabase.from('manual_publish_runs').update({ status: 'succeeded', finished_at: new Date().toISOString(), progress: { done: total, total, label: '완료', pageId: hub.id, url: hub.url ?? null } }).eq('id', publishRunId);
    await supabase.from('manual_tasks').update({ status: 'published', updated_at: new Date().toISOString() }).eq('id', taskId);
    return { pageId: hub.id, url: hub.url ?? null, functionCount, imageCount };
  } catch (error) {
    const cancelled = error instanceof Error && error.message === 'CANCELLED';
    if (cancelled) {
      // 사용자가 취소 — run 은 이미 cancelled. 마무리 시각만 찍고 task 를 검수 가능 상태로 되돌린다.
      await supabase.from('manual_publish_runs').update({ finished_at: new Date().toISOString() }).eq('id', publishRunId).eq('status', 'cancelled');
    } else {
      const message = error instanceof Error ? error.message : 'Notion 발행에 실패했습니다.';
      await supabase.from('manual_publish_runs').update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() }).eq('id', publishRunId);
    }
    await supabase.from('manual_tasks').update({ status: 'review_required', updated_at: new Date().toISOString() }).eq('id', taskId);
    throw error;
  }
}
