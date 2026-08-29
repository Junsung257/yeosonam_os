import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';
import { buildPublicPackageSnapshot } from '@/lib/package-publication/public-snapshot';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';

export type MobileProofRefreshCandidateRow = {
  [key: string]: unknown;
  id: string;
  internal_code?: string | null;
  title?: string | null;
  status?: string | null;
  updated_at?: string | null;
  package_revision?: string | number | null;
  audit_report?: unknown;
  immutable_proof?: unknown;
  immutable_snapshot_hash?: string | null;
  immutable_renderer_build_id?: string | null;
};

export type MobileProofRefreshReason =
  | 'missing'
  | 'stale'
  | 'hash_missing'
  | 'surface_missing'
  | 'cta_missing'
  | 'source_invalid'
  | 'status_not_pass'
  | 'unknown';

export type MobileProofRefreshCandidate = {
  id: string;
  internalCode: string | null;
  title: string | null;
  status: string | null;
  updatedAt: string | null;
  reason: MobileProofRefreshReason;
  detail: string;
  priority: number;
};

export function parseMobileProofRefreshStatusFilter(
  value: string | null | undefined,
  fallback: readonly string[],
): string[] {
  const rawStatuses = String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const statuses = rawStatuses.length > 0 ? rawStatuses : [...fallback];
  return [...new Set(statuses)];
}

function reasonFromDetail(detail: string): MobileProofRefreshReason {
  const text = detail.toLowerCase();
  if (text.includes('stale')) return 'stale';
  if (text.includes('hash') || text.includes('revision') || text.includes('build')) return 'hash_missing';
  if (text.includes('cta checks')) return 'cta_missing';
  if (text.includes('surface') || text.includes('lp')) return 'surface_missing';
  if (text.includes('source')) return 'source_invalid';
  if (text.includes('status')) return 'status_not_pass';
  if (text.includes('missing') && text.includes('proof')) return 'missing';
  return 'unknown';
}

function priorityForReason(reason: MobileProofRefreshReason): number {
  switch (reason) {
    case 'status_not_pass':
      return 10;
    case 'missing':
      return 20;
    case 'hash_missing':
      return 30;
    case 'cta_missing':
      return 35;
    case 'surface_missing':
      return 40;
    case 'source_invalid':
      return 50;
    case 'stale':
      return 60;
    default:
      return 90;
  }
}

export function classifyMobileProofRefreshCandidate(
  row: MobileProofRefreshCandidateRow,
): MobileProofRefreshCandidate | null {
  const hasStoredRevision = row.package_revision != null;
  const currentRevision = Number(row.package_revision ?? 1);
  const expectedRevision = hasStoredRevision && Number.isFinite(currentRevision) && currentRevision > 0
    ? (isCustomerVisibleStatus(row.status) ? currentRevision : currentRevision + 1)
    : null;
  const expectedSnapshotHash = expectedRevision
    ? buildPublicPackageSnapshot({
      ...row,
      status: isCustomerVisibleStatus(row.status) ? row.status : 'active',
      package_revision: expectedRevision,
    }).snapshotHash
    : null;
  const immutableProof = row.immutable_proof && typeof row.immutable_proof === 'object'
    ? { mobile_browser_proof: row.immutable_proof }
    : null;
  const proof = evaluateCustomerMobileProof({
    auditReport: immutableProof ?? row.audit_report,
    packageUpdatedAt: row.updated_at ?? null,
    packageRevision: expectedRevision,
    publicSnapshotHash: row.immutable_snapshot_hash ?? expectedSnapshotHash,
    appBuildId: row.immutable_renderer_build_id ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? null,
  });
  if (proof.ok) return null;
  const reason = reasonFromDetail(proof.reason);
  return {
    id: row.id,
    internalCode: row.internal_code ?? null,
    title: row.title ?? null,
    status: row.status ?? null,
    updatedAt: row.updated_at ?? null,
    reason,
    detail: proof.reason,
    priority: priorityForReason(reason),
  };
}

export function selectMobileProofRefreshCandidates(
  rows: MobileProofRefreshCandidateRow[],
  options: { limit?: number; reasons?: MobileProofRefreshReason[] } = {},
): MobileProofRefreshCandidate[] {
  const reasonSet = options.reasons?.length ? new Set(options.reasons) : null;
  return rows
    .map(classifyMobileProofRefreshCandidate)
    .filter((candidate): candidate is MobileProofRefreshCandidate => Boolean(candidate))
    .filter(candidate => !reasonSet || reasonSet.has(candidate.reason))
    .sort((a, b) => (
      a.priority - b.priority
      || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
      || String(a.internalCode ?? a.id).localeCompare(String(b.internalCode ?? b.id))
    ))
    .slice(0, options.limit && options.limit > 0 ? options.limit : rows.length);
}

export function summarizeMobileProofRefreshCandidates(candidates: MobileProofRefreshCandidate[]) {
  const byReason: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const candidate of candidates) {
    byReason[candidate.reason] = (byReason[candidate.reason] ?? 0) + 1;
    byStatus[candidate.status ?? 'null'] = (byStatus[candidate.status ?? 'null'] ?? 0) + 1;
  }
  return {
    total: candidates.length,
    byReason,
    byStatus,
  };
}
