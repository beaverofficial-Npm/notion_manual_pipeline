import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const DELEGATED_GRAPH_SCOPE = 'offline_access Files.ReadWrite';
const CHUNK_UNIT = 320 * 1024;
const DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024; // 32 * 320 KiB
const rotatedRefreshTokens = new Map();

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is missing for Microsoft Graph rendering.`);
  return value;
}

export function graphConfig(env = process.env) {
  const chunkBytes = Number(env.MS_GRAPH_UPLOAD_CHUNK_BYTES ?? DEFAULT_CHUNK_BYTES);
  if (!Number.isInteger(chunkBytes) || chunkBytes < CHUNK_UNIT || chunkBytes % CHUNK_UNIT !== 0) {
    throw new Error('MS_GRAPH_UPLOAD_CHUNK_BYTES must be a positive multiple of 320 KiB.');
  }
  const authMode = (env.MS_GRAPH_AUTH_MODE ?? 'client_credentials').trim().toLowerCase();
  if (!['client_credentials', 'refresh_token'].includes(authMode)) {
    throw new Error('MS_GRAPH_AUTH_MODE must be client_credentials or refresh_token.');
  }
  const driveId = env.MS_GRAPH_DRIVE_ID?.trim() || null;
  if (authMode === 'client_credentials' && !driveId) {
    throw new Error('MS_GRAPH_DRIVE_ID is missing for MS_GRAPH_AUTH_MODE=client_credentials.');
  }
  const refreshToken = env.MS_GRAPH_REFRESH_TOKEN?.trim() || null;
  const refreshTokenFile = env.MS_GRAPH_REFRESH_TOKEN_FILE?.trim() || null;
  if (authMode === 'refresh_token' && !refreshToken && !refreshTokenFile) {
    throw new Error('MS_GRAPH_REFRESH_TOKEN or MS_GRAPH_REFRESH_TOKEN_FILE is missing for MS_GRAPH_AUTH_MODE=refresh_token.');
  }
  return {
    authMode,
    tenantId: authMode === 'refresh_token'
      ? (env.MS_GRAPH_TENANT_ID?.trim() || 'consumers')
      : required(env, 'MS_GRAPH_TENANT_ID'),
    clientId: required(env, 'MS_GRAPH_CLIENT_ID'),
    clientSecret: authMode === 'client_credentials'
      ? required(env, 'MS_GRAPH_CLIENT_SECRET')
      : (env.MS_GRAPH_CLIENT_SECRET?.trim() || null),
    refreshToken: authMode === 'refresh_token' ? refreshToken : null,
    refreshTokenFile: authMode === 'refresh_token' ? refreshTokenFile : null,
    delegatedScope: env.MS_GRAPH_DELEGATED_SCOPE?.trim() || DELEGATED_GRAPH_SCOPE,
    driveId,
    tempFolderId: env.MS_GRAPH_TEMP_FOLDER_ID?.trim() || null,
    chunkBytes,
  };
}

async function readPersistedRefreshToken(filePath) {
  if (!filePath) return null;
  try {
    return (await readFile(filePath, 'utf8')).trim() || null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Could not read MS_GRAPH_REFRESH_TOKEN_FILE: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function persistRefreshToken(filePath, refreshToken) {
  if (!filePath) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${refreshToken}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    throw new Error(`Could not persist rotated Microsoft Graph refresh token: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function errorText(response) {
  const body = await response.text().catch(() => '');
  return body.replace(/\s+/g, ' ').slice(0, 1000);
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000);
    const dateMs = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateMs) && dateMs > 0) return Math.min(dateMs, 5000);
  }
  const graphDelayHeader = response.headers.get('x-ms-retry-after-ms');
  if (graphDelayHeader !== null) {
    const graphDelay = Number(graphDelayHeader);
    if (Number.isFinite(graphDelay) && graphDelay >= 0) return Math.min(graphDelay, 5000);
  }
  return Math.min(250 * 2 ** attempt, 5000);
}

function isTransient(status) {
  return status === 404 || status === 408 || status === 423 || status === 429 || status >= 500;
}

async function request(fetchImpl, url, init, label, accepted = null, runtime = {}) {
  const maxAttempts = runtime.maxAttempts ?? 4;
  const sleepImpl = runtime.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastResponse = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      if (accepted ? accepted.includes(response.status) : response.ok) return response;
      lastResponse = response;
      if (!isTransient(response.status) || attempt === maxAttempts - 1) break;
      await sleepImpl(retryDelayMs(response, attempt));
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      await sleepImpl(Math.min(250 * 2 ** attempt, 5000));
    }
  }
  throw new Error(`${label} failed (${lastResponse?.status ?? 'network'}): ${lastResponse ? await errorText(lastResponse) : 'request failed'}`);
}

async function accessToken(config, fetchImpl, runtime) {
  const body = new URLSearchParams({ client_id: config.clientId });
  if (config.authMode === 'refresh_token') {
    const cacheKey = `${config.tenantId}:${config.clientId}`;
    const refreshToken = await readPersistedRefreshToken(config.refreshTokenFile)
      ?? rotatedRefreshTokens.get(cacheKey)
      ?? config.refreshToken;
    if (!refreshToken) {
      throw new Error('Microsoft Graph refresh token is unavailable. Seed MS_GRAPH_REFRESH_TOKEN or its persistent file.');
    }
    body.set('refresh_token', refreshToken);
    body.set('scope', config.delegatedScope);
    body.set('grant_type', 'refresh_token');
    if (config.clientSecret) body.set('client_secret', config.clientSecret);
  } else {
    body.set('client_secret', config.clientSecret);
    body.set('scope', GRAPH_SCOPE);
    body.set('grant_type', 'client_credentials');
  }
  const response = await request(
    fetchImpl,
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
    'Microsoft Graph token request',
    null,
    runtime,
  );
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Microsoft Graph token response did not include access_token.');
  if (config.authMode === 'refresh_token' && payload.refresh_token) {
    await persistRefreshToken(config.refreshTokenFile, payload.refresh_token);
    rotatedRefreshTokens.set(`${config.tenantId}:${config.clientId}`, payload.refresh_token);
  }
  return payload.access_token;
}

