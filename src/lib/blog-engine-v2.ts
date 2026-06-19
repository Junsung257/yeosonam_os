import { getEffectivePriceDates, getMinPriceFromDates, getNextDepartureFromDates, type PriceDate } from './price-dates';
import { slugifyTopic } from './slug-utils';

export type BlogArticleKind = 'product_article' | 'info_guide' | 'hybrid_article';
export type EvidenceSource = 'travel_packages' | 'official_source' | 'serp_signal' | 'manual';

export interface EvidenceFact {
  id: string;
  source: EvidenceSource;
  field: string;
  label: string;
  value: unknown;
  display: string;
  confidence: 'high' | 'medium' | 'low';
  factual: boolean;
}

export interface ProductFactPack {
  kind: 'product';
  productId: string;
  title: string;
  destination: string | null;
  durationLabel: string | null;
  priceLabel: string | null;
  nextDepartureLabel: string | null;
  departureSummary: ProductDepartureSummary;
  facts: EvidenceFact[];
  blockers: string[];
  warnings: string[];
  canonicalFacts: {
    price: number | null;
    priceDates: PriceDate[];
    departureSummary: ProductDepartureSummary;
    inclusions: string[];
    excludes: string[];
    highlights: string[];
    itineraryDays: string[];
    optionalTours: string[];
    notices: string[];
    allowedClaimText: string;
  };
}

export interface ProductDepartureSummary {
  availableDateCount: number;
  confirmedDateCount: number;
  nextDepartureDate: string | null;
  nextConfirmedDepartureDate: string | null;
  lowestPriceDateLabels: string[];
  departureDaysLabel: string | null;
  seatsConfirmed: number | null;
  summaryLabel: string;
}

export interface InfoEvidencePack {
  kind: 'info';
  topic: string;
  facts: EvidenceFact[];
  serpSignals: string[];
  blockers: string[];
  warnings: string[];
}

export type EvidencePack = ProductFactPack | InfoEvidencePack;

export interface BlogIntentProfile {
  kind: BlogArticleKind;
  angleType?: string | null;
  primaryKeyword?: string | null;
  audience?: string | null;
}

export interface BlogArticleBrief {
  evidencePack: EvidencePack;
  intent: BlogIntentProfile;
  requiredSections: string[];
}

export interface ArticleSection {
  heading: string;
  body: string;
  factIds: string[];
}

export interface ArticleContract {
  kind: BlogArticleKind;
  title: string;
  lede: string;
  searchIntent: string;
  readerProblem: string;
  sections: ArticleSection[];
  faq: Array<{ question: string; answer: string; factIds: string[] }>;
  cta: { label: string; href: string; body: string };
  internalLinks: Array<{ label: string; href: string }>;
  seo: { title: string; description: string; slug: string };
  schema: { type: 'BlogPosting' | 'Product' | 'TouristTrip'; enabled: boolean };
  riskFlags: string[];
}

export interface FactIntegrityResult {
  passed: boolean;
  issues: Array<{ code: string; message: string; evidence?: Record<string, unknown> }>;
  checkedAt: string;
}

export interface ProductFactPolicy {
  mode: 'product';
  allowedMoneyClaims: string[];
  blockedClaims: string[];
}

export interface DistributionSnippetSet {
  canonicalUrl: string;
  title: string;
  description: string;
  teaser: string;
  ogTitle: string;
}

