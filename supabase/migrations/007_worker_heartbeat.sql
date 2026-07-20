-- 워커 생존 신호 + 처리 버전 기록.
-- "워커가 죽어도 아무도 모르는" 구멍을 없앤다: 워커가 주기적으로 자기 상태를 남기고,
-- 웹이 이를 읽어 변환기 온라인/오프라인을 표시한다.
create table if not exists worker_heartbeats (
  id text primary key,                        -- 워커 식별자 (host-pid)
  role text not null default 'conversion',
  version text,                               -- 코드 버전(git short commit)
  env_label text,                             -- 붙어있는 환경(supabase host)
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table worker_heartbeats is '변환 워커 생존 신호. last_seen_at 이 최근(30s)이면 온라인.';
