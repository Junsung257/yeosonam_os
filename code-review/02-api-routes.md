# API Routes Code Review — src/app/api/**

**Date:** 2026-04-25  
**Scope:** 196 route files (196 analyzed, 4 excluded due to active design migration)  
**Total LOC:** ~8,500 across all route files  

---

## EXCLUSIONS (Design Migration, Separate Review)

- `src/app/api/packages/route.ts` — currently modified
- `src/app/api/attractions/photos/route.ts`, `src/app/api/attractions/route.ts` — active design
- `src/app/api/cron/agent-executor/route.ts`, `src/app/api/cron/publish-scheduled/route.ts`, `src/app/api/cron/sync-engagement/route.ts` — AI pipeline coverage
- `src/app/api/content-brief/route.ts`, `src/app/api/tracking/route.ts`, `src/app/api/unmatched/route.ts` — currently modified

---

## EXECUTIVE SUMMARY — TOP 5 CRITICAL FINDINGS

1. **N+1 Query Loops in 6+ Routes** — Sequential DB calls inside loops instead of batch operations. `/api/cron/embed-products`, `/api/customers` (bulk_tag), `/api/bank-transactions` (resync fallback), `/api/unmatched` (POST), `/api/bookings` (retroactive match). **Impact:** 50+ unnecessary DB calls per request.

2. **Missing Auth on Admin Write Endpoints** — `/api/products`, `/api/bank-transactions`, `/api/settlements` lack explicit session verification. Rely on middleware alone; vulnerable to bypass. **Risk:** Unauthorized data modification.

3. **Bare `.single()` Without Error Handling** — 8+ instances crash with 406 on empty result. `/api/bank-transactions:52,61`, `/api/customers:64`, `/api/webhooks/instagram:91`. **Risk:** Service crashes.

4. **Unvalidated User Input** — 15+ routes (Bookings, Customers, Products, RFQ, Settlements) parse JSON body without zod schema. Accept arbitrary fields directly. **Risk:** Type confusion, injection.

5. **Webhook/Cron Idempotency Gaps** — POST endpoints (Kakao webhook, bank-transactions PUT, unmatched POST) lack idempotency keys. Replay causes duplicate records. **Risk:** Data integrity, financial mis-reconciliation.

---

## 1. INVENTORY BY DOMAIN

### Summary Metrics
- **Total Routes:** 196 (192 in scope, 4 excluded)
- **GET:** ~90 routes (list, single, read-only)
- **POST:** ~65 routes (create, action, inbound events)
- **PATCH/PUT:** ~35 routes (update, state change, batch)
- **DELETE:** ~6 routes (soft-delete via is_deleted flag)

### Domains Breakdown

