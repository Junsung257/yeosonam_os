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
  PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
} from '@/lib/blog-private-regeneration';
import { evaluatePublishedBlogQualityUpgradeCandidate } from '@/lib/blog-quality-upgrade-candidate';
import { buildBlogInformationRepresentativeKey } from '@/lib/blog-information-representative';
import type { BlogInformationIntent } from '@/lib/blog-information-contract';
import type { BlogInformationAudience } from '@/lib/blog-information-planner';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 14;
const COOLDOWN_DAYS = 7;
const MAX_BATCH = 2;
const CANDIDATE_POOL_LIMIT = 500;

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
  generation_meta: Record<string, unknown> | null;
  published_at: string | null;
}

interface RegenResult {
  slug: string;
  status: 'queued_upgrade' | 'cooldown' | 'race_skipped' | 'log_failed' | 'queue_failed' | 'high_risk_review';
  reason?: string;
  queueId?: string;
}

interface InformationRepresentative {
  canonical_creative_id: string | null;
  destination_id: string;
  intent: BlogInformationIntent;
  audience: BlogInformationAudience;
  locale: string;
  status: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasVerifiedResearch(meta: Record<string, unknown> | null): boolean {
  const preflight = record(meta?.information_research_preflight);
  const sourceKeys = Array.isArray(preflight.source_keys) ? preflight.source_keys : [];
  const evidenceKeys = Array.isArray(preflight.evidence_keys) ? preflight.evidence_keys : [];
  return preflight.passed === true && sourceKeys.length > 0 && evidenceKeys.length > 0;
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
    if (rankError) errors.push(`rank_history lookup failed: ${rankError.message}`);

    const performance = new Map<string, { impressions: number; clicks: number }>();
    for (const row of (rankRows ?? []) as RankRow[]) {
      if (!row.slug) continue;
      const current = performance.get(row.slug) ?? { impressions: 0, clicks: 0 };
      current.impressions += row.impressions ?? 0;
      current.clicks += row.clicks ?? 0;
      performance.set(row.slug, current);
    }
    const zeroClickSlugs = [...performance.entries()]
      .filter(([, value]) => value.impressions === 0 && value.clicks === 0)
      .map(([slug]) => slug);
    const zeroClickSet = new Set(zeroClickSlugs);

    const { data: cooldownRows, error: cooldownError } = await supabaseAdmin
      .from('blog_regenerate_log')
      .select('slug')
      .gte('created_at', cooldownSince);
    if (cooldownError) errors.push(`regeneration cooldown lookup failed: ${cooldownError.message}`);
    const cooldownSet = new Set((cooldownRows ?? []).map(row => row.slug));

    const { data: posts, error: postError } = await supabaseAdmin
      .from('content_creatives')
      .select('id,slug,seo_title,blog_html,destination,angle_type,category,content_type,generation_meta,published_at')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .is('product_id', null)
      .not('slug', 'is', null)
      .order('published_at', { ascending: true, nullsFirst: true })
      .limit(CANDIDATE_POOL_LIMIT);
    if (postError) return { processed: 0, errors: [...errors, postError.message], results };

    const publishedPosts = (posts ?? []) as PublishedPost[];
    const prioritizedPosts = publishedPosts
      .filter(post => zeroClickSet.has(post.slug) || !hasVerifiedResearch(post.generation_meta))
      .filter(post => !cooldownSet.has(post.slug))
      .sort((left, right) => {
        const priorityDelta = Number(zeroClickSet.has(right.slug)) - Number(zeroClickSet.has(left.slug));
        if (priorityDelta !== 0) return priorityDelta;
        return (left.published_at ?? '').localeCompare(right.published_at ?? '');
      });

    const { data: representatives, error: representativesError } = await supabaseAdmin
      .from('blog_information_representatives')
      .select('canonical_creative_id,destination_id,intent,audience,locale,status')
      .in('status', ['reserved', 'active', 'retired']);
    if (representativesError) {
      return { processed: 0, errors: [...errors, representativesError.message], results };
    }
    const representativeByIdentity = new Map(
      ((representatives ?? []) as InformationRepresentative[]).map(representative => [
        buildBlogInformationRepresentativeKey({
          destinationId: representative.destination_id,
          intent: representative.intent,
          audience: representative.audience,
          locale: representative.locale,
        }),
        representative,
      ]),
    );

    const rejectionCounts: Record<string, number> = {};
    let considered = 0;
    let queued = 0;

    for (const post of prioritizedPosts) {
      if (queued >= MAX_BATCH) break;
      const slug = post.slug;

      if (isHighRiskInformationalTopic({
        title: post.seo_title,
        category: post.category,
        contentType: post.content_type,
      })) {
        rejectionCounts.high_risk_review = (rejectionCounts.high_risk_review ?? 0) + 1;
        results.push({
          slug,
          status: 'high_risk_review',
          reason: 'Published high-risk information requires human review',
        });
        continue;
      }

      const decision = evaluatePublishedBlogQualityUpgradeCandidate(post);
      if (!decision.accepted) {
        rejectionCounts[decision.reason] = (rejectionCounts[decision.reason] ?? 0) + 1;
        continue;
      }
      const representative = representativeByIdentity.get(decision.representativeKey);
      if (
        representative
        && (
          representative.status !== 'active'
          || representative.canonical_creative_id !== post.id
        )
      ) {
        rejectionCounts.representative_conflict = (rejectionCounts.representative_conflict ?? 0) + 1;
        continue;
      }

      considered += 1;
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

      const selectionSource = zeroClickSet.has(slug) ? 'zero_click' : 'quality_gap';
      const createdDayUtc = Math.floor(Date.now() / 86_400_000);
      const { data: lockRows, error: lockError } = await supabaseAdmin
        .from('blog_regenerate_log')
        .insert({
          post_id: post.id,
          slug,
          old_html_hash: sha256(post.blog_html ?? ''),
          reason: selectionSource,
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
          errors.push(`${slug} lock insert failed: ${lockError.message}`);
          results.push({ slug, status: 'log_failed', reason: lockError.message });
        }
        continue;
      }

      const logId = lockRows?.[0]?.id;
      const queueTopic = decision.queueTopic;
      const { data: queueRows, error: queueError } = await supabaseAdmin
        .from('blog_topic_queue')
        .insert({
          topic: queueTopic,
          source: 'user_seed',
          priority: selectionSource === 'zero_click' ? 85 : 70,
          primary_keyword: queueTopic,
          destination: post.destination,
          angle_type: post.angle_type || 'value',
          category: post.category || 'travel_tips',
          content_creative_id: post.id,
          target_publish_at: new Date().toISOString(),
          meta: {
            writer_type: 'info_writer',
            expected_slug: post.slug,
            ...(decision.microAngle ? { micro_angle: decision.microAngle } : {}),
            quality_upgrade: {
              version: 'published-research-upgrade-v1',
              enqueued_at: new Date().toISOString(),
              reason: selectionSource === 'zero_click'
                ? 'zero_click_performance_upgrade'
                : 'missing_verified_information_research',
              intent: decision.brief.intentType,
              selection_source: selectionSource,
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
        errors.push(`${slug} queue insert failed: ${queueError.message}`);
        if (logId) {
          await supabaseAdmin
            .from('blog_regenerate_log')
            .update({ gate_summary: `queue_failed:${queueError.message}`.slice(0, 1000) })
            .eq('id', logId);
        }
        results.push({ slug, status: 'queue_failed', reason: queueError.message });
        continue;
      }

      queued += 1;
      results.push({ slug, status: 'queued_upgrade', queueId: queueRows?.[0]?.id });
    }

    return {
      processed: considered,
      queued,
      max_batch: MAX_BATCH,
      performance_window_days: WINDOW_DAYS,
      performance_rows: rankRows?.length ?? 0,
      zero_click_candidates: zeroClickSlugs.length,
      quality_gap_candidates: prioritizedPosts.filter(post => !zeroClickSet.has(post.slug)).length,
      rejection_counts: rejectionCounts,
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
