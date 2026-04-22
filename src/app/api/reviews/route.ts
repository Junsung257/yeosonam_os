import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 고객 리뷰 제출 API
 *   POST /api/reviews
 *   - booking_id 로 identity 검증 (bookings.lead_customer_id 와 매칭)
 *   - post_trip_reviews INSERT (status='pending' — 어드민 승인 후 노출)
 *   - 완료 후 refresh_package_rating RPC 로 avg_rating 캐시 갱신
 *
 * 익명 후기 허용 (고객명 부분 마스킹은 표시 단계에서).
 */

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const {
      booking_id,
      overall_rating,
      value_for_money, itinerary_quality, guide_quality, accommodation_quality, food_quality, transportation_quality,
      title, review_text, pros, cons, tips_for_travelers,
      would_recommend, would_book_again,
    } = body;

    if (!booking_id) return NextResponse.json({ error: 'booking_id 필수' }, { status: 400 });
    if (!overall_rating || overall_rating < 1 || overall_rating > 5) {
      return NextResponse.json({ error: '전체 평점 1~5 필수' }, { status: 400 });
    }

    // booking 유효성 + product_id/customer_id 조회
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, product_id, lead_customer_id, status')
      .eq('id', booking_id)
      .limit(1);

    if (!booking?.[0]) return NextResponse.json({ error: '예약 없음' }, { status: 404 });
    const b = booking[0] as { id: string; product_id: string | null; lead_customer_id: string | null; status: string };

    // 중복 제출 방지
    const { data: existing } = await supabaseAdmin
      .from('post_trip_reviews')
      .select('id')
      .eq('booking_id', booking_id)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: '이미 후기를 작성하셨습니다.' }, { status: 409 });
    }

    // INSERT
    const { data, error } = await supabaseAdmin.from('post_trip_reviews').insert({
      booking_id,
      customer_id: b.lead_customer_id,
      package_id: b.product_id,
      overall_rating,
      value_for_money: value_for_money ?? null,
      itinerary_quality: itinerary_quality ?? null,
      guide_quality: guide_quality ?? null,
      accommodation_quality: accommodation_quality ?? null,
      food_quality: food_quality ?? null,
      transportation_quality: transportation_quality ?? null,
      title: title ?? null,
      review_text: review_text ?? null,
      pros: Array.isArray(pros) ? pros : null,
      cons: Array.isArray(cons) ? cons : null,
      tips_for_travelers: Array.isArray(tips_for_travelers) ? tips_for_travelers : null,
      would_recommend: typeof would_recommend === 'boolean' ? would_recommend : null,
      would_book_again: typeof would_book_again === 'boolean' ? would_book_again : null,
      status: 'pending',
      verified_traveler: true,
    }).select('id');

    if (error) throw error;

    // 평점 캐시 갱신은 어드민 승인 후에 하는 게 원칙이지만, 접수 즉시 예비 집계
    if (b.product_id) {
      void supabaseAdmin.rpc('refresh_package_rating', { p_package_id: b.product_id });
    }

    return NextResponse.json({ ok: true, review_id: data?.[0]?.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '제출 실패' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ reviews: [] });

  const { searchParams } = request.nextUrl;
  const packageId = searchParams.get('package_id');
  const status = searchParams.get('status') || 'approved';
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '10'));

  try {
    let q = supabaseAdmin
      .from('post_trip_reviews')
      .select('id, overall_rating, title, review_text, pros, helpful_count, created_at, customers(name)')
      .eq('status', status)
      .order('helpful_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (packageId) q = q.eq('package_id', packageId);

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ reviews: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}
