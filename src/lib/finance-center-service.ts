import * as Sentry from '@sentry/nextjs';

import {
  calculateBankAccountReality,
  calculateBankProfitErp,
  calculateBookingCashPositions,
  countTravelMemoOrAllocationActions,
  YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER,
  type BankAccountRealityRow,
  type BookingCashAllocationRow,
  type BookingCashBookingRow,
  type SettlementProfitSnapshot,
} from '@/lib/bank-account-reality';
import {
  resolveFinanceClassification,
  type FinanceClassificationOverride,
  type FinanceClassificationRule,
  type FinanceClassificationTransaction,
} from '@/lib/finance-classification';
import {
  calculateMonthlySettlementClosePreview,
  MONTHLY_CLOSE_REASON_TO_EXCEPTION,
  previousCompletedKoreaMonth,
  settlementMonthBounds,
  type MonthlyCloseAllocation,
  type MonthlyCloseBooking,
  type MonthlyCloseTransaction,
  type MonthlySettlementClosePreview,
} from '@/lib/monthly-settlement-close';
import { supabaseAdmin } from '@/lib/supabase';

const MAX_ROWS = 5000;

function chunks<T>(values: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function asCustomerName(value: unknown): string | null {
  if (Array.isArray(value)) return asCustomerName(value[0]);
  if (!value || typeof value !== 'object') return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

function koreaDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

export interface FinanceBookingSettlementRow {
  id: string;
  bookingNo: string;
  customerName: string | null;
  packageTitle: string | null;
  departureDate: string | null;
  settlementConfirmedAt: string | null;
  deposits: number;
  withdrawals: number;
  cashMargin: number;
  transactionCount: number;
  state: 'settled' | 'predeparture' | 'departed_pending' | 'date_missing';
}

export interface FinanceCenterSummary {
  generatedAt: string;
  accountNumber: string;
  status: {
    connected: boolean;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    sourceCount: number;
    recognizedCount: number;
    ledgerCount: number;
    bankBalance: number;
    osBalance: number;
    difference: number;
    balanceAsOf: string | null;
  };
  metrics: {
    actualBankBalance: number;
    protectedTravelCash: number;
    protectedCustomerFunds: number;
    unpaidSupplierCost: number;
    estimatedTaxLiability: number;
    estimatedTaxReserve: number;
    actualTaxPayments: number;
    companyOperatingResult: number;
    confirmedTravelProfit: number;
    afterTaxConfirmedProfit: number;
    safeToWithdraw: number;
    calculationStatus: 'clear' | 'blocked';
    blockers: string[];
  };
  actions: {
    travelMemoOrAllocation: number;
    unmatchedTravel: number;
    negativeMargin: number;
    unclassifiedCompany: number;
    monthCloseWaiting: number;
    postCloseChanges: number;
  };
  monthly: Array<{
    month: string;
    confirmedTravelProfit: number;
    estimatedTaxReserve: number;
    afterTaxTravelProfit: number;
    classifiedOperatingIncome: number;
    classifiedOperatingExpense: number;
    provisionalOperatingCashResult: number;
  }>;
  bookings: FinanceBookingSettlementRow[];
}

interface LoadedFinanceData {
  transactions: BankAccountRealityRow[];
  allocations: BookingCashAllocationRow[];
  bookings: Array<BookingCashBookingRow & {
    booking_no?: string | null;
    package_title?: string | null;
    customers?: unknown;
  }>;
}

interface FinanceSettlementSnapshot extends SettlementProfitSnapshot {
  deposits: number;
  withdrawals: number;
  transaction_ids: unknown;
}

async function loadAllocations(transactionIds: string[]): Promise<BookingCashAllocationRow[]> {
  const allocations: BookingCashAllocationRow[] = [];
  for (const ids of chunks(transactionIds)) {
    const { data, error } = await supabaseAdmin
      .from('bank_transaction_allocations')
      .select('bank_transaction_id, booking_id, allocated_amount, target_type')
      .in('bank_transaction_id', ids)
      .eq('status', 'active')
      .is('reversed_at', null);
    if (error) throw error;
    allocations.push(...((data ?? []) as BookingCashAllocationRow[]));
  }
  return allocations;
}

async function loadFinanceData(): Promise<LoadedFinanceData> {
  const [transactionResult, classificationResult, ruleResult] = await Promise.all([
    supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, received_at, updated_at, settlement_scope, account_number, balance_after, memo, counterparty_name, provider_category, provider_is_unclassified, match_status')
      .eq('external_provider', 'clobe')
      .eq('source', 'clobe_mcp')
      .eq('status', 'active')
      .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
      .order('received_at', { ascending: true })
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('bank_transaction_classifications')
      .select('bank_transaction_id, os_classification, confirmed_at, is_profit_and_loss')
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('bank_classification_rules')
      .select('id, priority, counterparty_pattern, memo_pattern, direction, target_classification, is_profit_and_loss, apply_to_existing, effective_from, is_active')
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .limit(500),
  ]);
  if (transactionResult.error) throw transactionResult.error;
  if (classificationResult.error) throw classificationResult.error;
  if (ruleResult.error) throw ruleResult.error;

  const overrides = new Map((classificationResult.data ?? []).map(row => [
    row.bank_transaction_id as string,
    row as FinanceClassificationOverride & { bank_transaction_id: string },
  ]));
  const rules = (ruleResult.data ?? []) as FinanceClassificationRule[];
  const transactions = ((transactionResult.data ?? []) as Array<BankAccountRealityRow & FinanceClassificationTransaction>)
    .map(row => {
      if (row.settlement_scope !== 'non_travel' || !row.id) return row;
      const resolved = resolveFinanceClassification({
        transaction: row,
        override: overrides.get(row.id),
        rules,
      });
      return { ...row, resolved_classification: resolved.classification };
    });

  const transactionIds = transactions
    .filter(row => row.id)
    .map(row => row.id as string);
  const allocations = await loadAllocations(transactionIds);
  const { data: bookingData, error: bookingError } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_no, package_title, departure_date, settlement_confirmed_at, total_price, total_cost, status, is_deleted, finance_excluded, customers!lead_customer_id(name)')
    .limit(MAX_ROWS);
  if (bookingError) throw bookingError;
  const bookings = (bookingData ?? []) as LoadedFinanceData['bookings'];

  return { transactions, allocations, bookings };
}

async function loadConfirmedSettlementSnapshots(): Promise<FinanceSettlementSnapshot[]> {
  const { data: periods, error: periodError } = await supabaseAdmin
    .from('settlement_periods')
    .select('id')
    .eq('is_current', true)
    .in('status', ['closed', 'conditional'])
    .limit(500);
  if (periodError) throw periodError;
  const periodIds = (periods ?? []).map(row => row.id as string);
  if (periodIds.length === 0) return [];

  const rows: FinanceSettlementSnapshot[] = [];
  for (const ids of chunks(periodIds)) {
    const { data, error } = await supabaseAdmin
      .from('settlement_period_items')
      .select('booking_id, departure_date, deposits, withdrawals, cash_margin, transaction_ids')
      .in('settlement_period_id', ids)
      .limit(MAX_ROWS);
    if (error) throw error;
    rows.push(...((data ?? []) as FinanceSettlementSnapshot[]));
  }
  return rows;
}

function buildBookingRows(
  data: LoadedFinanceData,
  referenceDate: string,
  snapshots: FinanceSettlementSnapshot[],
): FinanceBookingSettlementRow[] {
  const transactionById = new Map(data.transactions.map(row => [row.id, row]));
  const snapshotByBooking = new Map(snapshots.map(row => [row.booking_id, row]));
  const totals = new Map<string, { deposits: number; withdrawals: number; ids: Set<string> }>();
  for (const allocation of data.allocations) {
    const transaction = transactionById.get(allocation.bank_transaction_id);
    if (!transaction || !allocation.booking_id) continue;
    const current = totals.get(allocation.booking_id) ?? { deposits: 0, withdrawals: 0, ids: new Set<string>() };
    const targetType = allocation.target_type ?? 'booking';
    if (targetType === 'booking' && transaction.transaction_type === '입금') current.deposits += Math.round(Number(allocation.allocated_amount) || 0);
    else if (['booking', 'customer_refund'].includes(targetType) && transaction.transaction_type === '출금') current.withdrawals += Math.round(Number(allocation.allocated_amount) || 0);
    current.ids.add(allocation.bank_transaction_id);
    totals.set(allocation.booking_id, current);
  }

  return data.bookings.filter(booking => !booking.finance_excluded && !booking.is_deleted && booking.status !== 'cancelled').map(booking => {
    const cash = totals.get(booking.id) ?? { deposits: 0, withdrawals: 0, ids: new Set<string>() };
    const snapshot = snapshotByBooking.get(booking.id);
    const departureDate = booking.departure_date?.slice(0, 10) ?? null;
    const state = snapshot || booking.settlement_confirmed_at
      ? 'settled'
      : !departureDate
        ? 'date_missing'
        : departureDate > referenceDate
          ? 'predeparture'
          : 'departed_pending';
    return {
      id: booking.id,
      bookingNo: booking.booking_no ?? booking.id,
      customerName: asCustomerName(booking.customers),
      packageTitle: booking.package_title ?? null,
      departureDate,
      settlementConfirmedAt: booking.settlement_confirmed_at ?? null,
      deposits: snapshot ? Math.round(Number(snapshot.deposits) || 0) : cash.deposits,
      withdrawals: snapshot ? Math.round(Number(snapshot.withdrawals) || 0) : cash.withdrawals,
      cashMargin: snapshot ? Math.round(Number(snapshot.cash_margin) || 0) : cash.deposits - cash.withdrawals,
      transactionCount: snapshot && Array.isArray(snapshot.transaction_ids)
        ? snapshot.transaction_ids.length
        : cash.ids.size,
      state,
    } satisfies FinanceBookingSettlementRow;
  }).sort((a, b) => String(b.departureDate).localeCompare(String(a.departureDate)) || a.bookingNo.localeCompare(b.bookingNo));
}

export async function loadFinanceCenterSummary(taxRate = 0.1): Promise<FinanceCenterSummary> {
  try {
    const [data, confirmedSnapshots] = await Promise.all([
      loadFinanceData(),
      loadConfirmedSettlementSnapshots(),
    ]);
    const bankSummary = calculateBankAccountReality(data.transactions, data.allocations);
    const bookingCash = calculateBookingCashPositions({
      transactions: data.transactions,
      allocations: data.allocations,
      bookings: data.bookings,
      referenceDate: bankSummary.asOf ?? new Date(),
    });
    const profit = calculateBankProfitErp({
      bankSummary,
      bookingCash,
      transactions: data.transactions,
      allocations: data.allocations,
      bookings: data.bookings,
      confirmedSettlementItems: confirmedSnapshots,
      referenceDate: bankSummary.asOf ?? new Date(),
      taxRate,
    });
    const referenceDate = koreaDate(bankSummary.asOf ?? new Date());
    const bookingRows = buildBookingRows(data, referenceDate, confirmedSnapshots);

    const [syncResult, connectionResult, exceptionResult, periodResult] = await Promise.all([
      supabaseAdmin
        .from('finance_sync_runs')
        .select('source_count, recognized_count, status, completed_at')
        .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
        .order('completed_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('tenant_api_tokens')
        .select('id')
        .eq('provider', 'clobe')
        .eq('is_active', true)
        .limit(1),
      supabaseAdmin
        .from('settlement_period_exceptions')
        .select('exception_type')
        .eq('status', 'open')
        .limit(MAX_ROWS),
      supabaseAdmin
        .from('settlement_periods')
        .select('departure_month, status')
        .eq('is_current', true)
        .limit(500),
    ]);
    if (syncResult.error) throw syncResult.error;
    if (connectionResult.error) throw connectionResult.error;
    if (exceptionResult.error) throw exceptionResult.error;
    if (periodResult.error) throw periodResult.error;

    const latestSync = syncResult.data?.[0];
    const exceptions = exceptionResult.data ?? [];
    const closedMonths = new Set((periodResult.data ?? [])
      .filter(row => row.status === 'closed' || row.status === 'conditional')
      .map(row => String(row.departure_month).slice(0, 7)));
    const completedBookingMonths = new Set(bookingRows
      .filter(row => row.departureDate && row.departureDate < referenceDate)
      .map(row => row.departureDate!.slice(0, 7)));

    return {
      generatedAt: new Date().toISOString(),
      accountNumber: YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER,
      status: {
        connected: (connectionResult.data?.length ?? 0) > 0,
        lastSyncAt: latestSync?.completed_at ?? bankSummary.asOf,
        lastSyncStatus: latestSync?.status ?? null,
        sourceCount: latestSync?.source_count ?? bankSummary.transactionCount,
        recognizedCount: latestSync?.recognized_count ?? bankSummary.transactionCount,
        ledgerCount: bankSummary.transactionCount,
        bankBalance: bankSummary.actualBalance,
        osBalance: bankSummary.computedBalance,
        difference: bankSummary.reconciliationDifference,
        balanceAsOf: bankSummary.asOf,
      },
      metrics: {
        actualBankBalance: bankSummary.actualBalance,
        protectedTravelCash: profit.protectedTravelCash,
        protectedCustomerFunds: profit.protectedCustomerFunds,
        unpaidSupplierCost: profit.unpaidSupplierCost,
        estimatedTaxLiability: profit.estimatedTaxLiability,
        estimatedTaxReserve: profit.estimatedTaxReserve,
        actualTaxPayments: profit.actualTaxPayments,
        companyOperatingResult: profit.provisionalOperatingCashResult,
        confirmedTravelProfit: profit.confirmedTravelProfit,
        afterTaxConfirmedProfit: profit.afterTaxTravelProfit,
        safeToWithdraw: profit.safeToWithdraw,
        calculationStatus: profit.calculationStatus,
        blockers: profit.blockers,
      },
      actions: {
        travelMemoOrAllocation: countTravelMemoOrAllocationActions({
          transactions: data.transactions,
          allocations: data.allocations,
        }),
        unmatchedTravel: bookingCash.unallocatedTravelCount,
        negativeMargin: bookingRows.filter(row => row.state !== 'settled' && row.cashMargin < 0).length,
        unclassifiedCompany: profit.classificationReviewCount,
        monthCloseWaiting: new Set([
          ...bookingRows
            .filter(row => row.state === 'departed_pending' && row.departureDate)
            .map(row => row.departureDate!.slice(0, 7)),
          ...[...completedBookingMonths].filter(month => !closedMonths.has(month)),
        ]).size,
        postCloseChanges: exceptions.filter(row => row.exception_type === 'post_close_change').length,
      },
      monthly: profit.monthly,
      bookings: bookingRows,
    };
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'finance-center-summary' } });
    throw error;
  }
}

