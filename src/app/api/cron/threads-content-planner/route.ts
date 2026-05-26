/**
 * Threads Content Planner — 매일 07:00 KST 실행
 *
 * 역할:
 *   1. travel_packages → 각 상품의 Priority Score 계산 (urgeny + margin + scarcity)
 *   2. trend-learning 결과에서 현재 인기 키워드 조회
 *   3. 오늘 발행할 콘텐츠 계획 수립 (content_plans에 INSERT)
 *
 * 콘텐츠 카테고리 균형 (SocialFlow 6-agent + 여행사 사례 기반):
 *   - travel_tip (40%) — 여행꿀팁, 준비물, 시즌 정보
 *   - product_promo (30%) — 상품 홍보, 특가, 마감 임박
 *   - brand_story (20%) — 브랜드 비하인드, 팀 이야기
 *   - engagement (10%) — 질문, 투표, 참여 유도
 *
 * 참고:
 *   - insoftex 유럽 여행사 사례: Tour Priority Score 기반 Planner Agent
 *   - SocialFlow: Scout→Planner→Creator→Reviewer→Publisher→Analyst
 *   - OpenTwins: 7-stage pipeline (Trend Scout → Content Planner → Writer)
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2분 — 상품 많으면 list + DB write

interface PkgRow {
  id: string;
  title: string;
  destination: string | null;
  price: number | null;
  duration: number | null;
  status: string | null;
  product_summary: string | null;
  product_highlights: string[] | null;
  departure_date: string | null;
  seats_held: number | null;
  seats_confirmed: number | null;
  seats_ticketed: number | null;
}

/** 콘텐츠 카테고리 정의 */
const CATEGORIES = [
  { id: 'travel_tip' as const,   targetRatio: 0.40 },
  { id: 'product_promo' as const, targetRatio: 0.30 },
  { id: 'brand_story' as const,  targetRatio: 0.20 },
  { id: 'engagement' as const,   targetRatio: 0.10 },
] as const;

/** 오늘의 총 발행 수 (안전: 5개) */
const DAILY_POST_TARGET = 5;

