import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateMasterCandidate } from '@/lib/entity-master-candidates';
import { classifyUnmatchedActivity } from '@/lib/unmatched-classifier';
import type { V3EntityReviewItem, V3PipelineResult } from './types';

const ATTRACTION_NAME_SUFFIX_RE =
  /([\w\uac00-\ud7a3·().-]{2,}(?:공원|동굴|유람선|쇼|산|봉|탑|시장|재래시장|마을|거리|호수|폭포|사원|왕궁|바자|나이트마켓|온천|계곡|협곡|전망대|박물관|기념관|성|궁|잔도|화랑))(?:\s*\([^)]*\))?$/i;
const NON_MASTER_ATTRACTION_FRAGMENT_RE =
  /^(?:상기\s*일정|현지\s*사정|항공\s*및|셔틀\s*버스|셔틀버스|차창|드넓은\s*파노라마|호수\s*위\s*황금|눈앞\s*가득한|발레의\s*조합|장예모\s*감독|강\s*위에서|도심\s*속|은빛\s*종유석|코끼리가\s*강물을|한편의\s*영화보다|빛으로\s*물든|발아래\s*펼쳐지는|계림에서\s*만나는|계림의\s*상징|다랑논|유람선\s*위에서|중국\s*전통\s*서커스)$/;
const NON_MASTER_ATTRACTION_EXACT_RE =
  /^(?:일반석|전동카\+트레킹|양\s*삭|용\s*승|백\s*사)$/;
const GENERIC_HOTEL_EVENT_RE = /^(?:호텔\s*조식\s*후(?:\s*\[[^\]]+\])?|호텔\s*투숙\s*및\s*휴식)$/;

const KO_ATTRACTION_NAME_SUFFIX_RE =
  /([\w\uac00-\ud7a3().·・\-\s]{2,}?(?:공원|사원|성당|교회|유적|박물관|기념관|거리|시장|야시장|비치|해변|광장|전망대|케이블카|마을|폭포|온천|정원|호수|유람선|공연))(?:\s*\([^)]*\))?$/i;
const KO_NON_MASTER_ATTRACTION_FRAGMENT_RE =
  /^(?:상기\s*일정|아래\s*일정|항공\s*및\s*현지\s*사정|전용\s*버스|전용차|차창|호텔\s*조식|호텔\s*투숙|미팅|픽업|샌딩|예약\s*가능|발레단\s*조합|장예모\s*감독|비로\s*물든|제공\s*X|준비물|필수\s*관광|출발\s*마감)/i;
const KO_NON_MASTER_ATTRACTION_EXACT_RE =
  /^(?:오\s*전|오\s*후|자유\s*시간|자유\s*일정|일반\s*아동.*|호텔|리조트|조식|중식|석식)$/i;
const KO_GENERIC_HOTEL_EVENT_RE =
  /^(?:호텔\s*조식\s*후.*|호텔\s*투숙\s*및\s*휴식|HOTEL\s*:\s*(?:상기\s*)?호텔.*동급.*)$/i;

