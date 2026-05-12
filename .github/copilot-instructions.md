# GitHub Copilot — 여소남 OS 저장소 지시

<!-- 코드 리뷰용 커스텀 지시는 길이 제한이 있으므로 짧게 유지. 상세는 AGENTS.md / .claude/CLAUDE.md -->

## 프로젝트

Next.js App Router B2B2C 여행 SaaS: 예약 상태 머신, Supabase, 어드민 ERP, 제휴/정산, AI(자비스·QA). 비즈니스 로직은 `src/lib/`, UI는 표시만.

## 반드시 참고

- **진입점:** 루트 `AGENTS.md`
- **구현 레시피·공개 경로·DB 패턴:** `.claude/CLAUDE.md`
- **최신 스키마·메뉴 요약:** `CURRENT_STATUS.md`

## 코딩 시 주의

- 예약 상태 전이: `src/lib/booking-state-machine.ts`만 따름.
- A4/모바일 렌더: `renderPackage()` / `render-contract.ts` 계약 준수; 패키지 raw 직파싱 지양.
- 고객 노출 필드: `db/FIELD_POLICY.md` — 커미션·내부 메모를 고객 텍스트 필드에 넣지 않음.
- 새 공개 라우트: `middleware.ts`의 공개 경로 목록과 정합성 확인.
- RLS·마이그레이션 변경 시: `supabase/migrations/`에 반영.

## 스타일

- 사용자 대면 설명이 필요하면 한국어, 쉬운 말 우선(프로젝트 커뮤니케이션 규칙).
