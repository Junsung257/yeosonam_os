import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

function userIdFromCookie(request: NextRequest): string | null {
  const token = request.cookies.get('sb-access-token')?.value;
  if (!token) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf-8'),
    );
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const userId = userIdFromCookie(request);
  if (!userId) {
    return apiResponse({ error: '인증 필요' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { endpoint, keys } = body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return apiResponse(
        { error: 'endpoint / keys.p256dh / keys.auth 필요' },
        { status: 400 },
      );
    }

    const userAgent = request.headers.get('user-agent') ?? null;

    const { error } = await supabaseAdmin.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: userAgent,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: 'endpoint' },
    );

    if (error) {
      return apiResponse({ error: sanitizeDbError(error, '구독 저장 실패') }, { status: 500 });
    }
    return apiResponse({ success: true });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e, '처리 실패') }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { endpoint } = await request.json();
    if (!endpoint) {
      return apiResponse({ error: 'endpoint 필요' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('endpoint', endpoint);

    if (error) {
      return apiResponse({ error: sanitizeDbError(error, '구독 해지 실패') }, { status: 500 });
    }

    return apiResponse({ success: true });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e, '처리 실패') }, { status: 500 });
  }
}
