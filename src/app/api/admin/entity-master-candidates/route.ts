import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  resolveItineraryEntityCandidate,
  type EntityCandidateRow,
  type EntityResolutionDecision,
} from '@/lib/itinerary-entity-resolution-engine';
import { getGooglePlacesBudgetFromEnv } from '@/lib/google-places-entity-verifier';
import { reEnrichAffectedPackages } from '@/lib/package-reenrich-on-attraction-change';

const LIST_FIELDS = [
  'id',
  'candidate_key',
  'category',
  'raw_label',
  'normalized_label',
  'destination_scope',
  'country_scope',
  'region_scope',
  'evidence_count',
  'occurrence_count',
  'package_count',
  'source_context',
  'external_sources',
  'suggested_master',
  'confidence',
  'promotion_status',
  'auto_action',
  'auto_verification_status',
  'verification_score',
  'canonical_name',
  'canonical_name_source',
  'source_reliability_snapshot',
  'decision_reason',
  'promoted_at',
  'promoted_attraction_id',
  'created_at',
  'updated_at',
].join(', ');

function updatePayload(decision: EntityResolutionDecision) {
  return {
    external_sources: decision.externalSources,
    suggested_master: decision.suggestedMaster,
    confidence: decision.verificationScore,
    auto_action: decision.autoAction,
    promotion_status: decision.promotionStatus,
    decision_reason: decision.decisionReason,
    auto_verification_status: decision.autoVerificationStatus,
    verification_score: decision.verificationScore,
    canonical_name: decision.canonicalName,
    canonical_name_source: decision.canonicalNameSource,
    source_reliability_snapshot: {
      source_count: decision.externalSources.length,
      sources: [...new Set(decision.externalSources.map(source => source.source))],
      naver_search_score: decision.naver?.searchScore ?? null,
      naver_keyword_score: decision.naver?.keywordScore ?? null,
      osm_nominatim_score: decision.osmNominatim?.score ?? null,
      osm_nominatim_region_conflict: decision.osmNominatim?.regionConflict ?? null,
      google_places_score: decision.googlePlaces?.score ?? null,
      google_places_region_conflict: decision.googlePlaces?.regionConflict ?? null,
      wikidata_top_score: decision.wikidata[0]?.confidence ?? null,
    },
    verified_at: new Date().toISOString(),
  };
}

