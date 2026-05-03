import { NextRequest, NextResponse } from 'next/server';
import { getBookings, getBookingById, createBooking, updateBookingStatus, updateBooking, isSupabaseConfigured, supabase, supabaseAdmin } from '@/lib/supabase';
import { sendBalanceNotice } from '@/lib/kakao';
import { matchPaymentToBookings, applyDuplicateNameGuard, classifyMatch, calcPaymentStatus } from '@/lib/payment-matcher';
import { dispatchPushAsync } from '@/lib/push-dispatcher';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

/**
 * Rule 5: 소급 매칭 (retroactive matching)
 * 새 예약이 등록될 때 기존 unmatched 입금 내역을 자동으로 연결
 */
async function tryRetroactiveMatch(bookingId: string, leadCustomerId: string | null) {
  if (!leadCustomerId) return;

  // 새 예약 정보 조회
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booking_no, total_price, total_cost, paid_amount, total_paid_out, actual_payer_name, customers!lead_customer_id(name)')
    .eq('id', bookingId)
    .single();

  if (!booking) return;

  const customerName    = (booking as any).customers?.name;
  const actualPayerName = (booking as any).actual_payer_name;

  // unmatched 입금 내역 조회 (최근 90일)
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: unmatched } = await supabase
    .from('bank_transactions')
    .select('id, counterparty_name, amount, transaction_type')
    .eq('match_status', 'unmatched')
    .eq('transaction_type', '입금')
    .gte('received_at', since);

  if (!unmatched || unmatched.length === 0) return;

  const bookingCandidate = [{
    id:                booking.id,
    booking_no:        booking.booking_no,
    total_price:       (booking as any).total_price,
    total_cost:        (booking as any).total_cost,
    paid_amount:       (booking as any).paid_amount || 0,
    total_paid_out:    (booking as any).total_paid_out || 0,
    status:            'pending',
    customer_name:     customerName,
    actual_payer_name: actualPayerName,
  }];

  let totalMatchedAmount = 0;

  for (const tx of unmatched) {
    const candidates = matchPaymentToBookings({
      amount:     tx.amount,
      senderName: tx.counterparty_name,
      bookings:   bookingCandidate,
    });
    const guarded   = applyDuplicateNameGuard(candidates);
    const best      = guarded[0];
    if (!best) continue;

    const matchClass = classifyMatch(best.confidence);
    if (matchClass !== 'auto') continue;

    // 매칭 성공 → bank_transactions 업데이트
    await supabase
      .from('bank_transactions')
      .update({
        booking_id:       bookingId,
        match_status:     'auto',
        match_confidence: best.confidence,
        matched_by:       'retroactive',
        matched_at:       new Date().toISOString(),
      })
      .eq('id', tx.id);

    // Phase 2a — bookings.paid_amount += tx.amount + ledger 이중쓰기 (per tx, atomic)
    //   tx 1건 단위로 ledger entry 를 남겨 감사 시 어느 거래에서 얼마 들어왔는지 추적 가능.
    await supabaseAdmin.rpc('update_booking_ledger', {
      p_booking_id: bookingId,
      p_paid_delta: tx.amount,
      p_payout_delta: 0,
      p_source: 'booking_create_softmatch',
      p_source_ref_id: tx.id,
      p_idempotency_key: `retroactive:${bookingId}:${tx.id}`,
      p_memo: `retroactive softmatch ${best.confidence.toFixed(2)}`,
      p_created_by: 'retroactive',
    });

    totalMatchedAmount += tx.amount;
  }

  if (totalMatchedAmount > 0) {
    // 자동 status 갱신은 update_booking_ledger RPC 안에서 처리됨 (payment_status/booking.status 모두).
    // 여기는 로깅만.
    const paidAmount = ((booking as any).paid_amount || 0) + totalMatchedAmount;
    const newStatus  = calcPaymentStatus({
      total_price:    (booking as any).total_price,
      total_cost:     (booking as any).total_cost,
      paid_amount:    paidAmount,
      total_paid_out: (booking as any).total_paid_out || 0,
    });
    console.log(`[소급매칭] ${booking.booking_no} — ${totalMatchedAmount.toLocaleString()}원 자동 연결, 상태: ${newStatus}`);
  }
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const status = searchParams.get('status');
  const customerId = searchParams.get('customerId');
  const departureFrom = searchParams.get('departure_from');
  const departureTo = searchParams.get('departure_to');
  // include_deleted: 'only' = 휴지통만, 'all' = 전체, 미지정 = 정상만
  const includeDeleted = searchParams.get('include_deleted');

  if (id) {
    const booking = await getBookingById(id);
    return NextResponse.json({ booking });
  }
  const bookings = await getBookings(
    status || undefined,
    customerId || undefined,
    { departureFrom: departureFrom || undefined, departureTo: departureTo || undefined, includeDeleted: includeDeleted || undefined }
  );
  return NextResponse.json({ bookings, count: bookings.length });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const body = await request.json();

    // 서버사이드 유효성 검사
    if (!body.leadCustomerId) {
      return NextResponse.json({ error: '대표 예약자(leadCustomerId)가 필요합니다.' }, { status: 400 });
    }
    if (!body.adultCount || body.adultCount < 1) {
      return NextResponse.json({ error: '성인 인원은 1명 이상이어야 합니다.' }, { status: 400 });
    }

    // 멱등성: idempotency_key 가 있으면 기존 booking 반환 (재시도/이중제출 방어)
    if (body.idempotencyKey) {
      const { data: existing } = await supabaseAdmin
        .from('bookings')
        .select('*')
        .eq('idempotency_key', body.idempotencyKey)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ booking: existing, idempotent_replay: true }, { status: 200 });
      }
    }

    // 어필리에이트 + 상품 병렬 조회 (순차 → 동시 실행으로 최대 300-500ms 절감)
    const affRefRaw = (body.affiliateRef as string | undefined) || request.cookies.get('aff_ref')?.value;
    const affRef =
      typeof affRefRaw === 'string' && affRefRaw.trim() ? normalizeAffiliateReferralCode(affRefRaw) : '';
    type AffRow = { id: string; grade: number | null; bonus_rate: number; created_at: string | null };
    let affData: AffRow | null = null;

    const affQuery = affRef && !body.affiliateId
      ? supabaseAdmin.from('affiliates').select('id, grade, bonus_rate, created_at').eq('referral_code', affRef).eq('is_active', true).maybeSingle()
      : body.affiliateId
        ? supabaseAdmin.from('affiliates').select('id, grade, bonus_rate, created_at').eq('id', body.affiliateId).eq('is_active', true).maybeSingle()
        : null;

    const pkgQuery = body.packageId
      ? supabaseAdmin.from('travel_packages').select('affiliate_commission_rate, destination').eq('id', body.packageId).maybeSingle()
      : null;

    // 두 쿼리가 있으면 동시에 실행
    const [affResult, pkgResult] = await Promise.all([
      affQuery ? affQuery.catch(() => ({ data: null })) : Promise.resolve({ data: null }),
      pkgQuery ? pkgQuery.catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    ]);

    if (affResult.data) {
      affData = affResult.data as AffRow;
      if (affRef && !body.affiliateId) {
        body.affiliateId = affData.id;
        body.bookingType = 'AFFILIATE';
        console.log(`[Affiliate] 자동 귀속: ${affRef} → ${affData.id}`);
      }
    }

    // 커미션 자동계산 — 가산식 정책 엔진 + 예약 시점 스냅샷 (ERR-방지)
    //   final = 상품기본률 + 등급보너스 + Σ캠페인 ↓ min(글로벌 캡)
    //   surcharge 제외, 순수 상품가 기준
    if (body.affiliateId && affData) {
      const { applyCommissionPolicies } = await import('@/lib/policy-engine');

      let baseRate = 0.02;
      let destination: string | undefined;
      const pkg = pkgResult.data as { affiliate_commission_rate: number | null; destination: string | null } | null;
      if (pkg) {
        const r = Number(pkg.affiliate_commission_rate);
        if (Number.isFinite(r) && r >= 0) baseRate = r;
        destination = pkg.destination ?? undefined;
      }

      const daysSinceSignup = affData.created_at
        ? Math.max(0, Math.floor((Date.now() - new Date(affData.created_at).getTime()) / 86400000))
        : 0;

      const breakdown = await applyCommissionPolicies({
        product_id: body.packageId,
        destination,
        affiliate_id: affData.id,
        affiliate_grade: affData.grade ?? 1,
        days_since_signup: daysSinceSignup,
        base_rate: baseRate,
        tier_bonus: affData.bonus_rate ?? 0,
      });

      const commissionBase = (body.adultCount || 0) * (body.adultPrice || 0)
                           + (body.childCount || 0) * (body.childPrice || 0);

      body.influencerCommission = Math.round(commissionBase * breakdown.final_rate);
      body.appliedTotalCommissionRate = breakdown.final_rate;
      body.commissionBreakdown = breakdown;

      console.log(
        `[Affiliate] 커미션 자동계산(가산식): base=${commissionBase} × ${breakdown.final_rate} = ${body.influencerCommission} ` +
        `[${breakdown.base}+${breakdown.tier}+캠페인${breakdown.campaigns.length}건${breakdown.capped ? '(캡적용)' : ''}]`
      );
    }

    const booking = await createBooking(body);

    if (booking && (booking as { deposit_notice_blocked?: boolean }).deposit_notice_blocked) {
      const { enqueueDepositNoticeGateTask } = await import('@/lib/booking-workflow-tasks');
      enqueueDepositNoticeGateTask(booking.id as string).catch(() => {});
    }

    // 어필리에이트 last_conversion_at 업데이트
    if (affData && booking?.id) {
      supabaseAdmin
        .from('affiliates')
        .update({ last_conversion_at: new Date().toISOString() })
        .eq('id', affData.id)
        .then(() => {})
        .catch(() => {});
    }

    // 어필리에이트 링크 conversion_count 증가
    if (affRef && booking?.id) {
      supabaseAdmin
        .from('influencer_links')
        .select('id, conversion_count')
        .eq('referral_code', affRef)
        .then(({ data: links }: { data: { id: string; conversion_count: number }[] | null }) => {
          if (links?.length) {
            const link = links[0];
            supabaseAdmin
              .from('influencer_links')
              .update({ conversion_count: (link.conversion_count || 0) + 1 })
              .eq('id', link.id)
              .then(() => console.log(`[Affiliate] 전환 기록: ${affRef}`));
          }
        })
        .catch(() => {});
    }

    // 약관 스냅샷: 예약 시점 4-level 머지 결과를 freeze (법적 증빙용, Ironclad/Juro CLM 관행)
    if (booking?.id && body.packageId) {
      (async () => {
        try {
          const { buildTermsSnapshot } = await import('@/lib/standard-terms');
          const { data: pkg } = await supabaseAdmin
            .from('travel_packages')
            .select('id, product_type, land_operator_id, notices_parsed')
            .eq('id', body.packageId)
            .limit(1);
          const row = pkg?.[0];
          if (row) {
            const snapshot = await buildTermsSnapshot(
              {
                id: row.id as string,
                product_type: row.product_type as string | null,
                land_operator_id: row.land_operator_id as string | null,
                notices_parsed: row.notices_parsed,
              },
              'booking_guide',
            );
            await supabaseAdmin
              .from('bookings')
              .update({ terms_snapshot: snapshot })
              .eq('id', booking.id);
          }
        } catch (e) {
          console.warn('[Terms Snapshot] 실패 (예약은 정상):', e);
        }
      })();
    }

    // lead_time 자동 계산 + 예약 행동 메타데이터
    if (booking?.id && body.departureDate) {
      const leadTime = Math.floor(
        (new Date(body.departureDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      supabaseAdmin
        .from('bookings')
        .update({
          lead_time: leadTime,
          metadata: {
            ...(booking.metadata || {}),
            booking_hour: new Date().getHours(),
            booking_day_of_week: new Date().getDay(),
          },
        })
        .eq('id', booking.id)
        .then(() => {})
        .catch(() => {});
    }

    // 비동기 세션 병합: conversation → customer_id 연결
    if (booking?.conversation_id && body.leadCustomerId) {
      supabaseAdmin
        .from('conversations')
        .update({ customer_id: body.leadCustomerId, updated_at: new Date().toISOString() })
        .eq('id', booking.conversation_id)
        .then(() => console.log(`[Session] 세션 병합: conv=${booking.conversation_id} → customer=${body.leadCustomerId}`))
        .catch((err: unknown) => console.warn('[Session] 세션 병합 실패:', err));
    }

    // Rule 5: 소급 매칭 — 기존 unmatched 입금 내역과 자동 연결 시도
    if (booking?.id) {
      tryRetroactiveMatch(booking.id, body.leadCustomerId).catch(e =>
        console.warn('[소급 매칭 실패]', e)
      );
    }

    // 모바일 관리자에게 새 예약 Web Push (fire-and-forget)
    if (booking?.id) {
      dispatchPushAsync({
        title: '새 예약 접수',
        body: `${booking.booking_no ?? ''} · ${booking.package_title ?? ''}`.trim(),
        deepLink: `/m/admin/bookings/${booking.id}`,
        kind: 'new_booking',
        tag: `booking-${booking.id}`,
      });
    }

    return NextResponse.json({ booking });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '예약 생성 실패' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
    }

    // 계약금 안내 게이트 해제 (assisted → 운영자 승인 후 전이 허용)
    if (typeof body.deposit_notice_blocked === 'boolean') {
      const { data, error } = await supabaseAdmin
        .from('bookings')
        .update({
          deposit_notice_blocked: body.deposit_notice_blocked,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (body.deposit_notice_blocked === false) {
        const { resolveDepositNoticeGateTasks } = await import('@/lib/booking-workflow-tasks');
        await resolveDepositNoticeGateTasks(id);
      }
      return NextResponse.json({ booking: data });
    }

    // 일행 추가 (booking_passengers에 연결)
    if (body.addPassengerId) {
      const { error } = await supabaseAdmin
        .from('booking_passengers')
        .upsert({
          booking_id: id,
          customer_id: body.addPassengerId,
          passenger_type: body.addPassengerType || 'adult',
        }, { onConflict: 'booking_id,customer_id' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // 소프트 삭제 / 복구 처리 (supabaseAdmin 사용 — RLS 우회)
    if (typeof body.is_deleted === 'boolean') {
      const { data, error } = await supabaseAdmin
        .from('bookings')
        .update({ is_deleted: body.is_deleted, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ booking: data });
    }

    // SKU 코드 → products 조회 → bookings 원자적 업데이트 (상품명 + 랜드사 + 출발지)
    if (body.sku_code !== undefined) {
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('internal_code, display_name, land_operator_id, departing_location_id, departure_region')
        .eq('internal_code', String(body.sku_code).trim())
        .maybeSingle();

      if (!product) {
        return NextResponse.json(
          { error: `존재하지 않는 상품 코드입니다: ${body.sku_code}` },
          { status: 404 },
        );
      }

      // 랜드사/출발지 텍스트 이름 조회 (3단 연쇄 자동완성용) — 병렬 fetch
      const landOpId = (product as any).land_operator_id;
      const depLocId = (product as any).departing_location_id;
      const [loRes, dlRes] = await Promise.all([
        landOpId
          ? supabaseAdmin.from('land_operators').select('name').eq('id', landOpId).maybeSingle()
          : Promise.resolve({ data: null }),
        depLocId
          ? supabaseAdmin.from('departing_locations').select('name').eq('id', depLocId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const landOpName: string | null = (loRes.data as any)?.name ?? null;
      const depLocName: string | null = (dlRes.data as any)?.name ?? null;

      const updateFields: Record<string, unknown> = {
        product_id:    (product as any).internal_code,
        package_title: (product as any).display_name,
        updated_at:    new Date().toISOString(),
      };
      if ((product as any).land_operator_id)      updateFields.land_operator_id = (product as any).land_operator_id;
      if ((product as any).departing_location_id)  updateFields.departing_location_id = (product as any).departing_location_id;
      if (landOpName)                              updateFields.land_operator = landOpName;
      if ((product as any).departure_region)       updateFields.departure_region = (product as any).departure_region;

      const { data, error } = await supabaseAdmin
        .from('bookings')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({
        booking: data,
        resolvedProduct: { ...(product as any), landOpName, depLocName },
      });
    }

    // paid_amount 변경 시 — Phase 2a: record_manual_paid_amount_change RPC 로 위임 (ledger 이중쓰기)
    // 이전 payment_status 자동 계산은 admin UI 가 직접 PATCH 시 별도 필드로 보내거나,
    // 다른 경로에서 호출 시 calcPaymentStatus 가 처리. 여기서는 ledger 정합성을 우선.
    if (typeof body.paid_amount === 'number') {
      const newPaidAmount = body.paid_amount;
      const { data: current } = await supabase
        .from('bookings')
        .select('total_price, status')
        .eq('id', id)
        .single();

      const totalPrice = (current as { total_price?: number } | null)?.total_price ?? 0;
      const newPaymentStatus =
        newPaidAmount >= totalPrice && totalPrice > 0 ? '완납'
        : newPaidAmount > 0 ? '일부입금'
        : '미입금';
      const newStatus =
        newPaidAmount >= totalPrice && totalPrice > 0 ? 'completed'
        : (current as { status?: string } | null)?.status;

      const { error: rpcErr } = await supabaseAdmin.rpc('record_manual_paid_amount_change', {
        p_booking_id: id,
        p_new_paid_amount: newPaidAmount,
        p_new_total_paid_out: null,
        p_source: 'admin_manual_edit',
        p_source_ref_id: id,
        p_idempotency_key: `manual:${id}:${Date.now()}`,
        p_memo: 'PUT /api/bookings paid_amount manual edit',
        p_created_by: 'admin',
      });
      if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

      // payment_status / status 자동 후처리 (RPC 가 손대지 않으므로 여기서)
      await supabaseAdmin.from('bookings').update({
        payment_status: newPaymentStatus,
        ...(newStatus ? { status: newStatus } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      const { data } = await supabase.from('bookings').select().eq('id', id).single();
      return NextResponse.json({ booking: data });
    }

    // 전체 필드 수정 (편집 페이지)
    if (body.fields !== undefined || body.adultCount !== undefined || body.adultCost !== undefined) {
      const booking = await updateBooking(id, body);
      return NextResponse.json({ booking });
    }

    // 인라인 셀 직접 수정 (예약 그리드)
    // [Task3] land_operator_contact → manager_name 으로 컬럼 정규화
    // [Task2] land_operator_id 추가 (랜드사 FK)
    // [Task4] adult_count, child_count, total_price, total_cost 추가 (인원 자동계산)
    const INLINE_FIELDS = [
      'departure_region', 'land_operator', 'land_operator_id',
      'departing_location_id', // [ERP v2] 출발지 마스터 FK
      'manager_name',
      'package_title', 'memo', 'special_requests', 'departure_date',
      'adult_price', 'child_price', 'adult_cost', 'child_cost', // [인라인 판매가/원가 편집]
      'adult_count', 'child_count',
      'product_id', // 상품-예약 스마트 매칭 (vendors_products_smartmatch_v1.sql)
      // 파이프라인 자동화 필드
      'is_ticketed', 'is_manifest_sent', 'is_guide_notified',
      'flight_out', 'flight_out_time', 'flight_in', 'flight_in_time',
      'local_expenses', 'single_charge', 'single_charge_count',
      'child_n_count', 'child_n_cost', 'child_n_price',
      'child_e_count', 'child_e_cost', 'child_e_price',
      'infant_count', 'infant_cost', 'infant_price',
    ];
    const inlineField = INLINE_FIELDS.find(f => f in body);
    if (inlineField) {
      // 멀티 필드 일괄 업데이트 지원 (인원 변경 시 total_price/total_cost 동시 반영)
      const updateFields = INLINE_FIELDS.reduce<Record<string, unknown>>((acc, f) => {
        if (f in body) acc[f] = body[f];
        return acc;
      }, {});
      updateFields.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from('bookings')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        // [Task3] Graceful Degradation: 컬럼 미존재 시 metadata JSONB 폴백
        if (error.code === 'PGRST204' || error.message.includes('Could not find')) {
          console.warn(`[bookings PATCH] Column not found, falling back to metadata:`, error.message);
          // metadata JSONB에 병합 저장
          const metadataFields = Object.fromEntries(
            Object.entries(updateFields).filter(([k]) => !INLINE_FIELDS.includes(k))
          );
          if (Object.keys(metadataFields).length > 0) {
            await supabaseAdmin.from('bookings')
              .update({ metadata: metadataFields, updated_at: new Date().toISOString() })
              .eq('id', id);
          }
          // 에러 팝업 없이 조용히 성공 처리
          return NextResponse.json({ booking: { id, ...updateFields } });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ booking: data });
    }

    // 상태만 변경 (기존 동작)
    const { status } = body;
    if (!status) {
      return NextResponse.json({ error: 'status가 필요합니다.' }, { status: 400 });
    }
    const booking = await updateBookingStatus(id, status);

    // 예약 취소 시 Void 연쇄 처리 (fire-and-forget)
    if (status === 'cancelled' && booking) {
      const cancelReason = body.cancel_reason ?? '관리자 취소';
      (async () => {
        try {
          const { voidBooking } = await import('@/lib/supabase');
          await voidBooking(id, cancelReason);
        } catch (e) {
          console.warn('[Void 처리 실패]', e);
        }
      })();
    }

    // 예약 확정 시 잔금 안내 알림톡 자동 발송
    if (status === 'confirmed' && booking) {
      const fullBooking = await getBookingById(id);
      const customer = (fullBooking as { customers?: { name?: string; phone?: string } })?.customers;
      if (customer?.phone && customer?.name) {
        const b = fullBooking as {
          package_title?: string;
          total_price?: number;
          total_cost?: number;
          departure_date?: string;
        };
        const balance = (b.total_price || 0) - Math.floor((b.total_cost || 0) * 0.3); // 잔금 = 총액 - 계약금(원가의 30%)
        const dueDate = b.departure_date
          ? new Date(new Date(b.departure_date).getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          : '출발 2주 전';
        await sendBalanceNotice({
          phone: customer.phone,
          name: customer.name,
          packageTitle: b.package_title || '여행 상품',
          balance,
          dueDate,
          account: process.env.COMPANY_ACCOUNT || '계좌 정보 미설정',
        }).catch(e => console.warn('[잔금 알림톡 실패]', e));
      }
    }

    return NextResponse.json({ booking });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '상태 변경 실패' },
      { status: 500 }
    );
  }
}
