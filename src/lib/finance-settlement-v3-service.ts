import { createHash } from 'node:crypto';

import { YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER } from '@/lib/bank-account-reality';
import {
  clobeSettlementKeyFromSourceMetadata,
  summarizeBookingCashBreakdown,
  type BookingSettlementReviewStatus,
  type FinanceAllocationTarget,
  type FinanceV3Allocation,
  type FinanceV3Transaction,
} from '@/lib/finance-settlement-v3';
import { supabaseAdmin } from '@/lib/supabase';

const MAX_ROWS = 5000;

function chunks<T>(values: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function customerName(value: unknown): string | null {
  if (Array.isArray(value)) return customerName(value[0]);
  if (!value || typeof value !== 'object') return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

interface BookingRecord {
  id: string;
  booking_no: string | null;
  package_title: string | null;
  departure_date: string | null;
  status: string | null;
  is_deleted: boolean | null;
  finance_excluded: boolean | null;
  finance_exclusion_reason: string | null;
  total_price: number | null;
  total_cost: number | null;
  customers: unknown;
}

interface ReviewRecord {
  id: string;
  booking_id: string;
  status: BookingSettlementReviewStatus;
  is_current: boolean;
  review_fingerprint: string;
  assigned_to: string | null;
  decision_reason: string | null;
  due_date: string | null;
  reviewed_by_label: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

interface AllocationRecord extends FinanceV3Allocation {
  id: string;
  target_type: FinanceAllocationTarget;
  reconciliation_key: string | null;
  target_label: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

interface TransactionRecord extends FinanceV3Transaction {
  received_at: string;
  updated_at: string | null;
  counterparty_name: string | null;
  memo: string | null;
  source_metadata: unknown;
  raw_message: string | null;
  match_status: string | null;
}

export interface FinanceBookingReviewRow {
  id: string;
  bookingNo: string;
  customerName: string | null;
  packageTitle: string | null;
  departureDate: string | null;
  bookingStatus: string | null;
  financeExcluded: boolean;
  financeExclusionReason: string | null;
  travelKey: string | null;
  totalPrice: number;
  totalCost: number;
  deposits: number;
  travelWithdrawals: number;
  customerRefunds: number;
  bankFees: number;
  cashMargin: number;
  transactionCount: number;
  reviewStatus: BookingSettlementReviewStatus;
  reviewFingerprint: string | null;
  decisionReason: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface FinanceBookingReviewDetail extends FinanceBookingReviewRow {
  transactions: Array<{
    id: string;
    receivedAt: string;
    counterparty: string | null;
    direction: string;
    sourceAmount: number;
    memo: string | null;
    previousMemo: string | null;
    settlementKey: string | null;
    allocationId: string;
    targetType: FinanceAllocationTarget;
    allocatedAmount: number;
    targetLabel: string | null;
    reason: string | null;
    reconciliationKey: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
  }>;
  reviewHistory: ReviewRecord[];
}

async function loadTransactions(ids: string[]): Promise<TransactionRecord[]> {
  const rows: TransactionRecord[] = [];
  for (const batch of chunks([...new Set(ids)])) {
    if (batch.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, received_at, updated_at, counterparty_name, memo, source_metadata, raw_message, match_status')
      .in('id', batch)
      .eq('external_provider', 'clobe')
      .eq('source', 'clobe_mcp')
      .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
      .eq('status', 'active');
    if (error) throw error;
    rows.push(...((data ?? []) as TransactionRecord[]));
  }
  return rows;
}

function buildRow(params: {
  booking: BookingRecord;
  review?: ReviewRecord;
  allocations: AllocationRecord[];
  transactions: TransactionRecord[];
  settlementKey?: string | null;
}): FinanceBookingReviewRow {
  const breakdown = summarizeBookingCashBreakdown({
    bookingId: params.booking.id,
    transactions: params.transactions,
    allocations: params.allocations,
  });
  const transactionById = new Map(params.transactions.map(row => [row.id, row]));
  const travelKey = params.settlementKey
    ?? params.allocations
      .map(row => clobeSettlementKeyFromSourceMetadata(transactionById.get(row.bank_transaction_id)?.source_metadata))
      .find(Boolean)
    ?? null;

  return {
    id: params.booking.id,
    bookingNo: params.booking.booking_no ?? params.booking.id,
    customerName: customerName(params.booking.customers),
    packageTitle: params.booking.package_title,
    departureDate: params.booking.departure_date?.slice(0, 10) ?? null,
    bookingStatus: params.booking.status,
    financeExcluded: Boolean(params.booking.finance_excluded),
    financeExclusionReason: params.booking.finance_exclusion_reason,
    travelKey,
    totalPrice: Math.round(Number(params.booking.total_price) || 0),
    totalCost: Math.round(Number(params.booking.total_cost) || 0),
    ...breakdown,
    reviewStatus: params.review?.status ?? 'pending',
    reviewFingerprint: params.review?.review_fingerprint ?? null,
    decisionReason: params.review?.decision_reason ?? null,
    assignedTo: params.review?.assigned_to ?? null,
    dueDate: params.review?.due_date ?? null,
    reviewedBy: params.review?.reviewed_by_label ?? null,
    reviewedAt: params.review?.reviewed_at ?? null,
  };
}

export async function loadFinanceBookingReviews(filters: {
  month?: string | null;
  status?: BookingSettlementReviewStatus | 'all' | null;
  query?: string | null;
  includeExcluded?: boolean;
} = {}): Promise<{ rows: FinanceBookingReviewRow[]; summary: Record<string, number> }> {
  const [bookingResult, allocationResult, reviewResult, keyResult] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('id, booking_no, package_title, departure_date, status, is_deleted, finance_excluded, finance_exclusion_reason, total_price, total_cost, customers!lead_customer_id(name)')
      .order('departure_date', { ascending: false, nullsFirst: false })
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('bank_transaction_allocations')
      .select('id, bank_transaction_id, booking_id, allocated_amount, target_type, reconciliation_key, target_label, reason, metadata, confirmed_by, confirmed_at')
      .eq('status', 'active')
      .is('reversed_at', null)
      .not('booking_id', 'is', null)
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('booking_settlement_reviews')
      .select('id, booking_id, status, is_current, review_fingerprint, assigned_to, decision_reason, due_date, reviewed_by_label, reviewed_at, updated_at')
      .eq('is_current', true)
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('booking_settlement_keys')
      .select('booking_id, normalized_key')
      .eq('status', 'active')
      .limit(MAX_ROWS),
  ]);
  if (bookingResult.error) throw bookingResult.error;
  if (allocationResult.error) throw allocationResult.error;
  if (reviewResult.error) throw reviewResult.error;
  if (keyResult.error) throw keyResult.error;

  const bookings = (bookingResult.data ?? []) as BookingRecord[];
  const allocations = (allocationResult.data ?? []) as AllocationRecord[];
  const reviews = (reviewResult.data ?? []) as ReviewRecord[];
  const transactions = await loadTransactions(allocations.map(row => row.bank_transaction_id));
  const reviewByBooking = new Map(reviews.map(row => [row.booking_id, row]));
  const keyByBooking = new Map((keyResult.data ?? []).map(row => [row.booking_id as string, row.normalized_key as string]));
  const allocationsByBooking = new Map<string, AllocationRecord[]>();
  for (const allocation of allocations) {
    if (!allocation.booking_id) continue;
    const rows = allocationsByBooking.get(allocation.booking_id) ?? [];
    rows.push(allocation);
    allocationsByBooking.set(allocation.booking_id, rows);
  }

  const normalizedQuery = filters.query?.normalize('NFKC').trim().toLowerCase() ?? '';
  const rows = bookings
    .map(booking => buildRow({
      booking,
      review: reviewByBooking.get(booking.id),
      allocations: allocationsByBooking.get(booking.id) ?? [],
      transactions,
      settlementKey: keyByBooking.get(booking.id),
    }))
    .filter(row => {
      if (!filters.includeExcluded && row.financeExcluded) return false;
      if (filters.month && row.departureDate?.slice(0, 7) !== filters.month) return false;
      if (filters.status && filters.status !== 'all' && row.reviewStatus !== filters.status) return false;
      if (!normalizedQuery) return true;
      return [row.bookingNo, row.customerName, row.packageTitle, row.travelKey, row.departureDate]
        .filter(Boolean)
        .some(value => String(value).normalize('NFKC').toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => String(b.departureDate).localeCompare(String(a.departureDate)) || a.bookingNo.localeCompare(b.bookingNo));

  return {
    rows,
    summary: {
      total: rows.length,
      pending: rows.filter(row => row.reviewStatus === 'pending').length,
      confirmed: rows.filter(row => row.reviewStatus === 'confirmed').length,
      deferred: rows.filter(row => row.reviewStatus === 'deferred').length,
      cancelled: rows.filter(row => row.reviewStatus === 'customer_cancelled').length,
      excluded: rows.filter(row => ['invalid_booking', 'reclassified'].includes(row.reviewStatus)).length,
      deposits: rows.reduce((sum, row) => sum + row.deposits, 0),
      withdrawals: rows.reduce((sum, row) => sum + row.travelWithdrawals, 0),
      refunds: rows.reduce((sum, row) => sum + row.customerRefunds, 0),
      cashMargin: rows.filter(row => row.reviewStatus === 'confirmed').reduce((sum, row) => sum + row.cashMargin, 0),
    },
  };
}

export async function loadFinanceBookingReviewDetail(bookingId: string): Promise<FinanceBookingReviewDetail | null> {
  const [bookingResult, allocationResult, reviewResult, keyResult] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('id, booking_no, package_title, departure_date, status, is_deleted, finance_excluded, finance_exclusion_reason, total_price, total_cost, customers!lead_customer_id(name)')
      .eq('id', bookingId)
      .limit(1),
    supabaseAdmin
      .from('bank_transaction_allocations')
      .select('id, bank_transaction_id, booking_id, allocated_amount, target_type, reconciliation_key, target_label, reason, metadata, confirmed_by, confirmed_at')
      .eq('booking_id', bookingId)
      .eq('status', 'active')
      .is('reversed_at', null)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('booking_settlement_reviews')
      .select('id, booking_id, status, is_current, review_fingerprint, assigned_to, decision_reason, due_date, reviewed_by_label, reviewed_at, updated_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('booking_settlement_keys')
      .select('normalized_key')
      .eq('booking_id', bookingId)
      .eq('status', 'active')
      .limit(1),
  ]);
  if (bookingResult.error) throw bookingResult.error;
  if (allocationResult.error) throw allocationResult.error;
  if (reviewResult.error) throw reviewResult.error;
  if (keyResult.error) throw keyResult.error;
  const booking = (bookingResult.data?.[0] ?? null) as BookingRecord | null;
  if (!booking) return null;

  const allocations = (allocationResult.data ?? []) as AllocationRecord[];
  const transactions = await loadTransactions(allocations.map(row => row.bank_transaction_id));
  const transactionById = new Map(transactions.map(row => [row.id, row]));
  const reviews = (reviewResult.data ?? []) as ReviewRecord[];
  const currentReview = reviews.find(row => row.is_current) ?? reviews[0];
  const transactionIds = [...new Set(transactions.map(row => row.id))];
  const previousMemoByTransaction = new Map<string, string | null>();
  for (const batch of chunks(transactionIds)) {
    if (batch.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from('ops_events')
      .select('bank_transaction_id, metadata, created_at')
      .in('bank_transaction_id', batch)
      .order('created_at', { ascending: false });
    if (error) throw error;
    for (const event of data ?? []) {
      const transactionId = event.bank_transaction_id as string | null;
      const metadata = event.metadata as { previous_memo?: unknown } | null;
      if (!transactionId || previousMemoByTransaction.has(transactionId)) continue;
      previousMemoByTransaction.set(transactionId, typeof metadata?.previous_memo === 'string' ? metadata.previous_memo : null);
    }
  }

  const row = buildRow({
    booking,
    review: currentReview,
    allocations,
    transactions,
    settlementKey: keyResult.data?.[0]?.normalized_key as string | undefined,
  });
  return {
    ...row,
    transactions: allocations.flatMap(allocation => {
      const transaction = transactionById.get(allocation.bank_transaction_id);
      if (!transaction) return [];
      return [{
        id: transaction.id,
        receivedAt: transaction.received_at,
        counterparty: transaction.counterparty_name,
        direction: transaction.transaction_type,
        sourceAmount: Math.round(Number(transaction.amount) || 0),
        memo: transaction.memo,
        previousMemo: previousMemoByTransaction.get(transaction.id) ?? null,
        settlementKey: clobeSettlementKeyFromSourceMetadata(transaction.source_metadata),
        allocationId: allocation.id,
        targetType: allocation.target_type,
        allocatedAmount: Math.round(Number(allocation.allocated_amount) || 0),
        targetLabel: allocation.target_label,
        reason: allocation.reason,
        reconciliationKey: allocation.reconciliation_key,
        confirmedBy: allocation.confirmed_by,
        confirmedAt: allocation.confirmed_at,
      }];
    }).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id)),
    reviewHistory: reviews,
  };
}

export async function loadFinanceTransactionBreakdown(transactionId: string) {
  const [transactionResult, allocationResult, fingerprintResult] = await Promise.all([
    supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, received_at, counterparty_name, memo, source_metadata, match_status')
      .eq('id', transactionId)
      .eq('external_provider', 'clobe')
      .eq('source', 'clobe_mcp')
      .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
      .eq('status', 'active')
      .limit(1),
    supabaseAdmin
      .from('bank_transaction_allocations')
      .select('id, booking_id, allocated_amount, target_type, reconciliation_key, target_label, reason, metadata, confirmed_by, confirmed_at, bookings(booking_no, package_title)')
      .eq('bank_transaction_id', transactionId)
      .eq('status', 'active')
      .is('reversed_at', null)
      .order('created_at', { ascending: true }),
    supabaseAdmin.rpc('finance_bank_breakdown_fingerprint', { p_bank_transaction_id: transactionId }),
  ]);
  if (transactionResult.error) throw transactionResult.error;
  if (allocationResult.error) throw allocationResult.error;
  if (fingerprintResult.error) throw fingerprintResult.error;
  const transaction = transactionResult.data?.[0];
  if (!transaction) return null;
  const allocations = allocationResult.data ?? [];
  const allocated = allocations.reduce((sum, row) => sum + Math.round(Number(row.allocated_amount) || 0), 0);
  const { source_metadata: sourceMetadata, ...transactionFields } = transaction;
  return {
    transaction: {
      ...transactionFields,
      settlement_key: clobeSettlementKeyFromSourceMetadata(sourceMetadata),
    },
    allocations,
    fingerprint: String(fingerprintResult.data ?? ''),
    allocated,
    remaining: Math.round(Number(transaction.amount) || 0) - allocated,
    etag: createHash('sha256').update(String(fingerprintResult.data ?? '')).digest('hex'),
  };
}
