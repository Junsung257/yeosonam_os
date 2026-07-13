import { createHash } from 'crypto';

import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload';
import { buildCustomerPackageDisplayCopy } from '@/lib/customer-package-display-copy';
import { hasRiskyCustomerPromiseCopy } from '@/lib/customer-risky-copy';
import { renderPackage } from '@/lib/render-contract';
import type { OptionalTourStatus, PublicPackageSnapshot } from './types';

type AnyRecord = Record<string, unknown>;

const SNAPSHOT_VERSION = 'public-package-snapshot-v1' as const;

const OPTIONAL_TOUR_FRAGMENT_PATTERNS = [
  /노옵션/,
  /포\s*함\s*내\s*역/,
  /불\s*포\s*함\s*내\s*역/,
  /^(?:차량|가이드|기사|상품가|출발일|예약금|유류할증료|포함|불포함)$/,
  /^\d{1,3}$/,
  /^\d{1,2}\s*월\s*\d{1,2}/,
  /^\d{1,3}(?:,\d{3})*\s*원\s*\/?\s*인?$/,
  /^000\s*원\s*\/?\s*인?$/,
];

const RISKY_COPY_PATTERNS = [
  /예약\s*즉시\s*항공\s*[·ㆍ,]\s*숙박\s*확보/,
  /즉시\s*확정/,
  /무조건\s*출발/,
  /최저가\s*보장/,
  /좌석\s*확보\s*완료/,
  /숙박\s*확정/,
  /100%\s*보장/,
  /Decision\s*guide/i,
];

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function optionalTourText(tour: unknown): string {
  if (typeof tour === 'string') return normalizeText(tour);
  const record = asRecord(tour);
  if (!record) return '';
  return [
    record.name,
    record.displayName,
    record.title,
    record.label,
    record.price,
    record.price_usd,
    record.price_krw,
    record.note,
  ].map(normalizeText).filter(Boolean).join(' ');
}

export function isOptionalTourFragment(tour: unknown): boolean {
  const text = optionalTourText(tour);
  if (!text) return true;
  return OPTIONAL_TOUR_FRAGMENT_PATTERNS.some(pattern => pattern.test(text));
}

function hasOptionalTourPrice(tour: unknown): boolean {
  const record = asRecord(tour);
  if (!record) return /\$\s*\d+|USD\s*\d+|\d{1,3}(?:,\d{3})*\s*원/.test(String(tour ?? ''));
  return ['price', 'price_usd', 'price_krw', 'price_jpy', 'amount'].some((key) => {
    const candidate = record[key];
    if (typeof candidate === 'number') return candidate > 0;
    return typeof candidate === 'string' && /\d/.test(candidate);
  });
}

export function classifyOptionalTours(input: {
  optionalTours: unknown;
  rawText?: string | null;
}): {
  status: OptionalTourStatus;
  publicTours: unknown[];
  pollutedTours: unknown[];
  badges: string[];
} {
  const rawText = input.rawText ?? '';
  const tours = Array.isArray(input.optionalTours) ? input.optionalTours : [];
  const noOptionExplicit = /(?:선택\s*관광|선택옵션|옵션)\s*[:：]?\s*노옵션|노옵션\s*상품|노팁\s*[·ㆍ/&]?\s*노옵션/.test(rawText);
  const pollutedTours = tours.filter(isOptionalTourFragment);
  const publicTours = tours.filter(tour => !isOptionalTourFragment(tour) && hasOptionalTourPrice(tour));

  if (pollutedTours.length > 0) {
    return {
      status: noOptionExplicit ? 'none_explicit' : 'polluted',
      publicTours: noOptionExplicit ? [] : publicTours,
      pollutedTours,
      badges: noOptionExplicit ? ['노옵션'] : [],
    };
  }
  if (noOptionExplicit) return { status: 'none_explicit', publicTours: [], pollutedTours: [], badges: ['노옵션'] };
  if (publicTours.length > 0) return { status: 'paid_options', publicTours, pollutedTours: [], badges: [] };
  return { status: 'unknown', publicTours: [], pollutedTours: [], badges: [] };
}

function destinations(pkg: AnyRecord): string[] {
  const destination = asString(pkg.destination);
  if (!destination) return [];
  return destination.split(/[\/,·&]+/).map(part => part.trim()).filter(Boolean);
}

function priceDisplay(pkg: AnyRecord): string | null {
  const price = asNumber(pkg.price);
  if (!price || price <= 0) return null;
  return `${price.toLocaleString('ko-KR')}원~`;
}

