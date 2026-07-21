# 인수인계 문서 — PPT → Notion 매뉴얼 변환 파이프라인

본 문서는 프로젝트를 넘겨받는 담당자가 저장소 복제부터 로컬 실행, 외부 서비스 구성, 배포까지 수행하는 데 필요한 정보를 정리한다.

> 보안: API 키·서비스 롤 키·Notion 토큰·R2 키 등 모든 시크릿은 저장소·문서·메신저에 포함하지 않는다. 값은 각 서비스 대시보드와 Railway 환경변수에만 보관하며, 노출 시 즉시 재발급(rotate)한다.

---

## 1. 시스템 개요

PPT 매뉴얼 파일을 입력받아 슬라이드를 구조화하고, 좌측 이미지 영역을 크롭·가공하여 Notion 페이지로 발행하는 단방향 변환 파이프라인이다.

구성 요소:

- **웹 애플리케이션 (Next.js App Router)**: PPT 업로드 접수, 변환 작업 큐 등록, 변환 결과 검수 및 발행 UI 제공.
- **변환 워커 (Node 프로세스, `scripts/worker/poll-loop.mjs`)**: 큐를 폴링하여 변환을 수행한다. Microsoft Graph의 PowerPoint renderer로 PPT를 PDF로 렌더링하고, Poppler(`pdftoppm`)로 페이지를 PNG로 변환하며, `sharp`로 고정 이미지 박스를 캡처한 뒤 저장소와 DB에 적재한다.
- **저장소**: GitHub(소스 코드), Supabase(Postgres — 메타데이터 및 작업 큐), Cloudflare R2(원본 PPT 및 변환 이미지 파일), Notion(발행 결과물).

운영 환경에서는 웹과 워커를 하나의 컨테이너에서 함께 실행한다(`scripts/start.sh`).

---

## 2. 저장소 및 접근 권한

- 저장소: `https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline` (**공개(public)**, 기본 브랜치 `main`)
- 공개 저장소이므로 **복제는 초대 없이 가능**하다.
  ```
  git clone https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline.git
  ```
- **원본 저장소에 직접 push 하려면 쓰기 권한이 필요**하다(공개 상태만으로는 읽기·복제만 허용). 쓰기 권한 부여는 저장소 Settings → Collaborators 에서 초대한다. 권한이 없는 경우 포크(fork) 후 Pull Request 로 반영한다.

접근이 필요한 외부 서비스:

| 서비스 | 용도 | 접근 방법 |
|---|---|---|
| Supabase | Postgres(메타데이터·작업 큐) | 프로젝트 Organization 멤버 초대. 키는 프로젝트 Settings → API |
| Cloudflare R2 | 원본 PPT·변환 이미지 저장 | 계정 및 버킷·API 토큰 구성(4.2) |
| Notion | 변환 결과 발행 | 내부 통합(Integration) 토큰 및 대상 페이지 연결(4.3) |
| Microsoft Graph / OneDrive | PowerPoint 렌더링 | Entra app + Files.ReadWrite delegated 또는 app-only 권한 |
| Railway | 운영 배포(웹+워커) | 프로젝트 멤버 초대. 운영 환경변수 전체가 여기에 설정됨 |

---

## 3. 사전 요구사항

로컬 실행에는 다음이 필요하다.

- Node.js 22 이상, npm
- Microsoft Graph 인증 — PPT→PDF PowerPoint 렌더링
- Poppler (`pdftoppm`, `pdfinfo`) — PDF→PNG 변환
- (로컬 Supabase를 사용할 경우) Docker 및 Supabase CLI

설치 예시:

```
# macOS
brew install poppler
# 로컬 Supabase를 쓸 경우
brew install supabase/tap/supabase

# Ubuntu/Debian
apt-get install -y poppler-utils
```

---

## 4. 외부 서비스 구성

### 4.1 Supabase (Postgres 및 작업 큐)

두 가지 방식 중 하나를 선택한다.

**(A) 클라우드 프로젝트**
1. supabase.com 에서 프로젝트를 생성하거나 기존 프로젝트에 멤버로 참여한다.
2. Settings → API 에서 다음 값을 확인한다.
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (서버·워커 전용, 비공개)
3. 스키마 적용: `supabase/migrations/` 의 SQL 파일을 번호 순서대로 SQL Editor 에서 실행한다. enum 변경(`ALTER TYPE ...`) 이 포함되므로 순서를 지킨다.

**(B) 로컬 스택 (Docker)**
1. `supabase start` 실행. `supabase/config.toml` 기준으로 로컬 스택이 기동되며 마이그레이션이 자동 적용된다(기본 API 주소 `http://127.0.0.1:54321`).
2. 명령 출력에 표시되는 API URL·anon key·service_role key 를 `.env` 에 기입한다.

> 파일(원본 PPT·이미지)은 Supabase Storage가 아니라 R2에 저장된다. Supabase는 메타데이터와 작업 큐 용도이다.

### 4.2 Cloudflare R2 (오브젝트 스토리지)

원본 PPT와 변환된 이미지가 R2에 저장된다. 미구성 시 업로드·변환이 동작하지 않는다.

