import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { publishToNotion } from './publish-core.mjs';

// 발행 워커 — 큐(manual_publish_runs status=queued)에서 발행을 집어 처리한다.
// 변환 job 과 동일한 원자적 클레임 패턴. 연결과 무관하게 끝까지 돌리고 진행을 DB 에 기록.
const repoRoot = process.cwd();

async function loadLocalEnv() {
  try {
    const envText = await readFile(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      if (k && !process.env[k]) process.env[k] = t.slice(i + 1).trim();
    }
  } catch {
    // 배포 환경은 env 를 직접 주입한다.
  }
}
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing.`);
  return v;
}

await loadLocalEnv();
const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// 가장 오래된 queued 발행(또는 지정 runId)을 원자적으로 claim(queued→running)한다.
async function resolvePublishRun(runIdArg) {
  const columns = 'id,task_id,payload,status';
  let target;
  if (runIdArg) {
    const { data, error } = await supabase.from('manual_publish_runs').select(columns).eq('id', runIdArg).single();
    if (error || !data) throw new Error(error?.message ?? `Publish run not found: ${runIdArg}`);
    target = data;
  } else {
    const { data, error } = await supabase.from('manual_publish_runs').select(columns).eq('status', 'queued').order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('No queued publish run.');
    target = data;
  }
  // 원자적 클레임: queued → running 성공한 프로세스만 처리(이중 발행 레이스 차단).
  const { data: claimed, error: claimError } = await supabase
    .from('manual_publish_runs')
    .update({ status: 'running', worker_id: 'publish-worker', started_at: new Date().toISOString() })
    .eq('id', target.id)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw new Error('No queued publish run.'); // 다른 워커가 선점
  return target;
}

export async function runPublishOnce(runIdArg) {
  const run = await resolvePublishRun(runIdArg);
  const conversionJobId = typeof run.payload?.conversionJobId === 'string' ? run.payload.conversionJobId.trim() : '';
  if (!conversionJobId) {
    const message = `Publish run ${run.id} is missing payload.conversionJobId. Queue a new publish run from a succeeded conversion.`;
    await supabase
      .from('manual_publish_runs')
      .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', run.id);
    await supabase
      .from('manual_tasks')
      .update({ status: 'review_required', updated_at: new Date().toISOString() })
      .eq('id', run.task_id);
    throw new Error(message);
  }
  const token = requireEnv('NOTION_TOKEN');
  const result = await publishToNotion({
    supabase,
    token,
    taskId: run.task_id,
    publishRunId: run.id,
    conversionJobId,
  });
  console.log(JSON.stringify({ publishRunId: run.id, taskId: run.task_id, ...result }));
  return result;
}

// 직접 실행(`node run-publish-job.mjs [runId]`). poll-loop 는 runPublishOnce 를 import 해 사용.
if (process.argv[1] && process.argv[1].endsWith('run-publish-job.mjs')) {
  runPublishOnce(process.argv[2]).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
