/**
 * 테넌트 API 토큰 복호화 — 서버 측 OAuth 클라이언트 전용
 * API 라우트에서 노출하지 않고 server action / route 내부에서만 import합니다.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { decrypt } from '@/lib/encryption';

const ALLOWED_PROVIDERS = ['google_ads', 'meta', 'naver', 'google_analytics', 'kakao_biz'] as const;
export type Provider = typeof ALLOWED_PROVIDERS[number];

interface TokenRow {
  encrypted_access_token: string;
}

export async function getDecryptedToken(tenantId: string, provider: Provider): Promise<string | null> {
  if (!isSupabaseConfigured) return null;

  const { data } = await supabaseAdmin
    .from('tenant_api_tokens')
    .select('encrypted_access_token')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .eq('is_active', true)
    .limit(1);

  const row = (data as TokenRow[] | null)?.[0];
  if (!row) return null;

  try {
    return decrypt(row.encrypted_access_token);
  } catch {
    return null;
  }
}
