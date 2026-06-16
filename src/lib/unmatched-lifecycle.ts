import { supabaseAdmin } from '@/lib/supabase';

type UnmatchedTerminalStatus = 'added' | 'ignored';

export type CloseUnmatchedOptions = {
  status: UnmatchedTerminalStatus;
  resolvedKind: string;
  resolvedBy: string;
  resolvedAttractionId?: string | null;
  suggestedAction?: string | null;
  segmentKindGuess?: string | null;
  suggestedResolution?: Record<string, unknown> | null;
  classificationVersion?: string | null;
  note?: string | null;
};

export type CandidateCloseOptions = {
  candidateId: string;
  candidateKey?: string | null;
  candidateStatus?: string | null;
  candidateCategory?: string | null;
  candidateLabel?: string | null;
  resolvedBy: string;
};

export function isActiveUnmatched(row: { status?: string | null; resolved_at?: string | null }): boolean {
  return row.status === 'pending' && row.resolved_at == null;
}

export function isTerminalUnmatched(row: { status?: string | null; resolved_at?: string | null }): boolean {
  return row.status === 'added' || row.status === 'ignored' || row.resolved_at != null;
}

export function assertTerminalNotReopened(row: { status?: string | null; resolved_at?: string | null }) {
  if (row.status === 'pending' && row.resolved_at != null) {
    throw new Error('Invalid unmatched lifecycle state: pending row cannot have resolved_at');
  }
}

export async function countActiveUnmatched(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('unmatched_activities')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('resolved_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function closeUnmatchedRows(ids: string[], options: CloseUnmatchedOptions): Promise<number> {
  const cleanIds = [...new Set(ids.filter(Boolean))];
  if (cleanIds.length === 0) return 0;

  const now = new Date().toISOString();
  let closed = 0;
  const chunkSize = 500;

  for (let i = 0; i < cleanIds.length; i += chunkSize) {
    const chunk = cleanIds.slice(i, i + chunkSize);
    const payload: Record<string, unknown> = {
      status: options.status,
      resolved_at: now,
      resolved_kind: options.resolvedKind,
      resolved_by: options.resolvedBy,
      updated_at: now,
    };
    if (options.resolvedAttractionId !== undefined) payload.resolved_attraction_id = options.resolvedAttractionId;
    if (options.suggestedAction !== undefined) payload.suggested_action = options.suggestedAction;
    if (options.segmentKindGuess !== undefined) payload.segment_kind_guess = options.segmentKindGuess;
    if (options.suggestedResolution !== undefined) payload.suggested_resolution = options.suggestedResolution;
    if (options.classificationVersion !== undefined) payload.classification_version = options.classificationVersion;
    if (options.note !== undefined) payload.note = options.note;

    const { data, error } = await supabaseAdmin
      .from('unmatched_activities')
      .update(payload)
      .in('id', chunk)
      .eq('status', 'pending')
      .is('resolved_at', null)
      .select('id');
    if (error) throw error;
    closed += data?.length ?? 0;
  }

  return closed;
}

export function closeUnmatchedAsAdded(ids: string[], options: Omit<CloseUnmatchedOptions, 'status'>) {
  return closeUnmatchedRows(ids, { ...options, status: 'added' });
}

export function closeUnmatchedAsIgnored(ids: string[], options: Omit<CloseUnmatchedOptions, 'status'>) {
  return closeUnmatchedRows(ids, { ...options, status: 'ignored' });
}

export function closeUnmatchedAsCandidateQueued(ids: string[], options: CandidateCloseOptions) {
  return closeUnmatchedAsAdded(ids, {
    resolvedKind: options.candidateStatus === 'auto_internal'
      ? 'internal_candidate_created'
      : 'candidate_review_queue',
    resolvedBy: options.resolvedBy,
    suggestedAction: 'candidate_queue',
    segmentKindGuess: options.candidateCategory ?? undefined,
    suggestedResolution: {
      strategy: 'entity_master_candidate_queue',
      candidate_id: options.candidateId,
      candidate_key: options.candidateKey ?? null,
      candidate_status: options.candidateStatus ?? null,
      candidate_category: options.candidateCategory ?? null,
      candidate_label: options.candidateLabel ?? null,
    },
  });
}
