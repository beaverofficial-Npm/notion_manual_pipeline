import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { FIXED_CAPTURE_BOX } from '../worker/group-bake.mjs';
import { classifyRole, parseSlideShapes } from '../worker/ppt-parse.mjs';
import { isHiddenSlideXml } from '../worker/slide-visibility.mjs';
import { downloadSource } from '../worker/source-storage.mjs';

const execFileAsync = promisify(execFile);
const PPTX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const VARIANTS = new Set([
  'baseline',
  'same_name_same_bytes',
  'same_name_modified',
  'different_name_same_bytes',
  'different_name_modified',
  'same_size_modified',
]);
const SHA256_RE = /^[a-f0-9]{64}$/;
const expectedCaptureSlidesByDeck = new Map();

class HarnessError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.details = details;
  }
}

function usage() {
  return `사용법:
  node --env-file=.env.local scripts/test/e2e-pipeline-revisions.mjs --manifest <cases.json> [--report <report.json>] [--decks deck-1,deck-3] [--resume] [--rerun-decks deck-3]
  node scripts/test/e2e-pipeline-revisions.mjs --self-test

manifest 형식:
{
  "expectedRenderProvider": "microsoft_graph",
  "cases": [
    {
      "id": "deck-a-baseline",
      "filePath": "/absolute/path/deck-a.pptx",
      "logicalDeck": "deck-a",
      "variant": "baseline",
      "expectedSourceSha256": "<64 lowercase hex>",
      "expectedFileSize": 123456,
      "changedSlides": []
    }
  ]
}

환경변수:
  BASE_URL=http://localhost:3100
  E2E_PIPELINE_TIMEOUT_MS=1800000
  E2E_POLL_INTERVAL_MS=3000
  E2E_REQUEST_TIMEOUT_MS=120000
  E2E_UPLOAD_TIMEOUT_MS=900000
  E2E_ASSET_CONCURRENCY=4
  E2E_EXPECTED_RENDER_PROVIDER=microsoft_graph
`;
}

function parseArgs(argv) {
  const out = {
    manifestPath: null,
    reportPath: null,
    decks: null,
    rerunDecks: null,
    resume: false,
    selfTest: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') out.manifestPath = argv[++index] ?? null;
    else if (arg === '--report') out.reportPath = argv[++index] ?? null;
    else if (arg === '--decks') out.decks = new Set((argv[++index] ?? '').split(',').map((value) => value.trim()).filter(Boolean));
    else if (arg === '--rerun-decks') out.rerunDecks = new Set((argv[++index] ?? '').split(',').map((value) => value.trim()).filter(Boolean));
    else if (arg === '--resume') out.resume = true;
    else if (arg === '--self-test') out.selfTest = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new HarnessError('CLI_UNKNOWN_ARGUMENT', `알 수 없는 인자입니다: ${arg}`);
  }
  return out;
}

function positiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function expectedCaptureSlides(item) {
  if (expectedCaptureSlidesByDeck.has(item.logicalDeck)) return expectedCaptureSlidesByDeck.get(item.logicalDeck);
  const unzip = async (entry) => (await execFileAsync('unzip', ['-p', item.filePath, entry], { maxBuffer: 64 * 1024 * 1024 })).stdout;
  const presentation = await unzip('ppt/presentation.xml');
  const slideSize = {
    cx: Number(presentation.match(/<p:sldSz[^>]*cx="(\d+)"/)?.[1]),
    cy: Number(presentation.match(/<p:sldSz[^>]*cy="(\d+)"/)?.[1]),
  };
  const listing = (await execFileAsync('unzip', ['-l', item.filePath, 'ppt/slides/slide*.xml'], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  const entries = listing
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((left, right) => Number(left.match(/slide(\d+)/)[1]) - Number(right.match(/slide(\d+)/)[1]));
  const eligible = [];
  for (const entry of entries) {
    const slideNumber = Number(entry.match(/slide(\d+)/)[1]);
    const slideXml = await unzip(entry);
    if (isHiddenSlideXml(slideXml)) continue;
    const parsed = parseSlideShapes(slideXml, slideSize);
    // group_bake의 캡처 여부는 OOXML 이미지 탐지 결과와 무관하다. 이미지 교체/재그룹화로
    // pic 관계가 달라져도 모든 content slide가 동일한 고정 박스로 캡처돼야 한다.
    if (classifyRole(parsed, slideNumber) === 'content') eligible.push(slideNumber);
  }
  expectedCaptureSlidesByDeck.set(item.logicalDeck, eligible);
  return eligible;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => Number(a) - Number(b)));
}

function valuesEqual(left, right) {
  return sameJson(sortedObject(left), sortedObject(right));
}

function normalizeProvider(value) {
  const provider = String(value ?? '').trim().toLowerCase();
  return provider === 'graph' ? 'microsoft_graph' : provider;
}

function check(condition, code, message, details = undefined) {
  if (!condition) throw new HarnessError(code, message, details);
}

