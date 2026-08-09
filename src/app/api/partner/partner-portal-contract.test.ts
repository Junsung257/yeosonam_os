import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('affiliate partner portal V2 contracts', () => {
  it('keeps the canonical route surfaces present for production builds', () => {
    const routes = [
      'src/app/partner/page.tsx',
      'src/app/partner/login/page.tsx',
      'src/app/partner/activate/page.tsx',
      'src/app/partner/products/page.tsx',
      'src/app/partner/publish/page.tsx',
      'src/app/partner/publications/page.tsx',
      'src/app/partner/performance/page.tsx',
      'src/app/partner/bookings/page.tsx',
      'src/app/partner/earnings/page.tsx',
      'src/app/partner/settings/page.tsx',
      'src/app/api/partner/catalog/route.ts',
      'src/app/api/partner/terms/route.ts',
      'src/app/admin/affiliate-profiles/page.tsx',
      'src/app/with/[slug]/page.tsx',
    ];
    for (const route of routes) {
      expect(fs.existsSync(path.join(process.cwd(), route)), route).toBe(true);
    }
  });

  it('uses the customer visibility SSOT and distinguishes empty from unavailable catalog', () => {
    const catalog = source('src/app/api/partner/catalog/route.ts');
    expect(catalog).toContain('CUSTOMER_VISIBLE_STATUSES');
    expect(catalog).toContain('data_unavailable');
    expect(catalog).toContain('products.length > 0');
    expect(catalog).not.toContain('status === "approved"');
  });

  it('requires the shared partner session for the content boundary', () => {
    const content = source('src/app/api/influencer/content/route.ts');
    expect(content).toContain('authInfluencer');
    expect(content).toContain(".eq('affiliate_id', affiliateId)");
    expect(content).toContain('콘텐츠 조회에 실패했습니다.');
  });

  it('keeps publication, touchpoint, attribution and settlement on the same identifier chain', () => {
    const publication = source('src/app/api/partner/publications/route.ts');
    const tracking = source('supabase/migrations/20260808141909_affiliate_publication_attribution_v2.sql');
    expect(publication).toContain('affiliate_publications');
    expect(publication).toContain('channel_id');
    expect(tracking).toContain('publication_id uuid');
    expect(tracking).toContain('conversion_count = conversion_count + 1');
    expect(tracking).toContain('attribution_decision_id');
  });

  it('records PII-free funnel evidence at the critical boundaries', () => {
    const events = source('src/lib/affiliate/funnel-events.ts');
    const migration = source('supabase/migrations/20260808145303_affiliate_partner_portal_v2.sql');
    const application = source('src/app/api/partner-apply/route.ts');
    const booking = source('src/app/api/bookings/route.ts');
    expect(events).toContain('affiliate_application_submitted');
    expect(events).toContain('affiliate_publication_created');
    expect(events).toContain('affiliate_touchpoint_validated');
    expect(migration).toContain('affiliate_funnel_events');
    expect(migration).toContain('commission_ledger_entry_created');
    expect(application).toContain('recordAffiliateFunnelEvent');
    expect(booking).toContain('affiliate_booking_attributed');
    expect(events).toContain('No raw phone, email, bank, customer');
    expect(events).toContain('normalizeTraceId');
  });

  it('does not label card-news generation as bookings or payout as revenue', () => {
    const dashboard = source('src/lib/affiliate/dashboard-service.ts');
    expect(dashboard).toContain('trendBookingsRes');
    expect(dashboard).toContain('payout_completed_krw');
    expect(dashboard).toContain('deprecated_metrics');
    expect(dashboard).not.toContain('recentNewsRows');
    expect(dashboard).not.toContain('total_revenue: commissionSummary.completed_payout');
  });

  it('keeps the partner layout isolated from customer widgets and includes mobile navigation', () => {
    const widgets = source('src/components/LayoutClientWidgets.tsx');
    const shell = source('src/components/partner/PartnerShell.tsx');
    expect(widgets).toContain("'/partner'");
    expect(widgets).toContain('showCustomerWidgets');
    expect(shell).toContain('파트너 모바일 메뉴');
    expect(shell).toContain('pb-28');
  });

  it('keeps admin partner previews on the canonical session-based portal', () => {
    const preview = source('src/app/admin/partner-preview/PartnerPreviewClient.tsx');
    const legacyLogin = source('src/app/affiliate/login/page.tsx');
    const legacyDashboard = source('src/app/affiliate/dashboard/page.tsx');
    expect(preview).toContain("const portalUrl = safeCode ? '/partner' : ''");
    expect(preview).not.toContain('/influencer/${encodeURIComponent(safeCode)}');
    expect(legacyLogin).toContain("redirect('/partner/login')");
    expect(legacyDashboard).toContain("redirect('/partner')");
  });

  it('exposes only immutable settlement evidence to partners', () => {
    const settlement = source('supabase/migrations/20260808143735_affiliate_settlement_ledger_v2.sql');
    const pdf = source('src/app/api/settlements/[id]/pdf/route.ts');
    expect(settlement).toContain('settlement_lines');
    expect(settlement).toContain('COMPLETED');
    expect(settlement).toContain('source_entry_id');
    expect(pdf).toContain("from('settlement_lines')");
    expect(pdf).toContain('partnerAffiliateId');
    expect(pdf).not.toContain("from('bookings')");
  });

  it('gives onboarding a real immutable terms-acceptance action', () => {
    const terms = source('src/app/api/partner/terms/route.ts');
    const settings = source('src/app/partner/settings/page.tsx');
    expect(terms).toContain('affiliate_terms_acceptances');
    expect(terms).toContain('ignoreDuplicates: true');
    expect(terms).toContain('TERMS_ACCEPTANCE_REQUIRED');
    expect(settings).toContain('/api/partner/terms');
    expect(settings).toContain('필수 정책 모두 동의');
  });

  it('keeps payout and tax submissions encrypted and review-gated', () => {
    const helper = source('src/lib/affiliate/profile-submission.ts');
    const payout = source('src/app/api/partner/payout-profile/route.ts');
    const tax = source('src/app/api/partner/tax-profile/route.ts');
    const migration = source('supabase/migrations/20260808232441_affiliate_partner_profile_submissions.sql');
    expect(helper).toContain('encryptAffiliateOutboxPayload');
    expect(payout).toContain('PENDING_REVIEW');
    expect(tax).toContain('PENDING_REVIEW');
    expect(migration).toContain('encrypted_payload text NOT NULL');
    expect(migration).toContain('service_role');
  });

  it('requires admin review before partner payout or tax status becomes verified', () => {
    const review = source('src/app/api/admin/affiliate-profiles/route.ts');
    expect(review).toContain('requireAdminRequest');
    expect(review).toContain('PROFILE_STATUS_SYNC_FAILED');
    expect(review).toContain('VERIFIED');
  });

  it('does not present creator attribution codes as customer discounts', () => {
    const report = source('src/app/api/admin/affiliate-promo-report/route.ts');
    const detail = source('src/app/admin/affiliates/[id]/page.tsx');
    expect(report).toContain("from('creator_codes')");
    expect(report).toContain("code_type: 'CREATOR_ATTRIBUTION'");
    expect(report).not.toContain("from('affiliate_promo_codes')");
    expect(detail).toContain('추천 귀속만');
  });

  it('keeps public leaderboard and booking restore on immutable settlement evidence', () => {
    const leaderboard = source('src/app/api/affiliates/leaderboard/route.ts');
    const restore = source('src/app/api/bookings/[id]/restore/route.ts');
    expect(leaderboard).toContain("from('settlement_runs')");
    expect(leaderboard).toContain('net_payout_krw');
    expect(leaderboard).not.toContain("from('settlements')");
    expect(restore).toContain('BOOKING_SETTLEMENT_REVIEW_REQUIRED');
    expect(restore).not.toContain("from('settlements')");
  });
});
