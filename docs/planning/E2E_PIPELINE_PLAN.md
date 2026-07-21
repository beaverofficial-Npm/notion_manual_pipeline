# E2E Pipeline Execution Plan

## 1. 목표

실제 제품의 기준 흐름은 아래와 같다.

```text
PPT 업로드
→ 실행
→ 전체 슬라이드 렌더/분석
→ 전체보기 갤러리
→ 슬라이드별 영역/텍스트 검수
→ 편집 결과 저장
→ Notion 미리보기
→ Notion 발행
→ 발행 결과 저장
```

이 문서는 파일럿 preview가 아니라 실제 파이프라인 구현 순서를 정의한다.

## 2. 핵심 원칙

- 한 장짜리 데모가 아니라 PPT 전체를 처리한다.
- 사용자는 전체 슬라이드를 먼저 훑고, 필요한 슬라이드만 깊게 편집할 수 있어야 한다.
- crop/영역 편집은 슬라이드별로 저장된다.
- Notion 발행 전에는 반드시 미리보기를 제공한다.
- MVP의 발행 방식은 기존 페이지를 파괴적으로 수정하지 않고, 대상 페이지 아래 새 하위 페이지를 생성한다.

## 3. 화면 구조

### 3.1 작업 리스트

목적:

- 업로드된 작업 확인
- 실행
- 결과 열기

필수 기능:

- PPT 업로드
- 작업 생성
- 실행 버튼
- 상태 표시
- 결과 보기

### 3.2 작업 결과

목적:

- 전체 변환 상태를 보고 검수로 진입한다.

구성:

- 작업명
- 원본 PPT
- 현재 상태
- 슬라이드 수
- 검수 완료 수
- 오류/경고 수
- 전체보기
- Notion 미리보기
- Notion 발행

### 3.3 전체보기

목적:

- PPT 전체 슬라이드를 갤러리로 훑고, 여러 슬라이드를 한 번에 선택/처리한다.

구성:

- 썸네일 grid
- 슬라이드 번호
- 슬라이드 제목
- 상태 배지
  - 미검수
  - 수정 중
  - 승인됨
  - 제외됨
  - 오류
- 멀티 선택 checkbox
- 멀티 액션
  - 승인
  - 제외
  - 다시 분석
  - 화살표 제외
  - 문서 포함/제외

MVP 구현:

- 작업 결과 화면 안의 full-width section 또는 drawer로 시작한다.
- 모달은 사용하지 않는다. 썸네일이 많고 멀티 선택이 있으므로 모달은 답답하다.

### 3.4 슬라이드 편집

목적:

- 한 슬라이드의 이미지 영역과 텍스트를 검수한다.

구성:

- 상단
  - 전체보기
  - 이전
  - 현재 슬라이드 번호 / 전체 슬라이드 수
  - 다음
  - 승인
- 왼쪽
  - 실제 슬라이드 렌더 이미지
  - 영역 overlay
  - 새 영역 그리기
  - 영역 이동/크기 조정
- 오른쪽
  - 영역 목록
  - 선택 영역 편집
    - 이름
    - 종류
      - 화면 이미지
      - QR
      - 표 이미지
      - 어노테이션
      - 확인 필요
    - 좌표
    - 초기화
    - 삭제
- 별도 버튼
  - 노션 미리보기 모달

### 3.5 Notion 미리보기

목적:

- 발행 전 Notion에 들어갈 구조를 확인한다.

형태:

- 모달

구성:

- 페이지 제목
- heading/list/paragraph 후보
- image block 후보
- table 후보
- 제외된 항목 표시
- 경고 표시

MVP에서는 실제 Notion UI를 100% 복제하지 않는다. 대신 발행될 block 순서와 내용이 명확해야 한다.

## 4. 상태 모델

### 4.1 Task 상태

| 상태 | 의미 |
| --- | --- |
| `ready` | 업로드 완료, 실행 가능 |
| `running` | 변환 중 |
| `review_required` | 변환 완료, 검수 필요 |
| `ready_to_publish` | 필수 검수 완료 |
| `publishing` | Notion 발행 중 |
| `published` | 발행 완료 |
| `failed` | 실패 |

### 4.2 Slide 상태

| 상태 | 의미 |
| --- | --- |
| `pending` | 아직 검수하지 않음 |
| `review_required` | 자동 후보에 확인 필요 항목 있음 |
| `approved` | 검수 완료 |
| `excluded` | 문서에서 제외 |

### 4.3 Asset 상태

| 상태 | 의미 |
| --- | --- |
| `pending` | 자동 생성됨, 아직 확인 전 |
| `review_required` | 수동 확인 필요 |
| `approved` | 문서 포함 |
| `excluded` | 문서 제외 |

## 5. Worker 파이프라인

### 5.1 실행 API

`POST /api/tasks/[taskId]/run`

처리:

1. task 상태 확인
2. source file 확인
3. `manual_conversion_jobs` 생성
4. task 상태 `running`
5. worker가 처리할 queued job 등록

### 5.2 Worker 처리

입력:

- task id
- source file storage path
- run number

처리:

1. 원본 PPT 다운로드
2. Microsoft Graph PowerPoint renderer로 PPTX → PDF 변환
3. PDF → slide PNG 렌더
4. PPT XML 파싱
5. slide row 저장
6. text element 저장
7. picture/shape/table/line element 저장
8. image asset 후보 저장
9. Notion block 후보 저장
10. manifest 저장
11. task 상태 `review_required`

산출물:

- `manual-renders`: slide PNG
- `manual-assets`: crop 후보 이미지
- `manual-manifests`: run manifest
- DB rows
  - `manual_slides`
  - `manual_slide_elements`
  - `manual_assets`
  - `manual_notion_blocks`

### 5.3 MVP crop 생성

