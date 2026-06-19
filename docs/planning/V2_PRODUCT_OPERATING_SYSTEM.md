# V2 Product Operating System

작성일: 2026-06-19

## 1. 제품 목적

이 프로젝트의 목적은 `PPT -> Notion 변환기`가 아니다.

목적은 **매뉴얼 유지보수 자동화 v2**다. 제품 변경이 발생했을 때 사람이 매뉴얼을 통째로 다시 쓰지 않도록, 변경신호를 받아 영향받는 매뉴얼 단위를 식별하고, KMS와 Playwright 실측을 근거로 갱신안을 자동 생성한 뒤, 사람이 승인해서 발행하는 운영 시스템을 만든다.

기준 루프:

```text
제품 변경
-> 변경신호(Asana/Figma)
-> 영향 단위 식별
-> Playwright 실측 + KMS 근거 수집
-> 갱신안 자동 생성
-> review_required 큐
-> 사람 승인/미세조정
-> 발행
```

## 2. 기준 문서

| 우선순위 | 문서 | 역할 |
| --- | --- | --- |
| 1 | `Manual/비버 가이드/매뉴얼_유지보수_자동화_계획개요.md` | v2 유지보수 루프의 직접 기준 |
| 2 | `Manual/비버 가이드/매뉴얼자동화_v2_설계.md` | 상위 아키텍처, 도메인 KB, IR, 어댑터 방향 |
| 3 | `docs/planning/PRD.md` | v1 PPT->Notion 변환기의 제품/운영 기준 |
| 4 | `docs/planning/TECHNICAL_DESIGN.md` | v1 백엔드/스토리지/worker 자산 |
| 5 | `docs/planning/PIPELINE_SPEC.md` | v1 변환/검수/발행 세부 흐름 |

v1은 폐기 대상이 아니라 **기반 자산**이다. 다만 v2의 목적을 v1로 축소하면 안 된다.

## 3. 작업 원칙

1. 기준 문서를 먼저 읽고 Fact / Inference / Assumption / Gap으로 분리한다.
2. 더미, seed, 목업을 제품 결과처럼 만들지 않는다.
3. 실제 인프라(GitHub, Railway, Supabase, Notion, Playwright, KMS)를 기준으로 검증한다.
4. UI보다 먼저 운영 루프와 데이터 계약을 확정한다.
5. 매뉴얼 단위와 제품 좌표를 잇는 앵커가 없으면 영향 식별을 구현하지 않는다.
6. 변경신호 기반 증분 갱신과 전체 PPT 변환을 혼동하지 않는다.
7. 자동 발행을 목표로 하지 않는다. 갱신안 자동 생성 + 사람 승인이 목표다.
8. 구현은 작은 단위로 하되, 매 단위마다 하니스가 통과해야 한다.
9. 배포 가능한 변경은 커밋/푸시/배포/운영 확인까지 마친다.
10. SQL 수동 실행이 필요한 경우 실행 전 보고한다.

## 4. 협업 체계

### Product Manager 관점

- 문제를 유지보수 ROI로 정의한다.
- 성공지표를 먼저 잡는다.
- 기능을 "있으면 좋은 것"이 아니라 유지보수 루프를 닫는 데 필요한지로 판단한다.
- 변경신호, 영향 단위, 승인 큐, 발행 결과의 업무 흐름을 끊기지 않게 설계한다.

### UX/기획 관점

- 사용자는 매뉴얼 담당자/운영 문서 담당자다.
- 핵심 업무는 문서 작성이 아니라 **갱신안 검토와 승인**이다.
- 화면은 대시보드가 아니라 작업 큐여야 한다.
- 사용자는 "무엇이 바뀌었고, 어느 매뉴얼이 왜 영향받았고, 무엇을 승인해야 하는지"를 즉시 알아야 한다.

### Full-stack 개발 관점

- Supabase는 backend of record다.
- Railway worker는 무거운 실측/렌더/후보 생성 runtime이다.
- Next.js는 orchestration, review UI, publish UI를 담당한다.
- Notion 발행은 멱등성과 mapping 저장 없이는 v2 완료로 보지 않는다.

