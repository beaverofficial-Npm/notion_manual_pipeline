-- 변환 모드 추가 — 캡쳐(기존) vs 그룹베이크(신규)
-- additive migration: manual_tasks에 conversion_mode 컬럼 추가
-- 기존 행은 모두 'capture'로 설정(기존 동작 보존)

alter table manual_tasks
  add column if not exists conversion_mode text not null default 'capture'
  check (conversion_mode in ('capture', 'group_bake'));

-- 인덱스: 모드별 조회 성능
create index if not exists manual_tasks_conversion_mode_idx on manual_tasks(conversion_mode);

-- manual_assets.kind enum에 'group_bake' 추가 (그룹 베이크 모드 에셋 종류)
-- (PG12+: ADD VALUE 는 트랜잭션 가능, 단 같은 트랜잭션에서 사용 불가 — 여기선 추가만)
alter type manual_asset_kind add value if not exists 'group_bake';
