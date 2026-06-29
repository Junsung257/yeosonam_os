import type { ExtractedData, PriceTier } from '@/lib/parser';
import type { PriceDate } from '@/lib/price-dates';
import type { LeakIncident } from '@/lib/customer-leak-sanitizer';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
import type { RenderPackageInput } from '@/lib/render-contract';
import type { UploadDeliverabilityResult } from './deliverability-gate';
import type { UploadDestinationResolution } from './destination-resolution';
import type { HumanReaderResult } from './ai-human-reader';
import type { UploadItineraryNormalizationResult } from './itinerary-normalization';
import type { PriceRedTeamAuditResult } from './price-red-team-auditor';
import type { UploadPriceRecoveryResult } from './price-recovery';
import type { ExcludedPriceCandidate } from '@/lib/source-price-date-repair';

export type ProductRegistrationEvidence = {
  rawTextLength: number;
  rawTextHash: string;
  sourceDocuments?: SourceEvidenceDocument[];
  priceSource: string;
  v3DraftStatus: string | null;
  v3RawTextHash: string | null;
  spans: SourceEvidenceSpan[];
  humanReader?: Pick<
    HumanReaderResult,
    'source' | 'priceSource' | 'uncertainties'
  > & {
    pricePairCount: number;
    itineraryEventCount: number;
    entityMentionCount: number;
  };
  priceAudit?: PriceRedTeamAuditResult;
};

export type SourceEvidenceDocumentRole =
  | 'original'
  | 'parser'
  | 'document'
  | 'section'
  | 'analysis'
  | 'legacy';

export type SourceEvidenceDocument = {
  sourceId: 'original_raw' | 'parser_raw' | 'document_raw' | 'section_raw' | 'analysis_normalized' | string;
  rawTextHash: string;
  rawTextLength: number;
  role: SourceEvidenceDocumentRole;
  label?: string | null;
};

export type SourceEvidenceSpan = {
  field: string;
  rawTextHash: string;
  sourceId?: SourceEvidenceDocument['sourceId'] | null;
  start: number;
  end: number;
  quote: string;
  productIndex?: number | null;
  sourceKind?: 'line' | 'table_cell' | 'section' | 'document';
  sectionKey?: string | null;
  lineIndex?: number | null;
  rowIndex?: number | null;
  columnIndex?: number | null;
  confidence: number;
};

export type ProductRegistrationIdentity = {
  title: string | null;
  destination: string | null;
  destinationCode: string | null;
  internalCode: string | null;
  departureCode: string | null;
  supplierCode: string | null;
  durationDays: number | null;
  airline: string | null;
};

export type ProductRegistrationPricing = {
  ok: boolean;
  source: string;
  tiers: PriceTier[];
  productPrices: ProductPriceRowInput[];
  priceDates: PriceDate[];
  minPrice: number | null;
  selectedPriceBasis: string | null;
  optionalPriceCandidatesExcluded: boolean;
  excludedPriceCandidates?: ExcludedPriceCandidate[];
  failures: string[];
};

export type ProductRegistrationSanitization = {
  leakScore: number;
  incidents: LeakIncident[];
};

export type ProductRegistrationResult = {
  identity: ProductRegistrationIdentity;
  pricing: ProductRegistrationPricing;
  itinerary: UploadItineraryNormalizationResult;
  destination: UploadDestinationResolution;
  renderInput: RenderPackageInput | null;
  extractedData: ExtractedData;
  sanitization: ProductRegistrationSanitization;
  priceRecovery: UploadPriceRecoveryResult;
  deliverability: UploadDeliverabilityResult;
  evidence: ProductRegistrationEvidence;
  confidence: number | null;
  failures: string[];
  warnings: string[];
  publishable: boolean;
};

/**
 * Canonical product-registration object.
 *
 * All upload extraction paths must converge here before any persistence rows are
 * built. Keep this alias as the reader-facing contract even when the underlying
 * shape evolves.
 */
export type StandardProductRegistrationObject = ProductRegistrationResult;