function normalizeManifest(raw, manifestPath) {
  const document = Array.isArray(raw) ? { cases: raw } : raw;
  check(document && typeof document === 'object', 'MANIFEST_INVALID', 'manifest 최상위는 객체 또는 cases 배열이어야 합니다.');
  check(Array.isArray(document.cases) && document.cases.length > 0, 'MANIFEST_CASES_EMPTY', 'manifest cases가 비어 있습니다.');

  const manifestDirectory = path.dirname(manifestPath);
  const expectedRenderProvider = normalizeProvider(
    document.expectedRenderProvider ?? process.env.E2E_EXPECTED_RENDER_PROVIDER ?? 'microsoft_graph',
  );
  check(expectedRenderProvider === 'microsoft_graph', 'MANIFEST_PROVIDER_INVALID', 'Microsoft Graph renderer만 지원합니다.');

  const cases = document.cases.map((item, index) => {
    check(item && typeof item === 'object', 'MANIFEST_CASE_INVALID', `cases[${index}]가 객체가 아닙니다.`);
    const logicalDeck = String(item.logicalDeck ?? '').trim();
    const variant = String(item.variant ?? '').trim();
    const suppliedPath = String(item.filePath ?? '').trim();
    const expectedSourceSha256 = String(item.expectedSourceSha256 ?? '').trim().toLowerCase();
    const expectedFileSize = Number(item.expectedFileSize);
    const changedSlides = [...new Set((item.changedSlides ?? []).map(Number))].sort((a, b) => a - b);

    check(logicalDeck, 'MANIFEST_LOGICAL_DECK_MISSING', `cases[${index}].logicalDeck가 비어 있습니다.`);
    check(VARIANTS.has(variant), 'MANIFEST_VARIANT_INVALID', `cases[${index}].variant가 올바르지 않습니다: ${variant}`);
    check(suppliedPath, 'MANIFEST_FILE_PATH_MISSING', `cases[${index}].filePath가 비어 있습니다.`);
    check(SHA256_RE.test(expectedSourceSha256), 'MANIFEST_SHA_INVALID', `cases[${index}].expectedSourceSha256가 SHA-256 형식이 아닙니다.`);
    check(Number.isSafeInteger(expectedFileSize) && expectedFileSize > 0, 'MANIFEST_SIZE_INVALID', `cases[${index}].expectedFileSize가 올바르지 않습니다.`);
    check(
      changedSlides.every((slide) => Number.isInteger(slide) && slide > 0),
      'MANIFEST_CHANGED_SLIDES_INVALID',
      `cases[${index}].changedSlides는 양의 정수 배열이어야 합니다.`,
    );
    if (variant !== 'baseline') {
      check(
        changedSlides.length > 0 || ['same_name_same_bytes', 'different_name_same_bytes'].includes(variant),
        'MANIFEST_CHANGED_SLIDES_EMPTY',
        `${variant}에는 changedSlides가 필요합니다.`,
      );
    }

    return {
      id: String(item.id ?? `${logicalDeck}-${variant}-${index + 1}`).trim(),
      filePath: path.isAbsolute(suppliedPath) ? suppliedPath : path.resolve(manifestDirectory, suppliedPath),
      logicalDeck,
      variant,
      expectedSourceSha256,
      expectedFileSize,
      changedSlides,
    };
  });

  const ids = cases.map((item) => item.id);
  check(new Set(ids).size === ids.length, 'MANIFEST_DUPLICATE_CASE_ID', 'case id가 중복됩니다.');
  for (const logicalDeck of new Set(cases.map((item) => item.logicalDeck))) {
    const baselines = cases.filter((item) => item.logicalDeck === logicalDeck && item.variant === 'baseline');
    check(baselines.length === 1, 'MANIFEST_BASELINE_COUNT', `${logicalDeck}에는 baseline이 정확히 1개여야 합니다.`, {
      count: baselines.length,
    });
  }

  return { expectedRenderProvider, cases };
}

async function preflightCases(cases) {
  for (const item of cases) {
    const info = await stat(item.filePath).catch(() => null);
    check(info?.isFile(), 'FIXTURE_NOT_FOUND', `fixture 파일을 찾지 못했습니다: ${item.filePath}`, { caseId: item.id });
    check(/\.pptx?$/i.test(item.filePath), 'FIXTURE_EXTENSION_INVALID', `PPT/PPTX 파일이 아닙니다: ${item.filePath}`, { caseId: item.id });
    check(info.size === item.expectedFileSize, 'FIXTURE_SIZE_MISMATCH', `${item.id} fixture 크기가 manifest와 다릅니다.`, {
      expected: item.expectedFileSize,
      actual: info.size,
    });
    const actualSha256 = await sha256File(item.filePath);
    check(actualSha256 === item.expectedSourceSha256, 'FIXTURE_SHA_MISMATCH', `${item.id} fixture SHA-256이 manifest와 다릅니다.`, {
      expected: item.expectedSourceSha256,
      actual: actualSha256,
    });
  }

  for (const logicalDeck of new Set(cases.map((item) => item.logicalDeck))) {
    const deckCases = cases.filter((item) => item.logicalDeck === logicalDeck);
    const baseline = deckCases.find((item) => item.variant === 'baseline');
    for (const candidate of deckCases.filter((item) => item !== baseline)) {
      if (candidate.variant === 'same_name_same_bytes') {
        check(candidate.expectedSourceSha256 === baseline.expectedSourceSha256, 'FIXTURE_SAME_BYTES_SHA_MISMATCH', `${candidate.id}는 baseline과 동일 바이트여야 합니다.`);
        check(candidate.expectedFileSize === baseline.expectedFileSize, 'FIXTURE_SAME_BYTES_SIZE_MISMATCH', `${candidate.id}는 baseline과 동일 크기여야 합니다.`);
        check(path.basename(candidate.filePath) === path.basename(baseline.filePath), 'FIXTURE_SAME_NAME_REQUIRED', `${candidate.id}는 baseline과 동일한 파일명이어야 합니다.`);
      } else if (candidate.variant === 'different_name_same_bytes') {
        check(candidate.expectedSourceSha256 === baseline.expectedSourceSha256, 'FIXTURE_SAME_BYTES_SHA_MISMATCH', `${candidate.id}는 baseline과 동일 바이트여야 합니다.`);
        check(candidate.expectedFileSize === baseline.expectedFileSize, 'FIXTURE_SAME_BYTES_SIZE_MISMATCH', `${candidate.id}는 baseline과 동일 크기여야 합니다.`);
        check(path.basename(candidate.filePath) !== path.basename(baseline.filePath), 'FIXTURE_DIFFERENT_NAME_REQUIRED', `${candidate.id}는 baseline과 다른 파일명이어야 합니다.`);
      } else if (candidate.variant === 'same_name_modified') {
        check(candidate.expectedSourceSha256 !== baseline.expectedSourceSha256, 'FIXTURE_MODIFIED_SHA_REQUIRED', `${candidate.id} 수정본 SHA가 baseline과 달라야 합니다.`);
        check(path.basename(candidate.filePath) === path.basename(baseline.filePath), 'FIXTURE_SAME_NAME_REQUIRED', `${candidate.id}는 baseline과 동일한 파일명이어야 합니다.`);
      } else if (candidate.variant === 'different_name_modified') {
        check(candidate.expectedSourceSha256 !== baseline.expectedSourceSha256, 'FIXTURE_MODIFIED_SHA_REQUIRED', `${candidate.id} 수정본 SHA가 baseline과 달라야 합니다.`);
        check(path.basename(candidate.filePath) !== path.basename(baseline.filePath), 'FIXTURE_DIFFERENT_NAME_REQUIRED', `${candidate.id}는 baseline과 다른 파일명이어야 합니다.`);
      } else if (candidate.variant === 'same_size_modified') {
        check(candidate.expectedSourceSha256 !== baseline.expectedSourceSha256, 'FIXTURE_MODIFIED_SHA_REQUIRED', `${candidate.id} 수정본 SHA가 baseline과 달라야 합니다.`);
        check(candidate.expectedFileSize === baseline.expectedFileSize, 'FIXTURE_SAME_SIZE_REQUIRED', `${candidate.id}는 baseline과 동일 크기여야 합니다.`);
      }
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new HarnessError('ENV_MISSING', `${name} 환경변수가 필요합니다.`);
  return value;
}

async function responseText(response) {
  return (await response.text().catch(() => '')).slice(0, 2000);
}

async function requestJson(url, options, label, timeoutMs) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new HarnessError('HTTP_REQUEST_FAILED', `${label} 실패: HTTP ${response.status}`, {
      status: response.status,
      body: await responseText(response),
    });
  }
  return response.json();
}

