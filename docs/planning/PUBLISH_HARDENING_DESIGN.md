# 발행 구조 안정화 설계 — 백그라운드 job화 (검토용)

> 브랜치 `feat/structure-hardening-stage` · **머지 안 함** · prod(배포환경) DB·스토리지·노션 **무영향** · 로컬 Postgres 스테이지에서 구조 검증.
> 이 문서는 "설계부터 먼저"(성빈님 선택)에 따른 검토용 산출물. 승인 후 구현.

---

## 0. 한 줄 결론

지금 **변환은 이미 안전한 구조(큐+워커+폴링)로 돌아가는데, 발행만 옛날 방식(한 요청 안에서 통짜 스트리밍)**이라 이번에 터졌다.
발행을 **변환과 똑같은 패턴으로 옮기면**, 팝업이 닫히든 연결이 끊기든 발행은 워커가 끝까지 돌린다. 새 인프라 없이, 이미 있는 부품을 재사용한다.

---

## 1. 왜 발행만 터졌나 (진단)

두 파이프라인을 나란히 놓으면 원인이 한눈에 보인다.

| | 변환(분석) | 발행(오늘 수정 전) |
|---|---|---|
| 트리거 | job을 `queued`로 넣고 **즉시 리턴** | 요청을 **열어둔 채** 그 안에서 전 작업 수행 |
| 실제 작업 | 워커가 폴링해서 처리 | **웹 요청 스레드**가 직접 처리 |
| 진행 표시 | 프론트가 `/api/tasks/{id}` **폴링** | NDJSON **스트림**(연결 유지 필수) |
| 연결 끊기면 | 무관 — 워커가 계속 | **발행 중단**(abort→cancelled) |

발행은 이미지 134장을 한 열린 요청 안에서 처리하니, Railway 프록시의 ~60초 idle 한도에 걸려 연결이 끊기고 → 브라우저는 실패로 보고 → 재클릭 → 겹쳐 돌며 서버 포화. **오늘 핫픽스(병렬 업로드+하트비트)로 증상은 눌렀지만, "발행이 연결에 의존한다"는 구조는 그대로다.** 큰 덱·느린 네트워크·프록시 변덕이면 재발 가능.

**핵심:** 변환은 폴링이라 연결과 무관한데, 발행만 스트리밍이라 연결에 목숨을 건다. 이 비대칭이 병의 뿌리.

---

## 2. 목표 구조 (변환 패턴을 발행에 복제)

```
[발행 버튼] → POST /publish
                 └ publish_run 을 status=queued 로 insert (payload: notionTarget, excludedFnIds)
                 └ task.status = 'publishing'
                 └ 즉시 201 리턴 (runId)         ← 여기서 요청 끝. 연결 끊겨도 OK.

[워커 poll-loop] → resolvePublishRun() 원자적 클레임(queued→running)
                 └ publishTaskToNotion 실행 (이미지 병렬 업로드 + 노션 페이지)
                 └ 진행을 publish_run.progress 에 기록
                 └ 끝나면 status=succeeded / 실패면 failed

[프론트] → /api/tasks/{id}/publish/status 3초 폴링
                 └ progress 바 표시, succeeded 면 완료+링크, failed 면 사유
                 └ 팝업 닫았다 다시 와도 진행 중이면 그대로 이어서 보임
```

이미 존재하는 부품이라 새로 만들 게 적다:
- `manual_publish_runs` 테이블 — **이미 `status` enum에 `queued` 포함**. progress 컬럼만 추가.
- `poll-loop.mjs` — 이미 `reclaimStuckPublishRuns()`를 호출 중(죽은 발행 회수 안전망 존재). 여기에 발행 처리 한 줄 추가.
- `INLINE_WORKER` spawn 패턴 — 로컬/단일 컨테이너에서 워커 없이 즉시 돌리는 길이 이미 있음. 발행도 동일하게.

---

## 3. 상세 설계

### 3.1 DB 마이그레이션 초안 (`006_publish_job.sql`)

새 테이블 없음. 기존 `manual_publish_runs`에 job 수명주기 컬럼만 보강:

```sql
alter table manual_publish_runs
  add column if not exists worker_id text,
  add column if not exists progress jsonb not null default '{}'::jsonb;  -- {done,total,label}

-- payload 에 발행 입력을 담는다(현재도 jsonb payload 존재): { notionTarget, excludedFnIds }
-- status 는 이미 manual_job_status(queued|running|succeeded|failed|cancelled) 재사용.

-- 큐 조회 인덱스(가장 오래된 queued 우선)
create index if not exists manual_publish_runs_status_created_idx
  on manual_publish_runs(status, created_at);
```

