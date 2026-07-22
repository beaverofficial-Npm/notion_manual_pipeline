# Quality Gates

> 최신 이미지 업데이트·고정 캡처 마스터 검수: [2026-07-22 QA 리포트](../qa/image-update-stability-20260722/index.html)

## 1. 현행 계약

- PPT/PPTX 렌더러는 Microsoft Graph PowerPoint 단일 경로다. 다른 렌더러 fallback은 없다.
- 역할이 `content`인 모든 슬라이드는 OOXML 이미지/그룹 탐지와 무관하게 실측 고정 박스를 padding 0으로 캡처한다.
- 캡처 이미지는 변환 시점에 `group_bake` asset으로 저장한다. 검수·미리보기·발행 단계에서 `crop_box`로 다시 자르지 않는다.
- 업로드 API, worker, 검수 화면, 발행은 모두 같은 단일 경로를 사용한다. 레거시 `capture` 모드는 지원하지 않는다.
- 매 실행은 고유한 task/job/source/run으로 식별하고, 발행은 성공한 conversion job id에 고정한다.

## 2. 변환 차단 조건

| 조건 | 판정 |
| --- | --- |
| 원본 다운로드 SHA-256과 DB source checksum 불일치 | 실패 |
| Graph PDF 변환 실패 또는 빈 PDF | 실패 |
| PDF page와 원본 비숨김 slide number 매핑 불일치 | 실패 |
| 렌더 chunk의 페이지 PNG 누락 | 실패 |
| `content` 슬라이드의 고정 캡처 파일 생성 실패 | 실패 |
| asset이 `group_bake`가 아니거나 현재 run prefix 밖의 경로를 참조 | 실패 |
| manifest의 renderer/capture box/padding 출처 누락 | 실패 |

실패한 run은 성공 결과로 승격하지 않으며, 직전 성공 결과를 발행 대상으로 사용하지 않는다.

## 3. 이미지 품질 게이트

- 모든 고정 캡처는 동일한 좌표 비율을 사용한다.
- 출력은 원본 슬라이드 비율을 유지하고 폭·높이를 독립적으로 늘이거나 줄이지 않는다.
- 캡처 경계에 해당하는 연회색 이미지 박스가 잘리거나 본문 설명 영역이 섞이지 않아야 한다.
- 화살표, 번호, 강조 박스, 말풍선, 교체된 화면 이미지는 PowerPoint 렌더 결과 그대로 포함되어야 한다.
- 수정 대상 페이지는 전부 달라지고, 비수정 대상 페이지는 허용 오차 안에서 동일해야 한다.
- 같은 파일명, 다른 파일명, 같은 바이트, 같은 파일 크기 여부가 결과 재사용 조건이 되어서는 안 된다.

## 4. 재실행·발행 게이트

- 같은 task에 `queued` 또는 `running` job이 있으면 중복 실행 요청은 409로 차단한다.
- 새 성공 run은 DB row와 R2 object가 모두 새 job/run을 참조해야 한다.
- 실패한 재실행은 직전 성공 run의 DB/R2 결과를 보존해야 한다.
- 발행 미리보기와 실제 발행은 `kind=group_bake`이면서 `storage_path`가 있는 현재 job asset만 읽는다.
- Notion 대상 page id가 없거나 성공한 conversion job pin이 없으면 발행을 차단한다.

## 5. 자동 검증

필수 명령:

```bash
npm run verify:all
npm run build
```

`verify:all`에는 다음 회귀 방지가 포함된다.

- Graph renderer와 숨김 슬라이드 매핑
- 고정 캡처 좌표·픽셀 경계
- 레거시 `capture` API/worker/UI/publish 경로 부재
- 역할 분류와 작은 번호 어노테이션 오분류 방지
- 발행 conversion job pin
- 요구사항·v2 목적·로컬 fixture·TypeScript

## 6. 보안·운영 게이트

- service role key, Notion token, Graph token, R2 key를 클라이언트 번들·로그·문서에 넣지 않는다.
- 운영 배포 전 active conversion/publish job이 0인지 확인한다.
- DB 마이그레이션은 기존 운영 row를 먼저 새 단일 값으로 정규화한 뒤 제약을 적용한다.
- 운영 검증은 실제 사용자 작업을 만들지 않고 HTTP/worker version/로그와 read-only DB 상태로 확인한다.
