# Pipeline Specification

## 1. 목적

이 문서는 PPT 매뉴얼을 Notion 매뉴얼로 옮기는 실제 작업 절차를 웹 파이프라인으로 정의한다.

핵심은 자동 변환이 아니라 `자동 후보 생성 + 사람 검수 + Notion 발행`이다. 사람이 수동으로 했던 판단을 시스템이 완전히 대체하지 않고, 반복 작업을 줄이고 누락을 막는 구조로 만든다.

## 2. 파이프라인 원칙

| 원칙 | 설명 |
| --- | --- |
| 원본 보존 | 업로드된 PPT는 항상 원본으로 보존한다. |
| 변환 결과 버전화 | 재실행 결과는 이전 결과를 즉시 덮어쓰지 않고 새 run/version으로 저장한다. |
| 편집 가능한 텍스트 우선 | 설명 문구는 이미지가 아니라 Notion 텍스트 블록 후보로 만든다. |
| 고정 캡처 | 모든 `content` 슬라이드에서 템플릿의 실측 이미지 박스를 그대로 캡처한다. |
| 애매하면 검수 | 자동 판단이 불확실하면 발행 차단 또는 검수 필요 상태로 둔다. |
| 발행 전 preview | Notion에 쓰기 전 생성될 블록 구조를 사용자가 확인한다. |

## 3. 전체 흐름

1. PPT 업로드
2. 작업 생성
3. 변환 실행
4. 슬라이드 렌더링
5. PPT 객체 파싱
6. 슬라이드 역할·텍스트 구조 분류
7. 고정 이미지 박스 캡처
8. Notion 블록 후보 생성
9. 사용자 검수
10. 발행 payload 생성
11. Notion 이미지 업로드
12. Notion 페이지 생성 또는 업데이트
13. 발행 결과 저장

## 4. 단계별 상세

### 4.1 PPT 업로드

입력:

- `.pptx` 파일
- 작업명
- Notion 대상
  - 기존 페이지 URL 또는 page id
  - DB/data source id
  - 새 하위 페이지 생성 여부

처리:

- 파일 확장자와 MIME type을 검사한다.
- 원본 PPT를 `manual-source` bucket에 저장한다.
- `manual_tasks`와 `manual_source_files` row를 생성한다.

출력:

- task id
- source file id
- upload path
- 상태: `ready`

### 4.2 변환 job 생성

입력:

- task id
- source file id

처리:

- `manual_conversion_jobs` row를 `queued`로 생성한다.
- 이전 job이 `running`이면 중복 실행을 막는다.
- 재실행이면 새 `run_number`를 부여한다.

출력:

- job id
- 상태: `queued`

### 4.3 슬라이드 렌더링

목적:

- 사용자가 원본 슬라이드를 검수할 수 있도록 slide preview를 만든다.
- 고정 이미지 박스를 자를 기준 좌표계를 확보한다.

권장 방식:

- Microsoft Graph의 PowerPoint renderer로 PPTX를 PDF로 변환
- PDF 페이지를 PNG로 렌더링
- 숨김 슬라이드를 제외한 PDF page를 원본 slide number에 명시적으로 매핑
- 모든 `content` 페이지는 공통 실측 고정 박스를 padding 0으로 캡처

출력:

- slide preview PNG
- slide width/height
- render scale
- per-slide storage path

### 4.4 PPT 객체 파싱

목적:

- 슬라이드 역할과 오른쪽 설명 텍스트 구조를 판별한다. 이미지 캡처 여부와 좌표는 객체 탐지로 결정하지 않는다.

파싱 대상:

- text box
- picture
- shape
- table
- line/arrow
- group
- placeholder
- connector

권장 도구:

- Python: `python-pptx`
- 필요 시 PPTX zip 내부 XML 직접 파싱
- 이미지 후처리: Pillow 또는 sharp

저장할 정보:

- element id
- slide id
- type
- text content
- bounding box
- z-order
- style hint
- relationship id
- raw metadata

### 4.5 역할·텍스트 분류

분류값:

| kind | 의미 | 기본 처리 |
| --- | --- | --- |
| `text` | 제목, 본문, 단계 설명 | Notion 텍스트 블록 |
| `table` | 표 | Notion table 우선 |
| `unknown` | 판단 불가 | 검수 필요 |

분류 기준:

- 텍스트가 포함된 객체는 기본 `text`이다.
- PPT table 객체는 `table` 후보이다.
- 이미지, 화살표, 번호, 강조 박스는 개별 분리하지 않고 PowerPoint 렌더에 보이는 상태로 고정 캡처에 포함한다.

### 4.6 고정 이미지 캡처

목적:

- 템플릿의 연회색 이미지 박스 영역을 PowerPoint 렌더에서 그대로 보존한다.

캡처 규칙:

- 역할이 `content`이면 OOXML picture/group 후보 수와 무관하게 캡처한다.
- 실측 비율 `x=.036458, y=.171296, w=.606771, h=.694444`를 사용한다.
- padding은 0이며 화면·화살표·번호·강조 박스를 렌더 그대로 포함한다.
- 변환 시 완성된 PNG를 현재 task/job/run 경로에 저장한다.
- 검수·미리보기·발행 시 추가 crop을 수행하지 않는다.

