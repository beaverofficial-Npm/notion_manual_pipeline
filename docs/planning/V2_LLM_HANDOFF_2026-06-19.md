# V2 LLM Handoff - Manual Maintenance Automation

작성일: 2026-06-19

이 문서는 다른 LLM 또는 작업자가 이 프로젝트를 이어받기 위한 상세 인수인계 문서다.

비밀키, 토큰, service role key 값은 의도적으로 기록하지 않는다. 필요한 환경변수 이름만 기록한다.

---

## 1. 프로젝트 한 줄 정의

이 프로젝트는 단순한 `PPT -> Notion 변환기`가 아니다.

최종 목적은 **매뉴얼 유지보수 자동화 v2**다.

제품 변경이 발생했을 때 시스템이 변경신호를 받아 영향받는 매뉴얼 단위를 찾고, 실제 제품 화면/문서/KMS 근거를 바탕으로 갱신안 초안을 만들고, 사람이 검토/승인한 뒤 Notion에 중복 없이 발행하는 운영 시스템을 만든다.

기준 루프:

```text
제품 변경
-> 변경신호(Asana/Figma/manual)
-> 영향 단위 식별
-> Playwright 실측 + KMS/route/screen 근거 수집
-> 갱신안 자동 생성
-> review_required 큐
-> 사람 승인/수정/제외
-> Notion preview/publish
-> mapping/feedback 저장
```

---

## 2. 중요한 맥락

### 2.1 v1과 v2 관계

v1은 `PPT -> Notion` 변환 파이프라인이다.

v1은 폐기 대상이 아니라 v2의 기반 자산이다.

다만 v2를 다시 v1로 축소하면 안 된다. v2의 본질은 전체 PPT 재변환이 아니라 **제품 변경 기반의 증분 매뉴얼 유지보수**다.

### 2.2 사용자가 원한 작업 방식

사용자는 단순 목업, 더미 데이터, seed UI, 임시 대시보드를 원하지 않는다.

요구한 방식:

1. PM/기획자/디자이너/풀스택 개발자의 관점으로 목적을 정확히 잡는다.
2. 운영 루프와 성공지표를 먼저 정의한다.
3. 작업과 검증을 함께 굴리는 하니스를 만든다.
4. 실제 인프라 기준으로 확인한다.
5. GitHub, Railway, Supabase, Notion 등 이미 주어진 인프라를 사용한다.
6. 빠르게 끝내는 척하지 않고 끝까지 검증한다.

### 2.3 호칭/톤 주의

이 프로젝트를 이어받는 LLM은 사용자를 `사용자님`, `사장님`으로 부르지 말 것.

방어적으로 말하지 말고, 실제로 무엇을 했고 무엇을 못 했는지 증거 기준으로 말할 것.

---

## 3. 저장소/배포/운영 정보

### 3.1 로컬 경로

```text
/Users/beaver_bin/Documents/Work_hub/Manual/Notion_manual_pipeline_v1
```

### 3.2 GitHub

```text
https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline
```

현재 최신 커밋:

```text
1482fd7 docs: mark v2 db harness complete
```

최근 커밋:

```text
1482fd7 docs: mark v2 db harness complete
e776ffe docs: record v2 harness run status
0ff5c25 feat: add v2 maintenance fixture harness
22291f8 docs: define v2 maintenance automation operating system
d756572 fix: remove seeded manual builder path
```

### 3.3 Railway

서비스:

```text
notion_manual_pipeline
```

운영 URL:

```text
https://notionmanualpipeline-production.up.railway.app
```

최신 확인 결과:

```text
Railway deployment: SUCCESS
운영 URL: HTTP/2 200
```

빌더:

```text
Dockerfile
```

관련 파일:

```text
railway.json
Dockerfile
```

### 3.4 Supabase

Supabase project ref:

```text
vceuudebsqojbcsdtybd
```

Supabase URL:

```text
https://vceuudebsqojbcsdtybd.supabase.co
```

