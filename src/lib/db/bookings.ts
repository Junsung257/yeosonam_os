/**
 * 여소남 OS — 예약(bookings) DB 계층
 *
 * bookings 테이블 CRUD + void 연쇄 처리.
 * supabase.ts God Object 에서 분리한 모듈.
 */
import { supabaseAdmin } from '@/lib/supabase';

// ── SELECT 상수 ──────────────────────────────────────────────

const BOOKING_LITE_FIELDS = [
  'id', 'booking_no', 'package_id', 'package_title', 'lead_customer_id',
  'adult_count', 'child_count', 'child_n_count', 'child_e_count', 'infant_count', 'single_charge_count',
  'adult_price', 'child_price', 'child_n_price', 'child_e_price', 'infant_price',
  'fuel_surcharge', 'single_charge', 'total_price', 'total_cost',
  'status', 'departure_date', 'return_date', 'booking_date', 'created_at', 'updated_at',
  'cancelled_at', 'voided_at', 'refunded_at', 'payment_date',
  'departure_region', 'departing_location_id', 'land_operator', 'land_operator_id', 'manager_name',
  'paid_amount', 'total_paid_out', 'payment_status', 'payment_method',
  'channel_source', 'utm_source', 'utm_medium', 'utm_campaign',
  'referral_code', 'affiliate_id', 'booking_type', 'influencer_commission', 'commission_rate',
  'is_deleted', 'is_ticketed', 'is_manifest_sent', 'has_sent_docs',
  'transfer_status', 'customer_receipt_status', 'has_tax_invoice',
  'dispute_flag', 'cancel_reason', 'notes',
  'flight_out', 'flight_out_time', 'flight_in', 'flight_in_time',
].join(', ');

// ── 조회 ─────────────────────────────────────────────────────

export async function getBookings(
  status?: string,
  customerId?: string,
  opts?: {
    departureFrom?: string;
    departureTo?: string;
    includeDeleted?: string;
    limit?: number;
    offset?: number;
    lite?: boolean;
  }
) {
  try {
    const pageLimit = opts?.limit ?? 100;
    const pageOffset = opts?.offset ?? 0;
    const fields = opts?.lite
      ? `${BOOKING_LITE_FIELDS}, customers!lead_customer_id(id,name,phone)`
      : '*, customers!lead_customer_id(id,name,phone)';
    let query = supabaseAdmin
      .from('bookings')
      .select(fields)
      .order('created_at', { ascending: false })
      .range(pageOffset, pageOffset + pageLimit - 1);

    if (opts?.includeDeleted === 'only') {
      query = query.eq('is_deleted', true);
    } else if (opts?.includeDeleted === 'all') {
      // 필터 없음
    } else {
      query = query.or('is_deleted.is.null,is_deleted.eq.false');
    }

    if (status) query = query.eq('status', status);
    if (customerId) query = query.eq('lead_customer_id', customerId);
    if (opts?.departureFrom) query = query.gte('departure_date', opts.departureFrom);
    if (opts?.departureTo) query = query.lte('departure_date', opts.departureTo);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) { console.error('예약 조회 실패:', error); return []; }
}

export async function getBookingById(id: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*, customers!lead_customer_id(id,name,phone,passport_expiry), booking_passengers(customers(id,name,phone,passport_expiry,passport_no))')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  } catch (error) { console.error('예약 단건 조회 실패:', error); return null; }
}

// ── 생성 ─────────────────────────────────────────────────────

