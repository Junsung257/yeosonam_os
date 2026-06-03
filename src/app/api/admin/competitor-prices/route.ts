import { type NextRequest, type NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { withAdminGuard } from '@/lib/admin-guard';
import { logError } from '@/lib/sentry-logger';
import { apiResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/competitor-prices?destination=싱가포르
 *
 * destination 기준 경쟁사 가격 목록 + 여소남 최저가 병합 반환.
 * destination 미지정 시 전체 목록.
 */
const getHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ data: [], yeosonamPrices: [] });
  }

  try {
    const { searchParams } = request.nextUrl;
    const destination = searchParams.get('destination');

    // 경쟁사 가격 조회
    let competitorQuery = supabaseAdmin
      .from('competitor_prices')
      .select('*')
      .order('recorded_at', { ascending: false });

    if (destination) {
      competitorQuery = competitorQuery.eq('destination', destination);
    }

    const { data: competitorData, error: competitorErr } = await competitorQuery;
    if (competitorErr) throw competitorErr;

    // 여소남 최저가 병합 (travel_packages에서 destination + duration 기준)
    // 실제 컬럼: status (active 식별), price (정수), duration (정수). selling_price·is_active·duration_days 는 없음.
    let yeosonamQuery = supabaseAdmin
      .from('travel_packages')
      .select('destination, duration, price, title, status')
      .in('status', ['active', 'published', 'approved'])
      .not('price', 'is', null)
      .order('price', { ascending: true });

    if (destination) {
      yeosonamQuery = yeosonamQuery.eq('destination', destination);
    }

    const { data: yeosonamData, error: yeosonamErr } = await yeosonamQuery;
    if (yeosonamErr) throw yeosonamErr;

    // destination + duration 기준 여소남 최저가 집계
    const yeosonamMinMap: Record<string, { minPrice: number; title: string }> = {};
    for (const pkg of (yeosonamData ?? []) as Array<{ destination: string | null; duration: number | null; price: number | null; title: string }>) {
      if (!pkg.destination || pkg.duration == null || pkg.price == null) continue;
      const key = `${pkg.destination}__${pkg.duration}`;
      const existing = yeosonamMinMap[key];
      if (!existing || pkg.price < existing.minPrice) {
        yeosonamMinMap[key] = { minPrice: pkg.price, title: pkg.title };
      }
    }

    const yeosonamPrices = Object.entries(yeosonamMinMap).map(([key, val]) => {
      const [dest, days] = key.split('__');
      return {
        destination: dest,
        duration_days: Number(days),
        min_price: val.minPrice,
        title: val.title,
      };
    });

    return apiResponse({
      data: competitorData ?? [],
      yeosonamPrices,
    });
  } catch (err) {
    logError('[competitor-prices] GET failed', err);
    return apiResponse(
      { error: logAndSanitize('admin-competitor-prices', err, '처리 실패') },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/competitor-prices
 *
 * 새 경쟁사 가격 입력.
 * Body: { destination, duration, competitor, price, departureDate?, sourceUrl?, recordedBy? }
 */
const postHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { destination, duration, competitor, price, departureDate, sourceUrl, recordedBy } =
      body as {
        destination?: string;
        duration?: string;
        competitor?: string;
        price?: number;
        departureDate?: string;
        sourceUrl?: string;
        recordedBy?: string;
      };

    if (!destination || !duration || !competitor || price == null) {
      return apiResponse(
        { error: 'destination, duration, competitor, price 필수' },
        { status: 400 },
      );
    }
    if (typeof price !== 'number' || price < 0) {
      return apiResponse({ error: 'price는 0 이상의 숫자여야 합니다' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('competitor_prices')
      .insert({
        destination,
        duration,
        competitor,
        price,
        departure_date: departureDate ?? null,
        source_url: sourceUrl ?? null,
        recorded_by: recordedBy ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;

    return apiResponse({ ok: true, data });
  } catch (err) {
    logError('[competitor-prices] POST failed', err);
    return apiResponse(
      { error: logAndSanitize('admin-competitor-prices', err, '처리 실패') },
      { status: 500 },
    );
  }
}

export const GET = withAdminGuard(getHandler);

export const POST = withAdminGuard(postHandler);
