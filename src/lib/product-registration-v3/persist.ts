import type { SupabaseClient } from '@supabase/supabase-js';
import type { V3PipelineResult } from './types';

export async function persistProductRegistrationDraftV3(
  sb: SupabaseClient,
  input: {
    packageId?: string | null;
    rawText: string;
    sourceType?: string | null;
    supplierHint?: string | null;
    documentType?: string | null;
    result: V3PipelineResult;
  },
): Promise<{ id: string | null; error: string | null }> {
  try {
    const status = input.result.gate_result.status === 'ready_to_publish'
      ? 'ready_to_publish'
      : input.result.gate_result.status === 'blocked'
        ? 'blocked'
        : 'needs_review';
    const payload = {
      package_id: input.packageId ?? null,
      raw_text: input.rawText,
      raw_text_hash: input.result.raw_text_hash,
      source_type: input.sourceType ?? null,
      supplier_hint: input.supplierHint ?? null,
      document_type: input.documentType ?? input.result.structure_plan.document_type,
      structure_plan: input.result.structure_plan,
      ledger: input.result.ledger,
      evidence_index: input.result.source_index,
      match_summary: input.result.match_summary,
      gate_result: input.result.gate_result,
      status,
    };
    const { data, error } = await sb
      .from('product_registration_drafts')
      .insert(payload)
      .select('id')
      .single();
    if (error) return { id: null, error: error.message };
    return { id: (data as { id?: string } | null)?.id ?? null, error: null };
  } catch (error) {
    return { id: null, error: error instanceof Error ? error.message : String(error) };
  }
}