export interface OfficialSourceCandidate {
  title: string;
  url: string;
  summary: string;
  official: boolean;
  topics: string[];
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const n = Number(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function asStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === 'string') return [item];
        const rec = asRecord(item);
        return [
          rec.title,
          rec.name,
          rec.label,
          rec.text,
          rec.activity,
          rec.description,
        ].map(asString).filter(Boolean) as string[];
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        return asStringArray(JSON.parse(trimmed));
      } catch {
        return [trimmed];
      }
    }
    return trimmed
      .split(/\r?\n|[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function extractItineraryDays(row: AnyRecord): string[] {
  const direct = asStringArray(row.itinerary);
  if (direct.length > 0) return direct.slice(0, 8);

  const data = asRecord(row.itinerary_data);
  const days = Array.isArray(data.days) ? data.days : [];
  return days
    .map((day, index) => {
      const rec = asRecord(day);
      const title = asString(rec.title) || asString(rec.day_title);
      const activities = asStringArray(rec.activities || rec.items || rec.schedule).slice(0, 4);
      const label = title || `${index + 1}일차`;
      return [label, ...activities].filter(Boolean).join(' - ');
    })
    .filter(Boolean)
    .slice(0, 8);
}

function extractNotices(row: AnyRecord): string[] {
  const parsed = row.notices_parsed;
  const parsedNotices = Array.isArray(parsed)
    ? parsed.flatMap((item) => {
      const rec = asRecord(item);
      return asStringArray(rec.items || rec.lines || rec.notices || rec.text);
    })
    : [];
  return [
    ...parsedNotices,
    ...asStringArray(row.special_notes),
    ...asStringArray(row.notes),
    ...asStringArray(row.customer_notes),
  ].slice(0, 10);
}

function formatWon(value: number | null): string | null {
  if (!value || value <= 0) return null;
  return `${value.toLocaleString('ko-KR')}원~`;
}

function durationLabel(row: AnyRecord): string | null {
  const duration = asNumber(row.duration);
  const nights = asNumber(row.nights);
  if (!duration) return null;
  const resolvedNights = nights ?? Math.max(duration - 1, 0);
  return `${resolvedNights}박 ${duration}일`;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeDate(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isIsoDate(trimmed)) return trimmed;
    const match = trimmed.match(/\d{4}-\d{2}-\d{2}/);
    return match?.[0] ?? null;
  }
  const rec = asRecord(value);
  return normalizeDate(rec.date ?? rec.departure_date ?? rec.day);
}

function extractConfirmedDates(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeDate).filter((date): date is string => Boolean(date)))].sort();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        return extractConfirmedDates(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return [...new Set((trimmed.match(/\d{4}-\d{2}-\d{2}/g) ?? []))].sort();
  }
  return [];
}