export async function createBooking(data: {
  packageId?: string; packageTitle?: string; leadCustomerId: string;
  adultCount: number; childCount: number; adultCost: number; adultPrice: number;
  childCost: number; childPrice: number; infantCount?: number; infantCost?: number; fuelSurcharge: number;
  departureDate?: string; departureRegion?: string; landOperator?: string;
  bookingDate?: string; notes?: string; passengerIds?: string[];
  status?: string;
  paidAmount?: number;
  affiliateId?: string; bookingType?: string;
  influencerCommission?: number;
  appliedTotalCommissionRate?: number;
  commissionBreakdown?: Record<string, unknown>;
  contentCreativeId?: string;
  idempotencyKey?: string;
  conversationId?: string;
  companions?: { name: string; phone?: string; passport_no?: string; passport_expiry?: string }[];
  quickCreated?: boolean; quickCreatedTxId?: string;
  depositNoticeBlocked?: boolean;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  utm_attributed_campaign_id?: string | null;
  referral_code?: string | null;
}) {
  try {
    const { initialDepositNoticeBlockedForNewBooking } = await import('@/lib/booking-automation-policy');
    let selfReferralFlag = false;
    let selfReferralReason: string | null = null;
    if (data.affiliateId) {
      const { checkSelfReferral } = await import('@/lib/affiliate/self-referral');
      const [{ data: aff }, { data: lead }] = await Promise.all([
        supabaseAdmin.from('affiliates').select('phone, email').eq('id', data.affiliateId).maybeSingle(),
        supabaseAdmin.from('customers').select('phone, email').eq('id', data.leadCustomerId).maybeSingle(),
      ]);
      const result = checkSelfReferral({
        bookingPhone: lead && typeof lead === 'object' && 'phone' in lead ? (lead as { phone?: string }).phone : undefined,
        bookingEmail: lead && typeof lead === 'object' && 'email' in lead ? (lead as { email?: string }).email : undefined,
        affiliatePhone: aff && typeof aff === 'object' && 'phone' in aff ? (aff as { phone?: string }).phone : undefined,
        affiliateEmail: aff && typeof aff === 'object' && 'email' in aff ? (aff as { email?: string }).email : undefined,
      });
      selfReferralFlag = result.flagged;
      selfReferralReason = result.reason;
    }

    const { data: booking, error } = await supabaseAdmin.from('bookings').insert([{
      package_id: data.packageId || null,
      package_title: data.packageTitle || '미정',
      lead_customer_id: data.leadCustomerId,
      adult_count: data.adultCount,
      child_count: data.childCount,
      adult_cost: data.adultCost,
      adult_price: data.adultPrice,
      child_cost: data.childCost,
      child_price: data.childPrice,
      infant_count: data.infantCount ?? 0,
      infant_cost: data.infantCost ?? 0,
      fuel_surcharge: data.fuelSurcharge,
      departure_date: data.departureDate || null,
      departure_region: data.departureRegion || null,
      land_operator: data.landOperator || null,
      booking_date: data.bookingDate || new Date().toISOString().split('T')[0],
      notes: data.notes,
      status: data.status || 'pending',
      paid_amount: data.paidAmount ?? 0,
      is_deleted: false,
      ...(data.affiliateId ? { affiliate_id: data.affiliateId, booking_type: 'AFFILIATE' } : {}),
      ...(selfReferralFlag
        ? {
            self_referral_flag: true,
            self_referral_reason: selfReferralReason,
            influencer_commission: 0,
            applied_total_commission_rate: 0,
            commission_breakdown: {
              base: 0,
              tier: 0,
              campaigns: [],
              raw_total: 0,
              cap: null,
              cap_policy_name: null,
              final_rate: 0,
              capped: false,
              self_referral: true,
              self_referral_reason: selfReferralReason,
              computed_at: new Date().toISOString(),
            },
          }
        : {
            ...(data.influencerCommission !== undefined ? { influencer_commission: data.influencerCommission } : {}),
            ...(data.appliedTotalCommissionRate !== undefined ? { applied_total_commission_rate: data.appliedTotalCommissionRate } : {}),
            ...(data.commissionBreakdown ? { commission_breakdown: data.commissionBreakdown } : {}),
          }),
      ...(data.contentCreativeId ? { content_creative_id: data.contentCreativeId } : {}),
      ...(data.idempotencyKey ? { idempotency_key: data.idempotencyKey } : {}),
      ...(data.conversationId ? { conversation_id: data.conversationId } : {}),
      ...(data.quickCreated ? { quick_created: true } : {}),
      ...(data.quickCreatedTxId ? { quick_created_tx_id: data.quickCreatedTxId } : {}),
      deposit_notice_blocked:
        data.depositNoticeBlocked ?? initialDepositNoticeBlockedForNewBooking(),
      ...(data.utm_source ? { utm_source: data.utm_source } : {}),
      ...(data.utm_medium ? { utm_medium: data.utm_medium } : {}),
      ...(data.utm_campaign ? { utm_campaign: data.utm_campaign } : {}),
      ...(data.utm_term ? { utm_term: data.utm_term } : {}),
      ...(data.utm_content ? { utm_content: data.utm_content } : {}),
      ...(data.utm_attributed_campaign_id
        ? { utm_attributed_campaign_id: data.utm_attributed_campaign_id }
        : {}),
      ...(data.referral_code ? { referral_code: data.referral_code } : {}),
    }] as unknown[]).select();
    if (error) throw error;
    const bookingId = booking?.[0]?.id;

    if (bookingId && (data.paidAmount ?? 0) > 0) {
      await supabaseAdmin.rpc('record_ledger_entry', {
        p_booking_id: bookingId,
        p_account: 'paid_amount',
        p_entry_type: 'manual_adjust',
        p_amount: data.paidAmount,
        p_source: 'admin_manual_edit',
        p_source_ref_id: bookingId,
        p_idempotency_key: `create:${bookingId}:paid`,
        p_memo: 'createBooking initial paid_amount',
        p_created_by: 'admin',
      });
    }

    const companionUUIDs: string[] = [];
    if (data.companions && data.companions.length > 0) {
      for (const c of data.companions) {
        const customer = await upsertCustomer({
          name: c.name,
          phone: c.phone,
          passport_no: c.passport_no,
          passport_expiry: c.passport_expiry,
        });
        if (customer?.id) companionUUIDs.push(customer.id);
      }
    }

    const allPassengerIds = [
      ...new Set([
        data.leadCustomerId,
        ...(data.passengerIds || []),
        ...companionUUIDs,
      ]),
    ];
    if (bookingId && allPassengerIds.length > 0) {
      const passengers = allPassengerIds.map(cid => ({
        booking_id: bookingId, customer_id: cid,
      }));
      await supabaseAdmin.from('booking_passengers').insert(passengers);
    }

    if (booking?.[0]) {
      void import('@/lib/affiliate/celebrate').then(({ notifyAffiliateOnBooking }) =>
        notifyAffiliateOnBooking(booking[0] as Parameters<typeof notifyAffiliateOnBooking>[0]),
      );
    }
    return booking?.[0];
  } catch (error) { console.error('예약 생성 실패:', error); throw error; }
}

