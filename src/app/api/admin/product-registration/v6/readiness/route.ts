import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { buildProductRegistrationV6ReadinessReport } from '@/lib/product-registration-v6/readiness';
import { getSecret } from '@/lib/secret-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getDatabaseReadiness() {
  if (!isSupabaseAdminConfigured) {
    return {
      v6ColumnAvailable: false,
      authorityMode: null,
      publicationFrozen: null,
      schemaVersion: null,
      schemaVerificationState: null,
      unvalidatedTenantForeignKeys: null,
      legacyPublicationRpcsExecutable: null,
      publishedPointerCount: null,
      passedProofCount: null,
      unfinishedJobCount: null,
    };
  }

  const [jobsResult, pointersResult, proofsResult, authorityResult] = await Promise.all([
    supabaseAdmin.from('upload_jobs').select('id', { count: 'exact', head: true }).is('v6_outcome', null),
    supabaseAdmin.from('product_registration_v5_publication_pointers').select('package_id', { count: 'exact', head: true }).eq('state', 'published'),
    supabaseAdmin.from('product_registration_v5_proof_runs').select('id', { count: 'exact', head: true }).eq('status', 'passed'),
    supabaseAdmin.rpc('get_product_registration_authority_readiness'),
  ]);

  const authority = authorityResult.data && typeof authorityResult.data === 'object'
    ? authorityResult.data as Record<string, unknown>
    : {};
  const authorityMode = authorityResult.error ? null : String(authority.authority_mode ?? '');
  const schemaVersion = authorityResult.error ? '' : String(authority.schema_version ?? '');
  const schemaVerificationState = authorityResult.error
    ? ''
    : String(authority.schema_verification_state ?? '');
  const parsedAuthorityMode: 'legacy' | 'shadow' | 'kernel' | null = authorityMode === 'legacy'
    || authorityMode === 'shadow'
    || authorityMode === 'kernel'
    ? authorityMode
    : null;

  return {
    v6ColumnAvailable: !jobsResult.error,
    authorityMode: parsedAuthorityMode,
    publicationFrozen: authorityResult.error ? null : Boolean(authority.publication_freeze),
    schemaVersion: schemaVersion || null,
    schemaVerificationState: schemaVerificationState || null,
    unvalidatedTenantForeignKeys: authorityResult.error ? null : Number(authority.unvalidated_tenant_foreign_keys ?? 0),
    legacyPublicationRpcsExecutable: authorityResult.error ? null : Boolean(authority.legacy_publication_rpcs_executable),
    publishedPointerCount: pointersResult.error ? null : pointersResult.count ?? 0,
    passedProofCount: proofsResult.error ? null : proofsResult.count ?? 0,
    unfinishedJobCount: jobsResult.error ? null : jobsResult.count ?? 0,
  };
}

const getHandler = async (_request: NextRequest) => {
  const database = await getDatabaseReadiness();
  const config = getProductRegistrationV6RuntimeConfig();
  const report = buildProductRegistrationV6ReadinessReport({
    config,
    credentials: {
      proofSecret: Boolean(getSecret('PRODUCT_REGISTRATION_PROOF_SECRET')),
      browser: Boolean(getSecret('PRODUCT_REGISTRATION_BROWSER_WS_ENDPOINT')
        || getSecret('PRODUCT_REGISTRATION_CHROME_EXECUTABLE_PATH')
        || getSecret('CHROME_EXECUTABLE_PATH')),
      oag: Boolean(getSecret('OAG_SUBSCRIPTION_KEY')),
      cirium: Boolean(getSecret('CIRIUM_APP_ID') && getSecret('CIRIUM_APP_KEY')),
      clova: Boolean(getSecret('CLOVA_OCR_APIGW_URL') && getSecret('CLOVA_OCR_SECRET')),
      googleDocumentAi: Boolean(getSecret('GOOGLE_DOCUMENT_AI_PROJECT_ID')
        && getSecret('GOOGLE_DOCUMENT_AI_PROCESSOR_ID')
        && getSecret('GOOGLE_SERVICE_ACCOUNT_JSON')),
      ocrEnabled: getSecret('PRODUCT_REGISTRATION_V6_OCR_ENABLED') === '1',
    },
    database,
  });

  return NextResponse.json({ success: true, report }, {
    headers: { 'Cache-Control': 'no-store' },
  });
};

export const GET = withAdminGuard(getHandler);
