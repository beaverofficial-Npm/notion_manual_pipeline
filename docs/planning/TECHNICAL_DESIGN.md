# Technical Design

## 1. 시스템 정의

Notion Manual Pipeline은 PPT 매뉴얼 변환 작업대이다.

역할:

- Vercel/Next.js: 사용자 화면, API orchestration, Notion 발행 요청
- Supabase: 작업 DB, 원본/렌더/asset 저장소, job 상태 저장
- Conversion worker: PPT 렌더링, 객체 파싱, 후보 생성
- Notion API: 최종 매뉴얼 페이지 생성/업데이트

Supabase는 "매뉴얼 데이터를 보여주는 백엔드"가 아니라 파이프라인 상태와 산출물을 저장하는 backend of record이다.

## 2. 아키텍처

```text
User
  |
  v
Next.js on Vercel
  |-- Supabase Auth/DB/Storage
  |-- Notion API
  |
  v
Conversion Job Queue
  |
  v
Conversion Worker
  |-- Microsoft Graph PowerPoint renderer
  |-- Poppler PDF renderer
  |-- python-pptx/XML parser
  |-- image cropper
  |-- QR/table detector
  v
Supabase DB/Storage
```

## 3. 런타임 결정

### 3.1 Vercel에서 처리할 것

- 화면 렌더링
- task 생성/조회 API
- signed upload URL 발급
- job enqueue
- 검수 결과 저장
- Notion 발행 payload 생성
- Notion API 호출

### 3.2 worker에서 처리할 것

- Microsoft Graph upload session 및 PowerPoint PDF 변환
- PDF to PNG 변환
- PPTX 내부 XML/object 파싱
- 이미지 crop 생성
- QR/table 후보 생성
- manifest 저장

### 3.3 이유

대형 PPT 업로드, PDF 렌더링, 대용량 이미지 처리는 Vercel serverless 함수에 부적합하다. Supabase Edge Function도 동일하게 무거운 바이너리 처리에는 맞지 않는다.

MVP에서는 local worker 또는 별도 Node/Python worker를 사용하고, 운영 전환 시 Cloud Run, Render, Fly.io, Railway 같은 container runtime으로 옮긴다. 이 worker는 별도 앱 백엔드가 아니라 변환 파이프라인 runtime이다.

## 4. 데이터 모델

### 4.1 핵심 엔티티

| Entity | 설명 |
| --- | --- |
| `manual_tasks` | 사용자가 만든 변환 작업 |
| `manual_source_files` | 업로드된 원본 PPT |
| `manual_conversion_jobs` | 변환 실행 단위 |
| `manual_slides` | 슬라이드 메타데이터와 render |
| `manual_slide_elements` | PPT 내부 객체 파싱 결과 |
| `manual_assets` | crop/QR/table fallback 이미지 |
| `manual_notion_blocks` | Notion block 후보 |
| `manual_publish_runs` | 발행 실행 단위 |
| `manual_notion_mappings` | local id와 Notion id 매핑 |

### 4.2 상태 enum

`manual_task_status`:

- `draft`
- `ready`
- `running`
- `review_required`
- `ready_to_publish`
- `publishing`
- `published`
- `failed`

`manual_job_status`:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

`manual_review_status`:

- `pending`
- `review_required`
- `approved`
- `excluded`

`manual_asset_kind`:

- `screenshot`
- `qr`
- `table_image`
- `annotation`
- `decorative`
- `unknown`

`manual_block_kind`:

- `heading`
- `paragraph`
- `numbered_list`
- `bulleted_list`
- `callout`
- `image`
- `table`
- `divider`

### 4.3 테이블 개요

#### manual_tasks

