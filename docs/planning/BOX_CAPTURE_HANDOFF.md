# 이미지박스 캡처 규칙 — 핸드오프 (2026-07-13)

> 성빈님 확정 지시를 받아 조사까지 끝난 상태. **수정 작업은 미착수** — 이 문서를 받은 에이전트가 §4를 구현하면 된다.
> 브랜치: `feat/ppt-converter-two-way` (최근 커밋 64fc0b9까지가 기존 로직).

## 1. 확정 규칙 (성빈님, 2026-07-13 — 재논의 금지)

- **앞으로 모든 매뉴얼 PPT는 이 형식으로 온다**: 레이아웃에 깔린 회색 이미지박스 판 위에 시각자료(스크린샷+빨간 콜아웃 박스+숫자 뱃지+화살표+말풍선), 오른쪽 컬럼에 제목+번호 설명 텍스트.
- **크롭 = 이미지박스 구간을 딱 그대로 캡처.** 콘텐츠 범위를 추정해서 깎는 로직(콘텐츠 타이트 크롭·우측 클램프)은 폐기.
- 시각 덩어리(스크린샷+박스+뱃지+화살표+말풍선)는 분리 불가 한 장 — 한 조각이라도 잘리면 매뉴얼로서 죽는다(①이 뭘 가리키는지 못 읽음). 스펙 AC1·AC2와 동일 취지.

## 2. 이미지박스 실측 정의 (XML 파싱으로 확인 완료)

- **slideLayout5.xml에 있는 텍스트 없는 `#F2F2F2` 채움 rect** (슬라이드 XML이 아니라 레이아웃 — v2 덱 기준. `parseImageBoxes`가 슬라이드→레이아웃 순으로 이미 찾는다).
- 좌표(16:9 슬라이드 비율): **좌 3.6% → 우 64.3%, 상 17.1% → 하 86.6%** (3000×1688 렌더 기준 x 109~1929, y 289~1461).
- 화면에서는 왼쪽의 연회색 판으로 보인다. 오른쪽 ~35%는 본문 텍스트 컬럼(x 66.9%~).
- 저자가 판 밖으로 살짝 얹는 경우 실존: 슬라이드 11(마감리포트)은 오른쪽 그림 xEnd 66.6%(판 밖 +2.3%p), 설명 번호 뱃지(1·2·1-1) x 62.9~65.9%(중심이 판 밖).

## 3. 현재 코드의 결함 (실증 완료)

문제 지점: `scripts/worker/run-conversion-job.mjs` ~432행
```js
boxes = boxes.map((b) => contentCropBox(b, parsed)); // ← 이 줄이 원인
```
`contentCropBox`(`scripts/worker/group-bake.mjs`)의 세 가지 실패 기전:
1. **우측 클램프**: 본문 shape의 left로 x1을 "여유 없이 딱" 당김 — PPT 텍스트 박스는 글리프보다 넓어 그 left가 시각 덩어리 위까지 들어옴 → 절단선이 콘텐츠 관통.
2. **20자 초과 텍스트 = 본문 취급**: 말풍선 주석("!! 알림 리포트 아닙니다 !!…")이 보호 대상에서 탈락.
3. **텍스트 없는 도형은 파서가 버림**: `parseSlideShapes`가 `.filter(s => s.text)` — 빨간 콜아웃 박스·화살표는 크롭 계산에 아예 안 보임.

실증 (wh-vision, `.tmp/`):
- `boxcrop/slide-011-group-00.png.inspect.json`: **fail** — 말풍선 오른쪽 테두리 잘림.
- `user-crop-magam.png`(성빈님이 직접 잘라준 **기대 산출물**) vs `boxcrop/slide-011-group-00.png` compare: **fail/major_drift** — 말풍선 텍스트 끝·노란 리포트 우측·세 번째 폰 우측·뱃지② 강조 박스 잘림.
- `box-overlay-s11.png`: 박스(파랑)·기존 크롭(빨강)·pics(초록) 오버레이 — 빨강 우변이 그림·리포트·번호를 관통함을 비전으로 확인.

## 4. 해야 할 수정

1. `run-conversion-job.mjs` ~432행: `contentCropBox` 호출 제거 → **박스 그대로** 사용하되, 판에 걸친 요소가 잘리지 않게 `expandBoxWithPics(box, parsed.pics)` 적용(이미 group-bake.mjs에 구현돼 있음 — 박스와 **겹치는** pics 합집합 + PAD 0.8%).
2. 안전망 보강(권장): 박스와 겹치는 **짧은 라벨 shape(텍스트 ≤20자, 뱃지류)** bbox도 합집합에 포함 — 슬라이드 11의 뱃지(xEnd 65.9%)는 pics 확장(66.6%)이 우연히 커버하지만 일반화 필요. `expandBoxWithPics`를 확장하거나 `boxCaptureRect(box, parsed)` 하나로 묶어 **프로덕션과 테스트가 같은 함수**를 쓰게.
3. `contentCropBox`는 미사용 처리(제거 또는 deprecated 주석). 테스트 하니스 `.tmp/box-crop-test.mjs` 41행도 동일 교체.
4. 스펙 명문화: `docs/planning/CONVERTER_TWO_WAY_MODE_SPEC.md` §3~4에 "1순위 크롭 = 이미지박스 구간 그대로(+걸침 합집합)" 규칙과 이미지박스 정의(§2 내용) 반영.

## 5. 검증 방법 (수정 후 필수)

1. 재베이크: 레포 루트에서 `node .tmp/box-crop-test.mjs` (입력 `.tmp/deck-v2.pptx`, 슬라이드 7·11·12·14·36 → `.tmp/boxcrop/`; soffice/pdftoppm는 homebrew 경로 기본값).
2. wh-vision 검증 (육안 판정 금지 훅 있음, **유도 질문 금지 — 중립·비판 질문**):
   - `wh-vision compare .tmp/user-crop-magam.png .tmp/boxcrop/slide-011-group-00.png "…구성요소 나열·잘림/누락 지적…"` → **pass + 잘림 0**이 합격선.
   - 슬라이드 11 inspect: 말풍선 테두리 온전 / 가장자리 본문 조각 / 과도 여백 3항목.
   - 나머지 4장(7·12·14·36)도 inspect로 잘림·본문 조각 확인.
3. green이면 커밋(이 레포 관례: 한글 conventional commit). 푸시는 성빈님 지시 대기.

## 6. 참고 자산

| 경로 | 내용 |
| --- | --- |
| `.tmp/user-crop-magam.png` | 성빈님 기대 크롭(슬라이드 11) — 골든 기준 |
| `.tmp/boxcrop/` | 기존 로직 산출물 + 풀 렌더(s7·s11·s12·s14·s36, 3000×1688) + deck-v2.pdf |
| `.tmp/box-overlay-s11.png` | 박스/크롭/pics 좌표 오버레이 |
| `.tmp/box-crop-test.mjs` | 5장 재베이크 하니스 |
| `docs/planning/CONVERTER_TWO_WAY_MODE_SPEC.md` | 그룹 베이크 스펙(§3 동작·§4 작성 규약·§5 AC) |
