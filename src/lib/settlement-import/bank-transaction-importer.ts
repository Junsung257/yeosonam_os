import { createHash } from 'crypto';
import {
  buildBankTransactionFingerprint,
  normalizeBankTransactionText,
  scoreBankTransactionSimilarity,
} from '@/lib/bank-transaction-fingerprint';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';
import {
  parseTravelSettlementMemo,
  type ParsedTravelSettlementMemo,
} from './bank-statement-parser';
import { applyClobeMemoCorrection } from './booking-settlement-keys';
import { resolveSettlementMemoBooking } from './booking-settlement-keys';
import {
  canAutoMatchSettlementMemo,
  type SettlementMemoResolutionSource,
} from './memo-auto-match-policy';
import {
  canFuzzyMatchProviderTransaction,
  isClobeBootstrapCandidate,
  isClobeLegacyDuplicateCandidate,
  isProbableBankTransactionDuplicate,
  isUniqueClobeLegacyDuplicate,
  selectUniqueClobeBootstrapCandidate,
} from './bank-transaction-dedupe-policy';
import { evaluateProviderMemoChange } from './provider-memo-change';
import {
  accountEvidenceFieldsFor,
  accountFieldsFor,
} from './bank-transaction-account-evidence';

export type BankTransactionImportSource = 'bulk_import' | 'clobe_mcp' | 'clobe_api';
export type BankTransactionImportAction =
  | 'insert'
  | 'invalid_row_review'
  | 'booking_candidate_review'
  | 'already_processed'
  | 'merge_candidate'
  | 'duplicate_review'
  | 'ignored_non_travel'
  | 'non_travel_recorded'
  | 'memo_changed_review'
  | 'memo_updated'
  | 'legacy_repaired';

export interface BankTransactionImportRow {
  receivedAt: string;
  depositAmount: number;
  withdrawAmount: number;
  counterpartyName: string;
  memo: string;
  accountNumber?: string;
  originalLine?: string;
  rowIndex?: number;
  externalProvider?: string;
  externalTransactionId?: string;
  balanceAfter?: number;
  providerCategory?: string;
  providerIsUnclassified?: boolean;
  rawPayload?: Record<string, unknown>;
}

interface ExistingBankTxCandidate {
  id: string;
  amount: number;
  transaction_type: string;
  counterparty_name: string | null;
  received_at: string;
  booking_id: string | null;
  match_status: string | null;
  source?: string | null;
  memo?: string | null;
  source_metadata?: Record<string, unknown> | null;
  external_provider?: string | null;
  external_transaction_id?: string | null;
  settlement_scope?: 'travel' | 'non_travel' | null;
}

export interface BankTransactionImportPreviewRow {
  receivedAt: string;
  type: '입금' | '출금';
  amount: number;
  counterpartyName: string;
  memo: string;
  matchStatus: 'auto' | 'review' | 'unmatched';
  confidence: number;
  matchReasons: string[];
  bookingNo?: string | null;
  bookingId?: string | null;
  customerName?: string | null;
  eventId: string;
  transactionFingerprint: string;
  importAction: BankTransactionImportAction;
  resolutionSource: string | null;
  existingTxId: string | null;
  existingMatchStatus: string | null;
  duplicateConfidence: number;
  externalProvider?: string | null;
  externalTransactionId?: string | null;
  previousMemo?: string | null;
  memoChanged?: boolean;
  status?: string;
  txId?: string;
  error?: string;
}

export interface BankTransactionImportResult {
  preview?: boolean;
  rows?: BankTransactionImportPreviewRow[];
  inserted: number;
  skipped: number;
  duplicates: number;
  merged: number;
  errors: number;
  matched: number;
  repaired: number;
  memoUpdated: number;
  memoChangedReview: number;
  bookingCandidateReview: number;
  nonTravelStored: number;
  skippedNoMemo: number;
  firstError: string | null;
  results: BankTransactionImportPreviewRow[];
}

interface ProcessOptions {
  source: BankTransactionImportSource;
  preview?: boolean;
  actor: string;
  createMissingBookings?: boolean;
}

function stableEventId(source: BankTransactionImportSource, row: BankTransactionImportRow, fingerprint: string): string {
  const externalKey = row.externalProvider && row.externalTransactionId
    ? `${row.externalProvider}:${row.externalTransactionId}`
    : fingerprint;
  return `${source}_${createHash('sha256').update(externalKey).digest('hex')}`;
}

function normalizedMemoKeyOf(value: string | null | undefined): string | null {
  return parseTravelSettlementMemo(value)?.normalizedKey ?? null;
}

