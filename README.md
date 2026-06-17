# Notion Manual Pipeline

PPT 통합가이드를 분석해 목차 기준으로 정리하고, 웹에서 검토·수정한 뒤 Notion 매뉴얼로 발행하는 내부 도구입니다.

## 파이프라인

1차 — 변환
1. PPT 업로드 (`manual-source` 버킷 저장)
2. LibreOffice로 PDF 변환 후 슬라이드를 PNG로 렌더(기본 300DPI)
3. 슬라이드 역할 판별(표지·목차·섹션·본문). 표지·목차는 본문에서 제외하되 목차 정보는 카테고리 분류에 사용
4. 섹션 표지 기준으로 카테고리 → 기능 트리 생성, 연속 동일 기능명은 한 기능으로 병합
5. 본문 위계 추출(단계 번호 → numbered, 하위 → bullet, 주의/참고 → callout, 표 → table)
6. 이미지 영역(zone) 클러스터링 — 인접 이미지를 하나의 영역으로 묶어 화살표·어노테이션까지 함께 크롭 대상으로 잡음

2차 — 검토·발행
1. 검수 화면에서 카테고리/기능 트리를 보며 기능별 슬라이드를 확인
2. 크롭 영역을 드래그로 조정·추가·삭제하고 이름 수정(모든 편집은 자동 저장)
3. 발행 미리보기로 페이지별 구성 확인
4. Notion으로 발행 — 단일 페이지에 카테고리(heading_1)·기능(heading_2) 헤딩과 내용·이미지를 인라인 배치. 헤딩 기반이라 Notion 우측 사이드 아웃라인이 목차 역할을 함. 이미지는 잘라서 Notion 네이티브 파일 업로드. 진행 상황은 스트리밍으로 표시되며 중간 취소 가능

## 스택

- Next.js App Router
- Supabase (Postgres + Storage)
- Notion REST API
- Beaverworks Design System
- 변환 worker: LibreOffice(`soffice`) + Poppler(`pdftoppm`) + sharp

## 로컬 실행

```bash
npm install
cp .env.example .env   # 값 채우기 (아래 Environment 참고)
npm run dev            # 웹 (검수/발행)
```

변환 worker는 로컬 바이너리가 필요합니다.

```bash
brew install --cask libreoffice
brew install poppler
npm run worker:conversion   # queued 상태의 변환 job을 처리
```

`RENDER_DPI`(기본 300), `SOFFICE_BIN`, `PDFTOPPM_BIN` 환경변수로 렌더 도구 경로·해상도를 조정할 수 있습니다.

## Supabase

DB에 스키마를 적용합니다.

```sql
-- 신규 설치
supabase/schema.sql
-- 기존 스키마 위 계층(카테고리/기능) 추가 (idempotent)
supabase/migrations/001_hierarchy.sql
```

Storage 버킷(`supabase/storage.sql`):

- `manual-source` — 원본 PPT
- `manual-renders` — 슬라이드 PNG 렌더
- `manual-assets` — 크롭 결과 이미지
- `manual-manifests` — 변환 worker manifest

- Project ref: `vceuudebsqojbcsdtybd`
- API URL: `https://vceuudebsqojbcsdtybd.supabase.co`

## Environment

`.env.example` 참고. 필요한 값:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (서버·worker 전용)
- `NOTION_TOKEN` (Notion integration secret)
- `NOTION_MANUAL_DATABASE_ID`, `NOTION_MANUAL_DATA_SOURCE_ID` (선택)

비밀키는 `.env`에만 두고 저장소에 커밋하지 않습니다.

## 저장소

https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline

소스 PPT(`docs/*.pptx`)는 용량 때문에 저장소에서 제외됩니다. 원본은 Supabase Storage/로컬에 보관합니다.

## 기획 문서

- [PRD](docs/planning/PRD.md)
- [IA](docs/planning/IA.md)
- [Conversion Rules](docs/planning/CONVERSION_RULES.md)
- [Pipeline Specification](docs/planning/PIPELINE_SPEC.md)
- [Technical Design](docs/planning/TECHNICAL_DESIGN.md)
- [Development Plan](docs/planning/DEVELOPMENT_PLAN.md)
- [E2E Pipeline Plan](docs/planning/E2E_PIPELINE_PLAN.md)
- [Quality Gates](docs/planning/QUALITY_GATES.md)
- [Infrastructure](docs/planning/INFRA.md)
- [Revision Plan](docs/planning/REVISION_PLAN.md)
