# Code Review: `db/` Scripts (여소남OS Next.js B2B2C Travel SaaS)

**Date:** 2026-04-25  
**Scope:** All `db/**/*.js` files (128 scripts) + reference docs  
**Severity Tags:** CRITICAL (crash/data loss), HIGH (CVE/leak/invalid), MEDIUM (perf/quality), LOW (style)

---

## 1. Inventory & Categorization

### 1.1 Script Count by Type

| Category | Count | LOC Range | Last Touched | Status |
|----------|-------|-----------|--------------|--------|
| **Assemblers** | 3 | 729–1445 | 2026-04-19 | CORE (prod) |
| **Audit** | 5 | 126–310 | 2026-04-19 | CORE (CI) |
| **Inserters** | 35+ | 28–946 | 2026-04-02~04-21 | MIXED |
| **Migrate/Patch** | 15 | 28–242 | 2026-04-02~04-22 | MIXED |
| **Check/Debug** | 20+ | 15–103 | 2026-04-19 | DEBUG |
| **Seed/Bootstrap** | 8 | 52–608 | 2026-04-02~04-15 | THROWAWAY |
| **RAG/AI Utils** | 4 | 101–242 | 2026-04-22 | NEW |
| **Smoke Tests** | 3 | 156–179 | 2026-04-22~23 | CORE |
| **Templates** | 1 | 1117 | — | CORE |
| **Total** | **128** | — | — | — |

### 1.2 Throwaway Candidates

55+ scripts are one-use batch imports or dated patches:
- All `insert_*_YYYYMMDD_*.js` (35 files) — initial product seeding, not re-run
- All `check-*.js`, `check_*.js` (20+ files) — ad-hoc debug queries
- `seed_*.js`, `block_master_seed_*.js` (8) — initial baseline, now obsolete
- Date-stamped patches: `enhance_nagasaki_notices_20260419.js`, `fix_nagasaki_20260419.js`, etc.

**Recommendation:** Archive to `db/archive/` (1000+ LOC cleanup)

---

## 2. Critical Findings

### 2.1 CRITICAL: assembler_xian.js:948–949 — Empty raw_text Fallback

```javascript
raw_text: fullText || '',  // Line 948 — VIOLATES RULE ZERO
raw_text_hash: fullText ? crypto... : null,  // Line 949 — Hash can be null
```

**Issue:** Allows empty raw_text, invalidates post_register_audit.js integrity checks (E0).

**Fix:** Remove fallback, crash early:
```javascript
if (!fullText) throw new Error('raw_text is empty');
raw_text: fullText,
raw_text_hash: crypto.createHash('sha256').update(fullText).digest('hex'),
```

**Impact:** CRITICAL — Raw text is audit ground truth. Empty = unverifiable product.

**Affected:** assembler_qingdao.js (verify)

---

### 2.2 CRITICAL: Verify No type='transport' in Schedule

From validatePackage (insert-template.js:254):
```javascript
if (s.type === 'transport') errors.push(`type='transport' FORBIDDEN — TransportBar crash`);
```

**Status:** assembler_xian.js uses `type: 'normal'` + separate `transport` field ✓  
**TODO:** Verify assembler_qingdao.js, assembler_danang.js have same pattern.

**Impact:** CRITICAL — Crashes A4/mobile renderer.

---

### 2.3 HIGH: post_register_audit.js Missing Agent Audit Report Check

**Line 317:**
```javascript
if (pkg.agent_audit_report) {
  // Process agent_audit
} else {
  console.log(`⚠️  ... skipped`);  // Silent pass!
}
```

**Issue:** If `/register` Step 6.5 doesn't populate agent_audit_report, audit silently skips E6 (CoVe claims verification).

**Fix:** Assert it exists:
```javascript
if (!pkg.agent_audit_report) {
  result.errors.push('agent_audit_report 미기재 — Step 6.5 실행 필요');
}
```

**Impact:** HIGH — No Agent self-audit fallback. Only W1–W19 validates.

---

### 2.4 HIGH: 55+ Throwaway Scripts Clutter Repo

- insert_baekdusan_20260415, insert_kul_20260418, etc. — ran once, never re-run
- check_fuk_products.js (19 LOC), check-kul-state.js (42 LOC) — debug queries
- block_master_seed_qingdao.js, block_master_seed_xian.js — obsolete post-migration

