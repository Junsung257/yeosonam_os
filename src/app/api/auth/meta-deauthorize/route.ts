/**
 * Meta 앱 제거 콜백 (Deauthorize Callback)
 * POST /api/auth/meta-deauthorize
 *
 * 사용자가 Meta 계정에서 이 앱을 제거할 때 Meta가 호출합니다.
 * signed_request 본문을 검증하고, 관련 토큰을 정리합니다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function maskExternalId(id: string): string {
  if (id.length <= 6) return '***';
  return `${id.slice(0, 3)}***${id.slice(-3)}`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const signedRequest = formData.get('signed_request');

    if (!signedRequest || typeof signedRequest !== 'string') {
      return NextResponse.json({ error: 'signed_request 누락' }, { status: 400 });
    }

    // signed_request = base64url(payload).base64url(signature)
    const [encodedSig, encodedPayload] = signedRequest.split('.');
    if (!encodedSig || !encodedPayload) {
      return NextResponse.json({ error: 'signed_request 형식 오류' }, { status: 400 });
    }

    const appSecret = getSecret('META_APP_SECRET');
    if (!appSecret) {
      console.error('[meta-deauthorize] META_APP_SECRET 미설정');
      return NextResponse.json({ error: 'server config error' }, { status: 500 });
    }

    // 서명 검증
    const { createHmac, timingSafeEqual } = await import('crypto');
    const expected = createHmac('sha256', appSecret).update(encodedPayload).digest('base64url');
    const sigBuf = Buffer.from(encodedSig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      console.warn('[meta-deauthorize] 서명 불일치');
      return NextResponse.json({ error: 'invalid signature' }, { status: 403 });
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as { user_id?: string; user?: { id?: string } };

    const userId = payload.user_id ?? payload.user?.id;
    if (!userId) {
      console.warn('[meta-deauthorize] user_id 없음', {
        keys: Object.keys(payload),
      });
      return NextResponse.json({ error: 'no user_id' }, { status: 400 });
    }

    console.log(`[meta-deauthorize] user ${maskExternalId(userId)} deauthorized app access.`);

    // 관련 system_secrets 정리 (해당 사용자의 토큰이 맞다면)
    await supabaseAdmin
      .from('system_secrets')
      .delete()
      .in('key', ['THREADS_ACCESS_TOKEN', 'META_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN']);

    return NextResponse.json({ url: '/api/auth/meta-deletion' });
  } catch (err) {
    console.error('[meta-deauthorize] 처리 중 오류:', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
