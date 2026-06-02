import {
  buildChannelAdapterCapability,
  type AdapterCapability,
  type AdOsAdapterPlatform,
} from '@/lib/ad-os-v76-v85';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';

type BudgetRow = {
  platform: string | null;
  status?: string | null;
  monthly_budget_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  max_cpc_krw?: number | null;
  automation_level?: number | null;
  external_campaign_id?: string | null;
  external_ad_group_id?: string | null;
};

type AccountRow = {
  tenant_id?: string | null;
  platform: string | null;
  connection_status?: string | null;
  external_campaign_id?: string | null;
  external_ad_group_id?: string | null;
  can_publish_keywords?: boolean | null;
  can_change_bids?: boolean | null;
  can_pause_assets?: boolean | null;
};

type UploadJobRow = {
  platform: string | null;
  status?: string | null;
};

const PLATFORMS: AdOsAdapterPlatform[] = ['naver', 'google', 'meta', 'kakao'];

function hasAllSecrets(names: string[]): boolean {
  return names.every((name) => Boolean(getSecret(name as never)));
}

function hasAnySecret(names: string[]): boolean {
  return names.some((name) => Boolean(getSecret(name as never)));
}

function credentialsReady(platform: AdOsAdapterPlatform): boolean {
  if (platform === 'naver') return hasAllSecrets(['NAVER_ADS_API_KEY', 'NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID']);
  if (platform === 'google') {
    return hasAllSecrets(['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID']) &&
      hasAnySecret(['GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CLIENT_ID']);
  }
  if (platform === 'meta') return hasAnySecret(['META_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN']) && hasAllSecrets(['META_AD_ACCOUNT_ID']);
  return false;
}

export async function loadAdapterCapabilities(): Promise<AdapterCapability[]> {
  const [budgetRes, accountRes, uploadRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('platform,status,monthly_budget_krw,daily_budget_cap_krw,max_cpc_krw,automation_level,external_campaign_id,external_ad_group_id'),
    supabaseAdmin
      .from('ad_os_tenant_ad_accounts')
      .select('tenant_id,platform,connection_status,external_campaign_id,external_ad_group_id,can_publish_keywords,can_change_bids,can_pause_assets'),
    supabaseAdmin
      .from('ad_os_conversion_upload_jobs')
      .select('platform,status')
      .in('status', ['planned', 'approved', 'uploaded'])
      .limit(100),
  ]);

  const firstError = budgetRes.error || accountRes.error || uploadRes.error;
  if (firstError) throw new Error(firstError.message);

  const budgets = (budgetRes.data || []) as BudgetRow[];
  const accounts = (accountRes.data || []) as AccountRow[];
  const uploadJobs = (uploadRes.data || []) as UploadJobRow[];

  return PLATFORMS.map((platform) => {
    const budget = budgets.find((row) => row.platform === platform);
    const account = accounts.find((row) => row.platform === platform);
    const conversionReady = platform === 'google' || platform === 'meta'
      ? uploadJobs.some((row) => row.platform === platform)
      : false;

    return buildChannelAdapterCapability({
      platform,
      tenantId: account?.tenant_id || null,
      credentialsReady: credentialsReady(platform),
      connectionStatus: account?.connection_status || null,
      externalCampaignId: budget?.external_campaign_id || account?.external_campaign_id || null,
      externalAdGroupId: budget?.external_ad_group_id || account?.external_ad_group_id || null,
      budgetStatus: budget?.status || null,
      monthlyBudgetKrw: budget?.monthly_budget_krw || null,
      dailyBudgetCapKrw: budget?.daily_budget_cap_krw || null,
      maxCpcKrw: budget?.max_cpc_krw || null,
      automationLevel: budget?.automation_level || 0,
      canPublishKeywords: account?.can_publish_keywords ?? true,
      canChangeBids: account?.can_change_bids ?? false,
      canPauseAssets: account?.can_pause_assets ?? false,
      conversionReady,
      fullAutoEnabled: false,
      livePublishEnabled: false,
    });
  });
}

export function adapterHealthRows(capabilities: AdapterCapability[]) {
  return capabilities.map((capability) => ({
    tenant_id: capability.tenant_id,
    platform: capability.platform,
    adapter_state: capability.adapter_state,
    capability_level: capability.capability_level,
    credentials_ready: capability.credentials_ready,
    permission_ready: capability.permission_ready,
    campaign_ready: capability.campaign_ready,
    budget_ready: capability.budget_ready,
    conversion_ready: capability.conversion_ready,
    live_publish_enabled: capability.live_publish_enabled,
    external_api_write: false,
    blocked_reasons: capability.blocked_reasons,
    capabilities: capability.capabilities,
    recommended_action: capability.recommended_action,
  }));
}
