import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export type Platform = 'google_ads' | 'meta' | 'naver' | 'google_analytics';

export interface IntegrationStatus {
  platform: Platform;
  label: string;
  connected: boolean;
  connected_at: string | null;
  expires_at: string | null;
  scopes: string[];
}

const PLATFORM_LABELS: Record<Platform, string> = {
  google_ads: 'Google Ads',
  meta: 'Meta (Facebook/Instagram)',
  naver: '네이버 검색광고',
  google_analytics: 'Google Analytics',
};

const SUPPORTED_PLATFORMS: Platform[] = ['google_ads', 'meta'];

function emptyIntegrations(): IntegrationStatus[] {
  return SUPPORTED_PLATFORMS.map((p) => ({
    platform: p,
    label: PLATFORM_LABELS[p],
    connected: false,
    connected_at: null,
    expires_at: null,
    scopes: [],
  }));
}

/**
 * GET /api/admin/integrations?tenant_id={uuid}
 *
 * 테넌트의 OAuth 플랫폼 연결 현황 반환.
 * tenant_id 미전달 시 첫 번째 활성 테넌트를 자동으로 사용 (단일 운영자 어드민 구조).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  let tenantId = request.nextUrl.searchParams.get('tenant_id');

  if (!isSupabaseConfigured) {
    return NextResponse.json({ integrations: emptyIntegrations() });
  }

  if (!tenantId) {
    const { data } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
    tenantId = data?.[0]?.id ?? null;
    if (!tenantId) return NextResponse.json({ integrations: emptyIntegrations() });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('tenant_api_tokens')
      .select('provider, is_active, expires_at, scopes, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .in('provider', SUPPORTED_PLATFORMS);

    if (error) throw error;

    type TokenRow = { provider: string; is_active: boolean; expires_at: string | null; scopes: string[]; updated_at: string | null };
    const tokenMap = new Map<Platform, TokenRow>((data ?? []).map((r: TokenRow) => [r.provider as Platform, r]));

    const integrations: IntegrationStatus[] = SUPPORTED_PLATFORMS.map((p) => {
      const row = tokenMap.get(p);
      return {
        platform: p,
        label: PLATFORM_LABELS[p],
        connected: !!(row?.is_active),
        connected_at: row?.updated_at ?? null,
        expires_at: row?.expires_at ?? null,
        scopes: row?.scopes ?? [],
      };
    });

    return NextResponse.json({ integrations, resolvedTenantId: tenantId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
