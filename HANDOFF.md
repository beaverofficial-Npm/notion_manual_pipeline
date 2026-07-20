# 인수인계 (HANDOFF) — PPT → Notion 매뉴얼 변환 파이프라인

새 담당자는 **이 문서 하나만** 따라오면 클론 → 로컬 실행 → 배포 → 발행까지 됩니다.

> ⚠️ **시크릿(API 키·서비스롤 키·Notion 토큰·R2 키)은 이 문서·깃·메신저에 절대 넣지 않습니다.**
> 값은 각 서비스 대시보드 또는 Railway 변수에만 둡니다. 노출되면 즉시 로테이션(재발급)하세요.

---

## 0. 5분 요약 (무엇을 넘겨받는가)

- **웹(Next.js)**: PPT 업로드 → 변환 job 큐잉 → 검수/발행 UI.
- **워커(별도 프로세스)**: 큐를 폴링해 무거운 변환 수행(LibreOffice로 PPT→PDF→PNG 렌더, 크롭·베이크, 적재).
- **저장소 4곳**: GitHub(코드) · Supabase(Postgres+메타) · R2(원본 PPT·이미지 파일) · Notion(발행 대상).
- **배포**: `main` 브랜치에 push → Railway 가 Docker 로 자동 빌드·배포(웹+워커 한 컨테이너).

넘겨받을 것 = 키 파일이 아니라 **4개 서비스의 멤버 초대 + 각자 자기 키를 대시보드에서 발급**.

---

## 1. 접근 받기 (초대)

| 서비스 | 무엇 | 받는 법 |
|---|---|---|
| GitHub | 코드 레포 sungbinhwang-beaverworks/notion_manual_pipeline (private, 기준 브랜치 main) | 아래 1-1 — 협업자(Collaborator) 초대 |
| Supabase | Postgres + 메타데이터 + 마이그레이션(supabase/migrations/) | 프로젝트 Organization → Members 초대. 키는 각자 Settings→API 에서 확인 |
| Cloudflare R2 | 원본 PPT·변환 이미지 오브젝트 스토리지 | 아래 3장 — 계정 만들고 버킷+API토큰 발급(신규 구성 가능) |
| Notion 통합 | 발행용 내부 통합 "Notion_manual" (워크스페이스 비버웍스 서비스디자인팀) | 워크스페이스 관리자에게 통합 토큰 인계 요청. 발행 대상 페이지는 이 통합에 연결돼 있어야 함 |
| Railway | 운영 배포(웹+워커). 모든 env 변수가 여기 세팅됨 | 프로젝트 → Members 초대 |

### 1-1. 코드를 새 담당자(예: joo9393@icloud.com)에게 공유하는 법

저장소가 private 이므로 그냥 링크로는 못 봅니다. 둘 중 하나:

**A) GitHub 협업자 초대 (권장 — pull/push 가능)**
1. 상대가 GitHub 계정이 있어야 합니다. 그 계정에 위 이메일이 등록돼 있거나, 상대의 GitHub 사용자명을 알아야 합니다.
2. 웹: 레포 → Settings → Collaborators → Add people → 이메일(joo9393@icloud.com) 또는 사용자명 입력 → 초대. 상대가 메일 초대를 수락하면 접근됩니다.
3. 또는 CLI(사용자명을 알 때):
   `gh api -X PUT repos/sungbinhwang-beaverworks/notion_manual_pipeline/collaborators/<상대-github-사용자명> -f permission=push`
   (이메일만으로는 CLI 초대 불가 — 웹 UI 만 이메일→계정 해석. 사용자명을 받아 넣으세요.)
4. 수락 후 상대는: `git clone https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline.git`

**B) 코드 사본만 전달(접근권·이력 없이)** — 소스만:
`git archive --format=zip -o notion_manual_pipeline.zip HEAD`
생성된 zip 을 전달. (.env 는 애초에 커밋 안 돼 있어 포함되지 않음.)

---

## 2. 로컬 세팅 & 실행

