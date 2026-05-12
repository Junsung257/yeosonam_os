import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAffiliateReferralAndPin } from '@/lib/influencer-pin-auth';
import { getSecret } from '@/lib/secret-registry';

const supabaseAdmin = createClient(
  getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
  getSecret('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

function readPin(req: NextRequest, body?: { pin?: string }): string | undefined {
  const h = req.headers.get('x-influencer-pin');
  if (h?.trim()) return h.trim();
  return typeof body?.pin === 'string' ? body.pin.trim() : undefined;
}

// GET: 링크 목록 — PIN 필수 (헤더 x-influencer-pin)
export async function GET(req: NextRequest) {
  try {
    const referral_code = req.nextUrl.searchParams.get('code');
    if (!referral_code) return NextResponse.json({ error: '코드 필요' }, { status: 400 });

    const auth = await verifyAffiliateReferralAndPin(supabaseAdmin, referral_code, readPin(req));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const canon = (auth.affiliate as { referral_code: string }).referral_code;
    const { data: links, error } = await supabaseAdmin
      .from('influencer_links')
      .select('*')
      .eq('referral_code', canon)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ links: links || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}

// POST: 새 링크 생성 — body.pin 필수
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { referral_code, package_id, package_title, pin, sub_id } = body as {
      referral_code?: string;
      package_id?: string;
      package_title?: string;
      pin?: string;
      sub_id?: string;
    };
    if (!referral_code || !package_id) {
      return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
    }

    const auth = await verifyAffiliateReferralAndPin(supabaseAdmin, referral_code, readPin(req, { pin }));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const affiliate = auth.affiliate as { id: string; referral_code: string };
    const canon = affiliate.referral_code;

    const normalizedSub = typeof sub_id === 'string'
      ? sub_id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)
      : '';

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://yeosonam.co.kr';
    const shortUrl = normalizedSub
      ? `${baseUrl}/r/${encodeURIComponent(canon)}/${package_id}?sub=${encodeURIComponent(normalizedSub)}`
      : `${baseUrl}/r/${encodeURIComponent(canon)}/${package_id}`;

    const { data: existing } = await supabaseAdmin
      .from('influencer_links')
      .select('id, short_url')
      .eq('affiliate_id', affiliate.id)
      .eq('package_id', package_id)
      .eq('short_url', shortUrl)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({
        link: existing[0],
        short_url: existing[0].short_url,
        message: '이미 생성된 링크입니다',
      });
    }

    const { data: link, error } = await supabaseAdmin
      .from('influencer_links')
      .insert({
        affiliate_id: affiliate.id,
        referral_code: canon,
        package_id,
        package_title: package_title || null,
        short_url: shortUrl,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ link, short_url: shortUrl }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
