/**
 * Phase 3-E: package_reviews API
 *
 * POST /api/package-reviews
 *   Body: { packageId, bookingId?, customerId?, rating, content }
 *   → package_reviews INSERT
 *
 * GET /api/package-reviews?packageId=xxx
 *   → 해당 패키지의 public 리뷰 목록 반환
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { packageId, bookingId, customerId, rating, content } = body;

    if (!packageId) {
      return NextResponse.json({ error: 'packageId 필수' }, { status: 400 });
    }
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'rating 1~5 필수' }, { status: 400 });
    }

    const insertPayload: Record<string, unknown> = {
      package_id: packageId,
      rating,
      content: content ?? null,
      is_public: true,
    };
    if (bookingId) insertPayload.booking_id = bookingId;
    if (customerId) insertPayload.customer_id = customerId;

    const { data, error } = await supabaseAdmin
      .from('package_reviews')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, review_id: data?.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '리뷰 제출 실패' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ reviews: [] });
  }

  const { searchParams } = request.nextUrl;
  const packageId = searchParams.get('packageId');
  const limitParam = Math.min(50, parseInt(searchParams.get('limit') ?? '20', 10));

  try {
    let query = supabaseAdmin
      .from('package_reviews')
      .select(
        'id, package_id, booking_id, customer_id, rating, content, sentiment_score, sentiment_tags, sentiment_analyzed_at, created_at',
      )
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(limitParam);

    if (packageId) {
      query = query.eq('package_id', packageId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ reviews: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
