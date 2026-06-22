import { renderPackage, type RenderPackageInput } from '@/lib/render-contract';
import type { SourceEvidenceMap } from '@/lib/source-evidence';

export type RenderClaimSeverity = 'critical' | 'high' | 'medium';

export type RenderClaim = {
  id: string;
  value: string;
  surface: 'flight' | 'itinerary' | 'hotel' | 'terms' | 'optional' | 'price';
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

  (pkg.price_dates ?? []).forEach((priceDate, idx) => {
    addClaim(claims, { id: `priceDates[${idx}].date`, value: priceDate.date ?? '', surface: 'price', severity: 'critical' });
    addClaim(claims, { id: `priceDates[${idx}].price`, value: String(priceDate.price ?? ''), surface: 'price', severity: 'critical' });
  });

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

function normalizeTermClaim(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>([compact]);
  // render-contract excludes 표시 포맷: "개인경비 · 불포함"
  variants.add(compact.replace(/\s*[·ㆍ•]\s*불포함$/i, '').trim());
  // 흔한 연결어 정규화
  variants.add(compact.replace(/\s*및\s*/g, ' ').trim());
  return [...variants].filter(v => v.length >= 2);
}

function rawSupportsTermLabel(rawText: string, value: string): boolean {
  const variants = normalizeTermClaim(value);
  if (variants.some(variant => rawSupports(rawText, variant))) return true;
  const tokens = value
    .split(/[·ㆍ,\/&+|()\[\]\s]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
  return tokens.length >= 2 && tokens.every(token => rawSupports(rawText, token));
}

function normalizeOptionalClaim(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>([compact]);
  // displayName 형태: "마사지 (베트남)" -> "마사지"
  variants.add(compact.replace(/\s*\([^)]*\)\s*$/, '').trim());
  // 통화 포맷 차이: USD4 <-> $4
  const usd = compact.match(/^USD\s*(\d+(?:\.\d+)?)$/i);
  if (usd) variants.add(`$${usd[1]}`);
  const dollar = compact.match(/^\$\s*(\d+(?:\.\d+)?)$/);
  if (dollar) variants.add(`USD${dollar[1]}`);
  // 날짜형 가격/라벨 토큰(예: 2027-02-04)도 raw의 2/4, 2월 4일과 매칭 허용
  normalizeDateClaim(compact).forEach(v => variants.add(v));
  return [...variants].filter(v => v.length >= 2);
}

function rawSupportsOptionalLabel(rawText: string, value: string): boolean {
  const variants = normalizeOptionalClaim(value);
  return variants.some(variant => rawSupports(rawText, variant));
}

function normalizeHotelClaim(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>([compact]);
  // 5성 <-> 5성급, 준5성 <-> 준 5성급
  variants.add(compact.replace(/성급$/g, '성').trim());
  variants.add(compact.replace(/성$/g, '성급').trim());
  variants.add(compact.replace(/^준\s*(\d)성$/g, '준$1성급').trim());
  variants.add(compact.replace(/^준\s*(\d)성급$/g, '준$1성').trim());
  return [...variants].filter(v => v.length >= 2);
}

function rawSupportsHotelLabel(rawText: string, value: string): boolean {
  const variants = normalizeHotelClaim(value);
  return variants.some(variant => rawSupports(rawText, variant));
}

function normalizeFlightClaim(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>([compact]);
  // 부산 김해 <-> 부산(김해)
  variants.add(compact.replace(/부산\s*김해/g, '부산(김해)'));
  variants.add(compact.replace(/부산\s*\(\s*김해\s*\)/g, '부산 김해'));
  // 김해국제공항 -> 김해공항 -> 김해
  variants.add(compact.replace(/김해\s*국제?\s*공항/g, '김해'));
  variants.add(compact.replace(/김해/g, '김해국제공항'));
  // 인천국제공항 -> 인천
  variants.add(compact.replace(/인천\s*국제?\s*공항/g, '인천'));
  variants.add(compact.replace(/인천/g, '인천국제공항'));
  return [...variants].filter(v => v.length >= 2);
}

function rawSupportsFlightLabel(rawText: string, value: string): boolean {
  const variants = normalizeFlightClaim(value);
  return variants.some(variant => rawSupports(rawText, variant));
}

function normalizeDateClaim(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>([compact]);
  const iso = compact.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const y = iso[1];
    const m = String(Number(iso[2]));
    const d = String(Number(iso[3]));
    const mm = iso[2].padStart(2, '0');
    const dd = iso[3].padStart(2, '0');
    variants.add(`${m}/${d}`);
    variants.add(`${mm}/${dd}`);
    variants.add(`${m}.${d}`);
    variants.add(`${y}.${mm}.${dd}`);
    variants.add(`${m}월${d}일`);
    variants.add(`${m}월 ${d}일`);
    variants.add(`${mm}월${dd}일`);
    variants.add(`${mm}월 ${dd}일`);
    variants.add(`${m}월 ${d}일`);
    variants.add(`${y}.${m}.${d}`);
  }
  const slash = compact.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slash) {
    const m = String(Number(slash[1]));
    const d = String(Number(slash[2]));
    variants.add(`${m}월${d}일`);
    variants.add(`${m}월 ${d}일`);
    variants.add(`${m}월 ${d}일`);
  }
  return [...variants].filter(v => v.length >= 3);
}