주의:

- service role key 값은 문서에 쓰지 않는다.
- Supabase SQL DDL은 service role REST만으로 실행되지 않는다.
- 이번 작업에서는 사용자가 Supabase SQL editor에서 migration SQL을 직접 실행했다.

---

## 4. 기준 문서

우선 읽어야 할 문서:

| 우선순위 | 문서 | 역할 |
|---|---|---|
| 1 | `Manual/비버 가이드/매뉴얼_유지보수_자동화_계획개요.md` | v2 목적의 원천 문서 |
| 2 | `Manual/비버 가이드/매뉴얼자동화_v2_설계.md` | 상위 아키텍처/도메인 KB/IR 방향 |
| 3 | `docs/planning/V2_PRODUCT_OPERATING_SYSTEM.md` | v2 제품 운영 체계 |
| 4 | `docs/planning/V2_EXECUTION_HARNESS.md` | 하니스 레벨/게이트 |
| 5 | `docs/planning/V2_ANCHOR_SCHEMA.md` | 앵커/변경신호/갱신안 데이터 모델 |
| 6 | `docs/planning/V2_MAINTENANCE_PIPELINE_SPEC.md` | v2 유지보수 파이프라인 상세 |
| 7 | `docs/planning/V2_HARNESS_RUN_REPORT_2026-06-19.md` | 2026-06-19 실제 실행 보고서 |

v1 참고 문서:

| 문서 | 역할 |
|---|---|
| `docs/planning/PRD.md` | v1 PPT->Notion 제품 기준 |
| `docs/planning/TECHNICAL_DESIGN.md` | v1 백엔드/스토리지/worker 설계 |
| `docs/planning/PIPELINE_SPEC.md` | v1 변환/검수/발행 흐름 |
| `docs/planning/CURRENT_STATUS.md` | v1 현재 상태 |

---

## 5. 이번 작업의 핵심 결과

이번 작업은 v2 L1/L2 하니스를 실제로 닫는 것이었다.

닫힌 범위:

```text
변경신호 fixture
-> 실제 realmeasure 화면 데이터 142개 로드
-> 영향 후보 5개 생성
-> 상위 후보 근거 확인
-> v2 Supabase schema 적용
-> Supabase 원격 DB에 change signal / anchor / impact candidate / update draft row 생성
-> 로컬/DB 하니스 통과
-> 보고서 갱신
-> GitHub push
-> Railway 배포 성공
-> 운영 URL 200 확인
```

아직 미구현인 범위:

```text
변경 신호 등록 API
영향 후보 목록 UI
갱신안 검수 UI
Notion preview/publish v2 연결
발행 mapping/feedback loop UI
Asana/Figma webhook adapter
L3 Evidence Harness
L4 Review Harness
L5 Publish Harness
L6 Production smoke harness
```

---

## 6. 수행한 주요 변경

### 6.1 잘못된 seed/manual-builder runtime 제거

커밋:

```text
d756572 fix: remove seeded manual builder path
```

의도:

사용자가 원하지 않은 seeded manual builder UI/runtime path를 제거했다.

제거된 범위:

```text
/manual-builder route
/api/manual-builder/storemgmt
src/data/manual-builder/*.json
manual-builder-workspace
storemgmt.ts
관련 dashboard link
```

검증:

```text
production /manual-builder -> 404
manual-builder API -> 404
```

### 6.2 v2 운영 체계 문서화

커밋:

```text
22291f8 docs: define v2 maintenance automation operating system
```

추가 문서:

```text
docs/planning/V2_PRODUCT_OPERATING_SYSTEM.md
docs/planning/V2_EXECUTION_HARNESS.md
docs/planning/V2_ANCHOR_SCHEMA.md
docs/planning/V2_MAINTENANCE_PIPELINE_SPEC.md
```

추가 스크립트:

```text
scripts/verify-v2-purpose-harness.mjs
```

추가 package scripts:

