-- 발행 백그라운드 job 화: manual_publish_runs 를 큐로 사용한다(변환 job 과 동일 패턴).
-- 새 테이블 없음 — 기존 테이블에 job 수명주기 컬럼만 보강. 멱등.
-- status 는 이미 manual_job_status(queued|running|succeeded|failed|cancelled) 재사용.
-- payload(jsonb) 에 발행 입력을 담는다: { notionTarget, excludedFnIds }.

alter table manual_publish_runs
  add column if not exists worker_id text,
  add column if not exists progress jsonb not null default '{}'::jsonb; -- {done,total,label}

-- 큐 조회: 가장 오래된 queued 우선.
create index if not exists manual_publish_runs_status_created_idx
  on manual_publish_runs(status, created_at);
