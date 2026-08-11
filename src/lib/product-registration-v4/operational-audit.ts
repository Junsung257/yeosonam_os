import type { SupabaseClient } from '@supabase/supabase-js';

type AnyRow = Record<string, unknown>;

export type ProductRegistrationV5OperationalAudit = {
  generatedAt: string;
  packageId: string | null;
  sampleLimit: number;
  sampled: {
    convergence: AnyRow[];
    outbox: AnyRow[];
    pointers: AnyRow[];
    revisions: AnyRow[];
  };
  summary: {
    convergence: { total: number; byStatus: Record<string, number> };
    outbox: { total: number; byStatus: Record<string, number> };
    pointers: { total: number; byState: Record<string, number> };
    revisions: { total: number; byStatus: Record<string, number> };
  };
  blockers: string[];
  healthy: boolean;
};

function increment(map: Record<string, number>, value: unknown): void {
  const key = typeof value === 'string' && value.trim() ? value : 'unknown';
  map[key] = (map[key] ?? 0) + 1;
}

function summarize(rows: AnyRow[], key: string): Record<string, number> {
  const output: Record<string, number> = {};
  rows.forEach(row => increment(output, row[key]));
  return output;
}

function hasAnyStatus(rows: AnyRow[], key: string, statuses: string[]): boolean {
  return rows.some(row => statuses.includes(String(row[key] ?? '')));
}

export function summarizeProductRegistrationV5OperationalRows(input: {
  convergence: AnyRow[];
  outbox: AnyRow[];
  pointers: AnyRow[];
  revisions: AnyRow[];
  /**
   * Immutable convergence rows for superseded snapshots stay in the audit
   * ledger.  They must remain visible to operators, but must not block the
   * currently published pointer.  When supplied, only these snapshot ids are
   * considered for current-health blockers and convergence summary.
   */
  activeSnapshotIds?: string[];
}): Pick<ProductRegistrationV5OperationalAudit, 'summary' | 'blockers' | 'healthy'> {
  const activeSnapshotIds = new Set(
    (input.activeSnapshotIds ?? []).map(value => String(value).trim()).filter(Boolean),
  );
  const activeConvergence = activeSnapshotIds.size > 0
    ? input.convergence.filter(row => activeSnapshotIds.has(String(row.snapshot_id ?? '').trim()))
    : input.convergence;
  const convergenceByStatus = summarize(activeConvergence, 'status');
  const outboxByStatus = summarize(input.outbox, 'status');
  const pointersByState = summarize(input.pointers, 'state');
  const revisionsByStatus = summarize(input.revisions, 'status');
  const blockers: string[] = [];

  if (input.convergence.length === 0 && input.outbox.length === 0 && input.pointers.length === 0 && input.revisions.length === 0) {
    blockers.push('NO_V5_SAMPLE');
  }

  if (activeSnapshotIds.size > 0 && activeConvergence.length === 0) blockers.push('CONVERGENCE_MISSING');
  if (hasAnyStatus(activeConvergence, 'status', ['pending'])) blockers.push('CONVERGENCE_PENDING');
  if (hasAnyStatus(activeConvergence, 'status', ['stale'])) blockers.push('CONVERGENCE_STALE');
  if (hasAnyStatus(activeConvergence, 'status', ['failed'])) blockers.push('CONVERGENCE_FAILED');
  if (hasAnyStatus(input.outbox, 'status', ['pending'])) blockers.push('OUTBOX_PENDING');
  if (hasAnyStatus(input.outbox, 'status', ['processing'])) blockers.push('OUTBOX_PROCESSING');
  if (hasAnyStatus(input.outbox, 'status', ['failed'])) blockers.push('OUTBOX_FAILED');
  if (hasAnyStatus(input.outbox, 'status', ['dead_letter'])) blockers.push('OUTBOX_DEAD_LETTER');
  if (input.pointers.some(row => !['approved', 'published'].includes(String(row.state ?? '')))) {
    blockers.push('POINTER_NOT_PUBLIC');
  }
  if (input.revisions.some(row => ['blocked', 'needs_review', 'superseded'].includes(String(row.status ?? '')))) {
    blockers.push('REVISION_NOT_PUBLISHABLE');
  }

  return {
    summary: {
      convergence: { total: activeConvergence.length, byStatus: convergenceByStatus },
      outbox: { total: input.outbox.length, byStatus: outboxByStatus },
      pointers: { total: input.pointers.length, byState: pointersByState },
      revisions: { total: input.revisions.length, byStatus: revisionsByStatus },
    },
    blockers,
    healthy: blockers.length === 0,
  };
}

export async function loadProductRegistrationV5OperationalAudit(input: {
  supabase: SupabaseClient;
  packageId?: string | null;
  limit?: number;
}): Promise<ProductRegistrationV5OperationalAudit> {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 200));
  const packageId = typeof input.packageId === 'string' && input.packageId.trim() ? input.packageId.trim() : null;

  const convergenceQuery = input.supabase
    .from('product_registration_v5_cache_convergence_runs')
    .select('id,package_id,snapshot_id,snapshot_hash,surface,route,status,observed_snapshot_hash,observed_at,error_detail,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  const outboxQuery = input.supabase
    .from('product_registration_v5_publication_outbox')
    .select('id,aggregate_id,event_type,dedupe_key,status,attempts,available_at,locked_at,last_error,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  const pointerQuery = input.supabase
    .from('product_registration_v5_publication_pointers')
    .select('package_id,channel,locale,current_revision_id,current_snapshot_id,state,pointer_version,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  const revisionQuery = input.supabase
    .from('product_registration_v5_revisions')
    .select('id,package_id,revision_no,status,payload_hash,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (packageId) {
    convergenceQuery.eq('package_id', packageId);
    outboxQuery.eq('aggregate_id', packageId);
    pointerQuery.eq('package_id', packageId);
    revisionQuery.eq('package_id', packageId);
  }

  const [convergence, outbox, pointers, revisions] = await Promise.all([
    convergenceQuery,
    outboxQuery,
    pointerQuery,
    revisionQuery,
  ]);
  const failedQuery = [convergence, outbox, pointers, revisions].find(result => result.error);
  if (failedQuery?.error) throw failedQuery.error;

  const rows = {
    convergence: (convergence.data ?? []) as AnyRow[],
    outbox: (outbox.data ?? []) as AnyRow[],
    pointers: (pointers.data ?? []) as AnyRow[],
    revisions: (revisions.data ?? []) as AnyRow[],
  };
  const activeSnapshotIds = rows.pointers
    .map(row => row.current_snapshot_id)
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => String(value));
  return {
    generatedAt: new Date().toISOString(),
    packageId,
    sampleLimit: limit,
    sampled: rows,
    ...summarizeProductRegistrationV5OperationalRows({ ...rows, activeSnapshotIds }),
  };
}
