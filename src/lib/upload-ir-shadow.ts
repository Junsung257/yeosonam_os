/**
 * upload IR canary shadow — forward normalize (LLM) 샘플 적재
 *
 * 운영 upload 는 parseDocument 유지, canary 비율만 forward IR 을 병렬 실행해
 * normalized_intakes 에 draft 로 저장 (품질·수렴 비교용).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWithLlm } from './normalize-with-llm';
import { pickCanaryEngine, shouldSampleToIrCanary } from './ir-canary';

export interface UploadIrShadowInput {
  rawText: string;
  rawTextHash: string;
  packageId: string;
  landOperator: string;
  commissionRate: number;
}

export async function runUploadIrShadowIfSampled(
  sb: SupabaseClient,
  input: UploadIrShadowInput,
): Promise<{ sampled: boolean; intakeId?: string; errors?: string[] }> {
  if (!shouldSampleToIrCanary(input.rawTextHash)) {
    return { sampled: false };
  }

  const engine = pickCanaryEngine();
  const norm = await normalizeWithLlm(
    {
      rawText: input.rawText,
      landOperator: input.landOperator,
      commissionRate: input.commissionRate,
    },
    { engine },
  );

  if (!norm.success || !norm.ir) {
    console.warn('[upload-ir-shadow] normalize failed:', norm.errors?.slice(0, 3));
    return { sampled: true, errors: norm.errors ?? ['normalize failed'] };
  }

  const ir = norm.ir;
  // package_id 는 upload 역변환(converted) 스냅샷 전용 — shadow 는 judge_report 로만 연결
  const { data, error } = await sb
    .from('normalized_intakes')
    .insert({
      raw_text: ir.rawText,
      raw_text_hash: ir.rawTextHash,
      ir,
      land_operator: input.landOperator,
      region: ir.meta.region,
      normalizer_version: `${ir.normalizerVersion}-upload-shadow`,
      status: 'draft',
      canary_mode: true,
      judge_report: {
        shadowForPackageId: input.packageId,
        engine,
        tokensInput: norm.tokensUsed?.input ?? 0,
        tokensOutput: norm.tokensUsed?.output ?? 0,
      },
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[upload-ir-shadow] intake insert failed:', error.message);
    return { sampled: true, errors: [error.message] };
  }

  console.log(
    `[upload-ir-shadow] canary draft saved intake=${data.id} engine=${engine} pkg=${input.packageId}`,
  );
  return { sampled: true, intakeId: data.id as string };
}
