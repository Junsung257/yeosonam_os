import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('id, overall_rating, value_for_money, itinerary_quality, guide_quality, accommodation_quality, food_quality, title, review_text, pros, cons, helpful_count, source_type, status, created_at, customers(name)')
    .eq('package_id', id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미연결' }, { status: 503 });
  const { id: packageId } = await params;

  const body = await req.json();
  const {
    overall_rating,
    value_for_money,
    itinerary_quality,
    guide_quality,
    accommodation_quality,
    food_quality,
    title,
    review_text,
    pros,
    reviewer_name,
    source_type = 'admin_seeded',
    status = 'approved',
  } = body;

  if (!overall_rating || overall_rating < 1 || overall_rating > 5) {
    return NextResponse.json({ error: '별점(1~5)은 필수입니다' }, { status: 400 });
  }

  // admin_seeded 리뷰는 customer_id 없이 insert.
  // reviewer_name 은 customers 테이블에 임시 레코드를 만들어 FK 연결하거나,
  // 리뷰 자체에 직접 저장 (현재 스키마는 customers FK).
  // 여기서는 reviewer_name 이 있으면 dummy customer 조회 또는 생성.
  let customerId: string | null = null;
  if (reviewer_name) {
    // phone을 reviewer별 고유 sentinel로 사용 (customers.phone UNIQUE 제약 대응)
    const seededPhone = `SEEDED_${reviewer_name.replace(/\s+/g, '_').slice(0, 50)}`;
    const { data: existing } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('phone', seededPhone)
      .limit(1);

    if (existing && existing.length > 0) {
      customerId = existing[0].id;
    } else {
      const { data: created } = await supabaseAdmin
        .from('customers')
        .insert({ name: reviewer_name, phone: seededPhone, email: null })
        .select('id')
        .single();
      customerId = created?.id ?? null;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('post_trip_reviews')
    .insert({
      package_id: packageId,
      customer_id: customerId,
      booking_id: null,
      overall_rating,
      value_for_money: value_for_money || null,
      itinerary_quality: itinerary_quality || null,
      guide_quality: guide_quality || null,
      accommodation_quality: accommodation_quality || null,
      food_quality: food_quality || null,
      title: title || null,
      review_text: review_text || null,
      pros: pros && pros.length > 0 ? pros : null,
      source_type,
      status,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // travel_packages.review_count / avg_rating 갱신 트리거가 없으면 직접 계산 후 업데이트
  const { data: agg } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('overall_rating')
    .eq('package_id', packageId)
    .eq('status', 'approved');

  if (agg && agg.length > 0) {
    const avg = agg.reduce((s: number, r: { overall_rating: number | string }) => s + Number(r.overall_rating), 0) / agg.length;
    await supabaseAdmin
      .from('travel_packages')
      .update({ avg_rating: avg, review_count: agg.length })
      .eq('id', packageId);
  }

  return NextResponse.json({ id: data?.id }, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미연결' }, { status: 503 });
  const { id: packageId } = await params;
  const { reviewId, status } = await req.json();

  if (!reviewId || !status) {
    return NextResponse.json({ error: 'reviewId, status 필수' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('post_trip_reviews')
    .update({ status })
    .eq('id', reviewId)
    .eq('package_id', packageId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // avg_rating / review_count 재계산
  const { data: agg } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('overall_rating')
    .eq('package_id', packageId)
    .eq('status', 'approved');

  if (agg) {
    const avg = agg.length > 0 ? agg.reduce((s: number, r: { overall_rating: number | string }) => s + Number(r.overall_rating), 0) / agg.length : 0;
    await supabaseAdmin
      .from('travel_packages')
      .update({ avg_rating: agg.length > 0 ? avg : null, review_count: agg.length })
      .eq('id', packageId);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미연결' }, { status: 503 });
  const { id: packageId } = await params;
  const { searchParams } = req.nextUrl;
  const reviewId = searchParams.get('reviewId');
  if (!reviewId) return NextResponse.json({ error: 'reviewId 필수' }, { status: 400 });

  await supabaseAdmin
    .from('post_trip_reviews')
    .delete()
    .eq('id', reviewId)
    .eq('package_id', packageId);

  // avg_rating / review_count 재계산
  const { data: agg } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('overall_rating')
    .eq('package_id', packageId)
    .eq('status', 'approved');

  if (agg) {
    const avg = agg.length > 0 ? agg.reduce((s: number, r: { overall_rating: number | string }) => s + Number(r.overall_rating), 0) / agg.length : 0;
    await supabaseAdmin
      .from('travel_packages')
      .update({ avg_rating: agg.length > 0 ? avg : null, review_count: agg.length })
      .eq('id', packageId);
  }

  return NextResponse.json({ ok: true });
}
