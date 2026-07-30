import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import {
  getRecognizedRevenueMonthly,
  getNewBookingsMonthly,
  getBookingPaceAndCancellation,
  isSupabaseAdminConfigured,
} from '@/lib/supabase';
import { apiResponse } from '@/lib/api-response';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) {
    return apiResponse(
      { error: 'Supabase admin connection is not configured.', recognized: [], newBookings: [], pace: [], cancellation_90d: null },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
  const { searchParams } = new URL(request.url);
  const requestedMonths = Number.parseInt(searchParams.get('months') || '6', 10);
  const months = Number.isFinite(requestedMonths) ? Math.min(24, Math.max(1, requestedMonths)) : 6;

  try {
    const [recognized, newBookings, paceAndCancel] = await Promise.all([
      getRecognizedRevenueMonthly(months),
      getNewBookingsMonthly(months),
      getBookingPaceAndCancellation(),
    ]);
    return apiResponse(
      {
        recognized,
        newBookings,
        pace: paceAndCancel.pace,
        cancellation_90d: paceAndCancel.cancellation_90d,
        data_status: 'ok',
      },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (err) {
    console.error('[dashboard/revenue-recognition] source unavailable', err);
    return apiResponse(
      {
        recognized: [],
        newBookings: [],
        pace: [],
        cancellation_90d: null,
        data_status: 'unavailable',
        status_detail: '매출 인식 데이터 소스가 아직 활성화되지 않았습니다.',
      },
      { status: 206, headers: PRIVATE_NO_STORE },
    );
  }
};

export const dynamic = 'force-dynamic';
export const GET = withAdminGuard(getHandler);
