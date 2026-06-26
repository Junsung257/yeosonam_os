import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { reEnrichAffectedPackages } from '@/lib/package-reenrich-on-attraction-change';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { countActiveUnmatched } from '@/lib/unmatched-lifecycle';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

type CandidateRow = {
  id: string;
  candidate_key: string;
  raw_label: string | null;
  normalized_label: string | null;
  canonical_name: string | null;
  country_scope: string | null;
  region_scope: string | null;
  destination_scope: string | null;
  source_unmatched_ids: string[] | null;
  external_sources: Array<Record<string, unknown>> | null;
  suggested_master: Record<string, unknown> | null;
  decision_reason: string | null;
};

function limitFrom(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get('limit') ?? process.env.PROMOTE_INTERNAL_CANDIDATES_LIMIT ?? 50);
  return Number.isFinite(raw) ? Math.max(1, Math.min(200, Math.floor(raw))) : 50;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function chooseName(row: CandidateRow): string {
  return clean(row.canonical_name) || clean(row.normalized_label) || clean(row.raw_label);
}

async function findExisting(name: string, aliases: string[]) {
  for (const term of unique([name, ...aliases])) {
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases')
      .or(`name.eq.${term},aliases.cs.{${term}}`)
      .limit(1);
    if (!error && data && data.length > 0) return data[0] as { id: string; name: string; aliases: string[] | null };
  }
  return null;
}

async function runPromoteInternalCandidates(options: { limit?: number } = {}) {
  if (!isSupabaseConfigured) {
    return { ok: true, scanned: 0, promoted: 0, linkedExisting: 0, errors: [] as string[] };
  }

  try {
    const limit = options.limit ?? 50;
    const { data, error } = await supabaseAdmin
      .from('entity_master_candidates')
      .select('id, candidate_key, raw_label, normalized_label, canonical_name, country_scope, region_scope, destination_scope, source_unmatched_ids, external_sources, suggested_master, decision_reason')
      .eq('category', 'attraction')
      .eq('auto_action', 'create_internal_master')
      .eq('promotion_status', 'auto_internal')
      .eq('auto_verification_status', 'verified_internal')
      .order('verification_score', { ascending: false })
      .limit(limit);
    if (error) throw error;

    let promoted = 0;
    let linkedExisting = 0;
    const affectedAttractionIds = new Set<string>();
    const affectedPackageIds = new Set<string>();
    const errors: string[] = [];

    for (const row of (data ?? []) as CandidateRow[]) {
      try {
        const name = chooseName(row);
        if (!name || name.length < 2 || name.length > 64) continue;
        const aliases = unique([
          row.raw_label ?? '',
          row.normalized_label ?? '',
          row.canonical_name ?? '',
        ]).filter(alias => alias !== name);

        const existing = await findExisting(name, aliases);
        let attractionId = existing?.id ?? null;
        if (existing) linkedExisting++;

        if (!attractionId) {
          const { data: created, error: insertError } = await supabaseAdmin
            .from('attractions')
            .insert({
              name,
              short_desc: null,
              long_desc: null,
              country: row.country_scope,
              region: row.region_scope ?? row.destination_scope,
              badge_type: 'tour',
              emoji: null,
              aliases,
              photos: [],
              source: 'entity-master-candidate-auto',
              is_manual_override: false,
              auto_created: true,
              verification_status: 'auto_internal',
              customer_publishable: false,
              review_required_reason: row.decision_reason ?? 'internal candidate requires review before customer publishing',
              auto_created_at: new Date().toISOString(),
              source_ids: {
                entity_master_candidate_key: row.candidate_key,
                unmatched_ids: row.source_unmatched_ids ?? [],
              },
              verification_sources: row.external_sources ?? [],
            })
            .select('id')
            .single();
          if (insertError || !created) throw insertError ?? new Error('attraction insert failed');
          attractionId = (created as { id: string }).id;
          promoted++;
        }
        if (attractionId) affectedAttractionIds.add(attractionId);

        const now = new Date().toISOString();
        await supabaseAdmin
          .from('entity_master_candidates')
          .update({
            promotion_status: 'promoted',
            promoted_attraction_id: attractionId,
            promoted_at: now,
          })
          .eq('id', row.id);

        const sourceUnmatchedIds = row.source_unmatched_ids ?? [];
        if (sourceUnmatchedIds.length > 0) {
          const { data: sourceRows, error: sourceRowsError } = await supabaseAdmin
            .from('unmatched_activities')
            .select('package_id')
            .in('id', sourceUnmatchedIds)
            .not('package_id', 'is', null);
          if (sourceRowsError) throw sourceRowsError;
          for (const sourceRow of (sourceRows ?? []) as Array<{ package_id: string | null }>) {
            if (sourceRow.package_id) affectedPackageIds.add(sourceRow.package_id);
          }

          const { error: closeError } = await supabaseAdmin
            .from('unmatched_activities')
            .update({
              status: 'added',
              resolved_at: now,
              resolved_kind: 'auto_internal_candidate_promoted',
              resolved_attraction_id: attractionId,
              resolved_by: 'cron_promote_internal_candidates',
              updated_at: now,
            })
            .in('id', sourceUnmatchedIds)
            .eq('status', 'pending')
            .is('resolved_at', null);
          if (closeError) throw closeError;
        }
      } catch (err) {
        errors.push(sanitizeDbError(err, `failed to promote ${row.candidate_key}`));
      }
    }

    let reenrich: Awaited<ReturnType<typeof reEnrichAffectedPackages>> | null = null;
    if (affectedAttractionIds.size > 0) {
      try {
        reenrich = await reEnrichAffectedPackages([...affectedAttractionIds], {
          packageIds: [...affectedPackageIds],
          maxPackages: Math.max(limit * 3, affectedPackageIds.size, 1),
          forceRevalidate: true,
        });
      } catch (error) {
        errors.push(sanitizeDbError(error, 're-enrich affected packages failed'));
      }
    }

    return {
      ok: errors.length === 0,
      scanned: data?.length ?? 0,
      promoted,
      linkedExisting,
      affected_attractions: affectedAttractionIds.size,
      affected_packages: affectedPackageIds.size,
      reenrich,
      active_pending_after: await countActiveUnmatched(),
      errors: errors.slice(0, 20),
    };
  } catch (error) {
    const message = sanitizeDbError(error, 'promote internal candidates failed');
    return { ok: false, error: message, errors: [message] };
  }
}

const handlePromoteInternalCandidates = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return runPromoteInternalCandidates({ limit: limitFrom(request) });
};

export const GET = withCronLogging('promote-internal-candidates', handlePromoteInternalCandidates);
