import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const codeRaw = request.nextUrl.searchParams.get('code') || '';
  const code = normalizeAffiliateReferralCode(codeRaw);
  if (!code) return NextResponse.json({ valid: false, reason: 'INVALID_CODE' }, { status: 400 });

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('affiliate_promo_codes')
    .select('id, code, affiliate_id, discount_type, discount_value, is_active, starts_at, ends_at, uses_count, max_uses')
    .eq('code', code)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ valid: false, reason: 'NOT_FOUND' });

  const row = data as {
    id: string;
    code: string;
    affiliate_id: string;
    discount_type: 'percent' | 'fixed';
    discount_value: number;
    is_active: boolean;
    starts_at: string | null;
    ends_at: string | null;
    uses_count: number;
    max_uses: number | null;
  };

  if (!row.is_active) return NextResponse.json({ valid: false, reason: 'INACTIVE' });
  if (row.starts_at && row.starts_at > nowIso) return NextResponse.json({ valid: false, reason: 'NOT_STARTED' });
  if (row.ends_at && row.ends_at < nowIso) return NextResponse.json({ valid: false, reason: 'EXPIRED' });
  if (typeof row.max_uses === 'number' && row.max_uses >= 0 && row.uses_count >= row.max_uses) {
    return NextResponse.json({ valid: false, reason: 'MAX_USES_REACHED' });
  }

  return NextResponse.json({
    valid: true,
    promo: {
      id: row.id,
      code: row.code,
      affiliate_id: row.affiliate_id,
      discount_type: row.discount_type,
      discount_value: row.discount_value,
      uses_count: row.uses_count,
      max_uses: row.max_uses,
    },
  });
}

