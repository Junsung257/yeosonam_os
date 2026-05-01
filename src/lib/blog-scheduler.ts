/**
 * 블로그 스케줄러 — 발행 캘린더 자동 생성
 *
 * 책임:
 *   1) 매주 월 0시: 이번 주 토픽 N개 큐 충전 (시즌 + 갭 + 상품신규)
 *   2) 매일 0시: 오늘 발행할 6개 슬롯에 큐 항목 배정 (target_publish_at 설정)
 *
 * 발행 스케줄: 하루 6개, 08/11/13/15/17/20 KST
 * 비율: 상품 30% + 정보성 70% (주간 기준)
 *
 * Priority 규칙:
 *   user_seed = 90 (최우선)
 *   product   = 80 (신규 상품은 발행일 임박)
 *   seasonal  = 60
 *   coverage  = 40
 */

import { supabaseAdmin } from './supabase';
import { pickSeasonalTopics, generateNextQuarterTopics } from './blog-seasonal-calendar';
import { analyzeCoverageGaps } from './blog-coverage-analyzer';
import { researchKeywordsBatch, classifyKeywordTier, type KeywordTier } from './keyword-research';

// fallback (DB 정책 없을 때) — publishing_policies.scope='global' 우선
export const DAILY_PUBLISH_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];

export const DEFAULT_POSTS_PER_DAY = 8;
export const PRODUCT_RATIO = 0.4; // 40% — multi-angle drip 도입으로 상품 비중 상향

export interface PublishingPolicy {
  scope: string;
  posts_per_day: number;
  per_destination_daily_cap: number;
  slot_times: string[];
  product_ratio: number;
  multi_angle_count: number;
  multi_angle_gap_days: number;
  auto_trigger_card_news?: boolean;
  auto_trigger_orchestrator?: boolean;
  auto_regenerate_underperformers?: boolean;
  daily_summary_webhook?: string | null;
}

export async function getActivePolicy(scope: string = 'global'): Promise<PublishingPolicy> {
  try {
    const { data } = await supabaseAdmin
      .from('publishing_policies')
      .select('*')
      .eq('scope', scope)
      .eq('enabled', true)
      .limit(1);
    if (data?.[0]) return data[0] as PublishingPolicy;
  } catch { /* fallback */ }
  return {
    scope: 'global',
    posts_per_day: DEFAULT_POSTS_PER_DAY,
    per_destination_daily_cap: 2,
    slot_times: DAILY_PUBLISH_SLOTS,
    product_ratio: PRODUCT_RATIO,
    multi_angle_count: 5,
    multi_angle_gap_days: 3,
  };
}

function kstToUtcIso(yyyyMmDd: string, hhmm: string): string {
  // KST(+09:00) 기준 로컬을 UTC ISO 로 변환
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const kstDate = new Date(Date.UTC(y, m - 1, d, hh - 9, mm, 0));
  return kstDate.toISOString();
}

/**
 * 이번 주 큐를 채운다 — 매주 월 0시 실행
 */
