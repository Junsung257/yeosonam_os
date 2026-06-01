import { NextRequest, NextResponse } from 'next/server';
import { buildTenantAdReadiness } from '@/lib/ad-os-tenant-readiness';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PLATFORMS = new Set(['naver', 'google', 'meta', 'kakao']);
const ACCOUNT_MODES = new Set(['agency_managed', 'tenant_owned', 'hybrid']);
const CONNECTION_STATES = new Set(['not_connected', 'credentials_ready', 'permission_denied', 'no_campaign', 'ready', 'suspended']);
const RISK_STATES = new Set(['normal', 'watch', 'restricted', 'blocked']);

function nonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function cleanString(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text.slice(0, 500) : null;
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  let query = supabaseAdmin
    .from('ad_os_tenant_ad_accounts')
    .select('*')
    .order('platform', { ascending: true });
  query = tenantId ? query.eq('tenant_id', tenantId) : query.is('tenant_id', null);
  const { data, error } = await query;

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const accounts = (data || []).map((row: Record<string, unknown>) => ({
    platform: String(row.platform),
    accountMode: String(row.account_mode),
    connectionStatus: String(row.connection_status),
    monthlyBudgetCapKrw: Number(row.monthly_budget_cap_krw || 0),
    dailyBudgetCapKrw: Number(row.daily_budget_cap_krw || 0),
    canPublishKeywords: Boolean(row.can_publish_keywords),
    canChangeBids: Boolean(row.can_change_bids),
    canPauseAssets: Boolean(row.can_pause_assets),
    riskStatus: String(row.risk_status || 'watch'),
  }));

  return NextResponse.json({
    ok: true,
    accounts: data || [],
    readiness: buildTenantAdReadiness(accounts),
  });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const platform = String(body.platform || '');
  if (!PLATFORMS.has(platform)) {
    return NextResponse.json({ ok: false, error: '지원하지 않는 platform' }, { status: 400 });
  }

  const accountMode = ACCOUNT_MODES.has(String(body.account_mode || ''))
    ? String(body.account_mode)
    : 'agency_managed';
  const connectionStatus = CONNECTION_STATES.has(String(body.connection_status || ''))
    ? String(body.connection_status)
    : 'not_connected';
  const riskStatus = RISK_STATES.has(String(body.risk_status || ''))
    ? String(body.risk_status)
    : 'watch';

  const row = {
    tenant_id: body.tenant_id || null,
    platform,
    account_mode: accountMode,
    external_account_id: cleanString(body.external_account_id),
    external_customer_id: cleanString(body.external_customer_id),
    external_campaign_id: cleanString(body.external_campaign_id),
    external_ad_group_id: cleanString(body.external_ad_group_id),
    connection_status: connectionStatus,
    permission_scope: Array.isArray(body.permission_scope) ? body.permission_scope.map(String).slice(0, 20) : [],
    monthly_budget_cap_krw: nonNegativeInt(body.monthly_budget_cap_krw),
    daily_budget_cap_krw: nonNegativeInt(body.daily_budget_cap_krw),
    can_publish_keywords: Boolean(body.can_publish_keywords),
    can_change_bids: Boolean(body.can_change_bids),
    can_pause_assets: Boolean(body.can_pause_assets),
    last_probe_result: body.last_probe_result && typeof body.last_probe_result === 'object' ? body.last_probe_result : {},
    risk_status: riskStatus,
    notes: cleanString(body.notes),
    updated_at: new Date().toISOString(),
  };

  const existingQuery = supabaseAdmin
    .from('ad_os_tenant_ad_accounts')
    .select('id')
    .eq('platform', platform)
    .eq('account_mode', accountMode)
    .limit(1);
  const existingRes = row.tenant_id
    ? await existingQuery.eq('tenant_id', row.tenant_id)
    : await existingQuery.is('tenant_id', null);

  if (existingRes.error) {
    return NextResponse.json({ ok: false, error: existingRes.error.message }, { status: 500 });
  }

  const existingId = existingRes.data?.[0]?.id;
  const saveRes = existingId
    ? await supabaseAdmin.from('ad_os_tenant_ad_accounts').update(row).eq('id', existingId).select('*').single()
    : await supabaseAdmin.from('ad_os_tenant_ad_accounts').insert(row).select('*').single();

  if (saveRes.error) {
    return NextResponse.json({ ok: false, error: saveRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, account: saveRes.data });
});