저장:

- `kind=group_bake`
- 현재 conversion job id
- 현재 run의 storage path
- 고정 capture box와 render provenance가 포함된 manifest

### 4.7 텍스트/블록 후보 생성

목적:

- Notion에서 편집 가능한 문서 구조를 만든다.

변환 예:

| PPT 내용 | Notion 후보 |
| --- | --- |
| 슬라이드 제목 | heading_2 또는 heading_3 |
| 단계 번호 | numbered_list_item |
| 일반 설명 | paragraph 또는 bulleted_list_item |
| 주의/참고 | callout |
| 링크 | bookmark 또는 rich_text link |
| 표 | table/table_row |
| 이미지 | image block + caption |

블록 생성 원칙:

- PPT의 시각 위치보다 읽는 순서를 우선한다.
- 페이지 제목, 섹션 제목, 단계 설명, 이미지, 표 순서로 구성한다.
- 이미지가 설명을 대신하지 않도록 캡션이나 앞뒤 문장을 둔다.

### 4.8 검수

검수 단위:

- task
- slide
- 고정 캡처 asset
- Notion block candidate

사용자가 확인할 수 있어야 하는 항목:

- 이미지 박스 경계와 비율 무결성
- 화살표·번호·강조 박스·교체 이미지 반영 여부
- Notion block 순서 확인
- 발행 제외 처리

검수 완료 조건:

- 모든 대상 슬라이드에 현재 job의 고정 캡처 asset이 존재함
- Notion block preview에 누락된 핵심 콘텐츠가 없음
- 품질 게이트를 통과함

### 4.9 Notion 발행

발행 방식:

- 새 페이지 생성
- 기존 페이지 업데이트
- 기존 페이지 아래 하위 페이지 생성

권장 MVP:

- 기존 대상 페이지 아래 새 하위 페이지 생성
- 기존 블록 삭제/덮어쓰기는 후속 단계에서 안전장치와 함께 지원

처리:

1. 발행 run 생성
2. Notion payload 생성
3. 이미지 파일을 Notion upload 가능한 형태로 준비
4. Notion page/block 생성
5. Notion block id와 local candidate id 매핑 저장
6. 발행 결과 저장

실패 처리:

- 부분 성공이면 생성된 Notion ids를 저장한다.
- 같은 payload 재시도 시 중복 생성 위험을 표시한다.
- 기존 페이지 삭제나 블록 대량 삭제는 명시 승인 없이는 실행하지 않는다.

## 5. 파일럿 기준

### 5.1 다운로드 및 설치

기준:

- 휴대폰 화면 이미지는 하나의 화면 흐름 이미지로 유지할 수 있다.
- Android QR과 iOS QR은 각각 별도 asset이어야 한다.
- QR 주변 설명 텍스트는 Notion 텍스트로 옮기고 이미지에 포함하지 않는다.

발행 품질:

- 사용자가 Notion에서 Android/iOS 다운로드 링크와 QR을 구분해서 볼 수 있어야 한다.

### 5.2 프랜차이즈 전용 상품 페이지

기준:

- `판매상품 검색`은 화면 이미지 영역만 crop한다.
- 화살표는 crop에서 제외하고, 연결성은 Notion 순서/캡션으로 표현한다.
- `판매상품 품절`의 표는 누락하지 않고 Notion table로 만든다.
- table 변환이 어려우면 임시 fallback 이미지와 함께 `table_review_required`를 남긴다.

발행 품질:

- 설명 텍스트가 이미지 안에 갇히지 않아야 한다.
- 표 데이터가 검색/복사 가능한 Notion table이어야 한다.

## 6. 상태 전이

| from | action | to |
| --- | --- | --- |
| `draft` | 작업 생성 | `ready` |
| `ready` | 실행 | `running` |
| `running` | 후보 생성 완료 | `review_required` |
| `running` | 오류 | `failed` |
| `review_required` | 모든 필수 검수 완료 | `ready_to_publish` |
| `ready_to_publish` | 발행 | `publishing` |
| `publishing` | 발행 완료 | `published` |
| `publishing` | 오류 | `failed` |
| `failed` | 재실행 | `running` |

## 7. 자동화와 수동 판단 경계

자동화 대상:

- slide render
- PPT object extraction
- text candidate extraction
- first-pass crop candidate
- QR candidate detection
- table candidate extraction
- Notion payload draft

사람 검수 대상:

- crop 범위 확정
- annotation 포함 여부
- 표 변환 정확도
- Notion 읽기 순서
- 기존 페이지 업데이트 위험 판단
- 발행 최종 승인

## 8. MVP 성공 기준

- PPT 업로드부터 Notion 발행까지 한 작업이 끊기지 않고 이어진다.
- 다운로드 페이지와 상품 페이지 파일럿 기준을 웹에서 재현할 수 있다.
- 설명 텍스트 전체가 이미지 crop에 포함되는 문제가 품질 게이트에서 잡힌다.
- QR과 표 누락이 발행 전 검수 단계에서 잡힌다.
- 발행 결과의 Notion page/block id가 저장된다.
