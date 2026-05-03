import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/competitor-prices?destination=싱가포르
 *
 * destination 기준 경쟁사 가격 목록 + 여소남 최저가 병합 반환.
 * destination 미지정 시 전체 목록.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ data: [], yeosonamPrices: [] });
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
    let yeosonamQuery = supabaseAdmin
      .from('travel_packages')
      .select('destination, duration_days, selling_price, title')
      .eq('is_active', true)
      .not('selling_price', 'is', null)
      .order('selling_price', { ascending: true });

    if (destination) {
      yeosonamQuery = yeosonamQuery.eq('destination', destination);
    }

    const { data: yeosonamData, error: yeosonamErr } = await yeosonamQuery;
    if (yeosonamErr) throw yeosonamErr;

    // destination + duration 기준 여소남 최저가 집계
    const yeosonamMinMap: Record<string, { minPrice: number; title: string }> = {};
    for (const pkg of yeosonamData ?? []) {
      const key = `${pkg.destination}__${pkg.duration_days}`;
      const existing = yeosonamMinMap[key];
      if (!existing || pkg.selling_price < existing.minPrice) {
        yeosonamMinMap[key] = { minPrice: pkg.selling_price, title: pkg.title };
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

    return NextResponse.json({
      data: competitorData ?? [],
      yeosonamPrices,
    });
  } catch (err) {
    console.error('[competitor-prices GET] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
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
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
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
      return NextResponse.json(
        { error: 'destination, duration, competitor, price 필수' },
        { status: 400 },
      );
    }
    if (typeof price !== 'number' || price < 0) {
      return NextResponse.json({ error: 'price는 0 이상의 숫자여야 합니다' }, { status: 400 });
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

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error('[competitor-prices POST] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
