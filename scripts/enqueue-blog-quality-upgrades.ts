#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import { buildBlogContentBrief } from '../src/lib/blog-content-brief';
import {
  buildPublishedBlogUpgradeQueueTopic,
  PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
} from '../src/lib/blog-private-regeneration';

type PublishedBlog = {
  id: string;
  slug: string;
  seo_title: string | null;
  destination: string | null;
  angle_type: string | null;
  category: string | null;
  generation_meta: Record<string, unknown> | null;
};

type InformationRepresentative = {
  canonical_creative_id: string | null;
  destination_id: string;
  intent: string;
  audience: string;
  locale: string;
  status: string;
};

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function positiveNumberArg(name: string, fallback: number, max: number): number {
  const parsed = Number(argValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasVerifiedResearch(meta: PublishedBlog['generation_meta']): boolean {
  const preflight = record(meta?.information_research_preflight);
  const sourceKeys = Array.isArray(preflight.source_keys) ? preflight.source_keys : [];
  const evidenceKeys = Array.isArray(preflight.evidence_keys) ? preflight.evidence_keys : [];
  return preflight.passed === true && sourceKeys.length > 0 && evidenceKeys.length > 0;
}

function inferMicroAngle(post: PublishedBlog): string | null {
  const text = `${post.slug} ${post.seo_title ?? ''} ${post.category ?? ''}`.toLowerCase();
  if (/weather|climate|날씨|옷차림|우기|건기/.test(text)) return 'weather_packing';
  if (/hotel|resort|숙소|호텔|리조트|지역 선택/.test(text)) return 'hotel_area';
  if (/food|meal|식비|맛집|메뉴/.test(text)) return 'food_budget';
  if (/shopping|souvenir|쇼핑|선물|기념품/.test(text)) return 'shopping_budget';
  if (/airport|arrival|공항|입국.*동선/.test(text)) return 'airport_arrival';
  if (/transport|taxi|rental|교통|택시|렌터카|이동비/.test(text)) return 'transport_cost';
  if (/kid|child|family itinerary|아이|어린이|가족.*일정/.test(text)) return 'kid_friendly';
  if (/budget|cost|expense|예산|경비|비용/.test(text)) return 'budget_family';
  return null;
}

async function main() {
  const write = process.argv.includes('--write');
  const limit = positiveNumberArg('--limit', 25, 500);
  const only = (argValue('--only') ?? '').toLowerCase();
  const destination = argValue('--destination');

  const { data: posts, error: postsError } = await supabaseAdmin
    .from('content_creatives')
    .select('id,slug,seo_title,destination,angle_type,category,generation_meta')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .is('product_id', null)
    .order('published_at', { ascending: true })
    .limit(500);
  if (postsError) throw new Error(postsError.message);

  const published = (posts ?? []) as PublishedBlog[];
  const missingResearch = published
    .filter(post => post.slug && !hasVerifiedResearch(post.generation_meta));
  const evaluated = missingResearch.map(post => {
    const microAngle = inferMicroAngle(post);
    const queueTopic = buildPublishedBlogUpgradeQueueTopic(post);
    const brief = buildBlogContentBrief({
      topic: queueTopic,
      destination: post.destination,
      primaryKeyword: queueTopic,
      category: post.category,
      source: 'user_seed',
      microAngle,
      locale: 'ko-KR',
    });
    return { post, microAngle, brief, queueTopic };
  });
  const candidates = evaluated
    .filter(({ post, brief }) =>
      Boolean(post.destination?.trim())
      && brief.passed
      && !brief.requiresHumanReview)
    .filter(({ post }) => !destination || post.destination === destination)
    .filter(post => {
      if (!only) return true;
      const microAngle = post.microAngle;
      return only === 'weather'
        ? microAngle === 'weather_packing'
        : microAngle === only;
    });

  const { data: representatives, error: representativesError } = await supabaseAdmin
    .from('blog_information_representatives')
    .select('canonical_creative_id,destination_id,intent,audience,locale,status')
    .eq('status', 'active');
  if (representativesError) throw new Error(representativesError.message);
  const canonicalByIdentity = new Map(
    ((representatives ?? []) as InformationRepresentative[]).map(representative => [
      [
        representative.destination_id,
        representative.intent,
        representative.audience,
        representative.locale,
      ].join('|'),
      representative.canonical_creative_id,
    ]),
  );
  const canonicalCandidates = candidates.filter(({ post, brief }) => {
    const key = [
      brief.plan.destinationId,
      brief.intentType,
      brief.plan.audience,
      brief.plan.locale,
    ].join('|');
    const canonicalCreativeId = canonicalByIdentity.get(key);
    return !canonicalCreativeId || canonicalCreativeId === post.id;
  });
  const representativeDuplicatesSkipped = candidates.length - canonicalCandidates.length;

  const candidateIds = canonicalCandidates.map(({ post }) => post.id);
  const activeIds = new Set<string>();
  for (let offset = 0; offset < candidateIds.length; offset += 100) {
    const ids = candidateIds.slice(offset, offset + 100);
    if (ids.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('content_creative_id')
      .in('content_creative_id', ids)
      .in('status', ['queued', 'generating', 'pending_review']);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (typeof row.content_creative_id === 'string') activeIds.add(row.content_creative_id);
    }
  }

  const selected = canonicalCandidates
    .filter(({ post }) => !activeIds.has(post.id))
    .slice(0, limit);
  const now = new Date().toISOString();
  const rows = selected.map(({ post, microAngle, brief, queueTopic }, index) => {
    return {
      topic: queueTopic,
      source: 'user_seed',
      priority: 70,
      primary_keyword: queueTopic,
      destination: post.destination,
      angle_type: post.angle_type || 'value',
      category: post.category || 'travel_tips',
      content_creative_id: post.id,
      target_publish_at: new Date(Date.now() + index * 60_000).toISOString(),
      meta: {
        writer_type: 'info_writer',
        expected_slug: post.slug,
        ...(microAngle ? { micro_angle: microAngle } : {}),
        quality_upgrade: {
          version: 'published-research-upgrade-v1',
          enqueued_at: now,
          reason: 'missing_verified_information_research',
          intent: brief.intentType,
        },
        private_regeneration: {
          mode: PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
          atomic_publish_replace: true,
        },
      },
    };
  });

  let inserted = 0;
  if (write && rows.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .insert(rows)
      .select('id');
    if (error) throw new Error(error.message);
    inserted = data?.length ?? 0;
  }

  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run',
    checked_at: now,
    published_checked: published.length,
    missing_verified_research: missingResearch.length,
    safe_automatic_candidates: canonicalCandidates.length,
    manual_review_or_invalid_skipped: evaluated.length - candidates.length,
    representative_duplicates_skipped: representativeDuplicatesSkipped,
    active_upgrade_skipped: canonicalCandidates.filter(({ post }) => activeIds.has(post.id)).length,
    selected: rows.length,
    inserted,
    only: only || null,
    destination: destination || null,
    samples: selected.slice(0, 20).map(({ post, brief }) => ({
      id: post.id,
      slug: post.slug,
      destination: post.destination,
      micro_angle: inferMicroAngle(post),
      intent: brief.intentType,
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
