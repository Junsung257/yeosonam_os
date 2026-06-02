import type { SupabaseClient } from '@supabase/supabase-js';

export type AdOsPlatform = 'naver' | 'google' | 'meta' | 'kakao';

export type TenantAdAccountProbeInput = {
  platform: AdOsPlatform;
  accountMode?: 'agency_managed' | 'tenant_owned' | 'hybrid';
  tenantId?: string | null;
  externalAccountId?: string | null;
  externalCustomerId?: string | null;
  externalCampaignId?: string | null;
  externalAdGroupId?: string | null;
  connectionStatus: 'not_connected' | 'credentials_ready' | 'permission_denied' | 'no_campaign' | 'ready' | 'suspended';
  permissionScope?: string[];
  monthlyBudgetCapKrw?: number;
  dailyBudgetCapKrw?: number;
  canPublishKeywords?: boolean;
  canChangeBids?: boolean;
  canPauseAssets?: boolean;
  riskStatus?: 'normal' | 'watch' | 'restricted' | 'blocked';
  lastProbeResult?: Record<string, unknown>;
  notes?: string | null;
};

type TenantAccountRow = {
  id?: string;
  tenant_id: string | null;
  platform: string;
  account_mode: string;
  external_account_id: string | null;
  external_customer_id: string | null;
  external_campaign_id: string | null;
  external_ad_group_id: string | null;
  connection_status: string;
  permission_scope: string[];
  monthly_budget_cap_krw: number;
  daily_budget_cap_krw: number;
  can_publish_keywords: boolean;
  can_change_bids: boolean;
  can_pause_assets: boolean;
  last_probe_at: string;
  last_probe_result: Record<string, unknown>;
  risk_status: string;
  notes: string | null;
  updated_at: string;
};

export function normalizeTenantAdAccountProbe(input: TenantAdAccountProbeInput): TenantAdAccountProbeInput {
  const externalCampaignId = cleanString(input.externalCampaignId);
  const externalAdGroupId = cleanString(input.externalAdGroupId);
  const hasLaunchAsset = Boolean(externalCampaignId && externalAdGroupId);
  const risky = input.riskStatus === 'restricted' || input.riskStatus === 'blocked';
  let connectionStatus = input.connectionStatus;

  if (connectionStatus === 'ready' && (!hasLaunchAsset || risky)) {
    connectionStatus = hasLaunchAsset ? 'permission_denied' : 'no_campaign';
  }

  const canMutateExternal = connectionStatus === 'ready' && hasLaunchAsset && !risky;

  return {
    ...input,
    externalCampaignId,
    externalAdGroupId,
    connectionStatus,
    canPublishKeywords: canMutateExternal && Boolean(input.canPublishKeywords),
    canChangeBids: canMutateExternal && Boolean(input.canChangeBids),
    canPauseAssets: canMutateExternal && Boolean(input.canPauseAssets),
  };
}

function nonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function cleanString(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text.slice(0, 500) : null;
}

export function classifyProbeMessageStatus(input: {
  platform: AdOsPlatform;
  probeStatus: string;
  message?: string | null;
  hasCampaign?: boolean;
  hasAdGroup?: boolean;
}): TenantAdAccountProbeInput['connectionStatus'] {
  const message = String(input.message || '').toLowerCase();
  if (input.probeStatus === 'missing_config' || input.probeStatus === 'missing_oauth') return 'not_connected';
  if (input.probeStatus === 'failed') {
    if (
      message.includes('permission_denied') ||
      message.includes('permission denied') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('403')
    ) {
      return 'permission_denied';
    }
    return 'credentials_ready';
  }
  if (input.hasCampaign === false || input.hasAdGroup === false) return 'no_campaign';
  if (input.hasCampaign && input.hasAdGroup) return 'ready';
  return 'credentials_ready';
}

export async function upsertTenantAdAccountProbe(
  supabase: SupabaseClient,
  input: TenantAdAccountProbeInput,
) {
  const normalized = normalizeTenantAdAccountProbe(input);
  const accountMode = input.accountMode || 'agency_managed';
  const now = new Date().toISOString();
  const existingQuery = supabase
    .from('ad_os_tenant_ad_accounts')
    .select('*')
    .eq('platform', input.platform)
    .eq('account_mode', accountMode)
    .limit(1);
  const existingRes = input.tenantId
    ? await existingQuery.eq('tenant_id', input.tenantId)
    : await existingQuery.is('tenant_id', null);

  if (existingRes.error) return { data: null, error: existingRes.error };
  const existing = (existingRes.data?.[0] || null) as Partial<TenantAccountRow> | null;

  const row: TenantAccountRow = {
    tenant_id: normalized.tenantId || null,
    platform: normalized.platform,
    account_mode: accountMode,
    external_account_id: cleanString(normalized.externalAccountId) ?? existing?.external_account_id ?? null,
    external_customer_id: cleanString(normalized.externalCustomerId) ?? existing?.external_customer_id ?? null,
    external_campaign_id: cleanString(normalized.externalCampaignId) ?? existing?.external_campaign_id ?? null,
    external_ad_group_id: cleanString(normalized.externalAdGroupId) ?? existing?.external_ad_group_id ?? null,
    connection_status: normalized.connectionStatus,
    permission_scope: (normalized.permissionScope?.length ? normalized.permissionScope : existing?.permission_scope || []).slice(0, 20),
    monthly_budget_cap_krw: nonNegativeInt(normalized.monthlyBudgetCapKrw ?? existing?.monthly_budget_cap_krw),
    daily_budget_cap_krw: nonNegativeInt(normalized.dailyBudgetCapKrw ?? existing?.daily_budget_cap_krw),
    can_publish_keywords: Boolean(normalized.canPublishKeywords),
    can_change_bids: Boolean(normalized.canChangeBids),
    can_pause_assets: Boolean(normalized.canPauseAssets),
    last_probe_at: now,
    last_probe_result: normalized.lastProbeResult || {},
    risk_status: normalized.riskStatus || (existing?.risk_status as TenantAdAccountProbeInput['riskStatus']) || 'watch',
    notes: cleanString(normalized.notes) ?? existing?.notes ?? null,
    updated_at: now,
  };

  if (existing?.id) {
    return supabase
      .from('ad_os_tenant_ad_accounts')
      .update(row)
      .eq('id', existing.id)
      .select('*')
      .single();
  }

  return supabase
    .from('ad_os_tenant_ad_accounts')
    .insert(row)
    .select('*')
    .single();
}

export async function syncTenantAdAccountBudgetCaps(
  supabase: SupabaseClient,
  input: {
    platform: AdOsPlatform;
    tenantId?: string | null;
    accountMode?: 'agency_managed' | 'tenant_owned' | 'hybrid';
    monthlyBudgetCapKrw: number;
    dailyBudgetCapKrw: number;
  },
) {
  const accountMode = input.accountMode || 'agency_managed';
  const query = supabase
    .from('ad_os_tenant_ad_accounts')
    .update({
      monthly_budget_cap_krw: nonNegativeInt(input.monthlyBudgetCapKrw),
      daily_budget_cap_krw: nonNegativeInt(input.dailyBudgetCapKrw),
      updated_at: new Date().toISOString(),
    })
    .eq('platform', input.platform)
    .eq('account_mode', accountMode);

  const result = input.tenantId
    ? await query.eq('tenant_id', input.tenantId)
    : await query.is('tenant_id', null);

  return result;
}
