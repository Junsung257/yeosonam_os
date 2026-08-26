import { createBooking } from '@/lib/db/bookings';
import { upsertCustomer } from '@/lib/db/customers';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';
import { parseTravelSettlementMemo, type ParsedTravelSettlementMemo } from './bank-statement-parser';
import { normalizeBankTransactionText } from '@/lib/bank-transaction-fingerprint';
import { resolveClobeTransactionAuthority } from './clobe-transaction-authority';

interface SettlementBookingCandidate {
  id: string;
  booking_no?: string | null;
  departure_date?: string | null;
  land_operator?: string | null;
  land_operator_id?: string | null;
  customers?: { name?: string | null } | null;
}

export interface SettlementMemoResolution {
  bookingId: string | null;
  suggestedBookingId?: string | null;
  bookingNo?: string | null;
  customerName?: string | null;
  source: 'existing_key' | 'existing_booking' | 'created_booking' | 'ambiguous' | 'error';
  created: boolean;
  confidence: number;
  reason?: string;
  requiresReview?: boolean;
}

function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const an = normalizeBankTransactionText(a);
  const bn = normalizeBankTransactionText(b);
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  if (an.includes(bn) || bn.includes(an)) return 0.75;
  if (an[0] === bn[0]) return 0.25;
  return 0;
}

async function findLandOperatorId(name: string): Promise<string | null> {
  const normalized = normalizeBankTransactionText(name);
  const { data } = await supabaseAdmin
    .from('land_operators')
    .select('id, name')
    .limit(100);

  const rows = (data ?? []) as Array<{ id: string; name: string | null }>;
  let best: { id: string; score: number } | null = null;
  for (const row of rows) {
    const score = similarity(row.name, normalized);
    if (!best || score > best.score) best = { id: row.id, score };
  }
  return best && best.score >= 0.75 ? best.id : null;
}

