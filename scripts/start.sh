#!/bin/sh
set -e

# 한 컨테이너에서 변환 worker(큐 폴링)를 백그라운드로 띄우고, 웹(next start)을 포그라운드로 실행한다.
# poll-loop 는 무한 루프 + try/catch 라 죽지 않고 queued job 을 계속 처리한다.
echo "[start] launching conversion worker (poll-loop)"
node scripts/worker/poll-loop.mjs &

echo "[start] launching web (next start)"
exec npm run start
