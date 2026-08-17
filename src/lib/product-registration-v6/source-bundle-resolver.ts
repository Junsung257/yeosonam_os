import { createHash } from 'node:crypto';
import { extractHeroContextL1 } from '@/lib/parser/llm/section-extractors';

export type SourceDocumentRole =
  | 'combined'
  | 'price_sheet'
  | 'itinerary_sheet'
  | 'terms_sheet'
  | 'operational_confirmation'
  | 'unknown';

export type SourceBundleDocument = {
  id: string;
  tenantId: string;
  supplierKey: string | null;
  sourceHash: string;
  filename: string;
  text: string;
  cohortKey?: string | null;
  uploadBatchKey?: string | null;
};

export type SourceBundleFingerprint = {
  role: SourceDocumentRole;
  titleTokens: string[];
  destinationKeys: string[];
  hotelKeys: string[];
  durationDays: number[];
  flightCodes: string[];
  years: number[];
};

export type ResolvedSourceBundle = {
  bundleHash: string;
  resolverVersion: typeof SOURCE_BUNDLE_RESOLVER_VERSION;
  tenantId: string;
  supplierKey: string | null;
  groupingAuthority: 'upload_batch';
  groupingKey: string;
  score: number;
  ambiguityMargin: number;
  priceDocumentId: string;
  itineraryDocumentId: string;
  members: Array<{ documentId: string; role: 'price_sheet' | 'itinerary_sheet' | 'terms_sheet' }>;
  memberSourceHashes: string[];
  reasons: string[];
};

export type SourceBundlePairDiagnostic = {
  priceDocumentId: string;
  itineraryDocumentId: string;
  score: number;
  reasons: string[];
  blockers: string[];
};

export const SOURCE_BUNDLE_RESOLVER_VERSION = 'source-bundle-resolver-2026-08-17.5' as const;

const GENERIC_FILENAME_TOKENS = new Set([
  'hwp', 'hwpx', '일정표', '요금표', '상품', '패키지', 'pkg', 'package', '부산출발', '인천출발',
  '출발', '특가', '수정', '최종', '발권', '선발', '컴', '여행사용', '밴드', '일정', '요금',
]);

function uniqueSorted<T extends string | number>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right), 'ko'));
}

function normalizeFilenameTokens(filename: string): string[] {
  return uniqueSorted(filename
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/\.(?:hwp|hwpx|pdf)$/u, ' ')
    .replace(/\b20\d{2}\b|\b\d{4,8}\b/gu, ' ')
    .split(/[^0-9a-z\p{Script=Hangul}]+/u)
    .map(value => value.trim())
    .filter(value => value.length >= 2)
    .filter(value => !GENERIC_FILENAME_TOKENS.has(value))
    .filter(value => !/^\d+(?:박|일|월|년|%)?$/u.test(value)));
}

function normalizeIdentityKey(value: string): string {
  return value.normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/(?:또는\s*동급|동급\s*예정|예정|미정|hotel|resort|호텔|리조트)/giu, ' ')
    .replace(/[^0-9a-z\p{Script=Hangul}]+/gu, '')
    .trim();
}

function destinationKeys(document: SourceBundleDocument): string[] {
  const fromSource = extractHeroContextL1(document.text).destination;
  const fromFilename = extractHeroContextL1(document.filename).destination;
  return uniqueSorted([fromSource, fromFilename]
    .filter((value): value is string => Boolean(value))
    .flatMap(value => value.split('/'))
    .map(normalizeIdentityKey)
    .filter(value => value.length >= 2));
}

