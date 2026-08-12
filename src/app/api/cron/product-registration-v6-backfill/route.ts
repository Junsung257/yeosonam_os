import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { withCronGuard } from '@/lib/cron-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { startProductRegistrationTextWorkflow } from '@/lib/product-registration-authority/start-workflow';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type BackfillClaim = {
  id: string;
  tenant_id: string;
  catalog_product_id: string;
  package_id: string;
  attempt_count: number;
};

function baseUrl(request: NextRequest): string {
  return (process.env.NEXT_PUBLIC_BASE_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || request.nextUrl.origin)
    .replace(/\/+$/, '');
}

async function handler(request: NextRequest) {
  const config = getProductRegistrationV6RuntimeConfig();
  if (process.env.PRODUCT_REGISTRATION_V6_BACKFILL_ENABLED !== '1') {
    return NextResponse.json({ success: false, code: 'V6_BACKFILL_DISABLED' }, { status: 409 });
  }
  if (config.authorityMode === 'legacy' || !config.workflowEnabled) {
    return NextResponse.json({ success: false, code: 'V6_WORKFLOW_AUTHORITY_DISABLED' }, { status: 409 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  // The generated database types intentionally lag unapplied forward
  // migrations. Keep this route on the generic client until the migration is
  // applied and types are regenerated; runtime access is still service-role
  // only and every RPC performs its own tenant checks.
  const db = supabase as unknown as SupabaseClient;
  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? 10);
  const limit = Math.max(1, Math.min(25, Number.isFinite(requestedLimit) ? requestedLimit : 10));
  const { data: claimed, error: claimError } = await db.rpc(
    'claim_product_registration_legacy_backfill',
    { p_limit: limit },
  );
  if (claimError) throw claimError;
  const claims = Array.isArray(claimed) ? claimed as BackfillClaim[] : [];
  if (claims.length === 0) {
    return NextResponse.json({ success: true, claimed: 0, started: 0, results: [] });
  }

  const packageIds = claims.map(claim => claim.package_id);
  const { data: packages, error: packageError } = await db
    .from('travel_packages')
    .select('id,tenant_id,catalog_product_id,internal_code,title,raw_text,land_operator')
    .in('id', packageIds);
  if (packageError) throw packageError;
  const packageById = new Map((packages ?? []).map(pkg => [String(pkg.id), pkg]));
  const catalogIds = claims.map(claim => claim.catalog_product_id);
  const { data: revisions, error: revisionError } = await db
    .from('product_registration_v5_revisions')
    .select('id,catalog_product_id,revision_no')
    .in('catalog_product_id', catalogIds)
    .order('revision_no', { ascending: false });
  if (revisionError) throw revisionError;
  const baseRevisionByCatalog = new Map<string, string>();
  for (const revision of revisions ?? []) {
    const catalogProductId = String(revision.catalog_product_id ?? '');
    if (catalogProductId && !baseRevisionByCatalog.has(catalogProductId)) {
      baseRevisionByCatalog.set(catalogProductId, String(revision.id));
    }
  }

  const publicBaseUrl = baseUrl(request);
  const results: Array<Record<string, unknown>> = [];
  for (const claim of claims) {
    const pkg = packageById.get(claim.package_id);
    const rawText = typeof pkg?.raw_text === 'string' ? pkg.raw_text.trim() : '';
    let started: { jobId: string; workflowRunId: string; sourceDocumentId: string } | null = null;
    try {
      if (!pkg || pkg.tenant_id !== claim.tenant_id || pkg.catalog_product_id !== claim.catalog_product_id) {
        throw new Error('LEGACY_BACKFILL_PACKAGE_LINEAGE_MISMATCH');
      }
      if (rawText.length < 50) throw new Error('LEGACY_SOURCE_TEXT_UNAVAILABLE');
      started = await startProductRegistrationTextWorkflow({
        supabase: db,
        tenantId: claim.tenant_id,
        rawText,
        fileName: `legacy-package-${claim.package_id}.txt`,
        requestId: `legacy-backfill:${claim.id}:${claim.attempt_count}`,
        requestBaseUrl: publicBaseUrl,
        publicBaseUrl,
        sourceChannel: 'legacy_backfill',
        archiveMode: true,
        bulkMode: true,
        forceReprocess: true,
        metadata: {
          legacyPackageId: claim.package_id,
          legacyCatalogProductId: claim.catalog_product_id,
        },
        uploadSourceMetadata: {
          sourceChannel: 'legacy_backfill',
          legacyPackageId: claim.package_id,
          landOperator: typeof pkg.land_operator === 'string' ? pkg.land_operator : null,
        },
        identityBinding: {
          bindingKind: 'legacy_backfill',
          catalogProductId: claim.catalog_product_id,
          baseRevisionId: baseRevisionByCatalog.get(claim.catalog_product_id) ?? null,
          productKey: `legacy:travel-package:${claim.package_id}`,
          operationKey: `legacy-backfill:${claim.id}:${claim.attempt_count}`,
          targetTitle: typeof pkg.title === 'string' ? pkg.title : null,
          targetInternalCode: typeof pkg.internal_code === 'string' ? pkg.internal_code : null,
        },
      });
      const { error: bindError } = await db.rpc('bind_product_registration_legacy_backfill', {
        p_payload: {
          backfill_id: claim.id,
          tenant_id: claim.tenant_id,
          catalog_product_id: claim.catalog_product_id,
          workflow_job_id: started.jobId,
          workflow_run_id: started.workflowRunId,
          source_document_id: started.sourceDocumentId,
        },
      });
      if (bindError) throw bindError;
      results.push({
        backfillId: claim.id,
        packageId: claim.package_id,
        jobId: started.jobId,
        workflowRunId: started.workflowRunId,
        status: 'started',
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (started) {
        // The workflow is already durable. Leave the ledger reserved: the next
        // claim call heals the bind from authorityBindingOperationKey.
        results.push({
          backfillId: claim.id,
          packageId: claim.package_id,
          jobId: started.jobId,
          workflowRunId: started.workflowRunId,
          status: 'bind_pending',
          error: detail,
        });
        continue;
      }
      try {
        await db.rpc('fail_product_registration_legacy_backfill', {
          p_payload: {
            backfill_id: claim.id,
            tenant_id: claim.tenant_id,
            error: detail,
          },
        });
      } catch {
        // The next cron invocation can safely reclaim only after the ledger RPC
        // succeeds; never hide the original workflow-start failure.
      }
      results.push({
        backfillId: claim.id,
        packageId: claim.package_id,
        status: 'failed',
        error: detail,
      });
    }
  }

  return NextResponse.json({
    success: results.every(result => result.status === 'started' || result.status === 'bind_pending'),
    claimed: claims.length,
    started: results.filter(result => result.status === 'started').length,
    bindPending: results.filter(result => result.status === 'bind_pending').length,
    failed: results.filter(result => result.status === 'failed').length,
    results,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withCronGuard(handler);