```json
{
  "verify:v2-purpose": "node scripts/verify-v2-purpose-harness.mjs"
}
```

### 6.3 v2 fixture harness 구현

커밋:

```text
0ff5c25 feat: add v2 maintenance fixture harness
```

추가 migration:

```text
supabase/migrations/002_maintenance_v2.sql
```

추가 fixture:

```text
scripts/fixtures/change-signals/storemgmt-product-soldout.json
```

추가 harness:

```text
scripts/maintenance/verify-fixture-flow.mjs
```

추가 package scripts:

```json
{
  "verify:v2-fixture:local": "node scripts/maintenance/verify-fixture-flow.mjs",
  "verify:v2-fixture:db": "node scripts/maintenance/verify-fixture-flow.mjs --db"
}
```

`verify:all`도 local fixture까지 포함하도록 구성되어 있다.

### 6.4 실행 보고서 작성

커밋:

```text
e776ffe docs: record v2 harness run status
```

추가 문서:

```text
docs/planning/V2_HARNESS_RUN_REPORT_2026-06-19.md
```

### 6.5 DB 적용 후 보고서 완료 처리

커밋:

```text
1482fd7 docs: mark v2 db harness complete
```

내용:

Supabase migration 적용 후 DB harness가 통과한 상태로 보고서를 갱신했다.

---

## 7. Supabase migration 상세

적용된 SQL 파일:

```text
supabase/migrations/002_maintenance_v2.sql
```

생성된 테이블:

| 테이블 | 역할 |
|---|---|
| `manual_anchor_units` | 매뉴얼의 유지보수 단위 |
| `manual_product_anchors` | 실제 제품 화면/route/KMS/Figma와 매뉴얼 단위 연결 |
| `manual_change_signals` | Asana/Figma/manual 변경 신호 |
| `manual_impact_candidates` | 변경 신호가 영향을 줄 후보 단위 |
| `manual_update_drafts` | 사람 검수 전 갱신안 초안 |

중요한 설계 원칙:

- 기존 v1 테이블을 수정/삭제하지 않는 additive migration이다.
- `manual_anchor_units(product, unit_key)`는 unique다.
- `manual_product_anchors(manual_unit_id, anchor_key)`는 unique index다.
- `manual_change_signals(source_type, external_id)`는 unique다.
- `manual_impact_candidates(change_signal_id, manual_unit_id)`는 unique다.
- `manual_update_drafts(impact_candidate_id, draft_type)`는 unique다.
- fixture 재실행 시 중복 생성이 아니라 upsert로 갱신되도록 설계했다.

---

## 8. Fixture 하니스 상세

### 8.1 입력 fixture

파일:

```text
scripts/fixtures/change-signals/storemgmt-product-soldout.json
```

시나리오:

```text
매장관리 백오피스 > 상품관리 > 판매상품관리 > 품절 관련 변경
```

제품:

```text
storemgmt
```

변경 신호 성격:

```text
상품 화면의 품절 처리 UX 변경
```

### 8.2 실제 근거 데이터

하니스가 읽는 realmeasure 경로:

```text
/Users/beaver_bin/Documents/Work_hub/Manual_automation/manual_builder_stg/data/realmeasure/storemgmt
```

읽은 화면 수:

```text
142
```

주의:

이 경로는 현재 로컬 환경의 실제 실측 데이터 경로다.
운영 worker나 CI에서 돌리려면 `REALMEASURE_DIR` 환경변수 또는 storage 기반 입력으로 바꾸어야 한다.

### 8.3 영향 후보 생성 방식

스크립트:

```text
scripts/maintenance/verify-fixture-flow.mjs
```

주요 로직:

1. fixture의 `hints.keywords`, `hints.routes`를 읽는다.
2. realmeasure JSON 전체를 순회한다.
3. 각 화면에서 route, menu, submenu, page, table columns, 텍스트를 flatten한다.
4. route hint match, keyword overlap, menu match, submenu match로 score를 계산한다.
5. score가 0보다 큰 후보를 정렬한다.
6. 상위 N개를 candidate로 만든다.
7. DB mode에서는 Supabase에 change signal, anchor unit, product anchor, impact candidate, update draft를 upsert한다.

