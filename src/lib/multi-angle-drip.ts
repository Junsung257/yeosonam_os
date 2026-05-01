/**
 * Multi-Angle Drip — 1 신규 상품 → 5+ 각도 자동 큐잉, N일 간격 분산
 *
 * 목적:
 *   "다양한 시각으로 키워드 잡고 노출 극대화" 정책.
 *   1상품 → value/emotional/activity/urgency/filial 5각도 → 3일 간격 분산.
 *
 * SEO 보호:
 *   - 같은 (destination,angle_type) 14일 윈도 dedup → blog-quality-gate가 차단
 *   - per_destination_daily_cap → assignPublishSlots에서 자동 throttle
 *
 * 호출처:
 *   - /api/packages/[id]/approve 엔드포인트 (상품 승인 시)
 *   - blog-scheduler 주간 refill 시 fresh products 보강용
 */

import { supabaseAdmin } from './supabase';
import { getActivePolicy } from './blog-scheduler';
import type { AngleType } from './content-generator';
import { researchKeywordsBatch, classifyKeywordTier } from './keyword-research';

interface PackageRow {
  id: string;
  destination: string | null;
  title: string | null;
  duration: number | null;
  product_type: string | null;
  hero_tagline?: string | null;
}

/**
 * 상품 특성에 따라 적합한 5 angle 선택.
 * 같은 angle 5번 발행하면 카니발이지만, 다른 angle 5개 = SEO에 안전한 다중 노출.
 */
export function selectAnglesForProduct(pkg: PackageRow, count: number = 5): AngleType[] {
  const title = (pkg.title || '').toLowerCase();
  const productType = (pkg.product_type || '').toLowerCase();
  const text = `${title} ${productType}`;

  // 상품 특성 감지
  const isFilial = /효도|부모|어버이/.test(text);
  const isHoneymoon = /신혼|허니문|커플/.test(text);
  const isFamily = /가족|어린이|키즈/.test(text);
  const isGolf = /골프/.test(text);
  const isLuxury = /프리미엄|품격|5성|특급/.test(text);
  const isNoShop = /노쇼핑|노옵션|노팁/.test(text);

  // 우선순위 angle 매트릭스
  let angles: AngleType[];
  if (isFilial) {
    angles = ['filial', 'value', 'emotional', 'activity', 'urgency', 'food'];
  } else if (isHoneymoon) {
    angles = ['emotional', 'luxury', 'activity', 'urgency', 'value', 'food'];
  } else if (isFamily) {
    angles = ['filial', 'value', 'food', 'activity', 'emotional', 'urgency'];
  } else if (isGolf) {
    angles = ['activity', 'luxury', 'value', 'urgency', 'emotional', 'filial'];
  } else if (isLuxury) {
    angles = ['luxury', 'emotional', 'value', 'activity', 'urgency', 'food'];
  } else if (isNoShop) {
    angles = ['value', 'urgency', 'emotional', 'activity', 'filial', 'food'];
  } else {
    angles = ['value', 'emotional', 'activity', 'urgency', 'filial', 'food'];
  }

  return angles.slice(0, count);
}

/**
 * angle 별 토픽 + primary_keyword 생성기
 */
function buildAngleTopic(pkg: PackageRow, angle: AngleType): { topic: string; primaryKeyword: string } {
  const dest = pkg.destination || '';
  const title = pkg.title || '패키지';
  const dur = pkg.duration ? `${pkg.duration - 1}박${pkg.duration}일` : '';

  const map: Record<AngleType, { topic: string; kw: string }> = {
    value:     { topic: `${dest} ${title} 가성비 분석 — 시중가 vs 패키지가`, kw: `${dest} 패키지 가격` },
    emotional: { topic: `${dest} ${title} — 다녀온 사람들이 가장 인상 깊다고 한 순간`, kw: `${dest} 여행 후기` },
    filial:    { topic: `${dest} 효도여행으로 ${title} — 부모님 모시고 갈 만한지`, kw: `${dest} 효도여행` },
    luxury:    { topic: `${dest} ${title} 프리미엄 옵션과 일반 비교`, kw: `${dest} 프리미엄 패키지` },
    urgency:   { topic: `${dest} ${dur || '4박5일'} 출발 확정일 — 지금 예약 가능한 일정`, kw: `${dest} 특가` },
    activity:  { topic: `${dest} ${title} 일정 속 핵심 액티비티 분석`, kw: `${dest} 액티비티` },
    food:      { topic: `${dest} ${title} 식사·맛집 — 패키지 포함 메뉴 검토`, kw: `${dest} 맛집` },
  };

  return { topic: map[angle].topic, primaryKeyword: map[angle].kw };
}