### QA/하니스 관점

- 문서 기준 하니스: 목적이 v1 변환기로 축소되지 않았는지 확인한다.
- 데이터 하니스: seed가 아니라 실제 DB/Storage/실측/KMS를 사용했는지 확인한다.
- 파이프라인 하니스: 변경신호 하나가 review_required 갱신안까지 도달하는지 확인한다.
- 발행 하니스: 승인된 갱신안이 중복 없이 발행되고 mapping이 남는지 확인한다.

## 5. 성공지표

### North Star

제품 변경 1건이 들어왔을 때, 담당자가 매뉴얼 전체를 다시 읽지 않고도 영향 단위와 갱신안을 검토해 발행할 수 있는 비율.

### 핵심 지표

| 지표 | 정의 | 1차 목표 |
| --- | --- | --- |
| 영향 식별 정확도 | 변경신호가 실제 영향 매뉴얼 단위를 Top-N 안에 포함하는 비율 | Top-3 80% |
| 갱신안 채택률 | 자동 생성 갱신안 중 사람이 큰 재작성 없이 승인/수정 승인한 비율 | 60% |
| 검수 시간 절감 | 수동 매뉴얼 수정 대비 review_required 큐에서 완료까지 걸린 시간 감소 | 50% |
| 근거 충실도 | 갱신안이 KMS/Playwright/Figma/Asana 근거를 최소 1개 이상 포함한 비율 | 95% |
| 발행 멱등성 | 같은 갱신안을 재발행해도 중복 블록/페이지가 생기지 않는 비율 | 100% |
| 회귀 방지 | 더미/seed 제품 경로가 하니스에서 차단되는 비율 | 100% |

### 보조 지표

- Playwright 실측 성공률
- KMS anchor coverage
- review_required 큐 처리율
- 발행 실패 후 재시도 성공률
- 사람 승인 후 KB/anchor 환류율

## 6. 비목표

- seed JSON을 앱에 넣어 그럴듯한 화면을 만드는 것
- PPT 전체를 매번 다시 변환하는 것을 v2 유지보수라고 부르는 것
- 무인 자동 발행
- 운영팀 소유 biber-field-app Supabase 직접 질의
- 모든 제품을 한 번에 대상으로 삼는 것
- Figma/Asana 연동 없이 변경신호를 임의 추측하는 것

## 7. 완료 정의

v2 1차 완료는 다음 조건을 모두 만족해야 한다.

1. 앵커 스키마가 Supabase에 존재한다.
2. 최소 storemgmt 기준 manual unit과 KMS/route/screen_id anchor가 저장된다.
3. 변경신호를 수동 입력 또는 fixture로 넣을 수 있다.
4. 변경신호가 영향 후보 manual unit을 생성한다.
5. 후보마다 근거(KMS, route, 실측 JSON, 신호 원문)가 저장된다.
6. Playwright 실측 또는 기존 realmeasure를 갱신안 근거로 연결한다.
7. review_required 큐에서 사람이 승인/수정/제외할 수 있다.
8. 승인된 갱신안은 Notion 발행 preview를 만든다.
9. 발행 결과와 mapping이 저장된다.
10. 전체 흐름을 검증하는 하니스가 CI/로컬에서 실행된다.

## 8. 현재 하니스 상태

| 레벨 | 상태 | 근거 |
| --- | --- | --- |
| L0 목적 하니스 | 통과 | `npm run verify:v2-purpose` |
| v1 자산 보호 | 통과 | `npm run verify:requirements` |
| L1 Schema | 원격 DB 적용 완료 | `supabase/migrations/002_maintenance_v2.sql` |
| L2 Fixture local | 통과 | `npm run verify:v2-fixture:local` |
| L2 Fixture DB | 통과 | `npm run verify:v2-fixture:db` |
| L3~L5 | 미구현 | 갱신안 UI/승인/멱등 발행 필요 |
