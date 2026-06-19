# Current Status

작성일: 2026-06-18

이 문서는 Notion Manual Pipeline의 현재 구현, 배포, 검증 상태를 한 페이지에서 확인하기 위한 현행 문서이다. 상세 기획은 `PRD.md`, `PIPELINE_SPEC.md`, `TECHNICAL_DESIGN.md`, `E2E_PIPELINE_PLAN.md`를 기준으로 한다.

## 1. 현재 한 줄 요약

PPT 업로드 → 변환 job 생성 → Railway 상주 worker 변환 → 웹 검수/수정 → Notion 발행까지 이어지는 end-to-end MVP가 운영 배포되어 있다.

현재 중점은 "변환 자체가 된다"에서 "대형 PPT에서도 구조가 덜 깨지고, 검수 UX가 실제 작업에 쓸 만큼 빠르고 예측 가능하다"로 이동했다.

## 2. 운영 배포 상태

| 항목 | 현행 |
| --- | --- |
| Repository | `sungbinhwang-beaverworks/notion_manual_pipeline` |
| Branch | `main` |
| 배포 환경 | Railway production |
| 서비스 | `notion_manual_pipeline` |
| Public domain | `https://notionmanualpipeline-production.up.railway.app` |
| 최신 배포 커밋 | `fab3d7e fix: 빈 검수 페이지 생성 방지` |
| 최신 배포 상태 | `SUCCESS` |
| 빌더 | Dockerfile |
| 런타임 구성 | Next.js web + conversion worker 단일 컨테이너 |

Railway는 `railway.json`의 Dockerfile 빌더 설정을 사용한다. Docker image 안에 LibreOffice, Poppler, 한글 폰트를 포함한다.

## 3. 인프라 구성

### Web

- Next.js App Router
- Beaverworks Design System 기반 UI
- 주요 화면
  - 메인: PPT 업로드, 작업 목록, 변환 시작/중단/삭제, 발행 상태 확인
  - 검수 화면: 카테고리/기능 트리, 슬라이드 렌더, crop 후보 수정, Notion 발행 미리보기, Notion 발행

### Worker

- `scripts/start.sh`가 컨테이너 시작 시 worker와 web을 함께 실행한다.
- worker entry:
  - `scripts/worker/poll-loop.mjs`
  - `scripts/worker/run-conversion-job.mjs`
- 변환 도구:
  - LibreOffice: PPT/PPTX → PDF
  - Poppler `pdftoppm`: PDF → PNG slide render
  - `pdfinfo`: PDF page count

### Supabase

- Postgres: task, source file, conversion job, slide, category, function, asset, Notion block, publish run, mapping 저장
- Storage:
  - `manual-source`: 원본 PPT
  - `manual-renders`: slide PNG render
  - `manual-assets`: crop 결과 이미지
  - `manual-manifests`: 변환 manifest

### Notion

- Notion integration token을 서버/worker 환경변수로 사용한다.
- 발행 방식은 대상 페이지 아래에 새 페이지를 생성하고, 카테고리/기능 heading과 텍스트/이미지/table block을 append하는 구조이다.
- 발행 미리보기 API로 Notion에 들어갈 구조를 먼저 확인할 수 있다.

## 4. 구현 완료 범위

### 작업 생성/관리

- PPT/PPTX 업로드
- Supabase Storage 원본 저장
- task/source file row 생성
- 작업 목록 실제 DB 연동
- 작업 삭제 API 및 Storage 정리
- running/publishing 상태의 삭제 방지

### 변환 실행

- task별 conversion job 생성
- worker poll-loop로 queued job 처리
- 컨테이너 재시작 후 stuck running job 회수
- 변환 실패 시 job/task에 error_message 저장
- 대형 PPT를 위한 `pdftoppm` chunk 렌더링 적용
  - 화질을 낮추지 않고 page range로 나누어 처리
  - 기본 `PDFTOPPM_CHUNK_SIZE=20`
  - `PDFTOPPM_CHUNK_TIMEOUT_MS`로 chunk timeout 조정 가능

### PPT 분석/구조화

