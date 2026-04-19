import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTermsForPackage, formatCancellationDates, type NoticeSurface } from '@/lib/standard-terms';

/**
 * GET /api/packages/:id/terms?surface=mobile|a4|booking_guide
 * 해당 상품의 4-level 머지된 약관을 해소하여 반환.
 * 클라이언트(예: PosterStudio)에서 A4 프리뷰 시 사용.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });
  try {
    const { id } = await params;
    const { searchParams } = request.nextUrl;
    const surface = (searchParams.get('surface') || 'mobile') as NoticeSurface;
    if (!['a4', 'mobile', 'booking_guide'].includes(surface)) {
      return NextResponse.json({ error: 'invalid surface' }, { status: 400 });
    }

    const { data: pkg, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id, product_type, land_operator_id, notices_parsed, price_dates')
      .eq('id', id)
      .limit(1);
    if (error) throw error;
    if (!pkg || pkg.length === 0) return NextResponse.json({ data: [] });

    const row = pkg[0] as {
      id: string;
      product_type: string | null;
      land_operator_id: string | null;
      notices_parsed: unknown;
      price_dates: { date: string }[] | null;
    };

    const earliestDate = (row.price_dates ?? [])
      .map(d => d.date)
      .filter(Boolean)
      .sort()[0] ?? null;

    const resolved = await resolveTermsForPackage(
      {
        id: row.id,
        product_type: row.product_type,
        land_operator_id: row.land_operator_id,
        notices_parsed: row.notices_parsed,
      },
      surface,
    );
    const notices = formatCancellationDates(resolved, earliestDate);
    return NextResponse.json({ data: notices });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '약관 해소 실패' },
      { status: 500 },
    );
  }
}
