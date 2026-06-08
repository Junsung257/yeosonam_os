import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { terminalNonMasterReason } from '../src/lib/itinerary-entity-resolution-engine';

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
  suggested_master: Record<string, unknown> | null;
};

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function fetchRows(): Promise<ReviewCandidateRow[]> {
  const { data, error } = await supabase
    .from('entity_master_candidates')
    .select('id, candidate_key, category, raw_label, normalized_label, canonical_name, suggested_master')
    .eq('promotion_status', 'needs_review')
    .in('category', ['attraction', 'hotel'])
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ReviewCandidateRow[];
}

function resolutionFor(row: ReviewCandidateRow): { reason: string; canonicalName: string } | null {
  const canonicalName = row.canonical_name || row.normalized_label || row.raw_label || '';
  const reason = terminalNonMasterReason(row.category, canonicalName, row.raw_label || row.normalized_label || canonicalName);
  return reason ? { reason, canonicalName } : null;
}

async function persist(row: ReviewCandidateRow, reason: string, canonicalName: string): Promise<void> {
  const suggestedMaster = {
    ...(row.suggested_master ?? {}),
    canonical_name: canonicalName,
    customer_publishable: false,
    verification_status: 'rejected_noise',
    auto_review: {
      mode: 'auto_rejected_non_master',
      reason,
      reviewed_by: 'auto-audit-entity-review-candidates',
      reviewed_at: new Date().toISOString(),
    },
  };

  const { error } = await supabase
    .from('entity_master_candidates')
    .update({
      promotion_status: 'rejected_noise',
      auto_action: 'reject_noise',
      auto_verification_status: 'rejected_noise',
      decision_reason: `auto-reviewed as non-master: ${reason}`,
      suggested_master: suggestedMaster,
      verified_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (error) throw error;
}

async function main() {
  const rows = await fetchRows();
  const audited: Array<{ candidate_key: string; category: string; canonical_name: string; reason: string }> = [];
  const remaining: Array<{ candidate_key: string; category: string; canonical_name: string }> = [];
  const errors: Array<{ candidate_key: string; error: string }> = [];

  for (const row of rows) {
    const resolution = resolutionFor(row);
    if (!resolution) {
      remaining.push({
        candidate_key: row.candidate_key,
        category: row.category,
        canonical_name: row.canonical_name || row.normalized_label || row.raw_label || '',
      });
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
        await persist(row, resolution.reason, resolution.canonicalName);
      } catch (error) {
        errors.push({
          candidate_key: row.candidate_key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const output = {
    scanned: rows.length,
    auto_rejected: audited.length,
    remaining_review: remaining.length,
    apply,
    errors,
    byReason: audited.reduce<Record<string, number>>((acc, row) => {
      acc[row.reason] = (acc[row.reason] ?? 0) + 1;
      return acc;
    }, {}),
    sampleAutoRejected: audited.slice(0, 20),
    sampleRemaining: remaining.slice(0, 20),
  };

  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