현재 scoring 가중치:

| 조건 | 가중치 |
|---|---:|
| route hint match | 0.45 |
| keyword overlap | 최대 0.35 |
| menu가 상품관리 포함 | 0.10 |
| submenu가 판매상품관리 포함 | 0.10 |

---

## 9. 실제 검증 결과

### 9.1 Local fixture harness

명령:

```bash
npm run verify:v2-fixture:local
```

결과:

```text
ok: true
mode: local
screenCount: 142
candidateCount: 5
```

상위 후보:

```text
screenId: 상품관리__판매상품관리__매장_판매상품설정
title: 상품관리 > 판매상품관리 > 매장 판매상품설정
route: /new_product_management/sales_settings/store
score: 1
```

matched terms:

```text
상품
판매상품
품절
품절여부
판매상품설정
```

근거 파일:

```text
/Users/beaver_bin/Documents/Work_hub/Manual_automation/manual_builder_stg/data/realmeasure/storemgmt/상품관리__판매상품관리__매장_판매상품설정.json
/Users/beaver_bin/Documents/Work_hub/Manual_automation/manual_builder_stg/data/realmeasure/storemgmt/상품관리__판매상품관리__매장_판매상품설정.png
```

근거 table column:

```text
품절여부
```

### 9.2 DB fixture harness

명령:

```bash
npm run verify:v2-fixture:db
```

결과:

```text
ok: true
mode: db
screenCount: 142
candidateCount: 5
```

DB 생성/갱신 결과:

```text
changeSignalId: 7b9abe80-5998-4859-a5c6-5d99f87c8c03
rows: 5
```

첫 번째 row:

```text
unitId: a24654a6-8d3b-42b1-bce0-6928aded4edd
anchorId: cb92f257-5b61-4b53-9604-e9a52a7f56a2
impactCandidateId: eb78cc18-d644-4ffa-a35c-4c9b2efb2300
updateDraftId: c2e562ac-1197-4702-b7f4-4443e89a879d
```

전체 row 수:

| 테이블 성격 | 생성/갱신 |
|---|---:|
| change signal | 1 |
| anchor units | 5 |
| product anchors | 5 |
| impact candidates | 5 |
| update drafts | 5 |

### 9.3 전체 검증

명령:

```bash
npm run verify:all
```

통과 항목:

```text
verify:requirements
verify:v2-purpose
verify:v2-fixture:local
typecheck
```

명령:

```bash
npm run build
```

결과:

```text
Next.js production build success
```

운영 URL:

```bash
curl -I https://notionmanualpipeline-production.up.railway.app
```

결과:

```text
HTTP/2 200
```

---

## 10. 현재 package scripts

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "verify:requirements": "node scripts/verify-requirements-harness.mjs",
  "verify:v2-purpose": "node scripts/verify-v2-purpose-harness.mjs",
  "verify:v2-fixture:local": "node scripts/maintenance/verify-fixture-flow.mjs",
  "verify:v2-fixture:db": "node scripts/maintenance/verify-fixture-flow.mjs --db",
  "verify:all": "npm run verify:requirements && npm run verify:v2-purpose && npm run verify:v2-fixture:local && npm run typecheck",
  "worker:conversion": "node scripts/worker/run-conversion-job.mjs",
  "worker:poll": "node scripts/worker/poll-loop.mjs"
}
```

주의:

`verify:all`은 아직 DB fixture를 포함하지 않는다. 이유는 DB write가 항상 필요한 gate가 되면 로컬 개발/CI에서 환경 의존도가 커지기 때문이다.

운영 DB까지 확인하려면 별도로 실행한다.

```bash
npm run verify:v2-fixture:db
```

---

## 11. 환경변수

현재 사용하는 환경변수 이름:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NOTION_TOKEN
NOTION_MANUAL_DATABASE_ID
NOTION_MANUAL_DATA_SOURCE_ID
```

