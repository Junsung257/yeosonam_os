import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getFlightSchedule } from '@/lib/travel-providers/mrt';

/**
 * GET /api/products/flight-schedule
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const departure = searchParams.get('departure');
  const destination = searchParams.get('destination');
  const date = searchParams.get('date');
  const flightNo = searchParams.get('flightNo') ?? undefined;

  if (!departure || !destination || !date) {
    return apiResponse({ error: 'departure, destination, date 필수' }, { status: 400 });
  }

  try {
    const schedule = await getFlightSchedule(departure, destination, date, flightNo);
    if (!schedule) {
      return apiResponse({ error: '스케줄 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    return apiResponse(
      { schedule },
      {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
      },
    );
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, '조회 실패') },
      { status: 500 },
    );
  }
}
