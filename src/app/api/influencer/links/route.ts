import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { authInfluencer } from '@/lib/affiliate/jwt-or-pin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const referralCode = req.nextUrl.searchParams.get('code');
    if (!referralCode) return apiResponse({ error: '코드 필요' }, { status: 400 });

    const auth = await authInfluencer(req, referralCode);
    if (!auth.ok) {
      return apiResponse({ error: auth.error }, { status: auth.status });
    }

    const canon = (auth.affiliate as { referral_code: string }).referral_code;
    const { data: links, error } = await supabaseAdmin
      .from('influencer_links')
      .select('*')
      .eq('referral_code', canon)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return apiResponse({ links: links || [] });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, 'Server error') }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { referral_code, package_id, package_title, pin, sub_id } = body as {
      referral_code?: string;
      package_id?: string;
      package_title?: string;
      pin?: string;
      sub_id?: string;
    };
    if (!referral_code || !package_id) {
      return apiResponse({ error: '필수 필드 누락' }, { status: 400 });
    }

    const auth = await authInfluencer(req, referral_code, pin);
    if (!auth.ok) {
      return apiResponse({ error: auth.error }, { status: auth.status });
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

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('influencer_links')
      .select('id, short_url')
      .eq('affiliate_id', affiliate.id)
      .eq('package_id', package_id)
      .eq('short_url', shortUrl)
      .limit(1);
    if (existingError) throw existingError;

    if (existing && existing.length > 0) {
      return apiResponse({
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

    return apiResponse({ link, short_url: shortUrl }, { status: 201 });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, 'Server error') }, { status: 500 });
  }
}
