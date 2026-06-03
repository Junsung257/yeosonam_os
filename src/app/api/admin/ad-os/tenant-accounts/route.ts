import { NextRequest } from 'next/server';
import { normalizeTenantAdAccountProbe } from '@/lib/ad-os-tenant-ad-accounts';
import { buildTenantAdReadiness } from '@/lib/ad-os-tenant-readiness';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
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
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  let query = supabaseAdmin
    .from('ad_os_tenant_ad_accounts')
    .select('*')
    .order('platform', { ascending: true });
  query = tenantId ? query.eq('tenant_id', tenantId) : query.is('tenant_id', null);
  const { data, error } = await query;

  if (error) return apiResponse({ ok: false, error: sanitizeDbError(error) }, { status: 500 });
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

  return apiResponse({
    ok: true,
    accounts: data || [],
    readiness: buildTenantAdReadiness(accounts),
  });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const platform = String(body.platform || '');
  if (!PLATFORMS.has(platform)) {
    return apiResponse({ ok: false, error: '지원하지 않는 platform' }, { status: 400 });
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

  const normalized = normalizeTenantAdAccountProbe({
    tenantId: cleanString(body.tenant_id),
    platform: platform as 'naver' | 'google' | 'meta' | 'kakao',
    accountMode: accountMode as 'agency_managed' | 'tenant_owned' | 'hybrid',
    externalAccountId: cleanString(body.external_account_id),
    externalCustomerId: cleanString(body.external_customer_id),
    externalCampaignId: cleanString(body.external_campaign_id),
    externalAdGroupId: cleanString(body.external_ad_group_id),
    connectionStatus: connectionStatus as 'not_connected' | 'credentials_ready' | 'permission_denied' | 'no_campaign' | 'ready' | 'suspended',
    permissionScope: Array.isArray(body.permission_scope) ? body.permission_scope.map(String).slice(0, 20) : [],
    monthlyBudgetCapKrw: nonNegativeInt(body.monthly_budget_cap_krw),
    dailyBudgetCapKrw: nonNegativeInt(body.daily_budget_cap_krw),
    canPublishKeywords: Boolean(body.can_publish_keywords),
    canChangeBids: Boolean(body.can_change_bids),
    canPauseAssets: Boolean(body.can_pause_assets),
    riskStatus: riskStatus as 'normal' | 'watch' | 'restricted' | 'blocked',
    lastProbeResult: body.last_probe_result && typeof body.last_probe_result === 'object' ? body.last_probe_result : {},
    notes: cleanString(body.notes),
  });

  const row = {
    tenant_id: normalized.tenantId || null,
    platform,
    account_mode: accountMode,
    external_account_id: cleanString(normalized.externalAccountId),
    external_customer_id: cleanString(normalized.externalCustomerId),
    external_campaign_id: cleanString(normalized.externalCampaignId),
    external_ad_group_id: cleanString(normalized.externalAdGroupId),
    connection_status: normalized.connectionStatus,
    permission_scope: normalized.permissionScope || [],
    monthly_budget_cap_krw: normalized.monthlyBudgetCapKrw || 0,
    daily_budget_cap_krw: normalized.dailyBudgetCapKrw || 0,
    can_publish_keywords: Boolean(normalized.canPublishKeywords),
    can_change_bids: Boolean(normalized.canChangeBids),
    can_pause_assets: Boolean(normalized.canPauseAssets),
    last_probe_result: normalized.lastProbeResult || {},
    risk_status: normalized.riskStatus || 'watch',
    notes: cleanString(normalized.notes),
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
    return apiResponse({ ok: false, error: sanitizeDbError(existingRes.error) }, { status: 500 });
  }

  const existingId = existingRes.data?.[0]?.id;
  const saveRes = existingId
    ? await supabaseAdmin.from('ad_os_tenant_ad_accounts').update(row).eq('id', existingId).select('*').single()
    : await supabaseAdmin.from('ad_os_tenant_ad_accounts').insert(row).select('*').single();

  if (saveRes.error) {
    return apiResponse({ ok: false, error: sanitizeDbError(saveRes.error) }, { status: 500 });
  }

  return apiResponse({ ok: true, account: saveRes.data });
});