function buildDepartureSummary(row: AnyRecord, priceDates: PriceDate[], effectivePrice: number): ProductDepartureSummary {
  const today = todayIso();
  const futureDates = priceDates
    .filter((date) => isIsoDate(date.date) && date.date >= today && date.price > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const confirmedFromPriceDates = futureDates.filter((date) => date.confirmed).map((date) => date.date);
  const confirmedFromRow = extractConfirmedDates(row.confirmed_dates).filter((date) => date >= today);
  const confirmedDates = [...new Set([...confirmedFromPriceDates, ...confirmedFromRow])].sort();
  const lowestFuturePrice = futureDates.length > 0
    ? Math.min(...futureDates.map((date) => date.price).filter((price) => price > 0))
    : effectivePrice;
  const lowestPriceDateLabels = futureDates
    .filter((date) => date.price === lowestFuturePrice)
    .map((date) => `${date.date}${date.confirmed ? ' 확정' : ''}`)
    .slice(0, 4);
  const departureDaysLabel = asString(row.departure_days);
  const seatsConfirmed = asNumber(row.seats_confirmed);
  const nextDepartureDate = futureDates[0]?.date ?? getNextDepartureFromDates(priceDates);
  const nextConfirmedDepartureDate = confirmedDates[0] ?? null;
  const summaryParts = [
    nextDepartureDate ? `다음 출발일 ${nextDepartureDate}` : null,
    nextConfirmedDepartureDate ? `다음 출발확정 ${nextConfirmedDepartureDate}` : null,
    futureDates.length > 0 ? `출발 가능일 ${futureDates.length}개` : null,
    confirmedDates.length > 0 ? `출발확정 ${confirmedDates.length}개` : null,
    lowestPriceDateLabels.length > 0 ? `최저가 출발일 ${lowestPriceDateLabels.join(', ')}` : null,
    departureDaysLabel ? `출발 요일 ${departureDaysLabel}` : null,
    seatsConfirmed ? `확보 좌석 ${seatsConfirmed}석` : null,
  ].filter(Boolean);

  return {
    availableDateCount: futureDates.length,
    confirmedDateCount: confirmedDates.length,
    nextDepartureDate,
    nextConfirmedDepartureDate,
    lowestPriceDateLabels,
    departureDaysLabel,
    seatsConfirmed,
    summaryLabel: summaryParts.join(' · ') || '출발일은 상담에서 확인 필요',
  };
}

function addFact(facts: EvidenceFact[], field: string, label: string, value: unknown, display?: string): void {
  const shown = display ?? (Array.isArray(value) ? value.join(', ') : String(value ?? '')).trim();
  if (!shown) return;
  facts.push({
    id: `travel_packages.${field}`,
    source: 'travel_packages',
    field,
    label,
    value,
    display: shown,
    confidence: 'high',
    factual: true,
  });
}

export function buildProductFactPack(productRow: AnyRecord): ProductFactPack {
  const id = asString(productRow.id) || '';
  const title = asString(productRow.title) || '';
  const destination = asString(productRow.destination);
  const duration = durationLabel(productRow);
  const priceDates = getEffectivePriceDates({
    price_dates: Array.isArray(productRow.price_dates) ? productRow.price_dates as PriceDate[] : undefined,
    price_tiers: Array.isArray(productRow.price_tiers) ? productRow.price_tiers as never[] : undefined,
  });
  const minDatePrice = priceDates.length > 0 ? getMinPriceFromDates(priceDates) : 0;
  const fallbackPrice = asNumber(productRow.price) ?? 0;
  const price = minDatePrice > 0 ? minDatePrice : fallbackPrice;
  const priceLabel = formatWon(price);
  const nextDeparture = priceDates.length > 0 ? getNextDepartureFromDates(priceDates) : null;
  const departureSummary = buildDepartureSummary(productRow, priceDates, price);
  const inclusions = asStringArray(productRow.inclusions);
  const excludes = asStringArray(productRow.excludes);
  const highlights = [
    ...asStringArray(productRow.product_highlights),
    ...asStringArray(productRow.structured_features),
    ...asStringArray(productRow.product_tags),
  ].slice(0, 8);
  const itineraryDays = extractItineraryDays(productRow);
  const optionalTours = asStringArray(productRow.optional_tours).slice(0, 8);
  const notices = extractNotices(productRow);
  const facts: EvidenceFact[] = [];

  addFact(facts, 'title', '상품명', title);
  addFact(facts, 'destination', '목적지', destination);
  addFact(facts, 'duration', '일정', duration);
  addFact(facts, 'price', '출발가', price, priceLabel ?? undefined);
  addFact(facts, 'next_departure', '다음 출발일', nextDeparture);
  addFact(facts, 'departure_summary', '출발 계산 요약', departureSummary, departureSummary.summaryLabel);
  addFact(facts, 'airline', '항공', asString(productRow.airline));
  addFact(facts, 'departure_airport', '출발 공항', asString(productRow.departure_airport));
  addFact(facts, 'inclusions', '포함사항', inclusions);
  addFact(facts, 'excludes', '불포함사항', excludes);
  addFact(facts, 'highlights', '핵심 포인트', highlights);
  addFact(facts, 'itinerary', '일정 요약', itineraryDays);
  addFact(facts, 'optional_tours', '선택관광', optionalTours);
  addFact(facts, 'notices', '유의사항', notices);

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!id) blockers.push('missing_product_id');
  if (!title) blockers.push('missing_title');
  if (!destination) blockers.push('missing_destination');
  if (!duration) warnings.push('missing_duration');
  if (!priceLabel) blockers.push('missing_price');
  if (inclusions.length === 0 && excludes.length === 0) warnings.push('missing_inclusion_exclusion');
  if (itineraryDays.length === 0) warnings.push('missing_itinerary');

  const allowedClaimText = facts.map((fact) => fact.display).join('\n');
  return {
    kind: 'product',
    productId: id,
    title,
    destination,
    durationLabel: duration,
    priceLabel,
    nextDepartureLabel: nextDeparture,
    departureSummary,
    facts,
    blockers,
    warnings,
    canonicalFacts: {
      price: price > 0 ? price : null,
      priceDates,
      departureSummary,
      inclusions,
      excludes,
      highlights,
      itineraryDays,
      optionalTours,
      notices,
      allowedClaimText,
    },
  };
}

export function buildInfoEvidencePack(
  topic: string,
  sourceCandidates: Array<{ title?: string; url?: string; summary?: string; official?: boolean }> = [],
  serpSignals: string[] = [],
): InfoEvidencePack {
  const facts = sourceCandidates
    .filter((source) => source.official || source.url)
    .map((source, index): EvidenceFact => ({
      id: `source.${index + 1}`,
      source: source.official ? 'official_source' : 'manual',
      field: source.url ?? source.title ?? `source_${index + 1}`,
      label: source.title ?? source.url ?? `Source ${index + 1}`,
      value: source,
      display: [source.title, source.summary, source.url].filter(Boolean).join(' | '),
      confidence: source.official ? 'high' : 'medium',
      factual: true,
    }));

  return {
    kind: 'info',
    topic,
    facts,
    serpSignals,
    blockers: facts.length === 0 ? ['missing_trusted_sources'] : [],
    warnings: serpSignals.length === 0 ? ['missing_serp_signals'] : [],
  };
}