function apiUrl(baseUrl, route) {
  return new URL(route, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

async function uploadAndRun(item, settings) {
  const fileBytes = await readFile(item.filePath);
  const fileName = path.basename(item.filePath);
  const created = await requestJson(
    apiUrl(settings.baseUrl, '/api/tasks'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, fileSize: fileBytes.length }),
    },
    `${item.id} task 생성`,
    settings.requestTimeoutMs,
  );
  const taskId = created?.project?.id;
  check(typeof taskId === 'string' && taskId, 'TASK_ID_MISSING', `${item.id} task 생성 응답에 project.id가 없습니다.`);
  check(typeof created.uploadUrl === 'string' && created.uploadUrl, 'UPLOAD_URL_MISSING', `${item.id} task 생성 응답에 uploadUrl이 없습니다.`);

  const uploadResponse = await fetch(created.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': created.contentType ?? PPTX_CONTENT_TYPE },
    body: fileBytes,
    signal: AbortSignal.timeout(settings.uploadTimeoutMs),
  });
  if (!uploadResponse.ok) {
    throw new HarnessError('SOURCE_UPLOAD_FAILED', `${item.id} 원본 업로드 실패: HTTP ${uploadResponse.status}`, {
      caseId: item.id,
      taskId,
      status: uploadResponse.status,
      body: await responseText(uploadResponse),
    });
  }

  const run = await requestJson(
    apiUrl(settings.baseUrl, `/api/tasks/${taskId}/run`),
    { method: 'POST' },
    `${item.id} 변환 시작`,
    settings.requestTimeoutMs,
  );
  const jobId = run?.job?.id;
  check(typeof jobId === 'string' && jobId, 'JOB_ID_MISSING', `${item.id} 변환 시작 응답에 job.id가 없습니다.`, { taskId });
  return { taskId, jobId, uploadFileName: fileName };
}

async function pollUntilComplete(item, taskId, jobId, settings) {
  const deadline = Date.now() + settings.pipelineTimeoutMs;
  const history = [];
  let previous = '';
  while (Date.now() < deadline) {
    const status = await requestJson(
      apiUrl(settings.baseUrl, `/api/tasks/${taskId}`),
      { method: 'GET' },
      `${item.id} 상태 조회`,
      settings.requestTimeoutMs,
    );
    const state = `${status.taskStatus ?? 'null'}/${status.jobStatus ?? 'null'}/${status.slideCount ?? 0}`;
    if (state !== previous) {
      history.push({ at: new Date().toISOString(), taskStatus: status.taskStatus, jobStatus: status.jobStatus, slideCount: status.slideCount });
      previous = state;
    }
    if (status.jobStatus === 'failed' || status.taskStatus === 'failed') {
      throw new HarnessError('CONVERSION_FAILED', `${item.id} 변환이 실패했습니다: ${status.jobError ?? 'unknown error'}`, {
        taskId,
        jobId,
        history,
      });
    }
    if (status.jobStatus === 'succeeded' && status.taskStatus === 'review_required') return history;
    await new Promise((resolve) => setTimeout(resolve, settings.pollIntervalMs));
  }
  throw new HarnessError('CONVERSION_TIMEOUT', `${item.id} 변환이 제한 시간 안에 끝나지 않았습니다.`, {
    taskId,
    jobId,
    timeoutMs: settings.pipelineTimeoutMs,
    history,
  });
}

function throwOnQueryError(error, label) {
  if (error) throw new HarnessError('DB_QUERY_FAILED', `${label}: ${error.message}`);
}

async function selectAssetsInChunks(supabase, slideIds) {
  const rows = [];
  for (let index = 0; index < slideIds.length; index += 40) {
    const { data, error } = await supabase
      .from('manual_assets')
      .select('id,slide_id,job_id,kind,storage_path')
      .in('slide_id', slideIds.slice(index, index + 40))
      .order('created_at');
    throwOnQueryError(error, 'manual_assets 조회 실패');
    rows.push(...(data ?? []));
  }
  return rows;
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function cropBorderMetrics(bytes) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const colorBuckets = new Map();
  for (let x = 0; x < info.width; x += 1) {
    const offset = x * info.channels;
    const key = `${data[offset] >> 4},${data[offset + 1] >> 4},${data[offset + 2] >> 4}`;
    colorBuckets.set(key, (colorBuckets.get(key) ?? 0) + 1);
  }
  const dominantTopEdgePixels = Math.max(...colorBuckets.values());
  return {
    width: info.width,
    height: info.height,
    // 템플릿마다 경계선 색은 연회색·흰색·진회색으로 다르다. 특정 RGB 대신
    // 첫 행의 지배 색상 비율로 상단 경계선이 온전히 포함됐는지 검사한다.
    topBorderRatio: Number((dominantTopEdgePixels / info.width).toFixed(6)),
  };
}

