# Quality Gates

> 최신 이미지 업데이트·고정 캡처 마스터 검수: [2026-07-22 QA 리포트](../qa/image-update-stability-20260722/index.html)
>
> 현재 `group_bake` 모드는 화살표·번호·강조 박스를 포함한 PowerPoint 렌더 화면을 고정 좌표로 캡처한다. 아래의 개별 요소 분리 규칙은 레거시 `capture` 모드에만 적용한다.

## 1. 목적

품질 게이트는 PPT를 Notion으로 발행하기 전에 사람이 수동으로 잡아냈던 실수를 시스템에서 차단하기 위한 기준이다.

특히 아래 문제를 막는다.

- 설명 텍스트까지 포함한 전체 슬라이드 crop
- QR 분리 누락
- 표 누락
- 화살표/어노테이션 오인식
- Notion에서 편집 가능한 텍스트가 이미지에 갇히는 문제
- 기존 Notion 페이지를 실수로 덮어쓰는 문제

## 2. 발행 차단 조건

아래 조건은 `ready_to_publish`로 전환할 수 없다.

| 코드 | 조건 | 조치 |
| --- | --- | --- |
| `FULL_SLIDE_CROP_WITH_TEXT` | 이미지 후보가 슬라이드 대부분을 포함하고 텍스트 객체도 포함 | crop 수정 또는 제외 |
| `UNREVIEWED_REQUIRED_ASSET` | review required asset이 남아 있음 | approve/exclude/수정 필요 |
| `QR_NOT_SPLIT` | 같은 슬라이드에 Android/iOS QR이 있으나 하나의 이미지로 묶임 | QR별 crop 분리 |
| `TABLE_MISSING` | 표 객체 또는 표로 보이는 영역이 있으나 block/asset 후보가 없음 | table 후보 생성 또는 fallback |
| `TEXT_IMAGE_ONLY` | 핵심 설명 문구가 Notion text block 없이 이미지에만 존재 | text block 추가 |
| `PUBLISH_TARGET_MISSING` | Notion 대상 page/data source가 없음 | 대상 입력 |
| `DESTRUCTIVE_UPDATE` | 기존 Notion block 삭제/대량 교체가 필요한 발행 | MVP에서는 차단 |

## 3. 경고 조건

경고는 발행을 막지 않을 수 있으나 사용자 확인을 요구한다.

| 코드 | 조건 | 조치 |
| --- | --- | --- |
| `LOW_CONFIDENCE_CROP` | crop confidence가 낮음 | 사용자가 확인 |
| `ANNOTATION_INCLUDED` | 번호/강조 박스가 이미지에 포함됨 | 포함 여부 확인 |
| `ARROW_DETECTED` | 화살표/connector가 감지됨 | crop 제외 여부 확인 |
| `TABLE_FALLBACK_IMAGE` | table block 대신 이미지 fallback 사용 | 후속 table 변환 권장 |
| `NOTION_PAYLOAD_LARGE` | 발행 block/image 수가 큼 | batch 발행 확인 |

## 4. 수동 파일럿 기준

### 다운로드 및 설치

Pass:

- 휴대폰 화면 이미지와 QR이 분리되어 있다.
- Android QR과 iOS QR이 각각 별도 asset이다.
- 다운로드 설명 텍스트가 Notion text로 존재한다.

Fail:

- QR 2개가 하나의 이미지로 묶여 있다.
- QR 주변 안내 문구 전체가 이미지로만 들어간다.
- 휴대폰 화면과 QR이 구분 없이 한 crop에 들어간다.

### 프랜차이즈 전용 상품

Pass:

- `판매상품 검색`은 화면 영역만 crop한다.
- 화살표는 이미지에서 제외하거나 검수된 annotation으로만 포함한다.
- `판매상품 품절` 표가 Notion table 또는 table fallback으로 존재한다.

Fail:

- 본문 텍스트까지 포함한 전체 crop을 사용한다.
- 품절 관련 표가 누락된다.
- 표를 이미지로만 넣고 table review warning도 없다.

## 5. 자동 검사 규칙

### 5.1 전체 슬라이드 crop 감지

조건:

- crop area / slide area > 0.65
- crop 내부에 text element가 2개 이상 포함

결과:

- `FULL_SLIDE_CROP_WITH_TEXT`

예외:

- 슬라이드 자체가 단일 이미지 매뉴얼인 경우 사용자가 명시 approve할 수 있다.

### 5.2 QR 분리 감지

조건:

- 한 슬라이드에서 QR 후보가 2개 이상
- 하나의 asset crop이 QR 후보 bbox 2개 이상 포함

결과:

- `QR_NOT_SPLIT`

### 5.3 표 누락 감지

조건:

- PPT table object가 존재하지만 Notion table block이 없음
- grid line이 많은 이미지 영역이 존재하지만 table candidate가 없음

결과:

- `TABLE_MISSING`

### 5.4 화살표 감지

조건:

- line/connector object with arrowhead
- 긴 선형 shape
- arrow-like annotation classified object

결과:

- `ARROW_DETECTED`

기본 처리:

- screenshot crop에서는 제외한다.
- 필요 시 Notion text/caption으로 연결성을 표현한다.

## 6. 검수 완료 계산

task가 `ready_to_publish`가 되려면:

- 모든 slide가 `approved` 또는 `excluded` 상태
- 발행 차단 gate가 0개
- Notion target이 유효함
- publish preview 생성 성공

slide가 `approved`가 되려면:

- 모든 required asset이 결정됨
- 모든 required block이 결정됨
- table warning 처리됨
- crop warning 처리됨

## 7. 테스트 체크리스트

개발자는 발행 전 아래를 확인한다.

- 업로드된 PPT 원본이 Storage에 남아 있는가
- slide render 수가 실제 slide 수와 같은가
- 설명 텍스트가 Notion block 후보로 생성됐는가
- screenshot crop에 본문 설명 영역이 섞이지 않았는가
- QR이 각각 분리됐는가
- table 후보가 누락되지 않았는가
- publish preview와 실제 Notion 결과가 같은 순서인가
- 실패 시 작업 상태와 오류 메시지가 남는가
- service role key와 Notion token이 클라이언트 번들에 들어가지 않는가