function normalizeHotelQueueLabel(raw: string): string | null {
  if (GENERIC_HOTEL_EVENT_RE.test(raw) || KO_GENERIC_HOTEL_EVENT_RE.test(raw)) return null;
  return raw
    .replace(/^HOTEL\s*:\s*/i, '')
    .replace(/\s*\((?:준|특)?\s*\d?\s*성급?\)\s*$/i, '')
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

function shouldQueueUnmatchedActivity(item: V3EntityReviewItem): boolean {
  const classified = classifyUnmatchedActivity(item.raw_text, item.category);
  return (
    item.category === 'attraction' &&
    classified.category === 'attraction' &&
    (item.blocks_publish || item.suggested_action === 'needs_review')
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

async function upsertDraftAttractionMasterCandidates(
  sb: SupabaseClient,
  input: {
    packageId?: string | null;
    packageTitle?: string | null;
    destination?: string | null;
    draftId?: string | null;
    result: V3PipelineResult;
  },
): Promise<{ saved: number; error: string | null }> {
  const reviewItems: V3EntityReviewItem[] = input.result.match_summary.entity_summary?.review_items
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
  const items = reviewItems.filter(shouldQueueUnmatchedActivity);
  if (items.length === 0) return { saved: 0, error: null };

  const groups = new Map<string, {
    activity: string;
    rawLabel: string;
    count: number;
    days: Set<number>;
    examples: Array<Record<string, unknown>>;
  }>();

  for (const item of items) {
    const queueLabel = normalizeQueueLabel(item);
    if (!queueLabel) continue;
    const decision = evaluateMasterCandidate({
      rawLabel: queueLabel.activity,
      category: 'attraction',
      country: input.destination ?? null,
      region: input.destination ?? null,
      destination: input.destination ?? null,
      occurrenceCount: 1,
      evidenceCount: 1,
      packageCount: input.packageId ? 1 : 0,
    });
    const group = groups.get(decision.candidateKey) ?? {
      activity: queueLabel.activity,
      rawLabel: queueLabel.rawLabel,
      count: 0,
      days: new Set<number>(),
      examples: [],
    };
    group.count += 1;
    if (item.day_number != null) group.days.add(item.day_number);
    if (group.examples.length < 5) {
      group.examples.push({
        draft_id: input.draftId ?? null,
        package_id: input.packageId ?? null,
        package_title: input.packageTitle ?? null,
        day_number: item.day_number ?? null,
        label: queueLabel.activity,
        evidence: item.evidence,
      });
    }
    groups.set(decision.candidateKey, group);
  }

  const keys = Array.from(groups.keys());
  if (keys.length === 0) return { saved: 0, error: null };

  const { data: existingRows, error: fetchError } = await sb
    .from('entity_master_candidates')
    .select('candidate_key, evidence_count, occurrence_count, package_count, source_context, source_unmatched_ids')
    .in('candidate_key', keys);
  if (fetchError) return { saved: 0, error: fetchError.message };

  const existingByKey = new Map(
    ((existingRows ?? []) as Array<Record<string, unknown>>).map(row => [String(row.candidate_key), row]),
  );

  const payload = Array.from(groups.entries()).map(([candidateKey, group]) => {
    const existing = existingByKey.get(candidateKey);
    const sourceContext = existing?.source_context && typeof existing.source_context === 'object'
      ? existing.source_context as Record<string, unknown>
      : {};
    const packageIds = new Set([
      ...stringArray(sourceContext.package_ids),
      ...(input.packageId ? [input.packageId] : []),
    ]);
    const packageTitles = new Set([
      ...stringArray(sourceContext.package_titles),
      ...(input.packageTitle ? [input.packageTitle] : []),
    ]);
    const draftIds = new Set([
      ...stringArray(sourceContext.draft_ids),
      ...(input.draftId ? [input.draftId] : []),
    ]);
    const decision = evaluateMasterCandidate({
      rawLabel: group.activity,
      category: 'attraction',
      country: input.destination ?? null,
      region: input.destination ?? null,
      destination: input.destination ?? null,
      occurrenceCount: Number(existing?.occurrence_count ?? 0) + group.count,
      evidenceCount: Number(existing?.evidence_count ?? 0) + 1,
      packageCount: packageIds.size,
    });

    return {
      candidate_key: candidateKey,
      category: decision.category,
      raw_label: decision.rawLabel,
      normalized_label: decision.normalizedLabel,
      destination_scope: decision.destinationScope,
      country_scope: decision.countryScope,
      region_scope: decision.regionScope,
      evidence_count: Number(existing?.evidence_count ?? 0) + 1,
      occurrence_count: Number(existing?.occurrence_count ?? 0) + group.count,
      package_count: packageIds.size,
      source_unmatched_ids: stringArray(existing?.source_unmatched_ids),
      source_context: {
        ...sourceContext,
        draft_ids: Array.from(draftIds).slice(-20),
        package_ids: Array.from(packageIds).slice(-50),
        package_titles: Array.from(packageTitles).slice(-20),
        examples: [
          ...(Array.isArray(sourceContext.examples) ? sourceContext.examples : []),
          ...group.examples,
        ].slice(-20),
        analyzer: 'product-registration-v3-draft',
        mobile_landing_impact: packageIds.size > 0,
        updated_at: new Date().toISOString(),
      },
      external_sources: [],
      suggested_master: decision.suggestedMaster,
      confidence: decision.confidence,
      promotion_status: decision.promotionStatus,
      auto_action: decision.autoAction,
      decision_reason: decision.decisionReason,
    };
  });

  const { error } = await sb
    .from('entity_master_candidates')
    .upsert(payload, { onConflict: 'candidate_key' });
  if (error) return { saved: 0, error: error.message };
  return { saved: payload.length, error: null };
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
  const reviewItems: V3EntityReviewItem[] = input.result.match_summary.entity_summary?.review_items
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
  const items = reviewItems.filter(shouldQueueUnmatchedActivity);
  if (items.length === 0) return { saved: 0, error: null };

  let saved = 0;
  const terminalConflictMessage = 'pending rows must not have resolved_at';
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
      if (rpc.error.message?.includes(terminalConflictMessage)) {
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
    if (error?.message?.includes(terminalConflictMessage)) continue;
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
    const candidates = await upsertDraftAttractionMasterCandidates(sb, {
      packageId: input.packageId,
      packageTitle: input.packageTitle,
      destination: input.destination,
      draftId: id,
      result: input.result,
    });
    if (candidates.error) return { id, error: candidates.error, queuedUnmatched: queued.saved };
    return { id, error: null, queuedUnmatched: queued.saved };
  } catch (error) {
    return { id: null, error: error instanceof Error ? error.message : String(error), queuedUnmatched: 0 };
  }
}
