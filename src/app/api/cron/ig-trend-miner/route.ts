import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  searchHashtagId,
  getHashtagTopMedia,
  businessDiscoveryMedia,
  pickRotatedHashtags,
  isIgSearchConfigured,
} from '@/lib/ig-search';
import { extractTrendFeatures, scrubPII } from '@/lib/trend-feature-extractor';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

/**
 * IG Trend Miner — 매일 06:30 KST (21:30 UTC)
 *
 * Meta 한도: 7일 rolling 30개 unique hashtag → 일별 4개 회전 (= 7일 28개)
 * + 경쟁사 IG public 계정 Business Discovery (priority 상위 3개/일)
 *
 * 흐름:
 *   1) ig_hashtag_pool 에서 last_used_at 오래된 4개 선택
 *   2) 각 해시태그 → searchHashtagId → getHashtagTopMedia
 *   3) ig_competitor_handles priority 상위 3개 → businessDiscoveryMedia
 *   4) external_trend_posts UPSERT (platform='instagram')
 *   5) ig_hashtag_pool / ig_competitor_handles last_used_at 업데이트
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const HASHTAGS_PER_DAY = 4;
const COMPETITORS_PER_DAY = 3;

async function runIgTrendMiner(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }
  if (!isIgSearchConfigured()) {
    return { skipped: true, reason: 'IG access token / META_IG_USER_ID 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];
  const upsertRows: Array<Record<string, unknown>> = [];

  // 1) 해시태그 풀 회전
  const { data: poolRows } = await supabaseAdmin
    .from('ig_hashtag_pool')
    .select('hashtag, last_used_at, related_destination')
    .eq('is_active', true)
    .order('priority', { ascending: false });

  const pool = (poolRows ?? []) as Array<{ hashtag: string; last_used_at: string | null; related_destination: string | null }>;
  const picked = pickRotatedHashtags(pool, HASHTAGS_PER_DAY);

  for (const hashtag of picked) {
    const dest = pool.find((p) => p.hashtag === hashtag)?.related_destination ?? null;

    const idResult = await searchHashtagId(hashtag);
    if (!idResult.ok || !idResult.hashtagId) {
      errors.push(`hashtag_id ${hashtag}: ${idResult.error ?? 'no id'}`);
      continue;
    }

    await new Promise((r) => setTimeout(r, 400));

    const mediaResult = await getHashtagTopMedia(idResult.hashtagId);
    if (!mediaResult.ok) {
      errors.push(`top_media ${hashtag}: ${mediaResult.error}`);
      continue;
    }

    for (const m of mediaResult.data) {
      const caption = m.caption ?? '';
      const { scrubbed, piiDetected } = scrubPII(caption);
      const feats = extractTrendFeatures(scrubbed);

      const likes = m.like_count ?? 0;
      const comments = m.comments_count ?? 0;
      // IG public hashtag/business discovery는 reach/views 노출 X — like+comment를 proxy로
      const proxy_score = likes + comments * 3;

      upsertRows.push({
        platform: 'instagram',
        external_id: m.id,
        keyword: `#${hashtag}`,
        search_type: 'HASHTAG_TOP_MEDIA',
        related_destination: dest,
        post_text: scrubbed.slice(0, 2000),
        hook_words: feats.hook_words,
        hook_first_line: feats.hook_first_line,
        hook_type: feats.hook_type_guess,
        has_image: m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM',
        has_carousel: m.media_type === 'CAROUSEL_ALBUM',
        cover_image_url: m.media_url ?? null,
        hashtag_count: feats.hashtag_count,
        emoji_count: feats.emoji_count,
        likes,
        comments,
        engagement_rate: null,                  // proxy_score만
        performance_score: proxy_score > 0 ? Math.min(proxy_score / 10000, 1) : null,
        personal_data_present: piiDetected,
        post_published_at: m.timestamp ?? null,
        raw_response: { permalink: m.permalink, media_type: m.media_type },
      });
    }

    // 풀 업데이트
    await supabaseAdmin
      .from('ig_hashtag_pool')
      .update({
        last_used_at: new Date().toISOString(),
        use_count: ((pool.find((p) => p.hashtag === hashtag) as Record<string, unknown>)?.use_count as number) + 1 || 1,
      })
      .eq('hashtag', hashtag);

    await new Promise((r) => setTimeout(r, 500));
  }

  // 2) 경쟁사 Business Discovery
  const { data: compRows } = await supabaseAdmin
    .from('ig_competitor_handles')
    .select('username, brand_label')
    .eq('is_active', true)
    .order('last_fetched_at', { ascending: true, nullsFirst: true })
    .limit(COMPETITORS_PER_DAY);

  for (const c of (compRows ?? []) as Array<{ username: string; brand_label: string | null }>) {
    const result = await businessDiscoveryMedia(c.username, 15);
    if (!result.ok) {
      errors.push(`bd ${c.username}: ${result.error}`);
      continue;
    }
    for (const m of result.data) {
      const caption = m.caption ?? '';
      const { scrubbed, piiDetected } = scrubPII(caption);
      const feats = extractTrendFeatures(scrubbed);
      const likes = m.like_count ?? 0;
      const comments = m.comments_count ?? 0;
      const proxy = likes + comments * 3;

      upsertRows.push({
        platform: 'instagram',
        external_id: m.id,
        keyword: `competitor:${c.username}`,
        search_type: 'BUSINESS_DISCOVERY',
        related_destination: null,
        post_text: scrubbed.slice(0, 2000),
        hook_words: feats.hook_words,
        hook_first_line: feats.hook_first_line,
        hook_type: feats.hook_type_guess,
        has_image: m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM',
        has_carousel: m.media_type === 'CAROUSEL_ALBUM',
        cover_image_url: m.media_url ?? null,
        hashtag_count: feats.hashtag_count,
        emoji_count: feats.emoji_count,
        likes,
        comments,
        engagement_rate: null,
        performance_score: proxy > 0 ? Math.min(proxy / 10000, 1) : null,
        personal_data_present: piiDetected,
        post_published_at: m.timestamp ?? null,
        raw_response: { permalink: m.permalink, media_type: m.media_type, brand_label: c.brand_label },
      });
    }
    await supabaseAdmin
      .from('ig_competitor_handles')
      .update({ last_fetched_at: new Date().toISOString() })
      .eq('username', c.username);
    await new Promise((r) => setTimeout(r, 500));
  }

  let inserted = 0;
  if (upsertRows.length > 0) {
    const { error: upErr, count } = await supabaseAdmin
      .from('external_trend_posts')
      .upsert(upsertRows, { onConflict: 'platform,external_id', ignoreDuplicates: false, count: 'exact' });
    if (upErr) errors.push(`UPSERT 실패: ${upErr.message}`);
    else inserted = count ?? upsertRows.length;
  }

  return {
    hashtags_called: picked.length,
    competitors_called: (compRows ?? []).length,
    posts_collected: upsertRows.length,
    upserted: inserted,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('ig-trend-miner', runIgTrendMiner);
