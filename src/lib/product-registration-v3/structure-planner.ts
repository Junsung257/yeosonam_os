import type { V3SourceLine, V3StructurePlan } from './types';

const FLIGHT_CODE_RE = /\b[A-Z0-9]{2}\s*\d{3,4}\b/g;
const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
const PRICE_RE = /(?:KRW|₩|원)?\s*([1-9]\d{1,2}(?:,\d{3})+|[1-9]\d{5,})\s*(?:원|KRW)?/i;
const DAY_HEADER_RE = /^(?:day\s*)?(\d{1,2})(?:일차|day|\s*일)?\b/i;
const PRODUCT_HEADER_RE = /^(?:#{1,4}\s*)?(?:상품|product|variant|코스|등급)\s*[:\-]/i;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function collectBoundaries(lines: V3SourceLine[]): V3StructurePlan['product_boundaries'] {
  const starts = lines.filter(line => PRODUCT_HEADER_RE.test(line.quote.trim()));
  if (starts.length <= 1) {
    return [{
      index: 0,
      line_start: 1,
      line_end: lines.length,
      title_hint: compact(lines.find(line => line.quote.trim())?.quote ?? 'Untitled product'),
    }];
  }

  return starts.map((line, index) => ({
    index,
    line_start: line.lineNumber,
    line_end: index + 1 < starts.length ? starts[index + 1].lineNumber - 1 : lines.length,
    title_hint: compact(line.quote.replace(PRODUCT_HEADER_RE, '')) || compact(line.quote),
  }));
}

function collectSectionLocations(lines: V3SourceLine[], pattern: RegExp, label: string) {
  return lines
    .filter(line => pattern.test(line.quote))
    .map(line => ({ line_start: line.lineNumber, line_end: line.lineNumber, label }));
}

export function planProductRegistrationV3(lines: V3SourceLine[]): V3StructurePlan {
  const raw = lines.map(line => line.quote).join('\n');
  const product_boundaries = collectBoundaries(lines);
  const priceLine = lines.find(line => PRICE_RE.test(line.quote));
  const flightCodes = [...raw.matchAll(FLIGHT_CODE_RE)].map(m => m[0].replace(/\s+/g, ''));
  const meetingTimes = lines
    .filter(line => /meeting|미팅|집결|集合|공항\s*미팅/i.test(line.quote))
    .flatMap(line => [...line.quote.matchAll(TIME_RE)].map(m => m[0]));
  const dayHeaders = lines.filter(line => DAY_HEADER_RE.test(line.quote.trim()));
  const optionSections = collectSectionLocations(lines, /option|optional|선택|옵션|마사지|크루즈|쇼|티켓/i, 'option section');
  const shoppingSections = collectSectionLocations(lines, /shopping|쇼핑|면세|센터/i, 'shopping section');
  const unresolved_parts: string[] = [];

  if (!priceLine) unresolved_parts.push('price table not found');
  if (flightCodes.length === 0) unresolved_parts.push('flight code not found');
  if (dayHeaders.length === 0) unresolved_parts.push('itinerary day boundary not found');

  const document_type = product_boundaries.length > 1
    ? 'catalog'
    : dayHeaders.length > 0
      ? 'single_package'
      : 'unknown';

  return {
    document_type,
    planner_source: 'deterministic',
    expected_products: product_boundaries.length,
    shared_sections: product_boundaries[0]?.line_start && product_boundaries[0].line_start > 1
      ? [{ label: 'shared prefix', line_start: 1, line_end: product_boundaries[0].line_start - 1 }]
      : [],
    product_boundaries,
    variant_axes: [],
    price_table_location: priceLine
      ? { line_start: priceLine.lineNumber, line_end: priceLine.lineNumber, label: 'first detected price line' }
      : null,
    price_mapping_strategy: priceLine ? (product_boundaries.length > 1 ? 'variant_table' : 'single_table') : 'none',
    flight_pattern: {
      outbound_codes: flightCodes.slice(0, 1),
      inbound_codes: flightCodes.slice(1, 2),
      meeting_times: [...new Set(meetingTimes)],
    },
    itinerary_boundary_pattern: dayHeaders.length > 0 ? 'day header lines' : null,
    option_section_locations: optionSections,
    shopping_section_locations: shoppingSections,
    confidence: Math.max(0.25, 1 - unresolved_parts.length * 0.2),
    unresolved_parts,
  };
}
