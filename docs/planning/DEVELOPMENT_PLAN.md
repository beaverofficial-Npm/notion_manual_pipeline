# Development Plan

## 1. 개발 목표

PPT 매뉴얼을 업로드하고, 변환 후보를 생성하고, 사용자가 웹에서 검수한 뒤 Notion에 발행하는 end-to-end MVP를 만든다.

UI의 목적은 파이프라인 조작이다. 운영 대시보드, 통계, 장식적 화면은 만들지 않는다.

실제 구현 순서와 화면/API/worker 연결 기준은 `E2E_PIPELINE_PLAN.md`를 우선 기준으로 한다.

## 2. 현재 기준

완료:

- Next.js 프로젝트 생성
- Beaverworks Design System 설치
- Supabase JS 설치
- GitHub remote 설정
- Supabase project 기준 문서화
- PRD/IA/변환규칙/인프라 초안 작성

진행해야 할 핵심:

- Supabase schema 정교화
- upload/task API 구현
- conversion worker 설계 및 MVP 구현
- result review UI 구현
- Notion publish 구현
- 품질 게이트 구현

## 3. 단계별 계획

### Phase 0. 문서/기준 고정

목표:

- 제품 목적, 범위, 파이프라인, 기술 설계를 고정한다.

작업:

- PRD 확정
- IA 확정
- 변환 규칙 확정
- 파이프라인 상세 문서 작성
- 기술 설계 문서 작성
- 개발 순서와 품질 게이트 작성

완료 기준:

- 문서만 보고도 "PPT를 웹에서 Notion 변환 작업으로 처리하는 도구"임이 명확하다.
- Supabase가 단순 표시용 데이터 저장소가 아니라 파이프라인 저장소임이 명확하다.
- 변환 자동화와 사람 검수의 경계가 정리되어 있다.

### Phase 1. 작업 생성과 파일 저장

목표:

- 사용자가 PPT를 업로드하고 작업 리스트에서 볼 수 있다.

작업:

- Supabase schema 적용
- Storage bucket 생성
  - `manual-source`
  - `manual-renders`
  - `manual-assets`
  - `manual-manifests`
- `/api/tasks` 구현
- signed upload URL 구현
- 작업 리스트 실제 DB 연동
- 작업 생성 UI 실제 API 연동

완료 기준:

- PPT 파일이 Supabase Storage에 저장된다.
- 작업 row가 DB에 생성된다.
- 리스트에서 실제 작업이 보인다.
- mock 데이터가 제거된다.

검증:

- `npm run typecheck`
- 수동 업로드 테스트
- Supabase DB/Storage 확인

### Phase 2. 변환 job과 worker MVP

목표:

- 업로드된 PPT를 worker가 처리하고 slide render와 manifest를 만든다.

작업:

- `manual_conversion_jobs` 구현
- job enqueue API 구현
- local worker script 작성
- LibreOffice 기반 PPTX to PDF 변환
- PDF to PNG render
- PPT 객체 파싱
- slide/element manifest 생성
- 결과를 Supabase DB/Storage에 저장

완료 기준:

- 사용자가 작업에서 `실행`을 누르면 job이 생성된다.
- worker가 job을 처리한다.
- 각 slide preview PNG가 저장된다.
- slide별 element metadata가 DB에 저장된다.

검증:

- 실제 `비버_매장관리 APP 통합가이드` PPT로 실행
- slide 수와 render 수가 일치하는지 확인
- 실패 시 error_message가 남는지 확인

### Phase 3. 후보 생성

목표:

- 텍스트, 이미지, QR, 표 후보를 자동으로 만든다.

작업:

- text box to Notion block 후보 생성
- picture/shape 기반 screenshot 후보 생성
- QR 후보 감지
- table 객체 추출
- annotation 후보 분리
- crop 이미지 생성
- 후보별 confidence/review_reason 저장

완료 기준:

- 슬라이드별 text/image/qr/table 후보가 표시된다.
- 설명 텍스트 포함 전체 슬라이드 crop이 기본 후보로 나오지 않는다.
- QR은 플랫폼별 분리 후보로 생성된다.
- 표가 누락되면 review warning이 생긴다.

검증:

- 다운로드 페이지: 휴대폰 화면, Android QR, iOS QR 분리 확인
- 상품 페이지: 판매상품 검색 crop에서 화살표/본문 제외 확인
- 상품 페이지: 품절 표 후보 생성 확인

### Phase 4. 검수 UI

목표:

- 사용자가 자동 후보를 검수하고 수정할 수 있다.

작업:

- 작업 결과 화면 실제 데이터 연동
- slide list 구현
- slide preview 구현
- element/crop overlay 구현
- asset classification 변경
- crop box 수정
- table review
- Notion block preview
- slide/task review status 계산

완료 기준:

- 사용자가 후보를 approve/exclude/수정할 수 있다.
- 모든 필수 검수 항목을 처리해야 `ready_to_publish`가 된다.
- UI는 DS 컴포넌트/token 기준을 지킨다.

검증:

