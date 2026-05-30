/**
 * POST /api/affiliate/auth/login
 * 어필리에이터 PIN 로그인
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import crypto from 'crypto';

export const runtime = 'nodejs';

function generateToken(affiliateId: string, secret: string): string {
  const payload = JSON.stringify({ affiliate_id: affiliateId, iat: Date.now() });
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + hmac;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  let body: { referral_code: string; pin: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.referral_code || !body.pin) {
    return NextResponse.json({ error: '파트너 코드와 PIN을 입력해주세요.' }, { status: 400 });
  }

  const code = body.referral_code.trim().toUpperCase();
  const pin = body.pin.trim();

  // 어필리에이터 조회
  const { data: aff, error } = await supabaseAdmin
    .from('affiliates')
    .select('id, name, referral_code, branding_level, content_quota, content_used, is_active, portal_pin')
    .eq('referral_code', code)
    .maybeSingle();

  if (error || !aff) {
    return NextResponse.json({ error: '파트너 코드를 찾을 수 없습니다.' }, { status: 401 });
  }

  if (!aff.is_active) {
    return NextResponse.json({ error: '비활성화된 계정입니다.' }, { status: 403 });
  }

  if (!aff.portal_pin || aff.portal_pin !== pin) {
    return NextResponse.json({ error: 'PIN 번호가 일치하지 않습니다.' }, { status: 401 });
  }

  // 로그인 기록
  await supabaseAdmin
    .from('affiliates')
    .update({
      portal_last_login_at: new Date().toISOString(),
    })
    .eq('id', aff.id);

  const secret = getSecret('AFFILIATE_TOKEN_SECRET') || getSecret('SUPABASE_JWT_SECRET') || 'dev-secret-change-in-prod';
  const token = generateToken(aff.id, secret);

  return NextResponse.json({
    token,
    affiliate: {
      id: aff.id,
      name: aff.name,
      referral_code: aff.referral_code,
      branding_level: aff.branding_level,
      content_quota: aff.content_quota,
      content_used: aff.content_used,
    },
  });
}