MVP의 자동 crop은 아래까지만 한다.

- 큰 picture object를 화면 이미지 후보로 잡는다.
- 작은 picture object는 보조 이미지 후보로 잡는다.
- QR detection은 후속 또는 간단 heuristic으로 시작한다.
- table object는 table 후보로 잡는다.
- arrow/line은 자동 포함하지 않고 warning으로 둔다.

## 6. API 계획

### 6.1 현재 완료

- `POST /api/tasks`
- `GET /api/tasks`

### 6.2 다음 구현

| Method | Path | 목적 |
| --- | --- | --- |
| `POST` | `/api/tasks/[taskId]/run` | 변환 job 생성 |
| `GET` | `/api/tasks/[taskId]` | 작업 상세 |
| `GET` | `/api/tasks/[taskId]/slides` | 전체보기/슬라이드 목록 |
| `GET` | `/api/slides/[slideId]` | 슬라이드 편집 데이터 |
| `PATCH` | `/api/slides/[slideId]` | 슬라이드 상태 수정 |
| `POST` | `/api/slides/[slideId]/assets` | 수동 영역 추가 |
| `PATCH` | `/api/assets/[assetId]` | 영역 이름/종류/좌표 수정 |
| `DELETE` | `/api/assets/[assetId]` | 영역 삭제 |
| `POST` | `/api/tasks/[taskId]/notion-preview` | 발행 preview 생성 |
| `POST` | `/api/tasks/[taskId]/publish` | Notion 발행 |

## 7. 저장 기준

### 7.1 영역 저장

사용자가 만든/수정한 영역은 `manual_assets`에 저장한다.

필수 값:

- slide id
- kind
- label
- crop box
- source element ids
- review status
- source
  - auto
  - manual

### 7.2 좌표 기준

좌표는 slide render 기준 percentage로 저장한다.

```json
{
  "left": 9.61,
  "top": 17.87,
  "width": 48.74,
  "height": 67.96
}
```

이유:

- 렌더 해상도가 바뀌어도 UI에서 재사용 가능
- crop 이미지 생성 시 pixel 좌표로 변환 가능

### 7.3 crop 이미지 생성

사용자가 검수 완료/저장하면 crop 이미지를 생성한다.

MVP에서는 둘 중 하나를 선택한다.

1. 편집 저장 시 즉시 생성
2. Notion 발행 직전 approved asset만 생성

권장:

- MVP는 2번. 불필요한 crop 파일 생성을 줄인다.

## 8. Notion 발행 계획

### 8.1 Preview 생성

Notion preview는 실제 Notion API 호출 전 local payload를 만든다.

입력:

- approved slides
- approved assets
- notion blocks

출력:

- page title
- block list
- image asset list
- warnings

### 8.2 발행 정책

MVP:

- 대상 Notion 페이지 아래 새 child page 생성
- 기존 페이지 block 삭제/교체 없음

후속:

- 기존 페이지 update
- diff preview
- block mapping 기반 재발행

### 8.3 발행 순서

1. publish run 생성
2. preview payload 재검증
3. approved asset crop 이미지 생성
4. 이미지 upload 준비
5. Notion child page 생성
6. block append
7. local id ↔ Notion id mapping 저장
8. task 상태 `published`

## 9. 개발 순서

### Step 1. Run API

- `POST /api/tasks/[taskId]/run`
- job 생성
- task 상태 전환

완료 기준:

- 실행 버튼이 실제 job을 만든다.
- 작업 상태가 `running` 또는 `review_required`로 바뀐다.

### Step 2. Worker MVP

- 업로드된 PPT 다운로드
- 전체 slide PNG 렌더
- slide row 저장
- manifest 저장

완료 기준:

- 전체보기에서 37개 썸네일을 볼 수 있다.

### Step 3. Slide/Asset 추출

- PPT XML 파싱
- text 후보 저장
- image 후보 저장
- 기본 asset bbox 저장

완료 기준:

- 슬라이드 편집 화면에서 실제 후보 영역이 보인다.

### Step 4. 전체보기

- 썸네일 갤러리
- 이전/다음 이동
- 멀티 선택
- 멀티 승인/제외

완료 기준:

- 사용자가 한 장씩만 보지 않고 전체 흐름을 훑을 수 있다.

### Step 5. 영역 편집 저장

- 수동 영역 추가
- 영역 수정
- 영역 삭제
- 종류 변경
- 라벨 변경

완료 기준:

- 새로고침 후에도 수정 결과가 유지된다.

### Step 6. Notion Preview

- 문서 구조 preview 생성
- 모달 표시
- 경고 표시

완료 기준:

- 발행 전 사용자가 Notion에 들어갈 내용을 확인할 수 있다.

### Step 7. Notion Publish

- child page 생성
- block append
- image block 처리
- mapping 저장

완료 기준:

- 파일럿 상품 페이지가 실제 Notion 하위 페이지로 생성된다.

## 10. MVP 완료 기준

- 업로드된 PPT 전체가 렌더링된다.
- 전체보기에서 모든 슬라이드를 볼 수 있다.
- 슬라이드별 영역을 추가/수정/삭제할 수 있다.
- 편집 결과가 DB에 저장된다.
- Notion preview를 볼 수 있다.
- approved slide/asset 기준으로 Notion child page가 발행된다.
- 발행 결과가 DB에 저장된다.

## 11. 지금 바로 다음 작업

다음 구현은 아래 순서로 진행한다.

1. `POST /api/tasks/[taskId]/run`
2. local worker script를 실제 task/source file 기준으로 변경
3. 전체 slide render 저장
4. `GET /api/tasks/[taskId]/slides`
5. 전체보기 갤러리
6. 슬라이드 편집 화면을 실제 DB 데이터로 연결
