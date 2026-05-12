// ─── Booking Tools: 고객·예약 관리 ──────────────────────────────────────────

import {
  getCustomers,
  upsertCustomer,
  createBooking,
  getBookings,
  updateBookingStatus,
  supabase,
} from '@/lib/supabase';

// ─── find_customer ────────────────────────────────────────────────────────────
export async function handleFindCustomer(args: Record<string, unknown>) {
  const { data } = await getCustomers({ search: args.name as string, page: 1, limit: 5 });
  return { result: data };
}

// ─── create_customer ──────────────────────────────────────────────────────────
export async function handleCreateCustomer(args: Record<string, unknown>) {
  try {
    const customer = await upsertCustomer({
      name: args.name as string,
      phone: args.phone as string | undefined,
      passport_expiry: args.passportExpiry as string | undefined,
    });
    return {
      result: { success: true, customer },
      action: { type: 'customer_created', data: customer },
    };
  } catch (err) {
    return {
      result: { success: false, reason: err instanceof Error ? err.message : '고객 등록 실패' },
    };
  }
}

// ─── create_booking (auto-create customer if needed, injectedContext 지원) ───
export async function handleCreateBooking(
  args: Record<string, unknown>,
  injectedContext: Record<string, string> = {}
) {
  const adultCount = (args.adultCount as number) || 1;
  const childCount = (args.childCount as number) || 0;
  const pricePerAdult = (args.pricePerAdult as number) || 0;
  const pricePerChild = (args.pricePerChild as number) || pricePerAdult;
  const packageTitle = (args.packageTitle as string | undefined) || '';

  const hasPackage = packageTitle.length > 1 && packageTitle !== '미정';
  const bookingStatus = (args.status as string) || '상담중';

  const missingFields: string[] = [];
  if (!hasPackage) missingFields.push('상품명');
  if (!args.departureDate) missingFields.push('출발일');

  // prefilledCustomerId 우선 사용 (ScreenContext에서 주입된 경우)
  const customerId = (args.customerId as string) || injectedContext.prefilledCustomerId;

  // customerId 없으면 오류
  if (!customerId) {
    return {
      result: { success: false, reason: '고객 ID가 필요합니다. find_customer 또는 create_customer를 먼저 호출하세요.' },
    };
  }

  try {
    const booking = await createBooking({
      packageId: args.packageId as string | undefined,
      packageTitle: packageTitle || '미정',
      leadCustomerId: customerId,
      adultCount,
      childCount,
      adultCost: pricePerAdult,
      adultPrice: pricePerAdult,
      childCost: pricePerChild,
      childPrice: pricePerChild,
      fuelSurcharge: 0,
      departureDate: args.departureDate as string | undefined,
      notes: args.notes as string | undefined,
      status: bookingStatus,
      paidAmount: (args.paidAmount as number) || 0,
      companions: (args.companions as {
        name: string; phone?: string; passport_no?: string; passport_expiry?: string;
      }[]) || [],
    });

    let promptMessage = '';
    if (missingFields.length > 0) {
      const paidStr = args.paidAmount
        ? `${(args.paidAmount as number).toLocaleString()}원 입금 내역 확인, `
        : '';
      promptMessage = `${paidStr}'가계약' 상태로 임시 저장했습니다. 다음 정보가 부족합니다: **${missingFields.join(', ')}**. 알려주시면 예약을 확정하겠습니다.`;
    }

    return {
      result: {
        success: missingFields.length === 0 ? true : 'partial',
        booking,
        missingFields,
        promptMessage,
      },
      action: { type: 'booking_created', data: booking },
    };
  } catch (err) {
    return {
      result: { success: false, reason: err instanceof Error ? err.message : '예약 생성 실패' },
    };
  }
}

// ─── get_bookings ─────────────────────────────────────────────────────────────
export async function handleGetBookings(
  args: Record<string, unknown>,
  injectedContext: Record<string, string> = {}
) {
  const status = args.status === 'all' ? undefined : (args.status as string | undefined);
  // prefilledCustomerId 지원
  const customerId = (args.customerId as string | undefined) || injectedContext.prefilledCustomerId;
  const bookings = await getBookings(status, customerId);
  const limit = (args.limit as number) || 10;
  return { result: bookings.slice(0, limit) };
}

// ─── update_booking ───────────────────────────────────────────────────────────
export async function handleUpdateBooking(
  args: Record<string, unknown>,
  injectedContext: Record<string, string> = {}
) {
  const bookingId = (args.bookingId as string) || injectedContext.prefilledBookingId;
  if (!bookingId) {
    return { result: { success: false, reason: '예약 ID가 필요합니다.' } };
  }
  const booking = await updateBookingStatus(bookingId, args.status as string);
  return {
    result: booking,
    action: { type: 'booking_updated', data: { bookingId, status: args.status } },
  };
}

// ─── delete_booking ───────────────────────────────────────────────────────────
export async function handleDeleteBooking(
  args: Record<string, unknown>,
  injectedContext: Record<string, string> = {}
) {
  const bookingId = (args.bookingId as string) || injectedContext.prefilledBookingId;
  if (!bookingId) {
    return { result: { success: false, reason: '예약 ID가 필요합니다.' } };
  }
  const reason = args.reason ? `[자비스 삭제] ${args.reason}` : '[자비스 삭제]';
  const { data, error } = await supabase
    .from('bookings')
    .update({ is_deleted: true, notes: reason, updated_at: new Date().toISOString() })
    .eq('id', bookingId)
    .select('id, booking_no')
    .single();

  if (error) return { result: { error: error.message } };
  return {
    result: { success: true, booking: data },
    action: {
      type: 'booking_deleted',
      data: { bookingId, bookingNo: (data as { booking_no?: string })?.booking_no },
    },
  };
}
