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
  if (claim.surface === 'itinerary' && isNonStandaloneItineraryFragment(value)) return;
  if (claims.some(c => c.surface === claim.surface && c.value === value)) return;
  claims.push({ ...claim, value });
}

function isNonStandaloneItineraryFragment(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /^(?:으|로|으로|에|에서|까지|후|전|및|\/)\s*(?:이동|관광|도착|출발|투숙|휴식)$/.test(normalized);
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

function decodeCommonHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _match;
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"');
}

function rawSupports(rawText: string, value: string): boolean {
  if (!rawText || !value) return false;
  rawText = decodeCommonHtmlEntities(rawText);
  value = decodeCommonHtmlEntities(value);
  if (rawText.includes(value)) return true;
  const compactRaw = rawText.replace(/\s+/g, '');
  const compactValue = value.replace(/\s+/g, '');
  if (compactValue.length >= 4 && compactRaw.includes(compactValue)) return true;
  const normalizedRaw = compactRaw.replace(/[·ㆍ•]/g, '');
  const normalizedValue = compactValue.replace(/[·ㆍ•]/g, '');
  if (normalizedValue.length >= 4 && normalizedRaw.includes(normalizedValue)) return true;
  return false;
}

function looseCustomerTermComparable(value: string): string {
  return value
    .replace(/[\s()[\]{}<>.,/\\|:;'"!?~\-*+]+/g, '')
    .replace(/[•·▪◦★☆◆◇■□●○♦※]/g, '')
    .trim();
}

function rawSupportsLooseTermLabel(rawText: string, value: string): boolean {
  const raw = looseCustomerTermComparable(rawText);
  const claim = looseCustomerTermComparable(value);
  return claim.length >= 2 && raw.includes(claim);
}

function compactComparable(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[()[\]{}<>「」『』·ㆍ,./\\|:;'"!?~\-–—_*★▶△※&+]/g, '')
    .replace(/으로|로|에서|에게|부터|까지|및|와|과|을|를|은|는|이|가|의/g, '')
    .replace(/관광|투어|체험|방문|일정|자유시간|자유일정/g, '')
    .trim();
}

function rawSupportsComparable(rawText: string, value: string): boolean {
  const raw = compactComparable(rawText);
  const claim = compactComparable(value);
  return claim.length >= 4 && raw.includes(claim);
}

function meaningfulTokens(value: string): string[] {
  return value
    .split(/[\s()[\]{}<>「」『』·ㆍ,./\\|:;'"!?~\-–—_*★▶△※&+]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
    .filter(token => !/^(관광|투어|체험|방문|이동|일정|자유일정|자유시간|포함|불포함)$/.test(token));
}

function rawSupportsTokensInNearbyLine(rawText: string, value: string): boolean {
  const tokens = meaningfulTokens(value);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return rawSupports(rawText, tokens[0]);
  return rawText
    .split(/\r?\n/)
    .some((line) => tokens.every(token => rawSupports(line, token) || rawSupportsComparable(line, token)));
}

function rawSupportsItineraryLabel(rawText: string, value: string): boolean {
  if (rawSupports(rawText, value) || rawSupportsComparable(rawText, value)) return true;
  return rawSupportsTokensInNearbyLine(rawText, value);
}

function normalizeTermClaim(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>([compact]);
  variants.add(compact.replace(/\uAC1C\uC778\s*\uACBD\uBE44/g, '\uAC1C\uC778 \uBE44\uC6A9'));
  variants.add(compact.replace(/\uAC1C\uC778\s*\uBE44\uC6A9/g, '\uAC1C\uC778\uACBD\uBE44'));
  variants.add(compact.replace(/골프\s*비용/g, '골피비용'));
  variants.add(compact.replace(/골프비용/g, '골피비용'));
  // render-contract excludes 표시 포맷: "개인경비 · 불포함"
  variants.add(compact.replace(/\s*[·ㆍ•]\s*불포함$/i, '').trim());
  // 흔한 연결어 정규화
  variants.add(compact.replace(/\s*및\s*/g, ' ').trim());
  return [...variants].filter(v => v.length >= 2);
}

function rawSupportsTermLabel(rawText: string, value: string): boolean {
  if (rawSupportsLooseTermLabel(rawText, value)) return true;
  const variants = normalizeTermClaim(value);
  if (variants.some(variant => rawSupports(rawText, variant) || rawSupportsComparable(rawText, variant))) return true;
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
  variants.add(compact.replace(/\s*등$/u, '').trim());
  variants.add(compact.replace(/\s*\/\s*(?:인|명|person|pax)\s*$/iu, '').trim());
  // 통화 포맷 차이: USD4 <-> $4
  const usd = compact.match(/^USD\s*(\d+(?:\.\d+)?)$/i);
  if (usd) variants.add(`$${usd[1]}`);
  const dollar = compact.match(/^\$\s*(\d+(?:\.\d+)?)$/);
  if (dollar) variants.add(`USD${dollar[1]}`);
  const dollarPerPerson = compact.match(/^\$\s*(\d+(?:\.\d+)?)\s*\/\s*(?:인|명|person|pax)$/i);
  if (dollarPerPerson) {
    variants.add(`$${dollarPerPerson[1]}`);
    variants.add(`USD${dollarPerPerson[1]}`);
    variants.add(`USD ${dollarPerPerson[1]}`);
  }
  const usdPerPerson = compact.match(/^USD\s*(\d+(?:\.\d+)?)\s*\/\s*(?:인|명|person|pax)$/i);
  if (usdPerPerson) {
    variants.add(`$${usdPerPerson[1]}`);
    variants.add(`USD${usdPerPerson[1]}`);
    variants.add(`USD ${usdPerPerson[1]}`);
  }
  // 날짜형 가격/라벨 토큰(예: 2027-02-04)도 raw의 2/4, 2월 4일과 매칭 허용
  normalizeDateClaim(compact).forEach(v => variants.add(v));
  return [...variants].filter(v => v.length >= 2);
}

function rawSupportsOptionalLabel(rawText: string, value: string): boolean {
  const variants = normalizeOptionalClaim(value);
  return variants.some(variant => rawSupports(rawText, variant))
    || rawSupportsTokensInNearbyLine(rawText, value)
    || variants.some(variant => rawSupportsTokensInNearbyLine(rawText, variant));
}

function stripHotelGradeParentheticals(value: string): string {
  return value
    .replace(/\(\s*(?:정|준)?\s*\d\s*성\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHotelClaim(value: string): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>([compact]);
  variants.add(stripHotelGradeParentheticals(compact));
  // 5성 <-> 5성급, 준5성 <-> 준 5성급
  variants.add(compact.replace(/성급$/g, '성').trim());
  variants.add(compact.replace(/성$/g, '성급').trim());
  variants.add(compact.replace(/^준\s*(\d)성$/g, '준$1성급').trim());
  variants.add(compact.replace(/^준\s*(\d)성급$/g, '준$1성').trim());
  return [...variants].filter(v => v.length >= 2);
}

function rawSupportsHotelLabel(rawText: string, value: string): boolean {
  const variants = normalizeHotelClaim(value);
  if (variants.some(variant => rawSupports(rawText, variant))) return true;
  const normalizedRaw = stripHotelGradeParentheticals(rawText);
  return variants.some(variant => rawSupports(normalizedRaw, stripHotelGradeParentheticals(variant)));
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

function normalizeYear(value: string | undefined, fallbackYear: number): number {
  if (!value) return fallbackYear;
  const year = Number(value);
  if (!Number.isFinite(year)) return fallbackYear;
  return year < 100 ? 2000 + year : year;
}

function rawSupportsKoreanDateRange(rawText: string, value: string): boolean {
  const iso = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (!iso) return false;
  const target = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  if (!Number.isFinite(target)) return false;

  const rangePattern = new RegExp(
    String.raw`(?:(20\d{2}|\d{2})\s*\uB144\s*)?(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C?\s*[~\-–—]\s*(?:(20\d{2}|\d{2})\s*\uB144\s*)?(?:(\d{1,2})\s*\uC6D4\s*)?(\d{1,2})\s*\uC77C?`,
    'g',
  );

  for (const match of rawText.matchAll(rangePattern)) {
    const startYear = normalizeYear(match[1], Number(iso[1]));
    const startMonth = Number(match[2]);
    const startDay = Number(match[3]);
    const endYear = normalizeYear(match[4], startYear);
    const endMonth = Number(match[5] ?? startMonth);
    const endDay = Number(match[6]);
    const start = Date.UTC(startYear, startMonth - 1, startDay);
    let end = Date.UTC(endYear, endMonth - 1, endDay);
    if (end < start) end = Date.UTC(endYear + 1, endMonth - 1, endDay);
    if (target >= Math.min(start, end) && target <= Math.max(start, end)) {
      return true;
    }
  }

  return false;
}

function rawSupportsKoreanMonthHeaderDayList(rawText: string, value: string): boolean {
  const iso = value.match(/\b20\d{2}-(\d{1,2})-(\d{1,2})\b/);
  if (!iso) return false;
  const month = Number(iso[1]);
  const day = Number(iso[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return false;

  const lines = decodeCommonHtmlEntities(rawText).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    if (!new RegExp(`^0?${month}\\s*\\uC6D4(?:\\s|$)`).test(lines[i])) continue;
    const window = lines.slice(i + 1, i + 40);
    for (const line of window) {
      if (/^\d{1,2}\s*\uC6D4\b/.test(line)) break;
      const dayTokens = line.match(/\d{1,2}/g)?.map(token => Number(token)) ?? [];
      if (dayTokens.includes(day)) return true;
    }
  }
  return false;
}

function rawSupportsDateLabel(rawText: string, value: string): boolean {
  const variants = normalizeDateClaim(value);
  if (variants.some(variant => rawSupports(rawText, variant))) return true;

  const iso = value.match(/\b20\d{2}-(\d{1,2})-(\d{1,2})\b/);
  if (!iso) return false;
  const month = String(Number(iso[1]));
  const day = String(Number(iso[2]));
  const date = new Date(`${value}T00:00:00Z`);
  const rangePattern = /(\d{1,2})\s*\/\s*(\d{1,2})\s*[~\-–—]\s*(\d{1,2})\s*\/\s*(\d{1,2})/g;
  for (const match of rawText.matchAll(rangePattern)) {
    const start = Date.UTC(date.getUTCFullYear(), Number(match[1]) - 1, Number(match[2]));
    const end = Date.UTC(date.getUTCFullYear(), Number(match[3]) - 1, Number(match[4]));
    const current = date.getTime();
    if (Number.isFinite(current) && current >= Math.min(start, end) && current <= Math.max(start, end)) {
      return true;
    }
  }
  if (rawSupportsKoreanDateRange(rawText, value)) return true;
  if (rawSupportsKoreanMonthHeaderDayList(rawText, value)) return true;
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
      if (Number.isInteger(n) && n >= 100_000) {
        const thousandUnit = Math.round(n / 1000).toLocaleString('ko-KR');
        variants.add(thousandUnit);
        variants.add(`${thousandUnit},-`);
      }
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

function rawSupportsKoreanMergedFlightLabel(rawText: string, value: string): boolean {
  if (!rawText || !value) return false;
  if (!/[\uAC00-\uD7A3]/.test(value) || !/\uCD9C\uBC1C/.test(value) || !/\uB3C4\uCC29/.test(value)) return false;
  const compactRaw = rawText.replace(/\s+/g, '');
  const compactValue = value.replace(/\s+/g, '');
  const time = compactValue.match(/\d{1,2}:\d{2}(?:\(\+?\d+\))?/)?.[0] ?? null;
  const dep = compactValue.match(/^(.+?)\uCD9C\uBC1C/)?.[1] ?? '';
  const arr = compactValue.match(/\uCD9C\uBC1C.*?(?:[→>\-]+)?(.+?)\uB3C4\uCC29/)?.[1] ?? '';
  const hasDeparture = compactRaw.includes('\uCD9C\uBC1C') && (
    compactRaw.includes(dep)
    || compactRaw.includes('\uBD80\uC0B0')
    || compactRaw.includes('\uAE40\uD574')
  );
  const hasArrival = compactRaw.includes('\uB3C4\uCC29') && arr.length >= 2 && compactRaw.includes(arr);
  const hasTime = !time || compactRaw.includes(time);
  return hasDeparture && hasArrival && hasTime;
}

function rawSupportsClaim(rawText: string, claim: RenderClaim): boolean {
  if (claim.surface === 'terms') return rawSupportsTermLabel(rawText, claim.value);
  if (claim.surface === 'optional') return rawSupportsOptionalLabel(rawText, claim.value);
  if (claim.surface === 'hotel') return rawSupportsHotelLabel(rawText, claim.value);
  if (claim.surface === 'flight') return rawSupportsFlightLabel(rawText, claim.value);
  if (claim.surface === 'itinerary') return rawSupportsItineraryLabel(rawText, claim.value);
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
    && !rawSupportsKoreanMergedFlightLabel(rawText, claim.value)
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