function rawSupportsDateLabel(rawText: string, value: string): boolean {
  const variants = normalizeDateClaim(value);
  if (variants.some(variant => rawSupports(rawText, variant))) return true;

  const iso = value.match(/\b20\d{2}-(\d{1,2})-(\d{1,2})\b/);
  if (!iso) return false;
  const month = String(Number(iso[1]));
  const day = String(Number(iso[2]));
  const monthListPattern = new RegExp(`\\b0?${escapeRegExp(month)}\\s*/`);
  const dayPattern = new RegExp(`(?:^|[^0-9])0?${escapeRegExp(day)}(?:[^0-9]|$)`);
  return rawText
    .split(/\r?\n/)
    .some((line) => monthListPattern.test(line) && dayPattern.test(line));
}

function normalizePriceClaim(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>([compact]);
  const numeric = compact.match(/^\d{5,}$/);
  if (numeric) {
    const n = Number(compact);
    if (Number.isFinite(n)) {
      variants.add(n.toLocaleString('ko-KR'));
      variants.add(`${n.toLocaleString('ko-KR')}??`);
      variants.add(`${n}??`);
    }
  }
  return [...variants].filter(v => v.length >= 2);
}

function rawSupportsPriceLabel(rawText: string, value: string): boolean {
  const variants = normalizePriceClaim(value);
  return variants.some(variant => rawSupports(rawText, variant));
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

function rawSupportsClaim(rawText: string, claim: RenderClaim): boolean {
  if (claim.surface === 'terms') return rawSupportsTermLabel(rawText, claim.value);
  if (claim.surface === 'optional') return rawSupportsOptionalLabel(rawText, claim.value);
  if (claim.surface === 'hotel') return rawSupportsHotelLabel(rawText, claim.value);
  if (claim.surface === 'flight') return rawSupportsFlightLabel(rawText, claim.value);
  if (claim.surface === 'price') return rawSupportsDateLabel(rawText, claim.value) || rawSupportsPriceLabel(rawText, claim.value);
  if (claim.id.includes('price') || claim.id.includes('date')) {
    return rawSupportsDateLabel(rawText, claim.value) || rawSupportsPriceLabel(rawText, claim.value) || rawSupports(rawText, claim.value);
  }
  return rawSupports(rawText, claim.value);
}

export function evaluateRenderClaimCoverage(
  pkg: RenderPackageInput & { raw_text?: string | null },
  sourceEvidence?: SourceEvidenceMap | null,
): RenderClaimCoverageResult {
  const claims = extractRenderClaims(pkg);
  const rawText = pkg.raw_text ?? '';
  const unsupported = claims.filter(claim =>
    !rawSupportsClaim(rawText, claim)
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
