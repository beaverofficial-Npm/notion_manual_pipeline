# Railway 배포

Railway에서 Next.js 웹과 변환 worker를 같은 컨테이너로 운영한다. PPT/PPTX→PDF는 Microsoft Graph의 PowerPoint renderer만 사용하고 Docker에는 PDF→PNG용 Poppler만 포함한다.

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
MS_GRAPH_AUTH_MODE=refresh_token
MS_GRAPH_TENANT_ID=consumers
MS_GRAPH_CLIENT_ID
MS_GRAPH_REFRESH_TOKEN
MS_GRAPH_REFRESH_TOKEN_FILE=/data/ms-graph-refresh-token
```

조직 Microsoft 365 app-only 계정을 쓰는 경우에는 `client_credentials`와 `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_DRIVE_ID`를 사용한다. 개인 OneDrive delegated 계정은 `refresh_token`을 사용하며 secret/drive id가 필요 없다.

## Refresh token 영속 볼륨

Microsoft OAuth는 token 갱신 때 새 refresh token을 돌려줄 수 있다. 재배포 후에도 최신 token을 유지하도록 Railway volume을 `/data`에 마운트한다.

```bash
railway volume add -m /data
railway variable set --skip-deploys MS_GRAPH_REFRESH_TOKEN_FILE=/data/ms-graph-refresh-token
```

최초 `MS_GRAPH_REFRESH_TOKEN`은 Railway secret variable로 한 번 seed한다. 워커는 이후 회전값을 `0600` 권한의 파일에 원자 저장하고 파일 값을 우선 사용한다. token 값은 로그·문서·커맨드 인자에 직접 넣지 않는다.

선택:

- `RENDER_DPI`(기본 300)
- `WORKER_POLL_MS`(worker 폴링 간격, 기본 5000)
- `PDFTOPPM_CHUNK_SIZE`(기본 20, 화질을 낮추지 않고 페이지 범위만 나눔)
- `PDFTOPPM_CHUNK_TIMEOUT_MS`(chunk별 `pdftoppm` timeout)
- `PDFTOPPM_TIMEOUT_MS`, `PDFINFO_TIMEOUT_MS`
- `MS_GRAPH_UPLOAD_CHUNK_BYTES`(320KiB 배수, 기본 10MiB)

## 동작 흐름

- 웹에서 PPT 업로드 → "변환 시작" → Supabase에 job이 `queued`로 적재.
- 같은 컨테이너의 worker가 `queued` job을 폴링해 Microsoft Graph PowerPoint로 PDF 변환 후 `pdftoppm -f/-l` chunk 렌더·분석하고 Supabase에 결과 기록.
- 웹에서 검수·발행(노션). 발행 시 이미지 크롭/업로드는 웹 서비스에서 처리.

## 참고

- 웹과 worker는 같은 컨테이너 안에서 같은 Supabase를 사용한다. DB 스키마는 `supabase/schema.sql` + `supabase/migrations/001_hierarchy.sql`를 미리 적용해 둔다.
- 소스 PPT는 저장소에 없으므로(용량 제외), 업로드는 웹을 통해 Supabase Storage `manual-source`로 들어간다. worker가 거기서 내려받아 처리한다.
