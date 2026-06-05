import type { SupabaseClient } from '@supabase/supabase-js';
import type { V3PipelineResult } from './types';

async function queueUnmatchedAttractions(
  sb: SupabaseClient,
  input: {
    packageId?: string | null;
    packageTitle?: string | null;
    destination?: string | null;
    draftId?: string | null;
    result: V3PipelineResult;
  },
): Promise<{ saved: number; error: string | null }> {
  const items = input.result.match_summary.unmatched;
  if (items.length === 0) return { saved: 0, error: null };

  let saved = 0;
  for (const item of items) {
    try {
      const rpc = await sb.rpc('upsert_unmatched_activity', {
        p_activity: item.raw_text,
        p_package_id: input.packageId ?? null,
        p_package_title: input.packageTitle ?? null,
        p_day_number: item.day_number,
        p_country: input.destination ?? null,
        p_region: input.destination ?? null,
      }).single();
      if (!rpc.error) {
        saved++;
        continue;
      }
    } catch {
      // Fall back to table upsert below when the RPC is unavailable in older environments.
    }

    const { error } = await sb
      .from('unmatched_activities')
      .upsert({
        activity: item.raw_text,
        package_id: input.packageId ?? null,
        package_title: input.packageTitle ?? null,
        day_number: item.day_number,
        country: input.destination ?? null,
        region: input.destination ?? null,
        occurrence_count: 1,
        status: 'pending',
        segment_kind_guess: 'attraction',
        raw_label: item.evidence.quote,
        normalizer_version: 'product-registration-v3',
        confidence: 0.6,
        note: input.draftId ? `Queued from product_registration_drafts ${input.draftId}` : 'Queued from product_registration_v3',
      }, { onConflict: 'unmatched_scope_key,activity' });
    if (error) return { saved, error: error.message };
    saved++;
  }

  return { saved, error: null };
}

export async function persistProductRegistrationDraftV3(
  sb: SupabaseClient,
  input: {
    packageId?: string | null;
    packageTitle?: string | null;
    rawText: string;
    sourceType?: string | null;
    supplierHint?: string | null;
    destination?: string | null;
    documentType?: string | null;
    result: V3PipelineResult;
  },
): Promise<{ id: string | null; error: string | null; queuedUnmatched: number }> {
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
    if (error) return { id: null, error: error.message, queuedUnmatched: 0 };
    const id = (data as { id?: string } | null)?.id ?? null;
    const queued = await queueUnmatchedAttractions(sb, {
      packageId: input.packageId,
      packageTitle: input.packageTitle,
      destination: input.destination,
      draftId: id,
      result: input.result,
    });
    if (queued.error) return { id, error: queued.error, queuedUnmatched: queued.saved };
    return { id, error: null, queuedUnmatched: queued.saved };
  } catch (error) {
    return { id: null, error: error instanceof Error ? error.message : String(error), queuedUnmatched: 0 };
  }
}
