/**
 * AdAccount 자동 시드 — 플랫폼 키가 등록되어 있는데 ad_accounts row 가 없으면 자동 INSERT.
 *
 * 사장님이 환경변수만 등록해도 ad-optimizer cron 의 잔액 동기화 + 알림이 즉시 작동하도록.
 * 매 cron 실행 시 sync 함수가 호출되어 새로 등록된 플랫폼 자동 감지.
 *
 * 멱등성: ON CONFLICT DO NOTHING (platform + account_name 조합 unique 가정).
 */

import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { isMetaConfigured } from '@/lib/meta-api';
import { isNaverAdsConfigured, isGoogleAdsConfigured } from '@/lib/search-ads-api';
import { getSecret } from '@/lib/secret-registry';

const DEFAULT_LOW_BALANCE_KRW = 50_000;
const DEFAULT_DAILY_BUDGET_KRW: Record<string, number> = {
  meta: 150_000,
  naver: 300_000,
  google: 200_000,
};

interface SeedEntry {
  platform: 'meta' | 'naver' | 'google';
  enabled: boolean;
  accountName: string;
}

export async function autoSeedAdAccounts(): Promise<{
  seeded: number;
  skippedExisting: number;
  details: string[];
}> {
  if (!isSupabaseConfigured) {
    return { seeded: 0, skippedExisting: 0, details: ['Supabase 미설정 — skip'] };
  }

  const entries: SeedEntry[] = [
    {
      platform: 'meta',
      enabled: isMetaConfigured(),
      accountName: getSecret('META_AD_ACCOUNT_ID') ?? '여소남_meta',
    },
    {
      platform: 'naver',
      enabled: isNaverAdsConfigured(),
      accountName: `naver_${getSecret('NAVER_AD_CUSTOMER_ID') ?? 'default'}`,
    },
    {
      platform: 'google',
      enabled: isGoogleAdsConfigured(),
      accountName: `google_${getSecret('GOOGLE_ADS_CUSTOMER_ID') ?? 'default'}`,
    },
  ];

  let seeded = 0;
  let skippedExisting = 0;
  const details: string[] = [];

  for (const entry of entries) {
    if (!entry.enabled) {
      details.push(`[${entry.platform}] 키 미설정 — skip`);
      continue;
    }

    // 기존 row 확인 (platform 단위, 멀티 계정은 향후 확장)
    const { data: existing } = await supabaseAdmin
      .from('ad_accounts')
      .select('id, account_name')
      .eq('platform', entry.platform)
      .eq('is_active', true)
      .limit(1);

    if (existing && existing.length > 0) {
      skippedExisting++;
      details.push(`[${entry.platform}] 이미 등록됨 — ${(existing[0] as { account_name?: string }).account_name}`);
      continue;
    }

    // 신규 INSERT
    const { error } = await supabaseAdmin
      .from('ad_accounts')
      .insert({
        platform: entry.platform,
        account_name: entry.accountName,
        current_balance: 0, // 첫 cron 사이클에서 실제 동기화
        daily_budget: DEFAULT_DAILY_BUDGET_KRW[entry.platform] ?? 100_000,
        low_balance_threshold: DEFAULT_LOW_BALANCE_KRW,
        is_active: true,
      } as never);

    if (error) {
      details.push(`[${entry.platform}] INSERT 실패: ${error.message}`);
    } else {
      seeded++;
      details.push(`[${entry.platform}] ✓ 자동 시드 — ${entry.accountName}`);
    }
  }

  return { seeded, skippedExisting, details };
}
