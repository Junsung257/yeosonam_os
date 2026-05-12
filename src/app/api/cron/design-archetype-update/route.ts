import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { analyzeCoverImage, archetypeBucketKey, type DesignArchetype } from '@/lib/design-archetype-extractor';
import { getPaletteForCategory } from '@/lib/card-news/tokens';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

/**
 * Design Archetype Update — 주 1회 (일요일 04:00 UTC)
 *
 * 흐름:
 *   1) external_trend_posts 에서 has_image=true 이고 archetype 분석 안 된 row 최대 N개 선택
 *      (recently captured + performance_score 상위)
 *   2) 각 cover_image_url → Gemini Vision 분석 (analyzeCoverImage)
 *   3) bucket_key 기준 집계 → card_news_design_archetypes UPSERT
 *   4) sample_count, avg_engagement_rate, top_hook_patterns 등 갱신
 *
 * 비용 가드: 한 회 실행당 최대 100 이미지 분석 (~$0.10).
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_IMAGES_PER_RUN = 100;

async function runDesignArchetypeUpdate(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];

  // 1) 분석 대상 선택 — cover_image_url 있고, 최근 7일 이내 captured, performance_score 상위
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const { data: candidates, error: fetchErr } = await supabaseAdmin
    .from('external_trend_posts')
    .select('id, external_id, cover_image_url, performance_score, hook_first_line, hook_type, related_destination, likes, comments')
    .eq('platform', 'instagram')
    .eq('has_image', true)
    .not('cover_image_url', 'is', null)
    .gte('captured_at', since.toISOString())
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(MAX_IMAGES_PER_RUN);

  if (fetchErr) {
    return { skipped: true, reason: `fetch 실패: ${fetchErr.message}`, errors };
  }
  if (!candidates || candidates.length === 0) {
    return { analyzed: 0, archetypes_updated: 0, errors, message: '분석 대상 없음' };
  }

  // 2) Gemini Vision 분석 → bucket 집계
  type BucketEntry = {
    archetype: DesignArchetype;
    posts: Array<typeof candidates[number]>;
  };
  const buckets = new Map<string, BucketEntry>();
  let analyzed = 0;
  let analysisFailures = 0;

  for (const post of candidates) {
    if (!post.cover_image_url) continue;

    const archetype = await analyzeCoverImage(post.cover_image_url);
    if (!archetype) {
      analysisFailures += 1;
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    analyzed += 1;
    const key = archetypeBucketKey(archetype);
    const entry = buckets.get(key);
    if (entry) {
      entry.posts.push(post);
    } else {
      buckets.set(key, { archetype, posts: [post] });
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // 3) bucket → card_news_design_archetypes upsert
  let archetypesUpdated = 0;
  for (const [bucketKey, entry] of buckets) {
    const palette = entry.archetype.palette_category;
    const paletteHint = getPaletteForCategory(palette);

    const likes = entry.posts.map((p) => p.likes ?? 0);
    const comments = entry.posts.map((p) => p.comments ?? 0);
    const scores = entry.posts.map((p) => Number(p.performance_score) || 0).filter((n) => n > 0);

    const avgLikes = likes.length > 0 ? likes.reduce((a, b) => a + b, 0) / likes.length : null;
    const avgComments = comments.length > 0 ? comments.reduce((a, b) => a + b, 0) / comments.length : null;
    const avgEr = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    const hookPatterns = Array.from(new Set(
      entry.posts.map((p) => p.hook_type).filter((h): h is string => Boolean(h))
    )).slice(0, 5);
    const keywords = Array.from(new Set(
      entry.posts.map((p) => p.related_destination).filter((d): d is string => Boolean(d))
    )).slice(0, 10);
    const sampleIds = entry.posts.map((p) => p.external_id).filter(Boolean).slice(0, 10);
    const sampleImages = entry.posts.map((p) => p.cover_image_url).filter((u): u is string => Boolean(u)).slice(0, 5);

    // 기존 row 있으면 sample_count 누적
    const { data: existing } = await supabaseAdmin
      .from('card_news_design_archetypes')
      .select('id, sample_count, top_hook_patterns, top_keywords, sample_external_ids, sample_image_urls')
      .eq('bucket_key', bucketKey)
      .limit(1);
    const existingRow = existing?.[0] as any;

    const mergedHookPatterns = Array.from(new Set([
      ...(existingRow?.top_hook_patterns ?? []),
      ...hookPatterns,
      entry.archetype.hook_pattern,
    ].filter(Boolean))).slice(0, 8);
    const mergedKeywords = Array.from(new Set([
      ...(existingRow?.top_keywords ?? []),
      ...keywords,
    ])).slice(0, 15);
    const mergedSampleIds = Array.from(new Set([
      ...(existingRow?.sample_external_ids ?? []),
      ...sampleIds,
    ])).slice(0, 10);
    const mergedSampleImages = Array.from(new Set([
      ...(existingRow?.sample_image_urls ?? []),
      ...sampleImages,
    ])).slice(0, 5);

    const newSampleCount = (existingRow?.sample_count ?? 0) + entry.posts.length;

    const { error: upErr } = await supabaseAdmin
      .from('card_news_design_archetypes')
      .upsert({
        bucket_key: bucketKey,
        palette_category: entry.archetype.palette_category,
        layout_type: entry.archetype.layout_type,
        dominant_emotion: entry.archetype.dominant_emotion,
        text_density: entry.archetype.text_density,
        sample_count: newSampleCount,
        avg_engagement_rate: avgEr,
        avg_likes: avgLikes,
        avg_comments: avgComments,
        top_hook_patterns: mergedHookPatterns,
        top_keywords: mergedKeywords,
        sample_external_ids: mergedSampleIds,
        sample_image_urls: mergedSampleImages,
        rationale: `${paletteHint.rationale} | ${entry.archetype.reasoning}`.slice(0, 500),
        is_active: true,
        last_updated_at: new Date().toISOString(),
      }, { onConflict: 'bucket_key' });
    if (upErr) errors.push(`archetype upsert ${bucketKey}: ${upErr.message}`);
    else archetypesUpdated += 1;
  }

  return {
    analyzed,
    analysis_failures: analysisFailures,
    archetypes_updated: archetypesUpdated,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('design-archetype-update', runDesignArchetypeUpdate);
