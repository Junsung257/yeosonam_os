import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { evaluateMasterCandidate, type CandidateExternalSource } from '../src/lib/entity-master-candidates';
import { suggestAttractionsForActivity, type AttractionSuggestRow } from '../src/lib/unmatched-suggest';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.croncheck.local' });
loadEnv();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const limit = Number(argValue('--limit', '10000'));
const minAliasScore = Number(argValue('--min-alias-score', '100'));

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

type ActiveAttractionRow = {
  id: string;
  activity: string;
  package_id: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number | null;
  suggested_resolution: Record<string, unknown> | null;
  source_context: Record<string, unknown> | null;
};

type CandidateGroup = {
  decision: ReturnType<typeof evaluateMasterCandidate>;
  ids: string[];
  packageIds: Set<string>;
  packageTitles: Set<string>;
  occurrenceCount: number;
  examples: Array<Record<string, unknown>>;
};

async function countActivePending(): Promise<number> {
  const { count, error } = await supabase
    .from('unmatched_activities')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('resolved_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function fetchActiveAttractions(): Promise<ActiveAttractionRow[]> {
  const rows: ActiveAttractionRow[] = [];
  const pageSize = 1000;
  for (let from = 0; rows.length < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from('unmatched_activities')
      .select('id, activity, package_id, package_title, day_number, country, region, occurrence_count, suggested_resolution, source_context')
      .eq('status', 'pending')
      .is('resolved_at', null)
      .eq('segment_kind_guess', 'attraction')
      .order('occurrence_count', { ascending: false })
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as ActiveAttractionRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function fetchAttractions(): Promise<AttractionSuggestRow[]> {
  const rows: AttractionSuggestRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id, name, aliases, region, country, category, emoji, short_desc')
      .eq('is_active', true)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as AttractionSuggestRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function addAlias(attraction: AttractionSuggestRow, alias: string) {
  const cleanAlias = alias.replace(/\s+/g, ' ').trim();
  if (!cleanAlias || cleanAlias.length > 80) return false;
  const aliases = attraction.aliases ?? [];
  if (aliases.includes(cleanAlias) || attraction.name === cleanAlias) return false;
  const nextAliases = [...new Set([...aliases, cleanAlias])];
  const { error } = await supabase
    .from('attractions')
    .update({ aliases: nextAliases })
    .eq('id', attraction.id);
  if (error) throw error;
  attraction.aliases = nextAliases;
  return true;
}

async function closeAsExistingAlias(row: ActiveAttractionRow, attraction: AttractionSuggestRow, score: number) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('unmatched_activities')
    .update({
      status: 'added',
      resolved_at: now,
      resolved_kind: 'final_pipeline_existing_alias',
      resolved_attraction_id: attraction.id,
      resolved_by: 'run_unmatched_final_pipeline',
      suggested_action: 'auto_resolve_existing',
      suggested_resolution: {
        strategy: 'existing_attraction_alias',
        attraction_id: attraction.id,
        attraction_name: attraction.name,
        score,
      },
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .is('resolved_at', null);
  if (error) throw error;
}

function externalSourcesFrom(row: ActiveAttractionRow): CandidateExternalSource[] {
  const fromResolution = row.suggested_resolution?.external_sources;
  const fromContext = row.source_context?.external_sources;
  const sources = Array.isArray(fromResolution) ? fromResolution : Array.isArray(fromContext) ? fromContext : [];
  return sources
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const value = item as Record<string, unknown>;
      return {
        source: String(value.source ?? 'supplier') as CandidateExternalSource['source'],
        id: typeof value.id === 'string' ? value.id : null,
        url: typeof value.url === 'string' ? value.url : null,
        confidence: typeof value.confidence === 'number' ? value.confidence : null,
        name: typeof value.name === 'string' ? value.name : null,
      };
    });
}

function groupRows(rows: ActiveAttractionRow[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();

  for (const row of rows) {
    const decision = evaluateMasterCandidate({
      rawLabel: row.activity,
      category: 'attraction',
      country: row.country,
      region: row.region,
      destination: row.region ?? row.country,
      occurrenceCount: row.occurrence_count ?? 1,
      evidenceCount: 1,
      packageCount: row.package_id ? 1 : 0,
      externalSources: externalSourcesFrom(row),
    });
    const existing = groups.get(decision.candidateKey);
    const example = {
      id: row.id,
      package_id: row.package_id,
      package_title: row.package_title,
      day_number: row.day_number,
      country: row.country,
      region: row.region,
      activity: row.activity,
    };

    if (!existing) {
      groups.set(decision.candidateKey, {
        decision,
        ids: [row.id],
        packageIds: new Set(row.package_id ? [row.package_id] : []),
        packageTitles: new Set(row.package_title ? [row.package_title] : []),
        occurrenceCount: row.occurrence_count ?? 1,
        examples: [example],
      });
      continue;
    }

    existing.ids.push(row.id);
    existing.occurrenceCount += row.occurrence_count ?? 1;
    if (row.package_id) existing.packageIds.add(row.package_id);
    if (row.package_title) existing.packageTitles.add(row.package_title);
    if (existing.examples.length < 10) existing.examples.push(example);
  }

  return [...groups.values()];
}

function candidatePayload(group: CandidateGroup) {
  const decision = group.decision;
  return {
    candidate_key: decision.candidateKey,
    category: decision.category,
    raw_label: decision.rawLabel,
    normalized_label: decision.normalizedLabel,
    destination_scope: decision.destinationScope,
    country_scope: decision.countryScope,
    region_scope: decision.regionScope,
    evidence_count: group.ids.length,
    occurrence_count: group.occurrenceCount,
    package_count: group.packageIds.size,
    source_unmatched_ids: group.ids,
    source_context: {
      package_ids: [...group.packageIds].slice(0, 100),
      package_titles: [...group.packageTitles].slice(0, 50),
      examples: group.examples,
      analyzer: 'run-unmatched-final-pipeline',
      analyzed_at: new Date().toISOString(),
    },
    external_sources: [],
    suggested_master: decision.suggestedMaster,
    confidence: decision.confidence,
    promotion_status: decision.promotionStatus,
    auto_action: decision.autoAction,
    decision_reason: decision.decisionReason,
    updated_at: new Date().toISOString(),
  };
}

async function upsertCandidateGroups(groups: CandidateGroup[]) {
  if (groups.length === 0) return [] as Array<{ id: string; candidate_key: string; category: string; promotion_status: string; canonical_name: string | null; normalized_label: string | null }>;
  const upsertedRows: Array<{ id: string; candidate_key: string; category: string; promotion_status: string; canonical_name: string | null; normalized_label: string | null }> = [];
  const chunkSize = 250;
  for (let i = 0; i < groups.length; i += chunkSize) {
    const chunk = groups.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('entity_master_candidates')
      .upsert(chunk.map(candidatePayload), { onConflict: 'candidate_key' })
      .select('id, candidate_key, category, promotion_status, canonical_name, normalized_label');
    if (error) throw error;
    upsertedRows.push(...(data ?? []) as typeof upsertedRows);
  }
  return upsertedRows;
}

async function closeAsCandidateQueued(ids: string[], candidate: {
  id: string;
  candidate_key: string;
  category: string;
  promotion_status: string;
  canonical_name: string | null;
  normalized_label: string | null;
}) {
  const cleanIds = [...new Set(ids.filter(Boolean))];
  const now = new Date().toISOString();
  const chunkSize = 500;
  let closed = 0;
  for (let i = 0; i < cleanIds.length; i += chunkSize) {
    const chunk = cleanIds.slice(i, i + chunkSize);
    const rejectedNoise = candidate.promotion_status === 'rejected_noise';
    const { data, error } = await supabase
      .from('unmatched_activities')
      .update({
        status: rejectedNoise ? 'ignored' : 'added',
        resolved_at: now,
        resolved_kind: rejectedNoise
          ? 'candidate_rejected_noise'
          : candidate.promotion_status === 'auto_internal'
            ? 'internal_candidate_created'
            : 'candidate_review_queue',
        resolved_by: 'run_unmatched_final_pipeline',
        suggested_action: rejectedNoise ? 'auto_ignore_noise' : 'candidate_queue',
        segment_kind_guess: candidate.category,
        suggested_resolution: {
          strategy: rejectedNoise
            ? 'entity_master_candidate_rejected_noise'
            : 'entity_master_candidate_queue',
          candidate_id: candidate.id,
          candidate_key: candidate.candidate_key,
          candidate_status: candidate.promotion_status,
          candidate_category: candidate.category,
          candidate_label: candidate.canonical_name ?? candidate.normalized_label,
        },
        updated_at: now,
      })
      .in('id', chunk)
      .eq('status', 'pending')
      .is('resolved_at', null)
      .select('id');
    if (error) throw error;
    closed += data?.length ?? 0;
  }
  return closed;
}

async function main() {
  const startedActivePending = await countActivePending();
  const [rows, attractions] = await Promise.all([fetchActiveAttractions(), fetchAttractions()]);
  const aliasResolvedIds = new Set<string>();
  let aliasResolved = 0;
  let aliasAdded = 0;

  for (const row of rows) {
    const scoped = attractions.filter(attr =>
      (!row.region || !attr.region || row.region === attr.region) &&
      (!row.country || !attr.country || row.country === attr.country));
    const pool = scoped.length > 0 ? scoped : attractions;
    const { suggestions } = suggestAttractionsForActivity(row.activity, pool, minAliasScore, 1);
    const top = suggestions[0];
    if (!top) continue;
    const target = attractions.find(attr => attr.id === top.id);
    if (!target) continue;
    aliasResolvedIds.add(row.id);
    if (apply) {
      if (await addAlias(target, row.activity)) aliasAdded++;
      await closeAsExistingAlias(row, target, top.score);
    }
    aliasResolved++;
  }

  const rowsForCandidates = rows.filter(row => !aliasResolvedIds.has(row.id));
  const groups = groupRows(rowsForCandidates);
  const upserted = apply ? await upsertCandidateGroups(groups) : [];
  const groupByKey = new Map(groups.map(group => [group.decision.candidateKey, group]));
  let closedAsCandidate = 0;

  if (apply) {
    for (const candidate of upserted) {
      const group = groupByKey.get(candidate.candidate_key);
      if (!group) continue;
      closedAsCandidate += await closeAsCandidateQueued(group.ids, candidate);
    }
  }

  const activePendingAfter = apply ? await countActivePending() : startedActivePending;
  const output = {
    apply,
    started_active_pending: startedActivePending,
    active_pending_after: activePendingAfter,
    scanned_active_attractions: rows.length,
    alias_resolved: aliasResolved,
    alias_added: aliasAdded,
    candidate_source_rows: rowsForCandidates.length,
    candidate_groups: groups.length,
    upserted_candidates: upserted.length,
    closed_as_candidate: closedAsCandidate,
    byCandidateStatus: groups.reduce<Record<string, number>>((acc, group) => {
      acc[group.decision.promotionStatus] = (acc[group.decision.promotionStatus] ?? 0) + 1;
      return acc;
    }, {}),
    sampleGroups: groups.slice(0, 30).map(group => ({
      candidate_key: group.decision.candidateKey,
      raw_label: group.decision.rawLabel,
      normalized_label: group.decision.normalizedLabel,
      status: group.decision.promotionStatus,
      action: group.decision.autoAction,
      occurrence_count: group.occurrenceCount,
      evidence_count: group.ids.length,
      package_count: group.packageIds.size,
      reason: group.decision.decisionReason,
    })),
  };

  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
