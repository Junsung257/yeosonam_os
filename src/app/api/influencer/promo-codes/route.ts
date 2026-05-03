import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { verifyAffiliateReferralAndPin } from '@/lib/influencer-pin-auth';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

function readPin(req: NextRequest, body?: { pin?: string }): string | undefined {
  const h = req.headers.get('x-influencer-pin');
  if (h?.trim()) return h.trim();
  return body?.pin?.trim();
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ promo_codes: [] });
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'code 필요' }, { status: 400 });

  const auth = await verifyAffiliateReferralAndPin(supabaseAdmin, code, readPin(req));
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

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
  const auth = await verifyAffiliateReferralAndPin(supabaseAdmin, referralCode, readPin(req, body));
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

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

  const { data, error } = await supabaseAdmin
    .from('affiliate_promo_codes')
    .upsert(payload as never, { onConflict: 'code' })
    .select('id, code, discount_type, discount_value, is_active, starts_at, ends_at, max_uses, uses_count, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ promo_code: data });
}