async function bindSettlementKey(
  memo: ParsedTravelSettlementMemo,
  bookingId: string,
  opts: {
    tenantId?: string | null;
    bookingNo?: string | null;
    landOperatorId?: string | null;
    source: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('booking_settlement_keys')
    .insert({
      tenant_id: opts.tenantId ?? null,
      normalized_key: memo.normalizedKey,
      raw_key: memo.rawMemo,
      booking_id: bookingId,
      departure_date: memo.departureDate,
      customer_name_snapshot: memo.leadCustomerName,
      land_operator_id: opts.landOperatorId ?? null,
      land_operator_name_snapshot: memo.landOperatorName,
      source: opts.source,
      metadata: {
        booking_no: opts.bookingNo ?? null,
        ...opts.metadata,
      },
    } as Record<string, unknown>);

  if (error && error.code !== '23505') {
    throw new Error(`settlement key bind failed: ${sanitizeDbError(error)}`);
  }
  return !error;
}

async function findExistingKey(
  memo: ParsedTravelSettlementMemo,
  tenantId?: string | null,
): Promise<SettlementMemoResolution | null> {
  let query = supabaseAdmin
    .from('booking_settlement_keys')
    .select('booking_id, source, metadata, bookings!booking_id(booking_no, customers!lead_customer_id(name))')
    .eq('normalized_key', memo.normalizedKey)
    .eq('status', 'active');
  query = tenantId
    ? query.eq('tenant_id', tenantId) as typeof query
    : query.is('tenant_id', null) as typeof query;
  const { data, error } = await query.maybeSingle();

  if (error) throw new Error(`settlement key lookup failed: ${sanitizeDbError(error)}`);
  if (!data) return null;

  const row = data as unknown as {
    booking_id: string;
    source?: string | null;
    metadata?: Record<string, unknown> | null;
    bookings?: { booking_no?: string | null; customers?: { name?: string | null } | null } | null;
  };

  const metadata = row.metadata ?? {};
  const isClobeGenerated = row.source === 'clobe_memo_created_booking'
    || row.source === 'bank_memo_created_booking'
    || row.source === 'clobe_memo_approved_booking'
    || metadata.clobe_generated === true
    || metadata.placeholder === true;
  if (!isClobeGenerated) {
    return {
      bookingId: null,
      bookingNo: null,
      customerName: null,
      source: 'ambiguous',
      created: false,
      confidence: 1,
      requiresReview: true,
      reason: 'an existing non-Clobe settlement key matches this memo; automatic linking is blocked',
    };
  }

  return {
    bookingId: row.booking_id,
    bookingNo: row.bookings?.booking_no ?? null,
    customerName: row.bookings?.customers?.name ?? memo.leadCustomerName,
    source: 'existing_key',
    created: false,
    confidence: 1,
  };
}

async function findExistingBooking(
  memo: ParsedTravelSettlementMemo,
  tenantId?: string | null,
): Promise<SettlementMemoResolution | null> {
  let query = supabaseAdmin
    .from('bookings')
    .select('id, booking_no, departure_date, land_operator, land_operator_id, customers!lead_customer_id(name)')
    .eq('departure_date', memo.departureDate)
    .neq('status', 'cancelled')
    .or('is_deleted.is.null,is_deleted.eq.false');
  query = tenantId
    ? query.eq('tenant_id', tenantId) as typeof query
    : query.is('tenant_id', null) as typeof query;
  const { data, error } = await query;
  if (error) throw new Error(`existing booking lookup failed: ${sanitizeDbError(error)}`);

  const candidates = ((data ?? []) as SettlementBookingCandidate[])
    .map(row => {
      const customerScore = similarity(row.customers?.name, memo.leadCustomerName);
      const operatorScore = similarity(row.land_operator, memo.landOperatorName);
      const score = 0.65 * customerScore + 0.35 * operatorScore;
      return { row, score, customerScore, operatorScore };
    })
    .filter(candidate => candidate.customerScore >= 0.75 && candidate.score >= 0.65)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return null;
  const best = candidates[0];
  const ambiguous = candidates.length > 1 && candidates[0].score - candidates[1].score < 0.2;
  return {
    bookingId: null,
    suggestedBookingId: ambiguous ? null : best.row.id,
    bookingNo: ambiguous ? null : best.row.booking_no,
    customerName: ambiguous ? null : best.row.customers?.name ?? memo.leadCustomerName,
    source: 'ambiguous',
    created: false,
    confidence: Math.round(best.score * 100) / 100,
    requiresReview: true,
    reason: ambiguous
      ? 'same memo matched more than one existing booking; review is required'
      : 'an existing normal booking looks similar; Clobe memo will not auto-link to it',
  };
}

async function createPlaceholderBooking(
  memo: ParsedTravelSettlementMemo,
  tenantId?: string | null,
): Promise<SettlementMemoResolution> {
  const customer = await upsertCustomer({
    name: memo.leadCustomerName,
    source: 'bank_memo_import',
    tenant_id: tenantId ?? null,
  } as Record<string, unknown>);
  if (!customer?.id) throw new Error('customer creation failed for settlement memo');

  const landOperatorId = await findLandOperatorId(memo.landOperatorName);
  const booking = await createBooking({
    tenantId,
    leadCustomerId: customer.id,
    packageTitle: `${memo.leadCustomerName} ${memo.departureDate} 정산 임시 예약`,
    adultCount: 1,
    childCount: 0,
    adultCost: 0,
    adultPrice: 0,
    childCost: 0,
    childPrice: 0,
    fuelSurcharge: 0,
    departureDate: memo.departureDate,
    landOperator: memo.landOperatorName,
    landOperatorId: landOperatorId ?? undefined,
    quickCreated: true,
    depositNoticeBlocked: true,
    status: 'pending',
    notes: `Created from bank memo ${memo.rawMemo}. Confirm total price/cost before settlement approval.`,
  });
  if (!booking?.id) throw new Error('booking creation failed for settlement memo');

  const bound = await bindSettlementKey(memo, booking.id, {
    tenantId,
    bookingNo: (booking as { booking_no?: string | null }).booking_no ?? null,
    landOperatorId,
    source: 'clobe_memo_created_booking',
    metadata: { placeholder: true, clobe_generated: true },
  });

  // Two manual sync clicks can race before either one sees the unique memo
  // key. Keep the first key owner and hide the loser instead of leaving a
  // second visible settlement booking behind.
  if (!bound) {
    const existing = await findExistingKey(memo, tenantId);
    if (existing?.bookingId && existing.bookingId !== booking.id) {
      await supabaseAdmin
        .from('bookings')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', booking.id);
      return existing;
    }
  }

  return {
    bookingId: booking.id,
    bookingNo: (booking as { booking_no?: string | null }).booking_no ?? null,
    customerName: memo.leadCustomerName,
    source: 'created_booking',
    created: true,
    confidence: 1,
  };
}

export async function resolveSettlementMemoBooking(
  memo: ParsedTravelSettlementMemo,
  options: { createIfMissing: boolean; tenantId?: string | null },
): Promise<SettlementMemoResolution> {
  const byKey = await findExistingKey(memo, options.tenantId);
  if (byKey) return byKey;

  const byBooking = await findExistingBooking(memo, options.tenantId);
  if (byBooking) return byBooking;

  if (!options.createIfMissing) {
    return {
      bookingId: null,
      source: 'error',
      created: false,
      confidence: 0,
      reason: 'no booking settlement key or matching booking yet',
    };
  }

  return createPlaceholderBooking(memo, options.tenantId);
}

export type ClobeMemoCorrectionResult =
  | { status: 'updated'; bookingId: string; previousKey: string | null; nextKey: string }
  | { status: 'review'; bookingId: string; previousKey: string | null; nextKey: string; reason: string };

/**
 * Update a Clobe-created settlement booking in place when its provider memo
 * changes before final settlement. If another active provider transaction
 * still carries the old key, the correction is quarantined for review. This
 * prevents two real trip keys from silently becoming aliases of one booking.
 */
export async function applyClobeMemoCorrection(input: {
  bookingId: string;
  transactionId: string;
  previousMemo: string | null | undefined;
  nextMemo: ParsedTravelSettlementMemo;
}): Promise<ClobeMemoCorrectionResult> {
  const previous = input.previousMemo ? parseTravelSettlementMemo(input.previousMemo) : null;
  const previousKey = previous?.normalizedKey ?? null;
  const nextKey = input.nextMemo.normalizedKey;
  if (!previous || previousKey === nextKey) {
    return {
      status: 'review',
      bookingId: input.bookingId,
      previousKey,
      nextKey,
      reason: 'previous Clobe memo key could not be resolved or did not change',
    };
  }

  const { data: currentKey, error: currentKeyError } = await supabaseAdmin
    .from('booking_settlement_keys')
    .select('booking_id, tenant_id, source, metadata')
    .eq('normalized_key', previousKey)
    .eq('booking_id', input.bookingId)
    .eq('status', 'active')
    .maybeSingle();
  if (currentKeyError) throw new Error(`previous settlement key lookup failed: ${sanitizeDbError(currentKeyError)}`);

  // Another transaction in the same sync may already have atomically renamed
  // the generated booking. Remaining provider rows should converge their
  // stored memo to that active key instead of being quarantined forever.
  if (!currentKey) {
    const { data: renamedKey, error: renamedKeyError } = await supabaseAdmin
      .from('booking_settlement_keys')
      .select('booking_id, source, metadata')
      .eq('normalized_key', nextKey)
      .eq('booking_id', input.bookingId)
      .eq('status', 'active')
      .maybeSingle();
    if (renamedKeyError) throw new Error(`renamed settlement key lookup failed: ${sanitizeDbError(renamedKeyError)}`);
    const renamedMetadata = (renamedKey?.metadata ?? {}) as Record<string, unknown>;
    const alreadyRenamed = renamedKey?.source === 'clobe_memo_created_booking'
      || renamedKey?.source === 'bank_memo_created_booking'
      || renamedKey?.source === 'clobe_memo_approved_booking'
      || renamedMetadata.clobe_generated === true
      || renamedMetadata.placeholder === true;
    if (renamedKey && alreadyRenamed) {
      return { status: 'updated', bookingId: input.bookingId, previousKey, nextKey };
    }
  }

  const metadata = (currentKey?.metadata ?? {}) as Record<string, unknown>;
  const generated = currentKey?.source === 'clobe_memo_created_booking'
    || currentKey?.source === 'bank_memo_created_booking'
    || currentKey?.source === 'clobe_memo_approved_booking'
    || metadata.clobe_generated === true
    || metadata.placeholder === true;
  if (!currentKey || !generated) {
    return {
      status: 'review',
      bookingId: input.bookingId,
      previousKey,
      nextKey,
      reason: 'the existing booking was not created by the Clobe memo flow',
    };
  }

  const sourceFilter = 'source.eq.clobe_mcp,source.eq.clobe_api,external_provider.eq.clobe';
  let sameMemoQuery = supabaseAdmin
      .from('bank_transactions')
      .select('id, memo, source, external_provider, source_metadata')
      .neq('id', input.transactionId)
      .neq('status', 'excluded')
      .eq('memo', previous.rawMemo)
      .or(sourceFilter)
      .limit(1);
  let linkedBookingQuery = supabaseAdmin
      .from('bank_transactions')
      .select('id, memo, source, external_provider, source_metadata')
      .neq('id', input.transactionId)
      .neq('status', 'excluded')
      .eq('booking_id', input.bookingId)
      .or(sourceFilter)
      .limit(200);
  sameMemoQuery = currentKey.tenant_id
    ? sameMemoQuery.eq('tenant_id', currentKey.tenant_id) as typeof sameMemoQuery
    : sameMemoQuery.is('tenant_id', null) as typeof sameMemoQuery;
  linkedBookingQuery = currentKey.tenant_id
    ? linkedBookingQuery.eq('tenant_id', currentKey.tenant_id) as typeof linkedBookingQuery
    : linkedBookingQuery.is('tenant_id', null) as typeof linkedBookingQuery;
  const [sameMemoResult, linkedBookingResult] = await Promise.all([
    sameMemoQuery,
    linkedBookingQuery,
  ]);
  if (sameMemoResult.error) {
    throw new Error(`old memo transaction lookup failed: ${sanitizeDbError(sameMemoResult.error)}`);
  }
  if (linkedBookingResult.error) {
    throw new Error(`linked booking transaction lookup failed: ${sanitizeDbError(linkedBookingResult.error)}`);
  }
  const anotherTransactionUsesOldKey = [
    ...(sameMemoResult.data ?? []),
    ...(linkedBookingResult.data ?? []),
  ].some(row => resolveClobeTransactionAuthority(row).providerSettlementKey === previousKey);
  if (anotherTransactionUsesOldKey) {
    return {
      status: 'review',
      bookingId: input.bookingId,
      previousKey,
      nextKey,
      reason: 'another active Clobe transaction still uses the previous memo key; automatic correction is blocked',
    };
  }

  const customer = await upsertCustomer({
    name: input.nextMemo.leadCustomerName,
    source: 'clobe_memo_sync',
    tenant_id: currentKey.tenant_id ?? null,
  } as Record<string, unknown>);
  if (!customer?.id) throw new Error('customer creation failed during Clobe memo correction');

  const landOperatorId = await findLandOperatorId(input.nextMemo.landOperatorName);
  const { data: currentBooking, error: bookingLookupError } = await supabaseAdmin
    .from('bookings')
    .select('package_title, quick_created')
    .eq('id', input.bookingId)
    .maybeSingle();
  if (bookingLookupError) throw new Error(`booking lookup failed during Clobe memo correction: ${sanitizeDbError(bookingLookupError)}`);

  let packageTitle: string | null = null;
  if (currentBooking?.quick_created === true || String(currentBooking?.package_title ?? '').includes('정산 임시 예약')) {
    packageTitle = `${input.nextMemo.leadCustomerName} ${input.nextMemo.departureDate} 정산 임시 예약`;
  }

  const { error: correctionError } = await supabaseAdmin.rpc('apply_clobe_memo_booking_correction', {
    p_booking_id: input.bookingId,
    p_transaction_id: input.transactionId,
    p_previous_key: previousKey,
    p_next_key: nextKey,
    p_raw_key: input.nextMemo.rawMemo,
    p_departure_date: input.nextMemo.departureDate,
    p_customer_id: customer.id,
    p_customer_name: input.nextMemo.leadCustomerName,
    p_land_operator_id: landOperatorId,
    p_land_operator_name: input.nextMemo.landOperatorName,
    p_package_title: packageTitle,
    p_actor: 'clobe_sync',
  });
  if (correctionError) {
    if (correctionError.code === 'P0001') {
      return {
        status: 'review',
        bookingId: input.bookingId,
        previousKey,
        nextKey,
        reason: sanitizeDbError(correctionError),
      };
    }
    throw new Error(`Clobe memo correction command failed: ${sanitizeDbError(correctionError)}`);
  }

  return { status: 'updated', bookingId: input.bookingId, previousKey, nextKey };
}
