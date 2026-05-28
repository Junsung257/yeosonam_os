# OS Improvement Inbox

- generated_at_kst: 2026-05-28T21:15:00+09:00
- actionable_changed_files: 0
- todo_markers: 0

## 세션 정리 완료 (2026-05-28)

아래 작업은 이번 세션에서 모두 완료되어 Inbox에서 제거함:

### ✅ 완료: as any 전수조사 및 근본 원인 해결
- `supabaseAdmin as any` → Proxy 패턴으로 `SupabaseClient` 타입 복원
- 30+개 파일의 `PromiseLike.catch()` 패턴 → try/catch 또는 Promise.resolve() 래핑
- `as any` 방지 규칙 생성 (`.cursor/rules/yeosonam-typescript-safety.mdc`)

### ✅ 완료: 타입 오류 수정
- `tsc --noEmit` 0 에러 통과 확인
- `next build` 통과 확인

### ✅ 완료: Git 정리
- main 브랜치 충돌 해결 (rebase)
- 머지된 로컬 브랜치 7개 삭제
- 오래된 stash 3개 정리
- 세션 임시 파일 git 추적 해제

### ✅ 완료: PR 관리
- PR #164 MERGEABLE 상태 유지
- PR 설명 최신화

---

## 남은 작업 (TODO)

### P0: 정산/결제 관련 as any 제거 (Phase 1)
- `src/app/api/settlements/route.ts`
- `src/app/api/settlements/[id]/pdf/route.ts`
- `src/app/api/payments/settlement-bundle/route.ts`

### P1: API route as any 제거 (Phase 2)
- `src/app/api/unmatched/route.ts` (15건)
- `src/app/api/upload/route.ts` (9건)
- `src/app/api/card-news/route.ts` (6건)
- `src/app/api/rfq/[id]/route.ts` (8건)

### P2: 페이지 컴포넌트 as any 제거 (Phase 3)
- `src/app/admin/marketing/card-news/[id]/page.tsx` (36건) — 카드뉴스 스타일 편집기 타입 정의 필요
- `src/app/m/admin/bookings/[id]/page.tsx` (20건) — 모바일 예약 상세 타입 정의 필요
- `src/app/destinations/[city]/page.tsx` (8건)
- `src/app/blog/[slug]/page.tsx` (5건)
- `src/app/admin/affiliates/[id]/page.tsx` (3건)

### P3: 서드파티/에러 핸들링 as any 제거 (Phase 4)
- `src/components/MetaPixel.tsx` (6건) — declare global 우선
- `src/components/NaverAnalyticsPixel.tsx` (1건)
- ErrorBoundary 공통 컴포넌트화: `error.tsx` 5개 파일 중복

---

## 향후 실행

```bash
# 캘린더에 등록
npm run os:inbox -- --priority P0,P1
```
