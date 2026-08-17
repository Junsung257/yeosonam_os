import { type NextRequest } from 'next/server';

import { ApiErrors, apiResponse } from '@/lib/api-response';
import { resolveAdminActorId, withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  annotationFromJson,
  collectBenchmarkEvidenceAnchors,
  jsonObject,
  resolveBenchmarkTenantId,
} from '@/lib/product-registration-v6/benchmark-admin';
import {
  assertBenchmarkV2Annotation,
  benchmarkAnnotationHash,
} from '@/lib/product-registration-v6/benchmark-ground-truth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) return ApiErrors.unavailable('검수 저장소가 연결되지 않았습니다.');
  const reviewerId = await resolveAdminActorId(request);
  if (!reviewerId) return ApiErrors.forbidden('조정 검수는 로그인한 제3의 관리자 계정으로만 할 수 있습니다.');
  try {
    const body = jsonObject(await request.json());
    const corpusSourceId = typeof body?.corpusSourceId === 'string' ? body.corpusSourceId : '';
    const annotation = annotationFromJson(body?.annotation);
    if (!/^[0-9a-f-]{36}$/iu.test(corpusSourceId) || !annotation) {
      return ApiErrors.badRequest('원문 또는 조정 정답지 형식이 올바르지 않습니다.');
    }
    assertBenchmarkV2Annotation(annotation);
    const tenantId = await resolveBenchmarkTenantId({ request, bodyTenantId: body?.tenantId });
    if (!tenantId) return ApiErrors.notFound('검수할 테넌트를 찾지 못했습니다.');
    const annotationHash = benchmarkAnnotationHash(annotation);
    const { data, error } = await supabaseAdmin.rpc('submit_product_registration_benchmark_review_atomic', {
      p_tenant_id: tenantId,
      p_corpus_source_id: corpusSourceId,
      p_reviewer_id: reviewerId,
      p_reviewer_slot: 'adjudicator',
      p_annotation: annotation,
      p_annotation_hash: annotationHash,
      p_evidence_anchors: collectBenchmarkEvidenceAnchors(annotation),
    });
    if (error) throw error;
    return apiResponse({ ok: true, data: { annotationHash, result: data } }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const message = sanitizeDbError(error, '조정 검수를 저장하지 못했습니다.');
    if (/ALREADY|EXISTS|INDEPENDENT|CONFLICT_REQUIRED/iu.test(message)) return ApiErrors.conflict(message);
    if (/BENCHMARK_.*(?:INVALID|REQUIRED|MISSING)/iu.test(message)) return ApiErrors.badRequest(message);
    console.error('[benchmark-adjudication-submit]', error);
    return ApiErrors.internalError(message);
  }
};

export const POST = withAdminGuard(postHandler);
