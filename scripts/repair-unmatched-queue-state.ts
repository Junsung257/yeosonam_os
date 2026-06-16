import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });
loadEnv();

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

type ConflictRow = {
  id: string;
  activity: string;
  status: string | null;
  resolved_kind: string | null;
  resolved_at: string | null;
};

function shouldIgnore(row: ConflictRow): boolean {
  const value = `${row.resolved_kind ?? ''} ${row.activity ?? ''}`;
  return /ignore|noise|price|free_time/i.test(value);
}

async function fetchRows(status: string): Promise<ConflictRow[]> {
  const rows: ConflictRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from('unmatched_activities')
      .select('id, activity, status, resolved_kind, resolved_at')
      .eq('status', status)
      .range(from, from + pageSize - 1);
    if (status === 'pending') query = query.not('resolved_at', 'is', null);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data as ConflictRow[]);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function updateIds(ids: string[], status: 'added' | 'ignored') {
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('unmatched_activities')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', chunk);
    if (error) throw error;
  }
}

async function main() {
  const [pendingResolved, legacyResolved] = await Promise.all([
    fetchRows('pending'),
    fetchRows('resolved'),
  ]);

  const pendingToIgnored = pendingResolved.filter(shouldIgnore);
  const pendingToAdded = pendingResolved.filter(row => !shouldIgnore(row));

  if (apply) {
    await updateIds(pendingToAdded.map(row => row.id), 'added');
    await updateIds(pendingToIgnored.map(row => row.id), 'ignored');
    await updateIds(legacyResolved.map(row => row.id), 'added');
  }

  console.log(JSON.stringify({
    apply,
    pending_resolved_conflict: pendingResolved.length,
    pending_to_added: pendingToAdded.length,
    pending_to_ignored: pendingToIgnored.length,
    legacy_resolved_to_added: legacyResolved.length,
    samples: {
      pending_to_added: pendingToAdded.slice(0, 20),
      pending_to_ignored: pendingToIgnored.slice(0, 20),
      legacy_resolved: legacyResolved.slice(0, 20),
    },
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
