// 변환 worker 폴링 루프. Supabase 의 queued job 을 계속 가져와 처리한다.
// LibreOffice/Poppler 가 설치된 컨테이너(Railway 등)에서 상주 실행한다.
import { runOnce, reclaimStuckJobs, reclaimStuckPublishRuns } from './run-conversion-job.mjs';
import { runPublishOnce } from './run-publish-job.mjs';

const IDLE_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`[worker] conversion poller started (idle ${IDLE_MS}ms)`);

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