function startOfUtcDay(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

async function countGooglePlacesAttemptsToday(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('entity_verification_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'google_places')
    .in('status', ['success', 'empty', 'error'])
    .gte('created_at', startOfUtcDay());
  if (error) throw error;
  return count ?? 0;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(clean).filter(Boolean)) {
    const key = value.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function sourcePackageIds(candidate: Record<string, unknown>): string[] {
  const sourceContext = candidate.source_context as Record<string, unknown> | null;
  const ids = sourceContext?.package_ids;
  return Array.isArray(ids)
    ? ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
}

async function persistDecision(candidate: Record<string, unknown>, decision: EntityResolutionDecision) {
  const { data, error } = await supabaseAdmin
    .from('entity_master_candidates')
    .update(updatePayload(decision))
    .eq('id', candidate.id)
    .select(LIST_FIELDS)
    .single();
  if (error) throw error;

  const attempts = decision.attempts.map(attempt => ({
    candidate_id: candidate.id,
    candidate_key: decision.candidateKey,
    source: attempt.source,
    query: attempt.query,
    status: attempt.status,
    score: attempt.score,
    evidence: attempt.evidence,
    error: attempt.error ?? null,
  }));
  if (attempts.length > 0) {
    const { error: attemptsError } = await supabaseAdmin
      .from('entity_verification_attempts')
      .insert(attempts);
    if (attemptsError) throw attemptsError;
  }
  return data;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ candidates: [] });

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const action = searchParams.get('action');
    const search = searchParams.get('search');
    const limit = Math.min(Number(searchParams.get('limit') ?? '200'), 1000);

    let query = supabaseAdmin
      .from('entity_master_candidates')
      .select(LIST_FIELDS)
      .order('occurrence_count', { ascending: false })
      .order('confidence', { ascending: false })
      .limit(limit);

    if (category && category !== 'all') query = query.eq('category', category);
    if (status && status !== 'all') {
      query = query.eq('promotion_status', status);
    } else {
      query = query.not('promotion_status', 'in', '(rejected_noise,promoted)');
    }
    if (action && action !== 'all') query = query.eq('auto_action', action);
    if (search) query = query.ilike('normalized_label', `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ candidates: data ?? [] });
  } catch (error) {
    console.error('[entity-master-candidates] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load candidates' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  try {
    const body = await request.json();
    const id = String(body.id ?? '');
    const action = String(body.action ?? '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { data: candidate, error: loadError } = await supabaseAdmin
      .from('entity_master_candidates')
      .select('*')
      .eq('id', id)
      .single();
    if (loadError) throw loadError;
    if (!candidate) return NextResponse.json({ error: 'candidate not found' }, { status: 404 });

    if (action === 'reject_noise') {
      const { data, error } = await supabaseAdmin
        .from('entity_master_candidates')
        .update({
          promotion_status: 'rejected_noise',
          auto_action: 'reject_noise',
          decision_reason: body.reason || 'admin rejected as non-master/noise',
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ candidate: data });
    }

    if (action === 'verify_now') {
      const googlePlacesBudget = getGooglePlacesBudgetFromEnv(await countGooglePlacesAttemptsToday());
      const decision = await resolveItineraryEntityCandidate(candidate as EntityCandidateRow, { googlePlacesBudget });
      const data = await persistDecision(candidate, decision);
      return NextResponse.json({ candidate: data, decision });
    }

    if (action === 'keep_internal') {
      const attractionId = clean(candidate.promoted_attraction_id);
      if (attractionId) {
        const { error: attractionError } = await supabaseAdmin
          .from('attractions')
          .update({
            customer_publishable: false,
            verification_status: 'auto_internal',
            review_required_reason: body.reason || 'admin kept this auto-created master internal',
          })
          .eq('id', attractionId);
        if (attractionError) throw attractionError;
      }

      const { data, error } = await supabaseAdmin
        .from('entity_master_candidates')
        .update({
          promotion_status: 'auto_internal',
          auto_action: 'create_internal_master',
          auto_verification_status: candidate.auto_verification_status === 'verified_internal'
            ? 'verified_internal'
            : 'unverified',
          decision_reason: body.reason || 'admin kept as internal non-customer-publishable master candidate',
        })
        .eq('id', id)
        .select(LIST_FIELDS)
        .single();
      if (error) throw error;
      return NextResponse.json({ candidate: data });
    }

    if (action === 'merge_alias') {
      const attractionId = clean(body.attraction_id);
      if (!attractionId) return NextResponse.json({ error: 'attraction_id is required' }, { status: 400 });

      const { data: attraction, error: attractionError } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases')
        .eq('id', attractionId)
        .single();
      if (attractionError || !attraction) throw attractionError ?? new Error('attraction not found');

      const aliases = unique([
        ...((Array.isArray(attraction.aliases) ? attraction.aliases : []) as string[]),
        clean(body.alias),
        clean(candidate.raw_label),
        clean(candidate.normalized_label),
        clean(candidate.canonical_name),
      ])
        .filter(alias => alias && alias !== attraction.name)
        .slice(0, 40);

      const { error: aliasError } = await supabaseAdmin
        .from('attractions')
        .update({ aliases })
        .eq('id', attractionId);
      if (aliasError) throw aliasError;

      const { data, error } = await supabaseAdmin
        .from('entity_master_candidates')
        .update({
          promotion_status: 'promoted',
          promoted_at: new Date().toISOString(),
          promoted_attraction_id: attractionId,
          decision_reason: body.reason || `admin merged candidate aliases into attraction ${attraction.name}`,
        })
        .eq('id', id)
        .select(LIST_FIELDS)
        .single();
      if (error) throw error;

      void reEnrichAffectedPackages([attractionId], {
        packageIds: sourcePackageIds(candidate),
        maxPackages: 50,
        forceRevalidate: true,
      }).catch(error => console.warn('[entity-master-candidates] re-enrich after merge failed:', error));

      return NextResponse.json({ candidate: data, aliases });
    }

    if (action === 'mark_needs_review') {
      const { data, error } = await supabaseAdmin
        .from('entity_master_candidates')
        .update({
          promotion_status: 'needs_review',
          auto_action: 'needs_review',
          decision_reason: body.reason || 'admin review required',
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ candidate: data });
    }

    if (action === 'make_publishable') {
      const attractionId = body.attraction_id || candidate.promoted_attraction_id;
      if (!attractionId) {
        return NextResponse.json({ error: 'attraction_id is required' }, { status: 400 });
      }

      const { error: attractionError } = await supabaseAdmin
        .from('attractions')
        .update({
          customer_publishable: true,
          verification_status: 'published',
          review_required_reason: null,
        })
        .eq('id', attractionId);
      if (attractionError) throw attractionError;

      const { data, error } = await supabaseAdmin
        .from('entity_master_candidates')
        .update({
          promotion_status: 'promoted',
          promoted_at: new Date().toISOString(),
          promoted_attraction_id: attractionId,
          decision_reason: body.reason || 'admin verified and published',
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ candidate: data });
    }

    return NextResponse.json({ error: `unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('[entity-master-candidates] PATCH failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to update candidate' },
      { status: 500 },
    );
  }
}
