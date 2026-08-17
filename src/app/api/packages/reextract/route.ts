/**
 * POST /api/packages/reextract
 * body: { packageId: string }
 *
 * Reprocesses a saved package from immutable raw_text through the central
 * product-registration engine. This path is for admin repair/review only; it
 * must not promote a pending package to customer-visible status automatically.
 */

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  startProductRegistrationWorkflowForSource,
  storeProductRegistrationTextSource,
} from '@/lib/product-registration-authority/start-workflow';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE, parseUploadSourceMetadata } from '@/lib/upload-source-metadata';

type PackageReextractRow = {
  id: string;
  raw_text: string | null;
  filename: string | null;
  land_operator: string | null;
  tenant_id: string | null;
  catalog_product_id: string | null;
};

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const { packageId } = await request.json() as { packageId?: string };
  if (!packageId) {
    return NextResponse.json({ error: 'packageId is required.' }, { status: 400 });
  }

  const { data: pkgData, error: fetchError } = await supabaseAdmin
    .from('travel_packages')
    .select([
      'id',
      'raw_text',
      'filename',
      'land_operator',
      'tenant_id',
      'catalog_product_id',
    ].join(', '))
    .eq('id', packageId)
    .maybeSingle();

  if (fetchError || !pkgData) {
    return NextResponse.json({ error: fetchError?.message ?? 'Package not found.' }, { status: 404 });
  }

  const pkg = pkgData as unknown as PackageReextractRow;
  const rawText = String(pkg.raw_text ?? '').trim();
  if (rawText.length < 50) {
    return NextResponse.json({ error: 'Saved raw_text is missing or too short for central reprocessing.' }, { status: 400 });
  }
  if (!getProductRegistrationV6RuntimeConfig().workflowEnabled) {
    return NextResponse.json({
      error: '통합 상품등록 workflow가 비활성화되어 있습니다. 레거시 row 직접 수정은 허용하지 않습니다.',
      code: 'PRODUCT_REGISTRATION_KERNEL_REQUIRED',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  {
    if (!pkg.tenant_id || !pkg.catalog_product_id) {
      return NextResponse.json({
        error: '통합 상품 정체성 또는 tenant 연결이 없어 재추출할 수 없습니다.',
        code: 'REEXTRACT_CATALOG_IDENTITY_REQUIRED',
      }, { status: 409 });
    }
    const { data: baseRevision, error: revisionError } = await supabaseAdmin
      .from('product_registration_v5_revisions')
      .select('id')
      .eq('tenant_id', pkg.tenant_id)
      .eq('catalog_product_id', pkg.catalog_product_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionError || !baseRevision?.id) {
      return NextResponse.json({
        error: revisionError?.message ?? '기준 revision을 찾을 수 없습니다.',
        code: 'REEXTRACT_BASE_REVISION_REQUIRED',
      }, { status: 409 });
    }
    const requestId = randomUUID();
    const stored = await storeProductRegistrationTextSource({
      supabase: supabaseAdmin,
      tenantId: pkg.tenant_id,
      rawText,
      fileName: pkg.filename
        ? `${pkg.filename.replace(/\.[^.]+$/, '')}-reextract.txt`
        : `reextract-${pkg.id}.txt`,
      requestId,
      sourceChannel: 'reextract',
      metadata: {
        sourcePackageId: pkg.id,
        sourceCatalogProductId: pkg.catalog_product_id,
        reextractCreatesCorrectionRevision: true,
      },
    });
    const operationKey = `reextract:${pkg.catalog_product_id}:${requestId}`;
    const { data: correctionData, error: correctionError } = await supabaseAdmin.rpc('enqueue_product_registration_correction', {
      p_payload: {
        tenant_id: pkg.tenant_id,
        catalog_product_id: pkg.catalog_product_id,
        base_revision_id: baseRevision.id,
        source_document_id: stored.source.id,
        requested_changes: [{ scope: 'all_facts', action: 'reextract_from_immutable_source' }],
        reason: '관리자 재추출 요청: 기존 row를 수정하지 않고 새 correction revision을 생성합니다.',
        operation_key: operationKey,
      },
    });
    const correction = correctionData && typeof correctionData === 'object' && !Array.isArray(correctionData)
      ? correctionData as Record<string, unknown>
      : {};
    const correctionJobId = String(correction.correction_job_id ?? '');
    const productKey = String(correction.product_key ?? '');
    if (correctionError || !correctionJobId || !productKey) {
      return NextResponse.json({
        error: correctionError?.message ?? '수정 revision 작업을 만들 수 없습니다.',
        code: 'REEXTRACT_CORRECTION_ENQUEUE_FAILED',
      }, { status: 409 });
    }
    const metadata = parseUploadSourceMetadata({
      rawText,
      fileName: pkg.filename,
      explicitLandOperator: pkg.land_operator,
      defaultCommissionRate: DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE,
    });
    const started = await startProductRegistrationWorkflowForSource({
      supabase: supabaseAdmin,
      tenantId: pkg.tenant_id,
      source: stored.source,
      requestId,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin,
      uploadSourceMetadata: metadata as unknown as Record<string, unknown>,
      sourceChannel: 'reextract',
      forceReprocess: true,
      dedupeHit: stored.dedupeHit,
      correction: {
        correctionJobId,
        catalogProductId: pkg.catalog_product_id,
        baseRevisionId: baseRevision.id,
        productKey,
        operationKey,
      },
    });
    return NextResponse.json({
      ok: true,
      code: 'PRODUCT_REGISTRATION_CORRECTION_ACCEPTED',
      state: 'processing',
      correctionJobId,
      priorPackageId: pkg.id,
      ...started,
    }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const POST = withAdminGuard(postHandler);
