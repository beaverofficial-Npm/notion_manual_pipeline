import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FIXED_CAPTURE_BOX, boxCropRect } from '../worker/group-bake.mjs';
import { renderPdfWithGraph } from '../worker/graph-renderer.mjs';
import { isHiddenSlideXml, mapRenderedPagesToSlides } from '../worker/slide-visibility.mjs';

const env = {
  MS_GRAPH_AUTH_MODE: 'client_credentials',
  MS_GRAPH_TENANT_ID: 'tenant-test',
  MS_GRAPH_CLIENT_ID: 'client-test',
  MS_GRAPH_CLIENT_SECRET: 'secret-test',
  MS_GRAPH_DRIVE_ID: 'drive-test',
  MS_GRAPH_TEMP_FOLDER_ID: 'folder-test',
  MS_GRAPH_UPLOAD_CHUNK_BYTES: String(320 * 1024),
};

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'graph-renderer-unit-'));
try {
  const sourcePath = path.join(tempDir, 'source.pptx');
  const source = Buffer.alloc(700_000, 7); // 320KiB + 320KiB + tail
  await writeFile(sourcePath, source);

  const ranges = [];
  let deleted = false;
  let chunkIndex = 0;
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'token-test' }), { status: 200 });
    }
    if (target.endsWith('/createUploadSession')) {
      assert.match(init.headers.Authorization, /^Bearer /);
      return new Response(JSON.stringify({ uploadUrl: 'https://upload.test/session' }), { status: 200 });
    }
    if (target === 'https://upload.test/session' && init.method === 'PUT') {
      ranges.push(init.headers['Content-Range']);
      chunkIndex += 1;
      const final = chunkIndex === 3;
      return new Response(JSON.stringify(final ? { id: 'item-test' } : { nextExpectedRanges: [] }), {
        status: final ? 201 : 202,
      });
    }
    if (target.includes('/content?format=pdf')) {
      return new Response(Buffer.from('%PDF-test'), { status: 200 });
    }
    if (target.endsWith('/items/item-test') && init.method === 'DELETE') {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected mock request: ${init.method ?? 'GET'} ${target}`);
  };

  const pdfPath = await renderPdfWithGraph({ sourcePath, outputDir: tempDir, env, fetchImpl });
  assert.equal((await readFile(pdfPath)).toString(), '%PDF-test');
  assert.deepEqual(ranges, [
    'bytes 0-327679/700000',
    'bytes 327680-655359/700000',
    'bytes 655360-699999/700000',
  ]);
  assert.equal(deleted, true, 'uploaded drive item must be deleted in finally');

  // 업로드 직후 PDF가 아직 준비되지 않은 404/423, throttling 429는 bounded retry한다.
  chunkIndex = 0;
  deleted = false;
  let conversionAttempt = 0;
  const waits = [];
  const retryingFetch = async (url, init = {}) => {
    if (String(url).includes('/content?format=pdf')) {
      conversionAttempt += 1;
      if (conversionAttempt === 1) return new Response('throttled', { status: 429, headers: { 'Retry-After': '1' } });
      if (conversionAttempt === 2) return new Response('locked', { status: 423 });
      return new Response(Buffer.from('%PDF-retried'), { status: 200 });
    }
    return fetchImpl(url, init);
  };
  const retriedPdf = await renderPdfWithGraph({
    sourcePath,
    outputDir: tempDir,
    env,
    fetchImpl: retryingFetch,
    sleepImpl: async (ms) => waits.push(ms),
  });
  assert.equal((await readFile(retriedPdf)).toString(), '%PDF-retried');
  assert.equal(conversionAttempt, 3);
  assert.deepEqual(waits, [1000, 500], 'Retry-After and bounded exponential delay must be honored');
  assert.equal(deleted, true);

  // PDF 변환이 실패해도 이미 업로드된 drive item은 finally에서 삭제되어야 한다.
  chunkIndex = 0;
  deleted = false;
  const failingFetch = async (url, init = {}) => {
    if (String(url).includes('/content?format=pdf')) return new Response('conversion failed', { status: 500 });
    return fetchImpl(url, init);
  };
  await assert.rejects(
    renderPdfWithGraph({ sourcePath, outputDir: tempDir, env, fetchImpl: failingFetch, sleepImpl: async () => {} }),
    /PowerPoint-to-PDF conversion failed \(500\)/,
  );
  assert.equal(deleted, true, 'drive item must also be deleted when PDF conversion fails');

  await assert.rejects(
    renderPdfWithGraph({ sourcePath, outputDir: tempDir, env: { ...env, MS_GRAPH_CLIENT_SECRET: '' }, fetchImpl }),
    /MS_GRAPH_CLIENT_SECRET is missing/,
  );

  // 개인 OneDrive는 delegated refresh token과 /me/drive 경로를 사용한다.
  chunkIndex = 0;
  deleted = false;
  let delegatedTokenBody = null;
  const refreshTokenFile = path.join(tempDir, 'persistent-token', 'refresh-token');
  const delegatedFetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/oauth2/v2.0/token')) {
      delegatedTokenBody = String(init.body);
      return new Response(JSON.stringify({ access_token: 'delegated-access', refresh_token: 'rotated-refresh' }), { status: 200 });
    }
    if (target.includes('/me/drive/root:') && target.endsWith('/createUploadSession')) {
      return new Response(JSON.stringify({ uploadUrl: 'https://upload.test/session' }), { status: 200 });
    }
    if (target === 'https://upload.test/session' && init.method === 'PUT') {
      chunkIndex += 1;
      return new Response(JSON.stringify(chunkIndex === 3 ? { id: 'item-test' } : { nextExpectedRanges: [] }), {
        status: chunkIndex === 3 ? 201 : 202,
      });
    }
    if (target.includes('/me/drive/items/item-test/content?format=pdf')) {
      return new Response(Buffer.from('%PDF-delegated'), { status: 200 });
    }
    if (target.endsWith('/me/drive/items/item-test') && init.method === 'DELETE') {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected delegated mock request: ${init.method ?? 'GET'} ${target}`);
  };
  const delegatedPdf = await renderPdfWithGraph({
    sourcePath,
    outputDir: tempDir,
    env: {
      MS_GRAPH_AUTH_MODE: 'refresh_token',
      MS_GRAPH_TENANT_ID: 'consumers',
      MS_GRAPH_CLIENT_ID: 'public-client-test',
      MS_GRAPH_REFRESH_TOKEN: 'refresh-test',
      MS_GRAPH_REFRESH_TOKEN_FILE: refreshTokenFile,
      MS_GRAPH_UPLOAD_CHUNK_BYTES: String(320 * 1024),
    },
    fetchImpl: delegatedFetch,
  });
  assert.equal((await readFile(delegatedPdf)).toString(), '%PDF-delegated');
  assert.match(delegatedTokenBody, /grant_type=refresh_token/);
  assert.match(delegatedTokenBody, /refresh_token=refresh-test/);
  assert.doesNotMatch(delegatedTokenBody, /client_secret=/);
  assert.equal(deleted, true);
  assert.equal((await readFile(refreshTokenFile, 'utf8')).trim(), 'rotated-refresh');
  assert.equal((await stat(refreshTokenFile)).mode & 0o777, 0o600, 'persisted refresh token must be owner-only');

  await assert.rejects(
    renderPdfWithGraph({
      sourcePath,
      outputDir: tempDir,
      env: {
        MS_GRAPH_AUTH_MODE: 'refresh_token',
        MS_GRAPH_CLIENT_ID: 'public-client-test',
        MS_GRAPH_REFRESH_TOKEN: '',
      },
      fetchImpl: delegatedFetch,
    }),
    /MS_GRAPH_REFRESH_TOKEN or MS_GRAPH_REFRESH_TOKEN_FILE is missing/,
  );

  assert.deepEqual(FIXED_CAPTURE_BOX, {
    xFrac: 0.036458,
    yFrac: 0.171296,
    wFrac: 0.606771,
    hFrac: 0.694444,
  });
  assert.deepEqual(boxCropRect(FIXED_CAPTURE_BOX), FIXED_CAPTURE_BOX, 'fixed capture crop must have zero padding');

  assert.equal(isHiddenSlideXml('<p:sld xmlns:p="x" show="0"><p:cSld/></p:sld>'), true);
  assert.equal(isHiddenSlideXml('<p:sld xmlns:p="x"><p:cSld/></p:sld>'), false);
  assert.deepEqual(
    mapRenderedPagesToSlides({ pageCount: 4, slideNumbers: [1, 2, 3, 4, 5], hiddenSlideNumbers: [3] }),
    [1, 2, 4, 5],
  );
  assert.deepEqual(
    mapRenderedPagesToSlides({ pageCount: 5, slideNumbers: [1, 2, 3, 4, 5], hiddenSlideNumbers: [3] }),
    [1, 2, 3, 4, 5],
  );
  assert.throws(
    () => mapRenderedPagesToSlides({ pageCount: 3, slideNumbers: [1, 2, 3, 4, 5], hiddenSlideNumbers: [3] }),
    /does not match PPT slide count 5 or visible slide count 4/,
  );

  console.log('Graph renderer unit passed: app/delegated auth, persistent token rotation, chunked upload, hidden-slide mapping, cleanup, fixed zero-padding crop.');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
