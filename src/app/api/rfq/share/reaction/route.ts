import { NextRequest, NextResponse } from 'next/server';
import { addRfqReaction } from '@/lib/db/rfq-share';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rfqId, visitorToken, reactionType, comment } = body;

    if (!rfqId || !visitorToken || !reactionType) {
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
    }

    const ok = await addRfqReaction(rfqId, visitorToken, reactionType, comment);
    if (!ok) {
      return NextResponse.json({ error: '반응 저장 실패' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Reaction API error:', e);
    return NextResponse.json({ error: '서버 오류' }, { status: 500 });
  }
}