export function buildTravelOfficialSourceCandidates(input: {
  topic: string;
  destination?: string | null;
  freshnessTopics?: string[];
  sourceRequirements?: string[];
}): OfficialSourceCandidate[] {
  const text = `${input.topic} ${input.destination ?? ''} ${(input.freshnessTopics ?? []).join(' ')} ${(input.sourceRequirements ?? []).join(' ')}`;
  const candidates: OfficialSourceCandidate[] = [
    {
      title: '외교부 해외안전여행',
      url: 'https://www.0404.go.kr/',
      summary: '국가별 안전, 사건사고, 여행경보, 현지 유의사항 확인',
      official: true,
      topics: ['safety', 'visa_entry', 'regulation', 'travel_advisory'],
    },
    {
      title: '외교부',
      url: 'https://www.mofa.go.kr/',
      summary: '입국, 외교, 재외공관, 국가별 공지 확인',
      official: true,
      topics: ['visa_entry', 'regulation', 'embassy'],
    },
    {
      title: '대한민국 구석구석',
      url: 'https://korean.visitkorea.or.kr/',
      summary: '국내외 여행 콘텐츠 품질 기준과 여행 정보 참고',
      official: true,
      topics: ['general', 'itinerary', 'attraction'],
    },
    {
      title: '기상청 날씨누리',
      url: 'https://www.weather.go.kr/',
      summary: '날씨, 기온, 강수, 태풍 등 기상 정보 확인',
      official: true,
      topics: ['weather'],
    },
    {
      title: '인천국제공항',
      url: 'https://www.airport.kr/',
      summary: '공항, 출국, 항공, 터미널, 수속 정보 확인',
      official: true,
      topics: ['transport', 'airport', 'flight'],
    },
    {
      title: '관세청',
      url: 'https://www.customs.go.kr/',
      summary: '면세, 반입, 통관, 세관 규정 확인',
      official: true,
      topics: ['regulation', 'customs', 'duty_free'],
    },
  ];

  const wanted = new Set<string>();
  if (/비자|입국|출입국|여권|eta|esta|evisa|visa|entry/i.test(text)) {
    wanted.add('visa_entry');
  }
  if (/안전|치안|분실|응급|대사관|영사관|주의|safety/i.test(text)) {
    wanted.add('safety');
  }
  if (/날씨|기온|우기|건기|태풍|강수|weather|rain|season/i.test(text)) {
    wanted.add('weather');
  }
  if (/공항|항공|교통|이동|비행|airport|flight|transport/i.test(text)) {
    wanted.add('transport');
  }
  if (/면세|반입|검역|세관|통관|customs|duty/i.test(text)) {
    wanted.add('customs');
    wanted.add('regulation');
  }
  for (const topic of input.freshnessTopics ?? []) {
    wanted.add(topic);
  }
  if (wanted.size === 0 && (input.sourceRequirements?.length ?? 0) > 0) {
    wanted.add('general');
    wanted.add('travel_advisory');
  }

  const matched = candidates.filter((candidate) => candidate.topics.some((topic) => wanted.has(topic)));
  const fallback = candidates.filter((candidate) => ['travel_advisory', 'general'].some((topic) => candidate.topics.includes(topic)));
  const byUrl = new Map<string, OfficialSourceCandidate>();
  for (const source of [...matched, ...fallback]) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source);
  }
  return [...byUrl.values()].slice(0, 4);
}

export function formatInfoEvidencePromptBlock(pack: InfoEvidencePack): string {
  if (pack.facts.length === 0) {
    return `
## Source Evidence
- No trusted source candidate is available. Do not write fresh facts, prices, entry rules, safety, weather, or transport claims as current facts.
`;
  }

  return `
## Source Evidence
Use these as trusted reference links. Competitor/SERP signals are only intent signals, not factual sources.
${pack.facts.map((fact) => `- [${fact.label}](${asRecord(fact.value).url ?? fact.field}) - ${fact.display}`).join('\n')}

Rules:
- If a current/fresh fact is not supported by these sources, write it as "확인 필요" or omit it.
- Do not use competitor blog snippets as factual evidence.
- Keep a "공식 확인 링크" section in the final markdown.
`;
}

