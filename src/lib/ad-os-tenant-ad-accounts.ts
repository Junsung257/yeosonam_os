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
    tenant_id: input.tenantId || null,
    platform: input.platform,
    account_mode: accountMode,
    external_account_id: cleanString(input.externalAccountId) ?? existing?.external_account_id ?? null,
    external_customer_id: cleanString(input.externalCustomerId) ?? existing?.external_customer_id ?? null,
    external_campaign_id: cleanString(input.externalCampaignId) ?? existing?.external_campaign_id ?? null,
    external_ad_group_id: cleanString(input.externalAdGroupId) ?? existing?.external_ad_group_id ?? null,
    connection_status: input.connectionStatus,
    permission_scope: (input.permissionScope?.length ? input.permissionScope : existing?.permission_scope || []).slice(0, 20),
    monthly_budget_cap_krw: nonNegativeInt(input.monthlyBudgetCapKrw ?? existing?.monthly_budget_cap_krw),
    daily_budget_cap_krw: nonNegativeInt(input.dailyBudgetCapKrw ?? existing?.daily_budget_cap_krw),
    can_publish_keywords: Boolean(input.canPublishKeywords ?? existing?.can_publish_keywords ?? false),
    can_change_bids: Boolean(input.canChangeBids ?? existing?.can_change_bids ?? false),
    can_pause_assets: Boolean(input.canPauseAssets ?? existing?.can_pause_assets ?? false),
    last_probe_at: now,
    last_probe_result: input.lastProbeResult || {},
    risk_status: input.riskStatus || (existing?.risk_status as TenantAdAccountProbeInput['riskStatus']) || 'watch',
    notes: cleanString(input.notes) ?? existing?.notes ?? null,
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