function representativeCustomerPrice(pkg: AnyRecord): number | null {
  const productPrices = Array.isArray(pkg.product_prices) ? pkg.product_prices : [];
  const sellingPrices = productPrices
    .map(row => asNumber(asRecord(row)?.adult_selling_price))
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  if (sellingPrices.length > 0) return Math.min(...sellingPrices);

  const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
  const datePrices = priceDates
    .map(row => {
      const record = asRecord(row);
      return asNumber(record?.adult_selling_price ?? record?.price ?? record?.selling_price);
    })
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  if (datePrices.length > 0) return Math.min(...datePrices);

  return null;
}

function formatDuration(pkg: AnyRecord): string | null {
  const nights = asNumber(pkg.nights);
  const duration = asNumber(pkg.duration);
  if (nights && duration) return `${nights}박${duration}일`;
  if (duration && duration > 1) return `${duration - 1}박${duration}일`;
  if (duration) return `${duration}일`;
  const source = [pkg.trip_style, pkg.title, pkg.display_title].map(normalizeText).join(' ');
  const match = source.match(/\d+\s*박\s*\d+\s*일|\d+\s*일/);
  return match ? match[0].replace(/\s+/g, '') : null;
}

function sourceBundle(pkg: AnyRecord): string {
  return [
    pkg.raw_text,
    pkg.title,
    pkg.display_title,
    pkg.product_summary,
    ...(Array.isArray(pkg.product_highlights) ? pkg.product_highlights : []),
    JSON.stringify(pkg.itinerary_data ?? {}),
  ].map(normalizeText).filter(Boolean).join(' ');
}

function titleDestination(pkg: AnyRecord, sourceText: string): string | null {
  const destination = firstNonEmpty(pkg.destination);
  const cleanDestination = destination
    ?.replace(/\s*\/\s*/g, '·')
    .replace(/\s+/g, ' ')
    .trim() ?? '';

  if (/연길|백두산|장백산/.test(cleanDestination + sourceText)) return '연길·백두산';
  if (/하노이|하롱|하롱베이/.test(cleanDestination + sourceText)) return '하노이·하롱베이';
  if (/나트랑|달랏/.test(cleanDestination + sourceText)) return '나트랑·달랏';
  if (/다낭|호이안/.test(cleanDestination + sourceText)) return '다낭·호이안';
  if (/후쿠오카|유후인|벳부|규슈|큐슈/.test(cleanDestination + sourceText)) return /규슈|큐슈/.test(cleanDestination) ? '규슈' : '후쿠오카·규슈';
  if (/북해도|홋카이도|삿포로/.test(cleanDestination + sourceText)) return '북해도';
  return cleanDestination || null;
}

function titleCondition(sourceText: string, optionBadges: string[]): string | null {
  if (/노팁/.test(sourceText) && (/노옵션/.test(sourceText) || optionBadges.includes('노옵션'))) return '노팁·노옵션';
  if (/노옵션/.test(sourceText) || optionBadges.includes('노옵션')) return '노옵션';
  if (/노쇼핑/.test(sourceText)) return '노쇼핑';
  return null;
}

function titleTheme(sourceText: string, destination: string): string {
  const onsenCount = (sourceText.match(/온천/g) ?? []).length;
  const hasStrongOnsen = onsenCount >= 2 && /온천(?:호텔|료칸|숙박|마을|지구|대표|테마)/.test(sourceText);
  if (hasStrongOnsen && !/연길·백두산/.test(destination)) return '온천·관광';
  if (/골프|CC|라운딩/.test(sourceText)) return '골프';
  if (/호핑|스노클|해변|리조트|자유일정|자유시간/.test(sourceText)) return '휴양관광';
  return '핵심관광';
}