export function classifyBlogIntentV2(queueItem: AnyRecord): BlogIntentProfile {
  if (queueItem.product_id) {
    return { kind: 'product_article', angleType: asString(queueItem.angle_type), primaryKeyword: asString(queueItem.primary_keyword) };
  }
  if (queueItem.meta && asRecord(queueItem.meta).product_id) {
    return { kind: 'hybrid_article', angleType: asString(queueItem.angle_type), primaryKeyword: asString(queueItem.primary_keyword) };
  }
  return { kind: 'info_guide', angleType: asString(queueItem.angle_type), primaryKeyword: asString(queueItem.primary_keyword) };
}

export function buildArticleBrief(evidencePack: EvidencePack, intent: BlogIntentProfile): BlogArticleBrief {
  const requiredSections = evidencePack.kind === 'product'
    ? ['summary', 'conditions', 'itinerary', 'included_excluded', 'fit', 'faq', 'cta']
    : ['answer', 'evidence', 'comparison', 'faq', 'next_action'];
  return { evidencePack, intent, requiredSections };
}

function productPackageHref(productId: string, slot: string): string {
  return `/packages/${encodeURIComponent(productId)}?utm_source=naver_blog&utm_medium=organic&utm_campaign=blog_engine_v2&utm_content=${slot}`;
}

export function generateArticleContract(brief: BlogArticleBrief): ArticleContract {
  if (brief.evidencePack.kind !== 'product') {
    const topic = brief.evidencePack.topic;
    return {
      kind: brief.intent.kind,
      title: topic,
      lede: `${topic}에 대해 확인된 출처를 기준으로 정리했습니다.`,
      searchIntent: 'trusted travel information',
      readerProblem: '여행 전 확인해야 할 핵심 정보 파악',
      sections: brief.requiredSections.map((heading) => ({
        heading,
        body: '확인된 출처 기준으로만 본문을 구성합니다.',
        factIds: brief.evidencePack.facts.map((fact) => fact.id),
      })),
      faq: [],
      cta: { label: '관련 상품 보기', href: '/packages', body: '조건이 맞는 상품이 있으면 상담으로 연결합니다.' },
      internalLinks: [{ label: '여행 상품 보기', href: '/packages' }],
      seo: { title: topic.slice(0, 58), description: `${topic} 여행 정보를 확인된 출처 기준으로 정리했습니다.`, slug: slugifyTopic(topic) },
      schema: { type: 'BlogPosting', enabled: true },
      riskFlags: brief.evidencePack.blockers,
    };
  }

  const pack = brief.evidencePack;
  const dest = pack.destination ?? '여행지';
  const duration = pack.durationLabel ?? '일정 확인';
  const price = pack.priceLabel ?? '가격 확인 필요';
  const title = `${dest} ${duration} 상품, 가격과 포함사항 먼저 확인하기`;
  const conditionFacts = pack.facts
    .filter((fact) => ['price', 'duration', 'airline', 'departure_airport', 'next_departure', 'departure_summary'].includes(fact.field))
    .map((fact) => fact.id);

  return {
    kind: 'product_article',
    title,
    lede: `${pack.title}은 ${dest} ${duration} 기준의 패키지입니다. 이 글은 등록된 상품 데이터에 있는 가격, 일정, 포함사항만 기준으로 정리합니다.`,
    searchIntent: 'package comparison and booking consideration',
    readerProblem: '가격, 일정, 포함사항, 주의사항을 빠르게 확인하고 상담 여부를 결정',
    sections: [
      {
        heading: '이 상품을 먼저 봐야 하는 사람',
        body: `${dest} 여행을 준비하면서 ${duration} 일정과 ${price} 조건을 먼저 비교하려는 분에게 맞습니다. 본문은 등록된 상품 정보만 기준으로 작성했습니다.`,
        factIds: ['travel_packages.destination', 'travel_packages.duration', 'travel_packages.price'],
      },
      {
        heading: '가격과 출발 조건',
        body: `현재 본문에 표시하는 가격은 상품 등록 데이터 기준 ${price}입니다. 출발 계산 요약은 ${pack.departureSummary.summaryLabel}입니다. 출발일별 가격이 다를 수 있으므로 예약 전 상담에서 최종 조건을 확인해야 합니다.`,
        factIds: conditionFacts,
      },
      {
        heading: '일정에서 확인할 포인트',
        body: pack.canonicalFacts.itineraryDays.length > 0
          ? '일정은 이동 동선과 주요 방문지를 먼저 확인한 뒤, 체력과 동행자 구성에 맞는지 보는 것이 좋습니다.'
          : '상세 일정 데이터가 충분하지 않아 상담 단계에서 일자별 동선을 확인해야 합니다.',
        factIds: ['travel_packages.itinerary'],
      },
      {
        heading: '포함사항과 불포함사항',
        body: '패키지 상품은 가격만 보면 판단이 어렵습니다. 포함사항과 불포함사항을 같이 봐야 실제 준비 비용을 줄일 수 있습니다.',
        factIds: ['travel_packages.inclusions', 'travel_packages.excludes'],
      },
      {
        heading: '예약 전 확인할 유의사항',
        body: '좌석, 출발 확정, 추가 비용, 선택관광, 취소 조건은 예약 시점에 달라질 수 있으므로 상담에서 최신 조건을 확인해야 합니다.',
        factIds: ['travel_packages.notices', 'travel_packages.optional_tours'],
      },
    ],
    faq: [
      {
        question: `${dest} ${duration} 상품 가격은 얼마인가요?`,
        answer: `등록된 상품 데이터 기준 표시 가격은 ${price}입니다. 출발일과 객실 조건에 따라 달라질 수 있습니다.`,
        factIds: ['travel_packages.price', 'travel_packages.duration'],
      },
      {
        question: '포함사항과 불포함사항은 어디서 확인하나요?',
        answer: '본문의 포함사항/불포함사항 표를 먼저 보고, 예약 전 상담에서 최신 조건을 다시 확인하는 방식이 안전합니다.',
        factIds: ['travel_packages.inclusions', 'travel_packages.excludes'],
      },
      {
        question: '바로 예약해도 되나요?',
        answer: '가격, 출발일, 좌석, 객실, 취소 조건은 상담에서 최종 확인한 뒤 예약하는 것이 좋습니다.',
        factIds: ['travel_packages.price', 'travel_packages.notices'],
      },
    ],
    cta: {
      label: '상품 상세와 상담 연결 보기',
      href: productPackageHref(pack.productId, 'bottom_cta'),
      body: `${pack.title}의 최신 조건은 상품 상세와 상담에서 확인할 수 있습니다.`,
    },
    internalLinks: [
      { label: `${dest} 상품 더 보기`, href: `/packages?destination=${encodeURIComponent(dest)}` },
      { label: '전체 패키지 보기', href: '/packages' },
      { label: '상담 신청하기', href: '/group-inquiry' },
    ],
    seo: {
      title: `${dest} ${duration} 패키지 가격·일정·포함사항 정리`.slice(0, 58),
      description: `${pack.title}의 가격, 일정, 포함사항, 불포함사항, 유의사항을 상품 등록 데이터 기준으로 정리했습니다.`.slice(0, 155),
      slug: slugifyTopic(`${dest}-${duration}-${pack.title}`).slice(0, 72),
    },
    schema: { type: 'TouristTrip', enabled: true },
    riskFlags: [...pack.blockers, ...pack.warnings],
  };
}