- slide role 판별: cover, toc, section, content
- 표지/목차는 본문 발행 대상에서 제외
- section/content 기반 카테고리 → 기능 → 슬라이드 트리 생성
- 목차-본문 제목 매칭 보강
  - 공백/기호/괄호 차이 흡수
  - `스템프`/`스탬프` 표기 차이 흡수
  - 짧은 오타 수준 fuzzy match
- 슬라이드가 0개인 빈 기능/빈 카테고리는 변환 결과와 검수 API에서 제외

### 본문/이미지 후보

- 단계 번호를 numbered list 후보로 변환
- 하위 설명을 bullet/paragraph 후보로 변환
- 참고/주의 문구를 callout 후보로 변환
- PPT table 객체를 table 후보로 변환
- 이미지 zone clustering으로 인접 이미지를 crop 후보로 묶음
- crop box를 Supabase row로 저장

### 검수 UI

- 카테고리/기능 트리 표시
- 기능 단위 슬라이드 묶음 표시
- slide render 표시
- crop 후보 선택/수정
- crop 후보 추가/삭제
- crop label/kind 수정
- 카테고리/기능명 수정
- 기능 단위 발행 제외/포함
- 제외 페이지 수 표시
- 하단/목록 기반 페이지 이동
- Notion 발행 미리보기 모달

### Notion 발행

- 발행 미리보기 payload 생성
- Notion page 생성
- heading/paragraph/list/callout/table/image block 생성
- render + crop_box 기반 이미지 업로드
- 발행 진행률 streaming 표시
- 발행 중 취소
- publish run 및 Notion mapping 저장
- 발행 완료 URL 표시

## 5. 최근 해결한 주요 문제

### 5.1 대형 POS PPT 변환 실패

증상:

- `01 비버_포스_통합이용가이드_ver1.0_260615.pptx` 변환 중 `pdftoppm` 실패
- 전체 PDF를 한 번에 PNG 렌더링하면서 timeout이 발생

해결:

- `pdftoppm`을 전체 렌더가 아니라 page range chunk 렌더로 변경
- `pdfinfo`로 page count를 먼저 확인
- chunk별 missing output 검증 추가
- exec error에 `signal`, `killed`, stdout/stderr 일부를 포함하도록 개선

검증:

- POS PPT 225장 변환 성공
- task 상태: `review_required`
- job 상태: `succeeded`
- manifest 생성 완료

### 5.2 빈 검수 페이지 생성

증상:

- 검수 트리에 `결제하기`, `기타 설정`, `쿠폰(스템프) 결제` 같은 빈 페이지가 생김
- 클릭하면 우측 편집 패널이 비어 있음

원인:

- 목차/섹션에서 뽑은 기능명과 실제 본문 슬라이드 제목이 완전 일치하지 않음
- 예: `쿠폰(스템프) 결제` vs `쿠폰(스탬프)결제`
- 큰 목차/분기 슬라이드의 항목이 빈 기능으로 남음

해결:

- 이름 정규화 기준 확대
- fuzzy match 추가
- 슬라이드 0개 기능/카테고리 필터링
- 기존 생성 데이터도 검수 API에서 빈 기능을 내려주지 않도록 처리

검증:

- 운영 API 기준 POS 작업 검수 트리
  - 카테고리: 20
  - 기능: 115
  - 빈 기능: 0
  - 제외 슬라이드: 26

## 6. 현재 검증된 파일럿 결과

### POS 통합이용가이드

파일:

- `01 비버_포스_통합이용가이드_ver1.0_260615.pptx`

결과:

| 항목 | 값 |
| --- | --- |
| 원본 슬라이드 | 225 |
| 검수 트리 카테고리 | 20 |
| 검수 트리 기능 | 115 |
| 빈 기능 | 0 |
| 제외 슬라이드 | 26 |
| 변환 job | succeeded |
| task 상태 | review_required |

의미:

- 대형 PPT 변환은 통과했다.
- 목차/본문 구조화는 사람이 검수 가능한 수준으로 들어왔다.
- 다만 카테고리/기능 분류 품질은 추가 샘플에서 더 검증해야 한다.

## 7. 현재 남은 주요 리스크

### 7.1 Tree API 성능

현상:

- 225장 작업의 `/api/tasks/:taskId/tree` 응답이 느리다.

원인:

- slide render signed URL을 다수 생성한다.
- 현재는 render path별 signed URL 생성이 순차에 가까운 구조이다.

