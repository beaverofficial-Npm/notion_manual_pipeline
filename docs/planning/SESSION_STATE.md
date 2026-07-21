# 세션 상태 (최신본 — 모든 세션은 이 파일부터 읽는다)

> **갱신 규칙**: 상태가 바뀌는 작업을 한 세션은 이 파일을 그 자리에서 갱신한다. 날짜별 사본 대신 이 파일 하나가 정본.
> 마지막 갱신: **2026-07-21** (이전 스냅샷: SESSION_STATE_2026-07-15.md)

## Microsoft Graph 렌더러 마이그레이션 (2026-07-21)

- `staging`과 `main`에서 PPT/PPTX→PDF 런타임을 Microsoft Graph PowerPoint renderer 단일 경로로 전환했다. 다른 renderer fallback은 없다. 런타임 마이그레이션 커밋은 `859ba42`다.
- 모든 이미지 본문 페이지는 실측 고정 박스 `x=.036458, y=.171296, w=.606771, h=.694444`, padding 0으로 캡처한다. 이미지 없는 FAQ/표 페이지는 asset을 만들지 않는다.
- 제공된 5개 덱 × 6개 변형(동일/다른 이름, 동일/수정 bytes, 동일 크기 수정) 로컬 E2E 결과: **30/30 case, 254/254 check, 실패 0**.
- 로컬 검수 보고서: `docs/qa/graph-migration-20260721/local/index.html`.
- 전체 게이트, Next production build, LibreOffice 없는 Docker image build가 통과했다.
- Railway 운영 배포 `65bea070-1105-493d-863c-dbe332589fca`가 SUCCESS로 완료됐고, 운영 HTTP 200 및 worker `version=859ba42`, `online=true`를 확인했다.
- 운영에서 POS·테이블오더·매장관리 APP 3개 덱 × 6개 변형 E2E 결과: **18/18 case, 154/154 check, 실패 0**. 동일 파일명 수정본과 원본과 정확히 같은 파일 크기의 수정본도 모두 새 렌더 결과를 반영했다.
- 운영 검수 보고서: `docs/qa/graph-migration-20260721/production/index.html`.
- Railway Graph 위임 인증 갱신 토큰은 5GB 영속 volume의 `/data/ms-graph-refresh-token`에 mode 0600으로 저장된다. 재배포 뒤에도 유지되도록 구성했고 원격 파일 존재·크기·권한을 확인했다.
- 기존 JSONB 발행 pin 구조를 그대로 사용하므로 이번 전환에 필요한 Supabase schema migration은 없다. 소스/job/run/manifest SHA pin 회귀 테스트가 통과했다.

## 지금 이 순간의 사실 (2026-07-21)

### 배포 상태
- **운영(main = Railway)**: Microsoft Graph 단일 렌더러 커밋 `859ba42` 배포 완료. 운영 3개 덱 18개 E2E와 154개 검증 항목 전부 통과. LibreOffice 런타임/패키지/fallback 없음.
- **운영(main = Railway)**: **`ddf5403` 까지 배포 완료 (2026-07-20 14:02)** — 발행 백그라운드(faa1ba9)·크롭 연쇄합집합 수정(c7f9e89)·워커 가시성(3475eeb) 포함. 클라우드 Supabase에 006/007 마이그레이션 적용됨(성빈님이 SQL 에디터로). 운영 워커 하트비트 검증: online, version=ddf5403, env=클라우드.
- (이전) `f4a7fe2` 까지 배포됨. **이미 R2 체제**(원본+결과물 모두 R2, Railway 변수 세팅 완료), 무손실 렌더, 큰 덱(200장+) 수정 포함. 오늘도 운영에서 변환·발행 정상 동작 확인됨.
- **스테이지 브랜치 `feat/structure-hardening-stage`**: main 대비 +3 커밋 (배포 대기, 성빈님 로컬 테스트 1차 확인됨):
  - `c7f9e89` 크롭 연쇄 합집합 + 브레드크럼 오배치 수정 (실사용 제보 2건의 근본 수정)
  - `3475eeb` 워커 가시성 — 하트비트/버전 도장/온·오프라인 배지/대기 경고/최신 뱃지 + worker-daemon.sh
  - `faa1ba9` 발행 백그라운드 job화 + 발행 UX 개편
- 클라우드 Supabase에 필요 테이블(발행 job·worker_heartbeats) 존재 확인됨 → **배포 선행 조건 없음, push만 하면 FF**.

### 환경 지도 (혼동 금지 — 2개 환경이 병행)
| | 운영 | 로컬 스테이징 |
|---|---|---|
| 웹 | Railway (main) | `localhost:3100` (dev, 7-16부터 상주) |
| DB | 클라우드 Supabase (`.env`) | 로컬 Supabase 도커 (`.env.local`, 127.0.0.1:54321) |
| 파일 | R2 | R2 (같은 계정) |
| 워커 | Railway 컨테이너 내 자동 | **worker-daemon.sh** (단일 인스턴스+자동재시작, `.env.local`로 기동) |
- 웹은 `.env.local` 우선, 워커는 `--env-file=.env.local`로 띄워야 로컬 스택에 붙는다. **성빈님 로컬 테스트 결과는 로컬 Supabase에 있다 — 클라우드 DB에서 찾지 말 것.**

### 협업 방식 (성빈님 확정)
- **테스트 = 성빈님, 나 = 이슈 받으면 수정만.** 자가 실측 금지. 수정 후엔 "워커 재시작까지 완료" 상태로 "준비됐다" 보고.
- main 얼려두고 스테이지에서 검증 후 머지. 검증 안 된 것 운영 push 금지.
- 로컬 워커/dev 띄우면 반드시 보고, 테스트 끝나면 종료(좀비 방지). 워커 처리 기록엔 "누가@버전" 도장이 찍힌다.

### 미결
- 운영에서 성빈님 발행 실사용 확인(새 백그라운드 경로 첫 운영 사용)
- ⚠️ 교훈: supabase-js head/count 로 하는 테이블 존재 확인은 **거짓 성공을 반환한 사례 있음(원인 미상)** — 스키마 확인은 운영 런타임 응답 또는 SQL 에디터로만
- Supabase Free 50MB 업로드 한도 → R2 직행으로 우회됨(해소). Railway 워커 별도 서비스 분리는 선택 과제로 남음.

## 컴팩션/새 세션 재진입 절차 (치매 방지)
1. 이 파일 → 2. `git log --oneline -10` + `git branch --show-current` → 3. `ls .env*` + 프로세스(`pgrep -fl "poll-loop|next dev"`) 확인 후에만 상태 발언.
**확인 전에 과거 기억으로 단정하지 말 것 — 이 프로젝트는 변화 속도가 빠르다.**
