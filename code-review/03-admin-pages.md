# Code Review: Admin Pages (src/app/admin/**)

**Scope:** All admin page.tsx files, excluding active migration items per brief.
**Date:** 2026-04-25  
**Total Pages Reviewed:** 58 pages; 42 in scope (16 excluded under migration)  
**Total LOC (in scope):** ~31,000

---

## 1. EXCLUDED PAGES (Active Design Migration)

- src/app/admin/attractions/page.tsx (498 LOC)
- src/app/admin/blog/page.tsx
- src/app/admin/bookings/** (whole subtree)
- src/app/admin/products/[id]/distribute/page.tsx (539 LOC)
- src/components/AdminLayout.tsx
- src/app/admin/settlements/page.tsx
- src/app/admin/customers/** (2 pages)
- src/app/admin/ledger/page.tsx (776 LOC)
- src/app/admin/affiliates/** (2 pages)

---

## 2. INVENTORY

### Top 10 Largest Pages (In Scope)

| File | LOC | Notes |
|------|-----|-------|
| packages/page.tsx | 1978 | GOD COMPONENT -- product marketing + list + drawer |
| payments/page.tsx | 1502 | GOD COMPONENT -- bank matching + ledger |
| marketing/card-news/[id]/v2/page.tsx | 982 | GOD COMPONENT -- multi-format card editor |
| content-hub/page.tsx | 858 | GOD COMPONENT -- 3-step content generator |
| marketing/card-news/[id]/page.tsx | 752 | V1 card editor |
| products/review/page.tsx | 747 | Product review + QA + preview |
| page.tsx (root) | 805 | Dashboard KPIs + charts |
| control-tower/page.tsx | 532 | Policy CRUD |
| inbox/page.tsx | 517 | Booking task queue |
| rfqs/[id]/page.tsx | 539 | RFQ detail + bids |

Total: 42 pages in scope, all 'use client'.

---

## 3. GOD COMPONENTS (800+ LOC)

### packages/page.tsx (1978 LOC)
**Issues:** NumInputCell, DateInputCell at module level (lines 149-241); virtual scroll logic mixed with render.  
**Decompose:** <ProductListTable>, <FilterBar>, <BulkActionsToolbar>, extract <EditableCells>

### payments/page.tsx (1502 LOC)
**Issues:** Utility duplication (fmtDate, fmtBookingAnchor); no error retry; all fetch inline.  
**Decompose:** <TransactionList>, <BankReconciliationPanel>, <BalanceSheet>

### marketing/card-news/[id]/v2/page.tsx (982 LOC)
**Issues:** Satori rendering mixed with state; no clear pipeline boundaries.  
**Decompose:** <TemplateSelector>, <RenderPipeline>, <DiagnosticsPanel>, <CritiqueDisplay>

### content-hub/page.tsx (858 LOC)
**Issues:** 3-step wizard inline; 15+ useState hooks; no step separation.  
**Decompose:** <Step1Config>, <Step2Editor>, <Step3Publisher> + useContentHubState

### page.tsx (root, 805 LOC)
**Issues:** TwoTrackKPI, CashflowChart defined inline.  
**Decompose:** <KpiGrid>, <CashflowChart>, <RecentBookingsShortcuts>

---

## 4. CLIENT/SERVER BOUNDARY SMELLS

CRITICAL: All 42 in-scope pages are 'use client'. All fetch on mount via useEffect with no caching.

**Examples:**
- blog/[id]/page.tsx:29-49
- rfqs/[id]/page.tsx:50+
- content-queue/page.tsx:80+

**Impact:** Every navigation = full API call. No ISR. No cache().

**Fix:** Convert read-heavy pages to server components. Reserve 'use client' for edit forms.

---

## 5. DUPLICATED UI PATTERNS

### Status badge mappings (5 locations)
- packages, bookings, rfqs, marketing/card-news, control-tower  
**Action:** Centralize in lib/status-colors.ts

### Date formatters (6 locations)
- bookings: fmtDate, fmtDateKo, parseShortDate
- payments: fmtDate, fmtDateCompact
- customers, marketing: inline
**Action:** Create lib/formats.ts

### Price formatters (4 locations)
- bookings: fmt, fmtK
- payments: fmt万
- customers: fmtNum, fmtSales
**Action:** Export from lib/formats.ts

### Table/filter/pagination (6+ pages)
- rfqs, terms-templates, affiliates, applications
**Action:** <AdminTable> shared component

---

## 6. BYPASS OF CANONICAL UTILITIES

### pkg.itinerary_data parsed raw (packages/page.tsx:67)
Accesses pkg.itinerary_data?.days directly, iterates day.regions without normalization.  
**Fix:** Use renderPackage() or normalizeItinerary()

### Price arithmetic inline (packages, payments, customers)
toLocaleString() instead of fmt; margin calc inline.  
**Fix:** Replace with canonical formatters

---

## 7. BOOKING STATE-MACHINE BYPASS

CRITICAL: bookings/page.tsx:1854 -- status select with no ALLOWED_TRANSITIONS check.  
Also: Lines 1869-1874 -- patchStatus called without validation.

**Impact:** Invalid transitions allowed. Breaks reconciliation.  
**Fix:** Pre-flight ALLOWED_TRANSITIONS check before every booking.status PATCH.

---

## 8. DOMPURIFY / SANITIZATION

### blog/[id]/page.tsx:179 -- dangerouslySetInnerHTML without sanitization
**Risk:** User markdown rendered unsanitized.

### blog/write/page.tsx:~300+ -- correctly sanitizes ✓
### content-queue/page.tsx:305-310 -- correctly sanitizes ✓

**Severity:** MEDIUM. Add DOMPurify.sanitize() to blog/[id]/page.tsx:179.

---

## 9. PERFORMANCE ISSUES

### Large lists, no virtualization
- rfqs/page.tsx, applications/page.tsx, terms-templates/page.tsx  
**Fix:** Add limit + pagination to API.

### Inline filter/sort on client
- control-tower/page.tsx:150+, rfqs/page.tsx:80+  
**Fix:** Push to API query params.

### useEffect without debounce
- marketing/card-news/[id]/page.tsx:~200 (pexels search)
- content-hub/page.tsx:80+ (package refetch)  
**Fix:** Add debounce (300ms).

---

## 10. ACCESSIBILITY & UX

### Icon-only buttons missing aria-labels
Multiple pages use icons without aria-label.

### Form labels missing
marketing/card-news/[id]/page.tsx:~100+ (ratio, tone selects).

### Tables without semantic headers
payments/page.tsx (no <thead>).

---

## 11. OPTIMISTIC UPDATE / ERROR HANDLING

### Blocking UI on PATCH
bookings/page.tsx:1869-1874 -- patchStatus freezes UI.  
**Fix:** Implement optimistic update with rollback.

### Missing error recovery
rfqs/page.tsx:80+, escalations/page.tsx:36 -- catch but no retry.  
**Fix:** Toast with retry option.

---

## 12. QUICK WINS

| File | Change | Effort |
|------|--------|--------|
| blog/[id]/page.tsx:179 | Add DOMPurify.sanitize() | S |
| lib/formats.ts | Canonical formatters | M |
| bookings/page.tsx:1854 | Add ALLOWED_TRANSITIONS check | M |
| marketing/card-news/[id]:~200 | Add debounce to search | S |
| escalations/page.tsx:36 | Add error toast + retry | S |
| rfqs/page.tsx | Add pagination | M |
| lib/status-colors.ts | Centralize badge colors | M |
| components/admin/EditableCells.tsx | Extract from packages/page.tsx | M |

---

## 13. LARGER REFACTORS

| Scope | Effort | Impact |
|-------|--------|--------|
| <AdminTable> shared component | L | Save ~500 LOC across 6 pages |
| Server-component migration | L | Better FCP, reduce waterfall |
| Booking state-machine wrapper | M | Prevent invalid transitions |
| Canonical status badge system | M | Eliminate 5 duplicate sets |
| useFetchAdmin hook | M | Replace 30+ raw fetch patterns |

---

## SUMMARY

| Metric | Value | Status |
|--------|-------|--------|
| Pages reviewed | 42 | ✓ |
| God components | 5 | ⚠️ |
| All 'use client' | 42/42 | ⚠️ ALL CLIENT |
| dangerouslySetInnerHTML issues | 2 | FIX NEEDED |
| ALLOWED_TRANSITIONS bypass | 1 | 🔴 CRITICAL |
| Duplicated formatters | 6 | M PRIORITY |
| Missing pagination | 5+ | M PRIORITY |

**Critical Path:**  
1. Add ALLOWED_TRANSITIONS validation.
2. Add DOMPurify to blog preview.
3. Create lib/formats.ts and lib/status-colors.ts.

**Estimated effort:** 8-10 weeks for all refactors.

