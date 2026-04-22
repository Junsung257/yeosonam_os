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

// 하루 6개 슬롯, 2시간 간격 (KST)
export const DAILY_PUBLISH_SLOTS = ['08:00', '11:00', '13:00', '15:00', '17:00', '20:00'];

export const DEFAULT_POSTS_PER_DAY = 6;
export const PRODUCT_RATIO = 0.3; // 30%

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
  const postsPerDay = opts?.postsPerDay ?? DEFAULT_POSTS_PER_DAY;
  const weeklyTarget = postsPerDay * 7;
  const productTarget = Math.floor(weeklyTarget * PRODUCT_RATIO);
  const infoTarget = weeklyTarget - productTarget;

  // 시즌 캘린더가 비어있으면 채우기
  await generateNextQuarterTopics().catch(e => console.warn('[scheduler] 시즌 생성 실패:', e));

  let seasonalAdded = 0;
  let coverageAdded = 0;
  let productAdded = 0;

  // --- 정보성: 시즌 60% + 갭 40%
  const seasonalTarget = Math.ceil(infoTarget * 0.6);
  const coverageTarget = infoTarget - seasonalTarget;

  // 시즌 토픽 뽑기
  const seasonals = await pickSeasonalTopics(seasonalTarget);
  for (const s of seasonals) {
    const { error } = await supabaseAdmin.from('blog_topic_queue').insert({
      topic: s.topic,
      source: 'seasonal',
      priority: 60,
      destination: s.destination ?? null,
      category: inferCategoryFromSeasonal(s.topic),
      meta: { keywords: s.keywords, season_tag: s.season_tag },
    });
    if (!error) {
      seasonalAdded++;
      // 사용 표시
      await supabaseAdmin.from('blog_seasonal_calendar')
        .update({ used: true, used_at: new Date().toISOString() })
        .eq('year_month', s.year_month)
        .eq('topic', s.topic);
    }
  }

  // 커버리지 갭
  const gaps = await analyzeCoverageGaps({ maxPerDestination: 2 });
  const toAddGaps = gaps.slice(0, coverageTarget);
  for (const g of toAddGaps) {
    const { error } = await supabaseAdmin.from('blog_topic_queue').insert({
      topic: g.topic,
      source: 'coverage_gap',
      priority: 40,
      destination: g.destination,
      category: g.category,
      meta: { expected_slug: g.slug_suffix },
    });
    if (!error) coverageAdded++;
  }

  // --- 상품: 최근 7일 내 approved 됐는데 아직 블로그 없는 상품
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data: freshProducts } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, title, created_at')
    .in('status', ['approved', 'active'])
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(productTarget * 2);

  type PkgRow = { id: string; destination: string | null; title: string | null; created_at: string };
  const productIds = ((freshProducts || []) as PkgRow[]).map((p) => p.id);
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

  const eligibleProducts = ((freshProducts || []) as PkgRow[])
    .filter((p) => !existingProductBlogs.has(p.id))
    .slice(0, productTarget);

  for (const p of eligibleProducts) {
    // 상품 블로그는 "가성비(value)" 기본 앵글
    const { error } = await supabaseAdmin.from('blog_topic_queue').insert({
      topic: `${p.destination} ${p.title || '패키지'} 가성비 리뷰`,
      source: 'product',
      priority: 80,
      destination: p.destination,
      angle_type: 'value',
      product_id: p.id,
      category: 'product_intro',
      meta: { product_title: p.title },
    });
    if (!error) productAdded++;
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
 * 큐의 항목에 target_publish_at 을 2시간 간격 슬롯으로 배정
 */
export async function assignPublishSlots(postsPerDay: number): Promise<{ assigned: number }> {
  // 아직 target 미배정 + queued 인 항목을 priority 순으로
  const { data: queued } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, priority')
    .eq('status', 'queued')
    .is('target_publish_at', null)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  if (!queued || queued.length === 0) return { assigned: 0 };

  // 현재 이미 스케줄된 슬롯 파악
  const { data: scheduled } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('target_publish_at')
    .not('target_publish_at', 'is', null)
    .gte('target_publish_at', new Date().toISOString());

  const takenSlots = new Set<string>();
  ((scheduled || []) as Array<{ target_publish_at: string | null }>).forEach((s) => {
    if (s.target_publish_at) takenSlots.add(new Date(s.target_publish_at).toISOString());
  });

  let assigned = 0;
  let cursor = 0; // queued 인덱스
  const today = new Date();

  // 향후 14일까지 슬롯 생성
  for (let dayOffset = 0; dayOffset < 14 && cursor < queued.length; dayOffset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + dayOffset);
    const yyyyMmDd = d.toISOString().split('T')[0];

    for (let slotIdx = 0; slotIdx < postsPerDay && cursor < queued.length; slotIdx++) {
      const slotIso = kstToUtcIso(yyyyMmDd, DAILY_PUBLISH_SLOTS[slotIdx]);

      // 과거 슬롯은 건너뜀
      if (new Date(slotIso) <= new Date()) continue;
      if (takenSlots.has(slotIso)) continue;

      const item = queued[cursor++];
      const { error } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({ target_publish_at: slotIso })
        .eq('id', item.id);

      if (!error) {
        takenSlots.add(slotIso);
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
