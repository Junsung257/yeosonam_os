import { type NextRequest, type NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { isNaverAdsConfigured } from '@/lib/search-ads-api';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export type Platform = 'google_ads' | 'meta' | 'naver' | 'google_analytics' | 'clobe';

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
  naver: 'Naver Search Ads',
  google_analytics: 'Google Analytics',
  clobe: 'Clobe AI',
};

const SUPPORTED_PLATFORMS: Platform[] = ['google_ads', 'meta', 'naver', 'clobe'];

function emptyIntegrations(): IntegrationStatus[] {
  return SUPPORTED_PLATFORMS.map((p) => ({
    platform: p,
    label: PLATFORM_LABELS[p],
    connected: p === 'naver' ? isNaverAdsConfigured() : false,
    connected_at: null,
    expires_at: null,
    scopes: p === 'naver' && isNaverAdsConfigured() ? ['searchad-api-key'] : [],
  }));
}

const getHandler = async (request: NextRequest): Promise<NextResponse> => {
  let tenantId = request.nextUrl.searchParams.get('tenant_id');

  if (!isSupabaseConfigured) {
    return apiResponse({ integrations: emptyIntegrations() });
  }

  if (!tenantId) {
    const { data } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
    tenantId = data?.[0]?.id ?? null;
    if (!tenantId) return apiResponse({ integrations: emptyIntegrations() });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('tenant_api_tokens')
      .select('provider, is_active, expires_at, scopes, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .in('provider', SUPPORTED_PLATFORMS.filter((p) => p !== 'naver'));

    if (error) throw error;

    type TokenRow = {
      provider: string;
      is_active: boolean;
      expires_at: string | null;
      scopes: string[];
      updated_at: string | null;
    };
    const tokenMap = new Map<Platform, TokenRow>((data ?? []).map((r: TokenRow) => [r.provider as Platform, r]));

    const integrations: IntegrationStatus[] = SUPPORTED_PLATFORMS.map((p) => {
      if (p === 'naver') {
        return {
          platform: p,
          label: PLATFORM_LABELS[p],
          connected: isNaverAdsConfigured(),
          connected_at: null,
          expires_at: null,
          scopes: isNaverAdsConfigured() ? ['searchad-api-key'] : [],
        };
      }
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

    return apiResponse({ integrations, resolvedTenantId: tenantId });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'Failed to load integrations') },
      { status: 500 },
    );
  }
};

export const GET = withAdminGuard(getHandler);
