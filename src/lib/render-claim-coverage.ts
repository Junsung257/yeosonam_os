import { renderPackage, type RenderPackageInput } from '@/lib/render-contract';
import type { SourceEvidenceMap } from '@/lib/source-evidence';

export type RenderClaimSeverity = 'critical' | 'high' | 'medium';

export type RenderClaim = {
  id: string;
  value: string;
  surface: 'flight' | 'itinerary' | 'hotel' | 'terms' | 'optional';
  severity: RenderClaimSeverity;
};

export type RenderClaimCoverageResult = {
  claims: RenderClaim[];
  unsupported: RenderClaim[];
  total: number;
  supported: number;
  ratio: number;
};

function addClaim(claims: RenderClaim[], claim: RenderClaim): void {
  const value = claim.value.trim();
  if (!value || value === '?' || value === '--:--') return;
  if (value.length < 2) return;
  if (claims.some(c => c.surface === claim.surface && c.value === value)) return;
  claims.push({ ...claim, value });
}

export function extractRenderClaims(pkg: RenderPackageInput): RenderClaim[] {
  const view = renderPackage(pkg);
  const claims: RenderClaim[] = [];

  for (const [leg, flight] of [
    ['outbound', view.flightHeader.outbound],
    ['inbound', view.flightHeader.inbound],
  ] as const) {
    if (!flight) continue;
    addClaim(claims, { id: `flight.${leg}.code`, value: flight.code ?? '', surface: 'flight', severity: 'critical' });
    addClaim(claims, { id: `flight.${leg}.depTime`, value: flight.depTime ?? '', surface: 'flight', severity: 'critical' });
    addClaim(claims, { id: `flight.${leg}.arrTime`, value: flight.arrTime ?? '', surface: 'flight', severity: 'critical' });
  }

  view.days.forEach((day, dayIdx) => {
    for (const item of day.schedule) {
      addClaim(claims, {
        id: `days[${dayIdx}].schedule`,
        value: item.activity ?? '',
        surface: 'itinerary',
        severity: 'critical',
      });
    }
    if (day.hotelCard?.name) {
      addClaim(claims, {
        id: `days[${dayIdx}].hotel.name`,
        value: day.hotelCard.name,
        surface: 'hotel',
        severity: 'critical',
      });
    }
    if (day.hotelCard?.grade) {
      addClaim(claims, {
        id: `days[${dayIdx}].hotel.grade`,
        value: day.hotelCard.grade,
        surface: 'hotel',
        severity: 'high',
      });
    }
  });

  view.inclusions.flat.forEach((value, idx) =>
    addClaim(claims, { id: `inclusions[${idx}]`, value, surface: 'terms', severity: 'high' }),
  );
  view.excludes.basic.forEach((value, idx) =>
    addClaim(claims, { id: `excludes[${idx}]`, value, surface: 'terms', severity: 'high' }),
  );
  view.surchargesMerged.forEach((s, idx) =>
    addClaim(claims, { id: `surcharges[${idx}]`, value: s.label, surface: 'terms', severity: 'high' }),
  );
  view.optionalTours.flat.forEach((tour, idx) => {
    addClaim(claims, { id: `optionalTours[${idx}].name`, value: tour.name, surface: 'optional', severity: 'high' });
    addClaim(claims, { id: `optionalTours[${idx}].price`, value: tour.price ?? '', surface: 'optional', severity: 'high' });
  });

  return claims;
}

function evidenceSupports(evidence: SourceEvidenceMap | null | undefined, value: string): boolean {
  if (!evidence) return false;
  for (const spans of Object.values(evidence)) {
    for (const span of spans ?? []) {
      if (span.quote === value || span.quote.includes(value) || value.includes(span.quote)) return true;
    }
  }
  return false;
}

function rawSupports(rawText: string, value: string): boolean {
  if (!rawText || !value) return false;
  if (rawText.includes(value)) return true;
  const compactRaw = rawText.replace(/\s+/g, '');
  const compactValue = value.replace(/\s+/g, '');
  if (compactValue.length >= 4 && compactRaw.includes(compactValue)) return true;
  const normalizedRaw = compactRaw.replace(/[·ㆍ•]/g, '');
  const normalizedValue = compactValue.replace(/[·ㆍ•]/g, '');
  if (normalizedValue.length >= 4 && normalizedRaw.includes(normalizedValue)) return true;
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rawSupportsMergedFlightLabel(rawText: string, value: string): boolean {
  if (!rawText || !value) return false;
  if (/출발지|도착지/.test(value)) return false;

  const match = value.match(/^(.+?)\s*출발\s*[→↦⇒]\s*(.+?)\s*도착(?:\s+(\d{1,2}:\d{2}))?$/);
  if (!match) return false;

  const [, depCityRaw, arrCityRaw, arrTime] = match;
  const depCity = depCityRaw.trim();
  const arrCity = arrCityRaw.trim();
  if (!depCity || !arrCity) return false;

  const depPattern = new RegExp(`${escapeRegExp(depCity)}\\s*(?:(?:국제)?공항)?\\s*출발`);
  const arrPattern = new RegExp(`${escapeRegExp(arrCity)}\\s*(?:(?:국제)?공항)?\\s*도착`);
  const hasRoute = depPattern.test(rawText) && arrPattern.test(rawText);
  const hasTime = !arrTime || rawText.includes(arrTime);
  return hasRoute && hasTime;
}

export function evaluateRenderClaimCoverage(
  pkg: RenderPackageInput & { raw_text?: string | null },
  sourceEvidence?: SourceEvidenceMap | null,
): RenderClaimCoverageResult {
  const claims = extractRenderClaims(pkg);
  const rawText = pkg.raw_text ?? '';
  const unsupported = claims.filter(claim =>
    !rawSupports(rawText, claim.value)
    && !rawSupportsMergedFlightLabel(rawText, claim.value)
    && !evidenceSupports(sourceEvidence, claim.value)
  );
  const total = claims.length;
  const supported = total - unsupported.length;
  return {
    claims,
    unsupported,
    total,
    supported,
    ratio: total === 0 ? 1 : supported / total,
  };
}
