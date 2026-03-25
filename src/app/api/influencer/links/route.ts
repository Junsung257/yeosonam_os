import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// GET: 인플루언서가 생성한 링크 목록
export async function GET(req: NextRequest) {
  try {
    const referral_code = req.nextUrl.searchParams.get('code');
    if (!referral_code) return NextResponse.json({ error: '코드 필요' }, { status: 400 });

    const { data: links, error } = await supabaseAdmin
      .from('influencer_links')
      .select('*')
      .eq('referral_code', referral_code)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ links: links || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}

// POST: 새 링크 생성
export async function POST(req: NextRequest) {
  try {
    const { referral_code, package_id, package_title } = await req.json();
    if (!referral_code || !package_id) {
      return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
    }

    // 어필리에이트 확인
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id, referral_code')
      .eq('referral_code', referral_code)
      .single();

    if (!affiliate) {
      return NextResponse.json({ error: '존재하지 않는 코드' }, { status: 404 });
    }

    // 중복 체크 (같은 상품에 대해 이미 생성된 링크)
    const { data: existing } = await supabaseAdmin
      .from('influencer_links')
      .select('id, short_url')
      .eq('affiliate_id', affiliate.id)
      .eq('package_id', package_id)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({
        link: existing[0],
        short_url: existing[0].short_url,
        message: '이미 생성된 링크입니다',
      });
    }

    // 링크 URL 생성
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://yeosonam.co.kr';
    const shortUrl = `${baseUrl}/packages/${package_id}?ref=${referral_code}`;

    const { data: link, error } = await supabaseAdmin
      .from('influencer_links')
      .insert({
        affiliate_id: affiliate.id,
        referral_code,
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
