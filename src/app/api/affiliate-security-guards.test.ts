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

  it('pauses ambiguous influencer promotion creation until contract V2', () => {
    const route = source('src/app/api/influencer/promo-codes/route.ts');

    expect(route).not.toContain('.upsert(');
    expect(route).toContain('PROMOTION_CREATION_PAUSED');
    expect(route).toContain('{ status: 423 }');
    expect(route).toContain('isAllowedPartnerWriteOrigin');
  });

  it('separates attribution-only creator codes from atomic real-discount reservations', () => {
    const route = source('src/app/api/bookings/route.ts');
    const validateRoute = source('src/app/api/affiliate/promo/validate/route.ts');
    const migration = source('supabase/migrations/20260808141909_affiliate_publication_attribution_v2.sql');

    expect(route).toContain("from('creator_codes')");
    expect(route).not.toContain('increment_affiliate_promo_uses');
    expect(validateRoute).toContain("kind: 'creator_code'");
    expect(validateRoute).toContain('changes_customer_price: false');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.discount_campaigns');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.reserve_discount_redemption_v2');
    expect(migration).toContain("RAISE EXCEPTION 'DISCOUNT_BUDGET_EXHAUSTED'");
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
    expect(beforeCreate).toContain('createAttributionDecision');
    expect(beforeCreate).toContain('attribution_decision_id: context.attributionDecision?.id || null');
    expect(db).toContain('attribution_snapshot?: Record<string, unknown> | null');
    expect(db).toContain('attribution_snapshot: data.attribution_snapshot');
    expect(db).toContain('attribution_decision_id?: string | null');
  });

  it('tracks and converts the exact publication through atomic V2 functions', () => {
    const tracking = source('src/app/api/influencer/track/route.ts');
    const booking = source('src/app/api/bookings/route.ts');
    const migration = source('supabase/migrations/20260808141909_affiliate_publication_attribution_v2.sql');

    expect(tracking).toContain("rpc('record_affiliate_touchpoint_v2'");
    expect(tracking).toContain("cookies.set('aff_touchpoint'");
    expect(tracking).toContain("cookies.set('aff_publication'");
    expect(tracking).toContain("cookies.set('aff_sub', '',");
    expect(booking).not.toContain("from('influencer_links').select('id, conversion_count')");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.affiliate_publications');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.attribution_decisions');
    expect(migration).toContain('click_count = click_count + 1');
    expect(migration).toContain('conversion_count = conversion_count + 1');
    expect(migration).toContain('bookings_finalize_affiliate_attribution_v2');
  });

  it('requires idempotency for partner publication and creator-code writes', () => {
    const publications = source('src/app/api/partner/publications/route.ts');
    const publicationUpdate = source('src/app/api/partner/publications/[id]/route.ts');
    const creatorCodes = source('src/app/api/partner/creator-codes/route.ts');

    for (const route of [publications, publicationUpdate, creatorCodes]) {
      expect(route).toMatch(/idempotency-key/);
      expect(route).toContain('IDEMPOTENCY_KEY_REQUIRED');
      expect(route).toContain('isAllowedPartnerWriteOrigin');
      expect(route).toContain('authAffiliate');
    }
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

    expect(route).toContain('requireAdminRequest');
    expect(route).not.toContain('requireAuthenticatedRoute');

    for (const handler of ['GET', 'POST', 'PATCH']) {
      const start = route.indexOf(`export async function ${handler}`);
      const body = route.slice(start, route.indexOf('if (!isSupabaseAdminConfigured)', start));
      expect(start).toBeGreaterThanOrEqual(0);
      expect(body).toContain('await requireAdminRequest(request)');
      expect(body).toContain('if (guard) return guard');
    }
  });

  it('uses the atomic ledger V2 run function for manual settlement calculation', () => {
    const route = source('src/app/api/settlements/route.ts');
    const postStart = route.indexOf('export async function POST');
    const patchStart = route.indexOf('export async function PATCH');
    const postBody = route.slice(postStart, patchStart);

    expect(postBody).toContain("rpc('create_affiliate_settlement_run_v2'");
    expect(postBody).toContain('IDEMPOTENCY_KEY_REQUIRED');
    expect(postBody).toContain('resolveSettlementPeriodKst');
    expect(postBody).not.toContain("from('settlements')");
  });

  it('pauses both legacy settlement cron paths during ledger V2 migration', () => {
    const route = source('src/app/api/cron/affiliate-settlement-draft/route.ts');
    const direct = source('src/app/api/cron/settlement-auto/route.ts');
    expect(route).toContain('LEGACY_SETTLEMENT_DRAFT_PAUSED');
    expect(route).toContain('{ status: 423 }');
    expect(direct).toContain('DIRECT_SETTLEMENT_DISABLED');
    expect(direct).toContain('{ status: 423 }');
    expect(route).not.toContain('applySettlementApproval');
    expect(direct).not.toContain('applySettlementApproval');
  });

  it('requires maker-checker payout commands and removes mutable VOID', () => {
    const route = source('src/app/api/settlements/route.ts');
    const patchStart = route.indexOf('export async function PATCH');
    const patchBody = route.slice(patchStart);
    const migration = source('supabase/migrations/20260808143735_affiliate_settlement_ledger_v2.sql');

    expect(patchBody).toContain('VOID_REMOVED_USE_REVERSAL');
    expect(patchBody).toContain('PAYOUT_WORKFLOW_REQUIRED');
    expect(patchBody).toContain("rawAction === 'REQUEST_PAYOUT'");
    expect(patchBody).toContain("rawAction === 'APPROVE_PAYOUT'");
    expect(patchBody).toContain("rawAction === 'COMPLETE_PAYOUT'");
    expect(patchBody).toContain('payout_reference');
    expect(patchBody).toContain('receipt_url');
    expect(patchBody).toContain('PAYOUT_EVIDENCE_REQUIRED');
    expect(migration).toContain("IF v_payout.requested_by = p_actor THEN RAISE EXCEPTION 'PAYOUT_SEPARATION_REQUIRED'");
    expect(migration).toContain("IF OLD.status = 'COMPLETED' THEN RAISE EXCEPTION 'COMPLETED_SETTLEMENT_IMMUTABLE'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.create_commission_reversal_v2');
  });

  it('shows settlement amount diff and review blockers in the admin settlements page', () => {
    const page = source('src/app/admin/settlements/page.tsx');

    expect(page).toContain('gross_commission_krw');
    expect(page).toContain('adjustment_krw');
    expect(page).toContain('hold_reason_code');
    expect(page).toContain('COMPLETE_PAYOUT');
  });

  it('renders settlement PDFs only from frozen settlement lines', () => {
    const route = source('src/app/api/settlements/[id]/pdf/route.ts');
    expect(route).toContain("from('settlement_lines')");
    expect(route).toContain("from('settlement_runs')");
    expect(route).not.toContain("from('bookings')");
    expect(route).toContain("'X-Settlement-Contract': 'settlement-lines-v2'");
  });

  it('treats only explicit admin auth as settlement PDF admin access', () => {
    const route = source('src/app/api/settlements/[id]/pdf/route.ts');
    const handlerStart = route.indexOf('export async function GET');
    const handler = route.slice(handlerStart);
    const adminCheck = handler.indexOf('await isAdminRequest(request)');
    const affiliateTokenCheck = handler.indexOf('await authAffiliate(request)');
    const settlementQuery = handler.indexOf(".from('settlement_runs')");

    expect(route).toContain("import { isAdminRequest } from '@/lib/admin-guard'");
    expect(route).not.toContain('requireAuthenticatedRoute');
    expect(adminCheck).toBeGreaterThanOrEqual(0);
    expect(affiliateTokenCheck).toBeGreaterThan(adminCheck);
    expect(settlementQuery).toBeGreaterThan(adminCheck);
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

  it('approves partners with atomic one-time invitations and no static PIN', () => {
    const route = source('src/app/api/admin/applications/route.ts');
    const setPin = source('src/app/api/admin/affiliates/set-pin/route.ts');
    const migration = source('supabase/migrations/20260808135026_affiliate_auth_sessions_v2.sql');

    expect(route).toContain("rpc('approve_affiliate_application_v2'");
    expect(route).toContain('generateInvitationToken');
    expect(route).not.toContain('generatePortalPin');
    expect(route).not.toContain('portal_pin: pin');
    expect(setPin).toContain("rpc('rotate_affiliate_credentials_v2'");
    expect(setPin).toContain("error: 'STATIC_PIN_RETIRED'");
    expect(migration).toContain("'approved_not_onboarded'");
    expect(migration).toContain('portal_pin = NULL');
    expect(migration).toContain('pin_hash = NULL');
  });

  it('uses a revocable partner_session instead of browser bearer tokens', () => {
    const route = source('src/app/api/affiliate/auth/login/route.ts');
    const dashboard = source('src/app/api/affiliate/dashboard/route.ts');
    const cardNews = source('src/app/api/affiliate/card-news/route.ts');
    const cardNewsDetail = source('src/app/api/affiliate/card-news/[id]/route.ts');
    const sessionRoute = source('src/app/api/partner/auth/session/route.ts');

    expect(route).toContain('PIN_LOGIN_RETIRED');
    expect(sessionRoute).toContain('authAffiliate(request)');
    expect(sessionRoute).toContain('clearPartnerSessionCookie');
    expect(route).not.toContain('AFFILIATE_TOKEN_SECRET');
    for (const api of [dashboard, cardNews, cardNewsDetail]) {
      expect(api).toContain('authAffiliate(request)');
      expect(api).not.toContain('AFFILIATE_TOKEN_SECRET');
      expect(api).not.toContain("headers.get('authorization')");
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
    expect(service).toContain('count(');
    expect(service).toContain('content_clicks');
    expect(service).toContain('publication_clicks');
    expect(service).toContain('METRIC_DEFINITIONS');
    expect(service).toContain('metric_definitions');

    expect(affiliateDashboard).toContain('buildAffiliateDashboardById');
    expect(affiliateDashboard).toContain('authAffiliate');
    expect(affiliateDashboard).not.toContain("from('settlements')");
    expect(affiliateDashboard).not.toContain("from('bookings')");

    expect(influencerDashboard).toContain('buildAffiliateDashboardByCode');
    expect(influencerDashboard).not.toContain("from('settlements')");
    expect(influencerDashboard).not.toContain("from('bookings')");
  });

  it('requires the admin settlements page to collect payout evidence before completion', () => {
    const page = source('src/app/admin/settlements/page.tsx');

    expect(page).toContain('evidenceRun');
    expect(page).toContain('COMPLETE_PAYOUT');
    expect(page).toContain('승인·지급 중');
    expect(page).toContain('CheckCircle');
    expect(page).toContain('payout_reference');
    expect(page).toContain('bank_transaction_reference');
    expect(page).toContain('receipt_url');
    expect(page).toContain('hold_reason');
    expect(page).toContain('command(run, "APPROVE_PAYOUT")');
    expect(page).toContain('command(evidenceRun, "COMPLETE_PAYOUT"');
    expect(page).not.toContain('action: "VOID"');
    expect(page).not.toContain("['READY', 'PENDING'].includes(s.status)");
  });

  it('redirects the legacy dashboard into the canonical onboarding home', () => {
    const legacyPage = source('src/app/affiliate/dashboard/page.tsx');
    const partnerPage = source('src/app/partner/page.tsx');

    expect(legacyPage).toContain("redirect('/partner')");
    expect(partnerPage).toContain('다음 할 일');
    expect(partnerPage).toContain('첫 상품 찾기');
    expect(partnerPage).toContain('첫 게시 링크 테스트');
  });

  it('removes PIN fallback from affiliate compatibility auth', () => {
    const bridge = source('src/lib/affiliate/jwt-or-pin-auth.ts');
    const pdf = source('src/app/api/settlements/[id]/pdf/route.ts');

    expect(bridge).toContain("authAffiliate(req");
    expect(bridge).not.toContain('pin:');
    expect(pdf).not.toContain("headers.get('x-pin')");
    expect(pdf).not.toContain("cookies.get('inf_token')");
  });

  it('connects sessions to lifecycle and token-version revocation', () => {
    const service = source('src/lib/affiliate/auth-service.ts');
    const migration = source('supabase/migrations/20260808135026_affiliate_auth_sessions_v2.sql');

    expect(service).toContain("from('affiliate_sessions')");
    expect(service).toContain('token_version');
    expect(service).toContain('revoked_at');
    expect(migration).toContain('affiliates_revoke_sessions_security_change');
    expect(migration).toContain("'token_version_rotated'");
  });
});
