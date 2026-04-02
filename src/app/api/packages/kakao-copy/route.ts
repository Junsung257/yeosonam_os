import { NextRequest, NextResponse } from 'next/server';
import { generateKakaoCopy } from '@/lib/ai';

/**
 * POST /api/packages/kakao-copy
 * 카톡방용 마케팅 문구 생성
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const copy = await generateKakaoCopy({
      title: body.title || '',
      destination: body.destination || '',
      duration: body.duration || 0,
      price: body.price || 0,
      priceTiers: body.priceTiers || [],
      highlights: body.highlights || [],
      inclusions: body.inclusions || [],
      excludes: body.excludes || [],
      airline: body.airline || '',
      departureAirport: body.departureAirport || '',
      ticketingDeadline: body.ticketingDeadline || '',
      productType: body.productType || '',
      specialNotes: body.specialNotes || '',
    });

    return NextResponse.json({ copy });
  } catch (error) {
    console.error('[Kakao Copy API] 생성 오류:', error);
    return NextResponse.json({ error: '문구 생성 실패', copy: '' }, { status: 500 });
  }
}