export async function syncOpenMonthlySettlementExceptions(
  referenceDate: Date | string = new Date(),
): Promise<{ scanned: number; candidates: number; inserted: number; resolved: number }> {
  const month = previousCompletedKoreaMonth(referenceDate);
  const preview = await loadMonthlySettlementPreview(month);
  const candidates = [...preview.review, ...preview.priorOmissions]
    .filter(item => Boolean(item.reason));
  const exceptionTypes = Object.values(MONTHLY_CLOSE_REASON_TO_EXCEPTION);
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('settlement_period_exceptions')
    .select('id, departure_month, booking_id, exception_type, payload')
    .eq('status', 'open')
    .in('exception_type', exceptionTypes)
    .limit(MAX_ROWS);
  if (existingError) throw existingError;

  const key = (departureMonth: string, exceptionType: string, bookingId: string) =>
    `${departureMonth.slice(0, 7)}:${exceptionType}:${bookingId}`;
  const existingByKey = new Map((existingRows ?? []).map(row => [
    key(String(row.departure_month), String(row.exception_type), String(row.booking_id)),
    row,
  ]));
  const candidateKeys = new Set<string>();
  const dueDate = koreaDate(new Date(new Date(referenceDate).getTime() + 7 * 24 * 60 * 60_000));
  const detectedAt = new Date().toISOString();
  const missing = candidates.flatMap(item => {
    const departureMonth = `${item.departureDate.slice(0, 7)}-01`;
    const exceptionType = MONTHLY_CLOSE_REASON_TO_EXCEPTION[item.reason!];
    const candidateKey = key(departureMonth, exceptionType, item.bookingId);
    candidateKeys.add(candidateKey);
    if (existingByKey.has(candidateKey)) return [];
    return [{
      departure_month: departureMonth,
      booking_id: item.bookingId,
      exception_type: exceptionType,
      assigned_to: '재무 담당자',
      reason: '완료된 출발 월의 미확정 예약 자동 점검',
      due_date: dueDate,
      source_fingerprint: item.transactionFingerprint,
      current_fingerprint: item.transactionFingerprint,
      payload: {
        origin: 'automatic_completed_month_scan',
        booking_no: item.bookingNo,
        departure_date: item.departureDate,
        deposits: item.deposits,
        withdrawals: item.withdrawals,
        cash_margin: item.cashNet,
        detected_at: detectedAt,
      },
    }];
  });

  let inserted = 0;
  for (const row of missing) {
    const { error } = await supabaseAdmin.from('settlement_period_exceptions').insert(row);
    if (!error) {
      inserted += 1;
      continue;
    }
    // An admin sync and the daily cron may scan the same booking together.
    // The open-exception unique index is the final idempotency guard.
    if (error.code !== '23505') throw error;
  }

  const staleAutomaticIds = (existingRows ?? [])
    .filter(row => {
      const payload = row.payload as { origin?: unknown } | null;
      return payload?.origin === 'automatic_completed_month_scan'
        && !candidateKeys.has(key(String(row.departure_month), String(row.exception_type), String(row.booking_id)));
    })
    .map(row => row.id as string);
  if (staleAutomaticIds.length > 0) {
    const { error } = await supabaseAdmin
      .from('settlement_period_exceptions')
      .update({
        status: 'resolved',
        resolved_at: detectedAt,
        resolved_by: 'system:clobe_sync',
      })
      .in('id', staleAutomaticIds);
    if (error) throw error;
  }

  return {
    scanned: preview.review.length + preview.priorOmissions.length,
    candidates: candidates.length,
    inserted,
    resolved: staleAutomaticIds.length,
  };
}

