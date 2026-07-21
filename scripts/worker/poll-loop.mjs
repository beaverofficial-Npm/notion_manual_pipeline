// 변환 worker 폴링 루프. Supabase 의 queued job 을 계속 가져와 처리한다.
// Microsoft Graph 인증과 Poppler가 준비된 컨테이너(Railway 등)에서 상주 실행한다.
import { createClient } from '@supabase/supabase-js';
import { runOnce, reclaimStuckJobs, reclaimStuckPublishRuns } from './run-conversion-job.mjs';
import { runPublishOnce } from './run-publish-job.mjs';
import { workerId, workerVersion, workerEnvLabel, workerLabel } from './worker-identity.mjs';

const IDLE_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const HEARTBEAT_MS = 15000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`[worker] conversion poller started (idle ${IDLE_MS}ms) — ${workerLabel} env=${workerEnvLabel}`);

// 생존 신호: 15초마다 worker_heartbeats 에 upsert. 변환 처리 중에도 타이머는 돈다.
// 웹이 이를 읽어 "변환기 온라인/오프라인"을 표시한다 — 워커가 죽으면 화면에서 바로 보인다.
const hbClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
async function beat() {
  try {
    await hbClient.from('worker_heartbeats').upsert({
      id: workerId,
      role: 'conversion',
      version: workerVersion,
      env_label: workerEnvLabel,
      last_seen_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[worker] heartbeat failed:', error instanceof Error ? error.message : String(error));
  }
}
await beat();
setInterval(beat, HEARTBEAT_MS).unref();

// 시작 시 이전 실행이 남긴 stuck running job 을 회수한다.
async function reclaimAll() {
  try {
    const reclaimed = await reclaimStuckJobs();
    if (reclaimed) console.log(`[worker] reclaimed ${reclaimed} stuck job(s) → queued`);
  } catch (error) {
    console.error('[worker] reclaim failed:', error instanceof Error ? error.message : String(error));
  }
  try {
    const reclaimedPub = await reclaimStuckPublishRuns();
    if (reclaimedPub) console.log(`[worker] reclaimed ${reclaimedPub} stuck publish run(s) → task review_required`);
  } catch (error) {
    console.error('[worker] publish reclaim failed:', error instanceof Error ? error.message : String(error));
  }
}

await reclaimAll();

for (;;) {
  let processed = false;

  // 1) 변환 job 1건
  try {
    await runOnce();
    processed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('No queued job')) {
      // 개별 변환 실패는 runOnce 내부에서 job/task 를 failed 로 기록한다.
      console.error('[worker] 변환 job error:', message);
      await sleep(IDLE_MS);
      continue;
    }
  }

  // 2) 발행 run 1건(변환과 같은 폴러가 처리 — 연결 끊겨도 발행이 끝까지 감)
  try {
    await runPublishOnce();
    processed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('No queued publish run')) {
      // 개별 발행 실패는 publish-core 내부에서 run/task 를 failed 로 기록한다.
      console.error('[worker] 발행 error:', message);
    }
  }

  // 3) 둘 다 없으면 멈춘 job/발행 회수 후 대기
  if (!processed) {
    await reclaimAll();
    await sleep(IDLE_MS);
  }
}
