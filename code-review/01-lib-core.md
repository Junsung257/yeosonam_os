# 여소남 OS — src/lib/ Code Review

**Date:** 2026-04-25  
**Scope:** 192 files, ~42,281 LOC

---

## 1. Inventory

| Metric | Value |
|--------|-------|
| Total files | 192 |
| Total LOC | ~42,281 |
| Largest file | supabase.ts (3,325 LOC) |
| God modules (>800) | 10 files |

**Top 10 largest files:**
1. supabase.ts - 3,325 LOC (god module)
2. parser.ts - 1,267 LOC
3. content-pipeline/content-brief.ts - 1,048 LOC
4. card-news/satori-templates.tsx - 995 LOC
5. content-generator.ts - 908 LOC
6. render-contract.ts - 791 LOC (canonical CRC)
7. ai.ts - 686 LOC
8. package-register.ts - 652 LOC
9. card-news/v2/atoms.tsx - 600 LOC
10. content-pipeline/blog-body.ts - 569 LOC

---

## 2. Dead Code & Unused Exports

Type Safety Debt: 126 instances of `any` type across lib/.

No major dead exports confirmed, but:
- ai-analyst.ts duplicates TravelPackage interface from ai.ts
- mileage.ts vs mileage-service.ts — verify consolidation

---

## 3. Duplication / Overlap

### CRITICAL: Airline Code Duplication

normalizeAirlineCode() defined in TWO places:
- parser.ts:57-72 (primary)
- transportParser.ts (inline copy)

THREE sources of truth for airlines:
- parser.ts:50-56 — AIRLINE_NAME_TO_CODE (14 entries)
- render-contract.ts — getAirlineName() (different mapping)
- app/packages/PackagesClient.tsx — AIRLINES dict (hardcoded)

**FIX:** Consolidate to render-contract.ts (canonical source).

---

### Price Formatting Duplication

admin-utils.ts (fmt万, fmtK) vs inline .toLocaleString() in multiple files.

**FIX:** Create fmt.ts module.

---

## 4. CLAUDE.md Violations

### CRITICAL: Bypass of renderPackage() CRC (ERR-KUL-05)

Components parse pkg.airline, pkg.excludes directly:
- app/admin/packages/page.tsx — .replace(/\(.*?\)/)
- app/blog/[slug]/page.tsx — if (pkg?.airline)
- components/admin/YeosonamA4Template.tsx — passes raw pkg.airline
- app/packages/PackagesClient.tsx — local AIRLINES dict

**IMPACT:** High. CLAUDE.md 4-1 says renderers consume renderPackage() output ONLY.

**FIX:** Move all rendering to CanonicalView consumption.

---

### CRITICAL: Hard Delete (ERR-process-violation)

src/lib/supabase.ts:224 — await supabaseAdmin.from('travel_packages').delete()

Should use soft-delete (is_active = false) per CLAUDE.md 2-3.

Also in multiple API routes.

**FIX:** Replace all .delete() with .update({ is_active: false }).

---

### MEDIUM: Unbatched .single() without try/catch

Status: mileage-service.ts wrapped safely. Audit exchange-rate.ts, roas-calculator.ts.

---

## 5. Performance Risks

### HIGH: O(N) unbatched DB inserts

src/lib/blog-scheduler.ts:63-142

```
for (const s of seasonals) {
  await supabaseAdmin.from('blog_topic_queue').insert({...});
}
for (const g of toAddGaps) {
  await supabaseAdmin.from('blog_topic_queue').insert({...});
}
for (const p of eligibleProducts) {
  await supabaseAdmin.from('blog_topic_queue').insert({...});
}
```

If seasonals.length = 50, this is 50 round-trips. KILLS weekly refill.

**FIX:** Batch into single .insert([...]) call.

---

### MEDIUM: JSON.parse in hot path

51 instances across lib/. Some in loops (card-news, content-pipeline).

**FIX:** Cache parsed JSON; pre-parse at load time.

---

### MEDIUM: Regex compiled per call

parser.ts, price/airline parsing recompile regex on every call.

**FIX:** Pre-compile at module scope.

---

## 6. Code Smells

### God Modules

1. supabase.ts (3,325) — 70+ exports. Split into supabase-admin.ts, db-packages.ts, db-bookings.ts, db-customers.ts.
2. parser.ts (1,267) — Airline, price, PDF parsing tangled. Extract to airline-parser.ts, price-parser.ts.
3. content-pipeline/content-brief.ts (1,048) — Monolithic LLM pipeline. Extract sub-pipelines.

### Inconsistent Error Handling