export async function refreshClobeFinanceClassifications(): Promise<{
  processed: number;
  review: number;
  allocationInserted: number;
  allocationUpdated: number;
  allocationNonExact: number;
}> {
  const [transactionResult, classificationResult, ruleResult] = await Promise.all([
    supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, counterparty_name, memo, received_at, provider_category, provider_is_unclassified')
      .eq('external_provider', 'clobe')
      .eq('source', 'clobe_mcp')
      .eq('status', 'active')
      .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
      .eq('settlement_scope', 'non_travel')
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('bank_transaction_classifications')
      .select('bank_transaction_id, os_classification, confirmed_at, confirmed_by, is_profit_and_loss, receipt_status, notes')
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('bank_classification_rules')
      .select('id, priority, counterparty_pattern, memo_pattern, direction, target_classification, is_profit_and_loss, apply_to_existing, effective_from, is_active')
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .limit(500),
  ]);
  if (transactionResult.error) throw transactionResult.error;
  if (classificationResult.error) throw classificationResult.error;
  if (ruleResult.error) throw ruleResult.error;

  const storedByTransaction = new Map((classificationResult.data ?? []).map(row => [
    row.bank_transaction_id as string,
    row,
  ]));
  const rules = (ruleResult.data ?? []) as FinanceClassificationRule[];
  const now = new Date().toISOString();
  const rows = ((transactionResult.data ?? []) as FinanceClassificationTransaction[]).map(transaction => {
    const stored = storedByTransaction.get(transaction.id);
    const resolved = resolveFinanceClassification({
      transaction,
      override: stored as FinanceClassificationOverride | undefined,
      rules,
    });
    return {
      bank_transaction_id: transaction.id,
      clobe_original_classification: transaction.provider_category ?? null,
      os_classification: stored?.os_classification ?? null,
      resolved_classification: resolved.classification,
      resolution_source: resolved.source,
      rule_id: resolved.ruleId,
      is_profit_and_loss: resolved.isProfitAndLoss,
      receipt_status: stored?.receipt_status ?? 'not_required',
      confirmed_at: stored?.confirmed_at ?? null,
      confirmed_by: stored?.confirmed_by ?? null,
      notes: stored?.notes ?? null,
      updated_at: now,
    };
  });

  for (const batch of chunks(rows, 500)) {
    const { error } = await supabaseAdmin
      .from('bank_transaction_classifications')
      .upsert(batch, { onConflict: 'bank_transaction_id' });
    if (error) throw error;
  }

  const { data: allocationSyncData, error: allocationSyncError } = await supabaseAdmin
    .rpc('sync_non_travel_classification_allocations', { p_transaction_id: null });
  if (allocationSyncError) throw allocationSyncError;
  const allocationSync = (allocationSyncData ?? {}) as {
    inserted?: number;
    updated?: number;
    nonExact?: number;
  };

  return {
    processed: rows.length,
    review: rows.filter(row => row.resolved_classification === 'review').length,
    allocationInserted: Number(allocationSync.inserted ?? 0),
    allocationUpdated: Number(allocationSync.updated ?? 0),
    allocationNonExact: Number(allocationSync.nonExact ?? 0),
  };
}

