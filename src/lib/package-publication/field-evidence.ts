import { createHash } from 'node:crypto';

import type { PublicPackageSnapshot } from './types';

type AnyRecord = Record<string, unknown>;

export type FieldEvidenceRecord = {
  field_path: string;
  normalized_value_hash: string;
  source_section: string;
  evidence_type: 'source_field' | 'approved_derivation';
  extractor_version: string;
  confidence: number;
  validation_status: 'validated';
};

const EVIDENCE_EXTRACTOR_VERSION = 'public-snapshot-evidence-v1';

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as AnyRecord;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stableValue(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(stableValue(value)).digest('hex');
}

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as AnyRecord).length > 0;
  return true;
}

export function buildFieldEvidenceRecords(
  source: AnyRecord,
  snapshot: PublicPackageSnapshot,
): FieldEvidenceRecord[] {
  const candidates: Array<{
    fieldPath: string;
    value: unknown;
    sourceSection: string;
    type: FieldEvidenceRecord['evidence_type'];
    confidence: number;
    sourcePresent?: boolean;
  }> = [
    { fieldPath: 'public_title', value: snapshot.public_title, sourceSection: 'title+destination+duration', type: 'approved_derivation', confidence: 0.95 },
    { fieldPath: 'public_subtitle', value: snapshot.public_subtitle, sourceSection: 'product_summary', type: 'approved_derivation', confidence: 0.9 },
    { fieldPath: 'duration', value: snapshot.duration, sourceSection: 'duration', type: 'source_field', confidence: 1, sourcePresent: hasValue(source.duration) || hasValue(source.duration_days) },
    { fieldPath: 'destinations', value: snapshot.destinations, sourceSection: 'destination', type: 'approved_derivation', confidence: 0.98 },
    { fieldPath: 'price_display', value: snapshot.price_display, sourceSection: 'price_dates+price_tiers', type: 'approved_derivation', confidence: 0.98 },
    { fieldPath: 'option_policy', value: snapshot.option_policy, sourceSection: 'optional_tours+title', type: 'approved_derivation', confidence: 0.95 },
    { fieldPath: 'inclusions_public', value: snapshot.inclusions_public, sourceSection: 'inclusions', type: 'source_field', confidence: 1, sourcePresent: hasValue(source.inclusions) },
    { fieldPath: 'exclusions_public', value: snapshot.exclusions_public, sourceSection: 'excludes', type: 'source_field', confidence: 1, sourcePresent: hasValue(source.excludes) },
    { fieldPath: 'itinerary_public', value: snapshot.itinerary_public, sourceSection: 'itinerary_data', type: 'source_field', confidence: 1, sourcePresent: hasValue(source.itinerary_data) },
    { fieldPath: 'optional_tours_public', value: snapshot.optional_tours_public, sourceSection: 'optional_tours', type: 'approved_derivation', confidence: 0.98 },
    { fieldPath: 'images_public', value: snapshot.images_public, sourceSection: 'approved_images', type: 'approved_derivation', confidence: 0.95 },
    { fieldPath: 'cta_copy', value: snapshot.cta_copy, sourceSection: 'approved_cta_template', type: 'approved_derivation', confidence: 1 },
  ];

  return candidates
    .filter(candidate => hasValue(candidate.value))
    .filter(candidate => candidate.type !== 'source_field' || candidate.sourcePresent === true)
    .map(candidate => ({
      field_path: candidate.fieldPath,
      normalized_value_hash: hashValue(candidate.value),
      source_section: candidate.sourceSection,
      evidence_type: candidate.type,
      extractor_version: EVIDENCE_EXTRACTOR_VERSION,
      confidence: candidate.confidence,
      validation_status: 'validated',
    }));
}
