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
  reason: 'not_ready_not_opened' | 'retry_previous_error' | 'retry_previous_blocker';
};

type SelectOptions = {
  limit: number;
  includeReady?: boolean;
  retryErrors?: boolean;
  includeTerminalBlocked?: boolean;
  includeRecentRetries?: boolean;
  retryCooldownMinutes?: number;
  now?: Date;
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

export function isTerminalCustomerOpenBatchStage(stage: string | null): boolean {
  return stage === 'expired_ticketing_deadline_detected'
    || stage === 'expired_ticketing_deadline_archived'
    || stage === 'expired_ticketing_deadline_reconfirmation_required';
}

function isRetryStage(stage: string | null): boolean {
  return Boolean(stage && stage !== 'ready_not_opened');
}

function parseDatabaseTimestampMs(value: string): number {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  return new Date(normalized).getTime();
}

function isWithinRetryCooldown(row: CustomerOpenBatchCandidateRow, options: SelectOptions): boolean {
  if (options.includeRecentRetries) return false;
  const cooldownMinutes = options.retryCooldownMinutes ?? 0;
  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes <= 0) return false;
  if (!row.updated_at) return false;
  const updatedAt = parseDatabaseTimestampMs(row.updated_at);
  if (!Number.isFinite(updatedAt)) return false;
  const now = options.now?.getTime() ?? Date.now();
  if (!Number.isFinite(now)) return false;
  return now - updatedAt >= 0 && now - updatedAt < cooldownMinutes * 60 * 1000;
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
    if (isTerminalCustomerOpenBatchStage(stage) && !options.includeTerminalBlocked) continue;
    if (isRetryStage(stage) && isWithinRetryCooldown(row, options)) continue;
    if (stage === 'error' && !options.retryErrors) continue;
    if (stage && stage !== 'error' && stage !== 'ready_not_opened' && !options.retryErrors) continue;
    candidates.push({
      id: row.id,
      internalCode: row.internal_code,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      reason: stage === 'error'
        ? 'retry_previous_error'
        : stage
          ? 'retry_previous_blocker'
          : 'not_ready_not_opened',
    });
  }
  return candidates;
}