1. **계정 및 R2 활성화**: Cloudflare 대시보드 → R2. 최초 1회 결제 수단을 등록하여 R2를 활성화한다.
2. **버킷 생성**: Create bucket → 이름 `manual-source`(다른 이름을 사용하면 `.env` 의 `R2_BUCKET` 을 일치시킨다). 위치는 Automatic. 하나의 버킷 안에서 `<taskId>/source/…`(원본 PPT), `<taskId>/assets/…`(변환 이미지) 형태의 키 접두사로 구분하므로 버킷은 1개면 된다.
3. **S3 호환 API 토큰 발급**: R2 → Manage R2 API Tokens → Create API Token.
   - Permissions: Object Read & Write
   - 대상 버킷을 `manual-source` 로 제한할 것을 권장.
   - 발급 시 표시되는 Access Key ID / Secret Access Key 를 보관한다(각각 `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Secret 은 재확인이 불가하므로 이때 저장한다.
4. **엔드포인트 확인**: 토큰 페이지 또는 버킷 설정에 표시되는 `https://<account-id>.r2.cloudflarestorage.com` 형태의 S3 API 엔드포인트를 `R2_ENDPOINT` 로 사용한다. `R2_REGION` 은 `auto`.
5. **CORS 설정**: 브라우저에서 presigned URL 로 직접 업로드(PUT)하므로 버킷 → Settings → CORS Policy 에 애플리케이션 오리진을 허용한다.
   ```
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://<운영-도메인>"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
6. **검증**: `node --env-file=.env scripts/test/r2-e2e.mjs` 로 업로드·조회를 확인한다.

> 운영과 로컬은 서로 다른 R2 계정/버킷을 사용할 수 있다. 로컬 키로 운영 오브젝트는 조회되지 않는다. 운영 기준 값은 Railway 환경변수에 있다.

### 4.3 Notion (발행)

변환 결과를 Notion 페이지로 발행한다.

1. **내부 통합 생성**: notion.so/my-integrations → New integration(내부 통합). 대상 워크스페이스를 선택하고 생성한다.
2. **토큰 확보**: 통합의 Internal Integration Secret 을 `NOTION_TOKEN` 으로 사용한다(비공개). API 버전은 `2022-06-28` 을 사용한다(코드 고정).
3. **대상 페이지에 통합 연결**: 발행 대상이 될 Notion 페이지(또는 상위 페이지)에서 우측 상단 ⋯ → 연결(Connections) → 생성한 통합을 추가한다. **통합이 연결되지 않은 페이지에는 API가 접근할 수 없어 발행이 실패**한다. 개인 페이지나 통합이 없는 다른 워크스페이스 페이지에는 발행할 수 없다.
4. **발행 대상 지정**: 각 변환 작업의 발행 시 대상 Notion 페이지 링크를 지정한다. 지정한 페이지 하위에 변환된 매뉴얼 페이지가 생성된다.
5. **기본 대상(선택)**: `NOTION_MANUAL_DATABASE_ID` / `NOTION_MANUAL_DATA_SOURCE_ID` 는 기본 대상 데이터베이스·데이터소스를 지정하는 선택 값이다. 데이터베이스 ID는 데이터베이스 URL의 32자리 식별자, 데이터소스 ID는 Notion API로 데이터베이스를 조회했을 때의 `data_sources[].id` 값이다.

---

## 5. 환경변수

로컬 `.env` 파일에 설정한다(저장소에는 커밋되지 않음). 전체 목록과 주석은 `.env.example` 참고. 운영 값은 Railway 프로젝트 Variables 에 있다.

| 변수 | 용도 | 출처 | 비공개 |
|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase 프로젝트 URL | Supabase Settings→API | 아니오 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 브라우저용 공개 키 | 〃 | 아니오 |
| SUPABASE_SERVICE_ROLE_KEY | 서버·워커용 키 | 〃 | 예 |
| NOTION_TOKEN | Notion 통합 시크릿 | Notion 통합(4.3) | 예 |
| NOTION_MANUAL_DATABASE_ID | 기본 대상 DB(선택) | Notion | 아니오 |
| NOTION_MANUAL_DATA_SOURCE_ID | 기본 대상 데이터소스(선택) | Notion | 아니오 |
| NOTION_IMAGE_MAX_WIDTH | 발행 이미지 최대 폭(px, 기본 540) | 선택 | 아니오 |
| R2_ENDPOINT | R2 S3 API 엔드포인트 | Cloudflare R2(4.2) | 아니오 |
| R2_BUCKET | 버킷 이름(기본 manual-source) | 〃 | 아니오 |
| R2_REGION | 리전(auto) | 〃 | 아니오 |
| R2_ACCESS_KEY_ID | R2 API 토큰 Access Key | 〃 | 예 |
| R2_SECRET_ACCESS_KEY | R2 API 토큰 Secret | 〃 | 예 |
| MS_GRAPH_AUTH_MODE / TENANT_ID / CLIENT_ID | PowerPoint renderer 인증 | Entra | client id 외 예 |
| MS_GRAPH_REFRESH_TOKEN | delegated 인증 최초 seed | Microsoft OAuth | 예 |
| MS_GRAPH_REFRESH_TOKEN_FILE | 회전 token 영속 파일(`/data/...`) | Railway volume | 아니오 |
| PDFTOPPM_BIN / PDFINFO_BIN | 바이너리 경로 오버라이드(선택) | 로컬 환경 | 아니오 |
| RENDER_DPI | 렌더 품질(선택) | 선택 | 아니오 |
| WORKER_POLL_MS | 워커 폴링 주기(ms, 기본 5000) | 선택 | 아니오 |
| INLINE_WORKER | 웹 프로세스에서 변환 즉시 실행(1=사용) | 선택 | 아니오 |

---

## 6. 로컬 실행

```
git clone https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline.git
cd notion_manual_pipeline
npm install
cp .env.example .env          # 4·5장을 참고하여 값 입력

npm run dev                   # 웹 (http://localhost:3000)
npm run worker:poll           # 변환 워커 (별도 터미널)
```

- 변환은 워커가 처리하므로 웹만 실행하면 작업이 큐에 머문다. 워커를 함께 실행한다.
- 별도 워커 터미널 없이 웹 프로세스에서 변환을 즉시 실행하려면 `.env` 에 `INLINE_WORKER=1` 을 설정한다(단독 로컬 테스트용, 운영에는 권장하지 않음).
- 워커 코드(`scripts/worker/*`)를 수정하면 워커 프로세스를 재시작해야 반영된다(실행 중 프로세스는 이전 코드를 메모리에 유지).
- 이미 변환한 작업을 다시 확인할 때는 새 변환(새 run)으로 실행한다. 이전 산출물이 그대로 표시되면 수정 전 결과이다.

---

## 7. 배포 (Railway)

- `main` 브랜치에 push 하면 Railway가 자동으로 빌드·배포한다(GitHub 연동, `Dockerfile`, `railway.json`).
- 이미지는 `node:22` 기반이며 Poppler를 포함한다. PowerPoint 렌더링은 Microsoft Graph가 수행한다. `scripts/start.sh` 가 워커와 웹을 한 컨테이너에서 실행한다.
- `/data` Railway volume에 회전 refresh token을 영속화한다.
- 배포 상태 및 워커 버전은 `GET /api/worker/status`(온라인 여부와 커밋 SHA) 또는 대시보드 상단 배지로 확인한다.
- push 전 점검: `npm run typecheck` (필요 시 `npm run build`).

---

## 8. 아키텍처 및 데이터 흐름

```
[브라우저] ──PPT 업로드(presigned PUT)──▶ [R2 버킷]
     │                                        ▲
     ▼                                        │ 원본 다운로드
[웹 API] ──작업 큐 등록──▶ [Supabase: manual_conversion_jobs]
                                    │
                                    ▼ (폴링)
                             [워커 poll-loop]
                 Microsoft PowerPoint→PDF→PNG, 고정박스 캡처(sharp)
                                    │  결과 이미지 업로드
                                    ├──▶ [R2]
                                    └──▶ [Supabase] (블록·이미지 메타)
                                    │
[검수 UI] ◀── 함수/블록/이미지 ──────┘
     │
     ▼ (발행)
[Notion API] ──▶ 지정한 대상 페이지 하위에 매뉴얼 페이지 생성
```

핵심 규칙: 이미지 크롭은 슬라이드 좌측 이미지 영역만을 대상으로 하며 우측 본문 텍스트 컬럼을 침범하지 않는다. 검사 도구: `node scripts/verify-crop-gate.mjs "<덱 폴더>"`.

---

## 9. 운영 및 유지보수

- **DB 스키마 변경**: `supabase/migrations/` 에 SQL 파일을 추가하고 대상 환경(클라우드는 SQL Editor, 로컬은 재적용)에 반영한다.
- **워커 반영**: 워커 관련 코드 수정 후에는 워커 프로세스 재시작이 필요하다.
- **발행 특성**: 자동 무인 발행이 아니라 검수 후 발행을 전제로 한다. 마스터 PPT는 제품 현행 기준선(입력)이며 변환기가 수정 대상이 아니다.

---

## 10. 트러블슈팅

| 증상 | 원인 및 조치 |
|---|---|
| 변환이 큐에서 진행되지 않음 | 워커(`worker:poll`) 미실행. 별도 터미널에서 실행하거나 `INLINE_WORKER=1` 설정. |
| 코드 수정 후에도 결과가 동일 | 워커 미재시작(이전 코드 유지) 또는 새 변환 없이 이전 산출물 확인. |
| 업로드·변환 실패(스토리지 오류) | `R2_*` 값 미설정·오류. `scripts/test/r2-e2e.mjs` 로 점검. CORS 미설정 시 브라우저 업로드 실패. |
| Notion 발행 실패(권한 오류) | 대상 페이지에 통합이 연결되지 않음. 통합이 연결된 워크스페이스 페이지를 대상으로 지정. |
| Graph 인증 실패 | refresh token 만료·회전 파일 미마운트 여부를 확인. `/data/ms-graph-refresh-token` volume과 Railway 변수를 점검하고 token 값은 로그에 출력하지 않는다. |
