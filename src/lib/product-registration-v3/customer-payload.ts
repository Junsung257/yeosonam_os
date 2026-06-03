import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildStandardNoticeCustomerSavePayload,
  type StandardNoticeCustomerSavePayload,
  type StandardNoticeReviewSaveRow,
} from './admin-review';
import type { StandardNoticeDraft } from './standard-notices';
import type { V3DraftLedger, V3GateResult } from './types';

export type V3DraftGateStatus = 'ready_to_publish' | 'needs_review' | 'blocked';

export type LatestV3DraftForPackage = {
  id: string;
  package_id: string | null;
  ledger: V3DraftLedger | null;
  gate_result: V3GateResult | null;
  status: V3DraftGateStatus | string | null;
  created_at: string | null;
};

export type V3CustomerNoticeGate = {
  draft: LatestV3DraftForPackage | null;
  draftStatus: V3DraftGateStatus | null;
  blocksApproval: boolean;
  blockReasons: string[];
  standardNotices: StandardNoticeDraft[];
  payload: StandardNoticeCustomerSavePayload | null;
  payloadError: string | null;
};

export type CustomerSafeNotice = StandardNoticeCustomerSavePayload['notices_parsed'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asGateStatus(value: unknown): V3DraftGateStatus | null {
  return value === 'ready_to_publish' || value === 'needs_review' || value === 'blocked'
    ? value
    : null;
}

function isStandardNoticeDraft(value: unknown): value is StandardNoticeDraft {
  if (!isRecord(value)) return false;
  return (
    typeof value.source_text === 'string' &&
    typeof value.category === 'string' &&
    typeof value.template_key === 'string' &&
    typeof value.standard_text === 'string' &&
    typeof value.visibility === 'string' &&
    typeof value.risk_level === 'string' &&
    typeof value.review_status === 'string' &&
    isRecord(value.values) &&
    Array.isArray(value.evidence)
  );
}

export function collectStandardNoticesFromLedger(ledger: unknown): StandardNoticeDraft[] {
  if (!isRecord(ledger) || !Array.isArray(ledger.variants)) return [];
  const rows: StandardNoticeDraft[] = [];
  for (const variant of ledger.variants) {
    if (!isRecord(variant) || !Array.isArray(variant.standard_notices)) continue;
    for (const notice of variant.standard_notices) {
      if (isStandardNoticeDraft(notice)) rows.push(notice);
    }
  }
  return rows;
}

export function isPublishableStandardNoticeDraft(notice: StandardNoticeDraft): boolean {
  return notice.visibility === 'customer_visible'
    && (notice.review_status === 'auto_clean' || notice.review_status === 'manual_approved');
}

export function buildV3StandardNoticePayload(
  packageId: string,
  ledger: unknown,
): { ok: true; payload: StandardNoticeCustomerSavePayload; rows: StandardNoticeDraft[] } | { ok: false; error: string; rows: StandardNoticeDraft[] } {
  const rows = collectStandardNoticesFromLedger(ledger);
  const result = buildStandardNoticeCustomerSavePayload(
    packageId,
    rows.map(row => ({ ...row, values_valid: true } satisfies StandardNoticeReviewSaveRow)),
  );
  if (!result.ok) return { ok: false, error: result.error, rows };
  return { ok: true, payload: result.payload, rows };
}

export function buildV3StandardNoticeFields(
  ledger: unknown,
): {
  ok: true;
  notices_parsed: StandardNoticeCustomerSavePayload['notices_parsed'];
  customer_notes: string;
  rows: StandardNoticeDraft[];
  saved_count: number;
  skipped_count: number;
} | { ok: false; error: string; rows: StandardNoticeDraft[] } {
  const built = buildV3StandardNoticePayload('', ledger);
  if (!built.ok) return built;
  return {
    ok: true,
    notices_parsed: built.payload.notices_parsed,
    customer_notes: built.payload.customer_notes,
    rows: built.rows,
    saved_count: built.payload.saved_count,
    skipped_count: built.payload.skipped_count,
  };
}

export function getV3DraftGateStatus(draft: Pick<LatestV3DraftForPackage, 'status' | 'gate_result'> | null): V3DraftGateStatus | null {
  if (!draft) return null;
  return asGateStatus(draft.gate_result?.status) ?? asGateStatus(draft.status);
}

export function isV3DraftBlockingCustomerPublish(status: V3DraftGateStatus | null): boolean {
  return status === 'blocked' || status === 'needs_review';
}

export function summarizeV3GateBlockReasons(draft: LatestV3DraftForPackage | null): string[] {
  const checks = Array.isArray(draft?.gate_result?.checks) ? draft!.gate_result!.checks : [];
  return checks
    .filter(check => check.status === 'fail' || check.status === 'warn')
    .map(check => check.message || check.id)
    .filter((message): message is string => Boolean(message))
    .slice(0, 20);
}

export function evaluateV3CustomerNoticeGate(
  packageId: string,
  draft: LatestV3DraftForPackage | null,
): V3CustomerNoticeGate {
  const draftStatus = getV3DraftGateStatus(draft);
  const built = draft ? buildV3StandardNoticePayload(packageId, draft.ledger) : null;
  return {
    draft,
    draftStatus,
    blocksApproval: isV3DraftBlockingCustomerPublish(draftStatus),
    blockReasons: summarizeV3GateBlockReasons(draft),
    standardNotices: built?.rows ?? [],
    payload: built?.ok ? built.payload : null,
    payloadError: built && !built.ok ? built.error : null,
  };
}

export async function loadLatestV3DraftForPackage(
  sb: SupabaseClient,
  packageId: string,
): Promise<LatestV3DraftForPackage | null> {
  const { data, error } = await sb
    .from('product_registration_drafts')
    .select('id, package_id, ledger, gate_result, status, created_at')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as LatestV3DraftForPackage;
}

export function isPublishableStandardNotice(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.text === 'string' &&
    typeof value.category === 'string' &&
    typeof value.template_key === 'string' &&
    (value.review_status === 'auto_clean' || value.review_status === 'manual_approved')
  );
}

