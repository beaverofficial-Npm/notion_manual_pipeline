// 변환 worker 폴링 루프. Supabase 의 queued job 을 계속 가져와 처리한다.
// LibreOffice/Poppler 가 설치된 컨테이너(Railway 등)에서 상주 실행한다.
import { runOnce, reclaimStuckJobs } from './run-conversion-job.mjs';

const IDLE_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`[worker] conversion poller started (idle ${IDLE_MS}ms)`);

// 시작 시 이전 실행이 남긴 stuck running job 을 회수한다.
try {
  const reclaimed = await reclaimStuckJobs();
  if (reclaimed) console.log(`[worker] reclaimed ${reclaimed} stuck job(s) → queued`);
} catch (error) {
  console.error('[worker] reclaim failed:', error instanceof Error ? error.message : String(error));
}

for (;;) {
  try {
    await runOnce(); // 가장 오래된 queued job 1건 처리
    // 성공하면 곧바로 다음 job 확인
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('No queued job')) {
      await sleep(IDLE_MS); // 큐 비었음 → 대기
    } else {
      // 개별 job 실패는 runOnce 내부에서 job/task 를 failed 로 기록한다.
      console.error('[worker] job error:', message);
      await sleep(IDLE_MS);
    }
  }
}