```
# 사전: Node 22+, 그리고 변환용 시스템 바이너리
brew install libreoffice poppler        # macOS (soffice, pdftoppm, pdfinfo)
#   Ubuntu: apt-get install libreoffice-impress poppler-utils fonts-noto-cjk fonts-nanum

git clone https://github.com/sungbinhwang-beaverworks/notion_manual_pipeline.git
cd notion_manual_pipeline
npm install
cp .env.example .env                     # 그리고 값 채우기 (3·4장 참고)

npm run dev                              # 웹 (localhost:3000)
npm run worker:poll                      # 워커 — 별도 터미널 (없으면 변환이 큐에 멈춤)
```

- 웹만 켜면 변환이 안 됩니다. 변환은 워커가 처리 → 로컬 테스트 시 worker:poll 을 반드시 같이 띄웁니다.
- 워커 코드(scripts/worker/*)를 고치면 워커를 재시작해야 반영됩니다(실행 중 프로세스는 옛 코드를 메모리에 물고 있음).
- 이미 변환한 것을 다시 확인할 땐 반드시 "새로 변환"(새 run) — 옛 산출물이 그대로 보이면 수정 전 결과입니다.

### 2-1. (선택) 로컬 Supabase 스택
클라우드 대신 로컬에서 돌리려면 Docker + Supabase CLI 로:
```
supabase start                           # supabase/config.toml 기반, 127.0.0.1:54321
# 이때 .env 의 SUPABASE 값을 supabase start 가 출력한 로컬 값으로 교체
```
마이그레이션은 supabase/migrations/*.sql — 새 스키마 변경은 여기에 SQL 추가 후 적용.

---

## 3. R2(오브젝트 스토리지) 신규 구성 — 계정부터

원본 PPT와 변환된 이미지가 R2 에 저장됩니다. 없으면 업로드·변환이 아예 안 됩니다.

1. Cloudflare 계정 생성/로그인 → 대시보드 좌측 R2 클릭 → (최초 1회) 결제수단 등록하고 R2 활성화. (R2 는 저장용량·요청 기준 과금, 소량은 무료 티어.)
2. 버킷 생성: R2 → Create bucket → 이름 manual-source (다른 이름 쓰면 .env 의 R2_BUCKET 도 맞추기). 위치 Automatic.
   - 이 하나의 버킷 안에 <taskId>/source/…(원본 PPT), <taskId>/assets/…(크롭 이미지) 식 프리픽스로 저장됩니다. 버킷은 1개면 됩니다.
3. S3 호환 API 토큰 발급: R2 → Manage R2 API Tokens → Create API Token
   - Permissions: Object Read & Write
   - 특정 버킷(manual-source)으로 제한 권장.
   - 생성하면 Access Key ID / Secret Access Key 가 한 번만 표시됨 → 안전히 보관(= .env 의 R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).
4. 엔드포인트 확인: 토큰 페이지 또는 버킷 Settings 에 https://<account-id>.r2.cloudflarestorage.com 형태의 S3 API endpoint → .env 의 R2_ENDPOINT. R2_REGION 은 auto.
5. CORS 설정(브라우저에서 presigned PUT 업로드 하므로 필요): 버킷 → Settings → CORS Policy 에 앱 오리진 허용:
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
6. 검증: `node --env-file=.env scripts/test/r2-e2e.mjs` (업로드/헤드 확인 스크립트).

> 운영은 R2 계정이 로컬 스테이징과 다를 수 있음 — Railway 변수의 R2 값이 운영 기준. 로컬 키로 운영 오브젝트는 못 읽습니다.

---

## 4. 환경변수 (이름·출처만 — 값은 각 대시보드/Railway 변수)

로컬 .env 에 채웁니다. 가장 빠른 길 = Railway 프로젝트 Variables 값을 그대로 복사. 전체 목록·설명은 .env.example.

| 변수 | 출처 | 비밀? |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase → Settings → API | 아니오 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 〃 | 아니오 |
| SUPABASE_SERVICE_ROLE_KEY | 〃 (서버·워커 전용) | 예 |
| NOTION_TOKEN | Notion 통합 "Notion_manual" | 예 |
| NOTION_MANUAL_DATABASE_ID / ..._DATA_SOURCE_ID | Notion 대상 DB/데이터소스 | 아니오 |
| R2_ENDPOINT / R2_BUCKET / R2_REGION | Cloudflare R2 (3장) | 아니오 |
| R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY | R2 API 토큰 (3장) | 예 |
| NOTION_IMAGE_MAX_WIDTH | (선택) 발행 이미지 폭, 기본 540 | 아니오 |
| SOFFICE_BIN / PDFTOPPM_BIN / RENDER_DPI 등 | (선택) 워커 튜닝 | 아니오 |

---

## 5. 배포 (Railway)

- main 에 push → Railway 가 자동 빌드·배포 (GitHub 연동, Dockerfile, railway.json).
- Dockerfile = node:22 + LibreOffice + Poppler + 한글폰트(Noto CJK·Nanum·Pretendard 번들). scripts/start.sh 가 워커+웹을 한 컨테이너에서 실행.
- 배포 상태·워커 버전 도장 확인: GET /api/worker/status (online 여부 + 커밋 SHA) 또는 대시보드 상단 배지.
- push 전 점검: `npm run typecheck` (+ 여유 되면 `npm run build`).

---

## 6. 아키텍처 한 장

```
[브라우저] --PPT업로드(presigned PUT)--> [R2 버킷]
     |                                      ^
     v                                      | 원본 다운로드
[웹 API] --job 큐잉--> [Supabase: manual_conversion_jobs]
                                 |
                                 v (폴링)
                          [워커 poll-loop]
                          soffice→PDF→PNG, 크롭/베이크(sharp)
                                 |  결과 이미지 업로드
                                 +--> [R2] , 메타 --> [Supabase]
                                 |
[검수 UI] <---- 함수/블록/이미지 ----+
     |
     v (발행 버튼)
[Notion API] --> 대상 DB 페이지 생성/갱신
```

핵심 규칙(불변): 크롭 = 슬라이드 왼쪽 이미지박스 영역만(우측 본문 텍스트 컬럼 침범 금지). 게이트: `node scripts/verify-crop-gate.mjs "<덱 폴더>"`.

---

## 7. 자주 겪는 문제 (트러블슈팅)

| 증상 | 원인 / 해결 |
|---|---|
| 변환이 큐에서 안 넘어감 | 워커(worker:poll)가 안 떠 있음. 별도 터미널에서 실행. |
| 코드 고쳤는데 결과 그대로 | ① 워커 재시작 안 함(옛 코드 메모리) ② "새로 변환" 안 하고 옛 산출물 봄. |
| 업로드/변환 실패(R2 오류) | R2_* 미설정/오키. scripts/test/r2-e2e.mjs 로 점검. CORS 미설정 시 브라우저 업로드 실패. |
| Notion 발행 권한 오류 | 대상 페이지가 "Notion_manual" 통합에 연결 안 됨 / 개인·타 워크스페이스 페이지. 팀 워크스페이스 + 통합 연결 페이지만 가능. |
| 배지 안 숫자가 아래로 밀림 | 알려진 별도 이슈 — LibreOffice 가 박스보다 큰 글자를 세로정렬하는 방식(폰트 무관). 미해결 트랙. |

---

## 8. 체크리스트

인계자(내보내는 사람)
- GitHub / Supabase / Cloudflare(R2) / Notion 워크스페이스 / Railway 에 새 담당자 초대
- .env 값은 안전 채널(1Password 등) 또는 "Railway 변수에서 직접 복사" 안내 — 문서/메신저 평문 금지
- 노출됐던 키 로테이션
- 이 문서 위치 알려주기

인수자(받는 사람)
- 5개 서비스 접근 확인
- clone → .env 채우기 → npm run dev + worker:poll 로 실제 변환 1건 성공
- Railway 배포 흐름(main push) 이해
- 통합 연결된 팀 페이지에 Notion 발행 1건 성공
