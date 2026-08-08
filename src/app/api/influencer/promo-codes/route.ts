import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { authInfluencer } from '@/lib/affiliate/jwt-or-pin-auth';
import { isAllowedPartnerWriteOrigin } from '@/lib/affiliate/write-origin';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ promo_codes: [] });
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'code 필요' }, { status: 400 });

  const auth = await authInfluencer(req, code);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabaseAdmin
    .from('affiliate_promo_codes')
    .select('id, code, discount_type, discount_value, is_active, starts_at, ends_at, max_uses, uses_count, created_at')
    .eq('affiliate_id', (auth.affiliate as { id: string }).id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ promo_codes: data || [] });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  if (!isAllowedPartnerWriteOrigin(req)) {
    return NextResponse.json({ error: 'ORIGIN_REJECTED' }, { status: 403 });
  }
  const body = await req.json();
  const referralCode = String(body.referral_code || '');
  const auth = await authInfluencer(req, referralCode);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Creator attribution codes and real customer discounts are being split into
  // separate contracts. Creating ambiguous discount-looking codes is paused.
  return NextResponse.json({
    error: '추천 코드와 할인 쿠폰 분리 작업이 완료될 때까지 신규 생성을 일시 중지했습니다.',
    code: 'PROMOTION_CREATION_PAUSED',
  }, { status: 423 });
}