export function validateArticleContract(article: ArticleContract, evidencePack: EvidencePack): FactIntegrityResult {
  const factIds = new Set(evidencePack.facts.map((fact) => fact.id));
  const issues: FactIntegrityResult['issues'] = [];
  for (const section of article.sections) {
    for (const factId of section.factIds) {
      if (!factIds.has(factId)) {
        issues.push({ code: 'unknown_fact_reference', message: `${section.heading} references ${factId}` });
      }
    }
  }
  for (const item of article.faq) {
    for (const factId of item.factIds) {
      if (!factIds.has(factId)) {
        issues.push({ code: 'unknown_fact_reference', message: `${item.question} references ${factId}` });
      }
    }
  }
  if (evidencePack.blockers.length > 0) {
    issues.push({ code: 'evidence_blockers', message: evidencePack.blockers.join(', ') });
  }
  return { passed: issues.length === 0, issues, checkedAt: new Date().toISOString() };
}

function listMarkdown(items: string[], emptyText: string): string {
  if (items.length === 0) return `- ${emptyText}`;
  return items.map((item) => `- ${item}`).join('\n');
}

function conditionsTable(pack: ProductFactPack): string {
  const rows = [
    ['상품명', pack.title],
    ['목적지', pack.destination ?? '확인 필요'],
    ['일정', pack.durationLabel ?? '확인 필요'],
    ['표시 가격', pack.priceLabel ?? '확인 필요'],
    ['다음 출발일', pack.nextDepartureLabel ?? '출발일별 확인 필요'],
  ];
  const airline = pack.facts.find((fact) => fact.field === 'airline')?.display;
  const airport = pack.facts.find((fact) => fact.field === 'departure_airport')?.display;
  rows.push(['출발 계산', pack.departureSummary.summaryLabel]);
  if (airline) rows.push(['항공', airline]);
  if (airport) rows.push(['출발 공항', airport]);
  return [
    '| 확인 항목 | 등록 데이터 기준 |',
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
  ].join('\n');
}

