# V2 Harness Run Report - 2026-06-19

## 결론

매뉴얼 유지보수 자동화 v2의 첫 실행 하니스는 로컬 증거 기반으로 통과했다.

이번 실행은 PPT를 단순 변환하는 흐름이 아니라, 제품 변경 신호를 받아 실제 화면 실측 데이터에서 영향 매뉴얼 단위를 찾고, 갱신안 초안을 만드는 루프를 검증하는 목적이다.

원격 Supabase DB 쓰기 검증까지 닫혔다. v2 migration 적용 후 fixture harness가 실제 Supabase row 생성까지 성공했다.

## 현재 반영된 커밋

| 커밋 | 상태 | 내용 |
|---|---|---|
| `d756572` | deployed | 잘못된 seeded manual builder runtime path 제거 |
| `22291f8` | deployed | v2 목적/운영체계/하니스 문서화 |
| `0ff5c25` | deployed | v2 fixture harness 구현 |

Railway 최신 운영 배포는 `0ff5c25235cb10756ff60b6b54ee1fdbb14f066c` 기준 `SUCCESS` 상태다.

운영 URL:

```text
https://notionmanualpipeline-production.up.railway.app
```

운영 URL `HEAD` 요청 결과는 `HTTP/2 200`이다.

## 이번에 검증한 흐름

### 입력 변경 신호

Fixture:

```text
scripts/fixtures/change-signals/storemgmt-product-soldout.json
```

변경 시나리오:

```text
매장관리 백오피스 > 상품관리 > 판매상품관리 > 품절 관련 변경
```

### 실제 근거 데이터

Realmeasure source:

```text
/Users/beaver_bin/Documents/Work_hub/Manual_automation/manual_builder_stg/data/realmeasure/storemgmt
```

읽은 화면 수:

```text
142
```

생성된 영향 후보 수:

```text
5
```

상위 후보:

```text
상품관리 > 판매상품관리 > 매장 판매상품설정
route: /new_product_management/sales_settings/store
score: 1
matched terms: 상품, 판매상품, 품절, 품절여부, 판매상품설정
```

근거:

```text
상품관리__판매상품관리__매장_판매상품설정.json
상품관리__판매상품관리__매장_판매상품설정.png
table column: 품절여부
```

## 통과한 검증

```bash
npm run verify:all
```

통과 항목:

| Gate | 결과 |
|---|---|
| `verify:requirements` | v1 PPT/Notion pipeline 자산 유지, seeded manual-builder runtime path 차단 |
| `verify:v2-purpose` | 프로젝트 목적이 change-signal driven maintenance automation으로 유지됨 |
| `verify:v2-fixture:local` | 실제 realmeasure 데이터에서 영향 후보 및 갱신안 생성 성공 |
| `typecheck` | 통과 |

```bash
npm run build
```

결과:

```text
Next.js production build success
```

## 원격 DB 검증 상태

실행:

```bash
npm run verify:v2-fixture:db
```

결과:

```text
ok: true
mode: db
screenCount: 142
candidateCount: 5
changeSignalId: 7b9abe80-5998-4859-a5c6-5d99f87c8c03
rows: 5
```

판단:

```text
v2 DB schema 적용 및 실제 DB 쓰기 검증 완료.
```

## DB migration 적용 이력

Supabase SQL editor에서 아래 migration이 적용되었다.

```text
supabase/migrations/002_maintenance_v2.sql
```

생성된 v2 테이블:

| 테이블 | 역할 |
|---|---|
| `manual_anchor_units` | 매뉴얼의 유지보수 단위 |
| `manual_product_anchors` | 실제 제품 화면/route/KMS/Figma와 매뉴얼 단위 연결 |
| `manual_change_signals` | Asana/Figma/manual 변경 신호 |
| `manual_impact_candidates` | 변경 신호가 영향을 줄 후보 단위 |
| `manual_update_drafts` | 사람 검수 전 갱신안 초안 |

## DB에 생성된 검증 row

| 항목 | 값 |
|---|---|
| change signal | `7b9abe80-5998-4859-a5c6-5d99f87c8c03` |
| anchor units | 5 rows |
| product anchors | 5 rows |
| impact candidates | 5 rows |
| update drafts | 5 rows |

모두 fixture 재실행 시 중복 생성이 아니라 upsert로 갱신된다.

## 다음 제품 구현 순서

1. v2 DB migration 적용 및 DB fixture harness 통과
2. 변경 신호 등록 API 구현
3. 영향 후보 목록 UI 구현
4. 갱신안 검수 UI 구현
5. Notion preview/publish를 v1 발행 자산과 연결
6. 발행 mapping/feedback loop 저장
7. Asana/Figma webhook adapter 연결

## 성공 기준

이 프로젝트는 단순히 PPT를 노션으로 옮기는 도구가 아니다.

성공 기준은 다음이다.

```text
제품 변경이 발생했을 때,
어떤 매뉴얼 단위가 영향받는지 시스템이 먼저 후보를 만들고,
근거 화면/문서/측정값을 함께 제시하고,
사람은 검수와 승인에 집중하며,
승인된 변경만 Notion에 중복 없이 반영되고,
그 mapping과 피드백이 다음 자동화 품질로 누적된다.
```