export async function loadMonthlySettlementPreview(month: string): Promise<MonthlySettlementClosePreview> {
  const { endDate } = settlementMonthBounds(month);
  const [transactionResult, bookingResult, reviewResult] = await Promise.all([
    supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, memo, received_at, updated_at')
      .eq('external_provider', 'clobe')
      .eq('source', 'clobe_mcp')
      .eq('status', 'active')
      .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
      .eq('settlement_scope', 'travel')
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('bookings')
      .select('id, booking_no, package_title, departure_date, status, is_deleted, finance_excluded, settlement_confirmed_at, settlement_mode')
      .lte('departure_date', endDate)
      .limit(MAX_ROWS),
    supabaseAdmin
      .from('booking_settlement_reviews')
      .select('booking_id, status, review_fingerprint, reviewed_by_label, reviewed_at')
      .eq('is_current', true)
      .limit(MAX_ROWS),
  ]);
  if (transactionResult.error) throw transactionResult.error;
  if (bookingResult.error) throw bookingResult.error;
  if (reviewResult.error) throw reviewResult.error;

  const transactions = (transactionResult.data ?? []) as MonthlyCloseTransaction[];
  const allocations = await loadAllocations(transactions.map(row => row.id)) as MonthlyCloseAllocation[];
  const reviewByBooking = new Map((reviewResult.data ?? []).map(row => [row.booking_id as string, row]));
  const bookings = ((bookingResult.data ?? []) as MonthlyCloseBooking[]).map(booking => {
    const review = reviewByBooking.get(booking.id);
    return {
      ...booking,
      review_status: review?.status as MonthlyCloseBooking['review_status'],
      review_fingerprint: review?.review_fingerprint as string | null,
      reviewed_by_label: review?.reviewed_by_label as string | null,
      reviewed_at: review?.reviewed_at as string | null,
    };
  });
  return calculateMonthlySettlementClosePreview({
    month,
    transactions,
    allocations,
    bookings,
  });
}

