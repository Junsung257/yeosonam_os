import { createHash } from 'node:crypto';

import {
  inspectOptionalTourSource,
  type SourceDriftItem,
  type SourceDriftPackage,
} from '@/lib/product-source-drift';

export type SourceEvidenceMatch = 'exact' | 'normalized' | 'none';
export type SourceEvidenceBasis = 'source_context' | 'itinerary_context' | 'none' | 'existing_region';

export type OptionalTourSourceEvidence = {
  tour_index: number;
  name: string;
  region: string | null;
  status: 'verified' | 'review' | 'blocked';
  match: SourceEvidenceMatch;
  basis: SourceEvidenceBasis;
  source_hash: string | null;
  source_offset: { start: number; end: number } | null;
  source_line: number | null;
  quote: string | null;
  context_regions: string[];
  itinerary_regions: string[];
};

export type OptionalTourSourceGate = {
  status: 'pass' | 'review' | 'blocked';
  entries: OptionalTourSourceEvidence[];
  blockers: string[];
  review_required: string[];
};

function normalizedHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function lineAtOffset(rawText: string, offset: number | null): number | null {
  if (!rawText || offset === null || offset < 0) return null;
  return rawText.slice(0, offset).split(/\r?\n/).length;
}

function sourceMatch(item: SourceDriftItem): SourceEvidenceMatch {
  if (!item.name_found_in_raw_text) return 'none';
  return item.normalized_name_match ? 'normalized' : 'exact';
}

function buildEntry(
  item: SourceDriftItem,
  rawText: string,
  rawHash: string | null,
): OptionalTourSourceEvidence {
  const match = sourceMatch(item);
  const contextRegions = item.context_regions;
  const region = item.suggested_region;
  const basis: SourceEvidenceBasis = item.current_region
    ? 'existing_region'
    : item.confidence === 'source_context' && contextRegions.length === 1
      ? 'source_context'
      : item.itinerary_regions.length === 1
        ? 'itinerary_context'
        : 'none';
  const status: OptionalTourSourceEvidence['status'] = item.current_region
    ? 'verified'
    : match !== 'none' && basis === 'source_context' && Boolean(rawHash)
      ? 'verified'
      : basis === 'itinerary_context' && match !== 'none'
        ? 'review'
        : 'blocked';
  const start = item.source_start;
  const end = item.source_end;

  return {
    tour_index: item.tour_index,
    name: item.name,
    region: item.current_region ?? region ?? null,
    status,
    match,
    basis,
    source_hash: rawHash,
    source_offset: start === null || end === null ? null : { start, end },
    source_line: lineAtOffset(rawText, start),
    quote: item.context_excerpt,
    context_regions: contextRegions,
    itinerary_regions: item.itinerary_regions,
  };
}

/**
 * Shared source-of-truth contract for optional-tour region data.
 * It is deliberately pure: callers decide whether to persist a review record
 * or block a publication; this function never guesses from title/destination.
 */
export function evaluateOptionalTourSourceEvidence(pkg: SourceDriftPackage): OptionalTourSourceGate {
  const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  const suppliedHash = typeof pkg.raw_text_hash === 'string' && pkg.raw_text_hash.trim()
    ? pkg.raw_text_hash.trim()
    : null;
  const actualHash = rawText ? normalizedHash(rawText) : null;
  const hashValid = Boolean(suppliedHash && actualHash && suppliedHash === actualHash);
  const items = inspectOptionalTourSource(pkg);
  const entries = items.map(item => buildEntry(item, rawText, suppliedHash));
  const blockers: string[] = [];
  const reviewRequired: string[] = [];

  const hasOptionalTours = Array.isArray(pkg.optional_tours) && pkg.optional_tours.length > 0;
  if (hasOptionalTours && !rawText) {
    blockers.push('optional_tour_source_missing:raw_text');
  }
  if (hasOptionalTours && rawText && !suppliedHash) {
    blockers.push('optional_tour_source_missing:raw_text_hash');
  }
  if (rawText && suppliedHash && actualHash && suppliedHash !== actualHash) {
    blockers.push('optional_tour_source_hash_mismatch');
  }
  for (const entry of entries) {
    if (entry.status === 'blocked') blockers.push(`optional_tour_source_missing:${entry.tour_index}:${entry.name}`);
    if (entry.status === 'review') reviewRequired.push(`optional_tour_source_review:${entry.tour_index}:${entry.name}`);
  }
  const status: OptionalTourSourceGate['status'] = blockers.length > 0
    ? 'blocked'
    : reviewRequired.length > 0 || (entries.length > 0 && !hashValid)
      ? 'review'
      : 'pass';

  return { status, entries, blockers, review_required: reviewRequired };
}

export function sourceEvidenceAuditPayload(
  pkg: SourceDriftPackage,
): OptionalTourSourceGate & { raw_text_hash: string | null } {
  return {
    ...evaluateOptionalTourSourceEvidence(pkg),
    raw_text_hash: typeof pkg.raw_text_hash === 'string' ? pkg.raw_text_hash : null,
  };
}
