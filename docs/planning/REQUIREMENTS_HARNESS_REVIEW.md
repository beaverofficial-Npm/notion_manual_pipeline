# V1 Asset Guard Harness Review

작성일: 2026-06-19

## 결론

진행 가능.

이 문서는 v2 제품 목적 문서가 아니다. v2 목적은 `V2_PRODUCT_OPERATING_SYSTEM.md`를 기준으로 한다.

이 하니스의 역할은 v2 기반 자산인 v1 PPT->Notion 파이프라인이 깨지지 않았는지, 그리고 앱 런타임이 seed/manual-builder 뷰어로 다시 새지 않는지 확인하는 것이다.

## 사실

| 항목 | 확인 내용 |
| --- | --- |
| v1 자산 | PPT 매뉴얼을 업로드해 Notion 발행 가능한 초안을 만들고, 웹에서 검수/수정/발행한다. |
| Backend of record | Supabase DB/Storage가 작업, 원본, 렌더, asset, Notion 후보, 발행 이력을 저장한다. |
| Worker | Railway 컨테이너에서 Microsoft Graph PowerPoint/Poppler 기반 변환 worker가 queued job을 처리한다. |
| Notion | 발행 전 preview를 만들고, 승인 후 Notion page/block을 생성한다. |
| 금지된 방향 | 앱 런타임에 사전 생성된 마스터 문서 JSON/seed 데이터를 넣고 제품처럼 보여주는 방식. |

## v1 자산 보호 기준

1. 첫 화면은 실제 작업 생성 화면이어야 한다.
2. 목록은 Supabase의 실제 `manual_tasks`만 표시해야 한다.
3. PPT 입력은 사용자가 업로드한 원본으로 저장되어야 한다.
4. 변환 결과는 worker가 생성하고 DB/Storage에 저장해야 한다.
5. 목차/표지/구분 슬라이드는 발행 대상이 아니라 구조 판별 근거로 처리한다.
6. 검수 화면은 저장된 slide/asset/block 후보를 수정하는 화면이어야 한다.
7. Notion 발행은 검수 결과를 기반으로 preview 후 실행한다.
8. 앱 런타임에 더미/seed/manual-builder JSON을 import해서 보여주면 안 된다.

## 제거한 잘못된 방향

| 제거 항목 | 이유 |
| --- | --- |
| `/manual-builder` | 실제 업로드/worker 결과가 아니라 내장 seed 데이터 기준 화면이었다. |
| `/api/manual-builder/storemgmt` | Supabase 작업 데이터가 아니라 앱 내부 JSON을 내려줬다. |
| `src/data/manual-builder/*.json` | 운영 입력이 아닌 사전 생성 데이터가 런타임에 포함됐다. |
| 메인 `매뉴얼 빌더` 진입 링크 | 사용자의 시작점을 실제 변환 플로우가 아닌 seed 검토 화면으로 분산시켰다. |

## 현재 유지할 v1 흐름

```text
메인 화면
-> PPT 파일 업로드 + Notion 대상 입력
-> POST /api/tasks
-> Supabase Storage manual-source 저장
-> manual_tasks/manual_source_files 생성
-> POST /api/tasks/:taskId/run
-> manual_conversion_jobs queued
-> Railway worker 처리
-> manual_slides/manual_assets/manual_notion_blocks 저장
-> /tasks/:taskId/review 검수/수정
-> Notion preview
-> Notion 발행
-> manual_publish_runs/manual_notion_mappings 저장
```

## v2로 넘겨야 하는 Gap

| Gap | 영향 | 다음 조치 |
| --- | --- | --- |
| 마스터 문서 신규 업로드를 "매뉴얼 유지보수 기준 소스"로 관리하는 별도 버전 모델 없음 | PPT 변환 작업과 장기 유지보수 기준선이 섞일 수 있음 | `manual_sources` 또는 `manual_master_versions` 설계 필요 |
| 변경된 기능 업데이트 흐름 미구현 | 새 기능/수정 기능만 재분석하는 운영 시나리오가 약함 | 변경 입력 -> 영향 slide/function 후보 -> 부분 재발행 설계 |
| 자동 품질 게이트가 UI에 충분히 반영되지 않음 | 사용자가 모든 페이지를 직접 검수해야 할 수 있음 | block/asset별 blocking/advisory reason 저장과 필터 강화 |
| KMS/Notion 기존 문서와의 diff 없음 | 새 발행과 기존 문서 유지보수 연결이 약함 | Notion/KMS import 후 manual unit diff 설계 |

## 하니스 기준

`npm run verify:requirements`는 다음을 실패로 처리한다.

- `/manual-builder` 라우트 존재
- `/api/manual-builder` 라우트 존재
- `src/data/manual-builder` 런타임 seed 데이터 존재
- 앱 코드에서 `manual-builder`, `storemgmt_anchor`, `storemgmt_normalized` 참조
- PRD/파이프라인 핵심 API 또는 worker 파일 누락

이 하니스는 제품 방향이 seed 뷰어로 다시 새지 않게 막기 위한 최소 안전장치다.
