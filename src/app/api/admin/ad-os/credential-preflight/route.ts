import { NextRequest, NextResponse } from 'next/server';
import {
  buildAdOsCredentialReadiness,
  summarizeAdOsCredentialReadiness,
} from '@/lib/ad-os-credential-readiness';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret, type SecretKey } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const KNOWN_AD_OS_SECRET_KEYS = [
  'NAVER_ADS_API_KEY',
  'NAVER_ADS_SECRET_KEY',
  'NAVER_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CONVERSION_ACTION_ID',
  'META_AD_ACCOUNT_ID',
  'META_ACCESS_TOKEN',
  'META_PIXEL_ID',
  'META_CAPI_ACCESS_TOKEN',
  'META_PAGE_ID',
] as const satisfies readonly SecretKey[];

const LIVE_FLAG_KEYS = [
  'AD_OS_CONVERSION_UPLOAD_ENABLED',
  'AD_OS_GOOGLE_CONVERSION_UPLOAD_ENABLED',
  'AD_OS_META_CAPI_UPLOAD_ENABLED',
  'AD_OS_NAVER_LIMITED_WRITE_ENABLED',
] as const satisfies readonly SecretKey[];

type KnownAdOsSecretKey = (typeof KNOWN_AD_OS_SECRET_KEYS)[number];
type KnownLiveFlagKey = (typeof LIVE_FLAG_KEYS)[number];

function isKnownAdOsSecretKey(key: string): key is KnownAdOsSecretKey {
  return (KNOWN_AD_OS_SECRET_KEYS as readonly string[]).includes(key);
}

function isKnownLiveFlagKey(key: string): key is KnownLiveFlagKey {
  return (LIVE_FLAG_KEYS as readonly string[]).includes(key);
}

function hasKnownSecret(key: string): boolean {
  return isKnownAdOsSecretKey(key) && Boolean(getSecret(key));
}

function getKnownFlag(key: string): string | null {
  return isKnownLiveFlagKey(key) ? getSecret(key) : null;
}

export const GET = withAdminGuard(async () => {
  const readiness = buildAdOsCredentialReadiness({
    hasSecret: hasKnownSecret,
    getFlag: getKnownFlag,
  });
  return NextResponse.json({ ok: true, readiness, summary: summarizeAdOsCredentialReadiness(readiness) });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const readiness = buildAdOsCredentialReadiness({
    hasSecret: hasKnownSecret,
    getFlag: getKnownFlag,
  });
  const summary = summarizeAdOsCredentialReadiness(readiness);

  let runId: string | null = null;
  if (apply && isSupabaseConfigured) {
    const { data, error } = await supabaseAdmin
      .from('ad_os_automation_runs')
      .insert({
        run_type: 'credential_preflight',
        mode: 'read_only',
        status: 'completed',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        summary: {
          ...summary,
          secret_values_exposed: false,
          external_api_write: false,
        },
      } as never)
      .select('id')
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    runId = data?.id || null;
  }

  return NextResponse.json({
    ok: true,
    run_id: runId,
    readiness,
    summary: {
      ...summary,
      written: runId ? 1 : 0,
      secret_values_exposed: false,
      external_api_write: false,
    },
  });
});
