// 워커 자기 식별: 어떤 프로세스가(호스트-pid), 어떤 코드로(git 커밋), 어느 환경에(supabase host) 붙었는지.
// "어떤 워커가 어떤 버전으로 처리했는지 아무도 모른다"는 구멍을 없애기 위한 라벨.
import { execFileSync } from 'node:child_process';
import os from 'node:os';

function detectVersion() {
  if (process.env.WORKER_VERSION) return process.env.WORKER_VERSION; // 컨테이너 빌드 시 주입 가능
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return 'unknown';
  }
}

function detectEnvLabel() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    return new URL(url).host || 'unknown-env';
  } catch {
    return 'unknown-env';
  }
}

export const workerId = `${os.hostname().split('.')[0]}-${process.pid}`;
export const workerVersion = detectVersion();
export const workerEnvLabel = detectEnvLabel();
// job.worker_id 에 기록되는 라벨 — "누가@어떤버전" 을 남긴다.
export const workerLabel = `${workerId}@${workerVersion}`;
