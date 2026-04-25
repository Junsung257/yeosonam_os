/**
 * @file competitor-seed.ts — 경쟁사 광고에서 카드뉴스 시드 추출
 *
 * Predis.ai 경쟁사 분석 패턴.
 *
 * 사용처:
 *   - 같은 destination/product_category 의 active_days 긴 (= 성과 좋은) 경쟁사 광고 조회
 *   - 헤드라인 / promo_type 트렌드 추출
 *   - 우리 카드뉴스 생성 시 user 메시지에 "참고 트렌드" 로 주입 (모방 X, 영감만)
 *
 * Faithfulness Rule (A0) 와 충돌 없음 — 경쟁사 카피는 "트렌드 신호" 로만 사용.
 */

import { supabaseAdmin } from '@/lib/supabase';

export interface CompetitorSeed {
  destination_hint: string | null;
  trending_promo_types: string[];      // 자주 보이는 promo_type
  trending_ctas: string[];             // 자주 보이는 CTA 버튼
  best_headlines: string[];            // active_days 긴 광고의 헤드라인 (상위 5개)
  observed_brands: string[];           // 관찰된 경쟁 브랜드 목록
  sample_count: number;
}

interface CompetitorRow {
  brand: string;
  platform: string;
  copy_headline: string | null;
  copy_primary: string | null;
  cta_button: string | null;
  destination_hint: string | null;
  promo_type: string | null;
  active_days: number | null;
}

const MIN_ACTIVE_DAYS = 7;          // 7일 이상 게재된 광고만 (단명 광고는 신뢰도 낮음)
const TOP_HEADLINES = 5;
const LOOKBACK_DAYS = 90;

/**
 * 같은 목적지/카테고리의 우수 경쟁사 광고에서 트렌드 시드 추출.
 */
export async function extractCompetitorSeed(input: {
  destination?: string;
  productCategory?: string;
  excludeOwnBrand?: string;        // 'yeosonam' — 자기 광고 제외
}): Promise<CompetitorSeed> {
  const { destination, productCategory, excludeOwnBrand } = input;
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let query = supabaseAdmin
    .from('competitor_ad_snapshots')
    .select(
      'brand, platform, copy_headline, copy_primary, cta_button, destination_hint, promo_type, active_days',
    )
    .gte('captured_at', cutoff)
    .gte('active_days', MIN_ACTIVE_DAYS)
    .order('active_days', { ascending: false })
    .limit(50);

  if (destination) query = query.ilike('destination_hint', `%${destination}%`);
  if (productCategory) query = query.eq('product_category', productCategory);
  if (excludeOwnBrand) query = query.neq('brand', excludeOwnBrand);

  const { data, error } = await query;
  if (error || !data) {
    return {
      destination_hint: destination ?? null,
      trending_promo_types: [],
      trending_ctas: [],
      best_headlines: [],
      observed_brands: [],
      sample_count: 0,
    };
  }

  const rows = data as CompetitorRow[];

  // 빈도 카운트
  const promoCounts = new Map<string, number>();
  const ctaCounts = new Map<string, number>();
  const brandSet = new Set<string>();
  for (const r of rows) {
    if (r.promo_type) promoCounts.set(r.promo_type, (promoCounts.get(r.promo_type) ?? 0) + 1);
    if (r.cta_button) ctaCounts.set(r.cta_button, (ctaCounts.get(r.cta_button) ?? 0) + 1);
    if (r.brand) brandSet.add(r.brand);
  }

  const topByCount = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k);

  // active_days 가장 긴 5개 헤드라인
  const headlines = rows
    .filter((r) => r.copy_headline && r.copy_headline.trim().length > 0)
    .slice(0, TOP_HEADLINES)
    .map((r) => r.copy_headline!.trim());

  return {
    destination_hint: destination ?? null,
    trending_promo_types: topByCount(promoCounts, 3),
    trending_ctas: topByCount(ctaCounts, 3),
    best_headlines: headlines,
    observed_brands: [...brandSet],
    sample_count: rows.length,
  };
}

/**
 * 카드뉴스 생성기 user 메시지에 첨부할 "참고 트렌드" 블럭으로 변환.
 * Faithfulness 보호 — "참고만, 사실 인용 금지" 명시.
 */
export function formatCompetitorSeedAsPrompt(seed: CompetitorSeed): string {
  if (seed.sample_count === 0) return '';
  const lines: string[] = [];
  lines.push('## 참고 트렌드 (경쟁사 광고 분석 — 영감 only, 사실/숫자 인용 금지)');
  lines.push(`(샘플 ${seed.sample_count}개, 7일+ 게재된 광고만)`);
  if (seed.trending_promo_types.length) {
    lines.push(`- 잘 먹히는 프로모 유형: ${seed.trending_promo_types.join(', ')}`);
  }
  if (seed.trending_ctas.length) {
    lines.push(`- 자주 쓰이는 CTA: ${seed.trending_ctas.join(', ')}`);
  }
  if (seed.best_headlines.length) {
    lines.push('- 장기 게재 헤드라인 패턴 (모방 금지, 톤만 참고):');
    for (const h of seed.best_headlines) lines.push(`  · "${h}"`);
  }
  lines.push('');
  lines.push('⚠️ 위 트렌드는 **분위기·전략 참고**만. 헤드라인 그대로 베끼지 말 것. 우리 원문 사실만 사용.');
  return lines.join('\n');
}