function suggestedBookingIdOf(sourceMetadata: Record<string, unknown> | null | undefined, source: BankTransactionImportSource): string | null {
  const sourcePayload = sourceMetadata?.[source];
  if (!sourcePayload || typeof sourcePayload !== 'object') return null;
  const value = (sourcePayload as { suggested_booking_id?: unknown }).suggested_booking_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sourceMetadataFor(input: {
  source: BankTransactionImportSource;
  eventId: string;
  row: BankTransactionImportRow;
  parsed?: ParsedTravelSettlementMemo | null;
  suggestedBookingId?: string | null;
}) {
  return {
    event_id: input.eventId,
    received_at: input.row.receivedAt,
    account_number: input.row.accountNumber ?? null,
    counterparty_name: input.row.counterpartyName,
    memo: input.row.memo,
    original_line: input.row.originalLine ?? null,
    row_index: input.row.rowIndex ?? null,
    settlement_key: input.parsed?.normalizedKey ?? null,
    purpose_tags: input.parsed?.purposeTags ?? [],
    external_provider: input.row.externalProvider ?? null,
    external_transaction_id: input.row.externalTransactionId ?? null,
    suggested_booking_id: input.suggestedBookingId ?? null,
    imported_at: new Date().toISOString(),
  };
}

async function matchTransactionAllocations(params: {
  transactionId: string;
  allocations: { bookingId: string; amount: number; ledgerDelta?: number }[];
  confidence?: number;
  actor: string;
  notes?: string;
}) {
  const { data, error } = await supabaseAdmin.rpc('match_bank_transaction_allocations', {
    p_transaction_id: params.transactionId,
    p_allocations: params.allocations,
    p_match_confidence: params.confidence ?? 1,
    p_matched_by: params.actor,
    p_notes: params.notes ?? null,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    const status = code === 'P0002' ? 404 : 400;
    throw Object.assign(new Error(sanitizeDbError(error)), { status });
  }
  return data;
}

async function getActiveAllocationShape(transactionId: string): Promise<{
  hasAllocation: boolean;
  memoCorrectionRequiresReview: boolean;
}> {
  const { data, error } = await supabaseAdmin
    .from('bank_transaction_allocations')
    .select('id, booking_id')
    .eq('bank_transaction_id', transactionId)
    .eq('status', 'active');
  if (error) throw new Error(`bank transaction allocation lookup failed: ${sanitizeDbError(error)}`);
  const rows = (data ?? []) as Array<{ id: string; booking_id: string | null }>;
  const bookingIds = new Set(rows.map(row => row.booking_id).filter((id): id is string => typeof id === 'string'));
  return {
    hasAllocation: rows.length > 0,
    // A provider transaction split across bookings, or containing a
    // non-booking allocation, cannot use one corrected memo to rename a
    // representative booking. It must be reviewed and reallocated explicitly.
    memoCorrectionRequiresReview: rows.length > 1 || rows.some(row => !row.booking_id) || bookingIds.size > 1,
  };
}

async function isBookingSettlementFinalized(bookingId: string | null | undefined): Promise<boolean> {
  if (!bookingId) return false;
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('settlement_confirmed_at')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw new Error(`booking settlement status lookup failed: ${sanitizeDbError(error)}`);
  return Boolean((data as { settlement_confirmed_at?: string | null } | null)?.settlement_confirmed_at);
}

async function repairLegacyBankTransactionAllocation(params: {
  transactionId: string;
  bookingId: string;
  actor: string;
  notes: string;
}) {
  const { data, error } = await supabaseAdmin.rpc('repair_legacy_bank_transaction_allocation', {
    p_transaction_id: params.transactionId,
    p_target_booking_id: params.bookingId,
    p_matched_by: params.actor,
    p_notes: params.notes,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    const status = code === 'P0002' ? 404 : 400;
    throw Object.assign(new Error(sanitizeDbError(error)), { status });
  }
  return data as { already_repaired?: boolean; previous_booking_id?: string | null };
}

async function allocateExistingTransaction(params: {
  existing: ExistingBankTxCandidate;
  hasAllocation: boolean;
  bookingId: string;
  amount: number;
  confidence: number;
  actor: string;
  notes: string;
}): Promise<'matched' | 'legacy_repaired' | 'already_processed'> {
  if (params.hasAllocation) return 'already_processed';

  const legacyMatched = Boolean(params.existing.booking_id)
    || params.existing.match_status === 'manual'
    || params.existing.match_status === 'auto';
  if (legacyMatched) {
    await repairLegacyBankTransactionAllocation({
      transactionId: params.existing.id,
      bookingId: params.bookingId,
      actor: params.actor,
      notes: params.notes,
    });
    return 'legacy_repaired';
  }

  await matchTransactionAllocations({
    transactionId: params.existing.id,
    allocations: [{ bookingId: params.bookingId, amount: params.amount }],
    confidence: params.confidence,
    actor: params.actor,
    notes: params.notes,
  });
  return 'matched';
}

async function findExistingBankTransaction(input: {
  tenantId?: string | null;
  receivedAt: string;
  txType: string;
  amount: number;
  counterpartyName: string;
  memo?: string;
  fingerprint: string;
  externalProvider?: string | null;
  externalTransactionId?: string | null;
  incomingSource?: BankTransactionImportSource;
  excludedIds?: Set<string>;
}): Promise<{ kind: 'exact' | 'reconciled' | 'probable' | null; row: ExistingBankTxCandidate | null; confidence: number }> {
  if (input.externalProvider && input.externalTransactionId) {
    const external = await supabaseAdmin
      .from('bank_transactions')
      .select('id, amount, transaction_type, counterparty_name, received_at, booking_id, match_status, source, memo, source_metadata, external_provider, external_transaction_id')
      .eq('external_provider', input.externalProvider)
      .eq('external_transaction_id', input.externalTransactionId)
      .neq('status', 'excluded')
      .maybeSingle();

    if (external.data) {
      return { kind: 'exact', row: external.data as ExistingBankTxCandidate, confidence: 1 };
    }
  }

  const exact = await supabaseAdmin
    .from('bank_transactions')
    .select('id, amount, transaction_type, counterparty_name, received_at, booking_id, match_status, source, memo, source_metadata, external_provider, external_transaction_id')
    .eq('transaction_fingerprint', input.fingerprint)
    .neq('status', 'excluded')
    .maybeSingle();

  if (exact.data) {
    return { kind: 'exact', row: exact.data as ExistingBankTxCandidate, confidence: 1 };
  }

  const center = new Date(input.receivedAt);
  if (Number.isNaN(center.getTime())) return { kind: null, row: null, confidence: 0 };

  const from = new Date(center.getTime() - 60 * 60_000).toISOString();
  const to = new Date(center.getTime() + 60 * 60_000).toISOString();
  let query = supabaseAdmin
    .from('bank_transactions')
    .select('id, amount, transaction_type, counterparty_name, received_at, booking_id, match_status, source, memo, source_metadata, external_provider, external_transaction_id')
    .eq('transaction_type', input.txType)
    .eq('amount', input.amount)
    .gte('received_at', from)
    .lte('received_at', to)
    .neq('status', 'excluded')
    .limit(20);

  if (input.tenantId) query = query.eq('tenant_id', input.tenantId) as typeof query;
  else query = query.is('tenant_id', null) as typeof query;

  const { data } = await query;
  let best: ExistingBankTxCandidate | null = null;
  let bestScore = 0;
  const normalizedIncomingName = normalizeBankTransactionText(input.counterpartyName);
  const normalizedIncomingMemo = normalizeBankTransactionText(input.memo);
  const availableCandidates = ((data ?? []) as ExistingBankTxCandidate[])
    .filter(candidate => !input.excludedIds?.has(candidate.id));
  const clobeBootstrapCandidates = availableCandidates
    .filter(candidate => {
      const normalizedCandidateName = normalizeBankTransactionText(candidate.counterparty_name);
      const sameCounterparty = Boolean(
        normalizedCandidateName
        && normalizedIncomingName
        && (normalizedCandidateName === normalizedIncomingName
          || normalizedCandidateName.includes(normalizedIncomingName)
          || normalizedIncomingName.includes(normalizedCandidateName)),
      );
      const candidateTime = new Date(candidate.received_at).getTime();
      return isClobeBootstrapCandidate({
        incomingSource: input.incomingSource,
        existingSource: candidate.source,
        existingExternalTransactionId: candidate.external_transaction_id,
        sameTransactionType: candidate.transaction_type === input.txType,
        sameAmount: Number(candidate.amount) === Number(input.amount),
        sameCounterparty,
        sameMinute: Number.isFinite(candidateTime)
          && Math.floor(candidateTime / 60_000) === Math.floor(center.getTime() / 60_000),
      });
    })
    .map(candidate => ({
      value: candidate,
      sameMemo: Boolean(
        normalizedIncomingMemo
        && normalizeBankTransactionText(candidate.memo) === normalizedIncomingMemo
      ),
    }));
  const clobeBootstrapMatch = selectUniqueClobeBootstrapCandidate(clobeBootstrapCandidates);
  if (clobeBootstrapMatch) {
    return {
      kind: 'reconciled',
      row: clobeBootstrapMatch,
      confidence: Math.max(scoreBankTransactionSimilarity(clobeBootstrapMatch, input), 0.95),
    };
  }

  const fuzzyCandidates = availableCandidates.filter(candidate => canFuzzyMatchProviderTransaction({
    incomingExternalProvider: input.externalProvider,
    incomingExternalTransactionId: input.externalTransactionId,
    existingExternalProvider: candidate.external_provider,
    existingExternalTransactionId: candidate.external_transaction_id,
  }));
  const crossSourceCandidates = fuzzyCandidates.filter(candidate => {
    const normalizedCandidateName = normalizeBankTransactionText(candidate.counterparty_name);
    const sameCounterparty = Boolean(
      normalizedCandidateName
      && normalizedIncomingName
      && (normalizedCandidateName === normalizedIncomingName
        || normalizedCandidateName.includes(normalizedIncomingName)
        || normalizedIncomingName.includes(normalizedCandidateName)),
    );
    return isClobeLegacyDuplicateCandidate({
      incomingSource: input.incomingSource,
      existingSource: candidate.source,
      sameTransactionType: candidate.transaction_type === input.txType,
      sameAmount: Number(candidate.amount) === Number(input.amount),
      sameCounterparty,
      timeDifferenceMs: Math.abs(new Date(candidate.received_at).getTime() - center.getTime()),
    });
  });
  const uniqueCrossSourceId = crossSourceCandidates.length === 1
    ? crossSourceCandidates[0]?.id
    : null;
  for (const row of fuzzyCandidates) {
    const score = scoreBankTransactionSimilarity(row, input);
    const adjustedScore = isUniqueClobeLegacyDuplicate(row.id === uniqueCrossSourceId, crossSourceCandidates.length)
      ? Math.max(score, 0.78)
      : score;
    if (adjustedScore > bestScore) {
      best = row;
      bestScore = adjustedScore;
    }
  }

  // A weak similarity is only a review hint. It must never suppress the
  // incoming row because one memo key can legitimately have many payments.
  const probable = isProbableBankTransactionDuplicate(bestScore);
  return { kind: probable ? 'probable' : null, row: probable ? best : null, confidence: bestScore };
}

async function attachImportEvidence(existingId: string, input: {
  source: BankTransactionImportSource;
  fingerprint: string;
  row: BankTransactionImportRow;
  eventId: string;
  parsed: ParsedTravelSettlementMemo | null;
  suggestedBookingId?: string | null;
}) {
  const { data: existing } = await supabaseAdmin
    .from('bank_transactions')
    .select('source_metadata')
    .eq('id', existingId)
    .maybeSingle();
  const previousMetadata = ((existing as { source_metadata?: Record<string, unknown> } | null)?.source_metadata ?? {}) as Record<string, unknown>;

  const patch: Record<string, unknown> = {
    transaction_fingerprint: input.fingerprint,
    raw_payload: input.row.rawPayload ?? {},
    // Provider evidence is not an accounting reclassification.
    ...accountEvidenceFieldsFor(input.row),
    source_metadata: {
      ...previousMetadata,
      [input.source]: sourceMetadataFor(input),
    },
  };
  if (input.row.externalProvider && input.row.externalTransactionId) {
    patch.external_provider = input.row.externalProvider;
    patch.external_transaction_id = input.row.externalTransactionId;
  }

  const { error } = await supabaseAdmin
    .from('bank_transactions')
    .update(patch)
    .eq('id', existingId);
  if (error) throw new Error(`bank transaction evidence update failed: ${sanitizeDbError(error)}`);
}

async function findExcludedTransactionByFingerprint(
  fingerprint: string,
): Promise<ExistingBankTxCandidate | null> {
  const { data, error } = await supabaseAdmin
    .from('bank_transactions')
    .select('id, amount, transaction_type, counterparty_name, received_at, booking_id, match_status, source, memo, source_metadata, external_provider, external_transaction_id')
    .eq('transaction_fingerprint', fingerprint)
    .eq('status', 'excluded')
    .maybeSingle();

  if (error) throw new Error(`excluded bank transaction lookup failed: ${sanitizeDbError(error)}`);
  return (data as ExistingBankTxCandidate | null) ?? null;
}

async function restoreExcludedTransactionAsClobe(input: {
  existing: ExistingBankTxCandidate;
  source: BankTransactionImportSource;
  fingerprint: string;
  row: BankTransactionImportRow;
  parsed: ParsedTravelSettlementMemo;
  eventId: string;
  txType: string;
  amount: number;
  suggestedBookingId?: string | null;
}) {
  const previousMetadata = input.existing.source_metadata ?? {};
  const clobeMetadata = sourceMetadataFor({
    source: input.source,
    eventId: input.eventId,
    row: input.row,
    parsed: input.parsed,
    suggestedBookingId: input.suggestedBookingId,
  });
  const { error } = await supabaseAdmin
    .from('bank_transactions')
    .update({
      slack_event_id: input.eventId,
      raw_message: `[${input.source}] ${input.row.memo}`,
      transaction_fingerprint: input.fingerprint,
      source: input.source,
      source_metadata: { ...previousMetadata, [input.source]: clobeMetadata },
      external_provider: input.row.externalProvider ?? null,
      external_transaction_id: input.row.externalTransactionId ?? null,
      transaction_type: input.txType,
      amount: input.amount,
      counterparty_name: input.row.counterpartyName,
      memo: input.row.memo,
      received_at: input.row.receivedAt,
      booking_id: null,
      match_status: 'unmatched',
      match_confidence: 0,
      matched_by: null,
      matched_at: null,
      status: 'active',
      deleted_at: null,
      ...accountFieldsFor(input.row, 'travel'),
    } as Record<string, unknown>)
    .eq('id', input.existing.id)
    .eq('status', 'excluded');

  if (error) throw new Error(`excluded bank transaction restore failed: ${sanitizeDbError(error)}`);

  return {
    ...input.existing,
    amount: input.amount,
    transaction_type: input.txType,
    counterparty_name: input.row.counterpartyName,
    received_at: input.row.receivedAt,
    booking_id: null,
    match_status: 'unmatched',
    source: input.source,
    memo: input.row.memo,
    source_metadata: { ...previousMetadata, [input.source]: clobeMetadata },
    external_provider: input.row.externalProvider ?? null,
    external_transaction_id: input.row.externalTransactionId ?? null,
    settlement_scope: 'travel',
  } satisfies ExistingBankTxCandidate;
}

async function updateUnprocessedDuplicateFromMemo(input: {
  existingId: string;
  source: BankTransactionImportSource;
  fingerprint: string;
  row: BankTransactionImportRow;
  parsed: ParsedTravelSettlementMemo;
  eventId: string;
  matchStatus: 'auto' | 'review' | 'unmatched';
  confidence: number;
  suggestedBookingId?: string | null;
}) {
  const { data: existing } = await supabaseAdmin
    .from('bank_transactions')
    .select('source_metadata')
    .eq('id', input.existingId)
    .maybeSingle();
  const previousMetadata = ((existing as { source_metadata?: Record<string, unknown> } | null)?.source_metadata ?? {}) as Record<string, unknown>;

  const patch: Record<string, unknown> = {
    memo: input.row.memo,
    counterparty_name: input.row.counterpartyName,
    transaction_fingerprint: input.fingerprint,
    raw_payload: input.row.rawPayload ?? {},
    match_status: input.matchStatus === 'auto' ? 'unmatched' : input.matchStatus,
    match_confidence: input.matchStatus === 'auto' ? 0 : input.confidence,
    ...accountFieldsFor(input.row, 'travel'),
    source_metadata: {
      ...previousMetadata,
      [input.source]: sourceMetadataFor({ ...input, suggestedBookingId: input.suggestedBookingId }),
    },
  };
  if (input.row.externalProvider && input.row.externalTransactionId) {
    patch.external_provider = input.row.externalProvider;
    patch.external_transaction_id = input.row.externalTransactionId;
  }

  const { error } = await supabaseAdmin
    .from('bank_transactions')
    .update(patch)
    .eq('id', input.existingId);
  if (error) throw new Error(`bank transaction memo update failed: ${sanitizeDbError(error)}`);
}

async function updateProcessedDuplicateFromMemo(input: {
  existingId: string;
  source: BankTransactionImportSource;
  fingerprint: string;
  row: BankTransactionImportRow;
  parsed: ParsedTravelSettlementMemo;
  eventId: string;
  suggestedBookingId?: string | null;
}) {
  const { data: existing } = await supabaseAdmin
    .from('bank_transactions')
    .select('source_metadata')
    .eq('id', input.existingId)
    .maybeSingle();
  const previousMetadata = ((existing as { source_metadata?: Record<string, unknown> } | null)?.source_metadata ?? {}) as Record<string, unknown>;

  const { error } = await supabaseAdmin
    .from('bank_transactions')
    .update({
      memo: input.row.memo,
      counterparty_name: input.row.counterpartyName,
      transaction_fingerprint: input.fingerprint,
      raw_payload: input.row.rawPayload ?? {},
      ...accountFieldsFor(input.row, 'travel'),
      source_metadata: {
        ...previousMetadata,
        [input.source]: sourceMetadataFor({ ...input, suggestedBookingId: input.suggestedBookingId }),
      },
    } as Record<string, unknown>)
    .eq('id', input.existingId);
  if (error) throw new Error(`processed bank transaction memo update failed: ${sanitizeDbError(error)}`);
}

async function flagProcessedMemoChange(input: {
  source: BankTransactionImportSource;
  existing: ExistingBankTxCandidate;
  row: BankTransactionImportRow;
  parsed: ParsedTravelSettlementMemo;
  matchedBooking: { id: string; booking_no?: string | null; customer_name?: string | null } | null;
  eventId: string;
  fingerprint: string;
}) {
  const previousMemo = input.existing.memo ?? null;
  const previousKey = normalizedMemoKeyOf(previousMemo);
  const now = new Date().toISOString();

  await attachImportEvidence(input.existing.id, {
    source: input.source,
    fingerprint: input.fingerprint,
    row: input.row,
    eventId: input.eventId,
    parsed: input.parsed,
    suggestedBookingId: input.existing.booking_id
      ? null
      : suggestedBookingIdOf(input.existing.source_metadata, input.source),
  });

  const { error: reviewUpdateError } = await supabaseAdmin
    .from('bank_transactions')
    .update({
      match_status: 'review',
      matched_by: 'clobe_memo_change_review',
      ...accountFieldsFor(input.row, 'travel'),
    } as Record<string, unknown>)
    .eq('id', input.existing.id);
  if (reviewUpdateError) {
    throw new Error(`bank transaction memo review update failed: ${sanitizeDbError(reviewUpdateError)}`);
  }

  const { data: existingEvent } = await supabaseAdmin
    .from('ops_events')
    .select('id')
    .eq('bank_transaction_id', input.existing.id)
    .eq('status', 'open')
    .eq('event_type', 'payment_imported')
    .limit(1)
    .maybeSingle();
  if (existingEvent) return;

  const { error } = await supabaseAdmin
    .from('ops_events')
    .insert({
      event_type: 'payment_imported',
      severity: 'warning',
      title: 'Clobe memo changed after financial match',
      description: `Provider memo changed from ${previousMemo ?? '(empty)'} to ${input.row.memo}. Review before moving ledger allocation.`,
      booking_id: input.existing.booking_id ?? null,
      bank_transaction_id: input.existing.id,
      target_type: 'bank_transactions',
      target_id: input.existing.id,
      status: 'open',
      metadata: {
        source: input.source,
        detected_at: now,
        previous_memo: previousMemo,
        previous_settlement_key: previousKey,
        new_memo: input.row.memo,
        new_settlement_key: input.parsed.normalizedKey,
        current_booking_id: input.existing.booking_id ?? null,
        suggested_booking_id: input.matchedBooking?.id ?? null,
        suggested_booking_no: input.matchedBooking?.booking_no ?? null,
        suggested_customer_name: input.matchedBooking?.customer_name ?? null,
        external_provider: input.row.externalProvider ?? null,
        external_transaction_id: input.row.externalTransactionId ?? null,
      },
      created_by: 'clobe_sync',
    } as Record<string, unknown>);

  if (error) {
    console.warn('[clobe sync] memo change review event failed:', sanitizeDbError(error));
  }
}

async function enqueueBookingCandidateReview(input: {
  transactionId: string;
  source: BankTransactionImportSource;
  row: BankTransactionImportRow;
  parsed: ParsedTravelSettlementMemo;
  eventId: string;
  suggestedBookingId?: string | null;
}) {
  const legacyTitle = 'Clobe memo has no existing booking candidate';
  const title = input.suggestedBookingId
    ? 'Clobe memo existing booking approval required'
    : 'Clobe memo booking review required';
  const { data: existingEvent, error: lookupError } = await supabaseAdmin
    .from('ops_events')
    .select('id')
    .eq('bank_transaction_id', input.transactionId)
    .eq('event_type', 'payment_imported')
    .eq('status', 'open')
    .in('title', [legacyTitle, 'Clobe memo existing booking approval required', 'Clobe memo booking review required'])
    .limit(1)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`booking candidate review lookup failed: ${sanitizeDbError(lookupError)}`);
  }
  if (existingEvent) return;

  const { error } = await supabaseAdmin.from('ops_events').insert({
    event_type: 'payment_imported',
    severity: 'warning',
    title,
    description: input.suggestedBookingId
      ? `Clobe 거래 메모 ${input.row.memo}와 일치하는 기존 예약 후보가 있습니다. 입금 연결 전 운영자 승인이 필요합니다.`
      : `Clobe 거래 메모 ${input.row.memo}의 예약 후보가 없거나 여러 건입니다. 운영자 검토가 필요합니다.`,
    bank_transaction_id: input.transactionId,
    target_type: 'booking_candidate',
    target_id: input.transactionId,
    status: 'open',
    metadata: {
      source: input.source,
      event_id: input.eventId,
      received_at: input.row.receivedAt,
      amount: input.row.depositAmount > 0 ? input.row.depositAmount : input.row.withdrawAmount,
      transaction_type: input.row.depositAmount > 0 ? '입금' : '출금',
      memo: input.row.memo,
      normalized_key: input.parsed.normalizedKey,
      lead_customer_name: input.parsed.leadCustomerName,
      land_operator_name: input.parsed.landOperatorName,
      departure_date: input.parsed.departureDate,
      external_provider: input.row.externalProvider ?? null,
      external_transaction_id: input.row.externalTransactionId ?? null,
      suggested_booking_id: input.suggestedBookingId ?? null,
      requires_admin_booking_command: true,
    },
    created_by: 'clobe_sync',
  } as Record<string, unknown>);
  if (error) {
    throw new Error(`booking candidate review enqueue failed: ${sanitizeDbError(error)}`);
  }
}

async function persistNonTravelClobeTransaction(input: {
  source: BankTransactionImportSource;
  row: BankTransactionImportRow;
  eventId: string;
  fingerprint: string;
  txType: '입금' | '출금';
  amount: number;
  existing?: ExistingBankTxCandidate | null;
}): Promise<{ id: string | null; inserted: boolean }> {
  const metadata = sourceMetadataFor({
    source: input.source,
    eventId: input.eventId,
    row: input.row,
    parsed: null,
  });
  const common = {
    slack_event_id: input.eventId,
    raw_message: `[${input.source}] ${input.row.memo}`,
    transaction_fingerprint: input.fingerprint,
    source: input.source,
    external_provider: input.row.externalProvider ?? null,
    external_transaction_id: input.row.externalTransactionId ?? null,
    raw_payload: input.row.rawPayload ?? {},
    transaction_type: input.txType,
    amount: input.amount,
    counterparty_name: input.row.counterpartyName,
    memo: input.row.memo,
    received_at: input.row.receivedAt,
    booking_id: null,
    match_status: 'unmatched',
    match_confidence: 0,
    matched_by: null,
    matched_at: null,
    status: 'active',
    deleted_at: null,
    ...accountFieldsFor(input.row, 'non_travel'),
  };

  if (input.existing) {
    const previousMetadata = input.existing.source_metadata ?? {};
    const { error } = await supabaseAdmin
      .from('bank_transactions')
      .update({
        ...common,
        source_metadata: { ...previousMetadata, [input.source]: metadata },
      } as Record<string, unknown>)
      .eq('id', input.existing.id);
    if (error) throw new Error(`non-travel bank transaction update failed: ${sanitizeDbError(error)}`);
    return { id: input.existing.id, inserted: false };
  }

  const { data, error } = await supabaseAdmin
    .from('bank_transactions')
    .insert({
      ...common,
      source_metadata: { [input.source]: metadata },
      is_refund: false,
      is_fee: false,
      fee_amount: 0,
    } as Record<string, unknown>)
    .select('id')
    .single();
  if (error) throw new Error(`non-travel bank transaction insert failed: ${sanitizeDbError(error)}`);
  return { id: (data as { id?: string } | null)?.id ?? null, inserted: true };
}

async function flagTravelTransactionDeclassification(input: {
  source: BankTransactionImportSource;
  existing: ExistingBankTxCandidate;
  row: BankTransactionImportRow;
  eventId: string;
  fingerprint: string;
}) {
  const previousMetadata = input.existing.source_metadata ?? {};
  const metadata = sourceMetadataFor({
    source: input.source,
    eventId: input.eventId,
    row: input.row,
    parsed: null,
  });
  const { error: updateError } = await supabaseAdmin
    .from('bank_transactions')
    .update({
      raw_payload: input.row.rawPayload ?? {},
      source_metadata: { ...previousMetadata, [input.source]: metadata },
      match_status: 'review',
      matched_by: 'clobe_memo_change_review',
      account_number: input.row.accountNumber?.replace(/\D/g, '') || null,
      balance_after: input.row.balanceAfter ?? null,
      provider_category: input.row.providerCategory ?? null,
      provider_is_unclassified: input.row.providerIsUnclassified ?? null,
    } as Record<string, unknown>)
    .eq('id', input.existing.id);
  if (updateError) throw new Error(`travel memo removal review failed: ${sanitizeDbError(updateError)}`);

  const { data: existingEvent } = await supabaseAdmin
    .from('ops_events')
    .select('id')
    .eq('bank_transaction_id', input.existing.id)
    .eq('status', 'open')
    .eq('event_type', 'payment_imported')
    .limit(1)
    .maybeSingle();
  if (existingEvent) return;

  await supabaseAdmin.from('ops_events').insert({
    event_type: 'payment_imported',
    severity: 'warning',
    title: 'Clobe travel memo removed or invalid',
    description: `Provider memo no longer contains a valid travel key. The OS did not reclassify or delete the financial row; review the Clobe correction before proceeding.`,
    booking_id: input.existing.booking_id ?? null,
    bank_transaction_id: input.existing.id,
    target_type: 'bank_transactions',
    target_id: input.existing.id,
    status: 'open',
    metadata: {
      source: input.source,
      previous_memo: input.existing.memo ?? null,
      new_memo: input.row.memo,
      external_provider: input.row.externalProvider ?? null,
      external_transaction_id: input.row.externalTransactionId ?? null,
    },
    created_by: 'clobe_sync',
  } as Record<string, unknown>);
}

export async function processBankTransactionImportRows(
  rows: BankTransactionImportRow[],
  options: ProcessOptions,
): Promise<BankTransactionImportResult> {
  const preview = options.preview === true;
  const results: BankTransactionImportPreviewRow[] = [];
  const claimedProbableIds = new Set<string>();

  for (const row of rows) {
    const hasDeposit = row.depositAmount > 0;
    const hasWithdraw = row.withdrawAmount > 0;
    if (hasDeposit === hasWithdraw) {
      const txType: '입금' | '출금' = hasDeposit ? '입금' : '출금';
      const amount = hasDeposit ? row.depositAmount : row.withdrawAmount;
      const fingerprint = buildBankTransactionFingerprint({
        accountNumber: row.accountNumber,
        receivedAt: row.receivedAt,
        txType,
        amount,
        counterpartyName: row.counterpartyName,
        memo: row.memo,
      });
      results.push({
        receivedAt: row.receivedAt,
        type: txType,
        amount,
        counterpartyName: row.counterpartyName,
        memo: row.memo,
        matchStatus: 'review',
        confidence: 0,
        matchReasons: ['deposit_and_withdraw_must_be_exactly_one_positive_value'],
        eventId: stableEventId(options.source, row, fingerprint),
        transactionFingerprint: fingerprint,
        importAction: 'invalid_row_review',
        resolutionSource: null,
        existingTxId: null,
        existingMatchStatus: null,
        duplicateConfidence: 0,
        externalProvider: row.externalProvider ?? null,
        externalTransactionId: row.externalTransactionId ?? null,
        status: 'error',
        error: '입금과 출금 중 정확히 하나만 양수여야 합니다.',
      });
      continue;
    }

    const isDeposit = hasDeposit;
    const amount = isDeposit ? row.depositAmount : row.withdrawAmount;
    const txType: '입금' | '출금' = isDeposit ? '입금' : '출금';
    const parsed = parseTravelSettlementMemo(row.memo);
    const fingerprint = buildBankTransactionFingerprint({
      accountNumber: row.accountNumber,
      receivedAt: row.receivedAt,
      txType,
      amount,
      counterpartyName: row.counterpartyName,
      memo: row.memo,
    });
    const duplicate = await findExistingBankTransaction({
      receivedAt: row.receivedAt,
      txType,
      amount,
      counterpartyName: row.counterpartyName,
      memo: row.memo,
      fingerprint,
      externalProvider: row.externalProvider,
      externalTransactionId: row.externalTransactionId,
      incomingSource: options.source,
      excludedIds: claimedProbableIds,
    });
    const eventId = stableEventId(options.source, row, fingerprint);
    const isClobeSource = options.source === 'clobe_mcp' || options.source === 'clobe_api';

    // The immediate Clobe workflow is travel-memo-only. A new blank or
    // non-travel memo must not create a bank row; adding the travel memo in
    // Clobe later makes the same provider transaction eligible on the next
    // manual sync. Existing rows are still allowed through so memo deletion
    // can be surfaced as a review event instead of silently disappearing.
    if (isClobeSource && !duplicate.row && !row.memo.trim()) {
      results.push({
        receivedAt: row.receivedAt,
        type: txType,
        amount,
        counterpartyName: row.counterpartyName,
        memo: row.memo,
        matchStatus: 'unmatched',
        confidence: 0,
        matchReasons: ['clobe_memo_required_before_import'],
        eventId,
        transactionFingerprint: fingerprint,
        importAction: 'ignored_non_travel',
        resolutionSource: null,
        existingTxId: null,
        existingMatchStatus: null,
        duplicateConfidence: 0,
        externalProvider: row.externalProvider ?? null,
        externalTransactionId: row.externalTransactionId ?? null,
        status: 'skipped_no_memo',
      });
      continue;
    }

    if (isClobeSource && !duplicate.row && row.memo.trim() && !parsed) {
      results.push({
        receivedAt: row.receivedAt,
        type: txType,
        amount,
        counterpartyName: row.counterpartyName,
        memo: row.memo,
        matchStatus: 'unmatched',
        confidence: 0,
        matchReasons: ['clobe_travel_memo_format_required'],
        eventId,
        transactionFingerprint: fingerprint,
        importAction: 'ignored_non_travel',
        resolutionSource: null,
        existingTxId: null,
        existingMatchStatus: null,
        duplicateConfidence: 0,
        externalProvider: row.externalProvider ?? null,
        externalTransactionId: row.externalTransactionId ?? null,
        status: 'skipped_non_travel_memo',
      });
      continue;
    }

    const previousMemo = duplicate.row?.memo ?? null;
    const previousMemoKey = normalizedMemoKeyOf(previousMemo);
    const duplicateAllocationShape = duplicate.row
      ? await getActiveAllocationShape(duplicate.row.id)
      : { hasAllocation: false, memoCorrectionRequiresReview: false };
    const duplicateProcessed = duplicateAllocationShape.hasAllocation;
    const providerMemoDecision = duplicate.row
      ? evaluateProviderMemoChange({
          source: options.source,
          sourceMetadata: duplicate.row.source_metadata,
          storedMemo: previousMemo,
          incomingMemo: row.memo,
          processed: duplicateProcessed
            || Boolean(duplicate.row.booking_id)
            || duplicate.row.match_status === 'manual'
            || duplicate.row.match_status === 'auto',
        })
      : null;
    const memoChanged = providerMemoDecision?.memoChanged
      ?? Boolean(parsed && duplicate.row && previousMemoKey !== parsed.normalizedKey);
    const declassificationNeedsReview = !parsed
      && Boolean(providerMemoDecision?.declassificationNeedsReview);
    const memoBookingId = duplicate.row?.booking_id ?? suggestedBookingIdOf(duplicate.row?.source_metadata, options.source);
    const correctionExisting = duplicate.row;

    // A matched Clobe transaction keeps the same provider row and allocation.
    // Before final settlement, a valid memo correction updates that generated
    // booking in place. After final settlement, the financial snapshot is
    // frozen and only an ops warning is recorded.
    if (isClobeSource && parsed && correctionExisting && memoBookingId && memoChanged && !preview) {
      if (duplicateAllocationShape.memoCorrectionRequiresReview) {
        await flagProcessedMemoChange({
          source: options.source,
          existing: correctionExisting,
          row,
          parsed,
          matchedBooking: null,
          eventId,
          fingerprint,
        });
        results.push({
          receivedAt: row.receivedAt,
          type: txType,
          amount,
          counterpartyName: row.counterpartyName,
          memo: row.memo,
          matchStatus: 'review',
          confidence: 0,
          matchReasons: ['multi_allocation_clobe_memo_change_requires_review'],
          bookingId: memoBookingId,
          eventId,
          transactionFingerprint: fingerprint,
          importAction: 'memo_changed_review',
          resolutionSource: null,
          existingTxId: correctionExisting.id,
          existingMatchStatus: correctionExisting.match_status ?? null,
          duplicateConfidence: 100,
          externalProvider: row.externalProvider ?? null,
          externalTransactionId: row.externalTransactionId ?? null,
          previousMemo,
          memoChanged: true,
          status: 'memo_changed_review',
          txId: correctionExisting.id,
        });
        continue;
      }
      const finalized = await isBookingSettlementFinalized(memoBookingId);
      if (!finalized) {
        const correction = await applyClobeMemoCorrection({
          bookingId: memoBookingId,
          transactionId: correctionExisting.id,
          previousMemo,
          nextMemo: parsed,
        });
        if (correction.status === 'updated') {
          await updateProcessedDuplicateFromMemo({
            existingId: correctionExisting.id,
            source: options.source,
            fingerprint,
            row,
            parsed,
            eventId,
            suggestedBookingId: isDeposit ? null : correction.bookingId,
          });
          results.push({
            receivedAt: row.receivedAt,
            type: txType,
            amount,
            counterpartyName: row.counterpartyName,
            memo: row.memo,
            matchStatus: isDeposit ? 'auto' : 'review',
            confidence: 100,
            matchReasons: [`memo_corrected_in_place:${correction.previousKey}->${correction.nextKey}`],
            bookingId: correction.bookingId,
            eventId,
            transactionFingerprint: fingerprint,
            importAction: 'memo_updated',
            resolutionSource: 'existing_key',
            existingTxId: correctionExisting.id,
            existingMatchStatus: correctionExisting.match_status ?? null,
            duplicateConfidence: 100,
            externalProvider: row.externalProvider ?? null,
            externalTransactionId: row.externalTransactionId ?? null,
            previousMemo,
            memoChanged: true,
            status: 'memo_updated',
            txId: correctionExisting.id,
          });
          continue;
        }
        await flagProcessedMemoChange({
          source: options.source,
          existing: correctionExisting,
          row,
          parsed,
          matchedBooking: null,
          eventId,
          fingerprint,
        });
        results.push({
          receivedAt: row.receivedAt,
          type: txType,
          amount,
          counterpartyName: row.counterpartyName,
          memo: row.memo,
          matchStatus: 'review',
          confidence: 0,
          matchReasons: [correction.reason],
          bookingId: memoBookingId,
          eventId,
          transactionFingerprint: fingerprint,
          importAction: 'memo_changed_review',
          resolutionSource: null,
          existingTxId: correctionExisting.id,
          existingMatchStatus: correctionExisting.match_status ?? null,
          duplicateConfidence: 100,
          externalProvider: row.externalProvider ?? null,
          externalTransactionId: row.externalTransactionId ?? null,
          previousMemo,
          memoChanged: true,
          status: 'memo_changed_review',
          txId: correctionExisting.id,
        });
        continue;
      }

      await flagProcessedMemoChange({
        source: options.source,
        existing: correctionExisting,
        row,
        parsed,
        matchedBooking: null,
        eventId,
        fingerprint,
      });
      results.push({
        receivedAt: row.receivedAt,
        type: txType,
        amount,
        counterpartyName: row.counterpartyName,
        memo: row.memo,
        matchStatus: 'review',
        confidence: 0,
        matchReasons: ['settlement_finalized_clobe_memo_change_requires_review'],
          bookingId: memoBookingId,
        eventId,
        transactionFingerprint: fingerprint,
        importAction: 'memo_changed_review',
        resolutionSource: null,
        existingTxId: correctionExisting.id,
        existingMatchStatus: correctionExisting.match_status ?? null,
        duplicateConfidence: 100,
        externalProvider: row.externalProvider ?? null,
        externalTransactionId: row.externalTransactionId ?? null,
        previousMemo,
        memoChanged: true,
        status: 'memo_changed_review',
        txId: correctionExisting.id,
      });
      continue;
    }

    let matchedBooking: {
      id: string;
      booking_no?: string | null;
      customer_name?: string | null;
    } | null = null;
    let confidence = 0;
    const matchReasons: string[] = [];
    let resolutionSource: SettlementMemoResolutionSource = null;
    let suggestedBookingId: string | null = null;

    if (parsed) {
      const resolution = await resolveSettlementMemoBooking(parsed, {
        createIfMissing: options.createMissingBookings === true
          && parsed.memoFormat === 'canonical'
          && !preview,
      });
      resolutionSource = resolution.source;
      confidence = resolution.confidence;
      suggestedBookingId = resolution.suggestedBookingId ?? null;
      if (resolution.bookingId) {
        matchedBooking = {
          id: resolution.bookingId,
          booking_no: resolution.bookingNo,
          customer_name: resolution.customerName,
        };
        matchReasons.push(`memo_key:${parsed.normalizedKey}`, `source:${resolution.source}`);
      } else if (resolution.reason) {
        matchReasons.push(resolution.reason);
      }
    }

    const memoAutoMatch = isDeposit && canAutoMatchSettlementMemo({
      bookingId: matchedBooking?.id,
      source: resolutionSource,
      confidence,
      allowCreatedBooking: isClobeSource,
    });
    const bookingCandidateReview = Boolean(parsed && !matchedBooking);
    const matchStatus: 'auto' | 'review' | 'unmatched' =
      !parsed ? 'unmatched' :
      bookingCandidateReview ? 'review' :
      memoAutoMatch ? 'auto' :
      !isDeposit ? 'review' :
      confidence >= 0.85 ? 'auto' : confidence >= 0.5 ? 'review' : 'unmatched';

    const duplicateIsLegacyMatched = Boolean(duplicate.row && !duplicateAllocationShape.hasAllocation && (
      duplicate.row.booking_id
      || duplicate.row.match_status === 'manual'
      || duplicate.row.match_status === 'auto'
    ));
    const recordsCompleteClobeLedger = !isClobeSource;
    const importAction: BankTransactionImportAction =
      declassificationNeedsReview ? 'memo_changed_review' :
      !parsed && recordsCompleteClobeLedger ? 'non_travel_recorded' :
      !parsed ? 'ignored_non_travel' :
      bookingCandidateReview ? 'booking_candidate_review' :
      memoChanged && duplicateProcessed ? 'memo_changed_review' :
      memoChanged ? 'memo_updated' :
      duplicateIsLegacyMatched ? 'legacy_repaired' :
      duplicate.kind === 'exact' ? 'already_processed' :
      duplicate.kind === 'reconciled' ? 'merge_candidate' :
      duplicate.kind === 'probable' ? 'merge_candidate' :
      duplicate.row && duplicate.confidence >= 0.65 ? 'duplicate_review' :
      'insert';

    const previewRow: BankTransactionImportPreviewRow = {
      receivedAt: row.receivedAt,
      type: txType,
      amount,
      counterpartyName: row.counterpartyName,
      memo: row.memo,
      matchStatus,
      confidence: Math.round(confidence * 100),
      matchReasons,
      bookingNo: matchedBooking?.booking_no,
      bookingId: matchedBooking?.id,
      customerName: matchedBooking?.customer_name,
      eventId,
      transactionFingerprint: fingerprint,
      importAction,
      resolutionSource,
      existingTxId: duplicate.row?.id ?? null,
      existingMatchStatus: duplicate.row?.match_status ?? null,
      duplicateConfidence: Math.round(duplicate.confidence * 100),
      externalProvider: row.externalProvider ?? null,
      externalTransactionId: row.externalTransactionId ?? null,
      previousMemo,
      memoChanged,
    };

    if (preview) {
      results.push(previewRow);
      continue;
    }

    if (bookingCandidateReview && duplicate.row) {
      await enqueueBookingCandidateReview({
        transactionId: duplicate.row.id,
        source: options.source,
        row,
        parsed: parsed!,
        eventId,
        suggestedBookingId,
      });
    }

    if (!parsed && isClobeSource && duplicate.row) {
      if (declassificationNeedsReview) {
        await flagTravelTransactionDeclassification({
          source: options.source,
          existing: duplicate.row,
          row,
          eventId,
          fingerprint,
        });
        results.push({ ...previewRow, status: 'memo_changed_review', txId: duplicate.row.id });
      } else {
        await attachImportEvidence(duplicate.row.id, {
          source: options.source,
          fingerprint,
          row,
          eventId,
          parsed: null,
        });
        results.push({ ...previewRow, status: 'merged', txId: duplicate.row.id });
      }
      continue;
    }

    if (!parsed && !recordsCompleteClobeLedger) {
      results.push({ ...previewRow, status: 'skipped' });
      continue;
    }

    if (!parsed) {
      if (duplicate.row && (duplicateAllocationShape.hasAllocation || duplicateIsLegacyMatched)) {
        if (declassificationNeedsReview) {
          await flagTravelTransactionDeclassification({
            source: options.source,
            existing: duplicate.row,
            row,
            eventId,
            fingerprint,
          });
          results.push({ ...previewRow, status: 'memo_changed_review', txId: duplicate.row.id });
        } else {
          await attachImportEvidence(duplicate.row.id, {
            source: options.source,
            fingerprint,
            row,
            eventId,
            parsed: null,
          });
          results.push({ ...previewRow, status: 'merged', txId: duplicate.row.id });
        }
        continue;
      }

      if (duplicate.row && duplicate.kind === 'probable') {
        results.push({ ...previewRow, status: 'duplicate' });
        claimedProbableIds.add(duplicate.row.id);
        continue;
      }

      const stored = await persistNonTravelClobeTransaction({
        source: options.source,
        row,
        eventId,
        fingerprint,
        txType,
        amount,
        existing: duplicate.row,
      });
      results.push({
        ...previewRow,
        status: stored.inserted ? 'non_travel_inserted' : 'non_travel_merged',
        txId: stored.id ?? undefined,
      });
      continue;
    }

    if ((duplicate.kind === 'exact' || duplicate.kind === 'reconciled') && duplicate.row) {
      if (duplicate.kind === 'reconciled') claimedProbableIds.add(duplicate.row.id);
      if (memoChanged && duplicateProcessed) {
        await flagProcessedMemoChange({
          source: options.source,
          existing: duplicate.row,
          row,
          parsed,
          matchedBooking,
          eventId,
          fingerprint,
        });
        results.push({ ...previewRow, status: 'memo_changed_review', txId: duplicate.row.id });
        continue;
      }

      if (memoChanged) {
        await updateUnprocessedDuplicateFromMemo({
          existingId: duplicate.row.id,
          source: options.source,
          fingerprint,
          row,
          parsed,
          eventId,
          matchStatus,
          confidence,
          suggestedBookingId: matchedBooking?.id ?? suggestedBookingId,
        });
        if (matchStatus === 'auto' && matchedBooking) {
          await allocateExistingTransaction({
            existing: duplicate.row,
            hasAllocation: duplicateAllocationShape.hasAllocation,
            bookingId: matchedBooking.id,
            amount,
            confidence,
            actor: options.actor,
            notes: `${options.source} auto-match after provider memo update`,
          });
        }
        results.push({ ...previewRow, status: 'memo_updated', txId: duplicate.row.id });
        continue;
      }

      await attachImportEvidence(duplicate.row.id, {
        source: options.source,
        fingerprint,
        row,
        eventId,
        parsed,
        suggestedBookingId: matchedBooking?.id
          ?? suggestedBookingId
          ?? suggestedBookingIdOf(duplicate.row.source_metadata, options.source),
      });
      if (matchStatus === 'auto' && matchedBooking && !duplicateProcessed) {
        const allocationResult = await allocateExistingTransaction({
          existing: duplicate.row,
          hasAllocation: duplicateAllocationShape.hasAllocation,
          bookingId: matchedBooking.id,
          amount,
          confidence,
          actor: options.actor,
          notes: `${options.source} auto-match existing memo ${txType}`,
        });
        results.push({
          ...previewRow,
          status: allocationResult === 'legacy_repaired' ? 'legacy_repaired' : 'matched',
          txId: duplicate.row.id,
        });
      } else {
        results.push({ ...previewRow, status: 'merged', txId: duplicate.row.id });
      }
      continue;
    }

    if (duplicate.row) {
      if (memoChanged && !duplicateProcessed) {
        await updateUnprocessedDuplicateFromMemo({
          existingId: duplicate.row.id,
          source: options.source,
          fingerprint,
          row,
          parsed,
          eventId,
          matchStatus,
          confidence,
          suggestedBookingId: matchedBooking?.id ?? suggestedBookingId,
        });
        if (matchStatus === 'auto' && matchedBooking) {
          await allocateExistingTransaction({
            existing: duplicate.row,
            hasAllocation: duplicateAllocationShape.hasAllocation,
            bookingId: matchedBooking.id,
            amount,
            confidence,
            actor: options.actor,
            notes: `${options.source} auto-match probable memo duplicate ${txType}`,
          });
        }
        results.push({ ...previewRow, status: 'memo_updated', txId: duplicate.row.id });
        claimedProbableIds.add(duplicate.row.id);
        continue;
      }
      results.push({ ...previewRow, status: 'duplicate' });
      if (duplicate.kind === 'probable') claimedProbableIds.add(duplicate.row.id);
      continue;
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('bank_transactions')
      .insert([{
        slack_event_id: eventId,
        raw_message: `[${options.source}] ${row.memo}`,
        transaction_fingerprint: fingerprint,
        source: options.source,
        source_metadata: {
          [options.source]: {
            event_id: eventId,
            received_at: row.receivedAt,
            account_number: row.accountNumber ?? null,
            counterparty_name: row.counterpartyName,
            memo: row.memo,
            original_line: row.originalLine ?? null,
            row_index: row.rowIndex ?? null,
            settlement_key: parsed.normalizedKey,
            purpose_tags: parsed.purposeTags,
            external_provider: row.externalProvider ?? null,
            external_transaction_id: row.externalTransactionId ?? null,
            suggested_booking_id: matchedBooking?.id ?? suggestedBookingId,
            imported_at: new Date().toISOString(),
          },
        },
        external_provider: row.externalProvider ?? null,
        external_transaction_id: row.externalTransactionId ?? null,
        raw_payload: row.rawPayload ?? {},
        transaction_type: txType,
        amount,
        counterparty_name: row.counterpartyName,
        memo: row.memo,
        received_at: row.receivedAt,
        booking_id: null,
        is_refund: false,
        is_fee: false,
        fee_amount: 0,
        match_status: matchStatus === 'auto' ? 'unmatched' : matchStatus,
        match_confidence: matchStatus === 'auto' ? 0 : confidence,
        matched_by: null,
        matched_at: null,
        ...accountFieldsFor(row, 'travel'),
      } as Record<string, unknown>])
      .select('id')
      .single();

    if (insertError?.code === '23505' && options.source === 'clobe_mcp') {
      const excluded = await findExcludedTransactionByFingerprint(fingerprint);
      if (excluded) {
        try {
          const restored = await restoreExcludedTransactionAsClobe({
            existing: excluded,
            source: options.source,
            fingerprint,
            row,
            parsed,
            eventId,
            txType,
            amount,
            suggestedBookingId: matchedBooking?.id ?? suggestedBookingId,
          });
          const allocationResult = matchStatus === 'auto' && matchedBooking
            ? await allocateExistingTransaction({
              existing: restored,
              hasAllocation: false,
              bookingId: matchedBooking.id,
              amount,
              confidence,
              actor: options.actor,
              notes: `${options.source} restored excluded transaction ${txType}`,
            })
            : 'already_processed';
          results.push({
            ...previewRow,
            status: allocationResult === 'legacy_repaired' ? 'legacy_repaired' : 'matched',
            txId: restored.id,
          });
          continue;
        } catch (restoreError) {
          results.push({
            ...previewRow,
            status: 'error',
            error: restoreError instanceof Error ? restoreError.message : 'excluded transaction restore failed',
          });
          continue;
        }
      }
    }
    if (insertError?.code === '23505') {
      results.push({ ...previewRow, status: 'duplicate' });
      continue;
    }
    if (insertError) {
      results.push({ ...previewRow, status: 'error', error: insertError.message });
      continue;
    }

    if (bookingCandidateReview && (inserted as { id?: string } | null)?.id) {
      await enqueueBookingCandidateReview({
        transactionId: (inserted as { id: string }).id,
        source: options.source,
        row,
        parsed: parsed!,
        eventId,
        suggestedBookingId,
      });
    }

    if (matchStatus === 'auto' && matchedBooking) {
      const insertedId = (inserted as { id?: string })?.id;
      if (insertedId) {
        await matchTransactionAllocations({
          transactionId: insertedId,
          allocations: [{ bookingId: matchedBooking.id, amount }],
          confidence,
          actor: options.actor,
          notes: `${options.source} auto-match ${txType}`,
        });
      }
    }

    results.push({ ...previewRow, status: 'inserted', txId: (inserted as { id?: string })?.id });
  }

  const response: BankTransactionImportResult = {
    inserted: results.filter(r => r.status === 'inserted').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    duplicates: results.filter(r => r.status === 'duplicate').length,
    merged: results.filter(r => r.status === 'merged').length,
    errors: results.filter(r => r.status === 'error').length,
    matched: results.filter(r => (r.status === 'inserted' || r.status === 'memo_updated' || r.status === 'matched' || r.status === 'legacy_repaired') && r.matchStatus === 'auto').length,
    repaired: results.filter(r => r.status === 'legacy_repaired' || r.importAction === 'legacy_repaired').length,
    memoUpdated: results.filter(r => r.status === 'memo_updated').length,
    memoChangedReview: results.filter(r => r.status === 'memo_changed_review').length,
    bookingCandidateReview: results.filter(r => r.importAction === 'booking_candidate_review').length,
    nonTravelStored: results.filter(r => r.status === 'non_travel_inserted' || r.status === 'non_travel_merged').length,
    skippedNoMemo: results.filter(r => r.status === 'skipped_no_memo' || r.status === 'skipped_non_travel_memo').length,
    firstError: (results.find(r => r.status === 'error') as { error?: string } | undefined)?.error || null,
    results,
  };

  if (preview) {
    response.preview = true;
    response.rows = results;
  }

  return response;
}