function productAnswerSummary(article: ArticleContract, pack: ProductFactPack): string {
  const dest = pack.destination ?? '해당 여행지';
  const duration = pack.durationLabel ?? '일정 확인 필요';
  const price = pack.priceLabel ?? '가격 확인 필요';
  const included = pack.canonicalFacts.inclusions.slice(0, 3).join(', ') || '포함사항 확인 필요';
  const excluded = pack.canonicalFacts.excludes.slice(0, 3).join(', ') || '불포함사항 확인 필요';
  return [
    `**답변:** ${pack.title}은 ${dest} ${duration} 기준의 패키지 상품입니다.`,
    `등록된 상품 데이터 기준 표시 가격은 ${price}이며, 출발일과 객실 조건에 따라 최종 금액은 상담에서 확인해야 합니다.`,
    `출발 계산 기준으로는 ${pack.departureSummary.summaryLabel}입니다.`,
    `주요 포함사항은 ${included}이고, 불포함사항은 ${excluded}입니다.`,
    `가격만 비교하기보다 일정, 포함사항, 불포함사항, 유의사항을 함께 확인한 뒤 ${article.cta.label}로 최신 조건을 확인하는 것이 좋습니다.`,
  ].join('\n');
}

function productQuestionHeading(section: ArticleSection, pack: ProductFactPack): string {
  const dest = pack.destination ?? '이 여행지';
  const duration = pack.durationLabel ?? '이 일정';
  const factIds = new Set(section.factIds);
  if (factIds.has('travel_packages.inclusions') || factIds.has('travel_packages.excludes')) {
    return '포함사항과 불포함사항은 무엇인가요?';
  }
  if (factIds.has('travel_packages.itinerary')) {
    return `${dest} ${duration} 일정에서 무엇을 확인해야 하나요?`;
  }
  if (factIds.has('travel_packages.notices') || factIds.has('travel_packages.optional_tours')) {
    return '예약 전 어떤 유의사항을 확인해야 하나요?';
  }
  if (factIds.has('travel_packages.price') || factIds.has('travel_packages.duration')) {
    return `${dest} ${duration} 상품 가격과 출발 조건은 무엇인가요?`;
  }
  return section.heading.endsWith('?') ? section.heading : `${section.heading}은 무엇인가요?`;
}

export function renderArticleMarkdown(article: ArticleContract, evidencePack: EvidencePack): string {
  if (evidencePack.kind !== 'product') {
    return [
      `# ${article.title}`,
      '',
      article.lede,
      '',
      ...article.sections.flatMap((section) => [`## ${section.heading}`, '', section.body, '']),
      `## 다음 단계`,
      '',
      `[${article.cta.label}](${article.cta.href})`,
    ].join('\n');
  }

  const pack = evidencePack;
  const topHref = productPackageHref(pack.productId, 'intro_cta');
  const highlights = pack.canonicalFacts.highlights.length > 0
    ? pack.canonicalFacts.highlights
    : article.sections.map((section) => section.heading).slice(0, 3);

  return [
    `# ${article.title}`,
    '',
    article.lede,
    '',
    '## 핵심 답변',
    '',
    productAnswerSummary(article, pack),
    '',
    `> ${pack.priceLabel ?? '가격 확인 필요'} 조건과 ${pack.durationLabel ?? '일정'}을 먼저 보고 싶다면 [상품 상세에서 현재 조건 확인하기](${topHref})로 바로 이동할 수 있습니다.`,
    '',
    '## 한눈에 보는 상품 조건',
    '',
    conditionsTable(pack),
    '',
    '## 핵심 포인트',
    '',
    listMarkdown(highlights, '등록된 핵심 포인트가 부족해 상담에서 상품 장점을 확인해야 합니다.'),
    '',
    ...article.sections.flatMap((section) => [`## ${productQuestionHeading(section, pack)}`, '', section.body, '']),
    '## 일정 요약',
    '',
    listMarkdown(pack.canonicalFacts.itineraryDays, '상세 일정 데이터가 부족합니다. 예약 전 일자별 동선을 확인해야 합니다.'),
    '',
    '## 포함사항',
    '',
    listMarkdown(pack.canonicalFacts.inclusions, '포함사항 데이터가 부족합니다.'),
    '',
    '## 불포함사항',
    '',
    listMarkdown(pack.canonicalFacts.excludes, '불포함사항 데이터가 부족합니다.'),
    '',
    '## 선택관광과 유의사항',
    '',
    listMarkdown([...pack.canonicalFacts.optionalTours, ...pack.canonicalFacts.notices].slice(0, 12), '선택관광 또는 유의사항 데이터가 부족합니다.'),
    '',
    '## 이런 분에게 맞습니다',
    '',
    `- ${pack.destination ?? '해당 지역'} 여행을 상품 조건 중심으로 비교하고 싶은 분`,
    `- ${pack.durationLabel ?? '일정'} 안에서 이동, 포함사항, 불포함사항을 한 번에 확인하고 싶은 분`,
    '- 예약 전 상담으로 출발일, 좌석, 객실, 최종 금액을 확인하려는 분',
    '',
    '## 자주 묻는 질문',
    '',
    ...article.faq.flatMap((item) => [`**Q. ${item.question}**`, '', `A. ${item.answer}`, '']),
    '## 다음 단계',
    '',
    article.cta.body,
    '',
    `[${article.cta.label}](${article.cta.href})`,
    '',
    '## 관련 링크',
    '',
    ...article.internalLinks.map((link) => `- [${link.label}](${link.href})`),
  ].join('\n');
}

