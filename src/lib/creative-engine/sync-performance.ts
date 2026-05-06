/**
 * ══════════════════════════════════════════════════════════
 * Performance Sync — Meta/네이버/구글 일별 성과 수집
 * ══════════════════════════════════════════════════════════
 * - 활성 소재의 전일 성과를 creative_performance에 저장
 * - 수집 완료 후 updateWinningPatterns() 자동 실행
 */

import { updateWinningPatterns } from './update-patterns';
import { getSecret } from '@/lib/secret-registry';

export async function dailySync(): Promise<{
  meta: number;
  naver: number;
  google: number;
  patterns: { updated: number; skipped: number };
}> {
  const [metaCount, naverCount, googleCount] = await Promise.all([
    syncMeta(),
    syncNaver(),
    syncGoogle(),
  ]);

  // 수집 완료 후 학습 엔진 실행
  const patterns = await updateWinningPatterns();

  return {
    meta: metaCount,
    naver: naverCount,
    google: googleCount,
    patterns,
  };
}

async function syncMeta(): Promise<number> {
  const { supabaseAdmin } = await import('@/lib/supabase');

  const { data: ads } = await supabaseAdmin
    .from('ad_creatives')
    .select('id, meta_ad_id')
    .eq('status', 'active')
    .not('meta_ad_id', 'is', null);

  if (!ads?.length) return 0;

  const accessToken = getSecret('META_ACCESS_TOKEN');
  if (!accessToken) return 0;

  let synced = 0;

  for (const ad of ads) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v18.0/${ad.meta_ad_id}/insights?fields=impressions,clicks,spend,ctr,cpc,reach,frequency,actions,action_values&date_preset=yesterday`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      const d = json.data?.[0];
      if (!d) continue;

      const inquiries = d.actions?.find((a: any) => a.action_type === 'lead')?.value || 0;
      const revenue = d.action_values?.find((a: any) => a.action_type === 'purchase')?.value || 0;
      const spend = parseFloat(d.spend || '0');

      await supabaseAdmin.from('creative_performance').upsert({
        creative_id: ad.id,
        channel: 'meta',
        date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
        impressions: parseInt(d.impressions || '0'),
        clicks: parseInt(d.clicks || '0'),
        ctr: parseFloat(d.ctr || '0'),
        spend,
        cpc: parseFloat(d.cpc || '0'),
        reach: parseInt(d.reach || '0'),
        frequency: parseFloat(d.frequency || '0'),
        inquiries: parseInt(inquiries),
        revenue: parseFloat(revenue),
        roas: spend > 0 ? (parseFloat(revenue) / spend) * 100 : 0,
      }, { onConflict: 'creative_id,channel,date' });

      synced++;
    } catch (err) {
      console.warn(`[syncMeta] ${ad.id} 실패:`, err instanceof Error ? err.message : err);
    }
  }

  return synced;
}

async function syncNaver(): Promise<number> {
  // 네이버 검색광고 API 연동 시 구현
  // 현재: 0 반환 (미연동)
  return 0;
}

async function syncGoogle(): Promise<number> {
  // Google Ads API 연동 시 구현
  // 현재: 0 반환 (미연동)
  return 0;
}
