import { parseDocument } from '@/lib/parser';
import { tiersToDatePrices } from '@/lib/price-dates';
import { parseDayTable } from '@/lib/parser/deterministic/day-table';
import type { RenderPackageInput } from '@/lib/render-contract';
import { hashRawText } from '@/lib/source-evidence';
import type {
  ProductRegistrationV2ExecutedProduct,
  ProductRegistrationV2Plan,
} from './types';
import { buildProductEvidenceV2 } from './evidence-verifier';
import { extractCustomerAttractionCandidatesV2 } from './attraction-candidates';

function buildProductRawText(rawText: string, plan: ProductRegistrationV2Plan, index: number): string {
  const text = rawText.replace(/\r\n/g, '\n');
  const boundary = plan.product_boundaries[index];
  if (!boundary) return text;
  const shared = plan.price_table_location
    ? text.slice(plan.price_table_location.start, plan.price_table_location.end).trimEnd()
    : '';
  const section = text.slice(boundary.start, boundary.end).trim();
  return [shared, section].filter(Boolean).join('\n\n---\n\n');
}

function extractShopping(sectionRawText: string): string | null {
  return sectionRawText.match(/쇼핑센터\s*\n([\s\S]*?)(?=비\s*고|일\s*자)/)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim() || null;
}

function withFlightSegments(
  itinerary: ReturnType<typeof parseDayTable>,
  plan: ProductRegistrationV2Plan,
): ProductRegistrationV2ExecutedProduct['itineraryData'] {
  const outbound = plan.flight_pattern.outbound;
  const inbound = plan.flight_pattern.inbound;
  const flight_segments: NonNullable<ProductRegistrationV2ExecutedProduct['itineraryData']['flight_segments']> = [];
  if (outbound) {
    flight_segments.push({
      leg: 'outbound',
      flight_no: outbound.code,
      dep_airport: outbound.depAirport,
      dep_time: outbound.dep,
      arr_airport: outbound.arrAirport,
      arr_time: outbound.arr,
      arr_day_offset: 0,
    });
  }
  if (inbound) {
    flight_segments.push({
      leg: 'inbound',
      flight_no: inbound.code,
      dep_airport: inbound.depAirport,
      dep_time: inbound.dep,
      arr_airport: inbound.arrAirport,
      arr_time: inbound.arr,
      arr_day_offset: 0,
    });
  }
  return {
    ...itinerary,
    highlights: {
      inclusions: [],
      excludes: [],
      shopping: null,
      remarks: [],
    },
    optional_tours: [],
    flight_segments,
  };
}

function collectAttractionCandidates(itineraryData: ProductRegistrationV2ExecutedProduct['itineraryData']): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of itineraryData.days ?? []) {
    for (const item of day.schedule ?? []) {
      if (item.type === 'flight' || item.type === 'hotel') continue;
      if (!item.activity) continue;
      for (const candidate of extractCustomerAttractionCandidatesV2(item.activity, item.note ?? null)) {
        const key = candidate.replace(/\s+/g, '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(candidate);
      }
    }
  }
  return out;
}

export async function executeProductRegistrationV2(
  rawText: string,
  plan: ProductRegistrationV2Plan,
): Promise<ProductRegistrationV2ExecutedProduct[]> {
  const parsed = await parseDocument(Buffer.from(rawText, 'utf8'), 'product-registration-v2.txt');
  const products = parsed.multiProducts ?? [{ extractedData: parsed.extractedData, itineraryData: parsed.itineraryData ?? null }];

  return products.map((product, index) => {
    const sectionRawText = buildProductRawText(rawText, plan, index);
    const dayTable = parseDayTable(sectionRawText);
    const itineraryData = withFlightSegments(dayTable, plan);
    const shopping = extractShopping(sectionRawText);
    const price_dates = tiersToDatePrices(product.extractedData.price_tiers ?? [], {
      packageDepartureDays: product.extractedData.departure_days,
    });
    const renderInput: ProductRegistrationV2ExecutedProduct['renderInput'] = {
      ...(product.extractedData as RenderPackageInput),
      raw_text: sectionRawText,
      raw_text_hash: hashRawText(sectionRawText),
      price_dates,
      itinerary_data: {
        ...itineraryData,
        highlights: {
          ...(itineraryData as unknown as { highlights?: Record<string, unknown> }).highlights,
          shopping,
        },
      },
    };
    const attractionCandidates = collectAttractionCandidates(itineraryData);
    const withoutEvidence: Omit<ProductRegistrationV2ExecutedProduct, 'sourceEvidence'> = {
      index,
      section_raw_text: sectionRawText,
      extractedData: product.extractedData,
      itineraryData: renderInput.itinerary_data as ProductRegistrationV2ExecutedProduct['itineraryData'],
      renderInput,
      attractionCandidates,
      unmatchedAttractionCandidates: attractionCandidates,
    };
    const sourceEvidence = buildProductEvidenceV2(withoutEvidence);
    return {
      ...withoutEvidence,
      sourceEvidence,
    };
  });
}