const UNSUPPORTED_PRODUCT_CLAIMS = [
  '숨은 비용 없음',
  '시장가',
  '절약',
  '무조건 출발',
  '100% 확정',
  '완벽한',
  '유일한',
  '보장',
];

function normalizeMoneyClaim(value: string): string {
  if (value.includes('만원')) {
    const n = Number(value.replace(/[^\d]/g, ''));
    return Number.isFinite(n) ? String(n * 10000) : value;
  }
  return value.replace(/[^\d]/g, '');
}

export function buildProductFactPolicy(evidencePack: ProductFactPack): ProductFactPolicy {
  const allowed = new Set<string>();
  if (evidencePack.canonicalFacts.price) {
    allowed.add(String(evidencePack.canonicalFacts.price));
    allowed.add(String(Math.round(evidencePack.canonicalFacts.price / 10000) * 10000));
  }
  for (const date of evidencePack.canonicalFacts.priceDates) {
    if (date.price > 0) allowed.add(String(date.price));
  }
  return {
    mode: 'product',
    allowedMoneyClaims: [...allowed],
    blockedClaims: [...UNSUPPORTED_PRODUCT_CLAIMS],
  };
}

export function validateRenderedArticleFacts(markdown: string, evidencePack: EvidencePack): FactIntegrityResult {
  const issues: FactIntegrityResult['issues'] = [];
  if (evidencePack.kind === 'product') {
    const allowed = evidencePack.canonicalFacts.allowedClaimText;
    const policy = buildProductFactPolicy(evidencePack);
    for (const claim of policy.blockedClaims) {
      if (markdown.includes(claim) && !allowed.includes(claim)) {
        issues.push({ code: 'unsupported_product_claim', message: `Unsupported product claim: ${claim}` });
      }
    }

    const allowedMoney = new Set(policy.allowedMoneyClaims);
    const moneyClaims = markdown.match(/\d{1,3}(?:,\d{3})+원|\d+\s*만원/g) ?? [];
    for (const claim of moneyClaims) {
      const normalized = normalizeMoneyClaim(claim);
      if (allowedMoney.size > 0 && !allowedMoney.has(normalized)) {
        issues.push({ code: 'unsupported_money_claim', message: `Money claim is not in product data: ${claim}` });
      }
    }
  }
  return { passed: issues.length === 0, issues, checkedAt: new Date().toISOString() };
}

export function mergeFactIntegrityResults(...results: FactIntegrityResult[]): FactIntegrityResult {
  const issues = results.flatMap((result) => result.issues);
  return { passed: issues.length === 0 && results.every((result) => result.passed), issues, checkedAt: new Date().toISOString() };
}

export function buildDistributionSnippets(article: ArticleContract, canonicalUrl: string): DistributionSnippetSet {
  return {
    canonicalUrl,
    title: article.seo.title || article.title,
    description: article.seo.description,
    teaser: `${article.lede.slice(0, 180)} ${canonicalUrl}`.trim(),
    ogTitle: article.title,
  };
}