멱등(`if not exists`). prod 스키마에 적용하지 않는다 — 로컬 스테이지에서만.

### 3.2 발행 코어 추출 — 이번 설계의 **가장 큰 결정**

**문제:** 워커(`scripts/worker/*.mjs`)는 순수 node(`@supabase/supabase-js`, `child_process`)만 쓴다. 반면 발행 로직 `src/lib/notion/publish.ts`·`assets.ts`는
- `import 'server-only'` (Next 서버 컴포넌트 밖에서 throw)
- `@/lib/supabase/server` alias (Next 번들러 전용 경로)

를 써서 **워커에서 그대로 import할 수 없다.**

**해결 (택1, 추천 A):**

- **A. 프레임워크 무관 코어 모듈로 추출** — 발행 순수 로직을 `scripts/worker/publish-core.mjs`(또는 `src/lib/notion/publish-core.ts`를 워커가 상대경로 import)로 옮긴다. supabase client·token을 **인자로 주입**받게 해서 `server-only`/alias 의존 제거. 웹 route와 워커가 **같은 코어를 공유**(중복 구현 방지).
  - 웹 쪽 얇은 래퍼(`publish.ts`)는 `createServiceSupabaseClient()`를 만들어 코어에 넘김 → 기존 `buildPublishPreview` 등 웹 기능 그대로.
  - 워커는 `createClient(env)`로 만들어 코어에 넘김.
  - `sharp`는 순수 npm이라 `.mjs`에서도 문제없음(변환 워커도 sharp 계열 씀).
- B. 워커가 내부 HTTP로 Next API를 호출 — 단순하나 워커→웹 왕복/타임아웃이 다시 생겨 취지에 어긋남. 비추천.

→ **A 채택.** "발행 코어 1벌, 호출자 2(웹 래퍼·워커)". 이번 라운드 작업량의 핵심은 이 추출 + 주입 리팩터.

### 3.3 트리거 route (`POST /api/tasks/{id}/publish` 개편)

지금(스트리밍 실행)에서 → **enqueue + 즉시 리턴**으로. `run/route.ts`와 대칭:

```
1. notionTarget 검증·page id 추출 (기존 유지)
2. task.target_notion_page_id 갱신 (기존 유지)
3. 중복 가드: 이 task에 queued/running publish_run 있으면 409 (오늘 추가한 가드 재사용·확장)
4. publish_run insert(status=queued, payload={notionTarget, excludedFnIds}, target_page_id)
5. task.status='publishing'
6. INLINE_WORKER=1 이면 spawn scripts/worker/run-publish-job.mjs {runId}
7. 201 { runId } 리턴   ← 스트림 없음
```

### 3.4 워커 (`scripts/worker/run-publish-job.mjs` + poll-loop 편입)

- `resolvePublishRun(runId?)` — 변환 `resolveJob`과 동일한 **원자적 클레임**: `update(status=running).eq(id).eq(status=queued)` 성공한 프로세스만 처리(이중 발행 레이스 차단).
- 클레임 후 `publish-core`로 발행. 진행마다 `publish_run.progress` 업데이트(프론트 폴링이 읽음).
- 완료 `succeeded`+task `published` / 실패 `failed`+task `review_required`.
- `poll-loop.mjs`: 변환 `runOnce()` 뒤에 `runPublishOnce()` 한 줄 추가(같은 폴러가 둘 다 처리). 큐 빌 때 `reclaimStuckPublishRuns()`는 이미 호출 중 — job화하면 이 회수가 **정상 경로의 안전망**으로 딱 맞는다.

### 3.5 프론트 (스트리밍 → 폴링)

- `handlePublish`: NDJSON 스트림 읽기 제거 → POST로 runId 받고 **폴링 시작**(3초, 변환 `convWatch`와 동일 패턴).
- 상태 조회: `GET /api/tasks/{id}/publish/status` → `{status, progress, error, notionUrl}`.
- 모달: progress.done/total 바 + label. `succeeded`면 완료+링크, `failed`면 사유(오늘 만든 에러 명확표시 UI 재사용), **팝업 닫아도** 다음에 오면 진행 중이면 이어 보임.
- 재클릭 방지: 진행 중 버튼 잠금(오늘 반영) + 서버 409 가드(3번) 이중.

