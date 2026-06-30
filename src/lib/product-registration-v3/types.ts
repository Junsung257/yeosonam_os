import type { AttractionData } from '@/lib/attraction-matcher';
import type { RenderPackageInput } from '@/lib/render-contract';
import type { StandardNoticeDraft } from './standard-notices';
import type { StructuredFact } from './structured-facts';

export type V3DocumentType = 'catalog' | 'single_package' | 'mixed' | 'unknown';
export type V3PlannerSource = 'deterministic' | 'ai_schema';

export type V3EventType =
  | 'flight'
  | 'meeting'
  | 'transfer'
  | 'attraction'
  | 'activity'
  | 'meal'
  | 'hotel'
  | 'option'
  | 'shopping'
  | 'free_time'
  | 'notice'
  | 'price_noise'
  | 'unknown';

export type V3EntityCategory =
  | 'attraction'
  | 'hotel'
  | 'meal'
  | 'transfer'
  | 'shopping'
  | 'optional_tour'
  | 'free_time'
  | 'notice'
  | 'price_noise'
  | 'unknown';

export type V3EntitySuggestedAction =
  | 'auto_resolve_existing'
  | 'auto_ignore_noise'
  | 'suggest_alias'
  | 'needs_new_master'
  | 'needs_review';

export type V3MatchStatus = 'matched' | 'unmatched' | 'ignored' | 'review';

export interface V3SourceLine {
  lineNumber: number;
  charStart: number;
  charEnd: number;
  quote: string;
}

export interface V3Evidence {
  line_start: number;
  line_end: number;
  char_start: number;
  char_end: number;
  quote: string;
}

export interface V3StructurePlan {
  document_type: V3DocumentType;
  planner_source: V3PlannerSource;
  expected_products: number;
  shared_sections: Array<{ label: string; line_start: number; line_end: number }>;
  product_boundaries: Array<{
    index: number;
    line_start: number;
    line_end: number;
    title_hint: string;
  }>;
  variant_axes: Array<{ name: string; values: string[] }>;
  price_table_location: { line_start: number; line_end: number; label: string } | null;
  price_mapping_strategy: 'single_table' | 'variant_table' | 'none' | 'unknown';
  flight_pattern: {
    outbound_codes: string[];
    inbound_codes: string[];
    meeting_times: string[];
  };
  transport_profile?: {
    requires_air: boolean;
    detected_modes: Array<'air' | 'ferry' | 'cruise' | 'rail' | 'bus' | 'unknown'>;
    air_requirement_reason: string | null;
  };
  itinerary_boundary_pattern: string | null;
  option_section_locations: Array<{ line_start: number; line_end: number; label: string }>;
  shopping_section_locations: Array<{ line_start: number; line_end: number; label: string }>;
  confidence: number;
  unresolved_parts: string[];
}

export interface V3LedgerEvent {
  type: V3EventType;
  time: string | null;
  raw_text: string;
  canonical_id: string | null;
  canonical_type: 'attraction' | 'option' | 'shopping' | 'hotel' | null;
  match_status: V3MatchStatus;
  evidence: V3Evidence;
}

export interface V3PriceCalendarEntry {
  date: string | null;
  label: string;
  amount: number;
  currency: string;
  evidence: V3Evidence;
}

export interface V3OptionCandidate {
  region: string | null;
  city: string | null;
  raw_name: string;
  normalized_name: string;
  category: 'massage' | 'show' | 'cruise' | 'meal_upgrade' | 'activity' | 'ticket' | 'other';
  price_amount: number | null;
  currency: string | null;
  duration_minutes: number | null;
  day_number: number | null;
  evidence: V3Evidence;
  match_status: V3MatchStatus;
}

export interface V3LedgerVariant {
  variant_key: string;
  grade: string | null;
  course: string | null;
  duration_days: number | null;
  nights: number | null;
  title_parts: string[];
  price_calendar: V3PriceCalendarEntry[];
  flight_segments: Array<{
    leg: 'outbound' | 'inbound' | 'unknown';
    code: string;
    dep_time: string | null;
    arr_time: string | null;
    evidence: V3Evidence;
  }>;
  days: Array<{
    day: number;
    route: string[];
    events: V3LedgerEvent[];
    meals: {
      breakfast: Record<string, unknown>;
      lunch: Record<string, unknown>;
      dinner: Record<string, unknown>;
    };
    hotel: Record<string, unknown>;
  }>;
  inclusions: Array<{ value: string; evidence: V3Evidence }>;
  exclusions: Array<{ value: string; evidence: V3Evidence }>;
  options: V3OptionCandidate[];
  shopping: Array<{ value: string; evidence: V3Evidence }>;
  structured_facts: StructuredFact[];
  standard_notices: StandardNoticeDraft[];
  minimum_departure: { value: number; evidence: V3Evidence } | null;
  evidence_coverage: Record<string, boolean>;
}

export interface V3DraftLedger {
  document: {
    type: V3DocumentType;
    expected_products: number;
    variant_axes: Array<{ name: string; values: string[] }>;
  };
  variants: V3LedgerVariant[];
}

export interface V3MatchSummary {
  attraction_matched_count: number;
  attraction_unmatched_count: number;
  option_review_count: number;
  shopping_count: number;
  unmatched: Array<{ raw_text: string; day_number: number | null; evidence: V3Evidence }>;
  entity_summary: V3EntitySummary;
}

export interface V3EntityReviewItem {
  raw_text: string;
  category: V3EntityCategory;
  day_number: number | null;
  evidence: V3Evidence;
  confidence: number;
  suggested_action: V3EntitySuggestedAction;
  customer_visible: boolean;
  blocks_publish: boolean;
  suggested_resolution: Record<string, unknown>;
}

export interface V3EntitySummary {
  counts: Record<V3EntityCategory, number>;
  review_required_count: number;
  attraction_unresolved_count: number;
  shopping_review_needed_count: number;
  option_review_needed_count: number;
  unknown_customer_visible_count: number;
  auto_ignored_noise_count: number;
  meal_structured_count: number;
  transfer_structured_count: number;
  hotel_structured_count: number;
  free_time_structured_count: number;
  review_items: V3EntityReviewItem[];
}

export interface V3GateCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  severity: 'info' | 'medium' | 'high' | 'critical';
  message: string;
}

export interface V3GateResult {
  status: 'ready_to_publish' | 'needs_review' | 'blocked';
  customer_publishable: boolean;
  checks: V3GateCheck[];
}

export interface V3PipelineResult {
  raw_text_hash: string;
  source_index: V3SourceLine[];
  structure_plan: V3StructurePlan;
  ledger: V3DraftLedger;
  match_summary: V3MatchSummary;
  gate_result: V3GateResult;
  render_contract_preview: RenderPackageInput[];
}

export interface V3RunOptions {
  attractions?: AttractionData[];
  destination?: string | null;
  supplierHint?: string | null;
  sourceType?: string | null;
}