Some throw (supabase.ts:deletePackage), others return null (mileage-service.ts:earnMileage).

Callers must handle both. Standardize.

### Magic Numbers (No Owner)

- mileage-service.ts:30-32 — EARN_RATE_PCT=5, MIN_EARN=100, MAX_USE_PCT=30 should be .env
- payment-matcher.ts — thresholds (0.90, 0.60) undocumented

### TODO/FIXME with No Owner

- ad-controller.ts — 5 unscheduled "실제 API 연동"
- kakao.ts — "solapi 준비 후 활성화" (blocker?)
- search-ads-api.ts — 4 unscheduled integrations

**FIX:** Tag with owner + due date.

---

## 7. Test Coverage Gaps

NO unit tests for load-bearing modules:
- booking-state-machine.ts — state transitions untested
- payment-matcher.ts — matching logic untested (high financial impact)
- package-acl.ts — anti-corruption layer untested
- render-contract.ts — rendering contract untested
- package-register.ts — workflow untested
- mileage-service.ts — earn/use/clawback untested

Test infrastructure: No Vitest/Jest config. Visual regression only.

**Recommendation:** Bootstrap Vitest; target 80%+ coverage by Q2 2026.

---

## 8. Quick Wins (Top 10)

| # | File | Change | Impact | Effort |
|---|------|--------|--------|--------|
| 1 | blog-scheduler.ts:63-142 | Batch DB inserts | O(N→1) round-trips; 2-5s/week | S |
| 2 | supabase.ts:215,224 | Soft-delete instead of hard | Audit trail compliance | S |
| 3 | parser.ts + transportParser.ts | Move AIRLINE_NAME_TO_CODE to render-contract.ts | Single source of truth | S |
| 4 | Components (DetailClient, A4Template, PackagesClient) | Use renderPackage() output not pkg.* | Enforce CRC; reduce bugs | M |
| 5 | Multiple files | Create fmt.ts | DRY price formatting | S |
| 6 | mileage-service.ts:30-32 | Move config to .env.local | Config-driven; testable | S |
| 7 | supabase.ts | Split by entity (packages, bookings, customers) | Reduce god module LOC | L |
| 8 | parser.ts | Extract airline + price parsing | Clarify responsibilities | M |
| 9 | exchange-rate.ts, roas-calculator.ts | Wrap .single() with try/catch | CLAUDE.md compliance | S |
| 10 | Add vitest.config.ts | Bootstrap unit test framework | Unblock coverage | M |

**Legend:** S<30min, M=1-3h, L=4-8h

---

## 9. Larger Refactors (Top 5)

| # | Scope | Motivation | Blockers | Effort |
|---|-------|-----------|----------|--------|
| 1 | **Airline Consolidation** | Single IATA→Name source across parser, transportParser, render-contract, components | None; safe rename | 2h |
| 2 | **Enforce CRC Contract** | Forbid pkg.* in components; route through renderPackage() | 15+ edits; needs regression tests | 4h+test |
| 3 | **Split supabase.ts** | Extract by entity (packages, bookings, customers, mileage, affiliates) | High API surface; needs integration tests | 8h+test |
| 4 | **Payment Matcher Tests** | Unit tests for matchPaymentToBookings() edge cases | Requires Vitest + mocking | 6h |
| 5 | **LLM Validation Framework** | Unify llm-validate-retry, upload-validator, jarvis/ error handling | Scattered patterns; schema migration | 12h |

---

## 10. Strengths

**Well-designed:**
- render-contract.ts — Clear CRC contract, comprehensive docs
- booking-state-machine.ts — Explicit ALLOWED_TRANSITIONS
- admin-utils.ts — Focused utilities
- notification-adapter.ts — Clean adapter (Solapi/Mock)
- itinerary-render.ts — Well-structured region grouping

---

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| Critical violations | 3 | Hard delete, CRC bypass, unbatched loops |
| High-risk duplication | 2 | Airline, price formatting |
| Missing tests | 8+ | Load-bearing modules |
| Magic numbers | 5+ | Config-driven refactor |
| Code smells | 10+ | God modules, TODOs |

---

**NEXT STEPS:**

1. **This week:** Batch blog-scheduler.ts inserts; soft-delete in supabase.ts
2. **By EOW:** Consolidate airline code; enforce CRC in components
3. **Sprint 2:** Bootstrap Vitest; test payment-matcher, booking-state-machine
4. **Q2 2026:** Split supabase.ts; refactor parser.ts

**Report compiled:** 2026-04-25  
**Reviewer:** Claude Code
