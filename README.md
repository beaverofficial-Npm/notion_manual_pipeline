# Notion Manual Pipeline v1

PPT 매뉴얼을 분석하고, 화면/QR/표/어노테이션 후보를 검수한 뒤 Notion 매뉴얼로 발행하는 내부 도구입니다.

## Stack

- Next.js App Router
- Vercel
- Supabase Postgres + Storage
- Notion API
- Beaverworks Design System

## Repository

https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Pipeline

1. PPT 업로드
2. 슬라이드 이미지 렌더링
3. 텍스트, 화면 이미지, QR, 표 후보 추출
4. 웹에서 크롭/어노테이션 검수
5. Notion 페이지 생성 또는 업데이트

## Planning Docs

- [PRD](docs/planning/PRD.md)
- [IA](docs/planning/IA.md)
- [Conversion Rules](docs/planning/CONVERSION_RULES.md)
- [Pipeline Specification](docs/planning/PIPELINE_SPEC.md)
- [Technical Design](docs/planning/TECHNICAL_DESIGN.md)
- [Development Plan](docs/planning/DEVELOPMENT_PLAN.md)
- [E2E Pipeline Plan](docs/planning/E2E_PIPELINE_PLAN.md)
- [Quality Gates](docs/planning/QUALITY_GATES.md)
- [Infrastructure](docs/planning/INFRA.md)

## Supabase

`supabase/schema.sql`을 프로젝트 DB에 적용합니다. Storage bucket은 아래처럼 시작합니다.

- Project ref: `vceuudebsqojbcsdtybd`
- API URL: `https://vceuudebsqojbcsdtybd.supabase.co`

- `manual-source`: 원본 PPT
- `manual-renders`: 슬라이드 PNG/PDF 렌더
- `manual-assets`: 크롭/어노테이션 결과 이미지
- `manual-manifests`: 변환 worker manifest

## Environment

See `.env.example`.