export function isCustomerSafeNotice(value: unknown): value is CustomerSafeNotice {
  if (!isPublishableStandardNotice(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.title === 'string' &&
    typeof record.type === 'string' &&
    isRecord(record.values)
  );
}

function flattenCustomerNoticeText(pkg: { notices_parsed?: unknown; customer_notes?: unknown }): string {
  const notices = Array.isArray(pkg.notices_parsed) ? pkg.notices_parsed : [];
  return [
    ...notices.map(notice => {
      if (typeof notice === 'string') return notice;
      if (!isRecord(notice)) return '';
      return [notice.title, notice.text].filter(value => typeof value === 'string').join('\n');
    }),
    typeof pkg.customer_notes === 'string' ? pkg.customer_notes : '',
  ].join('\n');
}

export function hasSupplierRemarkRawLeakRisk(pkg: { notices_parsed?: unknown; customer_notes?: unknown }): boolean {
  const notices = Array.isArray(pkg.notices_parsed) ? pkg.notices_parsed : [];
  const hasStandardMeta = notices.some(notice => isPublishableStandardNotice(notice));
  if (hasStandardMeta) return false;
  const text = flattenCustomerNoticeText(pkg);
  if (!text.trim()) return false;
  return /REMARK|리마크|랜드사\s*(?:비고|안내)|여권\s*6개월|전자\s*담배\s*반입|룸\s*배정|일정\s*미참여|마사지\s*팁|싱글\s*차지|single\s*charge/i.test(text);
}

export function hasUnsafeCustomerNoticeMutation(input: { notices_parsed?: unknown; customer_notes?: unknown }): boolean {
  const hasNoticePatch = Object.prototype.hasOwnProperty.call(input, 'notices_parsed')
    || Object.prototype.hasOwnProperty.call(input, 'customer_notes');
  if (!hasNoticePatch) return false;

  const notices = Array.isArray(input.notices_parsed) ? input.notices_parsed : [];
  const hasNonStandardNotice = notices.some(notice => !isCustomerSafeNotice(notice));
  return hasNonStandardNotice || hasSupplierRemarkRawLeakRisk(input);
}

export function sanitizeCustomerVisibleNotices<T>(notices: T[] | null | undefined, options: { strictStandardOnly?: boolean } = {}): T[] {
  if (!Array.isArray(notices)) return [];
  if (!options.strictStandardOnly) return notices;
  return notices.filter(isPublishableStandardNotice);
}
