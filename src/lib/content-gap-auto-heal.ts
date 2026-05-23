/**
 * 콘텐츠 갭 자동 치유 — 예약은 있지만 블로그/카드뉴스가 없는 상품을
 * 감지하여 blog_topic_queue에 자동 등록하고, 긴급 상황에서는 카드뉴스도 함께 생성한다.
 *
 * 의존성:
 *   - supabaseAdmin, isSupabaseConfigured (@/lib/supabase)
 *   - blog_topic_queue 테이블 (source='auto_heal', priority=85)
 *   - card_news 테이블 (card_news_type='product')
 *
 * refillWeeklyQueue()가 주 1회 실행되는 반면, 이 모듈은 더 자주 또는
 * 트리거(on-demand)로 실행될 수 있도록 설계되었다.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// ─── 타입 ────────────────────────────────────────────────────

export interface HealItem {
  package_id: string;
  title: string;
  destination: string | null;
  bookings: number;
  action: 'queued' | 'already_covered' | 'skipped_duplicate';
}

export interface HealResult {
  scanned_packages: number;
  gaps_found: number;
  already_covered: number;
  queued: number;
  skipped_duplicate: number;
  items: HealItem[];
}

// ─── 메인 함수 ────────────────────────────────────────────────

/**
 * 콘텐츠 갭을 감지하고 blog_topic_queue에 자동 등록한다.
 *
 * @param opts.maxPerRun - 한 번에 처리할 최대 갭 개수 (기본 3)
 */