function composePublicTitle(pkg: AnyRecord, optionBadges: string[]): string {
  const sourceText = sourceBundle(pkg);
  const destination = titleDestination(pkg, sourceText);
  const duration = formatDuration(pkg);
  if (!destination || !duration) return '';
  const condition = titleCondition(sourceText, optionBadges);
  const theme = titleTheme(sourceText, destination);
  const parts = [destination, condition, theme, duration].filter(Boolean) as string[];
  return [...new Set(parts)].join(' ').replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

function routeTextDump(snapshot: Omit<PublicPackageSnapshot, 'route_text_dump'>): string[] {
  const values = [
    snapshot.public_title,
    snapshot.public_subtitle,
    snapshot.price_display,
    snapshot.cta_copy.primary,
    snapshot.cta_copy.helper,
    ...snapshot.option_policy.badges,
    ...stringList(snapshot.package.product_highlights),
    ...stringList(snapshot.package.inclusions),
    ...stringList(snapshot.package.excludes),
  ];
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as AnyRecord;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function hashPublicPackageSnapshot(snapshot: PublicPackageSnapshot): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

export function hasRiskyCustomerCopy(value: unknown): boolean {
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value ?? '');
  return hasRiskyCustomerPromiseCopy(text) || RISKY_COPY_PATTERNS.some(pattern => pattern.test(text));
}

export function buildPublicPackageSnapshot(pkg: AnyRecord): {
  snapshot: PublicPackageSnapshot;
  snapshotHash: string;
  optionalTourClassification: ReturnType<typeof classifyOptionalTours>;
} {
  const publicPackage = sanitizeCustomerPackageForClient(pkg) ?? {};
  const customerPrice = representativeCustomerPrice(publicPackage);
  if (customerPrice !== null) {
    publicPackage.price = customerPrice;
  } else {
    delete publicPackage.price;
  }
  const displayCopy = buildCustomerPackageDisplayCopy({
    title: asString(publicPackage.title),
    display_title: asString(publicPackage.display_title),
    product_display_name: asString(asRecord(publicPackage.products)?.display_name),
    hero_tagline: asString(publicPackage.hero_tagline),
    product_summary: asString(publicPackage.product_summary),
    destination: asString(publicPackage.destination),
    duration: asNumber(publicPackage.duration),
    nights: asNumber(publicPackage.nights),
    trip_style: asString(publicPackage.trip_style),
    product_type: asString(publicPackage.product_type),
    airline: asString(publicPackage.airline),
    product_highlights: stringList(publicPackage.product_highlights),
    inclusions: stringList(publicPackage.inclusions),
    optional_tours: Array.isArray(publicPackage.optional_tours)
      ? publicPackage.optional_tours as Array<{ name?: string | null; displayName?: string | null; note?: string | null }>
      : [],
  });
  const optionalTourClassification = classifyOptionalTours({
    optionalTours: publicPackage.optional_tours,
    rawText: asString(pkg.raw_text),
  });
  const publicTitle = composePublicTitle(
    { ...pkg, ...publicPackage },
    optionalTourClassification.badges,
  );
  const publicSummary = displayCopy.summaryBody || null;
  const duration = asNumber(publicPackage.duration);
  const canonicalView = renderPackage(publicPackage as Parameters<typeof renderPackage>[0]) as unknown as Record<string, unknown>;
  const snapshotBase: Omit<PublicPackageSnapshot, 'route_text_dump'> = {
    snapshot_version: SNAPSHOT_VERSION,
    package_id: String(pkg.id ?? publicPackage.id ?? ''),
    package_revision: asNumber(pkg.package_revision) ?? 1,
    public_title: publicTitle,
    public_subtitle: displayCopy.heroSubline || null,
    duration,
    destinations: destinations(publicPackage),
    price_display: priceDisplay(publicPackage),
    option_policy: {
      status: optionalTourClassification.status,
      badges: optionalTourClassification.badges,
    },
    canonical_view: canonicalView,
    package: {
      ...publicPackage,
      title: publicTitle,
      display_title: publicTitle,
      product_summary: publicSummary,
      optional_tours: optionalTourClassification.publicTours,
      publication_state: pkg.publication_state ?? publicPackage.publication_state ?? null,
      package_revision: asNumber(pkg.package_revision) ?? 1,
    },
    inclusions_public: Array.isArray(publicPackage.inclusions) ? publicPackage.inclusions : [],
    exclusions_public: Array.isArray(publicPackage.excludes) ? publicPackage.excludes : [],
    itinerary_public: publicPackage.itinerary_data ?? null,
    optional_tours_public: optionalTourClassification.publicTours,
    images_public: [],
    cta_copy: {
      primary: '예약 가능 여부 확인',
      helper: '출발일과 객실 상황에 따라 요금이 달라질 수 있습니다.',
    },
    card_projection: {
      id: publicPackage.id,
      title: publicTitle,
      destination: publicPackage.destination ?? null,
      duration,
      nights: asNumber(publicPackage.nights),
      price: asNumber(publicPackage.price),
      price_display: priceDisplay(publicPackage),
      badges: displayCopy.badges,
    },
    lp_projection: {
      id: publicPackage.id,
      title: publicTitle,
      subtitle: displayCopy.heroSubline || null,
      destination: publicPackage.destination ?? null,
      summary: publicSummary,
      price: asNumber(publicPackage.price),
      price_display: priceDisplay(publicPackage),
      cta_copy: '예약 가능 여부 확인',
    },
  };
  const snapshot: PublicPackageSnapshot = {
    ...snapshotBase,
    route_text_dump: routeTextDump(snapshotBase),
  };
  return {
    snapshot,
    snapshotHash: hashPublicPackageSnapshot(snapshot),
    optionalTourClassification,
  };
}
