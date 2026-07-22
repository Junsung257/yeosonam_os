import { type NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  buildClobeAuthorizationUrl,
  buildClobeRedirectUri,
  createPkcePair,
  discoverClobeOAuthMetadata,
  getClobeMcpUrl,
  getClobeSiteUrl,
  registerClobeOAuthClient,
  sealClobeOAuthState,
} from '@/lib/clobe-oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveTenantId(rawTenantId: string | null): Promise<string | null> {
  if (rawTenantId && UUID_RE.test(rawTenantId)) return rawTenantId;
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const tenantId = await resolveTenantId(request.nextUrl.searchParams.get('tenant_id'));
  if (!tenantId) {
    return apiResponse({ error: 'tenant_id is required' }, { status: 400 });
  }

  const siteUrl = getClobeSiteUrl();
  if (!siteUrl) {
    return apiResponse({ error: 'NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_BASE_URL is required' }, { status: 500 });
  }

  try {
    const metadata = await discoverClobeOAuthMetadata();
    const redirectUri = buildClobeRedirectUri(siteUrl);
    const registration = await registerClobeOAuthClient(metadata, redirectUri);
    const pkce = createPkcePair();
    const state = sealClobeOAuthState({
      tenant_id: tenantId,
      client_id: registration.client_id,
      code_verifier: pkce.codeVerifier,
      token_endpoint: metadata.token_endpoint,
      resource: getClobeMcpUrl(),
      ts: Date.now(),
    });
    const url = buildClobeAuthorizationUrl({
      metadata,
      clientId: registration.client_id,
      redirectUri,
      state,
      codeChallenge: pkce.codeChallenge,
    });

    if (request.nextUrl.searchParams.get('json') === '1') {
      return apiResponse({ url });
    }
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clobe OAuth start failed';
    return apiResponse({ error: message }, { status: 502 });
  }
}
