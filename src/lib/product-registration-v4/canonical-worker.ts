import type { SupabaseClient } from '@supabase/supabase-js';

import {
  evaluateProductRegistrationV3Gate,
  ledgerToRenderPackageInputs,
  runProductRegistrationV3,
} from '@/lib/product-registration-v3';
import type { AttractionData } from '@/lib/attraction-matcher';
import { splitCatalogByItineraryHeaders } from '@/lib/parser/catalog-pre-split';
import { buildSupplierRawDeterministicItinerary } from '@/lib/supplier-raw-deterministic-facts';
import { extractHeroContextL1 } from '@/lib/parser/llm/section-extractors';
import { commitCanonicalRevisionAtomic } from '@/lib/product-registration-authority/repository';
import { describeRegistrationError, registrationErrorCode } from '@/lib/product-registration-authority/errors';
import { buildProductRegistrationV6DomainProjection } from '@/lib/product-registration-v6/domain-projections';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';

import { getDocumentIRValidationErrors, sha256Hex } from './document-ir';
import { evaluateCanonicalCompleteness, type CanonicalCompleteness } from './completeness';
import { getProductRegistrationV4Job, transitionProductRegistrationV4Job } from './jobs';
import {
  buildProductRegistrationV5Revision,
  stableJson,
} from './revision';
import { buildV3V5CriticalDiff } from './shadow-diff';
import type { DocumentIR, ProductRegistrationV4JobRecord } from './types';
import { buildDocumentIrTableItinerary } from './table-grid-itinerary';
import { buildDocumentIrTableCommercialTerms } from './table-grid-commercial-terms';

export const PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION = 'v6-canonical-2026-08-12.2';

export function canonicalNormalizationJobStatus(input: {
  normalizationStatus: CanonicalNormalization['status'];
  workflowEnabled: boolean;
}): ProductRegistrationV4JobRecord['status'] {
  if (input.normalizationStatus === 'complete') return 'processing';
  return input.workflowEnabled ? 'processing' : 'failed';
}

export type CanonicalSection = {
  index: number;
  sectionKey: string;
  titleHint: string | null;
  rawText: string;
  rawTextHash: string;
  sourceNodeIds: string[];
  evidence: Array<{ nodeId: string; quoteHash: string; quote: string }>;
};

export type CanonicalNormalization = {
  version: typeof PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION;
  sourceDocumentId: string;
  extractionId: string;
  rawTextHash: string;
  sections: CanonicalSection[];
  canonicalPayload: {
    sections: Array<Record<string, unknown>>;
    lineage?: {
      attractionMasterHash: string | null;
    };
  };
  lineage: {
    attractionMasterHash: string | null;
  };
  qualityDiagnostics: {
    sectionCount: number;
    normalizedSectionCount: number;
    blockedSectionCount: number;
    segmentationSource: 'catalog-pre-split' | 'single-document';
    gateStatuses: string[];
    completeness: {
      confirmedCount: number;
      pendingSupplierCount: number;
      conflictingCount: number;
      unavailableCount: number;
      publicReadySectionCount: number;
      verifiedSectionCount: number;
      degradedSectionCount: number;
      blockedSectionCount: number;
      degradedReasons: string[];
      blockers: string[];
      fields: CanonicalCompleteness['fields'];
    };
  };
  status: 'complete' | 'needs_review';
};

