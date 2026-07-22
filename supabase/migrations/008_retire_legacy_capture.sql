-- 고정 영역 캡처 단일 경로로 전환한다.
-- 컬럼은 기존 데이터/클라이언트 호환을 위해 유지하지만 구형 capture 값은 더 이상 허용하지 않는다.

update manual_tasks
set conversion_mode = 'group_bake'
where conversion_mode is distinct from 'group_bake';

alter table manual_tasks
  alter column conversion_mode set default 'group_bake';

alter table manual_tasks
  drop constraint if exists manual_tasks_conversion_mode_check;

alter table manual_tasks
  add constraint manual_tasks_conversion_mode_check
  check (conversion_mode = 'group_bake');

drop index if exists manual_tasks_conversion_mode_idx;
