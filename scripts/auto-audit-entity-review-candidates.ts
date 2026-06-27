import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { terminalNonMasterReason } from '../src/lib/itinerary-entity-resolution-engine';
import { reEnrichAffectedPackages } from '../src/lib/package-reenrich-on-attraction-change';

loadEnv({ path: '.env.local' });
loadEnv();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const limit = Number(argValue('--limit', '1000'));

function argValue(name: string, fallback: string): string {
  const found = args.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

type ReviewCandidateRow = {
  id: string;
  candidate_key: string;
  category: string;
  raw_label: string | null;
  normalized_label: string | null;
  canonical_name: string | null;
  promotion_status: string | null;
  auto_action: string | null;
  auto_verification_status: string | null;
  decision_reason: string | null;
  source_unmatched_ids: string[] | null;
  suggested_master: Record<string, unknown> | null;
};

type PublishedAttractionMatch = {
  id: string;
  name: string;
};

const supabase = createClient(url, key, { auth: { persistSession: false } });
const candidateColumns = [
  'id',
  'candidate_key',
  'category',
  'raw_label',
  'normalized_label',
  'canonical_name',
  'promotion_status',
  'auto_action',
  'auto_verification_status',
  'decision_reason',
  'source_unmatched_ids',
  'suggested_master',
].join(', ');

async function fetchRows(): Promise<ReviewCandidateRow[]> {
  const { data: reviewRows, error: reviewError } = await supabase
    .from('entity_master_candidates')
    .select(candidateColumns)
    .eq('promotion_status', 'needs_review')
    .in('category', ['attraction', 'hotel'])
    .limit(limit);
  if (reviewError) throw reviewError;

  const { data: candidateRows, error: candidateError } = await supabase
    .from('entity_master_candidates')
    .select(candidateColumns)
    .eq('promotion_status', 'candidate')
    .in('category', ['attraction', 'hotel'])
    .limit(limit);
  if (candidateError) throw candidateError;

  const allRows = [
    ...((reviewRows ?? []) as unknown as ReviewCandidateRow[]),
    ...((candidateRows ?? []) as unknown as ReviewCandidateRow[]),
  ];
  const rows = new Map<string, ReviewCandidateRow>();
  for (const row of allRows) {
    const isReviewCandidate = row.promotion_status === 'needs_review';
    const isStructuredNonMaster = row.auto_action === 'structure_non_master' ||
      row.auto_action === 'reject_noise' ||
      row.auto_verification_status === 'structured_non_master';
    if (isReviewCandidate || isStructuredNonMaster) rows.set(row.id, row);
  }
  return Array.from(rows.values());
}

function resolutionFor(row: ReviewCandidateRow): { reason: string; canonicalName: string; structured: boolean } | null {
  const canonicalName = row.canonical_name || row.normalized_label || row.raw_label || '';
  const reason = terminalNonMasterReason(row.category, canonicalName, row.raw_label || row.normalized_label || canonicalName);
  if (reason) return { reason, canonicalName, structured: false };
  if (row.auto_action === 'structure_non_master' || row.auto_verification_status === 'structured_non_master') {
    return {
      reason: row.decision_reason || 'structured source fragment, not a master entity',
      canonicalName,
      structured: true,
    };
  }
  if (row.auto_action === 'reject_noise') {
    return {
      reason: row.decision_reason || 'pre-classified non-master or noise candidate',
      canonicalName,
      structured: false,
    };
  }
  return null;
}

function canonicalFor(row: ReviewCandidateRow): string {
  return row.canonical_name || row.normalized_label || row.raw_label || '';
}

function exactCandidateTerms(row: ReviewCandidateRow): string[] {
  return Array.from(new Set([
    row.canonical_name,
    row.normalized_label,
    row.raw_label,
  ].map(value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''))
    .filter(value => value.length >= 2)));
}

async function findExactPublishedAttraction(row: ReviewCandidateRow): Promise<PublishedAttractionMatch | null> {
  if (row.category !== 'attraction') return null;
  for (const term of exactCandidateTerms(row)) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id, name')
      .eq('name', term)
      .eq('customer_publishable', true)
      .limit(1);
    if (!error && data && data.length > 0) return data[0] as PublishedAttractionMatch;
  }
  return null;
}

