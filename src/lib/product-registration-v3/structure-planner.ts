import type { V3SourceLine, V3StructurePlan } from './types';
import { V3StructurePlanSchema } from './plan-schema';
import {
  collectItineraryHeaderStarts,
  collectPkgBlockStarts,
  collectTransportVariantDetailBlockStarts,
  collectVariantCatalogBlockStarts,
} from '@/lib/parser/catalog-pre-split';

const FLIGHT_CODE_RE = /\b(?:[A-Z][A-Z0-9]|[0-9][A-Z])\s*\d{3,4}\b/g;
const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
const PRICE_RE = /(?:KRW|\u20a9|\uc6d0)?\s*([1-9]\d{1,2}(?:,\d{3})+|[1-9]\d{5,})\s*(?:\uc6d0|KRW|USD|\$)?/i;
const DAY_HEADER_RE = /^(?:day\s*\d{1,2}(?:\b|\s|$)|\uc81c\s*\d{1,2}\s*\uc77c(?:\s|$)|\d{1,2}\s*\uc77c\ucc28(?:\s|$))/i;
const PRODUCT_HEADER_RE = /^(?:#{1,4}\s*)?(?:\uc0c1\ud488|product|variant|\ucf54\uc2a4|\ub4f1\uae09)\s*[:\-]/i;
const OPTION_RE = /option|optional|\uc120\ud0dd\s*\uad00\uad11|\ud604\uc9c0\s*\uc9c0\ubd88\s*\uc635\uc158|\uac15\ub825\s*\ucd94\ucc9c\s*\uc635\uc158|\ucd94\ucc9c\s*\uc120\ud0dd\s*\uad00\uad11/i;
const SHOPPING_RE = /shopping|\uc1fc\ud551|\uba74\uc138|\uc13c\ud130/i;
const MEETING_RE = /meeting|\ubbf8\ud305|\uc9d1\uacb0|\ud53d\uc5c5|\uacf5\ud56d\s*\ubbf8\ud305/i;
const AIR_MODE_RE = /flight|airline|airport|\ud56d\uacf5|\ube44\ud589|\ud3b8\uba85|\ucd9c\ubc1c\ud3b8|\uadc0\uad6d\ud3b8|\uacf5\ud56d|\uad6d\uc81c\uacf5\ud56d/i;
const FERRY_MODE_RE = /ferry|cruise|\ud6fc\ub9ac|\ud398\ub9ac|\uc120\ubc15|\ud06c\ub8e8\uc988|\ubd80\uad00\ud6fc\ub9ac|\ub274\uce74\uba5c\ub9ac\uc544|\uce74\uba5c\ub9ac\uc544|\ubd80\uc0b0\ud56d|\ud558\uce74\ub2e4\ud56d/i;
const RAIL_MODE_RE = /rail|train|\uace0\uc18d\uc5f4\ucc28|\uae30\ucc28|\uc5f4\ucc28|\uc2e0\uce78\uc13c/i;
const BUS_MODE_RE = /bus|\ubc84\uc2a4|\ub9ac\ubb34\uc9c4|\uc154\ud2c0/i;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function lineNumberForCharOffset(lines: V3SourceLine[], offset: number): number {
  const found = [...lines].reverse().find(line => line.charStart <= offset);
  return found?.lineNumber ?? 1;
}

function titleHintFromBoundary(lines: V3SourceLine[], startLine: number, endLine: number): string {
  return compact(
    lines
      .slice(startLine - 1, endLine)
      .map(line => line.quote.trim())
      .find(Boolean) ?? 'Untitled product',
  );
}

function collectCatalogBoundaryStarts(raw: string): number[] {
  const variantStarts = collectVariantCatalogBlockStarts(raw);
  const transportStarts = collectTransportVariantDetailBlockStarts(raw);
  const itineraryStarts = collectItineraryHeaderStarts(raw);
  const pkgStarts = collectPkgBlockStarts(raw);
  const starts = pkgStarts.length >= 2
    ? pkgStarts
    : transportStarts.length >= 2 && transportStarts.length > Math.max(variantStarts.length, itineraryStarts.length)
      ? transportStarts
      : variantStarts.length >= 2
        ? variantStarts
        : itineraryStarts;
  return [...new Set(starts)].sort((a, b) => a - b);
}

function collectBoundaries(lines: V3SourceLine[]): V3StructurePlan['product_boundaries'] {
  const raw = lines.map(line => line.quote).join('\n');
  const catalogStarts = collectCatalogBoundaryStarts(raw);
  if (catalogStarts.length >= 2) {
    return catalogStarts.map((start, index) => {
      const startLine = lineNumberForCharOffset(lines, start);
      const nextStart = catalogStarts[index + 1];
      const endLine = nextStart == null ? lines.length : Math.max(startLine, lineNumberForCharOffset(lines, nextStart) - 1);
      return {
        index,
        line_start: startLine,
        line_end: endLine,
        title_hint: titleHintFromBoundary(lines, startLine, endLine),
      };
    });
  }

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

function isOptionSectionLine(line: string): boolean {
  const compacted = line.replace(/\s+/g, ' ').trim();
  const dense = compacted.replace(/\s+/g, '');
  if (!compacted) return false;
  if (/^(?:\uc120\ud0dd\uad00\uad11|optional tours?|options?)$/i.test(dense)) return true;
  if (/^(?:\ud604\uc9c0\uc9c0\ubd88\uc635\uc158|\uac15\ub825\ucd94\ucc9c\uc635\uc158|\ucd94\ucc9c\uc635\uc158)$/i.test(dense)) return true;
  if (/^(?:\ub178\uc635\uc158|nooption)$/i.test(dense)) return false;
  if (/\ub77c\uc6b4\ub529|\uace8\ud504\uc7a5|\ud604\uc9c0\s*\uc0ac\uc815|\uc120\ud0dd\uc740\s*\ud604\uc9c0\uc0ac\uc815/i.test(compacted)) return false;
  if (/\ub9c8\uc0ac\uc9c0/.test(compacted) && !/\uc120\ud0dd|\uc635\uc158|\ud604\uc9c0\s*\uc9c0\ubd88|\$|USD/i.test(compacted)) return false;
  return OPTION_RE.test(compacted);
}

function collectVariantAxes(boundaries: V3StructurePlan['product_boundaries']): V3StructurePlan['variant_axes'] {
  const titles = boundaries.map(boundary => boundary.title_hint);
  const gradeValues = titles
    .map(title => title.match(/\b(standard|premium|lilac|deluxe|basic|vip)\b/i)?.[1])
    .filter((value): value is string => Boolean(value));
  const durationValues = titles
    .map(title => title.match(/\b(\d+N\d+D|\d+\ubc15\s*\d+\uc77c|\d+D)\b/i)?.[1])
    .filter((value): value is string => Boolean(value));
  const axes: V3StructurePlan['variant_axes'] = [];
  if (new Set(gradeValues.map(v => v.toLowerCase())).size > 1) {
    axes.push({ name: 'grade', values: [...new Set(gradeValues)] });
  }
  if (new Set(durationValues.map(v => v.toLowerCase())).size > 1) {
    axes.push({ name: 'duration', values: [...new Set(durationValues)] });
  }
  return axes;
}

function detectTransportProfile(raw: string, flightCodes: string[]): NonNullable<V3StructurePlan['transport_profile']> {
  const detected = new Set<NonNullable<V3StructurePlan['transport_profile']>['detected_modes'][number]>();
  if (flightCodes.length > 0 || AIR_MODE_RE.test(raw)) detected.add('air');
  if (FERRY_MODE_RE.test(raw)) detected.add('ferry');
  if (/cruise|\ud06c\ub8e8\uc988/i.test(raw)) detected.add('cruise');
  if (RAIL_MODE_RE.test(raw)) detected.add('rail');
  if (BUS_MODE_RE.test(raw)) detected.add('bus');
  if (detected.size === 0) detected.add('unknown');

  const requiresAir = flightCodes.length > 0 || (detected.has('air') && !detected.has('ferry') && !detected.has('cruise'));
  return {
    requires_air: requiresAir,
    detected_modes: [...detected],
    air_requirement_reason: requiresAir
      ? flightCodes.length > 0
        ? 'flight_code_detected'
        : 'air_keyword_detected'
      : null,
  };
}

export function planProductRegistrationV3(lines: V3SourceLine[]): V3StructurePlan {
  const raw = lines.map(line => line.quote).join('\n');
  const product_boundaries = collectBoundaries(lines);
  const priceLine = lines.find(line => PRICE_RE.test(line.quote));
  const flightCodes = [...raw.matchAll(FLIGHT_CODE_RE)].map(m => m[0].replace(/\s+/g, ''));
  const transportProfile = detectTransportProfile(raw, flightCodes);
  const meetingTimes = lines
    .filter(line => MEETING_RE.test(line.quote))
    .flatMap(line => [...line.quote.matchAll(TIME_RE)].map(m => m[0]));
  const dayHeaders = lines.filter(line => DAY_HEADER_RE.test(line.quote.trim()));
  const optionSections = lines
    .filter(line => isOptionSectionLine(line.quote))
    .map(line => ({ line_start: line.lineNumber, line_end: line.lineNumber, label: 'option section' }));
  const shoppingSections = collectSectionLocations(lines, SHOPPING_RE, 'shopping section');
  const unresolved_parts: string[] = [];

  if (!priceLine) unresolved_parts.push('price table not found');
  if (flightCodes.length === 0) unresolved_parts.push('flight code not found');
  if (dayHeaders.length === 0) unresolved_parts.push('itinerary day boundary not found');

  const document_type = product_boundaries.length > 1
    ? 'catalog'
    : dayHeaders.length > 0
      ? 'single_package'
      : 'unknown';

  return V3StructurePlanSchema.parse({
    document_type,
    planner_source: 'deterministic',
    expected_products: product_boundaries.length,
    shared_sections: product_boundaries[0]?.line_start && product_boundaries[0].line_start > 1
      ? [{ label: 'shared prefix', line_start: 1, line_end: product_boundaries[0].line_start - 1 }]
      : [],
    product_boundaries,
    variant_axes: collectVariantAxes(product_boundaries),
    price_table_location: priceLine
      ? { line_start: priceLine.lineNumber, line_end: priceLine.lineNumber, label: 'first detected price line' }
      : null,
    price_mapping_strategy: priceLine ? (product_boundaries.length > 1 ? 'variant_table' : 'single_table') : 'none',
    flight_pattern: {
      outbound_codes: flightCodes.slice(0, 1),
      inbound_codes: flightCodes.slice(1, 2),
      meeting_times: [...new Set(meetingTimes)],
    },
    transport_profile: transportProfile,
    itinerary_boundary_pattern: dayHeaders.length > 0 ? 'day header lines' : null,
    option_section_locations: optionSections,
    shopping_section_locations: shoppingSections,
    confidence: Math.max(0.25, 1 - unresolved_parts.length * 0.2),
    unresolved_parts,
  });
}
