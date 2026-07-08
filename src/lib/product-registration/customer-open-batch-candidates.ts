export type CustomerOpenBatchCandidateRow = {
  id: string;
  internal_code: string | null;
  title: string | null;
  status: string | null;
  audit_report: unknown;
  updated_at: string | null;
};

export type CustomerOpenBatchCandidate = {
  id: string;
  internalCode: string | null;
  title: string | null;
  status: string | null;
  updatedAt: string | null;
  reason: 'not_ready_not_opened' | 'retry_previous_error';
};

type SelectOptions = {
  limit: number;
  includeReady?: boolean;
  retryErrors?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function customerOpenBatchStage(row: Pick<CustomerOpenBatchCandidateRow, 'audit_report'>): string | null {
  const report = asRecord(row.audit_report);
  const autopilot = asRecord(report.upload_to_open_autopilot);
  return typeof autopilot.stage === 'string' ? autopilot.stage : null;
}

export function selectCustomerOpenBatchCandidates(
  rows: CustomerOpenBatchCandidateRow[],
  options: SelectOptions,
): CustomerOpenBatchCandidate[] {
  const limit = Math.max(0, Math.floor(options.limit));
  const candidates: CustomerOpenBatchCandidate[] = [];
  for (const row of rows) {
    if (candidates.length >= limit) break;
    const stage = customerOpenBatchStage(row);
    if (stage === 'ready_not_opened' && !options.includeReady) continue;
    if (stage === 'error' && !options.retryErrors) continue;
    if (stage && stage !== 'error' && stage !== 'ready_not_opened' && !options.retryErrors) continue;
    candidates.push({
      id: row.id,
      internalCode: row.internal_code,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      reason: stage === 'error' ? 'retry_previous_error' : 'not_ready_not_opened',
    });
  }
  return candidates;
}
