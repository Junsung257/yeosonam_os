import { NextRequest, NextResponse } from 'next/server';
import { getBookings, getBookingById, createBooking, updateBookingStatus, updateBooking, isSupabaseConfigured, supabase, supabaseAdmin } from '@/lib/supabase';
import { sendBalanceNotice } from '@/lib/kakao';
import { matchPaymentToBookings, applyDuplicateNameGuard, classifyMatch, calcPaymentStatus } from '@/lib/payment-matcher';
import { dispatchPushAsync } from '@/lib/push-dispatcher';

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

    totalMatchedAmount += tx.amount;
  }

  // 소급 매칭된 금액이 있으면 예약 정산 상태 업데이트
  if (totalMatchedAmount > 0) {
    const paidAmount = ((booking as any).paid_amount || 0) + totalMatchedAmount;
    const newStatus  = calcPaymentStatus({
      total_price:    (booking as any).total_price,
      total_cost:     (booking as any).total_cost,
      paid_amount:    paidAmount,
      total_paid_out: (booking as any).total_paid_out || 0,
    });

    await supabase
      .from('bookings')
      .update({ paid_amount: paidAmount, payment_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', bookingId);

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

    // 어필리에이트 자동 귀속: 쿠키 또는 body에서 referral_code 확인
    const affRef = body.affiliateRef || request.cookies.get('aff_ref')?.value;
    let affData: { id: string; grade: number | null; bonus_rate: number; created_at: string | null } | null = null;
    if (affRef && !body.affiliateId) {
      try {
        const { data: aff } = await supabaseAdmin
          .from('affiliates')
          .select('id, grade, bonus_rate, created_at')
          .eq('referral_code', affRef)
          .eq('is_active', true)
          .maybeSingle();
        if (aff) {
          affData = aff;
          body.affiliateId = aff.id;
          body.bookingType = 'AFFILIATE';
          console.log(`[Affiliate] 자동 귀속: ${affRef} → ${aff.id}`);
        }
      } catch { /* 귀속 실패해도 예약은 진행 */ }
    } else if (body.affiliateId) {
      // body에 직접 affiliateId만 들어온 경우에도 등급 정보 확보
      try {
        const { data: aff } = await supabaseAdmin
          .from('affiliates')
          .select('id, grade, bonus_rate, created_at')
          .eq('id', body.affiliateId)
          .eq('is_active', true)
          .maybeSingle();
        if (aff) affData = aff;
      } catch { /* */ }
    }

    // 커미션 자동계산 — 가산식 정책 엔진 + 예약 시점 스냅샷 (ERR-방지)
    //   final = 상품기본률 + 등급보너스 + Σ캠페인 ↓ min(글로벌 캡)
    //   surcharge 제외, 순수 상품가 기준
    if (body.affiliateId && affData) {
      const { applyCommissionPolicies } = await import('@/lib/policy-engine');

      // 상품 기본 커미션율 + 메타 조회 (목적지 필터용)
      let baseRate = 0.02;
      let destination: string | undefined;
      if (body.packageId) {
        try {
          const { data: pkg } = await supabaseAdmin
            .from('travel_packages')
            .select('affiliate_commission_rate, destination')
            .eq('id', body.packageId)
            .maybeSingle();
          if (pkg) {
            const r = Number(pkg.affiliate_commission_rate);
            if (Number.isFinite(r) && r >= 0) baseRate = r;
            destination = pkg.destination as string | undefined;
          }
        } catch { /* fallback to default 2% */ }
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

      // 랜드사/출발지 텍스트 이름 조회 (3단 연쇄 자동완성용)
      let landOpName: string | null = null;
      let depLocName: string | null = null;
      if ((product as any).land_operator_id) {
        const { data: lo } = await supabaseAdmin
          .from('land_operators')
          .select('name')
          .eq('id', (product as any).land_operator_id)
          .maybeSingle();
        landOpName = (lo as any)?.name ?? null;
      }
      if ((product as any).departing_location_id) {
        const { data: dl } = await supabaseAdmin
          .from('departing_locations')
          .select('name')
          .eq('id', (product as any).departing_location_id)
          .maybeSingle();
        depLocName = (dl as any)?.name ?? null;
      }

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

    // paid_amount 변경 시 payment_status 자동 계산 및 완납이면 status도 completed로
    if (typeof body.paid_amount === 'number') {
      const { data: current } = await supabase
        .from('bookings')
        .select('total_price, status')
        .eq('id', id)
        .single();

      const totalPrice = (current as { total_price?: number } | null)?.total_price ?? 0;
      const newPaidAmount = body.paid_amount;
      const newPaymentStatus =
        newPaidAmount >= totalPrice && totalPrice > 0 ? '완납'
        : newPaidAmount > 0 ? '일부입금'
        : '미입금';
      const newStatus =
        newPaidAmount >= totalPrice && totalPrice > 0 ? 'completed'
        : (current as { status?: string } | null)?.status;

      const { data, error } = await supabase
        .from('bookings')
        .update({
          paid_amount: newPaidAmount,
          payment_status: newPaymentStatus,
          ...(newStatus ? { status: newStatus } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