export async function autoHealContentGaps(
  opts?: { maxPerRun?: number },
): Promise<HealResult> {
  const maxPerRun = opts?.maxPerRun ?? 3;

  const result: HealResult = {
    scanned_packages: 0,
    gaps_found: 0,
    already_covered: 0,
    queued: 0,
    skipped_duplicate: 0,
    items: [],
  };

  if (!isSupabaseConfigured) return result;

  try {
    // 1) 활성 상품 목록 조회
    const { data: packages } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination')
      .in('status', ['active', 'approved'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (!packages?.length) return result;

    const pkgIds = (packages as Array<{ id: string; title: string; destination: string | null }>).map(
      (p) => p.id,
    );
    result.scanned_packages = pkgIds.length;

    // 2) 콘텐츠 현황 조회 — content_creatives에서 발행된 채널별 product_id 수집
    const { data: contentData } = await supabaseAdmin
      .from('content_creatives')
      .select('product_id, channel')
      .in('product_id', pkgIds)
      .eq('status', 'published');

    const contentMap = new Map<string, Set<string>>();
    for (const c of (contentData ?? []) as Array<{
      product_id: string;
      channel: string;
    }>) {
      if (!contentMap.has(c.product_id)) {
        contentMap.set(c.product_id, new Set());
      }
      contentMap.get(c.product_id)!.add(c.channel);
    }

    // 3) 예약 건수 조회
    const { data: bookingRows } = await supabaseAdmin
      .from('bookings')
      .select('package_id')
      .in('package_id', pkgIds);

    const bookingMap = new Map<string, number>();
    for (const b of (bookingRows ?? []) as Array<{ package_id: string }>) {
      bookingMap.set(b.package_id, (bookingMap.get(b.package_id) ?? 0) + 1);
    }

    // 4) 갭 식별: content_count === 0 && bookings > 0, 예약순 정렬
    type RawPkg = { id: string; title: string; destination: string | null };

    const gaps: Array<RawPkg & { bookings: number }> = [];
    for (const pkg of packages as RawPkg[]) {
      const channels = contentMap.get(pkg.id) ?? new Set();
      const bookings = bookingMap.get(pkg.id) ?? 0;
      if (channels.size === 0 && bookings > 0) {
        gaps.push({ ...pkg, bookings });
      }
    }

    gaps.sort((a, b) => b.bookings - a.bookings);
    result.gaps_found = gaps.length;

    // 5) 이미 blog_topic_queue나 card_news에 등록된 product_id 확인 (중복 방지)
    const gapIds = gaps.slice(0, maxPerRun).map((g) => g.id);

    // 5a) blog_topic_queue에 queued/generating 상태로 있는 항목 확인
    let alreadyInQueue = new Set<string>();
    if (gapIds.length > 0) {
      const { data: queueItems } = await supabaseAdmin
        .from('blog_topic_queue')
        .select('product_id')
        .in('product_id', gapIds)
        .in('status', ['queued', 'generating']);
      alreadyInQueue = new Set(
        ((queueItems ?? []) as Array<{ product_id: string | null }>)
          .map((q) => q.product_id)
          .filter((id): id is string => Boolean(id)),
      );
    }

    // 5b) card_news에 package_id로 연결된 레코드 확인
    let alreadyInCardNews = new Set<string>();
    if (gapIds.length > 0) {
      const { data: cardNewsItems } = await supabaseAdmin
        .from('card_news')
        .select('package_id')
        .not('package_id', 'is', null)
        .in('package_id', gapIds);
      alreadyInCardNews = new Set(
        ((cardNewsItems ?? []) as Array<{ package_id: string | null }>)
          .map((c) => c.package_id)
          .filter((id): id is string => Boolean(id)),
      );
    }

    // 6) 갭 항목 처리
    const toProcess = gaps.slice(0, maxPerRun);

    for (const gap of toProcess) {
      const item: HealItem = {
        package_id: gap.id,
        title: gap.title,
        destination: gap.destination,
        bookings: gap.bookings,
        action: 'queued',
      };

      // 이미 커버된 경우 (content_creatives에 발행 콘텐츠가 있음)
      const channels = contentMap.get(gap.id);
      if (channels && channels.size > 0) {
        item.action = 'already_covered';
        result.already_covered++;
        result.items.push(item);
        continue;
      }

      // blog_topic_queue에 이미 등록된 경우
      if (alreadyInQueue.has(gap.id) || alreadyInCardNews.has(gap.id)) {
        item.action = 'skipped_duplicate';
        result.skipped_duplicate++;
        result.items.push(item);
        continue;
      }

      // blog_topic_queue에 INSERT
      const pk = `${gap.destination ?? ''} ${gap.title}`.trim();
      const insertResult = await supabaseAdmin
        .from('blog_topic_queue')
        .insert({
          topic: pk,
          source: 'auto_heal',
          priority: 85,
          destination: gap.destination,
          angle_type: 'value',
          product_id: gap.id,
          category: 'product_intro',
          primary_keyword: pk,
          keyword_tier: 'longtail',
          competition_level: 'low',
          meta: {
            auto_heal: true,
            heal_bookings: gap.bookings,
            heal_triggered_at: new Date().toISOString(),
          },
        })
        .select('id');

      if (!insertResult.error) {
        result.queued++;
        result.items.push(item);
      } else {
        // INSERT 실패 시 skipped_duplicate로 처리 (PK 위반 등)
        console.warn(
          `[autoHealContentGaps] 큐 등록 실패: ${gap.id} (${gap.title})`,
          insertResult.error.message,
        );
        item.action = 'skipped_duplicate';
        result.skipped_duplicate++;
        result.items.push(item);
      }
    }

    return result;
  } catch (err) {
    console.error('[autoHealContentGaps] 오류:', err instanceof Error ? err.message : err);
    return result;
  }
}

// ─── 긴급 카드뉴스 생성 ───────────────────────────────────────

/**
 * 긴급 상황(예약은 있지만 콘텐츠가 전혀 없는 고전환 상품)에서
 * blog_topic_queue 등록과 함께 카드뉴스 시드 레코드를 먼저 생성한다.
 *
 * 생성된 카드뉴스는 이후 POST /api/blog/from-card-news 가 블로그로 변환할 수 있다.
 *
 * @param packageId - 대상 travel_package.id
 * @returns 생성된 card_news.id 또는 null
 */
export async function createEmergencyCardNews(
  packageId: string,
): Promise<{ cardNewsId: string | null }> {
  if (!isSupabaseConfigured) return { cardNewsId: null };

  try {
    // 1) 상품 데이터 조회
    const { data: pkg, error: pkgError } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, nights, price, status')
      .eq('id', packageId)
      .single();

    if (pkgError || !pkg) {
      console.warn(`[createEmergencyCardNews] 상품 없음: ${packageId}`);
      return { cardNewsId: null };
    }

    // 2) 중복 생성 방지 — 이미 card_news가 있는지 확인
    const { data: existing } = await supabaseAdmin
      .from('card_news')
      .select('id')
      .eq('package_id', packageId)
      .limit(1);

    if (existing && existing.length > 0) {
      return { cardNewsId: (existing[0] as { id: string }).id };
    }

    const dest = pkg.destination ?? pkg.title ?? '여행';
    const title = pkg.title ?? '여행상품';

    // 3) 최소 6슬라이드 구조 생성
    const slides = [
      {
        position: 1,
        headline: `${dest} 여행의 모든 것`,
        body: `${dest}에서 특별한 여행을 경험하세요.`,
        bg_image_url: '',
        pexels_keyword: `${dest} travel`,
        overlay_style: 'gradient-bottom' as const,
      },
      {
        position: 2,
        headline: '상품 소개',
        body: title,
        bg_image_url: '',
        pexels_keyword: `${dest} tour`,
        overlay_style: 'gradient-bottom' as const,
      },
      {
        position: 3,
        headline: '여행 일정',
        body: `총 ${pkg.nights ?? ''}박 ${(pkg.nights ?? 0) + 1}일 동안의 특별한 여정`,
        bg_image_url: '',
        pexels_keyword: `${dest} travel itinerary`,
        overlay_style: 'gradient-bottom' as const,
      },
      {
        position: 4,
        headline: '포함 사항',
        body: '항공권, 숙소, 가이드, 식사가 포함된 올인원 패키지입니다.',
        bg_image_url: '',
        pexels_keyword: `${dest} sightseeing`,
        overlay_style: 'gradient-bottom' as const,
      },
      {
        position: 5,
        headline: '추천 포인트',
        body: '합리적인 가격과 알찬 구성으로 누구나 만족할 수 있는 여행입니다.',
        bg_image_url: '',
        pexels_keyword: `${dest} holiday`,
        overlay_style: 'gradient-bottom' as const,
      },
      {
        position: 6,
        headline: '지금 예약하세요!',
        body: `${title} — 지금 바로 확인해보세요.`,
        bg_image_url: '',
        pexels_keyword: `${dest} booking`,
        overlay_style: 'dark' as const,
      },
    ];

    // 4) card_news INSERT
    const topic = `${dest} ${title}`;
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('card_news')
      .insert({
        package_id: packageId,
        title: topic,
        topic,
        card_news_type: 'product',
        status: 'DRAFT',
        slides,
        slide_image_urls: [],
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(
        `[createEmergencyCardNews] 카드뉴스 생성 실패: ${packageId}`,
        insertError.message,
      );
      return { cardNewsId: null };
    }

    return { cardNewsId: (inserted as { id: string }).id };
  } catch (err) {
    console.error(
      '[createEmergencyCardNews] 오류:',
      err instanceof Error ? err.message : err,
    );
    return { cardNewsId: null };
  }
}
