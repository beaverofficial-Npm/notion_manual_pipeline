-- 매뉴얼 유지보수 자동화 v2용 additive migration.
-- 목적: 변경신호 -> 영향 단위 -> 갱신안 -> 승인/발행 루프의 최소 데이터 계약을 만든다.
-- 주의: 기존 v1 변환 테이블을 변경/삭제하지 않고, v2 테이블만 추가한다.

create table if not exists manual_anchor_units (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('storemgmt', 'opsmgmt')),
  unit_key text not null,
  title text not null,
  granularity text not null default 'screen'
    check (granularity in ('screen', 'task', 'feature', 'policy', 'table')),
  source_type text not null default 'generated'
    check (source_type in ('ppt', 'notion', 'kms', 'realmeasure', 'generated')),
  source_ref jsonb not null default '{}'::jsonb,
  parent_id uuid references manual_anchor_units(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'stale', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product, unit_key)
);

create table if not exists manual_product_anchors (
  id uuid primary key default gen_random_uuid(),
  manual_unit_id uuid not null references manual_anchor_units(id) on delete cascade,
  product text not null check (product in ('storemgmt', 'opsmgmt')),
  route text,
  screen_id text,
  anchor_key text not null default '',
  component_key text,
  kms_class_code text,
  figma_node_id text,
  confidence numeric(4, 3) not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'candidate'
    check (status in ('candidate', 'approved', 'rejected', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists manual_product_anchors_unit_anchor_key_idx
  on manual_product_anchors(manual_unit_id, anchor_key);

create table if not exists manual_change_signals (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('asana', 'figma', 'manual')),
  external_id text,
  product text not null check (product in ('storemgmt', 'opsmgmt')),
  title text not null,
  body text not null default '',
  hints jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'received'
    check (status in ('received', 'resolved', 'queued', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, external_id)
);

create table if not exists manual_impact_candidates (
  id uuid primary key default gen_random_uuid(),
  change_signal_id uuid not null references manual_change_signals(id) on delete cascade,
  manual_unit_id uuid not null references manual_anchor_units(id) on delete cascade,
  anchor_id uuid references manual_product_anchors(id) on delete set null,
  score numeric(5, 4) not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  decision text not null default 'pending'
    check (decision in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (change_signal_id, manual_unit_id)
);

create table if not exists manual_update_drafts (
  id uuid primary key default gen_random_uuid(),
  impact_candidate_id uuid not null references manual_impact_candidates(id) on delete cascade,
  draft_type text not null default 'mixed'
    check (draft_type in ('text', 'screenshot', 'table', 'policy', 'mixed')),
  current_content_ref jsonb not null default '{}'::jsonb,
  proposed_content jsonb not null default '{}'::jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  review_status text not null default 'review_required'
    check (review_status in ('review_required', 'approved', 'edited', 'rejected')),
  publish_status text not null default 'not_ready'
    check (publish_status in ('not_ready', 'ready', 'published', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (impact_candidate_id, draft_type)
);

create index if not exists manual_anchor_units_product_idx on manual_anchor_units(product);
create index if not exists manual_product_anchors_product_idx on manual_product_anchors(product);
create index if not exists manual_product_anchors_route_idx on manual_product_anchors(route);
create index if not exists manual_product_anchors_kms_class_code_idx on manual_product_anchors(kms_class_code);
create index if not exists manual_change_signals_product_status_idx on manual_change_signals(product, status);
create index if not exists manual_impact_candidates_signal_idx on manual_impact_candidates(change_signal_id);
create index if not exists manual_update_drafts_review_status_idx on manual_update_drafts(review_status);