Railway에도 Supabase/Notion 관련 값이 설정되어 있다.

문서/로그/답변에 실제 secret 값을 노출하지 말 것.

---

## 12. 현재 DB 상태 확인용 SQL

Supabase SQL editor에서 row가 들어갔는지 확인하려면 아래 쿼리를 사용한다.

```sql
select count(*) as manual_anchor_units from manual_anchor_units;
select count(*) as manual_product_anchors from manual_product_anchors;
select count(*) as manual_change_signals from manual_change_signals;
select count(*) as manual_impact_candidates from manual_impact_candidates;
select count(*) as manual_update_drafts from manual_update_drafts;
```

fixture change signal:

```sql
select
  id,
  source_type,
  external_id,
  product,
  title,
  status,
  created_at,
  updated_at
from manual_change_signals
where id = '7b9abe80-5998-4859-a5c6-5d99f87c8c03';
```

상위 영향 후보 확인:

```sql
select
  mau.title as manual_unit_title,
  mpa.route,
  mic.score,
  mic.reasons,
  mud.review_status,
  mud.publish_status
from manual_impact_candidates mic
join manual_anchor_units mau on mau.id = mic.manual_unit_id
left join manual_product_anchors mpa on mpa.id = mic.anchor_id
left join manual_update_drafts mud on mud.impact_candidate_id = mic.id
where mic.change_signal_id = '7b9abe80-5998-4859-a5c6-5d99f87c8c03'
order by mic.score desc;
```

---

## 13. 산출물 파일 목록

### 13.1 새로 만든/수정한 핵심 파일

```text
supabase/migrations/002_maintenance_v2.sql
scripts/fixtures/change-signals/storemgmt-product-soldout.json
scripts/maintenance/verify-fixture-flow.mjs
scripts/verify-v2-purpose-harness.mjs
docs/planning/V2_PRODUCT_OPERATING_SYSTEM.md
docs/planning/V2_EXECUTION_HARNESS.md
docs/planning/V2_ANCHOR_SCHEMA.md
docs/planning/V2_MAINTENANCE_PIPELINE_SPEC.md
docs/planning/V2_HARNESS_RUN_REPORT_2026-06-19.md
docs/planning/V2_LLM_HANDOFF_2026-06-19.md
package.json
.gitignore
```

### 13.2 관련 v1 파일

```text
src/components/pipeline-dashboard.tsx
src/components/task-review-gallery.tsx
src/components/slide-review-preview.tsx
src/lib/pipeline/tasks.ts
src/lib/notion/publish.ts
src/lib/notion/assets.ts
scripts/worker/run-conversion-job.mjs
scripts/worker/ppt-parse.mjs
scripts/worker/poll-loop.mjs
```

---

## 14. 다음 작업 계획

다음 작업은 L3/L4/L5로 넘어가야 한다.

### 14.1 L3 Evidence Harness

목표:

```text
impact candidate마다 KMS/realmeasure/route/screenshot 근거가 충분히 연결되는지 검증
```

작업:

1. `manual_update_drafts.evidence_refs` 구조를 더 엄격히 만든다.
2. screenshot file 또는 storage object 경로를 표준화한다.
3. 근거 없는 draft 생성은 실패 처리한다.
4. realmeasure local path 의존성을 storage 기반 또는 worker artifact 기반으로 전환한다.

완료 기준:

```text
각 draft가 최소 1개 이상의 source evidence를 가진다.
근거가 없는 update draft는 생성되지 않는다.
```

### 14.2 변경 신호 등록 API

예상 endpoint:

```text
POST /api/maintenance/change-signals
GET /api/maintenance/change-signals
GET /api/maintenance/change-signals/[id]
POST /api/maintenance/change-signals/[id]/resolve-impact
```

