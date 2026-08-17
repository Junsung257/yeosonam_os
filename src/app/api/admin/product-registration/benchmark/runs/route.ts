import { randomUUID } from 'node:crypto';

import { type NextRequest } from 'next/server';
import { start } from 'workflow/api';

import { ApiErrors, apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { jsonObject, resolveBenchmarkTenantId } from '@/lib/product-registration-v6/benchmark-admin';
import {
  buildCurrentProductRegistrationEngineReleaseManifest,
  productRegistrationEngineReleaseHash,
} from '@/lib/product-registration-v6/engine-release-manifest';
import { resolveRegistrationTermsPolicy } from '@/lib/standard-terms';
import { productRegistrationBenchmarkV2Workflow } from '@/workflows/product-registration-benchmark-v2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) return ApiErrors.unavailable('benchmark 저장소가 연결되지 않았습니다.');
  try {
    const tenantId = await resolveBenchmarkTenantId({ request });
    if (!tenantId) return ApiErrors.notFound('benchmark 테넌트를 찾지 못했습니다.');
    const { data, error } = await supabaseAdmin.rpc('get_product_registration_benchmark_runs_v2', {
      p_tenant_id: tenantId,
      p_limit: 30,
    });
    if (error) throw error;
    return apiResponse({ ok: true, data: { tenantId, runs: data ?? [] } }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[benchmark-runs-list]', error);
    return ApiErrors.internalError(sanitizeDbError(error, 'benchmark 실행 기록을 불러오지 못했습니다.'));
  }
};

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) return ApiErrors.unavailable('benchmark 저장소가 연결되지 않았습니다.');
  try {
    const body = jsonObject(await request.json());
    const corpusVersion = typeof body?.corpusVersion === 'string' ? body.corpusVersion.trim() : '';
    const inputKind = body?.inputKind === 'hwp' || body?.inputKind === 'text' ? body.inputKind : 'combined';
    if (!corpusVersion) return ApiErrors.badRequest('고정 corpus 버전이 필요합니다.');
    const tenantId = await resolveBenchmarkTenantId({ request, bodyTenantId: body?.tenantId });
    if (!tenantId) return ApiErrors.notFound('benchmark 테넌트를 찾지 못했습니다.');
    const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? '';
    if (!/^[0-9a-f]{7,64}$/iu.test(buildId)) return ApiErrors.conflict('배포 commit이 고정된 환경에서만 benchmark를 시작할 수 있습니다.');

    const [{ data: corpusInputs, error: corpusError }, termsPolicy] = await Promise.all([
      supabaseAdmin.rpc('get_product_registration_benchmark_corpus_release_inputs_v2', {
        p_tenant_id: tenantId,
        p_corpus_version: corpusVersion,
        p_input_kind: inputKind,
      }),
      resolveRegistrationTermsPolicy({}, 'mobile'),
    ]);
    if (corpusError) throw corpusError;
    const inputs = jsonObject(corpusInputs);
    const corpusHash = typeof inputs?.corpusHash === 'string' ? inputs.corpusHash : '';
    const supplierProfileVersion = typeof inputs?.supplierProfileVersion === 'string' ? inputs.supplierProfileVersion : '';
    const referenceDate = typeof inputs?.referenceDate === 'string' ? inputs.referenceDate : '';
    const frozenSourceCount = Number(inputs?.frozenSourceCount ?? 0);
    if (!corpusHash || !referenceDate || frozenSourceCount === 0) {
      return ApiErrors.conflict('이중 검수가 끝나고 기준일이 일치하는 frozen corpus가 필요합니다.');
    }
    if (!termsPolicy.has_cancellation_policy) return ApiErrors.conflict('승인된 표준 취소약관이 필요합니다.');
    const releaseManifest = buildCurrentProductRegistrationEngineReleaseManifest({
      gitCommit: buildId,
      supplierProfileVersion,
      referenceDate,
      corpusHash,
      termsPolicyHash: termsPolicy.policy_hash,
    });
    const releaseManifestHash = productRegistrationEngineReleaseHash(releaseManifest);
    const startClaim = randomUUID();
    const { data: claimData, error: claimError } = await supabaseAdmin.rpc('create_product_registration_benchmark_run_v2', {
      p_tenant_id: tenantId,
      p_corpus_version: corpusVersion,
      p_input_kind: inputKind,
      p_release_manifest: releaseManifest,
      p_release_manifest_hash: releaseManifestHash,
      p_start_claim: startClaim,
    });
    if (claimError) throw claimError;
    const claim = jsonObject(claimData);
    const benchmarkRunId = typeof claim?.benchmarkRunId === 'string' ? claim.benchmarkRunId : '';
    if (!benchmarkRunId) throw new Error('BENCHMARK_RUN_CLAIM_INVALID');
    if (claim?.claimed !== true) {
      return apiResponse({ ok: true, data: { benchmarkRunId, dedupeHit: true } }, {
        status: 202,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    const workflowRun = await start(productRegistrationBenchmarkV2Workflow, [{
      tenantId,
      benchmarkRunId,
      releaseManifest,
      termsPolicy,
    }]);
    const { error: bindError } = await supabaseAdmin.rpc('bind_product_registration_benchmark_workflow_run_v2', {
      p_tenant_id: tenantId,
      p_benchmark_run_id: benchmarkRunId,
      p_start_claim: startClaim,
      p_workflow_run_id: workflowRun.runId,
    });
    if (bindError) {
      await workflowRun.cancel().catch(() => undefined);
      throw bindError;
    }
    return apiResponse({ ok: true, data: {
      benchmarkRunId,
      workflowRunId: workflowRun.runId,
      releaseManifestHash,
      frozenSourceCount,
      dedupeHit: false,
    } }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[benchmark-run-start]', error);
    return ApiErrors.internalError(sanitizeDbError(error, 'benchmark 실행을 시작하지 못했습니다.'));
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