async function visualSha256(bytes) {
  const normalized = await sharp(bytes)
    .resize(32, 32, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
  for (let index = 0; index < normalized.length; index += 1) normalized[index] >>= 4;
  return sha256Buffer(normalized);
}

async function collectEvidence(item, identifiers, settings, supabase) {
  const { data: source, error: sourceError } = await supabase
    .from('manual_source_files')
    .select('id,task_id,file_name,storage_path,file_size,checksum,created_at')
    .eq('task_id', identifiers.taskId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  throwOnQueryError(sourceError, `${item.id} manual_source_files 조회 실패`);

  const { data: job, error: jobError } = await supabase
    .from('manual_conversion_jobs')
    .select('id,task_id,source_file_id,run_number,status,manifest_path')
    .eq('id', identifiers.jobId)
    .single();
  throwOnQueryError(jobError, `${item.id} manual_conversion_jobs 조회 실패`);

  const { data: slides, error: slidesError } = await supabase
    .from('manual_slides')
    .select('id,job_id,slide_number,render_path')
    .eq('task_id', identifiers.taskId)
    .order('slide_number');
  throwOnQueryError(slidesError, `${item.id} manual_slides 조회 실패`);
  check((slides ?? []).length > 0, 'SLIDES_EMPTY', `${item.id} 변환 결과 슬라이드가 없습니다.`);

  const slideRows = slides ?? [];
  const slideNumberById = new Map(slideRows.map((slide) => [slide.id, slide.slide_number]));
  const assets = await selectAssetsInChunks(supabase, slideRows.map((slide) => slide.id));
  const expectedAssetSlides = await expectedCaptureSlides(item);
  const actualAssetSlides = [...new Set(assets.map((asset) => slideNumberById.get(asset.slide_id)))].sort((a, b) => a - b);
  const runPrefix = `${identifiers.taskId}/runs/${job.run_number}/`;

  check(job.status === 'succeeded', 'JOB_STATUS_INVALID', `${item.id} DB job status가 succeeded가 아닙니다.`, { actual: job.status });
  check(job.task_id === identifiers.taskId, 'JOB_TASK_MISMATCH', `${item.id} job.task_id가 API task와 다릅니다.`);
  check(job.source_file_id === source.id, 'JOB_SOURCE_MISMATCH', `${item.id} job이 최신 source를 가리키지 않습니다.`);
  check(source.checksum === item.expectedSourceSha256, 'DB_SOURCE_SHA_MISMATCH', `${item.id} DB source checksum이 expected와 다릅니다.`, {
    expected: item.expectedSourceSha256,
    actual: source.checksum,
  });
  check(Number(source.file_size) === item.expectedFileSize, 'DB_SOURCE_SIZE_MISMATCH', `${item.id} DB source file_size가 expected와 다릅니다.`, {
    expected: item.expectedFileSize,
    actual: source.file_size,
  });
  check(slideRows.every((slide) => slide.job_id === job.id), 'SLIDE_JOB_MISMATCH', `${item.id} 현재 슬라이드 중 다른 job 결과가 섞였습니다.`);
  check(slideRows.every((slide) => slide.render_path?.startsWith(runPrefix)), 'SLIDE_PREFIX_MISMATCH', `${item.id} render_path가 현재 run prefix 밖을 가리킵니다.`, { runPrefix });
  check(assets.length > 0, 'ASSETS_EMPTY', `${item.id} 고정 캡처 asset이 하나도 없습니다.`);
  check(sameJson(actualAssetSlides, expectedAssetSlides), 'ASSET_SLIDE_COVERAGE_MISMATCH', `${item.id} 표준 이미지 박스가 있는 슬라이드와 생성된 asset 슬라이드가 일치하지 않습니다.`, {
    missing: expectedAssetSlides.filter((slideNumber) => !actualAssetSlides.includes(slideNumber)),
    unexpected: actualAssetSlides.filter((slideNumber) => !expectedAssetSlides.includes(slideNumber)),
  });
  check(assets.every((asset) => asset.job_id === job.id), 'ASSET_JOB_MISMATCH', `${item.id} 현재 asset 중 다른 job 결과가 섞였습니다.`);
  check(
    assets.every((asset) => asset.kind === 'group_bake' && asset.storage_path?.startsWith(runPrefix)),
    'ASSET_CAPTURE_CONTRACT_MISMATCH',
    `${item.id} asset이 group_bake/current run prefix 계약을 위반했습니다.`,
    { runPrefix },
  );

  check(job.manifest_path?.startsWith(runPrefix), 'MANIFEST_PREFIX_MISMATCH', `${item.id} manifest_path가 현재 run prefix 밖을 가리킵니다.`, {
    runPrefix,
    manifestPath: job.manifest_path,
  });
  const manifestBytes = await downloadSource(job.manifest_path);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  check(manifest.jobId === job.id, 'MANIFEST_JOB_MISMATCH', `${item.id} manifest.jobId가 DB job과 다릅니다.`);
  check(manifest.taskId === identifiers.taskId, 'MANIFEST_TASK_MISMATCH', `${item.id} manifest.taskId가 API task와 다릅니다.`);
  check(manifest.runNumber === job.run_number, 'MANIFEST_RUN_MISMATCH', `${item.id} manifest.runNumber가 DB run과 다릅니다.`);
  check(manifest.sourceFileName === source.file_name, 'MANIFEST_SOURCE_NAME_MISMATCH', `${item.id} manifest sourceFileName이 DB와 다릅니다.`);
  check(manifest.provenance?.sourceSha256 === item.expectedSourceSha256, 'MANIFEST_SOURCE_SHA_MISMATCH', `${item.id} manifest sourceSha256가 expected와 다릅니다.`);
  check(
    normalizeProvider(manifest.provenance?.renderProvider) === settings.expectedRenderProvider,
    'MANIFEST_PROVIDER_MISMATCH',
    `${item.id} render provider가 기대값과 다릅니다.`,
    { expected: settings.expectedRenderProvider, actual: manifest.provenance?.renderProvider },
  );
  check(sameJson(manifest.provenance?.captureBox, FIXED_CAPTURE_BOX), 'MANIFEST_CAPTURE_BOX_MISMATCH', `${item.id} captureBox가 고정 좌표와 다릅니다.`, {
    expected: FIXED_CAPTURE_BOX,
    actual: manifest.provenance?.captureBox,
  });
  check(manifest.provenance?.cropPadding === 0, 'MANIFEST_CROP_PADDING_MISMATCH', `${item.id} cropPadding이 0이 아닙니다.`, {
    actual: manifest.provenance?.cropPadding,
  });

  const hashedAssets = await mapLimit(assets, settings.assetConcurrency, async (asset) => {
    const bytes = await downloadSource(asset.storage_path);
    check(bytes.length > 0, 'ASSET_BYTES_EMPTY', `${item.id} asset bytes가 비어 있습니다.`, { storagePath: asset.storage_path });
    const crop = await cropBorderMetrics(bytes);
    return {
      id: asset.id,
      slideNumber: slideNumberById.get(asset.slide_id),
      storagePath: asset.storage_path,
      byteLength: bytes.length,
      sha256: sha256Buffer(bytes),
      visualSha256: await visualSha256(bytes),
      crop,
    };
  });
  const cropDimensions = [...new Set(hashedAssets.map((asset) => `${asset.crop.width}x${asset.crop.height}`))];
  check(cropDimensions.length === 1, 'CROP_DIMENSIONS_INCONSISTENT', `${item.id} 고정 크롭 이미지 크기가 서로 다릅니다.`, {
    dimensions: cropDimensions,
  });
  const assetSha256BySlide = {};
  const assetVisualSha256BySlide = {};
  for (const asset of hashedAssets) {
    const key = String(asset.slideNumber);
    (assetSha256BySlide[key] ??= []).push(asset.sha256);
    (assetVisualSha256BySlide[key] ??= []).push(asset.visualSha256);
  }
  for (const hashes of Object.values(assetSha256BySlide)) hashes.sort();
  for (const hashes of Object.values(assetVisualSha256BySlide)) hashes.sort();

  const renderedSlideSha256 = sortedObject(manifest.provenance?.renderedSlideSha256 ?? {});
  check(Object.keys(renderedSlideSha256).length === slideRows.length, 'MANIFEST_SLIDE_SHA_COUNT_MISMATCH', `${item.id} rendered slide SHA 개수가 DB slide 수와 다릅니다.`, {
    manifest: Object.keys(renderedSlideSha256).length,
    database: slideRows.length,
  });
  check(Object.values(renderedSlideSha256).every((value) => SHA256_RE.test(value)), 'MANIFEST_SLIDE_SHA_INVALID', `${item.id} rendered slide SHA 형식이 잘못되었습니다.`);

  const outputSha256BySlide = {};
  for (const [slideNumber, renderSha] of Object.entries(renderedSlideSha256)) {
    const assetHashes = assetSha256BySlide[slideNumber];
    outputSha256BySlide[slideNumber] = assetHashes?.length
      ? assetHashes.length === 1
        ? assetHashes[0]
        : sha256Buffer(Buffer.from(JSON.stringify(assetHashes)))
      : renderSha;
  }

  return {
    caseId: item.id,
    logicalDeck: item.logicalDeck,
    variant: item.variant,
    changedSlides: item.changedSlides,
    uploadFileName: identifiers.uploadFileName,
    taskId: identifiers.taskId,
    jobId: identifiers.jobId,
    runNumber: job.run_number,
    source: {
      id: source.id,
      fileName: source.file_name,
      storagePath: source.storage_path,
      fileSize: Number(source.file_size),
      sha256: source.checksum,
    },
    runPrefix,
    manifestPath: job.manifest_path,
    manifestSha256: sha256Buffer(manifestBytes),
    renderProvider: normalizeProvider(manifest.provenance.renderProvider),
    captureBox: manifest.provenance.captureBox,
    cropPadding: manifest.provenance.cropPadding,
    cropGate: {
      dimensions: cropDimensions[0],
      minTopEdgeDominantRatio: Math.min(...hashedAssets.map((asset) => asset.crop.topBorderRatio)),
      checkedAssets: hashedAssets.length,
      expectedAssetSlides: expectedAssetSlides.length,
      passed: true,
    },
    renderedSlideSha256,
    assetSha256BySlide: sortedObject(assetSha256BySlide),
    assetVisualSha256BySlide: sortedObject(assetVisualSha256BySlide),
    outputSha256BySlide: sortedObject(outputSha256BySlide),
    assets: hashedAssets.sort((a, b) => a.slideNumber - b.slideNumber || a.storagePath.localeCompare(b.storagePath)),
    renderPaths: slideRows.map((slide) => slide.render_path),
  };
}

function pushComparison(checks, condition, code, message, details = undefined) {
  checks.push({ pass: Boolean(condition), code, message, ...(details === undefined ? {} : { details }) });
}

function compareSlideSet(checks, baseline, candidate) {
  const baselineSlides = Object.keys(baseline.outputSha256BySlide).sort((a, b) => Number(a) - Number(b));
  const candidateSlides = Object.keys(candidate.outputSha256BySlide).sort((a, b) => Number(a) - Number(b));
  pushComparison(
    checks,
    sameJson(baselineSlides, candidateSlides),
    'OUTPUT_SLIDE_SET_MISMATCH',
    `${candidate.caseId}: baseline과 output slide 집합이 다릅니다.`,
    { baseline: baselineSlides, candidate: candidateSlides },
  );
}

function compareModified(checks, baseline, candidate) {
  compareSlideSet(checks, baseline, candidate);
  pushComparison(
    checks,
    candidate.source.sha256 !== baseline.source.sha256,
    'MODIFIED_SOURCE_SHA_UNCHANGED',
    `${candidate.caseId}: 수정본 source SHA가 baseline과 같습니다.`,
  );

  const declaredChanged = new Set(candidate.changedSlides.map(String));
  const actualChangedOutputSlides = Object.keys(baseline.outputSha256BySlide)
    .filter((slideNumber) => candidate.outputSha256BySlide[slideNumber] !== baseline.outputSha256BySlide[slideNumber])
    .sort((left, right) => Number(left) - Number(right));
  const actualChangedAssetSlides = Object.keys(baseline.assetSha256BySlide)
    .filter((slideNumber) => !sameJson(candidate.assetSha256BySlide[slideNumber], baseline.assetSha256BySlide[slideNumber]))
    .sort((left, right) => Number(left) - Number(right));
  const unexpectedOutputSlides = actualChangedOutputSlides.filter((slideNumber) => !declaredChanged.has(slideNumber));
  const unexpectedAssetSlides = actualChangedAssetSlides.filter((slideNumber) => !declaredChanged.has(slideNumber));
  const declaredOutputSlides = [...declaredChanged].filter((slideNumber) => baseline.outputSha256BySlide[slideNumber]);
  const declaredAssetSlides = [...declaredChanged].filter((slideNumber) => baseline.assetSha256BySlide[slideNumber]);
  const missingDeclaredOutputSlides = declaredOutputSlides.filter((slideNumber) => !actualChangedOutputSlides.includes(slideNumber));
  const missingDeclaredAssetSlides = declaredAssetSlides.filter((slideNumber) => !actualChangedAssetSlides.includes(slideNumber));

  pushComparison(
    checks,
    declaredOutputSlides.length > 0 && missingDeclaredOutputSlides.length === 0,
    'MODIFIED_DECLARED_OUTPUT_NOT_CHANGED',
    `${candidate.caseId}: 수정 대상으로 선언한 슬라이드 출력이 모두 달라져야 합니다.`,
    {
      declaredOutputSlides,
      actualChangedOutputSlides,
      missingDeclaredOutputSlides,
    },
  );
  pushComparison(
    checks,
    declaredAssetSlides.length > 0 && missingDeclaredAssetSlides.length === 0,
    'MODIFIED_DECLARED_ASSET_NOT_CHANGED',
    `${candidate.caseId}: 수정 대상으로 선언한 캡처 이미지가 모두 달라져야 합니다.`,
    {
      declaredAssetSlides,
      actualChangedAssetSlides,
      missingDeclaredAssetSlides,
    },
  );
  pushComparison(
    checks,
    unexpectedOutputSlides.length === 0,
    'UNDECLARED_SLIDE_OUTPUT_CHANGED',
    `${candidate.caseId}: 수정 대상으로 선언하지 않은 슬라이드 출력이 달라졌습니다.`,
    { unexpectedOutputSlides, actualChangedOutputSlides },
  );
  pushComparison(
    checks,
    unexpectedAssetSlides.length === 0,
    'UNDECLARED_SLIDE_ASSET_CHANGED',
    `${candidate.caseId}: 수정 대상으로 선언하지 않은 캡처 이미지가 달라졌습니다.`,
    { unexpectedAssetSlides, actualChangedAssetSlides },
  );
}

function compareSameBytes(checks, baseline, candidate) {
  compareSlideSet(checks, baseline, candidate);
  pushComparison(checks, candidate.source.sha256 === baseline.source.sha256, 'SAME_BYTES_SOURCE_SHA_MISMATCH', `${candidate.caseId}: 동일 바이트 source SHA가 baseline과 다릅니다.`);
  pushComparison(checks, candidate.source.fileSize === baseline.source.fileSize, 'SAME_BYTES_SIZE_MISMATCH', `${candidate.caseId}: 동일 바이트 source 크기가 baseline과 다릅니다.`);
  const exactOutputMatch = valuesEqual(candidate.outputSha256BySlide, baseline.outputSha256BySlide);
  const exactAssetMatch = valuesEqual(candidate.assetSha256BySlide, baseline.assetSha256BySlide);
  const differingOutputSlides = Object.keys(baseline.outputSha256BySlide)
    .filter((slideNumber) => candidate.outputSha256BySlide[slideNumber] !== baseline.outputSha256BySlide[slideNumber]);
  const differingAssetSlides = Object.keys(baseline.assetSha256BySlide)
    .filter((slideNumber) => !sameJson(candidate.assetSha256BySlide[slideNumber], baseline.assetSha256BySlide[slideNumber]));
  const visualAssetMatch = differingAssetSlides.every((slideNumber) => {
    const baselineVisual = baseline.assetVisualSha256BySlide?.[slideNumber];
    const candidateVisual = candidate.assetVisualSha256BySlide?.[slideNumber];
    return baselineVisual && candidateVisual && sameJson(baselineVisual, candidateVisual);
  });
  const visualOutputMatch = differingOutputSlides.every(
    (slideNumber) => differingAssetSlides.includes(slideNumber) && visualAssetMatch,
  );
  pushComparison(
    checks,
    exactOutputMatch || visualOutputMatch,
    'SAME_BYTES_OUTPUT_MISMATCH',
    `${candidate.caseId}: 동일 바이트의 출력 이미지가 baseline과 시각적으로 다릅니다.`,
    { exactMatch: exactOutputMatch, visualMatch: visualOutputMatch, differingOutputSlides },
  );
  pushComparison(
    checks,
    exactAssetMatch || visualAssetMatch,
    'SAME_BYTES_ASSET_MISMATCH',
    `${candidate.caseId}: 동일 바이트의 캡처 이미지가 baseline과 시각적으로 다릅니다.`,
    { exactMatch: exactAssetMatch, visualMatch: visualAssetMatch, differingAssetSlides },
  );
}

function compareResults(results) {
  const checks = [];
  for (const logicalDeck of new Set(results.map((item) => item.logicalDeck))) {
    const deckResults = results.filter((item) => item.logicalDeck === logicalDeck);
    const baseline = deckResults.find((item) => item.variant === 'baseline');
    if (!baseline) continue;
    for (const candidate of deckResults.filter((item) => item !== baseline)) {
      pushComparison(checks, candidate.taskId !== baseline.taskId, 'TASK_ID_REUSED', `${candidate.caseId}: baseline task id가 재사용됐습니다.`);
      pushComparison(checks, candidate.jobId !== baseline.jobId, 'JOB_ID_REUSED', `${candidate.caseId}: baseline job id가 재사용됐습니다.`);
      pushComparison(checks, candidate.source.storagePath !== baseline.source.storagePath, 'SOURCE_PATH_REUSED', `${candidate.caseId}: baseline source storage path가 재사용됐습니다.`);
      pushComparison(checks, candidate.runPrefix !== baseline.runPrefix, 'RUN_PREFIX_REUSED', `${candidate.caseId}: baseline run storage prefix가 재사용됐습니다.`);

      if (candidate.variant === 'same_name_same_bytes') {
        pushComparison(checks, candidate.source.fileName === baseline.source.fileName, 'SAME_NAME_NOT_SAME', `${candidate.caseId}: 동일 파일 재실행의 파일명이 baseline과 다릅니다.`);
        compareSameBytes(checks, baseline, candidate);
      } else if (candidate.variant === 'different_name_same_bytes') {
        pushComparison(checks, candidate.source.fileName !== baseline.source.fileName, 'DIFFERENT_NAME_NOT_DIFFERENT', `${candidate.caseId}: 업로드 파일명이 baseline과 같습니다.`);
        compareSameBytes(checks, baseline, candidate);
      } else if (candidate.variant === 'same_name_modified') {
        pushComparison(checks, candidate.source.fileName === baseline.source.fileName, 'SAME_NAME_NOT_SAME', `${candidate.caseId}: 수정본 업로드 파일명이 baseline과 다릅니다.`);
        compareModified(checks, baseline, candidate);
      } else if (candidate.variant === 'different_name_modified') {
        pushComparison(checks, candidate.source.fileName !== baseline.source.fileName, 'DIFFERENT_NAME_NOT_DIFFERENT', `${candidate.caseId}: 수정본 업로드 파일명이 baseline과 같습니다.`);
        compareModified(checks, baseline, candidate);
      } else if (candidate.variant === 'same_size_modified') {
        pushComparison(checks, candidate.source.fileSize === baseline.source.fileSize, 'SAME_SIZE_NOT_SAME', `${candidate.caseId}: same_size_modified 크기가 baseline과 다릅니다.`);
        compareModified(checks, baseline, candidate);
      }
    }
  }

  const all = results.flatMap((item) => [
    ['taskId', item.taskId],
    ['jobId', item.jobId],
    ['sourcePath', item.source.storagePath],
    ['runPrefix', item.runPrefix],
  ]);
  for (const field of ['taskId', 'jobId', 'sourcePath', 'runPrefix']) {
    const values = all.filter(([name]) => name === field).map(([, value]) => value);
    pushComparison(checks, new Set(values).size === values.length, `GLOBAL_${field.toUpperCase()}_NOT_UNIQUE`, `전체 case의 ${field}가 고유하지 않습니다.`);
  }
  return checks;
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function selfTest() {
  const normalized = normalizeManifest(
    {
      expectedRenderProvider: 'graph',
      cases: [
        { id: 'schema-baseline', filePath: 'base/deck.pptx', logicalDeck: 'deck', variant: 'baseline', expectedSourceSha256: 'a'.repeat(64), expectedFileSize: 100, changedSlides: [] },
        { id: 'schema-repeat', filePath: 'repeat/deck.pptx', logicalDeck: 'deck', variant: 'same_name_same_bytes', expectedSourceSha256: 'a'.repeat(64), expectedFileSize: 100, changedSlides: [] },
        { id: 'schema-renamed', filePath: 'renamed/deck-copy.pptx', logicalDeck: 'deck', variant: 'different_name_same_bytes', expectedSourceSha256: 'a'.repeat(64), expectedFileSize: 100, changedSlides: [] },
        { id: 'schema-modified', filePath: 'modified/deck.pptx', logicalDeck: 'deck', variant: 'same_name_modified', expectedSourceSha256: 'b'.repeat(64), expectedFileSize: 101, changedSlides: [2] },
        { id: 'schema-renamed-modified', filePath: 'modified/deck-new.pptx', logicalDeck: 'deck', variant: 'different_name_modified', expectedSourceSha256: 'b'.repeat(64), expectedFileSize: 101, changedSlides: [2] },
        { id: 'schema-same-size', filePath: 'same-size/deck.pptx', logicalDeck: 'deck', variant: 'same_size_modified', expectedSourceSha256: 'c'.repeat(64), expectedFileSize: 100, changedSlides: [2] },
      ],
    },
    '/fixtures/cases.json',
  );
  assert.equal(normalized.expectedRenderProvider, 'microsoft_graph');
  assert.equal(normalized.cases.length, 6);
  assert.equal(normalized.cases[3].filePath, '/fixtures/modified/deck.pptx');

  const base = {
    caseId: 'baseline', logicalDeck: 'deck', variant: 'baseline', changedSlides: [], taskId: 't1', jobId: 'j1',
    source: { fileName: 'deck.pptx', fileSize: 100, sha256: 'a', storagePath: 't1/source/a' },
    runPrefix: 't1/runs/1/', outputSha256BySlide: { 1: 'x', 2: 'y' }, assetSha256BySlide: { 2: ['y'] },
    assetVisualSha256BySlide: { 2: ['vy'] }, cropGate: { expectedAssetSlides: 1 },
  };
  const sameBytes = {
    ...base, caseId: 'renamed', variant: 'different_name_same_bytes', taskId: 't2', jobId: 'j2', runPrefix: 't2/runs/1/',
    source: { ...base.source, fileName: 'renamed.pptx', storagePath: 't2/source/a' },
  };
  const sameNameSameBytes = {
    ...base, caseId: 'repeat', variant: 'same_name_same_bytes', taskId: 't5', jobId: 'j5', runPrefix: 't5/runs/1/',
    source: { ...base.source, storagePath: 't5/source/a' },
  };
  const modified = {
    ...base, caseId: 'modified', variant: 'same_name_modified', changedSlides: [2], taskId: 't3', jobId: 'j3', runPrefix: 't3/runs/1/',
    source: { ...base.source, sha256: 'b', storagePath: 't3/source/b' }, outputSha256BySlide: { 1: 'x', 2: 'z' }, assetSha256BySlide: { 2: ['z'] },
    assetVisualSha256BySlide: { 2: ['vz'] },
  };
  const sameSize = {
    ...base, caseId: 'same-size', variant: 'same_size_modified', changedSlides: [2], taskId: 't4', jobId: 'j4', runPrefix: 't4/runs/1/',
    source: { ...base.source, sha256: 'c', storagePath: 't4/source/c' }, outputSha256BySlide: { 1: 'x', 2: 'q' }, assetSha256BySlide: { 2: ['q'] },
    assetVisualSha256BySlide: { 2: ['vq'] },
  };
  const differentNameModified = {
    ...modified, caseId: 'renamed-modified', variant: 'different_name_modified', taskId: 't6', jobId: 'j6', runPrefix: 't6/runs/1/',
    source: { ...modified.source, fileName: 'renamed-modified.pptx', storagePath: 't6/source/b' },
  };
  const checks = compareResults([base, sameNameSameBytes, sameBytes, modified, differentNameModified, sameSize]);
  assert.equal(checks.filter((item) => !item.pass).length, 0);
  const graphAntialiasRepeat = {
    ...sameBytes,
    outputSha256BySlide: { 1: 'x', 2: 'y-noise' },
    assetSha256BySlide: { 2: ['y-noise'] },
    assetVisualSha256BySlide: { 2: ['vy'] },
  };
  assert.equal(compareResults([base, graphAntialiasRepeat]).filter((item) => !item.pass).length, 0);
  const broken = compareResults([base, { ...modified, outputSha256BySlide: base.outputSha256BySlide, assetSha256BySlide: base.assetSha256BySlide }]);
  assert(broken.some((item) => item.code === 'MODIFIED_DECLARED_OUTPUT_NOT_CHANGED' && !item.pass));
  assert(broken.some((item) => item.code === 'MODIFIED_DECLARED_ASSET_NOT_CHANGED' && !item.pass));
  console.log('E2E revision harness self-test passed.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.selfTest) {
    await selfTest();
    return;
  }
  if (!args.manifestPath) throw new HarnessError('CLI_MANIFEST_MISSING', '--manifest <cases.json>이 필요합니다.');

  const startedAt = new Date().toISOString();
  const manifestPath = path.resolve(args.manifestPath);
  const timestamp = startedAt.replace(/[:.]/g, '-');
  const reportPath = path.resolve(args.reportPath ?? `.tmp/reports/e2e-pipeline-revisions-${timestamp}.json`);
  let report = {
    schemaVersion: 1,
    startedAt,
    finishedAt: null,
    manifestPath,
    reportPath,
    baseUrl: process.env.BASE_URL ?? 'http://localhost:3100',
    expectedRenderProvider: null,
    expectedCaptureBox: FIXED_CAPTURE_BOX,
    requestedDecks: args.decks ? [...args.decks] : null,
    rerunDecks: args.rerunDecks ? [...args.rerunDecks] : null,
    cases: [],
    checks: [],
    failures: [],
    summary: null,
  };
  if (args.resume) {
    const checkpoint = JSON.parse(await readFile(reportPath, 'utf8'));
    check(path.resolve(checkpoint.manifestPath) === manifestPath, 'RESUME_MANIFEST_MISMATCH', '재개 report의 manifest가 현재 manifest와 다릅니다.');
    report = {
      ...checkpoint,
      finishedAt: null,
      reportPath,
      baseUrl: process.env.BASE_URL ?? checkpoint.baseUrl,
      requestedDecks: args.decks ? [...args.decks] : checkpoint.requestedDecks ?? null,
      rerunDecks: args.rerunDecks ? [...args.rerunDecks] : null,
      checks: [],
      failures: [],
      summary: null,
      resumedAt: new Date().toISOString(),
    };
  }

  try {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
    const config = normalizeManifest(raw, manifestPath);
    report.expectedRenderProvider = config.expectedRenderProvider;
    if (args.rerunDecks) {
      check(args.resume, 'RERUN_REQUIRES_RESUME', '--rerun-decks는 --resume과 함께 사용해야 합니다.');
      const availableDecks = new Set(config.cases.map((item) => item.logicalDeck));
      const missingRerunDecks = [...args.rerunDecks].filter((item) => !availableDecks.has(item));
      check(missingRerunDecks.length === 0, 'CLI_RERUN_DECKS_NOT_FOUND', `manifest에 없는 rerun deck: ${missingRerunDecks.join(', ')}`);
      report.cases = (report.cases ?? []).filter((item) => !args.rerunDecks.has(item.logicalDeck));
    }
    const selectedCases = args.decks
      ? config.cases.filter((item) => args.decks.has(item.logicalDeck))
      : config.cases;
    check(selectedCases.length > 0, 'CLI_DECKS_EMPTY', '--decks 조건에 맞는 테스트 케이스가 없습니다.');
    if (args.decks) {
      const foundDecks = new Set(selectedCases.map((item) => item.logicalDeck));
      const missingDecks = [...args.decks].filter((item) => !foundDecks.has(item));
      check(missingDecks.length === 0, 'CLI_DECKS_NOT_FOUND', `manifest에 없는 deck: ${missingDecks.join(', ')}`);
    }
    const completedCaseIds = new Set((report.cases ?? []).map((item) => item.caseId));
    const pendingCases = selectedCases.filter((item) => !completedCaseIds.has(item.id));
    await preflightCases(pendingCases);

    const settings = {
      baseUrl: report.baseUrl,
      expectedRenderProvider: config.expectedRenderProvider,
      pipelineTimeoutMs: positiveInteger(process.env.E2E_PIPELINE_TIMEOUT_MS, 30 * 60 * 1000, 60_000),
      pollIntervalMs: positiveInteger(process.env.E2E_POLL_INTERVAL_MS, 3000, 500, 30_000),
      requestTimeoutMs: positiveInteger(process.env.E2E_REQUEST_TIMEOUT_MS, 120_000, 1000),
      uploadTimeoutMs: positiveInteger(process.env.E2E_UPLOAD_TIMEOUT_MS, 15 * 60 * 1000, 10_000),
      assetConcurrency: positiveInteger(process.env.E2E_ASSET_CONCURRENCY, 4, 1, 12),
    };
    const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });

    for (const item of pendingCases) {
      const caseStartedAt = new Date().toISOString();
      try {
        const identifiers = await uploadAndRun(item, settings);
        const statusHistory = await pollUntilComplete(item, identifiers.taskId, identifiers.jobId, settings);
        const evidence = await collectEvidence(item, identifiers, settings, supabase);
        report.cases.push({ ...evidence, statusHistory, startedAt: caseStartedAt, finishedAt: new Date().toISOString() });
        console.log(`[PASS] ${item.id}: task=${identifiers.taskId} job=${identifiers.jobId}`);
      } catch (error) {
        const failure = {
          caseId: item.id,
          code: error instanceof HarnessError ? error.code : 'CASE_UNEXPECTED_ERROR',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof HarnessError && error.details !== undefined ? { details: error.details } : {}),
        };
        report.failures.push(failure);
        console.error(`[FAIL] ${item.id}: ${failure.code} ${failure.message}`);
      } finally {
        report.checkpointAt = new Date().toISOString();
        await writeReport(reportPath, report);
      }
    }

    report.checks = compareResults(report.cases);
    for (const failedCheck of report.checks.filter((item) => !item.pass)) {
      report.failures.push({ code: failedCheck.code, message: failedCheck.message, details: failedCheck.details });
    }
  } catch (error) {
    report.failures.push({
      code: error instanceof HarnessError ? error.code : 'HARNESS_ERROR',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof HarnessError && error.details !== undefined ? { details: error.details } : {}),
    });
  } finally {
    report.finishedAt = new Date().toISOString();
    report.summary = {
      casePassed: report.cases.length,
      caseFailed: report.failures.filter((item) => item.caseId).length,
      checksPassed: report.checks.filter((item) => item.pass).length,
      checksFailed: report.checks.filter((item) => !item.pass).length,
      overall: report.failures.length === 0 ? 'passed' : 'failed',
    };
    await writeReport(reportPath, report);
    console.log(`report: ${reportPath}`);
  }

  if (report.failures.length > 0) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
