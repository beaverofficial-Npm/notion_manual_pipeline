# V2 Maintenance Pipeline Spec

작성일: 2026-06-19

## 1. 한 줄 정의

제품 변경신호를 받아 영향받는 매뉴얼 단위를 찾고, KMS와 Playwright 실측 근거로 갱신안을 생성해 사람이 승인/발행하는 증분 유지보수 파이프라인.

## 2. v1과 v2의 관계

| 구분 | v1 PPT->Notion | v2 유지보수 자동화 |
| --- | --- | --- |
| 시작점 | PPT 업로드 | 제품 변경신호 |
| 처리 단위 | 전체 PPT/task | 영향받은 manual unit |
| 목적 | 최초 이관/정방향 변환 | 현행 유지/증분 갱신 |
| 자동화 결과 | Notion 발행 초안 | 근거가 붙은 갱신안 |
| 사람 역할 | 전체 검수 | 영향 후보 승인/미세조정 |
| 발행 | 새 페이지 중심 | 멱등 갱신 필요 |

v1의 렌더, asset, review_required, publish run, Notion mapping 구조는 v2가 재사용한다.

## 3. 1차 대상

- Product: `storemgmt`
- 이유: KMS 적재량이 많고, Playwright 실측 142건이 이미 있다.
- 변경신호 입력: 1차는 manual fixture로 시작한다. Asana/Figma API 연동은 이후 adapter로 확장한다.

## 4. 핵심 워크플로우

```text
1. change signal ingest
2. normalize product hints
3. find anchor candidates
4. score impact candidates
5. collect evidence
6. generate update draft
7. enqueue review_required
8. human approve/edit/reject
9. generate Notion preview
10. publish idempotently
11. persist mappings and feedback
```

## 5. API 초안

| Method | Path | 목적 |
| --- | --- | --- |
| POST | `/api/maintenance/change-signals` | 변경신호 생성/수신 |
| GET | `/api/maintenance/change-signals` | 변경신호 목록 |
| POST | `/api/maintenance/change-signals/[id]/resolve` | 영향 후보 생성 |
| GET | `/api/maintenance/change-signals/[id]/impact-candidates` | 영향 후보 조회 |
| POST | `/api/maintenance/impact-candidates/[id]/draft` | 갱신안 생성 |
| GET | `/api/maintenance/update-drafts` | review_required 큐 |
| PATCH | `/api/maintenance/update-drafts/[id]` | 승인/수정/거절 |
| POST | `/api/maintenance/update-drafts/[id]/publish/preview` | 발행 preview |
| POST | `/api/maintenance/update-drafts/[id]/publish` | 발행 |

## 6. 스크립트 초안

| Script | 목적 |
| --- | --- |
| `scripts/maintenance/ingest-change-signal.mjs` | fixture/manual 변경신호 저장 |
| `scripts/maintenance/resolve-impact-candidates.mjs` | anchor/KMS/realmeasure 기반 영향 후보 생성 |
| `scripts/maintenance/generate-update-draft.mjs` | evidence 기반 갱신안 생성 |
| `scripts/maintenance/verify-fixture-flow.mjs` | fixture 1건 E2E 검증 |

## 7. 데이터 소스

### KMS

역할:

- 절차/정책/표/상태 로직의 권위 소스
- class_code, screen_id, chunk_version, is_latest를 anchor와 evidence로 사용

금지:

- KMS 내용을 무근거로 최종 발행하지 않는다.
- KMS만으로 live behavior를 확정하지 않는다.

### Playwright realmeasure

역할:

- route/screen/table/filter/toolbar/DOM 근거
- 시각·구조 갱신 검증

1차 제약:

- storemgmt는 기존 142건 실측을 사용한다.
- opsmgmt는 화면별 실측이 부족하므로 병행 과제로 둔다.

### Figma/Asana

역할:

- 변경신호 입력과 변경 의도 근거
- 1차는 manual fixture로 대체하되 데이터 계약은 source_type으로 열어둔다.

## 8. 갱신안 생성 원칙

1. 갱신안은 항상 근거를 포함한다.
2. 근거 없는 문장 생성은 실패로 처리한다.
3. 시각/구조 변경은 Playwright/Figma 근거를 우선한다.
4. 절차/정책 텍스트는 KMS와 실측 근거를 함께 요구한다.
5. 자동 발행하지 않고 `review_required`로 둔다.
6. 사람이 수정한 결과는 anchor/KMS feedback 후보로 남긴다.

## 9. 1차 구현 마일스톤

### M1. Schema

- `manual_anchor_units`
- `manual_product_anchors`
- `manual_change_signals`
- `manual_impact_candidates`
- `manual_update_drafts`

완료 조건:

- additive migration 작성: `supabase/migrations/002_maintenance_v2.sql`
- SQL 실행 전 보고 가능
- type/API contract 문서화

### M2. Fixture Impact

- storemgmt 상품/품절 fixture 저장
- anchor/KMS/realmeasure 후보 조회
- Top-N impact candidates 생성

완료 조건:

- 후보 1개 이상
- evidence_refs 1개 이상
- score/reasons 저장

현재 구현:

- fixture: `scripts/fixtures/change-signals/storemgmt-product-soldout.json`
- local harness: `npm run verify:v2-fixture:local`
- DB harness: `npm run verify:v2-fixture:db`
- local 결과: storemgmt realmeasure 142건 중 `상품관리 > 판매상품관리 > 매장 판매상품설정`을 Top 후보로 탐지, `품절여부` table column evidence 확보

### M3. Draft Queue

- impact candidate에서 update draft 생성
- review_required 큐 API
- 승인/수정/거절 저장

완료 조건:

- UI 없이도 API/스크립트로 상태 전이 확인

### M4. Review UI

- 변경신호 목록
- 영향 후보
- 근거 패널
- 갱신안 diff
- 승인/수정/거절

완료 조건:

- 사용자가 "무엇이 바뀌었고, 왜 이 매뉴얼이 영향받았고, 무엇을 승인해야 하는지" 알 수 있음

### M5. Publish

- Notion preview
- 멱등 mapping
- 발행 이력

완료 조건:

- 재발행 시 중복 생성 방지 전략 적용

## 10. E2E 하니스 시나리오

입력:

```text
상품 화면의 품절 처리 UX 변경
```

기대:

1. `manual_change_signals` row 생성
2. `manual_impact_candidates`에 상품/품절 관련 후보 생성
3. 후보는 KMS 또는 realmeasure evidence를 가진다.
4. `manual_update_drafts`가 `review_required`로 생성된다.
5. 사람이 `approved` 또는 `edited`로 바꿀 수 있다.
6. Notion preview가 생성된다.
7. 발행 후 mapping이 저장된다.

현재 자동 검증 범위:

- local: 2~3 일부 검증. DB 없이 realmeasure evidence 기반 후보 생성까지 검증한다.
- db: 1~4 검증 예정. `002_maintenance_v2.sql` 적용 후 실행한다.
- publish: 5~7은 아직 미구현이다.

## 11. 성공/실패 판정

성공:

- 변경신호 하나가 review_required 갱신안까지 도달한다.
- 모든 갱신안에는 근거가 있다.
- 발행은 사람이 승인한 뒤에만 가능하다.

실패:

- seed 데이터로 결과를 대체한다.
- 영향 후보가 근거 없이 생성된다.
- v1 전체 PPT 변환을 v2 유지보수로 포장한다.
- Notion 발행이 중복/파괴적으로 동작한다.
