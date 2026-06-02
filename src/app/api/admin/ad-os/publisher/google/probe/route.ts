import { NextRequest, NextResponse } from 'next/server';
import { classifyProbeMessageStatus, upsertTenantAdAccountProbe } from '@/lib/ad-os-tenant-ad-accounts';
import { withAdminGuard } from '@/lib/admin-guard';
import { resolveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { getSecret } from '@/lib/secret-registry';
import { getGoogleAdsConfigStatus } from '@/lib/search-ads-api';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function missingKeys(required: Record<string, boolean>): string[] {
  return Object.entries(required).filter(([, ok]) => !ok).map(([key]) => key);
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const hint = String(body.hint || '다낭 패키지').trim() || '다낭 패키지';
  const config = getGoogleAdsConfigStatus();
  const required = {
    GOOGLE_ADS_DEVELOPER_TOKEN: config.developerToken,
    GOOGLE_ADS_CUSTOMER_ID: config.customerId,
    GOOGLE_ADS_CLIENT_ID: Boolean(getSecret('GOOGLE_ADS_CLIENT_ID')),
    GOOGLE_ADS_CLIENT_SECRET: Boolean(getSecret('GOOGLE_ADS_CLIENT_SECRET')),
  };
  const missing = missingKeys(required);

  let probe: {
    platform: 'google';
    status: 'missing_config' | 'missing_oauth' | 'permission_denied' | 'ready' | 'failed';
    configured: boolean;
    missing: string[];
    message: string;
    next_action: string;
    sample_count: number;
    samples?: unknown[];
  };

  if (missing.length > 0) {
    probe = {
      platform: 'google',
      status: 'missing_config',
      configured: false,
      missing,
      message: 'Google Ads API 설정값이 부족합니다.',
      next_action: 'Developer token, customer id, OAuth client id/secret을 먼저 연결하세요.',
      sample_count: 0,
    };
  } else {
    const token = await resolveOAuthToken('', 'google_ads');
    if (!token?.accessToken) {
      probe = {
        platform: 'google',
        status: 'missing_oauth',
        configured: true,
        missing: ['google_ads_oauth_token'],
        message: 'Google Ads OAuth 토큰이 없어 실제 계정 호출은 아직 불가능합니다.',
        next_action: 'Google Ads OAuth refresh token을 테넌트 토큰 저장소에 연결하세요.',
        sample_count: 0,
      };
    } else {
      const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID')?.replace(/-/g, '') ?? '';
      const version = process.env.GOOGLE_ADS_API_VERSION ?? 'v22';
      const res = await fetch(`https://googleads.googleapis.com/${version}/customers/${customerId}:generateKeywordHistoricalMetrics`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'developer-token': getSecret('GOOGLE_ADS_DEVELOPER_TOKEN') || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keywords: [hint],
          geoTargetConstants: ['geoTargetConstants/1002236'],
          language: 'languageConstants/1026',
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        const permissionDenied = res.status === 403 || /PERMISSION_DENIED/i.test(text);
        probe = {
          platform: 'google',
          status: permissionDenied ? 'permission_denied' : 'failed',
          configured: true,
          missing: [],
          message: `Google Ads 호출 실패 (${res.status}): ${text.slice(0, 180)}`,
          next_action: permissionDenied
            ? 'OAuth scope, customer id 권한, developer token 접근 레벨, conversion action 권한을 확인하세요.'
            : 'Google Ads API 응답을 확인하고 customer/developer token 설정을 재점검하세요.',
          sample_count: 0,
        };
      } else {
        const json = await res.json() as { results?: Array<{ keyword?: string; competition?: string; monthlySearchMetrics?: unknown[] }> };
        probe = {
          platform: 'google',
          status: 'ready',
          configured: true,
          missing: [],
          message: `Google Ads historical metrics 호출 성공: ${(json.results || []).length.toLocaleString('ko-KR')}개 결과`,
          next_action: 'Conversion action과 최종 URL 정책을 확인한 뒤 draft/paused publisher를 연결하세요.',
          sample_count: json.results?.length || 0,
          samples: (json.results || []).slice(0, 5),
        };
      }
    }
  }

  let persistedAccount = null;
  if (isSupabaseConfigured) {
    const connectionStatus = classifyProbeMessageStatus({
      platform: 'google',
      probeStatus: probe.status === 'permission_denied' ? 'failed' : probe.status,
      message: probe.message,
    });
    const saveRes = await upsertTenantAdAccountProbe(supabaseAdmin, {
      platform: 'google',
      connectionStatus,
      externalCustomerId: getSecret('GOOGLE_ADS_CUSTOMER_ID') || null,
      permissionScope: ['keyword_planning', 'performance_read', 'conversion_action_probe'],
      canPublishKeywords: false,
      canChangeBids: false,
      canPauseAssets: false,
      riskStatus: connectionStatus === 'permission_denied' ? 'restricted' : 'watch',
      lastProbeResult: JSON.parse(JSON.stringify(probe)),
      notes: probe.next_action,
    });
    persistedAccount = saveRes.data || null;
  }

  return NextResponse.json({
    ok: true,
    probe,
    channel_state: probe.status === 'ready' ? 'integration_ready' : probe.status,
    persisted_account: persistedAccount,
  });
});
