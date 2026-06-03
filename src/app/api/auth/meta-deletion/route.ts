import { type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function maskExternalId(id: string): string {
  if (id.length <= 6) return '***';
  return `${id.slice(0, 3)}***${id.slice(-3)}`;
}

function extractVerifiedUserId(signedRequest: string): string | null {
  const [encodedSig, encodedPayload] = signedRequest.split('.');
  const appSecret = getSecret('META_APP_SECRET');
  if (!encodedSig || !encodedPayload || !appSecret) return null;

  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest('base64url');
  const sigBuf = Buffer.from(encodedSig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  ) as { user_id?: string };
  return payload.user_id ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const signedRequest = formData.get('signed_request');
    const userId = typeof signedRequest === 'string'
      ? extractVerifiedUserId(signedRequest)
      : null;
    const deletionId = crypto.randomUUID();

    if (userId) {
      console.log(`[meta-deletion] deletion requested: deletion_id=${deletionId}, user_id=${maskExternalId(userId)}`);

      Promise.resolve().then(async () => {
        const { error } = await supabaseAdmin
          .from('system_secrets')
          .delete()
          .in('key', ['THREADS_ACCESS_TOKEN', 'META_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN', 'THREADS_USER_ID']);
        if (error) throw error;
        console.log(`[meta-deletion] deletion completed: deletion_id=${deletionId}`);
      }).catch((err) => {
        console.error(`[meta-deletion] deletion failed: deletion_id=${deletionId}`, sanitizeDbError(err));
      });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.yeosonam.com';
    return apiResponse({
      url: `${siteUrl}/api/auth/meta-deletion/${deletionId}`,
      confirmation_code: deletionId,
      status: 'pending',
    });
  } catch (err) {
    console.error('[meta-deletion] processing error:', sanitizeDbError(err));
    return apiResponse({ error: 'internal error' }, { status: 500 });
  }
}
