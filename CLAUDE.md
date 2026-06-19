# Notion Manual Pipeline — 프로젝트 진입 (Claude Code)

이 프로젝트는 Work_hub 전역 **오케스트레이션 운영 모델**을 따르고, 아래 항목으로 **특화**한다.
전역 골격: `../../../ai-context/orchestration-operating-model.md` (오케스트레이터 + 6 페르소나·게이트 철학·하니스 규칙·팬아웃 한도 ≤2~3).

## 프로젝트 운영 모델 (특화)
- 특화 페르소나: `.claude/agents/mm-{pm,designer,fe,be,fullstack,verifier}.md` (전역 `orch-*`를 이 레포의 Next16/Supabase/Notion 도메인으로 구체화). 작업 시 제네릭 `orch-*` 대신 **이 `mm-*`를 쓴다** — 없으면 `orch-*`가 본 CLAUDE.md를 읽어 자동 특화.
- 커맨드: 전역 `/orch-gate`(게이트 실행)·`/orch-domain`(페르소나 파이프라인).
- 권위 산출물: `docs/planning/`의 `V2_LLM_HANDOFF_2026-06-19.md`(이관 정본)·`V2_ANCHOR_SCHEMA.md`·`V2_MAINTENANCE_PIPELINE_SPEC.md`·`V2_PRODUCT_OPERATING_SYSTEM.md`·`CURRENT_STATUS.md`.

## 두 제품 층 (혼동 금지)
- **v1 변환기**(운영 중): PPT → Notion 단방향 변환·발행. Railway 배포 완료. end-to-end 동작.
- **v2 유지보수 자동화**(토대 구축됨): 제품 변경 신호를 받아 영향 매뉴얼 단위를 찾고 갱신안 초안을 만드는 루프. DB 스키마 + 매칭 fixture까지 완료(L2), 그 위 API·검수 UI·발행 배선(L3~L5)은 미구현.

## 불변 토대 (재논의 금지)
- **마스터 PPT = 제품 현행 기준선**. 손대는 대상이 아니라 "현 제품이 이렇다"의 입력. 변경 사실은 Asana 이슈·Figma로 들어온다.
- **목표 = 무인 자동발행 아님**. "변경 감지 + 갱신안 자동생성 + 사람 승인(review_required)" 보조 자동화. 잘못된 절차는 낡은 절차보다 위험 → 절차 텍스트는 자동발행 금지.
- **2층 자동화**: 시각·구조 갱신(스크린샷·"어느 화면 바뀜")=높은 자동화 / 절차·정책 텍스트=기계 초안 + 사람 확정.
- **핵심 난점 = 좌표계 불일치**: 변경신호(제품 좌표: 화면 route·컴포넌트·코드) vs 매뉴얼(사용자 과업 좌표). 신규/갱신·위치는 추론. 레버 = 입도규칙 고정 + 안정 앵커. **앵커 스키마가 루프 성패를 가른다.**
- **범위 = 운영관리(opsmgmt) + 매장관리(storemgmt) 두 제품만** (KMS 적재·Playwright 실측 가능한 범위).

## 도메인 권위 원천 (사실 확인 우선순위)
- **KMS**(`mvp-store-chatbot` Supabase): 제품 사실의 권위 소스. `kms_pages`/`kms_features`/`kms_coverage`/`kms_chunks`(이중층). **우리 자산 — 직접 조회 가능.** 두 제품 적재됨(지식 충실, 라이브 검증 약: verified_behavior 27/2166, coverage 53% unknown).
- **realmeasure**(`Manual_automation/manual_builder_stg/data/realmeasure`): Playwright DOM 실측. storemgmt 142화면 / opsmgmt는 IA메뉴만(화면실측 0 — 선결 과제).
- **마스터 PPT**: 현행 기준선(입력). Notion 발행물 = 그 렌더.

## 스택·컨벤션
- Next.js 16 App Router(force-dynamic), React 19, TS strict, Supabase(Postgres + Storage), Notion REST, Beaverworks DS(`@sungbinhwang-beaverworksinc/design-system` ^0.2.3), sharp, zod.
- **서버 전용** Supabase service client(`server-only`) — anon 브라우저 클라이언트 미사용. 페이지=`'use client'` + DS import. 날짜는 문자열(렌더 시 `new Date()` 금지 — hydration). 네비는 실제 페이지 연결(스텁/죽은 링크 금지).
- DS 유효 tone = `neutral|primary|success|warning|danger|info` (**'error' 없음**). 하드코딩 색상 금지.
- 변환 worker: soffice/pdftoppm. sharp 메모리(`sharp.cache(false)`·`concurrency(1)`) — Railway OOM 방지.

## v2 유지보수 스키마 (소유: mm-be)
`supabase/migrations/002_maintenance_v2.sql` — `manual_anchor_units`(유지보수 단위) / `manual_product_anchors`(매뉴얼 단위↔화면·route·KMS·Figma) / `manual_change_signals`(Asana/Figma/manual 신호) / `manual_impact_candidates`(영향 후보) / `manual_update_drafts`(검수 전 초안). DB층은 UNIQUE/upsert로 멱등. **단, Notion 발행 멱등(`update_draft.notion_page_id` 매핑)은 미구현 — 다음 증분 1순위.**

## 게이트 (G1~G6)
실행: 레포 루트에서 `npm run verify:all` + 개별.
- G1 타입 `npm run typecheck`(tsc --noEmit) 0에러 / G2 빌드 `npm run build`(dev 종료 후) / G3 렌더(라우트 200·에러 오버레이 0) / G4 디자인 린트(DS 토큰·tone) / G5 원천 정합(`verify:requirements`·`verify:v2-purpose` + KMS/realmeasure/핸드오프 대조, 지어낸 사실 0) / G6 도메인 정합(`verify:v2-fixture:db` 멱등 재실행 중복 0 + 발행 매핑 정합).
- 작성/검증 레인 분리(자가승인 금지), FAIL 0까지. **검증 레인은 sonnet 이상으로** — haiku는 출력계약 준수가 약함(과거 검증자 빈보고 사고).

## 보안 경계
- 시크릿은 `.env`·Railway variables에만. 깃 미추적. 문서에 키값 금지(프로젝트 ref/공개 URL은 비밀 아님이나 사외 공유본은 마스킹).
- KMS(`mvp-store-chatbot`)는 우리 자산 — 조회 가능. **biber-field-app Supabase·더본VOC는 우리 자산 아님 — 직접 질의 금지.** PII·사업자번호 값 출력 금지.
