import type { ExtractedData } from '@/lib/parser';
import type { RenderPackageInput } from '@/lib/render-contract';
import type { SourceEvidenceMap } from '@/lib/source-evidence';

export type ProductRegistrationV2DocumentType =
  | 'multi_variant_catalog'
  | 'single_product'
  | 'unknown';

export type ProductRegistrationV2PlanSource = 'deterministic' | 'ai';

export interface ProductRegistrationV2Boundary {
  index: number;
  start: number;
  end: number;
  titleHint: string;
  variantHints: Record<string, string>;
}

export interface ProductRegistrationV2Plan {
  document_type: ProductRegistrationV2DocumentType;
  planner_source: ProductRegistrationV2PlanSource;
  raw_text_hash: string;
  expected_products: number;
  shared_sections: Array<{
    kind: 'price_table' | 'common_notice' | 'unknown';
    start: number;
    end: number;
    label: string;
  }>;
  product_boundaries: ProductRegistrationV2Boundary[];
  variant_axes: Array<{
    name: string;
    values: string[];
  }>;
  price_table_location: { start: number; end: number; label: string } | null;
  price_mapping_strategy: 'vertical_grade_columns' | 'single_table' | 'unknown';
  flight_pattern: {
    outbound?: { code: string; dep: string; arr: string; depAirport: string; arrAirport: string };
    inbound?: { code: string; dep: string; arr: string; depAirport: string; arrAirport: string };
    meetingTimes: string[];
  };
  itinerary_boundary_pattern: string | null;
  confidence: number;
  unresolved_parts: string[];
}

export interface ProductRegistrationV2ExecutedProduct {
  index: number;
  section_raw_text: string;
  extractedData: ExtractedData;
  itineraryData: {
    meta?: Record<string, unknown> | null;
    highlights?: Record<string, unknown> | null;
    optional_tours?: unknown[];
    days?: Array<{
      day?: number | null;
      regions?: string[] | null;
      schedule?: Array<{
        type?: string | null;
        time?: string | null;
        activity?: string | null;
        transport?: string | null;
        note?: string | null;
      }> | null;
      hotel?: { name?: string | null; grade?: string | number | null; note?: string | null } | null;
    }> | null;
    flight_segments?: Array<{
      leg: 'outbound' | 'inbound';
      flight_no: string;
      dep_airport: string;
      dep_time: string;
      arr_airport: string;
      arr_time: string;
      arr_day_offset: 0 | 1;
    }>;
  };
  renderInput: RenderPackageInput & {
    raw_text: string;
    raw_text_hash: string;
    price_dates?: Array<{ date: string; price: number; child_price?: number; confirmed: boolean }>;
  };
  sourceEvidence: SourceEvidenceMap;
  attractionCandidates: string[];
  unmatchedAttractionCandidates: string[];
}

export interface ProductRegistrationV2GateCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  severity: 'info' | 'medium' | 'high' | 'critical';
}

export interface ProductRegistrationV2GateResult {
  status: 'clean' | 'pending_review' | 'blocked';
  customer_publishable: boolean;
  checks: ProductRegistrationV2GateCheck[];
}

export interface ProductRegistrationV2Result {
  plan: ProductRegistrationV2Plan;
  products: ProductRegistrationV2ExecutedProduct[];
  gate: ProductRegistrationV2GateResult;
}