async function loadActiveAttractions(supabase: SupabaseClient): Promise<AttractionData[]> {
  const rows: AttractionData[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id, name, country, region, aliases, mrt_gid, is_active, customer_publishable')
      .eq('is_active', true)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`ATTRACTION_MASTER_UNAVAILABLE:${error.message}`);
    const page = (data ?? []) as unknown as AttractionData[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  if (rows.length === 0) throw new Error('ATTRACTION_MASTER_EMPTY');
  return rows;
}

function normalizeRawText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function attractionMasterSnapshotHash(attractions: AttractionData[] | undefined): string | null {
  if (!attractions) return null;
  const snapshot = attractions
    .map(attraction => ({
      id: attraction.id,
      name: attraction.name,
      country: attraction.country ?? null,
      region: attraction.region ?? null,
      aliases: [...(attraction.aliases ?? [])].sort(),
      mrt_gid: attraction.mrt_gid ?? null,
      is_active: attraction.is_active ?? null,
      customer_publishable: attraction.customer_publishable ?? null,
    }))
    .sort((left, right) => String(left.id ?? '').localeCompare(String(right.id ?? '')));
  return sha256Hex(stableJson(snapshot));
}

function firstTitleHint(rawText: string): string | null {
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  const candidate = lines.find(line => {
    if (line.length < 3 || line.length > 180) return false;
    if (/^(?:DAY|DAY\s*\d+|\d+\s*일자|제\s*\d+\s*일)$/i.test(line)) return false;
    if (/^(?:출발|판매가|요금|가격|포함|불포함|주의|공지)\s*[:：]?$/u.test(line)) return false;
    return /[\p{L}\p{N}]/u.test(line);
  });
  return candidate ? candidate.slice(0, 240) : null;
}

function firstTitleHintV2(rawText: string): string | null {
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  const candidates = lines.filter(line => {
    if (line.length < 3 || line.length > 180) return false;
    if (/^(?:DAY|DAY\s*\d+|제?\s*\d+\s*일차?|\d+\s*일차?)$/i.test(line)) return false;
    if (/^(?:출발일|상품가|요금|요금표|기간|제외일자|포함내역|불포함내역|안내사항|일정|일자|지역|교통편|시간|식사|최소출발인원|상품명)\s*[:：]?$/u.test(line)) return false;
    if (/^#\s*[^\s#]+(?:\s+#\s*[^\s#]+)*$/u.test(line)) return false;
    return /[\p{L}\p{N}]/u.test(line);
  });
  if (candidates.length === 0) return null;
  const titleKeywords = /(골프|패키지|특가|투어|여행|리조트|크루즈|자유일정|스팟|노팁|노옵션|다색|무제한|출발)/u;
  const scored = candidates.map((line, index) => {
    let score = 0;
    if (titleKeywords.test(line)) score += 10;
    if (/\d+\s*박\s*\d+\s*일|\d+\s*일/u.test(line)) score += 3;
    if (/[!！]/u.test(line)) score += 1;
    if (/^(?:PUS|ICN|BKK|NRT|KIX|BX\d+|LJ\d+|KE\d+|TW\d+|VN\d+|7C\d+)\b/u.test(line)) score -= 8;
    return { line, index, score };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.line.slice(0, 240) ?? null;
}

function sourceEvidenceForSection(documentIr: DocumentIR, rawText: string): {
  sourceNodeIds: string[];
  evidence: Array<{ nodeId: string; quoteHash: string; quote: string }>;
} {
  const sourceNodeIds: string[] = [];
  const evidence: Array<{ nodeId: string; quoteHash: string; quote: string }> = [];
  for (const node of documentIr.nodes) {
    const text = typeof node.text === 'string' ? normalizeRawText(node.text) : '';
    if (!text || text.length < 2 || !rawText.includes(text)) continue;
    sourceNodeIds.push(node.id);
    evidence.push({ nodeId: node.id, quoteHash: sha256Hex(text), quote: text.slice(0, 240) });
  }
  return { sourceNodeIds: [...new Set(sourceNodeIds)], evidence };
}

export function segmentDocumentIR(documentIr: DocumentIR, sourceDocumentId: string): {
  sections: CanonicalSection[];
  segmentationSource: 'catalog-pre-split' | 'single-document';
} {
  const validationErrors = getDocumentIRValidationErrors(documentIr);
  if (validationErrors.length > 0) throw new Error(`DOCUMENT_IR_INVALID:${validationErrors.join(',')}`);
  const fullText = normalizeRawText(documentIr.text);
  if (fullText.length < 10) throw new Error('CANONICAL_SOURCE_TEXT_TOO_SHORT');

  const split = splitCatalogByItineraryHeaders(fullText);
  const rawSections = split.sections.length >= 2
    ? split.sections.map(section => `${split.sharedPrefix ? `${split.sharedPrefix}\n\n---\n\n` : ''}${section}`.trim())
    : [fullText];
  const segmentationSource = rawSections.length >= 2 ? 'catalog-pre-split' : 'single-document';

  return {
    segmentationSource,
    sections: rawSections.map((rawText, index) => {
      const normalized = normalizeRawText(rawText);
      const rawTextHash = sha256Hex(normalized);
      const sectionKey = `${sourceDocumentId}:${index}:${rawTextHash.slice(0, 16)}`;
      const evidence = sourceEvidenceForSection(documentIr, normalized);
      return {
        index,
        sectionKey,
        titleHint: firstTitleHintV2(normalized),
        rawText: normalized,
        rawTextHash,
        sourceNodeIds: evidence.sourceNodeIds,
        evidence: evidence.evidence,
      };
    }),
  };
}

export async function buildCanonicalNormalization(input: {
  documentIr: DocumentIR;
  sourceDocumentId: string;
  extractionId: string;
  attractions?: AttractionData[];
}): Promise<CanonicalNormalization> {
  const segmented = segmentDocumentIR(input.documentIr, input.sourceDocumentId);
  const attractionMasterHash = attractionMasterSnapshotHash(input.attractions);
  const payloadSections: Array<Record<string, unknown>> = [];
  const gateStatuses: string[] = [];
  const v6GateAccepted: boolean[] = [];
  const completenessResults: CanonicalCompleteness[] = [];
  let blockedSectionCount = 0;

  for (const section of segmented.sections) {
    try {
      const v3 = await runProductRegistrationV3(section.rawText, {
        sourceType: input.documentIr.sourceType,
        destination: section.titleHint ?? undefined,
        attractions: input.attractions ?? [],
      });
      const tableItinerary = buildDocumentIrTableItinerary({
        documentIr: input.documentIr,
        sectionRawText: section.rawText,
      });
      const tableCommercialTerms = buildDocumentIrTableCommercialTerms({
        documentIr: input.documentIr,
        sectionRawText: section.rawText,
      });
      if (tableItinerary) {
        for (const variant of v3.ledger.variants) {
          variant.days = tableItinerary.days;
          variant.flight_segments = tableItinerary.flightSegments;
          variant.duration_days = tableItinerary.days.length;
          variant.nights = tableItinerary.days.filter(day => (
            typeof day.hotel.raw_text === 'string' && day.hotel.raw_text.trim().length > 0
          )).length;
          variant.evidence_coverage.itinerary = true;
          variant.evidence_coverage.flight = tableItinerary.flightSegments.length > 0;
          variant.evidence_coverage.hotel = tableItinerary.days.some(day => Boolean(day.hotel.raw_text));
          variant.evidence_coverage.meals = tableItinerary.days.some(day => (
            Boolean(day.meals.breakfast.raw_text || day.meals.lunch.raw_text || day.meals.dinner.raw_text)
          ));
        }
      }
      if (tableCommercialTerms) {
        for (const variant of v3.ledger.variants) {
          variant.inclusions = tableCommercialTerms.inclusions;
          variant.exclusions = tableCommercialTerms.exclusions;
          variant.evidence_coverage.inclusions = true;
          variant.evidence_coverage.exclusions = true;
        }
      }
      v3.gate_result = evaluateProductRegistrationV3Gate(v3.structure_plan, v3.ledger, v3.match_summary);
      v3.render_contract_preview = ledgerToRenderPackageInputs(v3.ledger);
      const gateStatus = String(v3.gate_result.status ?? 'unknown');
      gateStatuses.push(gateStatus);
      if (gateStatus === 'blocked') blockedSectionCount += 1;
      const payloadSection: Record<string, unknown> = {
        index: section.index,
        sectionKey: section.sectionKey,
        titleHint: section.titleHint,
        destinationHint: extractHeroContextL1(section.rawText).destination ?? null,
        rawTextHash: section.rawTextHash,
        sourceNodeIds: section.sourceNodeIds,
        evidence: section.evidence,
        v3: {
          raw_text_hash: v3.raw_text_hash,
          structure_plan: v3.structure_plan,
          ledger: v3.ledger,
          match_summary: v3.match_summary,
          gate_result: v3.gate_result,
          // The deterministic ledger may choose a short filter header (for example
          // "#방콕") as its first title part. The canonical section title is selected
          // from the complete source section and is therefore the safer customer label.
          render_contract_preview: v3.render_contract_preview.map(preview => ({
            ...preview,
            title: section.titleHint ?? preview.title,
          })),
        },
        deterministicItinerary: tableItinerary
          ? {
              meta: {
                source: 'document_ir_table',
                table_id: tableItinerary.tableId,
                days: tableItinerary.days.length,
              },
              days: tableItinerary.days,
              flight_segments: tableItinerary.flightSegments,
            }
          : buildSupplierRawDeterministicItinerary(section.rawText),
        tableGridItinerary: tableItinerary
          ? { tableId: tableItinerary.tableId, sourceNodeIds: tableItinerary.sourceNodeIds }
          : null,
        tableGridCommercialTerms: tableCommercialTerms
          ? { tableId: tableCommercialTerms.tableId, sourceNodeIds: tableCommercialTerms.sourceNodeIds }
          : null,
      };
      const completeness = evaluateCanonicalCompleteness({
        rawText: section.rawText,
        canonicalSection: payloadSection,
        sectionIndex: section.index,
      });
      const failedV3Checks = v3.gate_result.checks.filter(check => check.status === 'fail');
      const onlySafeDegradedV3Failures = failedV3Checks.length > 0 && failedV3Checks.every(check =>
        check.id.endsWith('.flight')
        || check.id.endsWith('.flight_times_complete')
        || check.id.endsWith('.hotel_or_notice')
      );
      v6GateAccepted.push(
        gateStatus === 'ready_to_publish'
        || (completeness.publicationOutcome === 'degraded' && onlySafeDegradedV3Failures),
      );
      completenessResults.push(completeness);
      payloadSections.push({ ...payloadSection, completeness });
    } catch (error) {
      blockedSectionCount += 1;
      gateStatuses.push('error');
      v6GateAccepted.push(false);
      payloadSections.push({
        index: section.index,
        sectionKey: section.sectionKey,
        titleHint: section.titleHint,
        rawTextHash: section.rawTextHash,
        sourceNodeIds: section.sourceNodeIds,
        evidence: section.evidence,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allSectionsReady = gateStatuses.length === segmented.sections.length
    && v6GateAccepted.length === segmented.sections.length
    && v6GateAccepted.every(Boolean)
    && completenessResults.length === segmented.sections.length
    && completenessResults.every(result => result.publicReady);

  return {
    version: PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
    sourceDocumentId: input.sourceDocumentId,
    extractionId: input.extractionId,
    rawTextHash: sha256Hex(normalizeRawText(input.documentIr.text)),
    sections: segmented.sections,
    canonicalPayload: {
      sections: payloadSections,
      lineage: { attractionMasterHash },
    },
    lineage: { attractionMasterHash },
    qualityDiagnostics: {
      sectionCount: segmented.sections.length,
      normalizedSectionCount: payloadSections.filter(section => !section.error).length,
      blockedSectionCount,
      segmentationSource: segmented.segmentationSource,
      gateStatuses,
      completeness: {
        confirmedCount: completenessResults.reduce((sum, item) => sum + item.confirmedCount, 0),
        pendingSupplierCount: completenessResults.reduce((sum, item) => sum + item.pendingSupplierCount, 0),
        conflictingCount: completenessResults.reduce((sum, item) => sum + item.conflictingCount, 0),
        unavailableCount: completenessResults.reduce((sum, item) => sum + item.unavailableCount, 0),
        publicReadySectionCount: completenessResults.filter(item => item.publicReady).length,
        verifiedSectionCount: completenessResults.filter(item => item.publicationOutcome === 'verified').length,
        degradedSectionCount: completenessResults.filter(item => item.publicationOutcome === 'degraded').length,
        blockedSectionCount: completenessResults.filter(item => item.publicationOutcome === 'blocked').length,
        degradedReasons: completenessResults.flatMap(item => item.degradedReasons),
        blockers: completenessResults.flatMap(item => item.blockers),
        fields: completenessResults.flatMap(item => item.fields),
      },
    },
    // V6 may accept only a narrow, explicit degraded subset (flight time and
    // source-marked equivalent/unconfirmed lodging). Every purchase-critical
    // gap remains fail-closed even if the legacy V3 gate only emitted a warn.
    status: allSectionsReady ? 'complete' : 'needs_review',
  };
}

export async function processProductRegistrationV4CanonicalNormalizationJob(input: {
  supabase: SupabaseClient;
  job: ProductRegistrationV4JobRecord;
}): Promise<{ job: ProductRegistrationV4JobRecord; normalizationId: string; normalization: CanonicalNormalization }> {
  const job = input.job;
  if (!job.source_document_id || !job.extraction_id) throw new Error('CANONICAL_LINEAGE_REQUIRED');

  try {
    const { data: extraction, error: extractionError } = await input.supabase
      .from('product_document_extractions')
      .select('id, source_document_id, document_ir')
      .eq('id', job.extraction_id)
      .eq('source_document_id', job.source_document_id)
      .eq('tenant_id', job.tenant_id)
      .single();
    if (extractionError) throw extractionError;
    const documentIr = extraction?.document_ir as DocumentIR;
    const attractions = await loadActiveAttractions(input.supabase);
    const normalization = await buildCanonicalNormalization({
      documentIr,
      sourceDocumentId: job.source_document_id,
      extractionId: job.extraction_id,
      attractions,
    });
    const { data, error } = await input.supabase
      .from('product_registration_v4_normalizations')
      .upsert({
        tenant_id: job.tenant_id,
        job_id: job.id,
        source_document_id: job.source_document_id,
        extraction_id: job.extraction_id,
        normalization_version: normalization.version,
        raw_text_hash: normalization.rawTextHash,
        sections: normalization.sections,
        canonical_payload: normalization.canonicalPayload,
        quality_diagnostics: normalization.qualityDiagnostics,
        status: normalization.status,
      }, { onConflict: 'job_id,normalization_version,raw_text_hash' })
      .select('id')
      .single();
    if (error) throw error;
    const normalizationId = String((data as { id?: unknown }).id);
    const v5RevisionIds: string[] = [];
    const catalogProductIds: string[] = [];
    const correctionCatalogProductId = typeof job.v4_stage_state.correctionCatalogProductId === 'string'
      ? job.v4_stage_state.correctionCatalogProductId
      : null;
    const correctionBaseRevisionId = typeof job.v4_stage_state.correctionBaseRevisionId === 'string'
      ? job.v4_stage_state.correctionBaseRevisionId
      : null;
    const correctionProductKey = typeof job.v4_stage_state.correctionProductKey === 'string'
      ? job.v4_stage_state.correctionProductKey
      : null;
    const authorityBindingKind = job.v4_stage_state.authorityBindingKind === 'legacy_backfill'
      ? 'legacy_backfill'
      : 'correction';
    if (correctionCatalogProductId && (
      !correctionProductKey
      || normalization.sections.length !== 1
      || (authorityBindingKind === 'correction' && !correctionBaseRevisionId)
    )) {
      throw new Error('REGISTRATION_CORRECTION_IDENTITY_AMBIGUOUS');
    }
    let v5ShadowDiffSummary: Record<string, unknown> | null = null;
    if (process.env.PRODUCT_REGISTRATION_V5_SHADOW === '1'
      || getProductRegistrationV6RuntimeConfig().workflowEnabled) {
      const { data: legacyDraft, error: legacyDraftError } = await input.supabase
        .from('product_registration_drafts')
        .select('ledger')
        .eq('upload_job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (legacyDraftError) {
        console.warn('[Product Registration V5] V3 shadow diff unavailable:', legacyDraftError.message);
        v5ShadowDiffSummary = { status: 'unavailable', reason: legacyDraftError.message };
      } else if (legacyDraft?.ledger) {
        const diff = buildV3V5CriticalDiff({
          legacyPayload: { sections: [{ v3: { ledger: legacyDraft.ledger } }] },
          canonicalPayload: normalization.canonicalPayload,
        });
        v5ShadowDiffSummary = {
          status: 'complete',
          criticalMismatch: diff.criticalMismatch,
          highMismatch: diff.highMismatch,
          matchedCriticalFieldCount: diff.matchedCriticalFieldCount,
          mismatchedCriticalFieldCount: diff.mismatchedCriticalFieldCount,
          mismatches: diff.diffs.filter(item => item.kind !== 'match').slice(0, 100),
        };
      } else {
        v5ShadowDiffSummary = { status: 'unavailable', reason: 'V3_DRAFT_NOT_FOUND' };
      }
      const shadowDiffBlocked = v5ShadowDiffSummary?.status === 'complete'
        && (v5ShadowDiffSummary.criticalMismatch === true || v5ShadowDiffSummary.highMismatch === true);
      const payloadSections = Array.isArray(normalization.canonicalPayload.sections)
        ? normalization.canonicalPayload.sections
        : [];
      const revisionSlices = normalization.sections.map((section, index) => ({
        sections: [section],
        canonicalPayload: {
          sections: [payloadSections[index] ?? {}],
          lineage: normalization.canonicalPayload.lineage,
        },
      }));
      for (const slice of revisionSlices) {
        const section = slice.sections[0];
        if (!section) throw new Error('REGISTRATION_SECTION_REQUIRED');
        const v5Build = buildProductRegistrationV5Revision({
          tenantId: job.tenant_id,
          packageId: null,
          jobId: job.id,
          normalizationId,
          sourceDocumentId: job.source_document_id,
          extractionId: job.extraction_id,
          normalization: {
            ...normalization,
            lineage: normalization.lineage,
            status: shadowDiffBlocked ? 'needs_review' : normalization.status,
            rawTextHash: slice.sections.length === 1 ? slice.sections[0].rawTextHash : normalization.rawTextHash,
            sections: slice.sections,
            canonicalPayload: slice.canonicalPayload,
          },
        });
        const domainProjection = buildProductRegistrationV6DomainProjection({
          canonicalPayload: slice.canonicalPayload,
          packageId: null,
        });
        if (correctionBaseRevisionId) v5Build.supersedesRevisionId = correctionBaseRevisionId;
        const persisted = await commitCanonicalRevisionAtomic({
          supabase: input.supabase,
          commit: {
            tenantId: job.tenant_id,
            productKey: correctionProductKey ?? `source:${job.source_document_id}:section:${section.sectionKey}`,
            sourceChannel: correctionCatalogProductId ? authorityBindingKind : 'upload',
            operationKey: `kernel:${job.id}:${normalizationId}:${section.sectionKey}:${v5Build.payloadHash}`,
            catalogProductId: correctionCatalogProductId,
            build: v5Build,
            sections: slice.sections,
            domainProjection,
          },
        });
        v5RevisionIds.push(persisted.revisionId);
        catalogProductIds.push(persisted.catalogProductId);
      }
    }
    const updatedJob = await transitionProductRegistrationV4Job({
      supabase: input.supabase,
      jobId: job.id,
      stage: normalization.status === 'complete' ? 'normalized' : 'needs_review',
      status: canonicalNormalizationJobStatus({
        normalizationStatus: normalization.status,
        workflowEnabled: getProductRegistrationV6RuntimeConfig().workflowEnabled,
      }),
      state: {
        normalizationId,
        normalizationVersion: normalization.version,
        ...(v5RevisionIds.length > 0 ? {
          v5RevisionIds,
          v5RevisionId: v5RevisionIds[0],
        } : {}),
        ...(catalogProductIds.length > 0 ? {
          catalogProductIds,
          catalogProductId: catalogProductIds[0],
        } : {}),
        ...(v5ShadowDiffSummary ? { v5ShadowDiff: v5ShadowDiffSummary } : {}),
        rawTextHash: normalization.rawTextHash,
        sectionCount: normalization.qualityDiagnostics.sectionCount,
        normalizedSectionCount: normalization.qualityDiagnostics.normalizedSectionCount,
        blockedSectionCount: normalization.qualityDiagnostics.blockedSectionCount,
        segmentationSource: normalization.qualityDiagnostics.segmentationSource,
      },
      canonicalNormalizationId: normalization.status === 'complete' ? normalizationId : null,
      clearLease: true,
      reviewReasons: normalization.status === 'complete' ? [] : ['CANONICAL_NORMALIZATION_REVIEW_REQUIRED'],
      errorCode: normalization.status === 'complete' ? null : 'CANONICAL_NORMALIZATION_REVIEW_REQUIRED',
      errorDetail: normalization.status === 'complete' ? null : 'One or more canonical sections failed the V3 gate.',
    });
    return { job: updatedJob, normalizationId, normalization };
  } catch (error) {
    const message = describeRegistrationError(error);
    await transitionProductRegistrationV4Job({
      supabase: input.supabase,
      jobId: job.id,
      stage: 'failed',
      status: 'failed',
      errorCode: registrationErrorCode(error, 'CANONICAL_NORMALIZATION_FAILED'),
      errorDetail: message,
      reviewReasons: ['CANONICAL_NORMALIZATION_FAILED'],
    }).catch(() => undefined);
    throw error instanceof Error ? error : new Error(message, { cause: error });
  }
}