| column | type | 설명 |
| --- | --- | --- |
| `id` | uuid | PK |
| `title` | text | 작업명 |
| `status` | enum | 작업 상태 |
| `target_notion_page_id` | text | 발행 대상 page |
| `target_notion_data_source_id` | text | 대상 data source |
| `publish_mode` | text | create_child/update_page |
| `current_run_number` | int | 최신 변환 run |
| `created_at` | timestamptz | 생성일 |
| `updated_at` | timestamptz | 수정일 |

#### manual_source_files

| column | type | 설명 |
| --- | --- | --- |
| `id` | uuid | PK |
| `task_id` | uuid | FK |
| `file_name` | text | 원본 파일명 |
| `storage_path` | text | Supabase Storage path |
| `file_size` | bigint | 파일 크기 |
| `checksum` | text | 중복/무결성 확인 |

#### manual_conversion_jobs

| column | type | 설명 |
| --- | --- | --- |
| `id` | uuid | PK |
| `task_id` | uuid | FK |
| `source_file_id` | uuid | FK |
| `run_number` | int | 재실행 번호 |
| `status` | enum | job 상태 |
| `worker_id` | text | 처리 worker |
| `error_message` | text | 실패 사유 |
| `started_at` | timestamptz | 시작 |
| `finished_at` | timestamptz | 종료 |

#### manual_slides

| column | type | 설명 |
| --- | --- | --- |
| `id` | uuid | PK |
| `task_id` | uuid | FK |
| `job_id` | uuid | FK |
| `slide_number` | int | 1-based slide index |
| `title` | text | 추출 제목 |
| `render_path` | text | slide preview image |
| `width` | numeric | slide width |
| `height` | numeric | slide height |
| `review_status` | enum | 검수 상태 |

#### manual_slide_elements

PPT 원본 객체를 보존한다.

주요 column:

- `slide_id`
- `element_key`
- `element_type`
- `text_content`
- `bbox`
- `z_index`
- `raw`
- `classified_kind`
- `confidence`

#### manual_assets

이미지 산출물 단위이다.

주요 column:

- `slide_id`
- `job_id`
- `kind`
- `label`
- `storage_path`
- `crop_box` (DB 호환용 nullable 컬럼, 현행 고정 캡처 경로에서는 항상 null)
- `source_element_ids`
- `included_annotation_ids`
- `review_status`
- `review_reason`

#### manual_notion_blocks

Notion에 보낼 블록 후보이다.

주요 column:

- `task_id`
- `slide_id`
- `sort_order`
- `kind`
- `content`
- `asset_id`
- `review_status`
- `notion_payload`

#### manual_publish_runs

발행 실행 단위이다.

주요 column:

- `task_id`
- `status`
- `target_page_id`
- `payload`
- `error_message`
- `started_at`
- `finished_at`

#### manual_notion_mappings

Notion 생성 결과를 추적한다.

주요 column:

- `publish_run_id`
- `local_entity_type`
- `local_entity_id`
- `notion_page_id`
- `notion_block_id`

## 5. Storage 설계

| Bucket | Path 예시 | 설명 |
| --- | --- | --- |
| `manual-source` | `{taskId}/source/{fileName}` | 원본 PPT |
| `manual-renders` | `{taskId}/runs/{run}/slides/{n}.png` | 슬라이드 렌더 |
| `manual-assets` | `{taskId}/runs/{run}/assets/{assetId}.png` | crop/QR/table 이미지 |
| `manual-manifests` | `{taskId}/runs/{run}/manifest.json` | worker 산출 manifest |

모든 bucket은 private이다. 클라이언트에는 signed URL만 제공한다.

## 6. API 설계

### 6.1 Task

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/tasks` | 작업 생성, upload URL 발급 |
| `GET` | `/api/tasks` | 작업 리스트 |
| `GET` | `/api/tasks/[taskId]` | 작업 상세 |
| `PATCH` | `/api/tasks/[taskId]` | Notion 대상/작업명 수정 |
| `POST` | `/api/tasks/[taskId]/run` | 변환 job 생성 |

### 6.2 Result review

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/tasks/[taskId]/tree` | 카테고리→기능→슬라이드와 고정 캡처 asset 조회 |
| `PATCH` | `/api/slides/[slideId]` | 슬라이드 제목/검수 상태 수정 |
| `PATCH` | `/api/categories/[categoryId]` | 카테고리 제목 수정 |
| `PATCH` | `/api/functions/[functionId]` | 기능 제목/검수 상태 수정 |

