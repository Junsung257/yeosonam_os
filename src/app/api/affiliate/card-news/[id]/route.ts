import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import { authAffiliate } from '@/lib/affiliate/auth-service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const { id } = await props.params;

  const auth = await authAffiliate(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

  // 카드뉴스 조회 + 권한 확인 (created_by_affiliate_id가 일치해야 함)
  const affiliateId = String(auth.affiliate.id);
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