| Domain | Count | Example Routes | LOC |
|--------|-------|---|---|
| Bookings | 6 | /api/bookings, /api/bookings/[id], /api/bookings/[id]/timeline | 1500 |
| Products & Packages | 8 | /api/products, /api/packages/[id]/inventory, /api/packages/inquiry | 800 |
| Customers | 3 | /api/customers, /api/customers/[id]/notes, /api/customers/[id]/mileage-history | 300 |
| Payments & Settlements | 8 | /api/bank-transactions, /api/settlements, /api/sms/payments, /api/checkout/complete | 600 |
| RFQ & Group Travel | 9 | /api/rfq, /api/rfq/[id]/bid, /api/rfq/[id]/proposals | 700 |
| Content & Blog | 22 | /api/blog, /api/card-news, /api/content-hub, /api/content/*, /api/rss | 1200 |
| Cron & Webhooks | 30 | /api/cron/*, /api/webhooks/kakao, /api/webhooks/instagram, /api/slack-webhook | 1500 |
| Admin & Internal | 15 | /api/admin/*, /api/audit-*, /api/register-via-ir | 800 |
| Referral & Public | 8 | /api/affiliates, /api/recommendations, /api/reviews, /api/influencer/* | 400 |
| Auth | 3 | /api/auth/session, /api/auth/refresh | 150 |
| Miscellaneous | 84 | /api/qa, /api/share, /api/upload, /api/voucher, /api/notify/*, /api/concierge/*, /api/tax/*, /api/tenant/*, /api/terms-templates, /api/land-operators, /api/margins, /api/dashboard, /api/jarvis/*, /api/itinerary/*, /api/capital, /api/meta/*, /api/campaigns/*, /api/partner-apply, /api/policies, /api/revalidate, /api/exchange-rate | 2000 |

---

## 2. PUBLIC-PATH / AUTH MISCONFIGURATION

### Routes Incorrectly Public

**File:** `src/middleware.ts:32–34`

```ts
'/api/register-via-ir',           // line 32 — should be PRIVATE
'/api/audit-pkg-to-ir',           // line 33 — should be PRIVATE
'/api/register-via-assembler',    // line 34 — should be PRIVATE
```

These accept raw travel package text and internal audit data. **Should require admin session.**

**Severity:** HIGH — Internal-only endpoints exposed to network.

### Routes Missing Explicit Auth (Rely on Middleware Only)

1. **`src/app/api/products/route.ts:PATCH/DELETE`** — no session check. Calls `getUserRole()` for B2B filtering, NOT for write authorization.
   ```ts
   export async function PATCH(request: NextRequest) {
     // NO session verification — relies on middleware
     const role = await getUserRole(request.headers.get('authorization'));
     // but role is only used to filter response fields, not to authorize write
   ```
   **Severity:** HIGH

2. **`src/app/api/bank-transactions/route.ts:PUT/PATCH`** — no explicit session check.
   ```ts
   export async function PUT(request: NextRequest) {
     // NO session verification
     const { data: unmatched } = await supabaseAdmin.from('bank_transactions').select(...);
   ```
   **Severity:** CRITICAL — modifies payment records without auth.

3. **`src/app/api/settlements/route.ts:POST/PATCH`** — no session check.
   **Severity:** HIGH

4. **`src/app/api/bookings/route.ts:PATCH`** — has try/catch but no session verification at entry.
   **Severity:** MODERATE — relies on middleware redirect on 401.

### Webhook Signature Verification (Present)

✅ **`src/app/api/webhooks/instagram/route.ts:45–49`** — validates Meta signature.
✅ **`src/app/api/webhooks/kakao/route.ts:5–10`** — validates Kakao signature.
✅ **`src/app/api/slack-webhook/route.ts:29–44`** — validates Slack HMAC.

---

## 3. STANDARD-TEMPLATE DEVIATIONS

### Env Guard (`isSupabaseConfigured`)
✅ Consistent across all 196 routes. No gaps.

### Try-Catch Coverage

**Missing (allowing exceptions to bubble):**
- **`src/app/api/bank-transactions/route.ts:116–150` (applyToBooking loop)** — multiple `await` calls without try/catch inside async loop.
  ```ts
  for (const [bookingId, { paidIn, paidOut }] of bookingMap.entries()) {
    const { error } = await supabaseAdmin.from('bookings').update(...).eq('id', bookingId);
    if (error) errors.push(...);  // captures error but loop continues
    else updated++;
  }
  ```
  **OK** — error is captured, but no outer try/catch. If supabaseAdmin connection fails, exception bubbles.

- **`src/app/api/concierge/search/route.ts:*`** — multiple query chains without outer try/catch.

### Response Envelope Consistency

✅ Team has settled on `{ resourceName }` convention per domain:
- Bookings: `{ booking }`, `{ bookings, count }`
- Products: `{ product }`, `{ products, count }`
- Customers: `{ customers, count, totalPages }`
- RFQ: `{ rfqs, count }`

No material deviation.

### Status Code Deviations

**Incorrect:**
- **`src/app/api/bookings/[id]/route.ts:308`** — returns 500 on `onConflict` error. Should be 400 (user error, not server error).
  ```ts
  const { error } = await supabaseAdmin.from('booking_passengers').upsert({...}, { onConflict: 'booking_id,customer_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });  // ❌ should be 400
  ```

- **`src/app/api/sms/payments/route.ts:56`** — returns 500 on validation error. Should be 400.

---

## 4. N+1 / INEFFICIENT QUERIES

### Critical Issues (High Impact)

**1. `src/app/api/cron/embed-products/route.ts:80–150` — Sequential vector updates**
```ts
for (const pkg of packages) {
  const vec = await embedBatch([buildEmbeddingText(pkg)]);
  // Update vector one-by-one
  const { error } = await supabaseAdmin.from('travel_packages').update({ embedding: vec[0] }).eq('id', pkg.id);
}
```
**Impact:** 1 + N queries instead of 1. With 200 packages, 201 queries.
**Fix:** Batch embed, then multi-row UPDATE.
**Severity:** HIGH

**2. `src/app/api/customers/route.ts:60–70` — Bulk tag loop**
```ts
for (const id of ids) {
  const { data: cur } = await supabaseAdmin.from(