export async function detectPostCloseSettlementChanges(): Promise<{ checked: number; changed: number }> {
  const { data: periods, error: periodError } = await supabaseAdmin
    .from('settlement_periods')
    .select('id, departure_month')
    .eq('is_current', true)
    .in('status', ['closed', 'conditional'])
    .limit(500);
  if (periodError) throw periodError;
  if (!periods?.length) return { checked: 0, changed: 0 };

  const periodIds = periods.map(row => row.id as string);
  const { data: items, error: itemError } = await supabaseAdmin
    .from('settlement_period_items')
    .select('settlement_period_id, booking_id, transaction_fingerprint, snapshot')
    .in('settlement_period_id', periodIds)
    .limit(MAX_ROWS);
  if (itemError) throw itemError;

  const comparableItems = (items ?? []).filter(row => Number((row.snapshot as { fingerprint_version?: number } | null)?.fingerprint_version) >= 2);
  const bookingIds = [...new Set(comparableItems.map(row => row.booking_id as string))];
  if (bookingIds.length === 0) return { checked: 0, changed: 0 };
  const { data: allocations, error: allocationError } = await supabaseAdmin
    .from('bank_transaction_allocations')
    .select('bank_transaction_id, booking_id, allocated_amount, target_type')
    .in('booking_id', bookingIds)
    .eq('status', 'active')
    .is('reversed_at', null)
    .limit(MAX_ROWS);
  if (allocationError) throw allocationError;
  const transactionIds = [...new Set((allocations ?? []).map(row => row.bank_transaction_id as string))];
  const transactions: MonthlyCloseTransaction[] = [];
  for (const ids of chunks(transactionIds)) {
    const { data, error } = await supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, memo, received_at, updated_at')
      .in('id', ids)
      .eq('external_provider', 'clobe')
      .eq('source', 'clobe_mcp')
      .eq('status', 'active');
    if (error) throw error;
    transactions.push(...((data ?? []) as MonthlyCloseTransaction[]));
  }

  const txById = new Map(transactions.map(row => [row.id, row]));
  const allocationByBooking = new Map<string, MonthlyCloseAllocation[]>();
  for (const allocation of (allocations ?? []) as MonthlyCloseAllocation[]) {
    if (!allocation.booking_id) continue;
    const list = allocationByBooking.get(allocation.booking_id) ?? [];
    list.push(allocation);
    allocationByBooking.set(allocation.booking_id, list);
  }
  const periodById = new Map(periods.map(row => [row.id as string, row]));
  let changed = 0;

  for (const item of comparableItems) {
    const rows = (allocationByBooking.get(item.booking_id as string) ?? [])
      .map(allocation => ({
        transaction: txById.get(allocation.bank_transaction_id),
        allocatedAmount: allocation.allocated_amount,
      }))
      .filter((row): row is { transaction: MonthlyCloseTransaction; allocatedAmount: number } => Boolean(row.transaction));
    const currentFingerprint = rows
      .map(({ transaction, allocatedAmount }) => [
        transaction.id,
        transaction.transaction_type,
        Math.round(Number(transaction.amount) || 0),
        Math.round(Number(allocatedAmount) || 0),
        transaction.received_at ?? '',
        (transaction.memo ?? '').normalize('NFKC').trim(),
      ].join(':'))
      .sort()
      .join('|');
    if (currentFingerprint === item.transaction_fingerprint) continue;

    changed += 1;
    const period = periodById.get(item.settlement_period_id as string);
    const month = String(period?.departure_month ?? '').slice(0, 7) + '-01';
    const { data: existing } = await supabaseAdmin
      .from('settlement_period_exceptions')
      .select('id')
      .eq('departure_month', month)
      .eq('exception_type', 'post_close_change')
      .eq('booking_id', item.booking_id)
      .eq('status', 'open')
      .limit(1);
    if (existing?.length) continue;
    const { error } = await supabaseAdmin.from('settlement_period_exceptions').insert({
      settlement_period_id: item.settlement_period_id,
      departure_month: month,
      booking_id: item.booking_id,
      exception_type: 'post_close_change',
      source_fingerprint: item.transaction_fingerprint,
      current_fingerprint: currentFingerprint,
      payload: { detected_at: new Date().toISOString() },
    });
    if (error) throw error;
  }

  return { checked: comparableItems.length, changed };
}
