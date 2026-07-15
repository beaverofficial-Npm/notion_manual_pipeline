import 'server-only';
import sharp from 'sharp';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

// 작은 컨테이너(Railway)에서 발행 중 OOM 으로 죽지 않도록 sharp 메모리를 묶는다.
sharp.cache(false);
sharp.concurrency(1);

const RENDER_BUCKET = 'manual-renders';
const ASSET_BUCKET = 'manual-assets';
const NOTION_VERSION = '2022-06-28';

export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clampBox(box: PercentBox): PercentBox {
  const left = Math.max(0, Math.min(100, box.left));
  const top = Math.max(0, Math.min(100, box.top));
  return {
    left,
    top,
    width: Math.max(1, Math.min(100 - left, box.width)),
    height: Math.max(1, Math.min(100 - top, box.height)),
  };
}

// 슬라이드 렌더 PNG를 퍼센트 crop_box 기준으로 잘라 PNG 버퍼로 반환한다.
export async function cropRender(renderBuffer: Buffer, cropBox: PercentBox): Promise<Buffer> {
  const box = clampBox(cropBox);
  const image = sharp(renderBuffer);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('렌더 이미지 크기를 읽지 못했습니다.');

  const left = Math.round((box.left / 100) * width);
  const top = Math.round((box.top / 100) * height);
  const cropWidth = Math.max(1, Math.min(width - left, Math.round((box.width / 100) * width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round((box.height / 100) * height)));

  return image.extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer();
}

// 발행 루프는 슬라이드 단위로 한 번만 호출한다. 전역 캐시를 두면 모든 렌더 PNG 가
// 프로세스 수명 동안 누적되어(메모리 누수) 작은 컨테이너에서 OOM 을 일으키므로 캐시하지 않는다.
export async function loadRender(renderPath: string): Promise<Buffer> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.storage.from(RENDER_BUCKET).download(renderPath);
  if (error || !data) throw new Error(error?.message ?? `렌더를 불러오지 못했습니다: ${renderPath}`);

  return Buffer.from(await data.arrayBuffer());
}

// 노션 발행 시 이미지 폭을 줄여 더 작게 보이게 한다.
// (노션 API는 이미지 표시 폭 %를 직접 지정 못 함 → 이미지 자체를 줄여 올린다. 기본 폭은 일반 페이지에서 ~75% 정도.)
const PUBLISH_MAX_WIDTH = Number(process.env.NOTION_IMAGE_MAX_WIDTH ?? 540);
export async function resizeForPublish(buffer: Buffer): Promise<Buffer> {
  if (!Number.isFinite(PUBLISH_MAX_WIDTH) || PUBLISH_MAX_WIDTH <= 0) return buffer;
  const meta = await sharp(buffer).metadata();
  if (!meta.width || meta.width <= PUBLISH_MAX_WIDTH) return buffer;
  return sharp(buffer).resize({ width: PUBLISH_MAX_WIDTH }).png().toBuffer();
}

// group_bake 등 이미 manual-assets 버킷에 저장된 이미지를 그대로 불러온다.
export async function loadAsset(storagePath: string): Promise<Buffer> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.storage.from(ASSET_BUCKET).download(storagePath);
  if (error || !data) throw new Error(error?.message ?? `에셋 이미지를 불러오지 못했습니다: ${storagePath}`);
  return Buffer.from(await data.arrayBuffer());
}

// 잘린 이미지를 manual-assets 버킷에 저장하고 storage_path 를 반환한다.
export async function storeCroppedAsset(taskId: string, assetId: string, buffer: Buffer): Promise<string> {
  const supabase = createServiceSupabaseClient();
  const storagePath = `${taskId}/assets/${assetId}.png`;
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(storagePath, buffer, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) throw new Error(error.message);

  await supabase.from('manual_assets').update({ storage_path: storagePath, updated_at: new Date().toISOString() }).eq('id', assetId);
  return storagePath;
}

// 노션 rate limit(429)·일시적 5xx 는 몇 번 재시도한다(동시 업로드 시 필수).
async function notionFetchWithRetry(url: string, init: RequestInit, tries = 4): Promise<Response> {
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

// 노션 네이티브 파일 업로드(3단계). 만료 없는 첨부 id 를 반환한다.
export async function uploadImageToNotion(token: string, buffer: Buffer, filename: string): Promise<string> {
  const createResponse = await notionFetchWithRetry('https://api.notion.com/v1/file_uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({ filename, content_type: 'image/png' }),
  });
  const created = (await createResponse.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!createResponse.ok || !created.id) {
    throw new Error(created.message ?? `파일 업로드 생성 실패 (${createResponse.status})`);
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), filename);

  const sendResponse = await notionFetchWithRetry(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
    },
    body: form,
  });
  const sent = (await sendResponse.json().catch(() => ({}))) as { message?: string };
  if (!sendResponse.ok) {
    throw new Error(sent.message ?? `파일 업로드 전송 실패 (${sendResponse.status})`);
  }

  return created.id;
}
