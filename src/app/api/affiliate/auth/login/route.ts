import { NextRequest, NextResponse } from 'next/server';
import { authAffiliate } from '@/lib/affiliate/auth-service';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  let body: { referral_code?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.referral_code || !body.pin) {
    return NextResponse.json({ error: '파트너 코드와 PIN을 입력해주세요.' }, { status: 400 });
  }

  const auth = await authAffiliate(request, {
    referralCode: body.referral_code,
    pin: body.pin,
    issueToken: true,
  });

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
  }

  const affiliate = auth.affiliate;
  const token = auth.token || '';
  const response = NextResponse.json({
    token,
    affiliate: {
      id: affiliate.id,
      name: affiliate.name,
      referral_code: affiliate.referral_code,
      branding_level: affiliate.branding_level,
      content_quota: affiliate.content_quota,
      content_used: affiliate.content_used,
    },
  });

  response.cookies.set('inf_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24,
  });

  return response;
}
