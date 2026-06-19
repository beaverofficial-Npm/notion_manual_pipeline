# V2 Execution Harness

작성일: 2026-06-19

## 1. 하니스 목적

하니스의 목적은 "테스트를 돌렸다"가 아니라, 작업자가 제품 목적에서 벗어나지 못하게 하고 운영 루프가 실제로 닫히는지 증명하는 것이다.

검증 대상:

```text
변경신호
-> 영향 단위 식별
-> 근거 수집
-> 갱신안 생성
-> review_required 큐
-> 사람 승인
-> Notion preview/publish
-> mapping 저장
```

## 2. 하니스 레벨

| 레벨 | 이름 | 목적 | 실패 조건 |
| --- | --- | --- | --- |
| L0 | Purpose Harness | v2 목적이 v1 변환기로 축소되지 않았는지 확인 | seed/manual-builder 경로, v2 기준 문서 누락 |
| L1 | Schema Harness | 앵커/변경신호/갱신안/승인 큐 데이터 계약 확인 | 필수 테이블/enum/API 누락 |
| L2 | Fixture Harness | fixture 변경신호 1건이 영향 후보를 만드는지 확인 | 영향 후보 0건, 근거 없음 |
| L3 | Evidence Harness | KMS/Playwright/Figma/Asana 근거 연결 확인 | 근거 없는 갱신안 생성 |
| L4 | Review Harness | 사람이 승인/수정/제외할 수 있는지 확인 | review_required 큐 저장 불가 |
| L5 | Publish Harness | 승인된 갱신안 preview/publish/mapping 확인 | 중복 발행, mapping 누락 |
| L6 | Deployment Harness | Railway production에서 동일 흐름 smoke 확인 | 배포 실패, API/worker 불일치 |

## 3. 1차 fixture

fixture는 더미 제품 데이터가 아니라 **검증용 변경신호**다. 실제 KMS/실측/매뉴얼 anchor를 조회해야 통과한다.

```json
{
  "product": "storemgmt",
  "source_type": "manual",
  "title": "상품 화면의 품절 처리 UX 변경",
  "body": "판매상품 목록에서 품절 상태 표시와 품절 토글 위치가 변경되었다. 상품관리/판매상품 관련 매뉴얼 갱신 필요.",
  "product_hints": {
    "routes": ["/products", "/store/products"],
    "keywords": ["상품", "판매상품", "품절", "토글"],
    "kms_class_codes": [],
    "figma_node_ids": []
  }
}
```

이 fixture의 기대 결과:

- product는 `storemgmt`로 확정된다.
- 영향 후보에 상품/판매상품/품절 관련 manual unit이 포함된다.
- 후보는 KMS keyword/class_code 또는 realmeasure route/screen 근거를 최소 1개 이상 가진다.
- 갱신안은 자동 발행이 아니라 `review_required`로 들어간다.

## 4. 필요한 데이터 계약

### 4.1 Anchor

manual unit과 제품 좌표를 잇는다.

필수 속성:

- product: `storemgmt | opsmgmt`
- manual_unit_id
- manual_source_type: `ppt | notion | kms | generated`
- manual_title
- granularity: `screen | task | feature | policy | table`
- route
- component_key
- kms_class_code
- kms_screen_id
- figma_node_id
- confidence
- evidence
- status: `candidate | approved | rejected | stale`

### 4.2 Change Signal

Asana/Figma/manual 입력을 정규화한다.

필수 속성:

- source_type: `asana | figma | manual`
- external_id
- product
- title
- body
- route_hints
- component_hints
- kms_hints
- figma_hints
- received_at
- status

### 4.3 Impact Candidate

변경신호가 어떤 매뉴얼 단위에 영향을 줄 가능성이 있는지 저장한다.

필수 속성:

- change_signal_id
- manual_anchor_id
- score
- reasons
- evidence_refs
- decision: `pending | accepted | rejected`

### 4.4 Update Draft

사람이 검토할 갱신안이다.

필수 속성:

- impact_candidate_id
- draft_type: `text | screenshot | table | policy | mixed`
- current_content_ref
- proposed_content
- evidence_refs
- review_status: `review_required | approved | edited | rejected`
- publish_status

## 5. 작업 단계별 게이트

### Gate A. 설계 진입

통과 조건:

- v2 목적 문서 존재
- 앵커 스키마 초안 존재
- 성공지표 존재
- 비목표 존재

### Gate B. DB 변경 전

통과 조건:

- SQL migration 초안 존재
- 수동 실행 SQL이 있으면 보고 대상 분리
- rollback 또는 additive migration 원칙 확인

### Gate C. API 구현 전

통과 조건:

- endpoint별 입출력 계약 존재
- fixture 기반 expected response 존재
- 권한/서비스키 노출 금지 확인

### Gate D. UI 구현 전

통과 조건:

- 사용자가 처리할 작업 큐 정의
- 빈 상태, 실패 상태, 근거 확인 상태 정의
- "대시보드"가 아니라 "갱신안 검토 업무 화면"임을 확인

### Gate E. 배포 전

통과 조건:

- `npm run verify:requirements`
- `npm run verify:v2-purpose`
- `npm run typecheck`
- `npm run build`
- fixture harness 통과

## 6. 하니스 산출물

1. `scripts/verify-v2-purpose-harness.mjs`
2. `supabase/migrations/*_maintenance_v2.sql`
3. `scripts/fixtures/change-signals/storemgmt-product-soldout.json`
4. `scripts/maintenance/resolve-impact-candidates.mjs`
5. `scripts/maintenance/generate-update-draft.mjs`
6. `docs/planning/V2_ANCHOR_SCHEMA.md`
7. `docs/planning/V2_MAINTENANCE_PIPELINE_SPEC.md`
8. `docs/planning/V2_COMPLETION_REPORT.md`

## 7. 현재 판정

현재 상태는 **L0 통과, L1 원격 DB 적용 완료, L2 local fixture 통과, L2 DB fixture 통과**다.

- v1 PPT->Notion 변환기는 운영 자산으로 존재한다.
- seed/manual-builder 경로는 제거됐다.
- v2 유지보수 루프의 additive migration은 `supabase/migrations/002_maintenance_v2.sql`에 작성됐고 Supabase 원격 DB에 적용됐다.
- `scripts/fixtures/change-signals/storemgmt-product-soldout.json` 변경신호 fixture가 존재한다.
- `npm run verify:v2-fixture:local`은 실제 storemgmt realmeasure 142건을 읽어 영향 후보를 생성한다.
- DB row 생성 하니스인 `npm run verify:v2-fixture:db`는 통과했다.

따라서 다음 실제 작업은 **L3 Evidence Harness**, **변경신호 API**, **갱신안 검수 UI** 구현이다.
