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
      browser: Boolean(process.env.PRODUCT_REGISTRATION_BROWSER_WS_ENDPOINT?.trim()
        || process.env.PRODUCT_REGISTRATION_CHROME_EXECUTABLE_PATH?.trim()
        || process.env.CHROME_EXECUTABLE_PATH?.trim()),
      oag: Boolean(process.env.OAG_SUBSCRIPTION_KEY?.trim()),
      cirium: Boolean(process.env.CIRIUM_APP_ID?.trim() && process.env.CIRIUM_APP_KEY?.trim()),
      clova: Boolean(process.env.CLOVA_OCR_APIGW_URL?.trim() && process.env.CLOVA_OCR_SECRET?.trim()),
      googleDocumentAi: Boolean(process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID?.trim()
        && process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID?.trim()
        && getSecret('GOOGLE_SERVICE_ACCOUNT_JSON')),
      ocrEnabled: process.env.PRODUCT_REGISTRATION_V6_OCR_ENABLED === '1',
    },
    database,
  });

  return NextResponse.json({ success: true, report }, {
    headers: { 'Cache-Control': 'no-store' },
  });
};

export const GET = withAdminGuard(getHandler);
