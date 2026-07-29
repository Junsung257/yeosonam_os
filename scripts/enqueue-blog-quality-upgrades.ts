#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import type { BlogInformationIntent } from '../src/lib/blog-information-contract';
import type { BlogInformationAudience } from '../src/lib/blog-information-planner';
import {
  PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
} from '../src/lib/blog-private-regeneration';
import {
  deduplicateBlogQualityUpgradeCandidates,
  matchesBlogQualityUpgradeFilter,
} from '../src/lib/blog-quality-upgrade-selection';
import { evaluatePublishedBlogQualityUpgradeCandidate } from '../src/lib/blog-quality-upgrade-candidate';
import { buildBlogInformationRepresentativeKey } from '../src/lib/blog-information-representative';
import {
  hasReviewedBlogResearchCoverage,
  type BlogResearchOfficialDocumentCapability,
  type BlogResearchRegistryCapability,
  type BlogResearchReputableCapability,
} from '../src/lib/blog-research-capability';

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
  intent: BlogInformationIntent;
  audience: BlogInformationAudience;
  locale: string;
  status: string;
};

const DETERMINISTIC_BULK_UPGRADE_INTENTS = new Set<BlogInformationIntent>([
  'monthly_weather',
]);

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
    const decision = evaluatePublishedBlogQualityUpgradeCandidate(post);
    return { post, decision };
  });
  const eligibleCandidates = evaluated
    .flatMap(({ post, decision }) => decision.accepted
      ? [{ post, ...decision }]
      : []);
  const candidates = eligibleCandidates
    .filter(({ post }) => !destination || post.destination === destination)
    .filter(({ brief, microAngle }) => matchesBlogQualityUpgradeFilter({
      filter: only,
      intent: brief.intentType,
      microAngle,
    }));

  const [registryResult, officialDocumentsResult, reputableSourcesResult] = await Promise.all([
    supabaseAdmin
      .from('blog_information_official_source_registry')
      .select('id,source_type,status'),
    supabaseAdmin
      .from('blog_information_official_research_documents')
      .select('official_source_registry_id,source_url,intents,destinations,status'),
    supabaseAdmin
      .from('blog_information_reputable_source_registry')
      .select('source_types,intents,research_urls,research_destinations,status'),
  ]);
  if (registryResult.error) throw new Error(registryResult.error.message);
  if (officialDocumentsResult.error) throw new Error(officialDocumentsResult.error.message);
  if (reputableSourcesResult.error) throw new Error(reputableSourcesResult.error.message);

  const registries = (registryResult.data ?? []) as BlogResearchRegistryCapability[];
  const officialDocuments = (
    officialDocumentsResult.data ?? []
  ) as BlogResearchOfficialDocumentCapability[];
  const reputableSources = (
    reputableSourcesResult.data ?? []
  ) as BlogResearchReputableCapability[];
  const hasResearchCoverage = (
    candidate: (typeof candidates)[number],
  ): boolean => hasReviewedBlogResearchCoverage({
    intent: candidate.brief.intentType,
    destination: candidate.post.destination ?? '',
    allowedSourceTypes: candidate.brief.sourcePolicy.sourceTypes,
    registries,
    officialDocuments,
    reputableSources,
  });
  const researchCoveredCandidates = candidates.filter(hasResearchCoverage);
  const researchNonDeterministicCandidates = researchCoveredCandidates.filter(
    candidate => !DETERMINISTIC_BULK_UPGRADE_INTENTS.has(candidate.brief.intentType),
  );
  const researchCapableCandidates = researchCoveredCandidates.filter(
    candidate => DETERMINISTIC_BULK_UPGRADE_INTENTS.has(candidate.brief.intentType),
  );
  const researchUnsupportedCandidates = candidates.filter(
    candidate => !hasResearchCoverage(candidate)
      || !DETERMINISTIC_BULK_UPGRADE_INTENTS.has(candidate.brief.intentType),
  );

  const { data: representatives, error: representativesError } = await supabaseAdmin
    .from('blog_information_representatives')
    .select('canonical_creative_id,destination_id,intent,audience,locale,status')
    .in('status', ['reserved', 'active', 'retired']);
  if (representativesError) throw new Error(representativesError.message);
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
  const canonicalCandidates = researchCapableCandidates.filter(({ post, representativeKey }) => {
    const representative = representativeByIdentity.get(representativeKey);
    if (!representative) return true;
    return representative.status === 'active'
      && representative.canonical_creative_id === post.id;
  });
  const representativeDuplicatesSkipped = candidates.length - canonicalCandidates.length;
  const sameRunDeduplication = deduplicateBlogQualityUpgradeCandidates(
    canonicalCandidates,
    candidate => candidate.representativeKey,
  );
  const uniqueCanonicalCandidates = sameRunDeduplication.selected;
  const now = new Date().toISOString();

  let unsupportedActiveUpgradesPruned = 0;
  if (write && researchUnsupportedCandidates.length > 0) {
    const unsupportedIds = researchUnsupportedCandidates.map(({ post }) => post.id);
    for (let offset = 0; offset < unsupportedIds.length; offset += 100) {
      const ids = unsupportedIds.slice(offset, offset + 100);
      const { data, error } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({
          status: 'skipped',
          last_error: 'quality_upgrade_research_capability_unavailable',
          updated_at: now,
        })
        .in('content_creative_id', ids)
        .eq('source', 'user_seed')
        .eq('status', 'queued')
        .contains('meta', {
          quality_upgrade: { version: 'published-research-upgrade-v1' },
        })
        .select('id');
      if (error) throw new Error(error.message);
      unsupportedActiveUpgradesPruned += data?.length ?? 0;
    }
  }

  const candidateIds = uniqueCanonicalCandidates.map(({ post }) => post.id);
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

  let activeUpgradesRetopiced = 0;
  if (write && candidateIds.length > 0) {
    const candidateByCreativeId = new Map(
      uniqueCanonicalCandidates.map(candidate => [candidate.post.id, candidate]),
    );
    for (let offset = 0; offset < candidateIds.length; offset += 100) {
      const ids = candidateIds.slice(offset, offset + 100);
      const { data, error } = await supabaseAdmin
        .from('blog_topic_queue')
        .select('id,content_creative_id,topic')
        .in('content_creative_id', ids)
        .eq('source', 'user_seed')
        .eq('status', 'queued')
        .contains('meta', {
          quality_upgrade: { version: 'published-research-upgrade-v1' },
        });
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const candidate = candidateByCreativeId.get(row.content_creative_id ?? '');
        if (!candidate || row.topic === candidate.queueTopic) continue;
        const { error: updateError } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            topic: candidate.queueTopic,
            primary_keyword: candidate.queueTopic,
            attempts: 0,
            last_error: null,
            updated_at: now,
          })
          .eq('id', row.id)
          .eq('status', 'queued');
        if (updateError) throw new Error(updateError.message);
        activeUpgradesRetopiced += 1;
      }
    }
  }

  const selected = uniqueCanonicalCandidates
    .filter(({ post }) => !activeIds.has(post.id))
    .slice(0, limit);
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
  const rejectionReasons = evaluated
    .filter(({ decision }) => !decision.accepted)
    .reduce<Record<string, number>>((counts, { decision }) => {
      counts[decision.reason] = (counts[decision.reason] ?? 0) + 1;
      return counts;
    }, {});
  const candidateIntentCounts = uniqueCanonicalCandidates.reduce<Record<string, number>>(
    (counts, { brief }) => {
      counts[brief.intentType] = (counts[brief.intentType] ?? 0) + 1;
      return counts;
    },
    {},
  );

  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run',
    checked_at: now,
    published_checked: published.length,
    missing_verified_research: missingResearch.length,
    safe_automatic_candidates: uniqueCanonicalCandidates.length,
    research_capability_unavailable_skipped: researchUnsupportedCandidates.length,
    non_deterministic_research_upgrade_skipped: researchNonDeterministicCandidates.length,
    active_unsupported_upgrades_pruned: unsupportedActiveUpgradesPruned,
    active_upgrades_retopiced: activeUpgradesRetopiced,
    manual_review_or_invalid_skipped: evaluated.length - eligibleCandidates.length,
    rejection_reasons: rejectionReasons,
    operator_filter_skipped: eligibleCandidates.length - candidates.length,
    representative_duplicates_skipped: representativeDuplicatesSkipped,
    same_run_duplicates_skipped: sameRunDeduplication.duplicateCount,
    active_upgrade_skipped: uniqueCanonicalCandidates.filter(({ post }) => activeIds.has(post.id)).length,
    candidate_intent_counts: candidateIntentCounts,
    selected: rows.length,
    inserted,
    only: only || null,
    destination: destination || null,
    samples: selected.slice(0, 20).map(({ post, brief, microAngle }) => ({
      id: post.id,
      slug: post.slug,
      destination: post.destination,
      micro_angle: microAngle,
      intent: brief.intentType,
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