해야 할 일:

1. Supabase server client/service role 사용 위치를 정리한다.
2. request schema를 zod로 정의한다.
3. fixture와 동일한 payload를 API로 넣을 수 있게 한다.
4. API 호출 결과가 `manual_change_signals`와 `manual_impact_candidates`에 반영되게 한다.

### 14.3 영향 후보/갱신안 검수 UI

화면 목적:

```text
매뉴얼 담당자가 무엇이 바뀌었고, 어느 매뉴얼이 왜 영향받았고, 무엇을 승인해야 하는지 보는 화면
```

필수 UI:

1. 변경신호 목록
2. 변경신호 상세
3. 영향 후보 목록
4. 근거 보기
5. 갱신안 초안 보기
6. 승인/수정/제외
7. Notion preview
8. publish status/mapping 확인

주의:

- 대시보드식 장식 UI를 만들지 말 것.
- 더미 데이터 넣지 말 것.
- 반드시 Supabase 실제 데이터를 읽을 것.
- 디자인 시스템 컴포넌트/토큰 기준으로 만들 것.

### 14.4 Notion preview/publish 연결

v1에 이미 Notion 발행 자산이 있다.

관련 파일:

```text
src/lib/notion/publish.ts
src/lib/notion/assets.ts
```

해야 할 일:

1. `manual_update_drafts.review_status = approved | edited`인 항목만 publish 대상이 되게 한다.
2. publish 전 preview를 만든다.
3. publish 후 Notion page/block mapping을 저장한다.
4. 같은 draft 재발행 시 중복 블록이 생기지 않게 idempotency key를 둔다.

### 14.5 Webhook adapter

나중에 붙일 입력:

```text
Asana task
Figma change/comment
manual input
```

현재는 manual fixture로 L2를 닫았다.

---

## 15. 하지 말아야 할 것

1. seed JSON으로 그럴듯한 매뉴얼 UI를 채우지 말 것.
2. 마스터 PPT를 그대로 선적재해서 완성된 제품처럼 보이게 하지 말 것.
3. `PPT -> Notion`만 다시 만들고 v2라고 부르지 말 것.
4. 검수 필요 여부를 시스템이 임의로 단정하지 말 것.
5. 자동 발행을 기본값으로 두지 말 것.
6. 사람 승인 없는 Notion 반영을 만들지 말 것.
7. 새 CSS를 무분별하게 만들지 말 것. 디자인 시스템 토큰/컴포넌트 우선.
8. secret 값을 문서/답변/커밋에 넣지 말 것.

---

## 16. 이어받는 LLM에게 주는 즉시 실행 체크리스트

작업 시작 시:

```bash
cd /Users/beaver_bin/Documents/Work_hub/Manual/Notion_manual_pipeline_v1
git status --short
npm run verify:all
npm run verify:v2-fixture:db
```

운영 확인:

```bash
curl -I https://notionmanualpipeline-production.up.railway.app
```

현재 목표 재확인:

```text
PPT 변환기가 아니라 매뉴얼 유지보수 자동화 v2다.
다음 단계는 변경신호/영향후보/갱신안 검수 UI와 API다.
```

---

## 17. 현재 완료 정의

2026-06-19 기준 완료된 것:

```text
L0 Purpose Harness: 완료
v1 자산 보호 하니스: 완료
L1 Schema Harness: Supabase 원격 DB 적용 완료
L2 Fixture Local Harness: 완료
L2 Fixture DB Harness: 완료
GitHub push: 완료
Railway deploy: 완료
운영 URL 200 확인: 완료
```

아직 완료되지 않은 것:

```text
L3 Evidence Harness
L4 Review Harness
L5 Publish Harness
L6 Production smoke harness
실제 UI/API 기반 end-to-end 운영 플로우
Asana/Figma adapter
```

이 문서를 읽은 다음 작업자는 L3/L4 구현으로 넘어가면 된다.

