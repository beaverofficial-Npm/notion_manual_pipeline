create type manual_task_status as enum (
  'draft',
  'ready',
  'running',
  'review_required',
  'ready_to_publish',
  'publishing',
  'published',
  'failed'
);

create type manual_job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

create type manual_review_status as enum (
  'pending',
  'review_required',
  'approved',
  'excluded'
);

create type manual_asset_kind as enum (
  'screenshot',
  'qr',
  'table_image',
  'annotation',
  'decorative',
  'unknown'
);

create type manual_block_kind as enum (
  'heading',
  'paragraph',
  'numbered_list',
  'bulleted_list',
  'callout',
  'image',
  'table',
  'divider'
);

create table manual_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status manual_task_status not null default 'draft',
  target_notion_page_id text,
  target_notion_data_source_id text,
  publish_mode text not null default 'create_child',
  current_run_number integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table manual_source_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  file_size bigint,
  checksum text,
  created_at timestamptz not null default now()
);

create table manual_conversion_jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  source_file_id uuid references manual_source_files(id) on delete set null,
  run_number integer not null,
  status manual_job_status not null default 'queued',
  worker_id text,
  error_message text,
  manifest_path text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, run_number)
);

create table manual_slides (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  job_id uuid references manual_conversion_jobs(id) on delete set null,
  slide_number integer not null,
  title text,
  render_path text,
  width numeric,
  height numeric,
  review_status manual_review_status not null default 'pending',
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, job_id, slide_number)
);

create table manual_slide_elements (
  id uuid primary key default gen_random_uuid(),
  slide_id uuid not null references manual_slides(id) on delete cascade,
  element_key text not null,
  element_type text not null,
  text_content text,
  bbox jsonb,
  z_index integer,
  raw jsonb not null default '{}'::jsonb,
  classified_kind text,
  confidence numeric(4, 3),
  created_at timestamptz not null default now(),
  unique (slide_id, element_key)
);

create table manual_assets (
  id uuid primary key default gen_random_uuid(),
  slide_id uuid not null references manual_slides(id) on delete cascade,
  job_id uuid references manual_conversion_jobs(id) on delete set null,
  kind manual_asset_kind not null,
  label text not null,
  storage_path text,
  crop_box jsonb,
  source_element_ids jsonb not null default '[]'::jsonb,
  included_annotation_ids jsonb not null default '[]'::jsonb,
  review_status manual_review_status not null default 'pending',
  review_reason text,
  confidence numeric(4, 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table manual_notion_blocks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  slide_id uuid references manual_slides(id) on delete cascade,
  asset_id uuid references manual_assets(id) on delete set null,
  sort_order integer not null,
  kind manual_block_kind not null,
  content jsonb not null default '{}'::jsonb,
  notion_payload jsonb not null default '{}'::jsonb,
  review_status manual_review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table manual_publish_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  status manual_job_status not null default 'queued',
  target_page_id text not null,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table manual_notion_mappings (
  id uuid primary key default gen_random_uuid(),
  publish_run_id uuid not null references manual_publish_runs(id) on delete cascade,
  local_entity_type text not null,
  local_entity_id uuid not null,
  notion_page_id text,
  notion_block_id text,
  created_at timestamptz not null default now()
);

create index manual_source_files_task_id_idx on manual_source_files(task_id);
create index manual_conversion_jobs_task_id_idx on manual_conversion_jobs(task_id);
create index manual_slides_task_id_idx on manual_slides(task_id);
create index manual_slide_elements_slide_id_idx on manual_slide_elements(slide_id);
create index manual_assets_slide_id_idx on manual_assets(slide_id);
create index manual_notion_blocks_task_id_idx on manual_notion_blocks(task_id);
create index manual_publish_runs_task_id_idx on manual_publish_runs(task_id);

-- 목차 계층(카테고리/기능). 자세한 내용은 migrations/001_hierarchy.sql 참고.
create table manual_categories (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  sort_order integer not null default 0,
  title text not null,
  source text not null default 'section',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table manual_functions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  category_id uuid not null references manual_categories(id) on delete cascade,
  sort_order integer not null default 0,
  title text not null,
  review_status manual_review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table manual_slides add column slide_role text not null default 'content';
alter table manual_slides add column category_id uuid references manual_categories(id) on delete set null;
alter table manual_slides add column function_id uuid references manual_functions(id) on delete set null;
alter table manual_slides add column function_seq integer;

alter table manual_notion_blocks add column function_id uuid references manual_functions(id) on delete cascade;

create index manual_categories_task_id_idx on manual_categories(task_id);
create index manual_functions_category_id_idx on manual_functions(category_id);
create index manual_functions_task_id_idx on manual_functions(task_id);
create index manual_slides_function_id_idx on manual_slides(function_id);
create index manual_notion_blocks_function_id_idx on manual_notion_blocks(function_id);
