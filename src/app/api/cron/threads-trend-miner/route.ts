import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchMultipleKeywords, isThreadsSearchConfigured } from '@/lib/threads-search';
import { extractTrendFeatures, scrubPII } from '@/lib/trend-feature-extractor';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { detectDestination } from '@/lib/keyword-research';
import { refreshThreadsTrendLearning } from '@/lib/threads-trend-learner';

/**
 * Threads Trend Miner — 매일 06:30 KST (21:30 UTC)
 *
 * 흐름:
 *   1) tier-1 destination + 시즌 키워드 셋 결정 (active travel_packages 기반)
 *   2) Threads keyword_search TOP 호출 (rate limit 200/hour, 키워드 간 400ms 딜레이)
 *   3) PII scrub + feature 추출 (hook_first_line, hook_words, hook_type_guess)
 *   4) external_trend_posts UPSERT (platform='threads', UNIQUE (platform, external_id))
 *   5) 30일 만료된 row 정리 (expires_at < now())
 *
 * 학습 루프 연결 (PR-4 이후):
 *   - trending_hooks_7d 뷰가 카드뉴스 copywriter prompt에 retrieval 주입
 *   - PR-3 CLIP 클러스터링은 별도 cron으로 cover 이미지 처리
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_KEYWORDS_PER_RUN = 15;
const SEASONAL_KEYWORDS_BASE = [
  '해외여행', '여행추천', '여행꿀팁', '항공권', '패키지여행',
];

async function runThreadsTrendMiner(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }
  if (!isThreadsSearchConfigured()) {
    return { skipped: true, reason: 'Threads access token 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];

  // 1) 키워드 셋 결정: active destinations top + seasonal base
  const { data: pkgs } = await supabaseAdmin
    .from('travel_packages')
    .select('destination')
    .in('status', ['approved', 'active']);

  const destCounts = new Map<string, number>();
  for (const p of (pkgs ?? []) as Array<{ destination: string | null }>) {
    if (!p.destination) continue;
    destCounts.set(p.destination, (destCounts.get(p.destination) ?? 0) + 1);
  }
  const topDestinations = Array.from(destCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([d]) => d);

  const keywords = Array.from(new Set([
    ...topDestinations,
    ...SEASONAL_KEYWORDS_BASE,
  ])).slice(0, MAX_KEYWORDS_PER_RUN);

  if (keywords.length === 0) {
    return { skipped: true, reason: '키워드 없음', errors };
  }

  // 2) Threads search 순차 호출
  const searchResults = await searchMultipleKeywords(keywords, 'TOP', 400);

  // 3) feature 추출 + UPSERT 행 빌드
  const upsertRows: Array<Record<string, unknown>> = [];
  let totalPosts = 0;
  let errorKeywords = 0;
  let permissionMissing = false;

  for (const { keyword, result } of searchResults) {
    if (!result.ok) {
      errors.push(`${keyword}: ${result.error}`);
      errorKeywords += 1;
      if (isThreadsPermissionError(result.error)) permissionMissing = true;
      continue;
    }
    const dest = detectDestination(keyword) || null;

    for (const post of result.posts) {
      totalPosts += 1;
      const { scrubbed, piiDetected } = scrubPII(post.text ?? '');
      const feats = extractTrendFeatures(scrubbed);

      const likes = post.like_count ?? 0;
      const replies = post.reply_count ?? 0;
      const reposts = post.repost_count ?? 0;
      const quotes = post.quote_count ?? 0;
      const shares = post.share_count ?? 0;
      const views = post.views ?? 0;

      const er = views > 0
        ? (likes + replies + reposts + quotes + shares) / views
        : null;
      const performanceScore = scoreThreadsTrendPost({
        views,
        likes,
        replies,
        reposts,
        quotes,
        shares,
        publishedAt: post.timestamp ?? null,
        hasDestinationMatch: Boolean(dest),
      });

      upsertRows.push({
        platform: 'threads',
        external_id: post.id,
        keyword,
        search_type: 'TOP',
        related_destination: dest,
        post_text: scrubbed.slice(0, 2000),
        hook_words: feats.hook_words,
        hook_first_line: feats.hook_first_line,
        hook_type: feats.hook_type_guess,
        has_image: post.media_type === 'IMAGE' || post.media_type === 'CAROUSEL_ALBUM',
        has_carousel: post.media_type === 'CAROUSEL_ALBUM',
        cover_image_url: null,                           // Threads는 cover 따로 없음
        hashtag_count: feats.hashtag_count,
        emoji_count: feats.emoji_count,
        likes,
        replies,
        reposts,
        quotes,
        shares,
        views,
        engagement_rate: er,
        performance_score: performanceScore,
        personal_data_present: piiDetected,
        post_published_at: post.timestamp ?? null,
        raw_response: {
          permalink: post.permalink,
          media_type: post.media_type,
        },
      });
    }
  }

  let inserted = 0;
  if (upsertRows.length > 0) {
    const { error: upErr, count } = await supabaseAdmin
      .from('external_trend_posts')
      .upsert(upsertRows, { onConflict: 'platform,external_id', ignoreDuplicates: false, count: 'exact' });
    if (upErr) {
      errors.push(`UPSERT 실패: ${upErr.message}`);
    } else {
      inserted = count ?? upsertRows.length;
    }
  }

  // 5) 만료된 row 정리 (옵션 — 별도 cron 도입 전 임시)
  const { error: delErr, count: delCount } = await supabaseAdmin
    .from('external_trend_posts')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString());
  if (delErr) errors.push(`expire 정리 실패: ${delErr.message}`);

  let learning: Awaited<ReturnType<typeof refreshThreadsTrendLearning>> | null = null;
  try {
    learning = await refreshThreadsTrendLearning();
  } catch (err) {
    errors.push(`trend learning refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    mode: permissionMissing ? 'fallback_learning' : 'keyword_search',
    permission_status: permissionMissing ? 'threads_keyword_search_missing' : 'ok',
    keywords: keywords.length,
    error_keywords: errorKeywords,
    posts_fetched: totalPosts,
    upserted: inserted,
    expired_deleted: delCount ?? 0,
    learning,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('threads-trend-miner', runThreadsTrendMiner);

function scoreThreadsTrendPost(args: {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  shares: number;
  publishedAt: string | null;
  hasDestinationMatch: boolean;
}): number | null {
  const { views, likes, replies, reposts, quotes, shares, publishedAt, hasDestinationMatch } = args;
  const weighted = likes + replies * 2 + reposts * 5 + quotes * 4 + shares * 3;
  if (weighted <= 0 && views <= 0) return null;

  const viewDenom = Math.max(views, 50);
  const erScore = Math.min(0.75, weighted / viewDenom);
  const volumeScore = Math.min(0.15, Math.log10(Math.max(views, 1)) / 40);
  const destinationBoost = hasDestinationMatch ? 0.05 : 0;
  const freshnessBoost = publishedAt ? computeFreshnessBoost(publishedAt) : 0;

  return Math.max(0, Math.min(1, Number((erScore + volumeScore + destinationBoost + freshnessBoost).toFixed(4))));
}

function computeFreshnessBoost(publishedAt: string): number {
  const ts = new Date(publishedAt).getTime();
  if (Number.isNaN(ts)) return 0;
  const ageHours = Math.max(0, (Date.now() - ts) / (60 * 60 * 1000));
  if (ageHours <= 24) return 0.05;
  if (ageHours <= 72) return 0.03;
  if (ageHours <= 168) return 0.01;
  return 0;
}

function isThreadsPermissionError(error: string | undefined): boolean {
  const normalized = (error || '').toLowerCase();
  return normalized.includes('permission')
    || normalized.includes('code 10')
    || normalized.includes('does not have permission')
    || normalized.includes('threads_keyword_search');
}
