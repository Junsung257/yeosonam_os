import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { classifyUnmatchedActivity, type ClassifiedUnmatched } from '../src/lib/unmatched-classifier';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.croncheck.local' });
loadEnv();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const limit = Number(argValue('--limit', '10000'));

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

type ActiveRow = {
  id: string;
  activity: string;
  package_id: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number | null;
  segment_kind_guess: string | null;
  confidence: number | null;
  suggested_action: string | null;
  suggested_resolution: Record<string, unknown> | null;
  source_context: Record<string, unknown> | null;
};

type PlannedAction =
  | 'close_nonblocking_entity'
  | 'ignore_noise'
  | 'keep_attraction_gap'
  | 'keep_manual_review';

type PlanRow = {
  row: ActiveRow;
  classified: ClassifiedUnmatched;
  action: PlannedAction;
};

async function fetchActiveRows(): Promise<ActiveRow[]> {
  const rows: ActiveRow[] = [];
  const pageSize = 1000;
  for (let from = 0; rows.length < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from('unmatched_activities')
      .select('id, activity, package_id, package_title, day_number, country, region, occurrence_count, segment_kind_guess, confidence, suggested_action, suggested_resolution, source_context')
      .eq('status', 'pending')
      .is('resolved_at', null)
      .order('occurrence_count', { ascending: false })
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as ActiveRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

function actionFor(classified: ClassifiedUnmatched): PlannedAction {
  if (['meal', 'transfer', 'hotel'].includes(classified.category)) return 'close_nonblocking_entity';
  if (['notice', 'free_time', 'price_noise'].includes(classified.category)) return 'ignore_noise';
  if (classified.category === 'attraction') return 'keep_attraction_gap';
  return 'keep_manual_review';
}

function suggestedResolution(row: ActiveRow, classified: ClassifiedUnmatched, action: PlannedAction) {
  return {
    category: classified.category,
    action,
    country_scope: row.country,
    destination_scope: row.region ?? row.country,
    policy: classified.category === 'attraction'
      ? 'match-existing-only-no-auto-create'
      : 'entity-category-classification-no-master-create',
    cleanup: {
      mode: 'repair-unmatched-queue-entities',
      reason: action,
      classified_at: new Date().toISOString(),
    },
  };
}

function sourceContext(row: ActiveRow, classified: ClassifiedUnmatched, action: PlannedAction) {
  return {
    ...(row.source_context ?? {}),
    package_id: row.package_id,
    package_title: row.package_title,
    day_number: row.day_number,
    country: row.country,
    destination: row.region ?? row.country,
    customer_visible: !['price_noise', 'free_time', 'notice'].includes(classified.category),
    blocks_publish: classified.category === 'attraction',
    cleanup_action: action,
    classifier: 'unmatched-classifier-v2',
    cleanup_version: 'repair-unmatched-queue-entities-v1',
    cleanup_at: new Date().toISOString(),
  };
}

async function applyPlan(plan: PlanRow[]): Promise<{ updated: number; errors: Array<{ id: string; error: string }> }> {
  let updated = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const item of plan) {
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      segment_kind_guess: item.classified.category,
      confidence: item.classified.confidence,
      suggested_action: item.classified.suggestedAction,
      suggested_resolution: suggestedResolution(item.row, item.classified, item.action),
      source_context: sourceContext(item.row, item.classified, item.action),
      classification_version: 'repair-unmatched-queue-entities-v1',
      updated_at: now,
    };

    if (item.action === 'close_nonblocking_entity') {
      payload.status = 'added';
      payload.resolved_at = now;
      payload.resolved_kind = `auto_entity_${item.classified.category}_nonblocking`;
      payload.resolved_by = 'repair_unmatched_queue_entities';
    } else if (item.action === 'ignore_noise') {
      payload.status = 'ignored';
      payload.resolved_at = now;
      payload.resolved_kind = `auto_ignore_${item.classified.category}`;
      payload.resolved_by = 'repair_unmatched_queue_entities';
      payload.suggested_action = 'auto_ignore_noise';
    }

    const { data, error } = await supabase
      .from('unmatched_activities')
      .update(payload)
      .eq('id', item.row.id)
      .eq('status', 'pending')
      .is('resolved_at', null)
      .select('id');

    if (error) {
      errors.push({ id: item.row.id, error: error.message });
      continue;
    }
    updated += data?.length ?? 0;
  }

  return { updated, errors };
}

function summarize(plan: PlanRow[]) {
  const byAction: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const item of plan) {
    byAction[item.action] = (byAction[item.action] ?? 0) + 1;
    byCategory[item.classified.category] = (byCategory[item.classified.category] ?? 0) + 1;
  }
  return { byAction, byCategory };
}

async function countActivePending(): Promise<number> {
  const { count, error } = await supabase
    .from('unmatched_activities')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('resolved_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  const startedActivePending = await countActivePending();
  const rows = await fetchActiveRows();
  const plan = rows.map(row => {
    const classified = classifyUnmatchedActivity(row.activity, row.segment_kind_guess);
    return { row, classified, action: actionFor(classified) };
  });
  const applyResult = apply ? await applyPlan(plan) : { updated: 0, errors: [] };
  const activePendingAfter = apply ? await countActivePending() : startedActivePending;

  const output = {
    apply,
    scanned: rows.length,
    started_active_pending: startedActivePending,
    active_pending_after: activePendingAfter,
    updated: applyResult.updated,
    errors: applyResult.errors.slice(0, 20),
    ...summarize(plan),
    samples: {
      close_nonblocking_entity: plan.filter(item => item.action === 'close_nonblocking_entity').slice(0, 20).map(sampleFor),
      ignore_noise: plan.filter(item => item.action === 'ignore_noise').slice(0, 20).map(sampleFor),
      keep_attraction_gap: plan.filter(item => item.action === 'keep_attraction_gap').slice(0, 20).map(sampleFor),
      keep_manual_review: plan.filter(item => item.action === 'keep_manual_review').slice(0, 20).map(sampleFor),
    },
  };

  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

function sampleFor(item: PlanRow) {
  return {
    id: item.row.id,
    activity: item.row.activity,
    package_title: item.row.package_title,
    before_category: item.row.segment_kind_guess,
    after_category: item.classified.category,
    action: item.action,
    occurrence_count: item.row.occurrence_count,
  };
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