- 데스크톱/모바일 레이아웃 캡처 확인
- 임의 CSS 색상/spacing 생성 여부 확인
- 검수 완료 전 발행 버튼 비활성 확인

### Phase 5. Notion 발행 MVP

목표:

- 검수 완료 결과를 Notion에 실제 발행한다.

작업:

- Notion integration env 구성
- Notion target validation
- publish preview payload 생성
- Notion page create 구현
- image upload 구현
- block append 구현
- publish run 저장
- mapping 저장

완료 기준:

- 대상 페이지 아래 새 하위 페이지가 생성된다.
- 텍스트는 Notion block으로 들어간다.
- 이미지/QR은 올바른 asset 단위로 들어간다.
- 표는 Notion table로 들어간다.
- 발행 결과 page/block id가 저장된다.

검증:

- 파일럿 상품 페이지 발행
- 파일럿 다운로드 페이지 발행
- Notion에서 사람이 읽어 품질 기준 확인

### Phase 6. 재실행/버전/안전장치

목표:

- 반복 작업과 실패 복구가 가능하다.

작업:

- run_number/version 관리
- 이전 결과 열람
- 재실행 시 이전 결과 보존
- publish duplicate warning
- failed job retry
- partial publish recovery

완료 기준:

- 같은 PPT를 재실행해도 이전 산출물을 잃지 않는다.
- 실패한 작업을 재시도할 수 있다.
- 발행 중 일부 실패가 추적된다.

## 4. 우선순위

| 우선순위 | 항목 | 이유 |
| --- | --- | --- |
| P0 | 작업 생성/업로드/저장 | 모든 파이프라인의 시작점 |
| P0 | worker render/parser | 실제 PPT 변환의 핵심 |
| P0 | 후보 검수 | 자동화 한계 보완 |
| P0 | Notion 발행 | 제품의 최종 목적 |
| P1 | crop 편집 개선 | 파일럿 품질 향상 |
| P1 | table editor | 표 품질 향상 |
| P1 | 재실행 버전 관리 | 운영 안정성 |
| P2 | 권한/조직 관리 | MVP 이후 |
| P2 | 통계/리포트 | 현재 목적 아님 |

## 5. 구현 순서

1. schema를 문서 기준으로 정리한다.
2. Supabase client/server helper를 만든다.
3. task create/list/detail API를 만든다.
4. UI mock 데이터를 실제 API로 교체한다.
5. worker job table과 enqueue API를 만든다.
6. local worker를 만든다.
7. slide render 저장까지 연결한다.
8. PPT object parser를 붙인다.
9. 후보 생성과 crop 저장을 붙인다.
10. 검수 UI를 실제 데이터로 연결한다.
11. publish preview를 만든다.
12. Notion 발행을 붙인다.

## 6. 리스크와 대응

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| PPT 내부 구조가 파일마다 다름 | 후보 품질 저하 | object parser + render 기반 fallback 병행 |
| LibreOffice 렌더 결과가 원본과 다름 | crop 좌표 오차 | render pixel 좌표 기준으로 최종 crop |
| 자동 annotation 판단 오류 | 이미지 품질 저하 | annotation은 검수 필수로 처리 |
| 표 추출 실패 | 내용 누락 | table fallback image + review warning |
| Notion API rate/size 제한 | 발행 실패 | publish run 단위 retry와 block batch 처리 |
| Vercel runtime 한계 | 변환 실패 | worker를 container runtime으로 분리 |
| 비밀키 노출 | 보안 사고 | service role/Notion token server-only 유지 |

## 7. 개발 규칙

- UI는 Beaverworks DS 컴포넌트/token을 우선한다.
- 새 CSS는 token 기반으로만 작성한다.
- 임의 색상값, 임의 spacing scale, 장식용 카드/대시보드는 만들지 않는다.
- API는 mock이 아니라 Supabase 실제 상태를 기준으로 만든다.
- worker 산출물은 manifest로 남겨 재현 가능하게 한다.
- destructive Notion update는 MVP에서 하지 않는다.
- 실패한 작업은 사용자가 원인을 볼 수 있어야 한다.

## 8. Definition of Done

기능 단위 DoD:

- 실제 DB/Storage와 연결되어 있다.
- 실패 상태가 저장된다.
- 사용자에게 다음 행동이 보인다.
- typecheck를 통과한다.
- 품질 게이트를 만족한다.

파이프라인 DoD:

- 업로드부터 발행까지 하나의 task id로 추적된다.
- 모든 산출물은 source/job/run과 연결된다.
- 사람이 검수한 결정은 재실행 전까지 유지된다.
- Notion 발행 결과가 매핑으로 저장된다.

## 9. 바로 다음 작업

1. `supabase/schema.sql`을 기술 설계 기준으로 확장한다.
2. Supabase bucket 생성 절차를 정리하고 적용한다.
3. `/api/tasks`와 upload flow를 구현한다.
4. mock UI 데이터를 Supabase task 데이터로 교체한다.
5. local conversion worker의 최소 skeleton을 만든다.
