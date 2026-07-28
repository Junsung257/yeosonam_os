/**
 * Queues low-performing published informational posts for an in-place,
 * research-first upgrade. The live article is never changed in this route.
 */

import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isHighRiskInformationalTopic } from '@/lib/blog-publication-review-policy';
import {
  buildPublishedBlogUpgradeQueueTopic,
  PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
} from '@/lib/blog-private-regeneration';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 14;
const COOLDOWN_DAYS = 7;
const MAX_BATCH = 5;

interface RankRow {
  slug: string;
  impressions: number | null;
  clicks: number | null;
}

interface PublishedPost {
  id: string;
  slug: string;
  seo_title: string | null;
  blog_html: string | null;
  destination: string | null;
  angle_type: string | null;
  category: string | null;
  content_type: string | null;
}

interface RegenResult {
  slug: string;
  status: 'queued_upgrade' | 'cooldown' | 'no_post' | 'race_skipped' | 'log_failed' | 'queue_failed' | 'high_risk_review';
  reason?: string;
  queueId?: string;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function runRegenerator(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];
  const results: RegenResult[] = [];
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().split('T')[0];
  const cooldownSince = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000).toISOString();

  try {
    const { data: rankRows, error: rankError } = await supabaseAdmin
      .from('rank_history')
      .select('slug, impressions, clicks')
      .gte('date', since);
    if (rankError) return { processed: 0, errors: [rankError.message], results };
    if (!rankRows || rankRows.length === 0) {
      return { processed: 0, message: 'rank_history 데이터 없음', errors, results };
    }

    const performance = new Map<string, { impressions: number; clicks: number }>();
    for (const row of rankRows as RankRow[]) {
      if (!row.slug) continue;
      const current = performance.get(row.slug) ?? { impressions: 0, clicks: 0 };
      current.impressions += row.impressions ?? 0;
      current.clicks += row.clicks ?? 0;
      performance.set(row.slug, current);
    }
    const zeroClickSlugs = [...performance.entries()]
      .filter(([, value]) => value.impressions === 0 && value.clicks === 0)
      .map(([slug]) => slug)
      .slice(0, MAX_BATCH * 4);
    if (zeroClickSlugs.length === 0) {
      return { processed: 0, message: '14일 zero-impression slug 없음', errors, results };
    }

    const { data: cooldownRows } = await supabaseAdmin
      .from('blog_regenerate_log')
      .select('slug')
      .gte('created_at', cooldownSince)
      .in('slug', zeroClickSlugs);
    const cooldownSet = new Set((cooldownRows ?? []).map(row => row.slug));
    const candidateSlugs = zeroClickSlugs
      .filter(slug => !cooldownSet.has(slug))
      .slice(0, MAX_BATCH);
    if (candidateSlugs.length === 0) {
      return { processed: 0, message: '후보 모두 cooldown 중', errors, results };
    }

    const { data: posts, error: postError } = await supabaseAdmin
      .from('content_creatives')
      .select('id,slug,seo_title,blog_html,destination,angle_type,category,content_type')
      .in('slug', candidateSlugs)
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .is('product_id', null);
    if (postError) return { processed: 0, errors: [postError.message], results };
    const postBySlug = new Map(
      ((posts ?? []) as PublishedPost[]).map(post => [post.slug, post]),
    );

    for (const slug of candidateSlugs) {
      const post = postBySlug.get(slug);
      if (!post) {
        results.push({ slug, status: 'no_post', reason: 'published info 글 아님' });
        continue;
      }
      if (isHighRiskInformationalTopic({
        title: post.seo_title,
        category: post.category,
        contentType: post.content_type,
      })) {
        results.push({
          slug,
          status: 'high_risk_review',
          reason: 'Published high-risk information requires human review',
        });
        continue;
      }

      const { data: activeUpgrade } = await supabaseAdmin
        .from('blog_topic_queue')
        .select('id')
        .eq('content_creative_id', post.id)
        .in('status', ['queued', 'generating', 'pending_review'])
        .limit(1)
        .maybeSingle();
      if (activeUpgrade) {
        results.push({ slug, status: 'cooldown', reason: 'active upgrade already queued' });
        continue;
      }

      const createdDayUtc = Math.floor(Date.now() / 86_400_000);
      const { data: lockRows, error: lockError } = await supabaseAdmin
        .from('blog_regenerate_log')
        .insert({
          post_id: post.id,
          slug,
          old_html_hash: sha256(post.blog_html ?? ''),
          reason: 'zero_click',
          gate_passed: false,
          gate_summary: 'queued_research_upgrade',
          created_day_utc: createdDayUtc,
        })
        .select('id')
        .limit(1);
      if (lockError) {
        if (lockError.code === '23505') {
          results.push({ slug, status: 'race_skipped', reason: 'concurrent upgrade detected' });
        } else {
          errors.push(`${slug} lock insert 실패: ${lockError.message}`);
          results.push({ slug, status: 'log_failed', reason: lockError.message });
        }
        continue;
      }

      const logId = lockRows?.[0]?.id;
      const queueTopic = buildPublishedBlogUpgradeQueueTopic(post);
      const { data: queueRows, error: queueError } = await supabaseAdmin
        .from('blog_topic_queue')
        .insert({
          topic: queueTopic,
          source: 'user_seed',
          priority: 85,
          primary_keyword: queueTopic,
          destination: post.destination,
          angle_type: post.angle_type || 'value',
          category: post.category || 'travel_tips',
          content_creative_id: post.id,
          target_publish_at: new Date().toISOString(),
          meta: {
            expected_slug: post.slug,
            zero_click_upgrade: {
              version: 'published-research-upgrade-v1',
              enqueued_at: new Date().toISOString(),
            },
            private_regeneration: {
              mode: PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
              atomic_publish_replace: true,
            },
          },
        })
        .select('id')
        .limit(1);
      if (queueError) {
        errors.push(`${slug} queue insert 실패: ${queueError.message}`);
        if (logId) {
          await supabaseAdmin
            .from('blog_regenerate_log')
            .update({ gate_summary: `queue_failed:${queueError.message}`.slice(0, 1000) })
            .eq('id', logId);
        }
        results.push({ slug, status: 'queue_failed', reason: queueError.message });
        continue;
      }
      results.push({ slug, status: 'queued_upgrade', queueId: queueRows?.[0]?.id });
    }

    return {
      processed: candidateSlugs.length,
      queued: results.filter(result => result.status === 'queued_upgrade').length,
      results,
      errors,
      ranAt: new Date().toISOString(),
    };
  } catch (error) {
    errors.push(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    return { processed: 0, errors, results };
  }
}

export const GET = withCronLogging('blog-regenerate-zero-click', runRegenerator, {
  handlerTimeoutMs: 55_000,
  sideEffectTimeoutMs: 5_000,
});