export interface DripResult {
  product_id: string;
  queued: number;
  skipped: number;
  errors: string[];
  schedule: Array<{ angle: AngleType; topic: string; target_publish_at: string }>;
}

/**
 * 신규 상품 1개 → multi-angle drip 큐잉 (정책 기반)
 *
 * @param productId travel_packages.id
 * @param opts.startOffsetDays 첫 발행까지 지연 (기본 0 = 다음 슬롯)
 */
export async function enqueueMultiAngleDrip(
  productId: string,
  opts?: { startOffsetDays?: number; tenantId?: string | null },
): Promise<DripResult> {
  const result: DripResult = { product_id: productId, queued: 0, skipped: 0, errors: [], schedule: [] };

  // 상품 로드
  const { data: pkgs, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, title, duration, product_type, hero_tagline')
    .eq('id', productId)
    .limit(1);
  if (error || !pkgs?.[0]) {
    result.errors.push(`상품 조회 실패: ${error?.message ?? 'not found'}`);
    return result;
  }
  const pkg = pkgs[0] as PackageRow;
  if (!pkg.destination) {
    result.errors.push('destination 없음 — drip 스킵');
    return result;
  }

  const policy = await getActivePolicy('global');
  const count = policy.multi_angle_count;
  const gapDays = policy.multi_angle_gap_days;
  const angles = selectAnglesForProduct(pkg, count);

  // 14일 내 같은 product_id 큐 이력 (중복 방어)
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const { data: recent } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('angle_type')
    .eq('product_id', productId)
    .gte('created_at', since.toISOString());
  const usedAngles = new Set(((recent || []) as Array<{ angle_type: string | null }>).map(r => r.angle_type));

  // 이용 가능 angle 필터
  const freshAngles = angles.filter(a => !usedAngles.has(a));
  if (freshAngles.length === 0) {
    result.skipped = count;
    return result;
  }

  // 각 angle의 primary_keyword 일괄 리서치
  const topics = freshAngles.map(a => buildAngleTopic(pkg, a));
  const research = await researchKeywordsBatch(topics.map(t => t.primaryKeyword)).catch(() => new Map());

  const startOffsetDays = opts?.startOffsetDays ?? 0;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + startOffsetDays);

  const rows: any[] = [];
  for (let i = 0; i < freshAngles.length; i++) {
    const angle = freshAngles[i];
    const t = topics[i];
    const r = research.get(t.primaryKeyword);
    const tier = r?.tier ?? classifyKeywordTier(t.primaryKeyword);

    const targetDate = new Date(startDate);
    targetDate.setDate(targetDate.getDate() + i * gapDays);

    rows.push({
      topic: t.topic,
      source: 'product',
      priority: 80,
      destination: pkg.destination,
      angle_type: angle,
      product_id: productId,
      tenant_id: opts?.tenantId ?? null,
      category: 'product_intro',
      primary_keyword: t.primaryKeyword,
      keyword_tier: tier,
      monthly_search_volume: r?.monthly_search_volume ?? null,
      competition_level: r?.competition_level ?? (tier === 'head' ? 'high' : tier === 'mid' ? 'medium' : 'low'),
      // target_publish_at은 assignPublishSlots에 위임 (per_destination_daily_cap 자동 적용)
      // 단, drip 의도(N일 분산)는 priority로 살짝 차등 줌
      meta: {
        product_title: pkg.title,
        drip_angle_index: i,
        drip_angle_total: freshAngles.length,
        drip_target_date: targetDate.toISOString().split('T')[0],
      },
    });
  }

  if (rows.length === 0) return result;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(rows)
    .select('id, angle_type, topic, target_publish_at');

  if (insErr) {
    result.errors.push(`INSERT 실패: ${insErr.message}`);
    return result;
  }

  result.queued = inserted?.length ?? 0;
  result.skipped = count - result.queued;
  result.schedule = (inserted || []).map((row: any) => ({
    angle: row.angle_type,
    topic: row.topic,
    target_publish_at: row.target_publish_at ?? '미배정 (다음 assignPublishSlots에서 배정)',
  }));

  return result;
}
