import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { listPrefix } from '../worker/source-storage.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const command = process.argv[2];
const taskId = arg('task');
const baseUrl = arg('base-url', process.env.BASE_URL ?? 'http://127.0.0.1:3100');
const timeoutMs = Number(arg('timeout-ms', '1800000'));
const pollMs = Number(arg('poll-ms', '2000'));

assert(command, 'command가 필요합니다: start | wait | snapshot');
assert(taskId, '--task가 필요합니다.');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl?.includes('127.0.0.1:54321') || supabaseUrl?.includes('localhost:54321'), '로컬 Supabase가 아닙니다. 실행을 중단합니다.');
assert(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY가 없습니다.');
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function jsonResponse(response) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function start() {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tasks/${taskId}/run`;
  const first = await jsonResponse(await fetch(url, { method: 'POST' }));
  assert.equal(first.status, 201, `첫 실행 요청은 201이어야 합니다: ${JSON.stringify(first)}`);
  const duplicate = await jsonResponse(await fetch(url, { method: 'POST' }));
  assert.equal(duplicate.status, 409, `중복 실행 요청은 409여야 합니다: ${JSON.stringify(duplicate)}`);
  return {
    taskId,
    firstStatus: first.status,
    job: first.body?.job,
    duplicateStatus: duplicate.status,
    duplicateMessage: duplicate.body?.message ?? null,
  };
}

async function wait() {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tasks/${taskId}`;
  const deadline = Date.now() + timeoutMs;
  const history = [];
  let previous = '';
  while (Date.now() < deadline) {
    const response = await jsonResponse(await fetch(url));
    assert.equal(response.status, 200, `상태 조회 실패: ${JSON.stringify(response)}`);
    const state = `${response.body?.taskStatus}/${response.body?.jobStatus}/${response.body?.slideCount}`;
    if (state !== previous) {
      history.push({ at: new Date().toISOString(), ...response.body });
      previous = state;
    }
    if (['succeeded', 'failed'].includes(response.body?.jobStatus)) {
      return { taskId, final: response.body, history };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`timeout: ${timeoutMs}ms`);
}

async function snapshot() {
  const [{ data: task, error: taskError }, { data: jobs, error: jobsError }, { data: slides, error: slidesError }] = await Promise.all([
    supabase.from('manual_tasks').select('id,status,current_run_number').eq('id', taskId).single(),
    supabase
      .from('manual_conversion_jobs')
      .select('id,status,run_number,manifest_path,error_message,created_at,started_at,finished_at')
      .eq('task_id', taskId)
      .order('run_number'),
    supabase.from('manual_slides').select('id,job_id,slide_number,render_path').eq('task_id', taskId).order('slide_number'),
  ]);
  if (taskError) throw taskError;
  if (jobsError) throw jobsError;
  if (slidesError) throw slidesError;

  const slideRows = slides ?? [];
  const assets = [];
  for (let offset = 0; offset < slideRows.length; offset += 40) {
    const { data, error } = await supabase
      .from('manual_assets')
      .select('id,slide_id,job_id,storage_path')
      .in('slide_id', slideRows.slice(offset, offset + 40).map((slide) => slide.id));
    if (error) throw error;
    assets.push(...(data ?? []));
  }
  const objectKeys = await listPrefix(`${taskId}/runs/`);
  const currentRun = task.current_run_number;
  const currentJob = [...(jobs ?? [])].reverse().find((job) => job.run_number === currentRun) ?? null;
  const successfulJob = [...(jobs ?? [])].reverse().find((job) => job.status === 'succeeded') ?? null;
  const result = {
    capturedAt: new Date().toISOString(),
    task,
    jobs,
    currentJob,
    latestSuccessfulJob: successfulJob,
    resultRows: {
      slides: slideRows.length,
      slideJobIds: [...new Set(slideRows.map((row) => row.job_id))],
      slideRunPrefixes: [...new Set(slideRows.map((row) => row.render_path?.match(/^[^/]+\/runs\/\d+\//)?.[0] ?? null))],
      assets: assets.length,
      assetJobIds: [...new Set(assets.map((row) => row.job_id))],
      assetRunPrefixes: [...new Set(assets.map((row) => row.storage_path?.match(/^[^/]+\/runs\/\d+\//)?.[0] ?? null))],
    },
    storage: {
      objectCount: objectKeys.length,
      runPrefixes: [...new Set(objectKeys.map((key) => key.match(/^[^/]+\/runs\/\d+\//)?.[0] ?? null))],
      manifestPaths: objectKeys.filter((key) => key.endsWith('/manifest.json')),
    },
  };
  if (arg('assert-success') === 'true') {
    const expectedPrefix = `${taskId}/runs/${currentRun}/`;
    assert.equal(task.status, 'review_required');
    assert.equal(currentJob?.status, 'succeeded');
    assert.deepEqual(result.resultRows.slideJobIds, [currentJob.id]);
    assert.deepEqual(result.resultRows.assetJobIds, [currentJob.id]);
    assert.deepEqual(result.resultRows.slideRunPrefixes, [expectedPrefix]);
    assert.deepEqual(result.resultRows.assetRunPrefixes, [expectedPrefix]);
    assert.deepEqual(result.storage.runPrefixes, [expectedPrefix]);
    assert.deepEqual(result.storage.manifestPaths, [`${expectedPrefix}manifest.json`]);
  }
  return result;
}

const result = command === 'start' ? await start() : command === 'wait' ? await wait() : command === 'snapshot' ? await snapshot() : null;
assert(result, `알 수 없는 command: ${command}`);
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const output = arg('output');
if (output) await writeFile(output, serialized);
process.stdout.write(serialized);
