# V2 Anchor Schema

작성일: 2026-06-19

## 1. 목적

앵커 스키마는 유지보수 자동화 루프의 중심 계약이다.

해결해야 하는 문제:

> 변경신호는 제품 좌표로 들어오고, 매뉴얼은 사용자 과업 좌표로 쓰여 있다. 둘 사이를 안정적으로 연결하지 못하면 어떤 매뉴얼을 갱신해야 하는지 알 수 없다.

앵커는 다음을 연결한다.

```text
manual unit
<-> product coordinate(route/component/screen)
<-> KMS(class_code/screen_id/chunk)
<-> external signal(Asana/Figma)
```

## 2. 입도 규칙

1차 입도는 **화면 단위**로 고정한다.

이유:

- 문서가 말한 것처럼 "한 화면 = 한 섹션"은 신규/갱신 판정을 결정적으로 만들 수 있다.
- Playwright 실측과 route/screen_id가 화면 단위로 정렬된다.
- KMS도 screen_id/class_code를 보유한다.
- 문장 단위 의미 무효 판단은 사람 승인 단계로 남긴다.

예외:

- 정책/절차 텍스트는 화면 단위 아래 `task | policy` 하위 단위로 둔다.
- 표 데이터는 `table` 단위로 둔다.

## 3. 엔티티

### manual_anchor_units

매뉴얼 유지보수의 최소 검토 단위.

| column | type | 설명 |
| --- | --- | --- |
| id | uuid | PK |
| product | text | `storemgmt`, `opsmgmt` |
| unit_key | text | 안정 키 |
| title | text | 사용자에게 보이는 단위명 |
| granularity | text | `screen`, `task`, `feature`, `policy`, `table` |
| source_type | text | `ppt`, `notion`, `kms`, `generated` |
| source_ref | jsonb | PPT slide, Notion page/block, KMS ref |
| parent_id | uuid | 상위 manual unit |
| status | text | `active`, `stale`, `archived` |
| created_at | timestamptz | 생성 |
| updated_at | timestamptz | 수정 |

### manual_product_anchors

manual unit과 제품 좌표의 연결.

| column | type | 설명 |
| --- | --- | --- |
| id | uuid | PK |
| manual_unit_id | uuid | FK |
| product | text | 제품 |
| route | text | 웹 route |
| screen_id | text | KMS/실측 screen id |
| component_key | text | DOM/Figma/code component 식별자 |
| kms_class_code | text | KMS class_code |
| figma_node_id | text | Figma node |
| confidence | numeric | 0..1 |
| evidence | jsonb | 근거 |
| status | text | `candidate`, `approved`, `rejected`, `stale` |
| created_at | timestamptz | 생성 |
| updated_at | timestamptz | 수정 |

### manual_change_signals

Asana/Figma/manual 변경신호 정규화 결과.

| column | type | 설명 |
| --- | --- | --- |
| id | uuid | PK |
| source_type | text | `asana`, `figma`, `manual` |
| external_id | text | 외부 id |
| product | text | 제품 |
| title | text | 제목 |
| body | text | 원문/요약 |
| hints | jsonb | route, keyword, figma, kms 힌트 |
| raw_payload | jsonb | 원본 |
| status | text | `received`, `resolved`, `queued`, `done`, `failed` |
| created_at | timestamptz | 생성 |
| updated_at | timestamptz | 수정 |

### manual_impact_candidates

변경신호와 manual unit의 영향 후보.

| column | type | 설명 |
| --- | --- | --- |
| id | uuid | PK |
| change_signal_id | uuid | FK |
| manual_unit_id | uuid | FK |
| anchor_id | uuid | FK nullable |
| score | numeric | 영향 점수 |
| reasons | jsonb | 매칭 이유 |
| evidence_refs | jsonb | KMS/실측/Figma/Asana 근거 |
| decision | text | `pending`, `accepted`, `rejected` |
| created_at | timestamptz | 생성 |
| updated_at | timestamptz | 수정 |

### manual_update_drafts

review_required 큐에 올라가는 갱신안.

| column | type | 설명 |
| --- | --- | --- |
| id | uuid | PK |
| impact_candidate_id | uuid | FK |
| draft_type | text | `text`, `screenshot`, `table`, `policy`, `mixed` |
| current_content_ref | jsonb | 기존 매뉴얼 참조 |
| proposed_content | jsonb | 제안 변경안 |
| evidence_refs | jsonb | 근거 |
| review_status | text | `review_required`, `approved`, `edited`, `rejected` |
| publish_status | text | `not_ready`, `ready`, `published`, `failed` |
| created_at | timestamptz | 생성 |
| updated_at | timestamptz | 수정 |

## 4. 영향 후보 점수

1차 점수는 결정적 근거를 우선한다.

| 근거 | 가중치 |
| --- | ---: |
| route exact match | 0.35 |
| kms_class_code/screen_id exact match | 0.30 |
| figma_node_id/component_key match | 0.20 |
| keyword overlap | 0.10 |
| product/category match | 0.05 |

LLM은 점수를 만들지 않는다. LLM은 근거를 설명하거나 문구 초안을 만드는 데만 사용한다.

## 5. 상태 전이

```text
change_signal.received
-> impact_candidate.pending
-> update_draft.review_required
-> update_draft.approved | edited | rejected
-> publish_status.ready
-> published
```

## 6. 1차 구현 순서

1. additive Supabase migration 작성
2. fixture 변경신호 저장 스크립트 작성
3. 기존 KMS/realmeasure를 조회해 anchor 후보를 만드는 resolver 작성
4. impact candidate 생성
5. update draft 생성
6. review UI 연결
7. Notion preview/publish 연결

## 7. 보류 결정

- 마스터 PPT에 갱신 결과를 자동 반영하지 않는다.
- Notion 기존 블록 대량 삭제는 하지 않는다.
- 운영관리 screen realmeasure는 병행 과제로 두며, 1차는 storemgmt를 대상으로 한다.