개선 방향:

- signed URL batch 생성 또는 병렬 생성
- 첫 화면에 필요한 슬라이드만 lazy load
- 기능 선택 시 해당 기능의 render/assets만 가져오는 API 분리

### 7.2 목차/섹션 판별 정확도

현상:

- PPT마다 섹션 표지/목차/본문 디자인이 다르면 잘못 분류될 수 있다.

개선 방향:

- 실제 PPT 4종 전체에 대한 fixture 기반 회귀 테스트 작성
- section 판별 기준에 위치/텍스트 패턴/슬라이드 전후 관계를 함께 반영
- "빈 기능 0개", "모든 content slide가 어느 기능에 연결됨" 같은 품질 게이트 추가

### 7.3 Crop 후보 품질

현상:

- 이미지 zone clustering은 동작하지만, 사람이 기대하는 의미 단위와 항상 일치하지 않을 수 있다.
- 화살표/어노테이션 포함 여부는 케이스별 판단이 필요하다.

개선 방향:

- PPT 내부 connector/line/shape를 별도 annotation 후보로 저장
- 사용자가 원본 render 위에서 직접 crop/annotation을 조정하는 흐름 강화
- 특정 페이지 유형별 rule 추가: QR, 앱 화면, 표, 검색 결과, 품절/노출 등

### 7.4 Notion 발행 품질

현상:

- 발행 자체는 가능하지만 최종 Notion 페이지의 정보 구조/이미지 배치/표 변환 품질은 추가 검수가 필요하다.

개선 방향:

- POS 파일 일부 페이지를 기준으로 Notion 결과물 QA
- 발행 전 preview와 실제 Notion 결과 차이 점검
- Notion API rate limit/retry 정책 보강

### 7.5 운영 안정성

현상:

- 웹과 worker가 단일 컨테이너에 있어 MVP에는 단순하지만, 대형 변환 중 web 응답성과 worker 부하가 같은 인스턴스를 공유한다.

개선 방향:

- 필요 시 web/worker 서비스 분리
- job progress row 또는 job_events 테이블 추가
- 변환 단계별 progress 저장: upload, PDF 변환, render chunk, parsing, DB insert, manifest

## 8. 다음 우선순위

1. 검수 화면 API 성능 개선
   - 225장 작업을 열 때 지연이 가장 직접적인 UX 병목이다.
   - signed URL 생성 방식부터 개선한다.

2. 실제 검수 UX QA
   - POS 파일에서 주요 카테고리 몇 개를 선택해 crop/본문/이미지 후보 품질을 확인한다.
   - 빈 항목은 제거됐으므로 이제 "내용이 맞게 묶였는지"를 본다.

3. Notion 발행 파일럿
   - POS 파일 전체가 아니라 1~2개 카테고리 또는 기능 단위로 발행 결과를 확인한다.
   - 이미지 crop, text block, table, heading 구조를 Notion 실제 페이지에서 점검한다.

4. 변환 품질 게이트 추가
   - 변환 완료 후 자동 검증:
     - 원본 slide count와 저장 slide count 일치
     - 빈 function count 0
     - content slide 미연결 수 0 또는 의도된 excluded만 존재
     - manifest 존재

5. PPT 4종 회귀 테스트
   - POS
   - Kiosk
   - 매장관리 APP
   - 기타 통합 가이드

## 9. 최근 검증 명령

로컬 검증:

```bash
node --check scripts/worker/run-conversion-job.mjs
node --check scripts/worker/ppt-parse.mjs
npm run typecheck
npm run build
```

운영 확인:

```bash
curl -I https://notionmanualpipeline-production.up.railway.app
```

Railway 최신 배포:

```text
commit: fab3d7e
message: fix: 빈 검수 페이지 생성 방지
status: SUCCESS
builder: DOCKERFILE
```

## 10. 주의사항

- 비밀키는 문서에 기록하지 않는다.
- `.env`와 Railway variables에 있는 secret은 저장소에 커밋하지 않는다.
- Notion token, Supabase service role key, Railway token은 운영 접근 권한이 있으므로 필요 시 즉시 회전 가능해야 한다.
- 현재 문서는 2026-06-18 기준 현행이다. 이후 변환 품질/배포 상태가 바뀌면 이 문서를 업데이트한다.
