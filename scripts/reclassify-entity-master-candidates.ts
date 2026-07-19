import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { evaluateMasterCandidate, type CandidateExternalSource } from '../src/lib/entity-master-candidates';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.croncheck.local' });
loadEnv();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const limit = Number(argValue('--limit', '10000'));
const statusFilter = argValue('--status', 'candidate,auto_internal,needs_review,publishable_ready')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function argValue(name: string, fallback: string): string {
  const found = args.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

type CandidateRow = {
  id: string;
  candidate_key: string;
  category: string | null;
  raw_label: string | null;
  normalized_label: string | null;
  destination_scope: string | null;
  country_scope: string | null;
  region_scope: string | null;
  evidence_count: number | null;
  occurrence_count: number | null;
  package_count: number | null;
  external_sources: unknown;
  promotion_status: string | null;
  auto_action: string | null;
};

function externalSources(value: unknown): CandidateExternalSource[] {
  return Array.isArray(value) ? value as CandidateExternalSource[] : [];
}

async function fetchCandidates() {
  const rows: CandidateRow[] = [];
  const pageSize = 1000;
  for (let from = 0; rows.length < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from('entity_master_candidates')
      .select('id,candidate_key,category,raw_label,normalized_label,destination_scope,country_scope,region_scope,evidence_count,occurrence_count,package_count,external_sources,promotion_status,auto_action')
      .in('promotion_status', statusFilter)
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data as CandidateRow[]);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const rows = await fetchCandidates();
  const transitions: Record<string, number> = {};
  const changed: Array<{
    id: string;
    candidate_key: string;
    raw_label: string | null;
    from: string | null;
    to: string;
    auto_action: string;
    normalized_label: string;
    reason: string;
  }> = [];
  const errors: Array<{ id: string; candidate_key: string; error: string }> = [];

  for (const row of rows) {
    const decision = evaluateMasterCandidate({
      rawLabel: row.raw_label || row.normalized_label || '',
      category: row.category,
      country: row.country_scope,
      region: row.region_scope,
      destination: row.destination_scope,
      occurrenceCount: row.occurrence_count,
      evidenceCount: row.evidence_count,
      packageCount: row.package_count,
      externalSources: externalSources(row.external_sources),
    });
    const changedStatus = row.promotion_status !== decision.promotionStatus;
    const changedAction = row.auto_action !== decision.autoAction;
    const changedLabel = row.normalized_label !== decision.normalizedLabel;
    if (!changedStatus && !changedAction && !changedLabel) continue;

    const transitionKey = `${row.promotion_status ?? 'null'} -> ${decision.promotionStatus}`;
    transitions[transitionKey] = (transitions[transitionKey] ?? 0) + 1;
    changed.push({
      id: row.id,
      candidate_key: row.candidate_key,
      raw_label: row.raw_label,
      from: row.promotion_status,
      to: decision.promotionStatus,
      auto_action: decision.autoAction,
      normalized_label: decision.normalizedLabel,
      reason: decision.decisionReason,
    });

    if (!apply) continue;
    const { error } = await supabase
      .from('entity_master_candidates')
      .update({
        category: decision.category,
        normalized_label: decision.normalizedLabel,
        canonical_name: decision.normalizedLabel,
        suggested_master: decision.suggestedMaster,
        confidence: decision.confidence,
        promotion_status: decision.promotionStatus,
        auto_action: decision.autoAction,
        decision_reason: decision.decisionReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) {
      errors.push({ id: row.id, candidate_key: row.candidate_key, error: error.message });
    }
  }

  const report = {
    checked_at: new Date().toISOString(),
    apply,
    scanned: rows.length,
    changed: changed.length,
    errors: errors.length,
    transitions,
    samples: changed.slice(0, 30),
    error_samples: errors.slice(0, 10),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Scanned ${report.scanned} entity master candidates`);
  console.log(`Changed: ${report.changed}`);
  Object.entries(transitions)
    .sort((a, b) => b[1] - a[1])
    .forEach(([transition, count]) => console.log(`- ${transition}: ${count}`));
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
