import { createBooking } from '@/lib/db/bookings';
import { upsertCustomer } from '@/lib/db/customers';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';
import type { ParsedTravelSettlementMemo } from './bank-statement-parser';
import { normalizeBankTransactionText } from '@/lib/bank-transaction-fingerprint';

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
  bookingNo?: string | null;
  customerName?: string | null;
  source: 'existing_key' | 'existing_booking' | 'created_booking' | 'ambiguous' | 'error';
  created: boolean;
  confidence: number;
  reason?: string;
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
    bookingNo?: string | null;
    landOperatorId?: string | null;
    source: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabaseAdmin
    .from('booking_settlement_keys')
    .insert({
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
}

async function findExistingKey(memo: ParsedTravelSettlementMemo): Promise<SettlementMemoResolution | null> {
  const { data, error } = await supabaseAdmin
    .from('booking_settlement_keys')
    .select('booking_id, bookings!booking_id(booking_no, customers!lead_customer_id(name))')
    .eq('normalized_key', memo.normalizedKey)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw new Error(`settlement key lookup failed: ${sanitizeDbError(error)}`);
  if (!data) return null;

  const row = data as unknown as {
    booking_id: string;
    bookings?: { booking_no?: string | null; customers?: { name?: string | null } | null } | null;
  };

  return {
    bookingId: row.booking_id,
    bookingNo: row.bookings?.booking_no ?? null,
    customerName: row.bookings?.customers?.name ?? memo.leadCustomerName,
    source: 'existing_key',
    created: false,
    confidence: 1,
  };
}

async function findExistingBooking(memo: ParsedTravelSettlementMemo): Promise<SettlementMemoResolution | null> {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_no, departure_date, land_operator, land_operator_id, customers!lead_customer_id(name)')
    .eq('departure_date', memo.departureDate)
    .in('status', ['pending', 'confirmed', 'completed'])
    .or('is_deleted.is.null,is_deleted.eq.false');

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
  if (candidates.length > 1 && candidates[0].score - candidates[1].score < 0.2) {
    return {
      bookingId: null,
      source: 'ambiguous',
      created: false,
      confidence: Math.round(candidates[0].score * 100) / 100,
      reason: 'same memo matched more than one booking candidate',
    };
  }

  const best = candidates[0];
  await bindSettlementKey(memo, best.row.id, {
    bookingNo: best.row.booking_no,
    landOperatorId: best.row.land_operator_id,
    source: 'bank_memo_existing_booking',
    metadata: { confidence: best.score },
  });

  return {
    bookingId: best.row.id,
    bookingNo: best.row.booking_no,
    customerName: best.row.customers?.name ?? memo.leadCustomerName,
    source: 'existing_booking',
    created: false,
    confidence: Math.round(best.score * 100) / 100,
  };
}

async function createPlaceholderBooking(memo: ParsedTravelSettlementMemo): Promise<SettlementMemoResolution> {
  const customer = await upsertCustomer({
    name: memo.leadCustomerName,
    source: 'bank_memo_import',
  } as Record<string, unknown>);
  if (!customer?.id) throw new Error('customer creation failed for settlement memo');

  const landOperatorId = await findLandOperatorId(memo.landOperatorName);
  const booking = await createBooking({
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

  await bindSettlementKey(memo, booking.id, {
    bookingNo: (booking as { booking_no?: string | null }).booking_no ?? null,
    landOperatorId,
    source: 'bank_memo_created_booking',
    metadata: { placeholder: true },
  });

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
  options: { createIfMissing: boolean },
): Promise<SettlementMemoResolution> {
  const byKey = await findExistingKey(memo);
  if (byKey) return byKey;

  const byBooking = await findExistingBooking(memo);
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

  return createPlaceholderBooking(memo);
}
