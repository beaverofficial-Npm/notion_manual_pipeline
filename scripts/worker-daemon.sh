#!/bin/sh
# 로컬(스테이징) 변환 워커 상주 실행기.
# - 단일 인스턴스 보장: 이미 떠 있으면 시작 거부(좀비/이중 워커 방지)
# - 자동 재시작: 워커가 죽으면 3초 후 다시 띄움(잠드는 큐 방지)
# 사용: nohup sh scripts/worker-daemon.sh > /dev/null 2>&1 &  (로그: .tmp/worker-staging.log)
set -u
cd "$(dirname "$0")/.."

if pgrep -f "poll-loop.mjs" >/dev/null 2>&1; then
  echo "[daemon] 워커가 이미 실행 중입니다 — 중복 기동 거부" >&2
  exit 1
fi

mkdir -p .tmp
echo "[daemon] start $(date '+%F %T') (env=.env.local)" >> .tmp/worker-staging.log
while true; do
  node --env-file=.env.local scripts/worker/poll-loop.mjs >> .tmp/worker-staging.log 2>&1
  code=$?
  echo "[daemon] worker exited (code=$code) $(date '+%F %T') — 3초 후 재시작" >> .tmp/worker-staging.log
  sleep 3
done
