type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type RegistrationQualityDomainId =
  | 'source_preservation'
  | 'structured_json'
  | 'price_dates'
  | 'itinerary_transport_hotel'
  | 'entity_matching'
  | 'customer_copy'
  | 'db_consistency'
  | 'packages_mobile'
  | 'lp_mobile'
  | 'learning_ledger';

export type RegistrationQualityDomainScore = {
  id: RegistrationQualityDomainId;
  label: string;
  score: number;
  status: 'pass' | 'warn' | 'fail';
  blockers: string[];
  evidence: string[];
};

export type RegistrationQualityScorecard = {
  domains: RegistrationQualityDomainScore[];
  averageScore: number;
  minScore: number;
  customerOpenCandidate: boolean;
  blockers: string[];
  generatedAt: string;
  thresholds: {
    domainMin: number;
    averageMin: number;
  };
};

export type RegistrationQualityVerifyCheck = {
  id?: string;
  status?: CheckStatus;
  detail?: string;
  label?: string;
};

export type RegistrationQualityProductPrice = {
  target_date?: string | null;
  net_price?: number | string | null;
  adult_selling_price?: number | string | null;
  child_price?: number | string | null;
  note?: string | null;
};

type MobileProofResultLike = {
  ok?: boolean;
  reason?: string | null;
  proof?: unknown;
};

type MobileProofLike = {
  status?: string | null;
  checked_at?: string | null;
  package_updated_at?: string | null;
  surfaces?: string[] | null;
  surface_results?: Array<{ surface?: string | null; status?: string | null }> | null;
};

