# OS Improvement Inbox

- generated_at_kst: 2026-05-22T09:30:04+09:00
- actionable_changed_files: 32
- todo_markers: 0
- areas: LIB 17, API 6, ETC 6, APP 2, DOCS 1

## 1) Actionable Changed Files

- ` M` `src/app/admin/packages/PackagesPageClient.tsx`
- ` M` `src/app/admin/upload/page.tsx`
- ` M` `src/app/api/admin/alerts/route.ts`
- ` M` `src/app/api/admin/registration-monitor/route.ts`
- ` M` `src/app/api/content-queue/route.ts`
- ` M` `src/app/api/upload/route.ts`
- ` M` `src/lib/admin-alerts.ts`
- ` M` `src/lib/auto-mobile-qa.ts`
- ` M` `src/lib/customer-leak-sanitizer.ts`
- ` M` `src/lib/expand-date-range.ts`
- ` M` `src/lib/packages/raw-text.ts`
- ` M` `src/lib/parser.ts`
- ` M` `src/lib/parser/deterministic/bullets.ts`
- ` M` `src/lib/parser/llm/section-extractors.ts`
- ` M` `src/lib/price-dates.ts`
- ` M` `src/lib/revalidate-helper.ts`
- ` M` `vercel.json`
- `??` `UsersadminDesktop\354\227\254\354\206\214\353\202\250OS.tmp_pkg_resp.html`
- `??` `db/backfill_legacy_sections.mjs`
- `??` `docs/audits/2026-05-20-legacy-sections-broken.md`
- `??` `scripts/audit-a1-remaining.ts`
- `??` `scripts/audit-tier-expand.ts`
- `??` `scripts/run-legacy-backfill.ts`
- `??` `src/app/api/admin/packages/[id]/backfill-sections/`
- `??` `src/app/api/cron/legacy-sections-backfill/`
- `??` `src/lib/legacy-sections-backfill-batch.ts`
- `??` `src/lib/parser/deterministic/comma-split-signature.ts`
- `??` `src/lib/parser/deterministic/price-matrix.ts`
- `??` `src/lib/period-label-dates.test.ts`
- `??` `src/lib/period-label-dates.ts`
- `??` `tests/unit/lib/legacy-sections-backfill-batch.spec.ts`
- `??` `tests/unit/lib/parser/`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P1 `??` `src/app/api/cron/legacy-sections-backfill/`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