### 6.3 Publish

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/tasks/[taskId]/publish/preview` | Notion payload preview |
| `POST` | `/api/tasks/[taskId]/publish` | 실제 발행 |
| `GET` | `/api/tasks/[taskId]/publish-runs` | 발행 이력 |

### 6.4 Worker

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/worker/jobs/claim` | queued job claim |
| `POST` | `/api/worker/jobs/[jobId]/heartbeat` | worker heartbeat |
| `POST` | `/api/worker/jobs/[jobId]/complete` | 결과 manifest 반영 |
| `POST` | `/api/worker/jobs/[jobId]/fail` | 실패 처리 |

운영에서는 worker가 service role key를 사용한다. 클라이언트에는 노출하지 않는다.

## 7. Manifest 설계

worker는 DB에 직접 쓰거나 manifest를 업로드한 뒤 API가 반영할 수 있다. MVP에서는 디버깅을 위해 manifest 저장을 권장한다.

```json
{
  "taskId": "uuid",
  "jobId": "uuid",
  "runNumber": 1,
  "sourceFile": {
    "storagePath": "manual-source/..."
  },
  "slides": [
    {
      "slideNumber": 1,
      "title": "다운로드 및 설치",
      "renderPath": "manual-renders/...",
      "elements": [],
      "assets": [],
      "notionBlocks": [],
      "warnings": []
    }
  ]
}
```

## 8. Notion 발행 설계

### 8.1 MVP 발행 정책

- 기본은 대상 페이지 아래 새 child page를 생성한다.
- 기존 페이지 update/delete는 MVP 이후 명시 승인 UI와 diff preview를 붙인 뒤 지원한다.
- 발행 전 payload preview를 저장한다.

### 8.2 이미지 처리

- Supabase private asset을 직접 외부 공개하지 않는다.
- Notion file upload API 또는 임시 signed URL 전략을 사용한다.
- Notion이 파일을 가져갈 수 있는 시간 동안만 signed URL을 유지한다.

### 8.3 블록 매핑

발행 후 local `manual_notion_blocks.id`와 Notion block id를 저장한다.

이 매핑은 후속 재발행, diff, 삭제 방지에 필요하다.

## 9. 보안

- `.env`는 git에 포함하지 않는다.
- `SUPABASE_SERVICE_ROLE_KEY`와 `NOTION_TOKEN`은 서버/worker 전용이다.
- 클라이언트에서는 publishable/anon key만 사용한다.
- Storage는 private bucket으로 둔다.
- Notion 대상 page id는 내부 사용자만 입력한다고 가정하되, 발행 전 연결 가능 여부를 서버에서 검증한다.

## 10. 관측성

기록해야 할 로그:

- task 생성
- file upload 완료
- job queued/running/succeeded/failed
- slide별 warning
- review 완료
- publish preview 생성
- publish succeeded/failed

MVP에서는 DB status와 error_message 중심으로 시작하고, 운영 단계에서 Sentry/Logtail 등으로 확장한다.

## 11. UI 구현 제약

- 모든 UI는 Beaverworks Design System 컴포넌트와 token을 우선 사용한다.
- DS 컴포넌트로 해결되지 않는 요소만 token 기반 local component로 만든다.
- 임의 색상, 임의 spacing, 독자 CSS scale을 만들지 않는다.
- 화면은 작업 흐름 중심이다: 리스트, 생성, 결과, 슬라이드 검수.
- 통계 대시보드나 장식적 카드 UI는 범위 밖이다.