---

## 4. 로컬 Postgres 스테이지 검증 계획 (Docker 없이)

목표: **prod 백엔드 무영향**으로 "연결 끊겨도 발행이 끝까지 가는가 + 이중 클레임 없는가 + 폴링 UX"를 실증.

1. `brew install postgresql@16` → 로컬 인스턴스 기동(포트 5433 등 prod과 무관).
2. `supabase/schema.sql` + `migrations/*.sql` + `006_publish_job.sql`을 로컬 DB에 적용(psql). Supabase 확장(`gen_random_uuid` 등)은 `pgcrypto`로 대체.
3. `.env.staging` — `DATABASE_URL`은 로컬, **prod Supabase URL/키는 넣지 않음**.
4. **스토리지·노션은 stub**(성빈님 선택: 구조 논리 검증):
   - `loadAsset`/`loadRender` → 로컬 고정 PNG 반환.
   - `uploadImageToNotion`/`createPage` → 지연을 흉내내는 mock(가짜 id 반환, 실제 노션 호출 0).
   - (노션 실제 발행 정확성은 이미 prod에서 633블록으로 검증됨 — 여기선 job 수명주기만 본다.)
5. 시나리오:
   - **정상**: enqueue → 워커 처리 → progress 증가 → succeeded. 폴링이 완료 감지.
   - **연결 끊김**: 발행 트리거 직후 프론트(폴링) 중단·브라우저 닫기 시뮬 → **워커는 계속** → DB에서 succeeded 확인. (오늘 사고의 정확한 반대 증명)
   - **이중 클레임**: 워커 2개 동시 기동 → 같은 run을 하나만 처리(원자적 클레임 검증).
   - **죽은 발행 회수**: running을 10분 전으로 조작 → `reclaimStuckPublishRuns`가 정리.
6. 로컬 워커/pg는 테스트 후 **반드시 종료**(좀비 방지) + 보고.

---

## 5. 리스크 · 제약

- **머지 안 함.** 이 브랜치는 스테이지 검증 전용. main(prod)은 오늘 핫픽스 상태 그대로 안정.
- **prod 무영향.** 로컬 pg + stub만 사용. prod Supabase/노션/Railway에 어떤 쓰기도 하지 않는다.
- **웹 route 회귀 주의.** 발행 코어 추출 시 `publish.ts`의 웹 기능(`buildPublishPreview` 등)이 깨지지 않게 — 래퍼가 기존 시그니처 유지. 타입체크(G1)로 확인.
- **로컬 pg ≠ Supabase 완전 동일.** RLS·Storage·Realtime은 재현 안 됨 → job 수명주기·클레임·폴링만 검증 대상으로 한정(스토리지·노션 정확성은 prod 실측으로 이미 커버).
- **워커 상주 여부는 인프라 결정 별개.** 지금은 web+worker 단일 컨테이너. 발행 job도 같은 폴러가 처리 → 변환과 CPU 공유는 남음(워커 분리는 부록·다음 라운드).

---

## 6. 구현 순서 (승인 후)

1. `006_publish_job.sql` 작성(로컬 적용).
2. 발행 코어 추출 + 주입 리팩터(웹 래퍼 유지, 타입체크 green).
3. `run-publish-job.mjs` + poll-loop 편입 + 원자적 클레임.
4. 트리거 route enqueue 개편 + `/publish/status` 조회 route.
5. 프론트 폴링 전환(스트리밍 제거).
6. 로컬 pg 스테이지에서 §4 시나리오 전부 통과.
7. 결과 보고 → 성빈님이 prod 반영(마이그레이션·머지) 여부 결정.

---

## 부록 — 다음 라운드 스케치 (이번 범위 아님)

- **업로드 직행**: 브라우저→서버→Supabase를 브라우저→Supabase 직접(서버는 서명 upload URL만 발급). 업로드가 서버 부하와 무관해져 "패치오류(fetch failed)" 근본 차단. `manual-source` 버킷 signed upload + 완료 후 서버에 소스파일 등록 알림.
- **워커 분리**: Railway에 변환/발행 워커를 별도 서비스로(코드는 이미 poll-loop 독립, 인프라만 분리). 변환·발행이 웹 CPU를 잠식하지 않게. **성빈님 인프라 확인 필요.**