async function runPlanner(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정' };
  }

  const errors: string[] = [];

  // ── 1. 활성 상품 조회 ──────────────────────────────────────
      const { data: packages, error: pkgErr } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, price, duration, status, product_summary, product_highlights, departure_date, seats_held, seats_confirmed, seats_ticketed')
        .in('status', ['approved', 'active'])
        .order('created_at', { ascending: false })
        .limit(50);

  if (pkgErr) {
    return { skipped: true, reason: `상품 조회 실패: ${pkgErr.message}` };
  }
  const pkgs = (packages ?? []) as unknown as PkgRow[];
  if (pkgs.length === 0) {
    return { skipped: true, reason: '발행 가능한 상품 없음' };
  }

  // ── 2. Dominant 트렌드 키워드 조회 ─────────────────────────
  // external_trend_posts에서 최근 24시간 기준 상위 키워드
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: trendRows } = await supabaseAdmin
    .from('external_trend_posts')
    .select('keyword')
    .gte('captured_at', since)
    .order('performance_score', { ascending: false })
    .limit(20);

  const trendKeywords = [...new Set(
    (trendRows ?? []).map((r: { keyword: string | null }) => r.keyword).filter(Boolean)
  )] as string[];

  // ── 3. Priority Score 계산 ──────────────────────────────────
  const scoredPackages = pkgs.map((pkg) => {
    const score = calculatePriorityScore(pkg);
    return { pkg, score };
  }).sort((a, b) => b.score - a.score);

  // priority_score를 travel_packages에 batch 업데이트
  const now = new Date().toISOString();

  // Supabase rpc를 사용할 수 없으므로, 직접 SQL로 batch UPDATE
  const { error: batchErr } = await supabaseAdmin.rpc('batch_update_priority_scores', {
    p_scores: scoredPackages.map(({ pkg, score }) => ({
      id: pkg.id,
      score,
      updated_at: now,
    })),
  });

  // rpc가 없으면 fallback: 개별 UPDATE (최소화: 최대 50개 → Promise.all로 병렬)
  if (batchErr) {
    await Promise.all(
      scoredPackages.map(({ pkg, score }) =>
        supabaseAdmin
          .from('travel_packages')
          .update({ priority_score: score, priority_updated_at: now })
          .eq('id', pkg.id)
      )
    );
  }

  // ── 4. 오늘 발행 계획 수립 ──────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  // 이미 오늘 계획이 있는지 확인 (중복 방지)
  const { data: existingPlans } = await supabaseAdmin
    .from('content_plans')
    .select('id')
    .eq('plan_date', today);

  if ((existingPlans ?? []).length > 0) {
    return { skipped: true, reason: `오늘(${today}) 계획 이미 존재: ${existingPlans?.length}개` };
  }

  // 카테고리별로 할당할 개수
  const categoryCounts = CATEGORIES.map(c => ({
    ...c,
    count: Math.round(DAILY_POST_TARGET * c.targetRatio),
  }));
  // 반올림 차이 조정
  const totalAllocated = categoryCounts.reduce((s, c) => s + c.count, 0);
  if (totalAllocated < DAILY_POST_TARGET) {
    categoryCounts[0].count += DAILY_POST_TARGET - totalAllocated;
  }

  const plans: Array<{
    plan_date: string;
    category: string;
    priority_score: number;
    status: string;
    product_id: string | null;
    reason: string;
    trend_keyword: string | null;
  }> = [];

  // product_promo: Priority Score 높은 상품 → 홍보 계획
  for (const { pkg, score } of scoredPackages.slice(0, categoryCounts.find(c => c.id === 'product_promo')?.count ?? 2)) {
    plans.push({
      plan_date: today,
      category: 'product_promo',
      priority_score: score,
      status: 'planned',
      product_id: pkg.id,
      trend_keyword: pickRelevantKeyword(pkg, trendKeywords),
      reason: `Priority ${score.toFixed(2)} | ${pkg.destination ?? ''} ${pkg.title.slice(0, 20)}`,
    });
  }

  // travel_tip: Priority Score 중상위 + destination 정보 활용
  const tipPackages = scoredPackages.filter(p => p.pkg.destination);
  for (const { pkg, score } of tipPackages.slice(0, categoryCounts.find(c => c.id === 'travel_tip')?.count ?? 2)) {
    plans.push({
      plan_date: today,
      category: 'travel_tip',
      priority_score: score * 0.9, // 약간 낮춤 (꿀팁은 상품 의존도 낮음)
      status: 'planned',
      product_id: pkg.id,
      trend_keyword: pickRelevantKeyword(pkg, trendKeywords),
      reason: `꿀팁: ${pkg.destination ?? ''}`,
    });
  }

  // brand_story: 가장 최근 상품 또는 destination 다양하게
  const storyCandidates = [...scoredPackages].sort(
    (a, b) => (b.pkg.destination ?? '').localeCompare(a.pkg.destination ?? ''),
  );
  for (const { pkg, score } of storyCandidates.slice(0, categoryCounts.find(c => c.id === 'brand_story')?.count ?? 1)) {
    plans.push({
      plan_date: today,
      category: 'brand_story',
      priority_score: score * 0.7,
      status: 'planned',
      product_id: pkg.id,
      trend_keyword: null,
      reason: `브랜드: ${pkg.destination ?? ''} ${pkg.title.slice(0, 15)}`,
    });
  }

  // engagement: 상품 불문, 최근 핫 키워드 기반
  for (let i = 0; i < (categoryCounts.find(c => c.id === 'engagement')?.count ?? 1); i++) {
    plans.push({
      plan_date: today,
      category: 'engagement',
      priority_score: 0.5,
      status: 'planned',
      product_id: null,
      trend_keyword: trendKeywords[i] ?? null,
      reason: trendKeywords[i]
        ? `참여유도: "${trendKeywords[i]}" 트렌드`
        : '참여유도: 일반 질문',
    });
  }

  // ── 5. DB 저장 ──────────────────────────────────────────────
  const { error: insErr } = await supabaseAdmin
    .from('content_plans')
    .insert(plans);

  if (insErr) {
    errors.push(`INSERT 실패: ${insErr.message}`);
    return { skipped: true, reason: '계획 저장 실패', errors };
  }

  return {
    plans_created: plans.length,
    packages_scored: scoredPackages.length,
    batch_update_ok: !batchErr,
    categories: plans.reduce((acc, p) => {
      acc[p.category] = (acc[p.category] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    top_product: scoredPackages[0]?.pkg.title ?? null,
    trend_keywords_used: trendKeywords.length,
    errors: errors.length > 0 ? errors : undefined,
    ranAt: new Date().toISOString(),
  };
}

/**
 * Priority Score V2 계산 (0.0 ~ 1.0)
 * - insoftex Tour Priority Score 개념 차용 + SocialFlow urgency/scarcity 추가
 *
 * 요소:
 *   - 상품 마진 (price × 0.3) — 높은 가격 = 높은 수익
 *   - 기간 (duration × 0.15)
 *   - destination 유무 (× 0.1)
 *   - product_summary 길이 (× 0.05)
 *   - product_highlights 개수 (× 0.05)
 * -- NEW --
 *   - **긴급성 (urgency × 0.2)** — 출발이 가까울수록 높음
 *   - **희소성 (scarcity × 0.15)** — 남은 좌석 적을수록 높음
 */
function calculatePriorityScore(pkg: PkgRow): number {
  let score = 0.5; // baseline

  // 가격이 높을수록 우선 (margin 가정)
  if (pkg.price && pkg.price > 0) {
    const priceScore = Math.min(pkg.price / 5000000, 1); // 500만원 이상이면 max
    score += priceScore * 0.3;
  }

  // 기간이 길수록 고가 상품일 가능성
  if (pkg.duration && pkg.duration > 0) {
    const durationScore = Math.min(pkg.duration / 14, 1); // 14일 이상이면 max
    score += durationScore * 0.15;
  }

  // destination이 있으면 가점 (콘텐츠 작성 용이)
  if (pkg.destination) {
    score += 0.1;
  }

  // product_summary가 길면 정보 풍부 = 좋은 콘텐츠 소스
  if (pkg.product_summary && pkg.product_summary.length > 100) {
    score += 0.05;
  }

  // product_highlights가 많을수록 우선
  if (pkg.product_highlights && pkg.product_highlights.length >= 3) {
    score += 0.05;
  }

  // ── V2: 긴급성 (urgency) ─────────────────────────────────────
  // 출발일이 가까울수록 점수 상승
  if (pkg.departure_date) {
    const depDate = new Date(pkg.departure_date);
    const daysUntil = (depDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntil > 0 && daysUntil <= 60) {
      const urgencyScore = 1 - (daysUntil / 60); // 출발 D-day = 1, D-60 = 0
      score += urgencyScore * 0.2;
    }
  }

  // ── V2: 희소성 (scarcity) ────────────────────────────────────
  // 총 좌석 대비 판매율이 높을수록 우선
  const held = pkg.seats_held ?? 0;
  const confirmed = pkg.seats_confirmed ?? 0;
  const ticketed = pkg.seats_ticketed ?? 0;
  const totalBooked = held + confirmed + ticketed;
  if (totalBooked > 0) {
    // 기본 30석 가정 (정보 없으면 0.5 중간값)
    const totalSeats = 30;
    const occupancyRate = Math.min(totalBooked / totalSeats, 1);
    const scarcityScore = occupancyRate; // 90% 찼으면 0.9
    score += scarcityScore * 0.15;
  }

  return Math.min(score, 1.0);
}

/**
 * 상품에 가장 관련 있는 트렌드 키워드 선택
 */
function pickRelevantKeyword(
  pkg: PkgRow,
  trendKeywords: string[],
): string | null {
  if (trendKeywords.length === 0) return null;
  if (!pkg.destination) return trendKeywords[0] ?? null;

  // destination과 매칭되는 키워드 우선
  const match = trendKeywords.find(kw =>
    pkg.destination!.toLowerCase().includes(kw.toLowerCase()) ||
    pkg.title.toLowerCase().includes(kw.toLowerCase()),
  );
  return match ?? trendKeywords[0] ?? null;
}

export const GET = withCronLogging('threads-content-planner', runPlanner);
