import { type NextRequest } from 'next/server';
import { canCreateAttractionRecord } from '@/lib/attraction-policy';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { reEnrichAffectedPackages } from '@/lib/package-reenrich-on-attraction-change';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { cleanActivity, suggestAttractionsForActivity, type AttractionSuggestRow } from '@/lib/unmatched-suggest';
import {
  closeUnmatchedAsCandidateQueued,
  countActiveUnmatched,
} from '@/lib/unmatched-lifecycle';

export const dynamic = 'force-dynamic';

type UnmatchedRow = {
  id: string;
  activity: string;
  region: string | null;
  country: string | null;
  note: string | null;
  segment_kind_guess: string | null;
  confidence: number | null;
};

type WikidataSuggestion = {
  qid: string;
  label_ko: string | null;
  label_en: string | null;
  description: string | null;
  image_url: string | null;
  confidence: number;
};

function limitFrom(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get('limit') ?? process.env.UNMATCHED_AUTO_RESOLVE_LIMIT ?? '500';
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.min(2000, Math.floor(value))) : 500;
}

function minScoreFrom(): number {
  const value = Number(process.env.UNMATCHED_AUTO_RESOLVE_MIN_SCORE ?? 75);
  return Number.isFinite(value) ? value : 75;
}

type AutoResolveOptions = {
  limit?: number;
  minScore?: number;
  wikidataEnabled?: boolean;
};

async function addAlias(attractionId: string, aliases: string[] | null, alias: string, now: string) {
  const cleanAlias = alias.replace(/\s+/g, ' ').trim();
  if (!cleanAlias || aliases?.includes(cleanAlias)) return;
  const { error } = await supabaseAdmin
    .from('attractions')
    .update({ aliases: [...new Set([...(aliases ?? []), cleanAlias])], updated_at: now })
    .eq('id', attractionId);
  if (error) throw error;
}

async function queueWikidataCandidate(unmatched: UnmatchedRow, top: WikidataSuggestion, now: string): Promise<number> {
  const label = top.label_ko || top.label_en || unmatched.activity;
  const candidateKey = `wikidata:${top.qid}:${unmatched.country ?? ''}:${unmatched.region ?? ''}`;
  const { data, error } = await supabaseAdmin
    .from('entity_master_candidates')
    .upsert({
      candidate_key: candidateKey,
      category: 'attraction',
      raw_label: unmatched.activity,
      normalized_label: label,
      destination_scope: unmatched.region ?? unmatched.country,
      country_scope: unmatched.country,
      region_scope: unmatched.region,
      evidence_count: 1,
      occurrence_count: 1,
      package_count: 0,
      source_unmatched_ids: [unmatched.id],
      source_context: {
        analyzer: 'unmatched-auto-resolve-wikidata',
        analyzed_at: now,
        unmatched_activity: unmatched.activity,
      },
      external_sources: [{
        source: 'wikidata',
        id: top.qid,
        url: `https://www.wikidata.org/wiki/${top.qid}`,
        confidence: top.confidence,
        name: label,
      }],
      suggested_master: {
        label,
        category: 'attraction',
        country: unmatched.country,
        region: unmatched.region,
        customer_publishable: false,
        verification_status: 'needs_review',
        wikidata_qid: top.qid,
        description: top.description,
        image_url: top.image_url,
      },
      confidence: Math.max(0.55, Math.min(0.85, top.confidence)),
      promotion_status: 'needs_review',
      auto_action: 'needs_review',
      decision_reason: 'Wikidata reconciliation suggestion requires review before master mutation',
      auto_verification_status: 'needs_review',
      verification_score: Math.max(0.55, Math.min(0.85, top.confidence)),
      canonical_name: label,
      canonical_name_source: 'wikidata',
      source_reliability_snapshot: {
        source_count: 1,
        sources: ['wikidata'],
        wikidata_top_score: top.confidence,
      },
      updated_at: now,
    }, { onConflict: 'candidate_key' })
    .select('id, candidate_key, category, promotion_status, canonical_name, normalized_label')
    .single();
  if (error || !data) throw error ?? new Error('failed to queue Wikidata candidate');

  const candidate = data as {
    id: string;
    candidate_key: string;
    category: string;
    promotion_status: string;
    canonical_name: string | null;
    normalized_label: string | null;
  };
  return closeUnmatchedAsCandidateQueued([unmatched.id], {
    candidateId: candidate.id,
    candidateKey: candidate.candidate_key,
    candidateStatus: candidate.promotion_status,
    candidateCategory: candidate.category,
    candidateLabel: candidate.canonical_name ?? candidate.normalized_label,
    resolvedBy: 'cron_unmatched_auto_resolve',
  });
}

