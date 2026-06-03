import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { authInfluencer } from '@/lib/affiliate/jwt-or-pin-auth';

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
  const body = await req.json();
  const referralCode = String(body.referral_code || '');
  const auth = await authInfluencer(req, referralCode, body.pin);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const affiliate = auth.affiliate as { id: string; referral_code: string };
  const normalized = normalizeAffiliateReferralCode(String(body.code || '').trim());
  if (!normalized) return NextResponse.json({ error: '유효한 코드가 필요합니다.' }, { status: 400 });

  const discountType = body.discount_type === 'fixed' ? 'fixed' : 'percent';
  const discountValue = Number(body.discount_value || 0);
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return NextResponse.json({ error: '할인값이 유효하지 않습니다.' }, { status: 400 });
  }

  const maxUses =
    body.max_uses === null || body.max_uses === undefined || body.max_uses === ''
      ? null
      : Math.max(0, Number(body.max_uses));

  const payload = {
    affiliate_id: affiliate.id,
    code: normalized,
    discount_type: discountType,
    discount_value: discountValue,
    is_active: body.is_active !== false,
    starts_at: body.starts_at || null,
    ends_at: body.ends_at || null,
    max_uses: Number.isFinite(maxUses as number) ? maxUses : null,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('affiliate_promo_codes')
    .select('id, affiliate_id')
    .eq('code', normalized)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const existingRow = existing as { id: string; affiliate_id: string } | null;
  if (existingRow && existingRow.affiliate_id !== affiliate.id) {
    return NextResponse.json({ error: '이미 사용 중인 프로모션 코드입니다.' }, { status: 409 });
  }

  const query = existingRow
    ? supabaseAdmin
        .from('affiliate_promo_codes')
        .update(payload as never)
        .eq('id', existingRow.id)
    : supabaseAdmin
        .from('affiliate_promo_codes')
        .insert(payload as never);

  const { data, error } = await query
    .select('id, code, discount_type, discount_value, is_active, starts_at, ends_at, max_uses, uses_count, created_at')
    .single();
  if (error?.code === '23505') {
    return NextResponse.json({ error: '이미 사용 중인 프로모션 코드입니다.' }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ promo_code: data });
}