async function persist(
  row: ReviewCandidateRow,
  reason: string,
  canonicalName: string,
  structured = false,
): Promise<void> {
  const verificationStatus = structured ? 'structured_non_master' : 'rejected_noise';
  const suggestedMaster = {
    ...(row.suggested_master ?? {}),
    canonical_name: canonicalName,
    customer_publishable: false,
    verification_status: verificationStatus,
    auto_review: {
      mode: structured ? 'auto_structured_non_master' : 'auto_rejected_non_master',
      reason,
      reviewed_by: 'auto-audit-entity-review-candidates',
      reviewed_at: new Date().toISOString(),
    },
  };

  const { error } = await supabase
    .from('entity_master_candidates')
    .update({
      promotion_status: 'rejected_noise',
      auto_action: structured ? 'structure_non_master' : 'reject_noise',
      auto_verification_status: verificationStatus,
      decision_reason: `auto-reviewed as non-master: ${reason}`,
      suggested_master: suggestedMaster,
      verified_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (error) throw error;
}

async function persistInternalCandidate(row: ReviewCandidateRow): Promise<void> {
  const canonicalName = canonicalFor(row);
  const suggestedMaster = {
    ...(row.suggested_master ?? {}),
    canonical_name: canonicalName,
    customer_publishable: false,
    verification_status: 'auto_internal',
    auto_review: {
      mode: 'auto_internal_candidate',
      reason: 'clean place-like candidate retained as hidden internal candidate; public publishing requires stronger evidence or admin approval',
      reviewed_by: 'auto-audit-entity-review-candidates',
      reviewed_at: new Date().toISOString(),
    },
  };

  const { error } = await supabase
    .from('entity_master_candidates')
    .update({
      promotion_status: 'auto_internal',
      auto_action: 'create_internal_master',
      auto_verification_status: 'unverified',
      decision_reason: 'clean place-like candidate retained as hidden internal candidate; no customer publishing',
      suggested_master: suggestedMaster,
      verified_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (error) throw error;
}

async function persistExistingMatch(row: ReviewCandidateRow, attraction: PublishedAttractionMatch): Promise<string[]> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('entity_master_candidates')
    .update({
      promotion_status: 'promoted',
      promoted_attraction_id: attraction.id,
      promoted_at: now,
      auto_verification_status: 'verified_publishable',
      decision_reason: `auto-linked to exact published attraction ${attraction.name}`,
    })
    .eq('id', row.id);
  if (error) throw error;

  const sourceUnmatchedIds = (row.source_unmatched_ids ?? []).filter(Boolean);
  if (sourceUnmatchedIds.length === 0) return [];

  const { data: sourceRows, error: sourceRowsError } = await supabase
    .from('unmatched_activities')
    .select('package_id')
    .in('id', sourceUnmatchedIds)
    .not('package_id', 'is', null);
  if (sourceRowsError) throw sourceRowsError;

  const { error: closeError } = await supabase
    .from('unmatched_activities')
    .update({
      status: 'added',
      resolved_at: now,
      resolved_kind: 'auto_existing_exact_published_attraction',
      resolved_attraction_id: attraction.id,
      resolved_by: 'auto-audit-entity-review-candidates',
      updated_at: now,
    })
    .in('id', sourceUnmatchedIds)
    .eq('status', 'pending')
    .is('resolved_at', null);
  if (closeError) throw closeError;

  return Array.from(new Set((sourceRows ?? [])
    .map(row => (row as { package_id: string | null }).package_id)
    .filter((value): value is string => Boolean(value))));
}

async function main() {
  const rows = await fetchRows();
  const audited: Array<{ candidate_key: string; category: string; canonical_name: string; reason: string }> = [];
  const linkedExisting: Array<{ candidate_key: string; category: string; canonical_name: string; attraction: string }> = [];
  const internalCandidates: Array<{ candidate_key: string; category: string; canonical_name: string }> = [];
  const remaining: Array<{ candidate_key: string; category: string; canonical_name: string }> = [];
  const errors: Array<{ candidate_key: string; error: string }> = [];
  const affectedAttractionIds = new Set<string>();
  const affectedPackageIds = new Set<string>();

  for (const row of rows) {
    const resolution = resolutionFor(row);
    if (!resolution) {
      if (row.promotion_status !== 'needs_review') {
        remaining.push({
          candidate_key: row.candidate_key,
          category: row.category,
          canonical_name: canonicalFor(row),
        });
        continue;
      }

      const exactMatch = await findExactPublishedAttraction(row);
      if (!exactMatch) {
        internalCandidates.push({
          candidate_key: row.candidate_key,
          category: row.category,
          canonical_name: canonicalFor(row),
        });
        if (apply) {
          try {
            await persistInternalCandidate(row);
          } catch (error) {
            errors.push({
              candidate_key: row.candidate_key,
              error: error instanceof Error ? error.message : String(error),
            });
            remaining.push({
              candidate_key: row.candidate_key,
              category: row.category,
              canonical_name: canonicalFor(row),
            });
          }
        }
        continue;
      }

      linkedExisting.push({
        candidate_key: row.candidate_key,
        category: row.category,
        canonical_name: canonicalFor(row),
        attraction: exactMatch.name,
      });

      if (apply) {
        try {
          const packageIds = await persistExistingMatch(row, exactMatch);
          affectedAttractionIds.add(exactMatch.id);
          for (const packageId of packageIds) affectedPackageIds.add(packageId);
        } catch (error) {
          errors.push({
            candidate_key: row.candidate_key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      continue;
    }

    audited.push({
      candidate_key: row.candidate_key,
      category: row.category,
      canonical_name: resolution.canonicalName,
      reason: resolution.reason,
    });

    if (apply) {
      try {
        await persist(row, resolution.reason, resolution.canonicalName, resolution.structured);
      } catch (error) {
        errors.push({
          candidate_key: row.candidate_key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const reEnrich = apply && affectedAttractionIds.size > 0
    ? await reEnrichAffectedPackages([...affectedAttractionIds], {
        packageIds: [...affectedPackageIds],
        maxPackages: Math.max(50, affectedPackageIds.size),
        forceRevalidate: true,
      })
    : null;

  const output = {
    scanned: rows.length,
    auto_rejected: audited.length,
    linked_existing: linkedExisting.length,
    auto_internal_candidates: internalCandidates.length,
    remaining_review: remaining.length,
    apply,
    reEnrich,
    errors,
    byReason: audited.reduce<Record<string, number>>((acc, row) => {
      acc[row.reason] = (acc[row.reason] ?? 0) + 1;
      return acc;
    }, {}),
    sampleAutoRejected: audited.slice(0, 20),
    sampleLinkedExisting: linkedExisting.slice(0, 20),
    sampleAutoInternalCandidates: internalCandidates.slice(0, 20),
    sampleRemaining: remaining.slice(0, 20),
  };

  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