async function runUnmatchedAutoResolve(options: AutoResolveOptions = {}) {
  if (!isSupabaseConfigured) {
    return { ok: true, scanned: 0, resolved: 0, wikidataSuggested: 0, errors: [] as string[] };
  }

  const minScore = options.minScore ?? minScoreFrom();
  const limit = options.limit ?? 500;
  const wikidataEnabled = options.wikidataEnabled ?? process.env.UNMATCHED_AUTO_RESOLVE_WIKIDATA !== 'false';
  const errors: string[] = [];
  const affectedAttractionIds = new Set<string>();
  let scanned = 0;
  let resolved = 0;
  let wikidataSuggested = 0;

  const [{ data: unresolved, error: unmatchedError }, { data: attractions, error: attractionsError }] = await Promise.all([
    supabaseAdmin
      .from('unmatched_activities')
      .select('id, activity, region, country, note, segment_kind_guess, confidence')
      .eq('status', 'pending')
      .is('resolved_at', null)
      .order('occurrence_count', { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, region, country, category, emoji, short_desc')
      .eq('is_active', true)
      .limit(5000),
  ]);
  if (unmatchedError) throw unmatchedError;
  if (attractionsError) throw attractionsError;

  const candidateRows = (attractions ?? []) as AttractionSuggestRow[];
  for (const row of (unresolved ?? []) as UnmatchedRow[]) {
    scanned += 1;
    try {
      const entityKind = row.segment_kind_guess ?? 'attraction';
      if (entityKind !== 'attraction') continue;

      const scoped = candidateRows.filter(attraction =>
        (!row.region || !attraction.region || attraction.region === row.region) &&
        (!row.country || !attraction.country || attraction.country === row.country));
      const pool = scoped.length > 0 ? scoped : candidateRows;
      const { suggestions } = suggestAttractionsForActivity(row.activity, pool, minScore, 1);
      const now = new Date().toISOString();

      if (suggestions.length > 0) {
        const top = suggestions[0];
        const { data: target, error: targetError } = await supabaseAdmin
          .from('attractions')
          .select('id, aliases')
          .eq('id', top.id)
          .single();
        if (targetError || !target) throw targetError ?? new Error('matched attraction not found');

        await addAlias(top.id, (target as { aliases: string[] | null }).aliases, row.activity, now);
        const { error: updateError } = await supabaseAdmin
          .from('unmatched_activities')
          .update({
            status: 'added',
            resolved_at: now,
            resolved_kind: 'auto_cron_high_confidence',
            resolved_attraction_id: top.id,
            resolved_by: 'cron_unmatched_auto_resolve',
            updated_at: now,
          })
          .eq('id', row.id)
          .eq('status', 'pending')
          .is('resolved_at', null);
        if (updateError) throw updateError;
        resolved += 1;
        affectedAttractionIds.add(top.id);
        continue;
      }

      if (!wikidataEnabled) continue;
      const cleaned = cleanActivity(row.activity);
      if (!cleaned || cleaned.length < 2) continue;

      const { reconcilePlaceName } = await import('@/lib/wikidata-reconcile');
      const reconciled = await reconcilePlaceName(cleaned, {
        country: row.country || undefined,
        typeId: 'Q570',
        topRes: 3,
      });
      if (reconciled.length === 0) continue;

      const top = reconciled[0] as WikidataSuggestion;
      if (top.confidence >= 0.85) {
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('attractions')
          .select('id, aliases')
          .eq('qid', top.qid)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) {
          await addAlias((existing as { id: string }).id, (existing as { aliases: string[] | null }).aliases, row.activity, now);
          const { error: updateError } = await supabaseAdmin
            .from('unmatched_activities')
            .update({
              status: 'added',
              note: `auto-matched: ${top.qid} (conf=${top.confidence.toFixed(2)})`,
              resolved_at: now,
              resolved_kind: 'auto_cron_wikidata_match',
              resolved_attraction_id: (existing as { id: string }).id,
              resolved_by: 'cron_unmatched_auto_resolve',
              updated_at: now,
            })
            .eq('id', row.id)
            .eq('status', 'pending')
            .is('resolved_at', null);
          if (updateError) throw updateError;
          resolved += 1;
          affectedAttractionIds.add((existing as { id: string }).id);
          continue;
        }

        if (canCreateAttractionRecord('cron')) {
          errors.push('policy violation: cron attraction auto-create must be disabled');
        }
      }

      const closed = await queueWikidataCandidate(row, top, now);
      resolved += closed;
      wikidataSuggested += 1;
    } catch (error) {
      errors.push(sanitizeDbError(error, `failed to resolve unmatched ${row.id}`));
    }
  }

  let reenrich: { scanned_packages: number; updated_packages: number; revalidated_paths: number } | null = null;
  if (affectedAttractionIds.size > 0) {
    try {
      const result = await reEnrichAffectedPackages([...affectedAttractionIds], { maxPackages: 200 });
      reenrich = {
        scanned_packages: result.scanned_packages,
        updated_packages: result.updated_packages,
        revalidated_paths: result.revalidated_paths,
      };
    } catch (error) {
      errors.push(sanitizeDbError(error, 're-enrich failed'));
    }
  }

  return {
    ok: errors.length === 0,
    scanned,
    resolved,
    minScore,
    wikidataSuggested,
    reenrich,
    active_pending_after: await countActiveUnmatched(),
    errors: errors.slice(0, 20),
  };
}

async function handleUnmatchedAutoResolve(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  try {
    return await runUnmatchedAutoResolve({
      limit: limitFrom(request),
      minScore: minScoreFrom(),
      wikidataEnabled: process.env.UNMATCHED_AUTO_RESOLVE_WIKIDATA !== 'false',
    });
  } catch (error) {
    const message = sanitizeDbError(error, 'unmatched auto resolve failed');
    return { ok: false, error: message, errors: [message] };
  }
}

export const GET = withCronLogging('unmatched-auto-resolve', handleUnmatchedAutoResolve);
