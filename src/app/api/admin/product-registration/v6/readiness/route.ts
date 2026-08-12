import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { buildProductRegistrationV6ReadinessReport } from '@/lib/product-registration-v6/readiness';
import { getSecret } from '@/lib/secret-registry';
import { browserProofRuntimeCapability } from '@/lib/product-registration-v6/browser-runtime';
import type { ProductRegistrationV6ReadinessDatabase } from '@/lib/product-registration-v6/readiness';

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
      staleUnfinishedJobCount: null,
      uniqueSourceCount: null,
      terminalOutcomeCount: null,
      legacyInventoryCount: null,
      legacyBackfillTotalCount: null,
      legacyBackfillTerminalCount: null,
      legacyBackfillFailedCount: null,
      mediaReadyRevisionCount: null,
      benchmarkPassedCount: null,
      benchmarkExactMatchRate: null,
      benchmarkCriticalFalsePublishCount: null,
      cohortSampleCount: null,
      cohortCriticalDefectCount: null,
      eligibleCohortCount: null,
    };
  }

  const [jobsResult, pointersResult, proofsResult, authorityResult, automationResult] = await Promise.all([
    supabaseAdmin.from('upload_jobs').select('id', { count: 'exact', head: true }).is('v6_outcome', null),
    supabaseAdmin.from('product_registration_v5_publication_pointers').select('package_id', { count: 'exact', head: true }).eq('state', 'published'),
    supabaseAdmin.from('product_registration_v5_proof_runs').select('id', { count: 'exact', head: true }).eq('status', 'passed'),
    supabaseAdmin.rpc('get_product_registration_authority_readiness'),
    supabaseAdmin.rpc('get_product_registration_automation_readiness_metrics'),
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
  const automation = !automationResult.error && automationResult.data && typeof automationResult.data === 'object'
    ? automationResult.data as Record<string, unknown>
    : {};
  const numberOrNull = (key: string): number | null => {
    const value = Number(automation[key]);
    return Number.isFinite(value) ? value : null;
  };

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
    staleUnfinishedJobCount: numberOrNull('v6_stale_unfinished_job_count'),
    uniqueSourceCount: numberOrNull('v6_unique_source_count'),
    terminalOutcomeCount: numberOrNull('v6_terminal_outcome_count'),
    legacyInventoryCount: numberOrNull('legacy_inventory_count'),
    legacyBackfillTotalCount: numberOrNull('legacy_backfill_total_count'),
    legacyBackfillTerminalCount: numberOrNull('legacy_backfill_terminal_count'),
    legacyBackfillFailedCount: numberOrNull('legacy_backfill_failed_count'),
    mediaReadyRevisionCount: numberOrNull('media_ready_revision_count'),
    benchmarkPassedCount: numberOrNull('benchmark_passed_count'),
    benchmarkExactMatchRate: numberOrNull('benchmark_exact_match_rate'),
    benchmarkCriticalFalsePublishCount: numberOrNull('benchmark_critical_false_publish_count'),
    cohortSampleCount: numberOrNull('cohort_sample_count'),
    cohortCriticalDefectCount: numberOrNull('cohort_critical_defect_count'),
    eligibleCohortCount: numberOrNull('eligible_cohort_count'),
  } satisfies ProductRegistrationV6ReadinessDatabase;
}

const getHandler = async (_request: NextRequest) => {
  const database = await getDatabaseReadiness();
  const config = getProductRegistrationV6RuntimeConfig();
  const report = buildProductRegistrationV6ReadinessReport({
    config,
    credentials: {
      proofSecret: Boolean(getSecret('PRODUCT_REGISTRATION_PROOF_SECRET')),
      browser: browserProofRuntimeCapability().available,
      oag: Boolean(getSecret('OAG_SUBSCRIPTION_KEY')),
      cirium: Boolean(getSecret('CIRIUM_APP_ID') && getSecret('CIRIUM_APP_KEY')),
      clova: Boolean(getSecret('CLOVA_OCR_APIGW_URL') && getSecret('CLOVA_OCR_SECRET')),
      googleDocumentAi: Boolean(getSecret('GOOGLE_DOCUMENT_AI_PROJECT_ID')
        && getSecret('GOOGLE_DOCUMENT_AI_PROCESSOR_ID')
        && getSecret('GOOGLE_SERVICE_ACCOUNT_JSON')),
      ocrEnabled: getSecret('PRODUCT_REGISTRATION_V6_OCR_ENABLED') === '1',
      mediaProvider: Boolean(getSecret('PEXELS_API_KEY')),
    },
    database,
  });

  return NextResponse.json({ success: true, report }, {
    headers: { 'Cache-Control': 'no-store' },
  });
};

export const GET = withAdminGuard(getHandler);