function hotelKeys(document: SourceBundleDocument): string[] {
  const searchable = `${document.filename}\n${document.text.slice(0, 20_000)}`.normalize('NFKC');
  const values: string[] = [];
  for (const line of searchable.split(/\r?\n/)) {
    if (!/(?:HOTEL|호텔|리조트|RESORT)/iu.test(line)) continue;
    const marker = line.match(/(?:HOTEL|호텔|숙박)\s*[:：-]\s*([^\n]{2,80})/iu)?.[1]
      ?? line.match(/([^\n]{2,50}?(?:호텔|리조트|HOTEL|RESORT))(?:\s|$|\(|,)/iu)?.[1]
      ?? '';
    const key = normalizeIdentityKey(marker);
    if (key.length >= 3 && !/^(?:현지|상기|예약|호텔|리조트|동급)$/u.test(key)) values.push(key);
  }
  return uniqueSorted(values);
}

function durationDays(text: string): number[] {
  const normalized = text.normalize('NFKC');
  const values = [...normalized.matchAll(/\d{1,2}\s*박\s*(\d{1,2})\s*일/gu)]
    .map(match => Number(match[1]))
    .filter(value => value >= 2 && value <= 31);
  for (const match of normalized.matchAll(/(?:^|\D)(\d{1,2})\s*일(?:\D|$)/gu)) {
    const value = Number(match[1]);
    if (value >= 2 && value <= 31) values.push(value);
  }
  return uniqueSorted(values);
}

function flightCodes(text: string): string[] {
  return uniqueSorted([...text.normalize('NFKC').toUpperCase().matchAll(/\b(?:[A-Z][A-Z0-9]|[0-9][A-Z])[- ]?\d{2,4}\b/gu)]
    .map(match => match[0].replace(/[- ]/g, '')));
}

function years(text: string): number[] {
  const normalized = text.normalize('NFKC');
  return uniqueSorted([
    ...[...normalized.matchAll(/\b(20\d{2})\s*년?/gu)].map(match => Number(match[1])),
    ...[...normalized.matchAll(/(?:^|\D)(2\d)\s*년/gu)].map(match => 2000 + Number(match[1])),
  ].filter(value => value >= 2020 && value <= 2100));
}

export function classifySourceDocumentRole(input: Pick<SourceBundleDocument, 'filename' | 'text'>): SourceDocumentRole {
  const filename = input.filename.normalize('NFKC');
  const text = input.text.normalize('NFKC');
  const operational = /(?:확정서|바우처|예약확인|행사확정)/u.test(filename)
    && /(?:고객명|여권|연락처|미팅|인원\s*[:：]?\s*\d+\s*명)/u.test(text);
  if (operational) return 'operational_confirmation';
  const amountCount = [...text.matchAll(/\d{1,3}(?:[,.]\d{3})+\s*(?:원)?/gu)].length;
  const hasPrice = /요금표/u.test(filename)
    || (amountCount >= 2 && /(?:출\s*발\s*일|상품가|판매가|성인가|요\s*금)/u.test(text));
  const hasItinerary = /일정표/u.test(filename)
    || (/(?:제\s*1\s*일|DAY\s*1)/iu.test(text) && /(?:제\s*2\s*일|DAY\s*2)/iu.test(text));
  const hasTerms = /(?:포\s*함\s*(?:사항|내역)|불\s*포\s*함|취소료|특별약관|여행약관)/u.test(text);
  if (hasPrice && hasItinerary) return 'combined';
  if (hasPrice) return 'price_sheet';
  if (hasItinerary) return 'itinerary_sheet';
  if (hasTerms) return 'terms_sheet';
  return 'unknown';
}

export function buildSourceBundleFingerprint(document: SourceBundleDocument): SourceBundleFingerprint {
  const searchable = `${document.filename}\n${document.text.slice(0, 20_000)}`;
  return {
    role: classifySourceDocumentRole(document),
    titleTokens: normalizeFilenameTokens(document.filename),
    destinationKeys: destinationKeys(document),
    hotelKeys: hotelKeys(document),
    durationDays: durationDays(searchable),
    flightCodes: flightCodes(searchable),
    years: years(searchable),
  };
}

function intersection<T>(left: T[], right: T[]): T[] {
  const values = new Set(right);
  return left.filter(value => values.has(value));
}

function jaccard(left: string[], right: string[]): number {
  const union = new Set([...left, ...right]);
  return union.size === 0 ? 0 : intersection(left, right).length / union.size;
}

function pairDiagnostic(
  price: SourceBundleDocument,
  itinerary: SourceBundleDocument,
  priceFingerprint: SourceBundleFingerprint,
  itineraryFingerprint: SourceBundleFingerprint,
): { score: number; reasons: string[]; blockers: string[] } | null {
  if (price.tenantId !== itinerary.tenantId || price.sourceHash === itinerary.sourceHash) return null;
  if (price.cohortKey && itinerary.cohortKey && price.cohortKey !== itinerary.cohortKey) return null;
  if (priceFingerprint.role !== 'price_sheet' || itineraryFingerprint.role !== 'itinerary_sheet') return null;
  const sameSupplier = Boolean(price.supplierKey && price.supplierKey === itinerary.supplierKey);
  const sameUploadBatch = Boolean(price.uploadBatchKey && price.uploadBatchKey === itinerary.uploadBatchKey);
  // Upload provenance is the only authority for automatically joining two
  // separate source files. Supplier equality is useful evidence, but it is
  // not consent to combine historical or independently uploaded documents.
  if (!sameUploadBatch) return null;
  const blockers: string[] = [];
  if (!sameSupplier) blockers.push('SUPPLIER_IDENTITY_MISSING_OR_CONFLICT');
  const sharedDurations = intersection(priceFingerprint.durationDays, itineraryFingerprint.durationDays);
  if (priceFingerprint.durationDays.length === 0 || itineraryFingerprint.durationDays.length === 0) blockers.push('DURATION_IDENTITY_MISSING');
  else if (sharedDurations.length === 0) blockers.push('DURATION_CONFLICT');
  const sharedFlights = intersection(priceFingerprint.flightCodes, itineraryFingerprint.flightCodes);
  if (priceFingerprint.flightCodes.length > 0 && itineraryFingerprint.flightCodes.length > 0 && sharedFlights.length === 0) {
    blockers.push('FLIGHT_CONFLICT');
  }
  const sharedDestinations = intersection(priceFingerprint.destinationKeys, itineraryFingerprint.destinationKeys);
  if (priceFingerprint.destinationKeys.length > 0 && itineraryFingerprint.destinationKeys.length > 0 && sharedDestinations.length === 0) {
    blockers.push('DESTINATION_CONFLICT');
  }
  const sharedHotels = intersection(priceFingerprint.hotelKeys, itineraryFingerprint.hotelKeys);
  if (priceFingerprint.hotelKeys.length > 0 && itineraryFingerprint.hotelKeys.length > 0 && sharedHotels.length === 0) {
    blockers.push('HOTEL_CONFLICT');
  }
  const tokenOverlap = jaccard(priceFingerprint.titleTokens, itineraryFingerprint.titleTokens);
  if (sharedFlights.length === 0 && sharedDestinations.length === 0 && sharedHotels.length === 0) {
    blockers.push('EXACT_PRODUCT_IDENTITY_MISSING');
  }
  const sharedYears = intersection(priceFingerprint.years, itineraryFingerprint.years);
  if (priceFingerprint.years.length > 0 && itineraryFingerprint.years.length > 0 && sharedYears.length === 0) {
    blockers.push('YEAR_CONFLICT');
  }

  const reasons = [
    'COMPLEMENTARY_DOCUMENT_ROLES',
    'SAME_TENANT_AND_UPLOAD_BATCH',
  ];
  if (sameSupplier) reasons.push('MATCHING_SUPPLIER');
  let score = sameSupplier ? 55 : 35;
  if (sharedDurations.length > 0) {
    score += 15;
    reasons.push('MATCHING_DURATION');
  }
  if (sharedDestinations.length > 0) {
    score += 15;
    reasons.push('MATCHING_DESTINATION');
  }
  if (sharedHotels.length > 0) {
    score += 15;
    reasons.push('MATCHING_HOTEL');
  }
  if (sharedFlights.length > 0) {
    score += 15;
    reasons.push('MATCHING_FLIGHT');
  }
  if (sharedYears.length > 0) {
    score += 5;
    reasons.push('MATCHING_YEAR');
  }
  if (tokenOverlap >= 0.5) {
    score += 5;
    reasons.push('SUPPORTING_TITLE_TOKEN_MATCH');
  }
  return { score: Math.min(100, score), reasons, blockers };
}

function supportingDocumentIsCompatible(input: {
  support: SourceBundleDocument;
  supportFingerprint: SourceBundleFingerprint;
  price: SourceBundleDocument;
  priceFingerprint: SourceBundleFingerprint;
  itinerary: SourceBundleDocument;
  itineraryFingerprint: SourceBundleFingerprint;
}): boolean {
  if (input.supportFingerprint.role !== 'terms_sheet') return false;
  if (input.support.tenantId !== input.price.tenantId
    || input.support.uploadBatchKey !== input.price.uploadBatchKey
    || !input.support.uploadBatchKey
    || !input.support.supplierKey
    || input.support.supplierKey !== input.price.supplierKey
    || input.support.supplierKey !== input.itinerary.supplierKey) return false;
  const conflicts = <T,>(supportValues: T[], priceValues: T[], itineraryValues: T[]) => (
    supportValues.length > 0
    && [...priceValues, ...itineraryValues].length > 0
    && intersection(supportValues, [...priceValues, ...itineraryValues]).length === 0
  );
  return !conflicts(input.supportFingerprint.years, input.priceFingerprint.years, input.itineraryFingerprint.years)
    && !conflicts(input.supportFingerprint.durationDays, input.priceFingerprint.durationDays, input.itineraryFingerprint.durationDays)
    && !conflicts(input.supportFingerprint.flightCodes, input.priceFingerprint.flightCodes, input.itineraryFingerprint.flightCodes)
    && !conflicts(input.supportFingerprint.destinationKeys, input.priceFingerprint.destinationKeys, input.itineraryFingerprint.destinationKeys)
    && !conflicts(input.supportFingerprint.hotelKeys, input.priceFingerprint.hotelKeys, input.itineraryFingerprint.hotelKeys);
}

export function diagnoseSourceDocumentBundlePairs(documents: SourceBundleDocument[]): SourceBundlePairDiagnostic[] {
  const fingerprints = new Map(documents.map(document => [document.id, buildSourceBundleFingerprint(document)]));
  const prices = documents.filter(document => fingerprints.get(document.id)?.role === 'price_sheet');
  const itineraries = documents.filter(document => fingerprints.get(document.id)?.role === 'itinerary_sheet');
  return prices.flatMap(price => itineraries.flatMap(itinerary => {
    const diagnostic = pairDiagnostic(price, itinerary, fingerprints.get(price.id)!, fingerprints.get(itinerary.id)!);
    return diagnostic ? [{
      priceDocumentId: price.id,
      itineraryDocumentId: itinerary.id,
      ...diagnostic,
    }] : [];
  })).sort((left, right) => (
    left.blockers.length - right.blockers.length
    || right.score - left.score
    || left.priceDocumentId.localeCompare(right.priceDocumentId)
    || left.itineraryDocumentId.localeCompare(right.itineraryDocumentId)
  ));
}

/**
 * Produces only unambiguous, mutual-best source bundles. It never joins
 * documents across tenants, suppliers, or benchmark cohorts, and it never
 * copies facts from already registered products.
 */
export function resolveSourceDocumentBundles(documents: SourceBundleDocument[]): ResolvedSourceBundle[] {
  const byId = new Map(documents.map(document => [document.id, document]));
  const fingerprints = new Map(documents.map(document => [document.id, buildSourceBundleFingerprint(document)]));
  const candidates = diagnoseSourceDocumentBundlePairs(documents)
    .filter(candidate => candidate.blockers.length === 0 && candidate.score >= 75)
    .map(candidate => ({
      ...candidate,
      price: byId.get(candidate.priceDocumentId)!,
      itinerary: byId.get(candidate.itineraryDocumentId)!,
    }));

  const rankedForPrice = (id: string) => candidates
    .filter(candidate => candidate.price.id === id)
    .sort((left, right) => right.score - left.score || left.itinerary.id.localeCompare(right.itinerary.id));
  const rankedForItinerary = (id: string) => candidates
    .filter(candidate => candidate.itinerary.id === id)
    .sort((left, right) => right.score - left.score || left.price.id.localeCompare(right.price.id));

  return candidates.flatMap(candidate => {
    const priceRanking = rankedForPrice(candidate.price.id);
    const itineraryRanking = rankedForItinerary(candidate.itinerary.id);
    if (priceRanking[0] !== candidate || itineraryRanking[0] !== candidate) return [];
    const priceMargin = candidate.score - (priceRanking[1]?.score ?? 0);
    const itineraryMargin = candidate.score - (itineraryRanking[1]?.score ?? 0);
    const ambiguityMargin = Math.min(priceMargin, itineraryMargin);
    if (ambiguityMargin < 10) return [];
    const supportingTerms = documents.filter(document => supportingDocumentIsCompatible({
      support: document,
      supportFingerprint: fingerprints.get(document.id)!,
      price: candidate.price,
      priceFingerprint: fingerprints.get(candidate.price.id)!,
      itinerary: candidate.itinerary,
      itineraryFingerprint: fingerprints.get(candidate.itinerary.id)!,
    })).sort((left, right) => left.sourceHash.localeCompare(right.sourceHash));
    const members: ResolvedSourceBundle['members'] = [
      { documentId: candidate.price.id, role: 'price_sheet' },
      { documentId: candidate.itinerary.id, role: 'itinerary_sheet' },
      ...supportingTerms.map(document => ({ documentId: document.id, role: 'terms_sheet' as const })),
    ];
    const memberSourceHashes = members.map(member => byId.get(member.documentId)!.sourceHash).sort();
    const groupingAuthority = 'upload_batch' as const;
    const groupingKey = candidate.price.uploadBatchKey!;
    const bundleHash = createHash('sha256').update(JSON.stringify({
      resolverVersion: SOURCE_BUNDLE_RESOLVER_VERSION,
      tenantId: candidate.price.tenantId,
      groupingAuthority,
      groupingKey,
      memberSourceHashes,
    })).digest('hex');
    return [{
      bundleHash,
      resolverVersion: SOURCE_BUNDLE_RESOLVER_VERSION,
      tenantId: candidate.price.tenantId,
      supplierKey: candidate.price.supplierKey,
      groupingAuthority,
      groupingKey,
      score: candidate.score,
      ambiguityMargin,
      priceDocumentId: candidate.price.id,
      itineraryDocumentId: candidate.itinerary.id,
      members,
      memberSourceHashes,
      reasons: supportingTerms.length > 0
        ? [...candidate.reasons, `ATTACHED_TERMS_SHEETS:${supportingTerms.length}`]
        : candidate.reasons,
    }];
  }).sort((left, right) => left.bundleHash.localeCompare(right.bundleHash));
}
