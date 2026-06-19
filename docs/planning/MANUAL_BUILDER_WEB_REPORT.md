# Manual Builder Web 구축 완료 보고

작성일: 2026-06-19

## 1. 목적

`PPT → Notion 변환기`에 머물지 않고, 마스터 매뉴얼에서 추출한 ManualUnit과 실측 Anchor 후보를 웹에서 검토할 수 있는 `매뉴얼 빌더` 화면을 구축했다.

## 2. 구현 범위

- `/manual-builder` 신규 화면
- `/api/manual-builder/storemgmt` 신규 API
- 매장관리 백오피스 ManualUnit/Anchor 산출물 앱 내부 포함
- 메인 화면에서 `매뉴얼 빌더` 진입점 추가
- 데스크톱/모바일 반응형 검토 화면

## 3. 사용 데이터

앱 내부 데이터:

```text
src/data/manual-builder/storemgmt_normalized_manual_units.json
src/data/manual-builder/storemgmt_anchor_candidates.json
```

데이터 요약:

| 항목 | 값 |
| --- | ---: |
| ManualUnit | 73 |
| 파일럿 | 5 |
| 실측 Anchor 보유 | 68 |
| High 후보 | 38 |
| 프랜차이즈 scope | 15 |
| 실측 화면 JSON | 142 |

KMS는 canonical env가 현재 로컬에 없어 `unavailable`로 표시한다. API와 화면은 KMS가 붙은 산출물로 교체돼도 같은 계약을 유지한다.

## 4. 화면 구성

### 좌측

- ManualUnit 목록
- 검색
- 파트 필터
- 범위 필터
- 파일럿/전체/High/Anchor 없음 필터

### 중앙

- 선택 ManualUnit 상세
- 원본 카테고리/기능명
- 정규화 기능명
- 장 번호
- PPT 텍스트 근거
- 검색 키워드

### 우측

- Anchor 후보 목록
- confidence/score
- 매칭 근거
- 일치 키워드
- table column, toolbar, filter, screenshot path 등 증거 데이터
- 실측 URL 열기

## 5. 검증

통과 명령:

```bash
npm run typecheck
npm run build
```

빌드 결과에 아래 라우트가 포함됐다.

```text
/manual-builder
/api/manual-builder/storemgmt
```

로컬 확인:

```text
http://localhost:3020/manual-builder
http://localhost:3020/api/manual-builder/storemgmt
```

API 응답:

```text
200 / 596482 bytes
```

캡처 검증:

```text
/tmp/manual_builder_1440_v2.png
/tmp/manual_builder_390_v5.png
```

## 6. 남은 과제

1. canonical KMS env 연결 후 KMS page/feature/chunk 후보까지 재생성
2. Supabase `manual_units`, `manual_anchors` 저장 스키마 적용
3. 웹에서 후보 승인/수정/저장 CRUD 구현
4. 변경 신호(Asana/Figma) → 영향 ManualUnit 탐색 플로우 연결
