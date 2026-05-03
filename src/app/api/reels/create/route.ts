import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface ReelPhoto {
  url: string;
  caption?: string;
}

interface CreateReelBody {
  bookingId: string;
  photos: ReelPhoto[];
  destination?: string;
  templateId?: string;
}

/**
 * POST /api/reels/create
 *
 * 여행 사진 5장으로 릴스 템플릿 레코드를 생성하고 공유 링크를 반환합니다.
 * 인증 불필요 — booking_id만으로 접근 (매직링크 기반 고객 호출).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body: CreateReelBody = await request.json();
    const { bookingId, photos, destination, templateId } = body;

    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId 필수' }, { status: 400 });
    }
    if (!Array.isArray(photos) || photos.length === 0) {
      return NextResponse.json({ error: 'photos 배열이 비어있습니다' }, { status: 400 });
    }
    if (photos.length > 10) {
      return NextResponse.json({ error: '사진은 최대 10장까지 가능합니다' }, { status: 400 });
    }

    // booking 존재 확인 + customer_id 추출
    const { data: bookingRows, error: bookingErr } = await supabaseAdmin
      .from('bookings')
      .select('id, lead_customer_id, destination')
      .eq('id', bookingId)
      .limit(1);

    if (bookingErr) throw bookingErr;
    if (!bookingRows || bookingRows.length === 0) {
      return NextResponse.json({ error: '예약을 찾을 수 없습니다' }, { status: 404 });
    }

    const booking = bookingRows[0];

    // travel_reels 레코드 생성
    const { data: reelRows, error: insertErr } = await supabaseAdmin
      .from('travel_reels')
      .insert({
        booking_id: bookingId,
        customer_id: booking.lead_customer_id ?? null,
        photos: photos,
        destination: destination ?? booking.destination ?? null,
        template_id: templateId ?? 'default',
      })
      .select('id, share_token, created_at')
      .single();

    if (insertErr) throw insertErr;

    const shareToken = reelRows.share_token as string;
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com';
    const shareUrl = `${baseUrl}/reels/${shareToken}`;

    return NextResponse.json({
      ok: true,
      reelId: reelRows.id,
      shareToken,
      shareUrl,
      createdAt: reelRows.created_at,
    });
  } catch (err) {
    console.error('[reels/create] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