// ── 상태 변경 ────────────────────────────────────────────────

export async function updateBookingStatus(id: string, status: string) {
  try {
    const payload: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === 'completed') payload.payment_date = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update(payload)
      .eq('id', id)
      .select('*, affiliates!affiliate_id(name, phone)');
    if (error) throw error;
    if (data?.[0]) {
      void import('@/lib/affiliate/celebrate').then(({ notifyAffiliateOnBooking }) =>
        notifyAffiliateOnBooking(data[0] as Parameters<typeof notifyAffiliateOnBooking>[0]),
      );
    }
    return data?.[0];
  } catch (error) { console.error('예약 상태 변경 실패:', error); throw error; }
}

// ── 전체 수정 ────────────────────────────────────────────────

export async function updateBooking(id: string, data: {
  packageId?: string; packageTitle?: string;
  adultCount?: number; childCount?: number;
  adultCost?: number; adultPrice?: number;
  childCost?: number; childPrice?: number;
  fuelSurcharge?: number; departureDate?: string | null;
  departureRegion?: string; landOperator?: string;
  bookingDate?: string; paidAmount?: number;
  notes?: string; status?: string;
  passengerIds?: string[];
}) {
  try {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.packageId !== undefined) payload.package_id = data.packageId || null;
    if (data.packageTitle !== undefined) payload.package_title = data.packageTitle;
    if (data.adultCount !== undefined) payload.adult_count = data.adultCount;
    if (data.childCount !== undefined) payload.child_count = data.childCount;
    if (data.adultCost !== undefined) payload.adult_cost = data.adultCost;
    if (data.adultPrice !== undefined) payload.adult_price = data.adultPrice;
    if (data.childCost !== undefined) payload.child_cost = data.childCost;
    if (data.childPrice !== undefined) payload.child_price = data.childPrice;
    if (data.fuelSurcharge !== undefined) payload.fuel_surcharge = data.fuelSurcharge;
    if (data.departureDate !== undefined) payload.departure_date = data.departureDate || null;
    if (data.departureRegion !== undefined) payload.departure_region = data.departureRegion;
    if (data.landOperator !== undefined) payload.land_operator = data.landOperator;
    if (data.bookingDate !== undefined) payload.booking_date = data.bookingDate;
    const hasPaidAmount = data.paidAmount !== undefined;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.status !== undefined) {
      payload.status = data.status;
      if (data.status === 'completed') payload.payment_date = new Date().toISOString();
    }

    const { data: booking, error } = await supabaseAdmin.from('bookings').update(payload).eq('id', id).select();
    if (error) throw error;

    if (hasPaidAmount) {
      const { error: rpcErr } = await supabaseAdmin.rpc('record_manual_paid_amount_change', {
        p_booking_id: id,
        p_new_paid_amount: data.paidAmount as number,
        p_new_total_paid_out: null,
        p_source: 'admin_manual_edit',
        p_source_ref_id: id,
        p_idempotency_key: `manual:${id}:${Date.now()}`,
        p_memo: 'updateBooking() paid_amount edit',
        p_created_by: 'admin',
      });
      if (rpcErr) throw rpcErr;
    }

    if (data.passengerIds !== undefined) {
      await supabaseAdmin.from('booking_passengers').delete().eq('booking_id', id);
      if (data.passengerIds.length > 0) {
        await supabaseAdmin.from('booking_passengers').insert(
          data.passengerIds.map(cid => ({ booking_id: id, customer_id: cid }))
        );
      }
    }

    return booking?.[0];
  } catch (error) { console.error('예약 수정 실패:', error); throw error; }
}

