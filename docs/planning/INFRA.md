# Infrastructure

## GitHub

- Repository: https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline

## Supabase

Project URL:

- Dashboard: https://supabase.com/dashboard/project/vceuudebsqojbcsdtybd
- Project ref: `vceuudebsqojbcsdtybd`
- API URL: `https://vceuudebsqojbcsdtybd.supabase.co`

## Required Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://vceuudebsqojbcsdtybd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NOTION_TOKEN=
NOTION_MANUAL_DATABASE_ID=
NOTION_MANUAL_DATA_SOURCE_ID=
```

## Supabase Storage Buckets

| Bucket | Purpose | Public |
| --- | --- | --- |
| `manual-source` | 원본 PPT 저장 | No |
| `manual-renders` | 슬라이드 렌더 이미지/PDF 저장 | No |
| `manual-assets` | crop/QR/표/어노테이션 결과 이미지 저장 | No |
| `manual-manifests` | worker 산출 manifest 저장 | No |

## Supabase Database

초기 스키마는 `supabase/schema.sql`을 기준으로 적용한다.

주요 테이블:

- `manual_tasks`
- `manual_source_files`
- `manual_conversion_jobs`
- `manual_slides`
- `manual_slide_elements`
- `manual_assets`
- `manual_notion_blocks`
- `manual_publish_runs`
- `manual_notion_mappings`

Supabase는 결과물을 보여주기 위한 실데이터 저장소가 아니라 변환 파이프라인의 상태, 원본, 중간 산출물, 검수 결정, 발행 이력을 저장하는 backend of record이다.

## Vercel

Vercel에는 위 환경변수를 동일하게 등록한다.

주의:

- `SUPABASE_SERVICE_ROLE_KEY`와 `NOTION_TOKEN`은 서버 전용이다.
- 클라이언트 컴포넌트에서 service role key를 참조하면 안 된다.
- PPT 파싱, LibreOffice 렌더링, PDF/PNG 변환은 Vercel API route에서 처리하지 않고 conversion worker로 분리한다.

## Conversion Worker

MVP에서는 local worker로 시작할 수 있다. 운영 전환 시 container runtime으로 배포한다.

역할:

- queued job claim
- PPTX to PDF 변환
- slide PNG render
- PPT object/XML parsing
- crop/QR/table 후보 생성
- manifest 저장
- DB 상태 업데이트

후보 런타임:

- Cloud Run
- Render worker
- Fly.io machine
- Railway worker

이 worker는 별도 앱 백엔드가 아니라 무거운 파일 변환을 처리하는 파이프라인 runtime이다.
