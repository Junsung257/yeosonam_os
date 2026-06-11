import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('affiliate admin/attribution/promo security guards', () => {
  it('guards PATCH /api/affiliates with isAdminRequest before DB access', () => {
    const route = source('src/app/api/affiliates/route.ts');
    const patchStart = route.indexOf('export async function PATCH');
    const patchBody = route.slice(patchStart);

    const guardIndex = patchBody.indexOf('await isAdminRequest(request)');
    const dbIndex = patchBody.indexOf('if (!isSupabaseConfigured)');

    expect(patchStart).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(patchBody.slice(0, dbIndex)).toContain('{ status: 401 }');
  });

  it('does not overwrite bookings.affiliate_id during attribution recalculation', () => {
    const route = source('src/app/api/cron/affiliate-attribution-recalc/route.ts');
    const updateStart = route.indexOf('.update({');
    const updateBody = route.slice(updateStart, route.indexOf(".eq('id', b.id)", updateStart));

    expect(updateStart).toBeGreaterThanOrEqual(0);
    expect(updateBody).not.toContain('affiliate_id:');
    expect(updateBody).toContain('referral_code: chosenRef');
    expect(updateBody).toContain('attribution_split: split');
  });

  it('blocks influencer promo code takeover instead of upserting by code blindly', () => {
    const route = source('src/app/api/influencer/promo-codes/route.ts');

    expect(route).not.toContain('.upsert(');
    expect(route).toContain(".select('id, affiliate_id')");
    expect(route).toContain('existingRow.affiliate_id !== affiliate.id');
    expect(route).toContain('{ status: 409 }');
  });

  it('increments promo uses through the atomic RPC', () => {
    const route = source('src/app/api/bookings/route.ts');
    const promoBlockStart = route.indexOf('if (body.promo_code && booking?.id)');
    const promoBlock = route.slice(promoBlockStart, route.indexOf('// Lifetime', promoBlockStart));

    expect(promoBlockStart).toBeGreaterThanOrEqual(0);
    expect(promoBlock).toContain('increment_affiliate_promo_uses');
    expect(promoBlock).not.toContain('uses_count: (');
    expect(promoBlock).not.toContain('.update({ uses_count');
  });

  it('freezes booking attribution snapshots before booking creation', () => {
    const route = source('src/app/api/bookings/route.ts');
    const db = source('src/lib/db/bookings.ts');
    const createStart = route.indexOf('const booking = await createBooking(body)');
    const beforeCreate = route.slice(0, createStart);

    expect(route).toContain('buildAttributionSnapshot');
    expect(createStart).toBeGreaterThanOrEqual(0);
    expect(beforeCreate).toContain('body.attribution_snapshot = buildAttributionSnapshot');
    expect(beforeCreate).toContain('affiliate_id: body.affiliateId || null');
    expect(beforeCreate).toContain('promo_affiliate_id: body.promo_affiliate_id || null');
    expect(beforeCreate).toContain('self_referral_blocked: context.selfReferralBlocked');
    expect(beforeCreate).toContain('promo_owner_mismatch: context.promoOwnerMismatch');
    expect(db).toContain('attribution_snapshot?: Record<string, unknown> | null');
    expect(db).toContain('attribution_snapshot: data.attribution_snapshot');
  });

  it('records affiliate anomaly events for booking and cron findings', () => {
    const bookingRoute = source('src/app/api/bookings/route.ts');
    const cronRoute = source('src/app/api/cron/affiliate-anomaly-detect/route.ts');

    expect(bookingRoute).toContain("from('affiliate_anomaly_events')");
    expect(bookingRoute).toContain("event_type: 'self_referral_blocked'");
    expect(bookingRoute).toContain("event_type: 'promo_affiliate_mismatch'");
    expect(cronRoute).toContain("from('affiliate_anomaly_events')");
    expect(cronRoute).toContain("source: 'affiliate-anomaly-detect'");
  });

  it('adds attribution snapshot and service-role-only anomaly/RLS migration', () => {
    const migration = source('supabase/migrations/20260603072953_affiliate_attribution_snapshot_anomaly_events.sql');

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS attribution_snapshot jsonb NOT NULL DEFAULT');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.affiliate_anomaly_events');
    expect(migration).toContain('ALTER TABLE IF EXISTS public.affiliate_touchpoints ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE IF EXISTS public.affiliate_reward_events ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE IF EXISTS public.settlements ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE IF EXISTS public.pin_attempts ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.affiliate_anomaly_events ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.affiliate_touchpoints FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT ALL ON TABLE public.affiliate_anomaly_events TO service_role');
    expect(migration).toContain('affiliate_anomaly_events_service_role_all');
  });

  it('hardens affiliate promo codes RLS and exposes increment RPC only to service_role', () => {
    const migration = source('supabase/migrations/20260603062812_affiliate_promo_uses_rpc_rls_hardening.sql');

    expect(migration).toContain('ALTER TABLE IF EXISTS public.affiliate_promo_codes ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.affiliate_promo_codes FROM anon');
    expect(migration).toContain('REVOKE ALL ON TABLE public.affiliate_promo_codes FROM authenticated');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.increment_affiliate_promo_uses');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.increment_affiliate_promo_uses(text) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.increment_affiliate_promo_uses(text) TO service_role');
  });

  it('guards settlement GET/POST/PATCH with explicit admin auth', () => {
    const route = source('src/app/api/settlements/route.ts');

    expect(route).toContain("import { requireAdminRequest } from '@/lib/admin-guard'");
    expect(route).not.toContain('requireAuthenticatedRoute');

    for (const handler of ['GET', 'POST', 'PATCH']) {
      const start = route.indexOf(`export async function ${handler}`);
      const body = route.slice(start, route.indexOf('if (!isSupabaseConfigured)', start));
      expect(start).toBeGreaterThanOrEqual(0);
      expect(body).toContain('await requireAdminRequest(request)');
      expect(body).toContain('if (guard) return guard');
    }
  });

  it('uses the shared settlement engine for manual settlement close', () => {
    const route = source('src/app/api/settlements/route.ts');
    const postStart = route.indexOf('export async function POST');
    const patchStart = route.indexOf('export async function PATCH');
    const postBody = route.slice(postStart, patchStart);

    expect(postBody).toContain('calculateDraftForAffiliate');
    expect(postBody).toContain('applySettlementApproval');
    expect(postBody).not.toContain(".gte('departure_date'");
    expect(postBody).not.toContain('.upsert({');
    expect(postBody).not.toContain('PERSONAL_TAX_RATE');
  });

  it('requires payout evidence before marking affiliate settlement completed', () => {
    const route = source('src/app/api/settlements/route.ts');
    const patchStart = route.indexOf('export async function PATCH');
    const patchBody = route.slice(patchStart);

    expect(route).toContain('ALLOWED_TRANSITIONS');
    expect(route).toContain("READY: ['HOLD', 'COMPLETED', 'VOID']");
    expect(route).toContain("HOLD: ['READY']");
    expect(route).toContain("COMPLETED: ['VOID']");
    expect(patchBody).toContain('INVALID_SETTLEMENT_TRANSITION');
    expect(patchBody).toContain("status === 'COMPLETED'");
    expect(patchBody).toContain('payout_reference');
    expect(patchBody).toContain('paid_by');
    expect(patchBody).toContain('paid_at');
    expect(patchBody).toContain('withholding_amount');
    expect(patchBody).toContain('receipt_url');
    expect(patchBody).toContain('!isValidIsoDate(paidAt)');
    expect(patchBody).toContain('!isValidEvidenceUrl(receiptUrl)');
    expect(patchBody).not.toContain("requiredText(body.paid_at) || new Date().toISOString()");
    expect(patchBody).toContain('PAYOUT_EVIDENCE_REQUIRED');
    expect(patchBody).toContain('HOLD_REASON_REQUIRED');
    expect(patchBody).toContain('INVALID_WITHHOLDING_AMOUNT');
    expect(patchBody).toContain('PAYOUT_AMOUNT_MISMATCH');
    expect(patchBody).toContain('amountDelta(finalPayout + withholdingAmount, finalTotal)');
    expect(patchBody).toContain('payload.payout_reference = null');
    expect(patchBody).toContain('payload.withholding_amount = 0');
    expect(patchBody).toContain('before_value');
    expect(patchBody).toContain('receipt_url: (current as Record<string, unknown>).receipt_url');
    expect(patchBody).toContain('paid_by: payload.paid_by');
    expect(patchBody).toContain('hold_reason: payload.hold_reason');
  });

  it('keeps settlement PDF bookings aligned to return_date period', () => {
    const route = source('src/app/api/settlements/[id]/pdf/route.ts');
    const bookingQueryStart = route.indexOf(".from('bookings')");
    const bookingQuery = route.slice(bookingQueryStart, route.indexOf('const qualifiedBookings', bookingQueryStart));

    expect(bookingQuery).toContain(".gte('return_date', periodStart)");
    expect(bookingQuery).toContain(".lte('return_date', periodEnd)");
    expect(bookingQuery).toContain(".order('return_date'");
    expect(bookingQuery).not.toContain(".gte('departure_date', periodStart)");
    expect(bookingQuery).not.toContain(".lte('departure_date', periodEnd)");
  });

  it('adds payout evidence columns for affiliate settlements', () => {
    const migration = source('supabase/migrations/20260603064124_affiliate_settlement_payout_evidence.sql');

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS payout_reference text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS paid_by text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS paid_at timestamptz');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS withholding_amount numeric(12,2) NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS receipt_url text');
    expect(migration).toContain('settlements_completed_payout_evidence_chk');
    expect(migration).toContain("status <> 'COMPLETED'");
    expect(migration).toContain('paid_at IS NOT NULL');
    expect(migration).toContain('withholding_amount <= final_total');
    expect(migration).toContain('abs((coalesce(final_payout, 0) + withholding_amount) - coalesce(final_total, 0)) <= 1');
    expect(migration).toContain("receipt_url ~* '^https?://'");
  });

  it('stores partner application consent, disclosure, normalized URL, and risk score', () => {
    const route = source('src/app/api/partner-apply/route.ts');
    const migration = source('supabase/migrations/20260603064727_affiliate_application_auth_phase2.sql');

    expect(route).toContain('terms_accepted_at');
    expect(route).toContain('disclosure_ack_at');
    expect(route).toContain('channel_url_normalized');
    expect(route).toContain('application_risk_score');
    expect(route).toContain('risk_reasons');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS terms_accepted_at');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS disclosure_ack_at');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS channel_url_normalized');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS application_risk_score');
  });

  it('approves partners with generated portal PIN, pin_hash, and lifecycle status', () => {
    const route = source('src/app/api/admin/applications/route.ts');
    const setPin = source('src/app/api/admin/affiliates/set-pin/route.ts');

    expect(route).toContain('generatePortalPin');
    expect(route).toContain('portal_pin: pin');
    expect(route).toContain('pin_hash: hashAffiliatePin(pin)');
    expect(route).toContain("partner_status: 'approved_not_onboarded'");
    expect(route).not.toContain("slice(-4) || '0000'");
    expect(setPin).toContain('pin_hash: hashAffiliatePin(pin)');
  });

  it('uses affiliate jwt-auth service instead of legacy AFFILIATE_TOKEN_SECRET login tokens', () => {
    const route = source('src/app/api/affiliate/auth/login/route.ts');
    const dashboard = source('src/app/api/affiliate/dashboard/route.ts');
    const cardNews = source('src/app/api/affiliate/card-news/route.ts');
    const cardNewsDetail = source('src/app/api/affiliate/card-news/[id]/route.ts');

    expect(route).toContain("authAffiliate(request");
    expect(route).toContain("cookies.set('inf_token'");
    expect(route).not.toContain('AFFILIATE_TOKEN_SECRET');
    expect(route).not.toContain('createHmac');
    for (const api of [dashboard, cardNews, cardNewsDetail]) {
      expect(api).toContain('verifyAffiliateToken');
      expect(api).not.toContain('AFFILIATE_TOKEN_SECRET');
      expect(api).not.toContain('createHmac');
      expect(api).not.toContain('verifyToken(');
    }
  });

  it('routes partner dashboards through the shared affiliate dashboard service', () => {
    const service = source('src/lib/affiliate/dashboard-service.ts');
    const affiliateDashboard = source('src/app/api/affiliate/dashboard/route.ts');
    const influencerDashboard = source('src/app/api/influencer/dashboard/route.ts');

    expect(service).toContain('buildAffiliateDashboardById');
    expect(service).toContain('buildAffiliateDashboardByCode');
    expect(service).toContain('resolveAttributionMethod');
    expect(service).toContain('summarizeCommissions');
    expect(service).toContain('requireCount');
    expect(service).toContain('optionalRows');
    expect(service).toContain('content_clicks');
    expect(service).toContain('link_clicks');
    expect(service).toContain('METRIC_DEFINITIONS');
    expect(service).toContain('metric_definitions');

    expect(affiliateDashboard).toContain('buildAffiliateDashboardById');
    expect(affiliateDashboard).toContain('verifyAffiliateToken');
    expect(affiliateDashboard).not.toContain("from('settlements')");
    expect(affiliateDashboard).not.toContain("from('bookings')");

    expect(influencerDashboard).toContain('buildAffiliateDashboardByCode');
    expect(influencerDashboard).not.toContain("from('settlements')");
    expect(influencerDashboard).not.toContain("from('bookings')");
  });

  it('requires the admin settlements page to collect payout evidence before completion', () => {
    const page = source('src/app/admin/settlements/page.tsx');

    expect(page).toContain('PayoutEvidenceModal');
    expect(page).toContain('HoldReasonModal');
    expect(page).toContain('EvidenceCell');
    expect(page).toContain('copiedEvidence');
    expect(page).toContain('placeholder="파트너, 코드, 증빙 검색"');
    expect(page).toContain('statusCounts');
    expect(page).toContain('PauseCircle');
    expect(page).toContain('CheckCircle');
    expect(page).toContain('payout_reference');
    expect(page).toContain('paid_by');
    expect(page).toContain('paid_at');
    expect(page).toContain('withholding_amount');
    expect(page).toContain('receipt_url');
    expect(page).toContain('hold_reason');
    expect(page).toContain("openCompletionModal(s)");
    expect(page).toContain("openHoldModal(s)");
    expect(page).toContain("updateStatus(s.id, 'READY')");
    expect(page).not.toContain("updateStatus(s.id, 'COMPLETED')");
    expect(page).not.toContain("['READY', 'PENDING'].includes(s.status)");
  });

  it('exposes partner dashboard filters, preset sub IDs, and promo stock warnings', () => {
    const page = source('src/app/affiliate/dashboard/page.tsx');

    expect(page).toContain('예약 기간 필터');
    expect(page).toContain('정산 상태 필터');
    expect(page).toContain("['instagram', 'kakao', 'blog', 'youtube', 'dm']");
    expect(page).toContain('프로모코드가 모두 소진되었습니다.');
    expect(page).toContain('잔여 사용량이 10개 이하입니다.');
    expect(page).toContain('customSubId');
  });

  it('removes phone-last-4 PIN fallback from affiliate PIN verifiers', () => {
    const pdfAuth = source('src/lib/affiliate-influencer-auth.ts');
    const bridge = source('src/lib/affiliate/jwt-or-pin-auth.ts');

    expect(pdfAuth).not.toContain('phone');
    expect(pdfAuth).not.toContain('slice(-4)');
    expect(bridge).toContain("authAffiliate(req");
  });

  it('connects pin_attempts lockout to shared affiliate auth service', () => {
    const service = source('src/lib/affiliate/auth-service.ts');
    const migration = source('supabase/migrations/20260603064727_affiliate_application_auth_phase2.sql');

    expect(service).toContain("from('pin_attempts')");
    expect(service).toContain('PIN_MAX_ATTEMPTS');
    expect(service).toContain('recordFailure');
    expect(service).toContain('clearFailures');
    expect(service).toContain("code: 'PIN_LOCKED'");
    expect(migration).toContain('idx_pin_attempts_identifier_attempted');
    expect(migration).toContain('pin_attempts_service_role_all');
  });
});