// ── Void 연쇄 처리 ──────────────────────────────────────────

export async function voidBooking(bookingId: string, reason?: string): Promise<void> {
  const supabase = (await import('@/lib/supabase')).getSupabase();
  if (!supabase) return;

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, margin, utm_attributed_campaign_id, affiliate_id, departure_date')
    .eq('id', bookingId)
    .single();

  if (!booking) return;
  const bk = booking as unknown as { id: string; margin?: number; utm_attributed_campaign_id?: string; affiliate_id?: string; departure_date?: string };

  await Promise.allSettled([
    supabase.from('bookings').update({
      voided_at: new Date().toISOString(),
      void_reason: reason ?? '예약 취소',
    } as never).eq('id', bookingId) as never,

    (async () => {
      if (!bk.utm_attributed_campaign_id || !bk.margin) return;
      const snapshotDate = bk.departure_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const { data: snapshot } = await supabase
        .from('ad_performance_snapshots')
        .select('attributed_bookings, attributed_margin, spend_krw')
        .eq('campaign_id', bk.utm_attributed_campaign_id)
        .eq('snapshot_date', snapshotDate)
        .single();
      if (snapshot) {
        const snap = snapshot as unknown as { attributed_bookings?: number; attributed_margin?: number; spend_krw: number };
        const newBookings = Math.max(0, (snap.attributed_bookings ?? 0) - 1);
        const newMargin = Math.max(0, (snap.attributed_margin ?? 0) - (bk.margin ?? 0));
        const newRoas = snap.spend_krw > 0
          ? Math.round((newMargin / snap.spend_krw) * 10000) / 100
          : 0;
        await supabase
          .from('ad_performance_snapshots')
          .update({
            attributed_bookings: newBookings,
            attributed_margin: newMargin,
            net_roas_pct: newRoas,
          } as never)
          .eq('campaign_id', bk.utm_attributed_campaign_id)
          .eq('snapshot_date', snapshotDate);
      }
    })(),

    (async () => {
      if (!bk.affiliate_id) return;
      const currentPeriod = new Date().toISOString().slice(0, 7);
      await supabase
        .from('settlements')
        .update({ status: 'VOID' } as never)
        .eq('affiliate_id', bk.affiliate_id)
        .eq('settlement_period', currentPeriod)
        .eq('status', 'PENDING');
    })(),

    supabase.from('audit_logs').insert({
      action: 'BOOKING_VOID',
      target_type: 'booking',
      target_id: bookingId,
      description: reason ?? '예약 취소로 인한 Void 처리',
      before_value: { margin: bk.margin, status: 'active' },
      after_value: { voided: true, reason },
    } as never),
  ]);
}

// 내부에서 createBooking이 부르는 upsertCustomer는 customers 모듈의 것을 사용
import { upsertCustomer } from './customers';
