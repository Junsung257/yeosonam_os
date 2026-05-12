import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchMultipleKeywords, isThreadsSearchConfigured } from '@/lib/threads-search';
import { extractTrendFeatures, scrubPII } from '@/lib/trend-feature-extractor';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { detectDestination } from '@/lib/keyword-research';

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

  for (const { keyword, result } of searchResults) {
    if (!result.ok) {
      errors.push(`${keyword}: ${result.error}`);
      errorKeywords += 1;
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
        performance_score: er,                           // 일차 — PR-4에서 정규화
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

  return {
    keywords: keywords.length,
    error_keywords: errorKeywords,
    posts_fetched: totalPosts,
    upserted: inserted,
    expired_deleted: delCount ?? 0,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('threads-trend-miner', runThreadsTrendMiner);