function driveBaseUrl(config) {
  if (config.driveId) return `${GRAPH_BASE}/drives/${encodeURIComponent(config.driveId)}`;
  if (config.authMode === 'refresh_token') return `${GRAPH_BASE}/me/drive`;
  throw new Error('Microsoft Graph drive target is unavailable.');
}

function uploadSessionUrl(config, remoteName) {
  const file = encodeURIComponent(remoteName);
  const drive = driveBaseUrl(config);
  if (config.tempFolderId) {
    return `${drive}/items/${encodeURIComponent(config.tempFolderId)}:/${file}:/createUploadSession`;
  }
  return `${drive}/root:/${file}:/createUploadSession`;
}

async function createUploadSession(config, token, remoteName, fetchImpl, runtime) {
  const response = await request(
    fetchImpl,
    uploadSessionUrl(config, remoteName),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail', name: remoteName } }),
    },
    'Microsoft Graph upload session creation',
    null,
    runtime,
  );
  const payload = await response.json();
  if (!payload.uploadUrl) throw new Error('Microsoft Graph upload session did not include uploadUrl.');
  return payload.uploadUrl;
}

async function uploadFile(uploadUrl, sourcePath, fileSize, chunkBytes, fetchImpl, runtime) {
  const handle = await open(sourcePath, 'r');
  try {
    let remoteItem = null;
    for (let start = 0; start < fileSize; start += chunkBytes) {
      const length = Math.min(chunkBytes, fileSize - start);
      const bytes = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(bytes, 0, length, start);
      if (bytesRead !== length) throw new Error(`Could not read upload chunk at byte ${start}.`);
      const response = await request(
        fetchImpl,
        uploadUrl,
        {
          method: 'PUT',
          headers: {
            'Content-Length': String(length),
            'Content-Range': `bytes ${start}-${start + length - 1}/${fileSize}`,
          },
          body: bytes,
        },
        `Microsoft Graph upload chunk ${start}-${start + length - 1}`,
        [200, 201, 202],
        runtime,
      );
      const payload = await response.json();
      if (response.status === 200 || response.status === 201) remoteItem = payload;
    }
    if (!remoteItem?.id) throw new Error('Microsoft Graph upload completed without a drive item id.');
    return remoteItem;
  } finally {
    await handle.close();
  }
}

async function downloadPdf(config, token, itemId, pdfPath, fetchImpl, runtime) {
  const item = encodeURIComponent(itemId);
  const response = await request(
    fetchImpl,
    `${driveBaseUrl(config)}/items/${item}/content?format=pdf`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' },
    'Microsoft Graph PowerPoint-to-PDF conversion',
    null,
    runtime,
  );
  if (!response.body) throw new Error('Microsoft Graph PDF response body was empty.');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(pdfPath));
}

async function deleteDriveItem(config, token, itemId, fetchImpl, runtime) {
  const item = encodeURIComponent(itemId);
  await request(
    fetchImpl,
    `${driveBaseUrl(config)}/items/${item}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    'Microsoft Graph temporary item deletion',
    [204],
    runtime,
  );
}

/**
 * Microsoft 365의 PowerPoint renderer로 PPT/PPTX를 PDF로 변환한다.
 * 업로드된 임시 drive item은 성공/실패와 무관하게 삭제를 시도한다.
 * 다른 renderer fallback 없이 Microsoft PowerPoint 결과만 사용한다.
 */
export async function renderPdfWithGraph({
  sourcePath,
  outputDir,
  env = process.env,
  fetchImpl = fetch,
  sleepImpl,
  maxAttempts,
}) {
  const config = graphConfig(env);
  const runtime = { sleepImpl, maxAttempts };
  const statHandle = await open(sourcePath, 'r');
  const { size } = await statHandle.stat();
  await statHandle.close();
  if (size <= 0) throw new Error('Cannot upload an empty presentation to Microsoft Graph.');

  const extension = ['.ppt', '.pptx'].includes(path.extname(sourcePath).toLowerCase())
    ? path.extname(sourcePath).toLowerCase()
    : '.pptx';
  const remoteName = `manual-${Date.now()}-${randomUUID()}${extension}`;
  const pdfPath = path.join(outputDir, 'graph-rendered.pdf');
  const token = await accessToken(config, fetchImpl, runtime);
  let itemId = null;
  let uploadUrl = null;

  try {
    uploadUrl = await createUploadSession(config, token, remoteName, fetchImpl, runtime);
    const item = await uploadFile(uploadUrl, sourcePath, size, config.chunkBytes, fetchImpl, runtime);
    itemId = item.id;
    await downloadPdf(config, token, itemId, pdfPath, fetchImpl, runtime);
    return pdfPath;
  } finally {
    if (itemId) {
      try {
        await deleteDriveItem(config, token, itemId, fetchImpl, runtime);
      } catch (error) {
        console.warn('[graph-renderer] temporary item cleanup failed:', error instanceof Error ? error.message : String(error));
      }
    } else if (uploadUrl) {
      // 업로드 중간 실패 시 세션 자체를 취소한다. uploadUrl은 사전 인증 URL이므로 Authorization을 붙이지 않는다.
      try {
        await fetchImpl(uploadUrl, { method: 'DELETE' });
      } catch {
        // 원래 변환 오류를 보존한다.
      }
    }
  }
}
