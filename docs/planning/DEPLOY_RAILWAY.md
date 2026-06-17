# Railway 배포

Vercel(서버리스)은 LibreOffice를 못 돌려 변환 단계가 동작하지 않는다. Railway는 Docker 컨테이너에 LibreOffice를 포함할 수 있어 웹과 변환 worker를 같은 환경에서 운영한다.

저장소 루트의 `Dockerfile` 하나로 웹과 변환 worker를 같은 컨테이너에서 띄운다.

## 서비스 구성 (한 저장소, 단일 컨테이너)

Railway 서비스 하나를 GitHub 저장소에 연결한다(Dockerfile 자동 감지).

- Dockerfile 기본 CMD: `sh ./scripts/start.sh`
- `scripts/start.sh`가 변환 worker(`node scripts/worker/poll-loop.mjs`)를 백그라운드로 띄운 뒤 `npm run start`(= `next start`)를 포그라운드로 실행한다.
- Networking: Public Domain 생성. 포트는 Railway의 `PORT`를 Next가 자동으로 사용한다.

## 환경변수

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NOTION_TOKEN
```

선택:

- `RENDER_DPI`(기본 300)
- `WORKER_POLL_MS`(worker 폴링 간격, 기본 5000)
- `PDFTOPPM_CHUNK_SIZE`(기본 20, 화질을 낮추지 않고 페이지 범위만 나눔)
- `PDFTOPPM_CHUNK_TIMEOUT_MS`(chunk별 `pdftoppm` timeout)
- `SOFFICE_TIMEOUT_MS`, `PDFTOPPM_TIMEOUT_MS`, `PDFINFO_TIMEOUT_MS`

## 동작 흐름

- 웹에서 PPT 업로드 → "변환 시작" → Supabase에 job이 `queued`로 적재.
- 같은 컨테이너의 worker가 `queued` job을 폴링해 LibreOffice로 PDF 변환 후 `pdftoppm -f/-l` chunk 렌더·분석하고 Supabase에 결과 기록.
- 웹에서 검수·발행(노션). 발행 시 이미지 크롭/업로드는 웹 서비스에서 처리.

## 참고

- 웹과 worker는 같은 컨테이너 안에서 같은 Supabase를 사용한다. DB 스키마는 `supabase/schema.sql` + `supabase/migrations/001_hierarchy.sql`를 미리 적용해 둔다.
- 소스 PPT는 저장소에 없으므로(용량 제외), 업로드는 웹을 통해 Supabase Storage `manual-source`로 들어간다. worker가 거기서 내려받아 처리한다.
