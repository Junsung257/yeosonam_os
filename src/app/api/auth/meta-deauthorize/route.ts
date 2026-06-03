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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const signedRequest = formData.get('signed_request');

    if (!signedRequest || typeof signedRequest !== 'string') {
      return apiResponse({ error: 'signed_request missing' }, { status: 400 });
    }

    const [encodedSig, encodedPayload] = signedRequest.split('.');
    if (!encodedSig || !encodedPayload) {
      return apiResponse({ error: 'invalid signed_request format' }, { status: 400 });
    }

    const appSecret = getSecret('META_APP_SECRET');
    if (!appSecret) {
      console.error('[meta-deauthorize] META_APP_SECRET is not configured');
      return apiResponse({ error: 'server config error' }, { status: 500 });
    }

    const expected = createHmac('sha256', appSecret).update(encodedPayload).digest('base64url');
    const sigBuf = Buffer.from(encodedSig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      console.warn('[meta-deauthorize] signature mismatch');
      return apiResponse({ error: 'invalid signature' }, { status: 403 });
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as { user_id?: string; user?: { id?: string } };

    const userId = payload.user_id ?? payload.user?.id;
    if (!userId) {
      console.warn('[meta-deauthorize] user_id missing', {
        keys: Object.keys(payload),
      });
      return apiResponse({ error: 'no user_id' }, { status: 400 });
    }

    console.log(`[meta-deauthorize] user ${maskExternalId(userId)} deauthorized app access.`);

    const { error } = await supabaseAdmin
      .from('system_secrets')
      .delete()
      .in('key', ['THREADS_ACCESS_TOKEN', 'META_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN']);

    if (error) {
      console.error('[meta-deauthorize] token cleanup failed:', sanitizeDbError(error));
      return apiResponse({ error: 'token cleanup failed' }, { status: 500 });
    }

    return apiResponse({ url: '/api/auth/meta-deletion' });
  } catch (err) {
    console.error('[meta-deauthorize] processing error:', sanitizeDbError(err));
    return apiResponse({ error: 'internal error' }, { status: 500 });
  }
}
