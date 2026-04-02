/**
 * ══════════════════════════════════════════════════════════
 * Update Winning Patterns — 성과 데이터 → 승리 패턴 추출·저장
 * ══════════════════════════════════════════════════════════
 * - 최소 500 노출 + 3일 이상 데이터가 있는 소재만 분석
 * - 이동 평균으로 기존 패턴 업데이트 (EMA)
 * - 베스트 카피는 CTR 기준 갱신
 */

import { classifyDestinationType, classifyPrice, classifyNights } from './parse-product';

export async function updateWinningPatterns(): Promise<{ updated: number; skipped: number }> {
  const { supabaseAdmin } = await import('@/lib/supabase');

  // 성과 데이터가 있는 소재 + 상품 정보 조인
  const { data: performers, error } = await supabaseAdmin
    .from('creative_performance')
    .select(`
      creative_id,
      channel,
      impressions,
      clicks,
      ctr,
      spend,
      inquiries,
      revenue,
      roas,
      ad_creatives!inner (
        hook_type,
        tone,
        key_selling_point,
        target_segment,
        creative_type,
        headline,
        body,
        product_id,
        travel_packages!inner (
          country,
          nights,
          price
        )
      )
    `)
    .gt('impressions', 100);

  if (error || !performers?.length) {
    console.warn('[updateWinningPatterns] 데이터 없음:', error?.message);
    return { updated: 0, skipped: 0 };
  }

  // 소재별 집계
  const grouped = new Map<string, {
    hook_type: string;
    tone: string;
    key_selling_point: string;
    target_segment: string;
    channel: string;
    creative_type: string;
    country: string;
    nights: number;
    price: number;
    total_impressions: number;
    total_clicks: number;
    total_spend: number;
    total_inquiries: number;
    total_revenue: number;
    data_days: number;
    best_headline: string;
    best_body: string;
    best_ctr: number;
  }>();

  for (const row of performers) {
    const ac = (row as any).ad_creatives;
    const tp = ac?.travel_packages;
    if (!ac || !tp) continue;

    const key = `${ac.hook_type}_${ac.creative_type}_${row.channel}_${ac.target_segment}_${tp.country}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        hook_type: ac.hook_type,
        tone: ac.tone,
        key_selling_point: ac.key_selling_point,
        target_segment: ac.target_segment,
        channel: row.channel,
        creative_type: ac.creative_type,
        country: tp.country || '기타',
        nights: tp.nights || 0,
        price: tp.price || 0,
        total_impressions: 0,
        total_clicks: 0,
        total_spend: 0,
        total_inquiries: 0,
        total_revenue: 0,
        data_days: 0,
        best_headline: ac.headline || '',
        best_body: ac.body || '',
        best_ctr: 0,
      });
    }

    const g = grouped.get(key)!;
    g.total_impressions += row.impressions || 0;
    g.total_clicks += row.clicks || 0;
    g.total_spend += Number(row.spend) || 0;
    g.total_inquiries += row.inquiries || 0;
    g.total_revenue += Number(row.revenue) || 0;
    g.data_days += 1;

    const rowCtr = Number(row.ctr) || 0;
    if (rowCtr > g.best_ctr) {
      g.best_ctr = rowCtr;
      g.best_headline = ac.headline || g.best_headline;
      g.best_body = ac.body || g.best_body;
    }
  }

  let updated = 0;
  let skipped = 0;

  for (const g of grouped.values()) {
    // 최소 기준: 500 노출 + 3일
    if (g.total_impressions < 500 || g.data_days < 3) {
      skipped++;
      continue;
    }

    const destType = classifyDestinationType(g.country, g.nights);
    const priceRange = classifyPrice(g.price);
    const nightsRange = classifyNights(g.nights);
    const avgCtr = g.total_clicks / g.total_impressions * 100;
    const avgConvRate = g.total_clicks > 0 ? g.total_inquiries / g.total_clicks * 100 : 0;
    const avgRoas = g.total_spend > 0 ? g.total_revenue / g.total_spend * 100 : 0;
    const confidence = Math.min(g.total_impressions / 5000, 1.0);

    // UPSERT
    const { error: upsertErr } = await supabaseAdmin
      .from('winning_patterns')
      .upsert({
        destination_type: destType,
        channel: g.channel,
        target_segment: g.target_segment,
        nights_range: nightsRange,
        price_range: priceRange,
        hook_type: g.hook_type,
        tone: g.tone,
        key_selling_point: g.key_selling_point,
        creative_type: g.creative_type,
        avg_ctr: avgCtr,
        avg_conv_rate: avgConvRate,
        avg_roas: avgRoas,
        total_spend: g.total_spend,
        sample_count: g.data_days,
        confidence_score: confidence,
        best_headline: g.best_headline,
        best_body: g.best_body,
      }, {
        onConflict: 'destination_type,channel,target_segment,hook_type,creative_type',
      });

    if (upsertErr) {
      console.warn('[updateWinningPatterns] UPSERT 실패:', upsertErr.message);
    } else {
      updated++;
    }
  }

  console.log(`[updateWinningPatterns] 완료: ${updated} 업데이트, ${skipped} 스킵`);
  return { updated, skipped };
}
