import { createHash } from 'crypto';
import {
  buildBankTransactionFingerprint,
  scoreBankTransactionSimilarity,
} from '@/lib/bank-transaction-fingerprint';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';
import {
  parseTravelSettlementMemo,
  type ParsedTravelSettlementMemo,
} from './bank-statement-parser';
import { resolveSettlementMemoBooking } from './booking-settlement-keys';

export type BankTransactionImportSource = 'bulk_import' | 'clobe_mcp' | 'clobe_api';
export type BankTransactionImportAction =
  | 'insert'
  | 'already_processed'
  | 'merge_candidate'
  | 'duplicate_review'
  | 'ignored_non_travel'
  | 'memo_changed_review'
  | 'memo_updated';

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
  memoUpdated: number;
  memoChangedReview: number;
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

function isFinanciallyProcessed(row: ExistingBankTxCandidate): boolean {
  return Boolean(row.booking_id) || row.match_status === 'manual' || row.match_status === 'auto';
}

function normalizedMemoKeyOf(value: string | null | undefined): string | null {
  return parseTravelSettlementMemo(value)?.normalizedKey ?? null;
}

function sourceMetadataFor(input: {
  source: BankTransactionImportSource;
  eventId: string;
  row: BankTransactionImportRow;
  parsed: ParsedTravelSettlementMemo;
}) {
  return {
    event_id: input.eventId,
    received_at: input.row.receivedAt,
    account_number: input.row.accountNumber ?? null,
    counterparty_name: input.row.counterpartyName,
    memo: input.row.memo,
    original_line: input.row.originalLine ?? null,
    row_index: input.row.rowIndex ?? null,
    settlement_key: input.parsed.normalizedKey,
    external_provider: input.row.externalProvider ?? null,
    external_transaction_id: input.row.externalTransactionId ?? null,
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
}): Promise<{ kind: 'exact' | 'probable' | null; row: ExistingBankTxCandidate | null; confidence: number }> {
  if (input.externalProvider && input.externalTransactionId) {
    const external = await supabaseAdmin
      .from('bank_transactions')
      .select('id, amount, transaction_type, counterparty_name, received_at, booking_id, match_status, source, memo, source_metadata, external_provider, external_transaction_id')
      .eq('external_provider', input.externalProvider)
      .eq('external_transaction_id', input.externalTransactionId)
      .maybeSingle();

    if (external.data) {
      return { kind: 'exact', row: external.data as ExistingBankTxCandidate, confidence: 1 };
    }
  }

  const exact = await supabaseAdmin
    .from('bank_transactions')
    .select('id, amount, transaction_type, counterparty_name, received_at, booking_id, match_status, source, memo, source_metadata, external_provider, external_transaction_id')
    .eq('transaction_fingerprint', input.fingerprint)
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
  for (const row of (data ?? []) as ExistingBankTxCandidate[]) {
    const score = scoreBankTransactionSimilarity(row, input);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }

  return { kind: bestScore >= 0.75 ? 'probable' : null, row: bestScore >= 0.65 ? best : null, confidence: bestScore };
}

async function attachImportEvidence(existingId: string, input: {
  source: BankTransactionImportSource;
  fingerprint: string;
  row: BankTransactionImportRow;
  eventId: string;
  parsed: ParsedTravelSettlementMemo;
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
    source_metadata: {
      ...previousMetadata,
      [input.source]: {
        event_id: input.eventId,
        received_at: input.row.receivedAt,
        account_number: input.row.accountNumber ?? null,
        counterparty_name: input.row.counterpartyName,
        memo: input.row.memo,
        original_line: input.row.originalLine ?? null,
        row_index: input.row.rowIndex ?? null,
        settlement_key: input.parsed.normalizedKey,
        external_provider: input.row.externalProvider ?? null,
        external_transaction_id: input.row.externalTransactionId ?? null,
        imported_at: new Date().toISOString(),
      },
    },
  };
  if (input.row.externalProvider && input.row.externalTransactionId) {
    patch.external_provider = input.row.externalProvider;
    patch.external_transaction_id = input.row.externalTransactionId;
  }

  await supabaseAdmin
    .from('bank_transactions')
    .update(patch)
    .eq('id', existingId);
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
    .eq('id', input.existingId);
  if (error) throw new Error(`bank transaction memo update failed: ${sanitizeDbError(error)}`);
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
  });

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