export async function refillWeeklyQueue(opts?: { postsPerDay?: number }): Promise<{
  seasonal_added: number;
  coverage_added: number;
  product_added: number;
  total_added: number;
}> {
  const policy = await getActivePolicy('global');
  const postsPerDay = opts?.postsPerDay ?? policy.posts_per_day;
  const weeklyTarget = postsPerDay * 7;
  const productTarget = Math.floor(weeklyTarget * policy.product_ratio);
  const infoTarget = weeklyTarget - productTarget;

  // 시즌 캘린더가 비어있으면 채우기
  await generateNextQuarterTopics().catch(e => console.warn('[scheduler] 시즌 생성 실패:', e));

  let seasonalAdded = 0;
  let coverageAdded = 0;
  let productAdded = 0;

  // --- 정보성: 시즌 60% + 갭 40%
  const seasonalTarget = Math.ceil(infoTarget * 0.6);
  const coverageTarget = infoTarget - seasonalTarget;

  // 시즌 토픽 뽑기 — 단일 batch INSERT + 키워드 리서치
  const seasonals = await pickSeasonalTopics(seasonalTarget);
  if (seasonals.length > 0) {
    // 시즌 토픽의 첫 키워드를 primary로 일괄 리서치
    const primaryKeywords = seasonals.map(s => (s.keywords?.[0] || s.topic.split(' ').slice(0, 3).join(' ')));
    const research = await researchKeywordsBatch(primaryKeywords).catch(() => new Map());

    const seasonalRows = seasonals.map((s, idx) => {
      const pk = primaryKeywords[idx];
      const r = research.get(pk);
      return {
        topic: s.topic,
        source: 'seasonal',
        priority: 60,
        destination: s.destination ?? null,
        category: inferCategoryFromSeasonal(s.topic),
        primary_keyword: pk,
        keyword_tier: r?.tier ?? classifyKeywordTier(pk),
        monthly_search_volume: r?.monthly_search_volume ?? null,
        competition_level: r?.competition_level ?? null,
        meta: { keywords: s.keywords, season_tag: s.season_tag },
      };
    });
    const { data: inserted, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .insert(seasonalRows)
      .select('topic');
    if (!error) {
      const insertedTopics = new Set((inserted ?? []).map((r: { topic: string }) => r.topic));
      const usedSeasonals = seasonals.filter(s => insertedTopics.has(s.topic));
      seasonalAdded = usedSeasonals.length;
      // 캘린더 사용 표시 — 월별 그룹 단위 1쿼리로 묶음
      const byMonth = new Map<string, string[]>();
      for (const s of usedSeasonals) {
        const arr = byMonth.get(s.year_month) ?? [];
        arr.push(s.topic);
        byMonth.set(s.year_month, arr);
      }
      const usedAt = new Date().toISOString();
      await Promise.all(
        Array.from(byMonth.entries()).map(([year_month, topics]) =>
          supabaseAdmin
            .from('blog_seasonal_calendar')
            .update({ used: true, used_at: usedAt })
            .eq('year_month', year_month)
            .in('topic', topics)
        )
      );
    }
  }

  // 커버리지 갭 — 단일 batch INSERT + 키워드 리서치 (mid tier 기본)
  const gaps = await analyzeCoverageGaps({ maxPerDestination: 2 });
  const toAddGaps = gaps.slice(0, coverageTarget);
  if (toAddGaps.length > 0) {
    // 갭은 "{dest} 비자", "{dest} 날씨" 같은 mid 키워드
    const gapKeywords = toAddGaps.map(g => g.topic.replace(/ 완벽 체크리스트| 완벽 가이드| 총정리| 가이드$/g, '').trim());
    const research = await researchKeywordsBatch(gapKeywords).catch(() => new Map());

    const gapRows = toAddGaps.map((g, idx) => {
      const pk = gapKeywords[idx];
      const r = research.get(pk);
      return {
        topic: g.topic,
        source: 'coverage_gap',
        priority: 40,
        destination: g.destination,
        category: g.category,
        primary_keyword: pk,
        keyword_tier: r?.tier ?? 'mid',
        monthly_search_volume: r?.monthly_search_volume ?? null,
        competition_level: r?.competition_level ?? 'medium',
        meta: { expected_slug: g.slug_suffix },
      };
    });
    const { data: inserted, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .insert(gapRows)
      .select('topic');
    if (!error) coverageAdded = (inserted ?? []).length;
  }

  // --- 상품: 최근 7일 내 approved 됐는데 아직 블로그 없는 상품
  // ticketing_deadline 포함 — 발권기한 있는 상품은 별도 우선 처리
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data: freshProducts } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, title, created_at, ticketing_deadline')
    .in('status', ['approved', 'active'])
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(productTarget * 2);

  type PkgRow = {
    id: string;
    destination: string | null;
    title: string | null;
    created_at: string;
    ticketing_deadline: string | null;
  };
  const productIds = ((freshProducts || []) as PkgRow[]).map((p) => p.id);

  // 1) content_creatives 에 이미 발행/예약/초안 있는 product_id 제외
  let existingProductBlogs = new Set<string>();
  if (productIds.length > 0) {
    const { data: existing } = await supabaseAdmin
      .from('content_creatives')
      .select('product_id')
      .in('product_id', productIds)
      .eq('channel', 'naver_blog')
      .in('status', ['published', 'scheduled', 'draft']);
    existingProductBlogs = new Set(
      ((existing || []) as Array<{ product_id: string | null }>)
        .map((e) => e.product_id)
        .filter((id): id is string => Boolean(id))
    );
  }

  // 2) blog_topic_queue 에 이미 queued/generating 중인 product_id 제외 (중복 방지)
  let alreadyQueuedProductIds = new Set<string>();
  if (productIds.length > 0) {
    const { data: inQueue } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('product_id')
      .in('product_id', productIds)
      .in('status', ['queued', 'generating']);
    alreadyQueuedProductIds = new Set(
      ((inQueue || []) as Array<{ product_id: string | null }>)
        .map((e) => e.product_id)
        .filter((id): id is string => Boolean(id))
    );
  }

  const eligibleProducts = ((freshProducts || []) as PkgRow[])
    .filter((p) => !existingProductBlogs.has(p.id) && !alreadyQueuedProductIds.has(p.id))
    .slice(0, productTarget);

  if (eligibleProducts.length > 0) {
    const today = new Date();
    // 상품 블로그는 longtail — "{출발지+}부산출발 다낭 4박5일 가성비 리뷰"
    const productRows = eligibleProducts.map(p => {
      const pk = `${p.destination || ''} ${p.title || '패키지'}`.trim();

      // 발권기한 있는 상품: 발권기한 15일 전을 목표 발행일로, priority 상향
      let rowPriority = 80;
      let targetPublishAt: string | undefined = undefined;
      if (p.ticketing_deadline) {
        const deadline = new Date(p.ticketing_deadline);
        const daysUntilDeadline = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);
        if (daysUntilDeadline >= 1) {
          // 발권기한 15일 전 발행 목표 (SEO 효과 고려 최소 기준)
          const targetDt = new Date(deadline);
          targetDt.setDate(deadline.getDate() - 15);
          // 목표 발행일이 오늘보다 과거이면 최대한 빨리 (내일 첫 슬롯)
          if (targetDt <= today) {
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            tomorrow.setUTCHours(23, 0, 0, 0); // 08:00 KST = 23:00 UTC 전날
            targetPublishAt = tomorrow.toISOString();
          } else {
            targetPublishAt = targetDt.toISOString();
          }
          // 기한 임박도에 따라 priority boost (15일 이내=95, 30일 이내=88, 그 외=82)
          rowPriority = daysUntilDeadline <= 15 ? 95 : daysUntilDeadline <= 30 ? 88 : 82;
        }
      }

      return {
        topic: `${p.destination} ${p.title || '패키지'} 가성비 리뷰`,
        source: 'product',
        priority: rowPriority,
        destination: p.destination,
        angle_type: 'value',
        product_id: p.id,
        category: 'product_intro',
        primary_keyword: pk,
        keyword_tier: 'longtail' as KeywordTier,
        competition_level: 'low',
        ...(targetPublishAt ? { target_publish_at: targetPublishAt } : {}),
        meta: {
          product_title: p.title,
          ...(p.ticketing_deadline ? { ticketing_deadline: p.ticketing_deadline } : {}),
        },
      };
    });
    const { data: inserted, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .insert(productRows)
      .select('id');
    if (!error) productAdded = (inserted ?? []).length;
  }

  // 이제 targetPublishAt 배정
  await assignPublishSlots(postsPerDay);

  return {
    seasonal_added: seasonalAdded,
    coverage_added: coverageAdded,
    product_added: productAdded,
    total_added: seasonalAdded + coverageAdded + productAdded,
  };
}

/**
 * 큐의 항목에 target_publish_at 슬롯으로 배정.
 * - 정책의 slot_times 사용
 * - 같은 destination 1일 N개 제한 (per_destination_daily_cap)
 */
export async function assignPublishSlots(postsPerDay?: number): Promise<{ assigned: number }> {
  const policy = await getActivePolicy('global');
  const ppd = postsPerDay ?? policy.posts_per_day;
  const slots = policy.slot_times.length > 0 ? policy.slot_times : DAILY_PUBLISH_SLOTS;
  const destCap = policy.per_destination_daily_cap;

  const { data: queued } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, priority, destination, primary_keyword, angle_type')
    .eq('status', 'queued')
    .is('target_publish_at', null)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  if (!queued || queued.length === 0) return { assigned: 0 };

  // 미래 14일 내 이미 스케줄된 슬롯 + destination별 카운트
  const { data: scheduled } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('target_publish_at, destination')
    .not('target_publish_at', 'is', null)
    .gte('target_publish_at', new Date().toISOString());

  const takenSlots = new Set<string>();
  const destCountByDay = new Map<string, number>(); // 'YYYY-MM-DD::dest' → count
  ((scheduled || []) as Array<{ target_publish_at: string | null; destination: string | null }>).forEach((s) => {
    if (!s.target_publish_at) return;
    const iso = new Date(s.target_publish_at).toISOString();
    takenSlots.add(iso);
    if (s.destination) {
      const day = iso.split('T')[0];
      const key = `${day}::${s.destination}`;
      destCountByDay.set(key, (destCountByDay.get(key) ?? 0) + 1);
    }
  });

  let assigned = 0;
  const today = new Date();
  const remaining = [...queued];

  // 향후 21일까지 (multi-angle drip 12-15일 분산 수용)
  for (let dayOffset = 0; dayOffset < 21 && remaining.length > 0; dayOffset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + dayOffset);
    const yyyyMmDd = d.toISOString().split('T')[0];

    for (let slotIdx = 0; slotIdx < ppd && remaining.length > 0; slotIdx++) {
      const slotIso = kstToUtcIso(yyyyMmDd, slots[slotIdx % slots.length]);
      if (new Date(slotIso) <= new Date()) continue;
      if (takenSlots.has(slotIso)) continue;

      // 이 슬롯에 들어갈 후보 — destination cap 통과하는 첫 항목 픽
      const idx = remaining.findIndex(item => {
        if (!item.destination) return true;
        const key = `${yyyyMmDd}::${item.destination}`;
        return (destCountByDay.get(key) ?? 0) < destCap;
      });
      if (idx === -1) continue;

      const item = remaining.splice(idx, 1)[0];
      const { error } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({ target_publish_at: slotIso })
        .eq('id', item.id);

      if (!error) {
        takenSlots.add(slotIso);
        if (item.destination) {
          const key = `${yyyyMmDd}::${item.destination}`;
          destCountByDay.set(key, (destCountByDay.get(key) ?? 0) + 1);
        }
        assigned++;
      }
    }
  }

  return { assigned };
}

function inferCategoryFromSeasonal(topic: string): string {
  if (/준비물|체크리스트|챙/i.test(topic)) return 'preparation';
  if (/날씨|옷차림|기온/i.test(topic)) return 'local_info';
  if (/비자|입국/i.test(topic)) return 'visa_info';
  if (/일정|코스/i.test(topic)) return 'itinerary';
  if (/FAQ|질문/i.test(topic)) return 'travel_tips';
  return 'travel_tips';
}
