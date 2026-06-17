-- 목차 계층화 변환을 위한 추가 마이그레이션.
-- 이미 적용된 schema.sql 위에 덧붙여 실행할 수 있도록 idempotent 하게 작성한다.

-- 카테고리: 목차/섹션 표지 기준으로 나뉜 매뉴얼 구획.
create table if not exists manual_categories (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  sort_order integer not null default 0,
  title text not null,
  source text not null default 'section',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기능: 카테고리에 속한 기능. 노션 서브페이지 한 개와 1대1 대응한다.
create table if not exists manual_functions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references manual_tasks(id) on delete cascade,
  category_id uuid not null references manual_categories(id) on delete cascade,
  sort_order integer not null default 0,
  title text not null,
  review_status manual_review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 슬라이드에 역할과 소속을 부여한다. 표지/목차는 function_id 가 비고 본문에서 제외된다.
alter table manual_slides add column if not exists slide_role text not null default 'content';
alter table manual_slides add column if not exists category_id uuid references manual_categories(id) on delete set null;
alter table manual_slides add column if not exists function_id uuid references manual_functions(id) on delete set null;
alter table manual_slides add column if not exists function_seq integer;

-- 블록도 기능 단위로 묶을 수 있게 한다.
alter table manual_notion_blocks add column if not exists function_id uuid references manual_functions(id) on delete cascade;

create index if not exists manual_categories_task_id_idx on manual_categories(task_id);
create index if not exists manual_functions_category_id_idx on manual_functions(category_id);
create index if not exists manual_functions_task_id_idx on manual_functions(task_id);
create index if not exists manual_slides_function_id_idx on manual_slides(function_id);
create index if not exists manual_notion_blocks_function_id_idx on manual_notion_blocks(function_id);