const DOMAIN_MIN = 95;
const AVERAGE_MIN = 97;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function numberFrom(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function checkMap(checks: RegistrationQualityVerifyCheck[]): Map<string, RegistrationQualityVerifyCheck> {
  return new Map(checks.filter(check => check.id).map(check => [String(check.id), check]));
}

function hasFailed(checks: Map<string, RegistrationQualityVerifyCheck>, ids: string[]): string[] {
  return ids
    .map(id => checks.get(id))
    .filter((check): check is RegistrationQualityVerifyCheck => check?.status === 'fail')
    .map(check => `${check.id}: ${check.detail ?? check.label ?? 'failed'}`);
}

function hasWarned(checks: Map<string, RegistrationQualityVerifyCheck>, ids: string[]): string[] {
  return ids
    .map(id => checks.get(id))
    .filter((check): check is RegistrationQualityVerifyCheck => check?.status === 'warn')
    .map(check => `${check.id}: ${check.detail ?? check.label ?? 'warning'}`);
}

function domain(input: {
  id: RegistrationQualityDomainId;
  label: string;
  blockers?: string[];
  warnings?: string[];
  evidence?: string[];
  passScore?: number;
}): RegistrationQualityDomainScore {
  const blockers = input.blockers ?? [];
  const warnings = input.warnings ?? [];
  const score = blockers.length > 0 ? 0 : warnings.length > 0 ? 94 : (input.passScore ?? 100);
  return {
    id: input.id,
    label: input.label,
    score,
    status: blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    blockers,
    evidence: [...(input.evidence ?? []), ...warnings.map(warning => `warning: ${warning}`)],
  };
}

function packagePriceDates(pkg: Record<string, unknown>): Array<{ date?: unknown; price?: unknown; adult_selling_price?: unknown; selling_price?: unknown }> {
  return asArray(pkg.price_dates);
}

function priceValue(row: { price?: unknown; adult_selling_price?: unknown; selling_price?: unknown }): number | null {
  return numberFrom(row.price ?? row.adult_selling_price ?? row.selling_price);
}

function priceAlignment(
  priceDates: Array<{ date?: unknown; price?: unknown; adult_selling_price?: unknown; selling_price?: unknown }>,
  productPrices: RegistrationQualityProductPrice[] | null,
): string | null {
  if (!productPrices) return 'product_prices were not loaded for scorecard';
  const priceDateByDate = new Map<string, number>();
  for (const row of priceDates) {
    const date = asString(row.date);
    const price = priceValue(row);
    if (ISO_DATE.test(date) && price !== null && price > 0) priceDateByDate.set(date, price);
  }

  const pricesByDate = new Map<string, number[]>();
  for (const row of productPrices) {
    const date = asString(row.target_date);
    const price = numberFrom(row.net_price);
    const adultSellingPrice = numberFrom(row.adult_selling_price);
    if (price !== null && price > 0 && (adultSellingPrice === null || adultSellingPrice <= 0)) {
      return `adult_selling_price missing for positive product_prices row ${date || 'undated'}`;
    }
    if (!ISO_DATE.test(date) || price === null || price <= 0) continue;
    const prices = pricesByDate.get(date) ?? [];
    prices.push(price);
    pricesByDate.set(date, prices);
  }

  if (productPrices.length === 0) return 'product_prices missing';
  if (priceDateByDate.size === 0) return pricesByDate.size > 0 ? 'price_dates missing all product_prices dates' : 'price_dates missing';
  for (const date of pricesByDate.keys()) {
    if (!priceDateByDate.has(date)) return `price_dates missing date ${date}`;
  }
  for (const [date, price] of priceDateByDate.entries()) {
    const prices = pricesByDate.get(date);
    if (!prices?.length) return `product_prices missing date ${date}`;
    const minPrice = Math.min(...prices);
    if (minPrice !== price) return `${date} product_prices min ${minPrice} != price_dates ${price}`;
  }
  return null;
}

function itineraryDays(pkg: Record<string, unknown>): unknown[] {
  return asArray(asRecord(pkg.itinerary_data)?.days);
}

function textLength(pkg: Record<string, unknown>, key: string): number {
  return asString(pkg[key]).length;
}

function normalizeMobileProof(input: unknown): { resultOk: boolean | null; reason: string | null; proof: MobileProofLike | null } {
  const result = asRecord(input) as (MobileProofResultLike & Record<string, unknown>) | null;
  const rawProof = result && typeof result.ok === 'boolean' && 'proof' in result
    ? result.proof
    : input;
  const proofRecord = asRecord(rawProof);
  const surfaceResults: NonNullable<MobileProofLike['surface_results']> = [];
  for (const item of asArray(proofRecord?.surface_results)) {
    const record = asRecord(item);
    if (!record) continue;
    surfaceResults.push({
      surface: asString(record.surface) || null,
      status: asString(record.status) || null,
    });
  }
  const proof = proofRecord
    ? {
        status: asString(proofRecord.status) || null,
        checked_at: asString(proofRecord.checked_at) || null,
        package_updated_at: asString(proofRecord.package_updated_at) || null,
        surfaces: asArray(proofRecord.surfaces).map(item => asString(item)).filter(Boolean),
        surface_results: surfaceResults,
      }
    : null;
  return {
    resultOk: typeof result?.ok === 'boolean' ? result.ok : null,
    reason: asString(result?.reason) || null,
    proof,
  };
}

function mobileSurfaceBlocker(input: unknown, surface: 'packages' | 'lp'): string | null {
  const normalized = normalizeMobileProof(input);
  if (normalized.resultOk === false) return normalized.reason ?? `mobile proof failed for ${surface}`;
  const proof = normalized.proof;
  if (normalized.resultOk === true && !proof) return null;
  if (!proof) return `actual ${surface} mobile proof is missing`;
  if (proof.status !== 'pass') return `actual ${surface} mobile proof status is ${proof.status ?? 'missing'}`;
  if (!proof.checked_at) return `actual ${surface} mobile proof checked_at is missing`;
  const surfaces = new Set((proof.surfaces ?? []).map(surfaceName => surfaceName.toLowerCase()));
  for (const surfaceResult of proof.surface_results ?? []) {
    if (surfaceResult.surface) surfaces.add(surfaceResult.surface.toLowerCase());
    if (surfaceResult.surface?.toLowerCase() === surface && surfaceResult.status !== 'pass') {
      return `actual ${surface} mobile proof surface status is ${surfaceResult.status ?? 'missing'}`;
    }
  }
  if (!surfaces.has(surface)) return `actual ${surface} mobile proof did not include ${surface}`;
  return null;
}

export function evaluateRegistrationQualityScorecard(input: {
  pkg: Record<string, unknown>;
  verifyChecks?: RegistrationQualityVerifyCheck[];
  productPrices?: RegistrationQualityProductPrice[] | null;
  mobileProof?: unknown;
  learning?: { micro?: number | null; macro?: number | null; combined?: number | null; productionReady?: boolean | null; blockers?: string[] | null } | null;
}): RegistrationQualityScorecard {
  const checks = checkMap(input.verifyChecks ?? []);
  const pkg = input.pkg;
  const days = itineraryDays(pkg);
  const priceDates = packagePriceDates(pkg);
  const priceIssue = priceAlignment(priceDates, input.productPrices ?? null);
  const customerCopyFailures = [
    ...hasFailed(checks, ['C18']),
  ];
  const learning = input.learning ?? null;
  const learningBlockers = asArray<string>(learning?.blockers);

  const domains: RegistrationQualityDomainScore[] = [
    domain({
      id: 'source_preservation',
      label: '원문 입력/보존',
      blockers: textLength(pkg, 'raw_text') >= 50 ? [] : ['raw_text is missing or too short for QA evidence'],
      evidence: [`raw_text length ${textLength(pkg, 'raw_text')}`],
    }),
    domain({
      id: 'structured_json',
      label: '상품 JSON 구조화',
      blockers: [
        ...(!asString(pkg.title) ? ['title missing'] : []),
        ...(!asString(pkg.destination) ? ['destination missing'] : []),
        ...(days.length === 0 ? ['itinerary_data.days missing'] : []),
        ...hasFailed(checks, ['C1', 'C3', 'C6']),
      ],
      warnings: hasWarned(checks, ['C1', 'C3', 'C6']),
      evidence: [`days ${days.length}`],
    }),
    domain({
      id: 'price_dates',
      label: '가격/날짜 저장 일치',
      blockers: priceIssue ? [priceIssue] : hasFailed(checks, ['C12', 'C14']),
      warnings: hasWarned(checks, ['C12', 'C14']),
      evidence: [`price_dates ${priceDates.length}`, `product_prices ${input.productPrices?.length ?? 0}`],
    }),
    domain({
      id: 'itinerary_transport_hotel',
      label: '일정/항공/호텔 파싱',
      blockers: [
        ...(days.length === 0 ? ['itinerary days missing'] : []),
        ...(!asString(pkg.airline) ? ['airline missing'] : []),
        ...hasFailed(checks, ['C7', 'C9', 'C16', 'C17']),
      ],
      warnings: hasWarned(checks, ['C7', 'C9', 'C16', 'C17']),
      evidence: [`airline ${asString(pkg.airline) || 'missing'}`],
    }),
    domain({
      id: 'entity_matching',
      label: '관광지/호텔 매칭',
      blockers: hasFailed(checks, ['C15']),
      warnings: hasWarned(checks, ['C15']),
      evidence: [checks.get('C15')?.detail ?? 'entity gate checked by central candidate queue'],
    }),
    domain({
      id: 'customer_copy',
      label: '고객문구 자동수정/금지노출',
      blockers: customerCopyFailures,
      warnings: hasWarned(checks, ['C18']),
      evidence: [checks.get('C18')?.detail ?? 'customer visible text check present'],
      passScore: 100,
    }),
    domain({
      id: 'db_consistency',
      label: 'DB 저장 일관성',
      blockers: [
        ...(!asString(pkg.id) ? ['package id missing'] : []),
        ...(!asString(pkg.internal_code) ? ['internal_code missing'] : []),
        ...(priceIssue ? [`price storage mismatch: ${priceIssue}`] : []),
      ],
      evidence: [`internal_code ${asString(pkg.internal_code) || 'missing'}`],
    }),
    domain({
      id: 'packages_mobile',
      label: '모바일 /packages 렌더',
      blockers: mobileSurfaceBlocker(input.mobileProof, 'packages') ? [mobileSurfaceBlocker(input.mobileProof, 'packages') as string] : [],
    }),
    domain({
      id: 'lp_mobile',
      label: '모바일 /lp 렌더/CTA',
      blockers: mobileSurfaceBlocker(input.mobileProof, 'lp') ? [mobileSurfaceBlocker(input.mobileProof, 'lp') as string] : [],
    }),
    domain({
      id: 'learning_ledger',
      label: '학습 엔진/회귀 방지',
      blockers: [
        ...(learning?.productionReady === false ? ['learning engine is not production ready'] : []),
        ...learningBlockers,
        ...(learning?.combined !== undefined && learning.combined !== null && learning.combined < DOMAIN_MIN
          ? [`learning combined score ${learning.combined} below ${DOMAIN_MIN}`]
          : []),
      ],
      evidence: [
        learning
          ? `learning micro ${learning.micro ?? 'n/a'} macro ${learning.macro ?? 'n/a'} combined ${learning.combined ?? 'n/a'}`
          : 'global learning report is evaluated by CI/live sample scripts',
      ],
      passScore: learning ? 100 : 95,
    }),
  ];

  const total = domains.reduce((sum, item) => sum + item.score, 0);
  const averageScore = Number((total / domains.length).toFixed(1));
  const minScore = Math.min(...domains.map(item => item.score));
  const blockers = domains.flatMap(item => item.blockers.map(blocker => `${item.id}: ${blocker}`));
  const customerOpenCandidate = blockers.length === 0
    && domains.every(item => item.score >= DOMAIN_MIN)
    && averageScore >= AVERAGE_MIN;

  return {
    domains,
    averageScore,
    minScore,
    customerOpenCandidate,
    blockers,
    generatedAt: new Date().toISOString(),
    thresholds: {
      domainMin: DOMAIN_MIN,
      averageMin: AVERAGE_MIN,
    },
  };
}
