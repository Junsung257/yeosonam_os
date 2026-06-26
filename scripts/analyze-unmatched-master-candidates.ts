import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  evaluateMasterCandidate,
  type CandidateExternalSource,
  type MasterCandidateDecision,
} from '../src/lib/entity-master-candidates';

loadEnv({ path: '.env.local' });
loadEnv();

type UnmatchedRow = {
  id: string;
  activity: string;
  package_id: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number | null;
  status: string | null;
  resolved_at: string | null;
  segment_kind_guess: string | null;
  confidence: number | null;
  suggested_action: string | null;
  suggested_resolution: Record<string, unknown> | null;
  source_context: Record<string, unknown> | null;
};

type CandidateGroup = {
  decision: MasterCandidateDecision;
  ids: string[];
  packageIds: Set<string>;
  packageTitles: Set<string>;
  occurrenceCount: number;
  examples: Array<{
    id: string;
    package_id: string | null;
    package_title: string | null;
    day_number: number | null;
    country: string | null;
    region: string | null;
    activity: string;
  }>;
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const json = args.has('--json');
const promoteInternal = args.has('--promote-internal');
const limit = Number(argValue('--limit', '5000'));

function argValue(name: string, fallback: string): string {
  const found = process.argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function externalSourcesFrom(row: UnmatchedRow): CandidateExternalSource[] {
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

async function fetchUnmatchedRows(): Promise<UnmatchedRow[]> {
  const rows: UnmatchedRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from('unmatched_activities')
      .select('id, activity, package_id, package_title, day_number, country, region, occurrence_count, status, resolved_at, segment_kind_guess, confidence, suggested_action, suggested_resolution, source_context')
      .eq('status', 'pending')
      .is('resolved_at', null)
      .order('occurrence_count', { ascending: false })
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data as UnmatchedRow[]);
    if (data.length < pageSize) break;
  }
  return rows;
}

function buildGroups(rows: UnmatchedRow[]): Map<string, CandidateGroup> {
  const groups = new Map<string, CandidateGroup>();

  for (const row of rows) {
    const externalSources = externalSourcesFrom(row);
    const decision = evaluateMasterCandidate({
      rawLabel: row.activity,
      category: row.segment_kind_guess,
      country: row.country,
      region: row.region,
      destination: row.region ?? row.country,
      occurrenceCount: row.occurrence_count ?? 1,
      evidenceCount: 1,
      packageCount: row.package_id ? 1 : 0,
      externalSources,
    });

    const existing = groups.get(decision.candidateKey);
    if (!existing) {
      groups.set(decision.candidateKey, {
        decision,
        ids: [row.id],
        packageIds: new Set(row.package_id ? [row.package_id] : []),
        packageTitles: new Set(row.package_title ? [row.package_title] : []),
        occurrenceCount: row.occurrence_count ?? 1,
        examples: [{
          id: row.id,
          package_id: row.package_id,
          package_title: row.package_title,
          day_number: row.day_number,
          country: row.country,
          region: row.region,
          activity: row.activity,
        }],
      });
      continue;
    }

    existing.ids.push(row.id);
    if (row.package_id) existing.packageIds.add(row.package_id);
    if (row.package_title) existing.packageTitles.add(row.package_title);
    existing.occurrenceCount += row.occurrence_count ?? 1;
    if (existing.examples.length < 5) {
      existing.examples.push({
        id: row.id,
        package_id: row.package_id,
        package_title: row.package_title,
        day_number: row.day_number,
        country: row.country,
        region: row.region,
        activity: row.activity,
      });
    }

    existing.decision = evaluateMasterCandidate({
      rawLabel: existing.decision.rawLabel,
      category: existing.decision.category,
      country: existing.decision.countryScope,
      region: existing.decision.regionScope,
      destination: existing.decision.destinationScope,
      occurrenceCount: existing.occurrenceCount,
      evidenceCount: existing.ids.length,
      packageCount: existing.packageIds.size,
      externalSources,
    });
  }

  return groups;
}

function candidatePayload(group: CandidateGroup) {
  const { decision } = group;
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
      package_ids: Array.from(group.packageIds).slice(0, 50),
      package_titles: Array.from(group.packageTitles).slice(0, 20),
      mobile_landing_impact: group.packageIds.size > 0,
      examples: group.examples,
      analyzer: 'analyze-unmatched-master-candidates',
      analyzed_at: new Date().toISOString(),
    },
    external_sources: [],
    suggested_master: decision.suggestedMaster,
    confidence: decision.confidence,
    promotion_status: decision.promotionStatus,
    auto_action: decision.autoAction,
    decision_reason: decision.decisionReason,
  };
}

