import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { classifyProbeMessageStatus, upsertTenantAdAccountProbe } from '@/lib/ad-os-tenant-ad-accounts';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import {
  fetchNaverKeywordTool,
  getGoogleAdsConfigStatus,
  getNaverAdsConfigStatus,
} from '@/lib/search-ads-api';
import { resolveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ProbeStatus = 'ready' | 'missing_config' | 'missing_oauth' | 'failed';

function missingKeys(required: Record<string, boolean>): string[] {
  return Object.entries(required)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
}

async function probeNaver(hint: string) {
  const config = getNaverAdsConfigStatus();
  const required = {
    NAVER_ADS_API_KEY: config.apiKey,
    NAVER_ADS_SECRET_KEY: config.secretKey,
    NAVER_ADS_CUSTOMER_ID: config.customerId,
  };

  if (!config.configured) {
    return {
      platform: 'naver',
      status: 'missing_config' as ProbeStatus,
      configured: false,
      missing: missingKeys(required),
      message: '네이버 검색광고 API 키가 부족합니다.',
      sample_count: 0,
    };
  }

  const hintKeywords = Array.from(new Set([
    hint.replace(/\s+/g, ''),
    ...hint.split(/\s+/).filter(Boolean),
    '여행',
  ])).filter((keyword) => keyword.length > 0);
  const sample = await fetchNaverKeywordTool(hintKeywords.slice(0, 5));
  return {
    platform: 'naver',
    status: sample.length > 0 ? 'ready' as ProbeStatus : 'failed' as ProbeStatus,
    configured: true,
    missing: [],
    message: sample.length > 0
      ? `네이버 KeywordTool 호출 성공: ${sample.length.toLocaleString('ko-KR')}개 키워드 확인`
      : '네이버 키는 있으나 KeywordTool 응답이 비어 있거나 호출에 실패했습니다.',
    sample_count: sample.length,
    samples: sample.slice(0, 5).map((row) => ({
      keyword: row.relKeyword,
      pc: row.monthlyPcQcCnt,
      mobile: row.monthlyMobileQcCnt,
      competition: row.compIdx,
    })),
  };
}

async function probeGoogle(hint: string) {
  const config = getGoogleAdsConfigStatus();
  const required = {
    GOOGLE_ADS_DEVELOPER_TOKEN: config.developerToken,
    GOOGLE_ADS_CUSTOMER_ID: config.customerId,
    GOOGLE_ADS_CLIENT_ID: Boolean(getSecret('GOOGLE_ADS_CLIENT_ID')),
    GOOGLE_ADS_CLIENT_SECRET: Boolean(getSecret('GOOGLE_ADS_CLIENT_SECRET')),
  };

  if (missingKeys(required).length > 0) {
    return {
      platform: 'google',
      status: 'missing_config' as ProbeStatus,
      configured: false,
      missing: missingKeys(required),
      message: '구글 광고 계정 연결 정보가 부족합니다.',
      sample_count: 0,
    };
  }

  const token = await resolveOAuthToken('', 'google_ads');
  if (!token?.accessToken) {
    return {
      platform: 'google',
      status: 'missing_oauth' as ProbeStatus,
      configured: true,
      missing: ['google_ads_oauth_token'],
      message: '구글 광고 계정 연결 토큰이 없어 실제 계정 확인은 아직 불가능합니다.',
      sample_count: 0,
    };
  }

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
    const body = sanitizeDbError(await res.text(), '구글 광고 계정 확인 실패');
    return {
      platform: 'google',
      status: 'failed' as ProbeStatus,
      configured: true,
      missing: [],
      message: `구글 광고 계정 확인 실패 (${res.status}): ${body.slice(0, 160)}`,
      sample_count: 0,
    };
  }

  const json = await res.json() as { results?: Array<{ keyword?: string; competition?: string; monthlySearchMetrics?: unknown[] }> };
  return {
    platform: 'google',
    status: 'ready' as ProbeStatus,
    configured: true,
    missing: [],
    message: `구글 광고 검색량 확인 성공: ${(json.results || []).length.toLocaleString('ko-KR')}개 결과`,
    sample_count: json.results?.length || 0,
    samples: (json.results || []).slice(0, 5).map((row) => ({
      keyword: row.keyword,
      competition: row.competition,
      months: row.monthlySearchMetrics?.length || 0,
    })),
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const hint = String(body.hint || '다낭 패키지').trim() || '다낭 패키지';

  const [naver, google] = await Promise.all([
    probeNaver(hint),
    probeGoogle(hint),
  ]);

  const persistedAccounts: unknown[] = [];
  if (isSupabaseConfigured) {
    for (const probe of [naver, google]) {
      const platform = probe.platform as 'naver' | 'google';
      const connectionStatus = classifyProbeMessageStatus({
        platform,
        probeStatus: probe.status,
        message: probe.message,
      });
      const saveRes = await upsertTenantAdAccountProbe(supabaseAdmin, {
        platform,
        connectionStatus,
        externalCustomerId: platform === 'google'
          ? getSecret('GOOGLE_ADS_CUSTOMER_ID') || null
          : getSecret('NAVER_ADS_CUSTOMER_ID') || null,
        permissionScope: platform === 'google'
          ? ['keyword_planning', 'performance_read']
          : ['keyword_tool', 'asset_read'],
        canPublishKeywords: false,
        canChangeBids: false,
        canPauseAssets: false,
        riskStatus: connectionStatus === 'permission_denied' ? 'restricted' : 'watch',
        lastProbeResult: JSON.parse(JSON.stringify(probe)),
        notes: probe.message,
      });
      if (!saveRes.error && saveRes.data) persistedAccounts.push(saveRes.data);
    }
  }

  return apiResponse({
    ok: true,
    hint,
    probes: { naver, google },
    persisted_accounts: persistedAccounts,
    ready_platforms: [naver, google].filter((probe) => probe.status === 'ready').map((probe) => probe.platform),
  });
});