export async function processBankTransactionImportRows(
  rows: BankTransactionImportRow[],
  options: ProcessOptions,
): Promise<BankTransactionImportResult> {
  const preview = options.preview === true;
  const results: BankTransactionImportPreviewRow[] = [];

  for (const row of rows) {
    const isDeposit = row.depositAmount > 0;
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
    });

    let matchedBooking: {
      id: string;
      booking_no?: string | null;
      customer_name?: string | null;
    } | null = null;
    let confidence = 0;
    const matchReasons: string[] = [];
    let resolutionSource: string | null = null;

    if (parsed) {
      const resolution = await resolveSettlementMemoBooking(parsed, {
        createIfMissing: options.createMissingBookings !== false && !preview,
      });
      resolutionSource = resolution.source;
      confidence = resolution.confidence;
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

    const matchStatus: 'auto' | 'review' | 'unmatched' =
      !parsed ? 'unmatched' :
      !isDeposit ? 'review' :
      confidence >= 0.85 ? 'auto' : confidence >= 0.5 ? 'review' : 'unmatched';

    const eventId = stableEventId(options.source, row, fingerprint);
    const previousMemo = duplicate.row?.memo ?? null;
    const previousMemoKey = normalizedMemoKeyOf(previousMemo);
    const memoChanged = Boolean(parsed && duplicate.kind === 'exact' && duplicate.row && previousMemoKey !== parsed.normalizedKey);
    const duplicateProcessed = duplicate.row ? isFinanciallyProcessed(duplicate.row) : false;
    const importAction: BankTransactionImportAction =
      !parsed ? 'ignored_non_travel' :
      memoChanged && duplicateProcessed ? 'memo_changed_review' :
      memoChanged ? 'memo_updated' :
      duplicate.kind === 'exact' ? 'already_processed' :
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

    if (!parsed) {
      results.push({ ...previewRow, status: 'skipped' });
      continue;
    }

    if (duplicate.kind === 'exact' && duplicate.row) {
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
        });
        if (matchStatus === 'auto' && matchedBooking && isDeposit) {
          await matchTransactionAllocations({
            transactionId: duplicate.row.id,
            allocations: [{ bookingId: matchedBooking.id, amount }],
            confidence,
            actor: options.actor,
            notes: `${options.source} auto-match after provider memo update`,
          });
        }
        results.push({ ...previewRow, status: 'memo_updated', txId: duplicate.row.id });
        continue;
      }

      await attachImportEvidence(duplicate.row.id, { source: options.source, fingerprint, row, eventId, parsed });
      results.push({ ...previewRow, status: 'merged', txId: duplicate.row.id });
      continue;
    }

    if (duplicate.row) {
      results.push({ ...previewRow, status: 'duplicate' });
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
            external_provider: row.externalProvider ?? null,
            external_transaction_id: row.externalTransactionId ?? null,
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
      } as Record<string, unknown>])
      .select('id')
      .single();

    if (insertError?.code === '23505') {
      results.push({ ...previewRow, status: 'duplicate' });
      continue;
    }
    if (insertError) {
      results.push({ ...previewRow, status: 'error', error: insertError.message });
      continue;
    }

    if (matchStatus === 'auto' && matchedBooking && isDeposit) {
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
    matched: results.filter(r => (r.status === 'inserted' || r.status === 'memo_updated') && r.matchStatus === 'auto').length,
    memoUpdated: results.filter(r => r.status === 'memo_updated').length,
    memoChangedReview: results.filter(r => r.status === 'memo_changed_review').length,
    firstError: (results.find(r => r.status === 'error') as { error?: string } | undefined)?.error || null,
    results,
  };

  if (preview) {
    response.preview = true;
    response.rows = results;
  }

  return response;
}
