/**
 * Meta 데이터 삭제 콜백 (Data Deletion Callback)
 * POST /api/auth/meta-deletion
 *
 * 사용자가 데이터 삭제를 요청했을 때 Meta가 호출합니다.
 * GDPR/개인정보보호법 대응: 고유한 status_url을 반환하면 Meta가
 * 48시간 내에 재확인합니다. 실제 삭제는 비동기로 진행합니다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const signedRequest = formData.get('signed_request');
    let userId: string | null = null;

    if (signedRequest && typeof signedRequest === 'string') {
      // 서명 검증
      const [encodedSig, encodedPayload] = signedRequest.split('.');
      if (encodedSig && encodedPayload) {
        const appSecret = getSecret('META_APP_SECRET');
        if (appSecret) {
          const { createHmac, timingSafeEqual } = await import('crypto');
          const expected = createHmac('sha256', appSecret).update(encodedPayload).digest('base64url');
          const sigBuf = Buffer.from(encodedSig);
          const expBuf = Buffer.from(expected);
          if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
            const payload = JSON.parse(
              Buffer.from(encodedPayload, 'base64url').toString('utf8'),
            ) as { user_id?: string };
            userId = payload.user_id ?? null;
          }
        }
      }
    }

    const deletionId = crypto.randomUUID();

    if (userId) {
      // 비동기 삭제 작업 로깅
      console.log(`[meta-deletion] 삭제 요청 접수: deletion_id=${deletionId}, user_id=${userId}`);

      // 관련 데이터 비동기 정리
      Promise.resolve().then(async () => {
        await supabaseAdmin
          .from('system_secrets')
          .delete()
          .in('key', ['THREADS_ACCESS_TOKEN', 'META_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN', 'THREADS_USER_ID']);
        console.log(`[meta-deletion] 삭제 완료: deletion_id=${deletionId}`);
      }).catch((err) => {
        console.error(`[meta-deletion] 삭제 실패: deletion_id=${deletionId}`, err);
      });
    }

    // Meta가 요구하는 형식: status_url + confirmation_code
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.yeosonam.com';
    return NextResponse.json({
      url: `${siteUrl}/api/auth/meta-deletion/${deletionId}`,
      confirmation_code: deletionId,
      status: 'pending',
    });
  } catch (err) {
    console.error('[meta-deletion] 처리 중 오류:', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
