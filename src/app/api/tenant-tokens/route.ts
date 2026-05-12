/**
 * GET    /api/tenant-tokens?tenant_id=...   — 테넌트 토큰 목록 (복호화 없이 메타데이터만)
 * POST   /api/tenant-tokens                 — 토큰 저장 (암호화 후 DB 저장)
 * DELETE /api/tenant-tokens?id=...          — 토큰 삭제
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { encrypt } from '@/lib/encryption';
import { type Provider } from '@/lib/tenant-token-store';

const ALLOWED_PROVIDERS = ['google_ads', 'meta', 'naver', 'google_analytics', 'kakao_biz'] as const;

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ tokens: [] });

  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) return NextResponse.json({ error: 'tenant_id 필요' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('tenant_api_tokens')
    .select('id, tenant_id, provider, expires_at, scopes, is_active, updated_at')
    .eq('tenant_id', tenantId)
    .order('provider');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 복호화 없이 메타데이터만 반환 — access_token 노출 금지
  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json() as {
      tenant_id: string;
      provider: Provider;
      access_token: string;
      refresh_token?: string;
      expires_at?: string;
      scopes?: string[];
    };

    const { tenant_id, provider, access_token, refresh_token, expires_at, scopes } = body;

    if (!tenant_id || !provider || !access_token) {
      return NextResponse.json({ error: 'tenant_id, provider, access_token 필수' }, { status: 400 });
    }
    if (!ALLOWED_PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: `허용되지 않은 provider: ${provider}` }, { status: 400 });
    }

    const encrypted_access_token  = encrypt(access_token);
    const encrypted_refresh_token = refresh_token ? encrypt(refresh_token) : null;

    const { data, error } = await supabaseAdmin
      .from('tenant_api_tokens')
      .upsert(
        {
          tenant_id,
          provider,
          encrypted_access_token,
          encrypted_refresh_token,
          expires_at: expires_at ?? null,
          scopes: scopes ?? [],
          is_active: true,
        },
        { onConflict: 'tenant_id,provider' },
      )
      .select('id, provider, expires_at, is_active')
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, token: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '저장 실패' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('tenant_api_tokens')
    .update({ is_active: false })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