async function upsertCandidates(groups: CandidateGroup[]) {
  const payload = groups.map(candidatePayload);
  const chunkSize = 200;
  let upserted = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('entity_master_candidates')
      .upsert(chunk, { onConflict: 'candidate_key' });
    if (error) throw error;
    upserted += chunk.length;
  }
  return upserted;
}

async function promoteInternalAttractions(groups: CandidateGroup[]) {
  let created = 0;
  let skippedExisting = 0;
  for (const group of groups) {
    const decision = group.decision;
    if (decision.category !== 'attraction' || decision.autoAction !== 'create_internal_master') continue;
    if (decision.confidence < 0.72) continue;

    const { data: existing, error: findError } = await supabase
      .from('attractions')
      .select('id, name')
      .ilike('name', decision.normalizedLabel)
      .limit(1);
    if (findError) throw findError;
    if (existing && existing.length > 0) {
      skippedExisting += 1;
      continue;
    }

    const { data, error } = await supabase
      .from('attractions')
      .insert({
        name: decision.normalizedLabel,
        short_desc: null,
        long_desc: null,
        country: decision.countryScope,
        region: decision.regionScope,
        badge_type: 'tour',
        emoji: '📍',
        aliases: [decision.rawLabel].filter(label => label !== decision.normalizedLabel),
        photos: [],
        source: 'entity-master-candidate-auto',
        is_manual_override: false,
        auto_created: true,
        verification_status: 'auto_internal',
        customer_publishable: false,
        review_required_reason: decision.decisionReason,
        auto_created_at: new Date().toISOString(),
        source_ids: {
          entity_master_candidate_key: decision.candidateKey,
          unmatched_ids: group.ids,
        },
        verification_sources: [],
      })
      .select('id')
      .single();
    if (error) throw error;

    await supabase
      .from('entity_master_candidates')
      .update({
        promotion_status: 'promoted',
        promoted_at: new Date().toISOString(),
        promoted_attraction_id: data.id,
      })
      .eq('candidate_key', decision.candidateKey);
    created += 1;
  }
  return { created, skippedExisting };
}

function summarize(groups: CandidateGroup[]) {
  const byAction: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const top = groups
    .slice()
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .slice(0, 30)
    .map(group => ({
      label: group.decision.normalizedLabel,
      category: group.decision.category,
      action: group.decision.autoAction,
      status: group.decision.promotionStatus,
      confidence: group.decision.confidence,
      evidence_count: group.ids.length,
      occurrence_count: group.occurrenceCount,
      package_count: group.packageIds.size,
      reason: group.decision.decisionReason,
    }));

  for (const group of groups) {
    byAction[group.decision.autoAction] = (byAction[group.decision.autoAction] ?? 0) + 1;
    byCategory[group.decision.category] = (byCategory[group.decision.category] ?? 0) + 1;
  }

  return { byAction, byCategory, top };
}

async function main() {
  const rows = await fetchUnmatchedRows();
  const groups = Array.from(buildGroups(rows).values());
  const summary = summarize(groups);
  let upserted = 0;
  let promoted = { created: 0, skippedExisting: 0 };

  if (apply) {
    upserted = await upsertCandidates(groups);
    if (promoteInternal) {
      promoted = await promoteInternalAttractions(groups);
    }
  }

  const output = {
    scanned_rows: rows.length,
    candidate_groups: groups.length,
    apply,
    promote_internal: promoteInternal,
    upserted,
    promoted,
    ...summary,
  };

  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(output);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
