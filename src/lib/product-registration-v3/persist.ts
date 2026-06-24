import type { SupabaseClient } from '@supabase/supabase-js';
import type { V3EntityReviewItem, V3PipelineResult } from './types';

const ATTRACTION_NAME_SUFFIX_RE =
  /([\w\uac00-\ud7a3·().-]{2,}(?:공원|동굴|유람선|쇼|산|봉|탑|시장|재래시장|마을|거리|호수|폭포|사원|왕궁|바자|나이트마켓|온천|계곡|협곡|전망대|박물관|기념관|성|궁|잔도|화랑))(?:\s*\([^)]*\))?$/i;
const NON_MASTER_ATTRACTION_FRAGMENT_RE =
  /^(?:상기\s*일정|현지\s*사정|항공\s*및|셔틀\s*버스|셔틀버스|차창|드넓은\s*파노라마|호수\s*위\s*황금|눈앞\s*가득한|발레의\s*조합|장예모\s*감독|강\s*위에서|도심\s*속|은빛\s*종유석|코끼리가\s*강물을|한편의\s*영화보다|빛으로\s*물든|발아래\s*펼쳐지는|계림에서\s*만나는|계림의\s*상징|다랑논|유람선\s*위에서|중국\s*전통\s*서커스)$/;
const NON_MASTER_ATTRACTION_EXACT_RE =
  /^(?:일반석|전동카\+트레킹|양\s*삭|용\s*승|백\s*사)$/;
const GENERIC_HOTEL_EVENT_RE = /^(?:호텔\s*조식\s*후(?:\s*\[[^\]]+\])?|호텔\s*투숙\s*및\s*휴식)$/;

function normalizeHotelQueueLabel(raw: string): string | null {
  if (GENERIC_HOTEL_EVENT_RE.test(raw)) return null;
  return raw
    .replace(/^HOTEL\s*:\s*/i, '')
    .replace(/\s*또는\s*동급.*$/i, '')
    .replace(/\s*\((?:준|정)?\s*\d\s*성급?\)\s*$/i, '')
    .trim() || null;
}

function normalizeQueueLabel(item: V3EntityReviewItem): { activity: string; rawLabel: string } | null {
  const raw = item.raw_text.replace(/\s+/g, ' ').replace(/^[\s▶●•·◆◇■□★☆+\-♣∎※()]+/, '').trim();
  const evidenceQuote = item.evidence.quote?.replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  if (item.category === 'hotel') {
    const hotelLabel = normalizeHotelQueueLabel(raw);
    return hotelLabel ? { activity: hotelLabel, rawLabel: hotelLabel } : null;
  }
  if (item.category !== 'attraction') {
    return { activity: raw, rawLabel: evidenceQuote || raw };
  }

  const suffix = raw.match(ATTRACTION_NAME_SUFFIX_RE)?.[1]?.trim();
  if (suffix) {
    return { activity: suffix, rawLabel: suffix };
  }
  if (NON_MASTER_ATTRACTION_FRAGMENT_RE.test(raw)) return null;
  if (NON_MASTER_ATTRACTION_EXACT_RE.test(raw)) return null;
  if (/[\uac00-\ud7a3]/.test(raw) && raw.length > 18 && !/[()[\]【】]/.test(raw)) return null;
  return { activity: raw, rawLabel: evidenceQuote || raw };
}

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
  const items: V3EntityReviewItem[] = input.result.match_summary.entity_summary?.review_items
    ?? input.result.match_summary.unmatched.map(item => ({
      raw_text: item.raw_text,
      category: 'attraction' as const,
      day_number: item.day_number,
      evidence: item.evidence,
      confidence: 0.6,
      suggested_action: 'needs_review' as const,
      customer_visible: true,
      blocks_publish: true,
      suggested_resolution: { category: 'attraction', policy: 'match-existing-only-no-auto-create' },
    }));
  if (items.length === 0) return { saved: 0, error: null };

  let saved = 0;
  for (const item of items) {
    const queueLabel = normalizeQueueLabel(item);
    if (!queueLabel) continue;
    try {
      const rpc = await sb.rpc('upsert_unmatched_activity', {
        p_activity: queueLabel.activity,
        p_package_id: input.packageId ?? null,
        p_package_title: input.packageTitle ?? null,
        p_day_number: item.day_number,
        p_country: input.destination ?? null,
        p_region: input.destination ?? null,
        p_segment_kind_guess: item.category,
        p_confidence: item.confidence,
        p_suggested_action: item.suggested_action,
        p_suggested_resolution: item.suggested_resolution,
        p_raw_label: queueLabel.rawLabel,
        p_source_context: {
          draft_id: input.draftId ?? null,
          package_id: input.packageId ?? null,
          package_title: input.packageTitle ?? null,
          destination: input.destination ?? null,
          customer_visible: item.customer_visible,
          blocks_publish: item.blocks_publish,
          evidence: item.evidence,
        },
        p_classification_version: 'product-registration-v3-entity-v1',
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
        activity: queueLabel.activity,
        package_id: input.packageId ?? null,
        package_title: input.packageTitle ?? null,
        day_number: item.day_number,
        country: input.destination ?? null,
        region: input.destination ?? null,
        occurrence_count: 1,
        status: 'pending',
        segment_kind_guess: item.category,
        raw_label: queueLabel.rawLabel,
        normalizer_version: 'product-registration-v3',
        confidence: item.confidence,
        suggested_action: item.suggested_action,
        suggested_resolution: item.suggested_resolution,
        source_context: {
          draft_id: input.draftId ?? null,
          package_id: input.packageId ?? null,
          package_title: input.packageTitle ?? null,
          destination: input.destination ?? null,
          customer_visible: item.customer_visible,
          blocks_publish: item.blocks_publish,
          evidence: item.evidence,
        },
        classification_version: 'product-registration-v3-entity-v1',
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