**Recommendation:** Move to db/archive/, compress repo by 1000+ LOC.

---

## 3. Assembler Duplication

### 3.1 Code Reuse Opportunity

| Function | Xian | Qingdao | Duplication |
|----------|------|---------|-------------|
| parseRawText | 437 LOC | likely same | 60% |
| matchBlocks | 35 LOC | 35 LOC | DUPLICATED |
| detectMeals | 41 LOC | likely same | DUPLICATED |
| detectHotel | 19 LOC | likely same | DUPLICATED |
| extractPrices | 44 LOC | likely same | DUPLICATED |
| buildProduct | 300 LOC | 300+ LOC | CRITICAL |

**Solution:** Extract `db/lib/block-master.js`:
```javascript
const xian = BlockMaster.load('XIY');  // Load blocks, templates, meals, hotels
const blocks = xian.getBlocks();
const template = xian.matchTemplate(nights, blockCodes);
```

**Impact:** MEDIUM — Enables new destinations in 200 LOC instead of 1000.

---

## 4. Assembler Field Validation

| Field | Xian:line | Status | Issue |
|-------|-----------|--------|-------|
| title | 906 | ✓ | 3+ chars |
| price_dates | 934 | ✓ | populated |
| itinerary_data.days | 954 | ✓ | valid |
| remarks (string[]) | 976 | ✓ | correct type |
| raw_text | 948 | ✗ | FALLBACK TO '' |
| raw_text_hash | 949 | ✗ | CAN BE NULL |

---

## 5. Audit Scripts Coverage

### 5.1 Wired to CI (package.json)

| Script | Lines | Wired | Fast | Exit Code | Purpose |
|--------|-------|-------|------|-----------|---------|
| audit_api_field_drift.js | 160 | ✓ (audit:api-drift:ci) | ✓ | --strict | Column drift |
| audit_schema_drift.js | 244 | ✓ (audit:drift:ci) | ✓ | --fail-on-drift | Schema sync |
| audit_existing_packages.js | 267 | ✓ | ✓ | ? | W1–W19 batch |
| audit_render_vs_source.js | 310 | ✗ | ? | ? | Render diff |
| cove_audit.js | 214 | ✓ (called by post_register) | ✓ | — | CoVe E6 |

**Gap:** audit_render_vs_source.js not in CI. Should be optional gate (`npm run audit:render`).

---

## 6. Quick Wins (Top 5)

| # | File | Change | Effort | ROI |
|---|------|--------|--------|-----|
| 1 | assembler_xian.js:948 | Remove `\|\| ''` fallback | S (1 line) | Prevents silent data corruption |
| 2 | assembler_xian.js:949 | Always compute hash, never null | S (1 line) | Enforces Rule Zero |
| 3 | db/ | Archive 55 throwaway scripts | M (git mv) | Codebase clarity |
| 4 | post_register_audit.js:317 | Assert agent_audit_report exists | S (3 lines) | Fail-fast on missing audit |
| 5 | package.json | Wire audit_render_vs_source.js | S (1 line) | Catch render bugs in CI |

---

## 7. Larger Refactors (Top 3)

| Title | Scope | Effort | ROI |
|-------|-------|--------|-----|
| BlockMaster Class | Extract 1000 LOC duplication from assemblers | L (800 LOC) | Danang + new destinations 10x faster |
| Audit Dashboard | Centralize W1–W19, E0–E6, track trends | L (500 LOC + UI) | Identify systemic issues, reduce regressions |
| Archive Old Scripts | Move 55 insert_/seed_/check_ to history | M (git work) | 1000+ LOC cleanup |

---

## 8. Next Review Checklist

- [ ] assembler_qingdao.js: No empty raw_text fallback?
- [ ] assembler_danang.js: No type='transport' in schedule?
- [ ] All insert_*: price_dates populated? remarks is string[]?
- [ ] post_register_audit.js: assert agent_audit_report.available?
- [ ] rag_reindex_all.js: Rate-limiting + --dry-run?
- [ ] Wire audit_render_vs_source.js to npm?

---

**Report:** Code Review Agent · 2026-04-25

