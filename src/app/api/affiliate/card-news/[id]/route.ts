import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { verifyAffiliateToken } from '@/lib/affiliate/jwt-auth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const { id } = await props.params;

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  const token = await verifyAffiliateToken(auth.slice(7));
  if (!token.ok) {
    return NextResponse.json({ error: '유효하지 않은 토큰' }, { status: 401 });
  }

  // 카드뉴스 조회 + 권한 확인 (created_by_affiliate_id가 일치해야 함)
  const affiliateId = token.affiliateId;
  const { data: cardNews, error } = await supabaseAdmin
    .from('card_news')
    .select('*')
    .eq('id', id)
    .eq('created_by_affiliate_id', affiliateId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!cardNews) {
    return NextResponse.json({ error: '카드뉴스를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 조회수 증가
  await supabaseAdmin
    .from('card_news')
    .update({ views: (cardNews.views || 0) + 1 })
    .eq('id', id);

  return NextResponse.json({ card_news: cardNews });
}
