import { createHash } from 'node:crypto';
import { GoogleGenAI, Type, type GroundingChunk } from '@google/genai';
import * as cheerio from 'cheerio';
import { getProviderApiKey } from '@/lib/ai-provider-policy';
import type { BlogContentBrief } from '@/lib/blog-content-brief';
import {
  BLOG_INFORMATION_CLAIM_TYPES,
  BLOG_INFORMATION_SOURCE_TYPES,
  createBlogInformationClaimFingerprint,
  createBlogInformationSourceContentHash,
  normalizeBlogInformationSourceSnapshot,
  type BlogInformationAuthorityLevel,
  type BlogInformationClaimType,
  type BlogInformationEvidenceInput,
  type BlogInformationEvidenceRiskLevel,
  type BlogInformationResearchBundle,
  type BlogInformationSourceInput,
  type BlogInformationSourceType,
  validateBlogInformationResearchBundle,
} from '@/lib/blog-information-evidence';
import type { BlogInformationOfficialSourceRegistryEntry } from '@/lib/blog-information-official-source';
import {
  resolveBlogInformationOfficialSourceTrust,
  sourceHostnameMatchesRegistry,
} from '@/lib/blog-information-official-source';
import {
  BLOG_INFORMATION_MINIMUM_CLAIMS_BY_INTENT,
  BLOG_INFORMATION_RESEARCH_META_KEY,
  evaluateBlogGenerationResearchReadiness,
} from '@/lib/blog-generation-research';
import { matchesBlogResearchDestinationScope } from '@/lib/blog-research-destination-scope';
import { supabaseAdmin } from '@/lib/supabase';

const AUTO_RESEARCH_MODEL = process.env.BLOG_RESEARCH_MODEL?.trim() || 'gemini-2.5-flash';
const AUTO_RESEARCH_TIMEOUT_MS = Math.max(
  20_000,
  Math.min(120_000, Number(process.env.BLOG_RESEARCH_TIMEOUT_MS) || 90_000),
);
const MAX_GROUNDING_SOURCES = 12;
const MAX_SOURCE_CATALOG = 40;
const MAX_RESEARCH_EVIDENCE = 24;
const MAX_RESEARCH_CLAIMS = 12;
const MAX_REVIEWED_DIRECT_PAGES = 12;
const MAX_REVIEWED_PAGE_BYTES = 1_500_000;
const MAX_REVIEWED_PAGE_TEXT = 12_000;
const GRTA_FIXED_ROUTE_SCHEDULE_PATH = '/sites/default/files/master_-_fixed_route_schedule_updated112625.pdf';
const GRTA_FARE_RATE_PATH = '/sites/default/files/grta_bus_pass_sales_information_sheet.pdf';
const CHIN_FE_GUAM_MENU_HOST = 'chinfe.menuguam.com';
const BOOKING_GUAM_FAMILY_PATH = '/family/country/gu.ko.html';
const AGODA_GUAM_HOTEL_GUIDE_PATH = '/ko-kr/travel-guides/guam/where-to-stay-in-guam-best-hotels/';
const USA_GOV_CURRENCY_PATH = '/currency';
const VISIT_GUAM_PAYMENT_PATH = '/smscormoranguam/sms-diving-in-guam/';
const VISIT_GUAM_SOUVENIR_PATH = '/blog/post/3376/';
const AUTOMATIC_WEB_SOURCE_TYPES = new Set<BlogInformationSourceType>([
  'reputable_local_source',
  'reputable_price_source',
  'reputable_source',
]);

type GroundedEvidenceDraft = {
  evidenceKey?: string;
  sourceKey?: string;
  sourceIndex?: number;
  excerpt?: string;
  sourceLocator?: string;
  claimType?: string;
  riskLevel?: string;
  country?: string;
  destination?: string;
  applicableTo?: string;
  normalizedValue?: string;
  unit?: string | null;
  currency?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  conditions?: string[];
};

type GroundedClaimDraft = {
  claimText?: string;
  claimType?: string;
  riskLevel?: string;
  evidenceIndexes?: number[];
  evidenceKeys?: string[];
  normalizedValue?: string;
  unit?: string | null;
  currency?: string | null;
};

type GroundedSourceDraft = {
  sourceKey?: string;
  groundingChunkIndex?: number;
  publisher?: string;
  sourceType?: string;
  claimTypes?: string[];
  country?: string;
  destination?: string;
};

export type GroundedBlogResearchPayload = {
  sources?: GroundedSourceDraft[];
  evidence?: GroundedEvidenceDraft[];
  claims?: GroundedClaimDraft[];
};

export interface BlogAutoResearchResult {
  passed: boolean;
  bundle: BlogInformationResearchBundle | null;
  issues: string[];
  model: string;
  searchQueries: string[];
  groundingSourceCount: number;
  directSourceCount: number;
  directSourceFailures: string[];
  observedSourceTypes: string[];
  observedGroundingChunkIndexes: number[];
  observedSources: Array<{
    sourceType: string;
    groundingChunkIndex: number | null;
    url: string | null;
  }>;
  finishReason: string | null;
  responseTextLength: number;
}

export type BlogInformationReputableSourceRegistryEntry = {
  id: string;
  hostname: string;
  sourceTypes: BlogInformationSourceType[];
  intents: string[];
  allowSubdomains: boolean;
  reviewNote?: string | null;
  researchUrls?: string[];
  researchDestinations?: string[];
};

let cachedGeminiKey: string | null = null;
let cachedGeminiClient: GoogleGenAI | null = null;

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeList(values: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.map(clean).filter(Boolean))]
    : [];
}

function comparableValue(value: unknown): string {
  return clean(value).toLowerCase().replace(/[,\s]+/g, '');
}

function explicitCurrency(value: unknown, statement: string): string | null {
  const supplied = clean(value);
  if (supplied) return supplied;
  if (/(?:₱|\bPHP\b|\bPhilippine\s+pesos?\b|\b필리핀\s*페소\b)/i.test(statement)) return 'PHP';
  if (/(?:₫|\bVND\b|\bVietnamese\s+dong\b|\b베트남\s*동\b)/i.test(statement)) return 'VND';
  if (/(?:¥|\bJPY\b|\bJapanese\s+yen\b|\b일본\s*엔\b)/i.test(statement)) return 'JPY';
  if (/(?:฿|\bTHB\b|\bThai\s+baht\b|\b태국\s*바트\b)/i.test(statement)) return 'THB';
  if (/(?:\$|\bUSD\b|\bUS\s+dollars?\b|\bUnited\s+States\s+dollars?\b|\b미(?:국)?\s*달러\b)/i.test(statement)) {
    return 'USD';
  }
  return null;
}

function normalizeFoodBudgetClaimLabels(value: string): string {
  const labels: string[] = [];
  if (/(?:저예산|알뜰|가성비|\bbudget\b|\blow[-\s]?cost\b)/i.test(value) && !/절약/.test(value)) {
    labels.push('절약');
  }
  if (/(?:중간급|중간\s*예산|\bmid[-\s]?range\b|\bmoderate\b)/i.test(value) && !/(?:일반|중간)/.test(value)) {
    labels.push('일반');
  }
  if (/(?:고급|프리미엄|\bluxury\b|\bpremium\b)/i.test(value) && !/여유/.test(value)) {
    labels.push('여유');
  }
  if (/\bbreakfast\b/i.test(value) && !/아침/.test(value)) labels.push('아침');
  if (/\blunch\b/i.test(value) && !/점심/.test(value)) labels.push('점심');
  if (/\bdinner\b/i.test(value) && !/저녁/.test(value)) labels.push('저녁');
  if (/(?:\bsnacks?\b|\bcoffee\b|\bcafe\b)/i.test(value) && !/(?:간식|커피|카페)/.test(value)) {
    labels.push('간식');
  }
  return labels.length > 0 ? `[${labels.join('·')}] ${value}` : value;
}

function isSafeHttpsUrl(value: unknown): value is string {
  try {
    const parsed = new URL(clean(value));
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && hostname !== 'localhost'
      && !hostname.endsWith('.localhost')
      && !hostname.endsWith('.local')
      && hostname !== 'metadata.google.internal'
      && !/^(?:127|10|0)\./.test(hostname)
      && !/^169\.254\./.test(hostname)
      && !/^192\.168\./.test(hostname)
      && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
      && !hostname.includes(':');
  } catch {
    return false;
  }
}

function urlMatchesRegistryEntry(
  value: string,
  entry: Pick<BlogInformationOfficialSourceRegistryEntry, 'hostname' | 'allowSubdomains'>,
): boolean {
  if (!isSafeHttpsUrl(value)) return false;
  return sourceHostnameMatchesRegistry({
    sourceHostname: new URL(value).hostname,
    registryHostname: entry.hostname,
    allowSubdomains: entry.allowSubdomains,
  });
}

export type ReviewedDirectPage = {
  url: string;
  title: string;
  text: string;
};

const JMA_CLIMATE_ROW_MARKER = 'JMA_CLIMATE_ROW:';
const JMA_CLIMATE_ROW_END_MARKER = ':JMA_CLIMATE_ROW_END';
const SINGAPORE_CLIMATE_ROW_MARKER = 'SINGAPORE_CLIMATE_ROW:';
const SINGAPORE_CLIMATE_ROW_END_MARKER = ':SINGAPORE_CLIMATE_ROW_END';

type WmoClimateMonth = {
  month?: number;
  maxTemp?: string | number | null;
  minTemp?: string | number | null;
  raindays?: string | number | null;
  rainfall?: string | number | null;
};

type WmoClimateDocument = {
  city?: {
    cityName?: string;
    member?: {
      memName?: string;
      orgName?: string;
    };
    climate?: {
      datab?: string | number | null;
      datae?: string | number | null;
      climateMonth?: WmoClimateMonth[];
    };
  };
};

const reviewedDirectPageInFlight = new Map<string, Promise<ReviewedDirectPage>>();

export function extractReviewedPageTextForResearch(value: string): string {
  const normalized = clean(value);
  if (normalized.length <= MAX_REVIEWED_PAGE_TEXT) return normalized;
  const excerpts = [normalized.slice(0, 3_000)];
  const seenStarts = new Set([0]);
  const patterns = [
    /guam-cnmi/gi,
    /republic of korea/gi,
    /forty-five/gi,
    /electronic travel authorization/gi,
    /괌/gi,
    /\bGIAA\b/gi,
    /\bairport\b/gi,
    /\bTumon\b/gi,
    /\bfare\b/gi,
    /\bbreakfast\b|\blunch\b|\bdinner\b/gi,
    /\bsnacks?\b|\bcoffee\b|\bcafe\b|\bdesserts?\b/gi,
    /\binsurance\b|\bclaim\b|\bexclusion\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const start = Math.max(0, (match.index ?? 0) - 1_500);
      if ([...seenStarts].some((seen) => Math.abs(seen - start) < 1_000)) continue;
      seenStarts.add(start);
      excerpts.push(normalized.slice(start, start + 4_000));
      if (excerpts.join('\n...\n').length >= MAX_REVIEWED_PAGE_TEXT) break;
    }
    if (excerpts.join('\n...\n').length >= MAX_REVIEWED_PAGE_TEXT) break;
  }
  return excerpts.join('\n...\n').slice(0, MAX_REVIEWED_PAGE_TEXT);
}

export function extractReviewedHtmlTextForResearch(input: {
  body: string;
  url: string;
}): string {
  const $ = cheerio.load(input.body);
  $('script,style,noscript,svg,iframe,form,nav,footer').remove();
  const bodyText = $('main,article').first().text() || $('body').text();
  let hostname = '';
  try {
    hostname = new URL(input.url).hostname.toLowerCase();
  } catch {
    // The caller already validates direct research URLs. Keep extraction fail-safe.
  }
  const isJmaHost = hostname === 'data.jma.go.jp' || hostname.endsWith('.data.jma.go.jp');
  const isSingaporeWeatherHost =
    hostname === 'weather.gov.sg' || hostname.endsWith('.weather.gov.sg');
  if (!isJmaHost && !isSingaporeWeatherHost) {
    return extractReviewedPageTextForResearch(bodyText);
  }

  const heading = clean($('h3').first().text());
  const referencePeriod = isSingaporeWeatherHost
    ? bodyText.match(/Climatological Reference Period:\s*1991\s*-\s*2020/i)?.[0] ?? ''
    : '';
  const rowMarkers = $('table tr').toArray().flatMap((row) => {
    const cells = $(row).find('th,td').toArray().map((cell) => clean($(cell).text()));
    return cells.some(Boolean)
      ? [isJmaHost
        ? `${JMA_CLIMATE_ROW_MARKER}${JSON.stringify(cells)}${JMA_CLIMATE_ROW_END_MARKER}`
        : `${SINGAPORE_CLIMATE_ROW_MARKER}${JSON.stringify(cells)}${SINGAPORE_CLIMATE_ROW_END_MARKER}`]
      : [];
  });
  return extractReviewedPageTextForResearch([
    heading,
    referencePeriod,
    ...rowMarkers,
    bodyText,
  ].filter(Boolean).join(' '));
}

async function fetchReviewedDirectPage(input: {
  entry: Pick<
    BlogInformationOfficialSourceRegistryEntry,
    'hostname' | 'allowSubdomains' | 'researchUrls'
  >;
  url: string;
}): Promise<ReviewedDirectPage> {
  let currentUrl = input.url;
  if (!input.entry.researchUrls?.includes(currentUrl) || !urlMatchesRegistryEntry(currentUrl, input.entry)) {
    throw new Error(`unapproved_url:${input.entry.hostname}`);
  }

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: 'text/html,text/plain;q=0.9',
        'user-agent': 'yeosonam-reviewed-source-research/1.0',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`redirect_without_location:${input.entry.hostname}`);
      const nextUrl = new URL(location, currentUrl).toString();
      if (!urlMatchesRegistryEntry(nextUrl, input.entry)) {
        throw new Error(`redirect_outside_registry:${input.entry.hostname}`);
      }
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) throw new Error(`http_${response.status}:${input.entry.hostname}`);

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const isPdf = contentType.includes('application/pdf');
    const isStructuredText = contentType.includes('application/json')
      || contentType.includes('application/xml')
      || contentType.includes('text/xml');
    if (!contentType.includes('text/html')
      && !contentType.includes('text/plain')
      && !isStructuredText
      && !isPdf) {
      throw new Error(`unsupported_content_type:${input.entry.hostname}`);
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REVIEWED_PAGE_BYTES) {
      throw new Error(`content_too_large:${input.entry.hostname}`);
    }
    if (isPdf) {
      const pdfBuffer = Buffer.from(await response.arrayBuffer());
      if (pdfBuffer.byteLength > MAX_REVIEWED_PAGE_BYTES) {
        throw new Error(`content_too_large:${input.entry.hostname}`);
      }
      const pdfParse = (await import('pdf-parse')).default;
      const parsed = await pdfParse(pdfBuffer);
      const text = extractReviewedPageTextForResearch(parsed.text);
      if (text.length < 80) throw new Error(`content_too_short:${input.entry.hostname}`);
      return { url: currentUrl, title: input.entry.hostname, text };
    }

    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_REVIEWED_PAGE_BYTES) {
      throw new Error(`content_too_large:${input.entry.hostname}`);
    }
    if (contentType.includes('text/plain') || isStructuredText) {
      const text = extractReviewedPageTextForResearch(body);
      if (text.length < 80) throw new Error(`content_too_short:${input.entry.hostname}`);
      return { url: currentUrl, title: input.entry.hostname, text };
    }

    const $ = cheerio.load(body);
    const title = clean($('title').first().text()) || input.entry.hostname;
    const text = extractReviewedHtmlTextForResearch({ body, url: currentUrl });
    if (text.length < 80) throw new Error(`content_too_short:${input.entry.hostname}`);
    return { url: currentUrl, title, text };
  }
  throw new Error(`too_many_redirects:${input.entry.hostname}`);
}

function isRetryableReviewedDirectFetchError(error: unknown): boolean {
  const message = clean(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes('timeout')
    || message.includes('timed out')
    || message.includes('fetch failed')
    || message.includes('network')
    || /http_(?:408|425|429|5\d\d):/.test(message);
}

async function fetchReviewedDirectPageWithRetry(input: {
  entry: Pick<
    BlogInformationOfficialSourceRegistryEntry,
    'hostname' | 'allowSubdomains' | 'researchUrls'
  >;
  url: string;
}): Promise<ReviewedDirectPage> {
  try {
    return await fetchReviewedDirectPage(input);
  } catch (error) {
    if (!isRetryableReviewedDirectFetchError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return fetchReviewedDirectPage(input);
  }
}

function fetchReviewedDirectPageShared(input: {
  entry: Pick<
    BlogInformationOfficialSourceRegistryEntry,
    'hostname' | 'allowSubdomains' | 'researchUrls'
  >;
  url: string;
}): Promise<ReviewedDirectPage> {
  const cacheKey = `${input.entry.hostname.toLowerCase()}|${input.url}`;
  const existing = reviewedDirectPageInFlight.get(cacheKey);
  if (existing) return existing;

  const request = (async () => {
    try {
      return await fetchReviewedDirectPageWithRetry(input);
    } finally {
      reviewedDirectPageInFlight.delete(cacheKey);
    }
  })();
  reviewedDirectPageInFlight.set(cacheKey, request);
  return request;
}

export async function fetchReviewedDirectPages(
  registry: Array<Pick<
    BlogInformationOfficialSourceRegistryEntry,
    'hostname' | 'allowSubdomains' | 'researchUrls'
  >>,
): Promise<{ pages: ReviewedDirectPage[]; failures: string[] }> {
  const candidates = registry
    .flatMap((entry) => (entry.researchUrls ?? []).map((url) => ({ entry, url })))
    .slice(0, MAX_REVIEWED_DIRECT_PAGES);
  const settled = await Promise.allSettled(candidates.map(fetchReviewedDirectPageShared));
  const pages: ReviewedDirectPage[] = [];
  const failures: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      pages.push(result.value);
    } else {
      failures.push(`${candidates[index].url}:${clean(result.reason instanceof Error ? result.reason.message : result.reason)}`);
    }
  });
  return { pages, failures };
}

async function fetchTrustedSearchPages(input: {
  chunks: Array<{ uri: string; title: string }>;
  officialRegistry: BlogInformationOfficialSourceRegistryEntry[];
  reputableRegistry: BlogInformationReputableSourceRegistryEntry[];
  allowedSourceTypes: BlogInformationSourceType[];
  intent: string;
}): Promise<{ pages: ReviewedDirectPage[]; failures: string[] }> {
  const seen = new Set<string>();
  const candidates = input.chunks.flatMap((chunk) => {
    if (seen.has(chunk.uri)) return [];
    const officialEntry = input.officialRegistry.find((entry) =>
      input.allowedSourceTypes.includes(entry.sourceType)
      && sourceHostnameMatchesRegistry({
        sourceHostname: new URL(chunk.uri).hostname,
        registryHostname: entry.hostname,
        allowSubdomains: entry.allowSubdomains,
      }));
    const reputableEntry = input.reputableRegistry.find((entry) =>
      entry.intents.includes(input.intent)
      && entry.sourceTypes.some((sourceType) =>
        input.allowedSourceTypes.includes(sourceType))
      && sourceHostnameMatchesRegistry({
        sourceHostname: new URL(chunk.uri).hostname,
        registryHostname: entry.hostname,
        allowSubdomains: entry.allowSubdomains,
      }));
    const entry = officialEntry ?? (reputableEntry
      ? {
          hostname: reputableEntry.hostname,
          allowSubdomains: reputableEntry.allowSubdomains,
        }
      : null);
    if (!entry) return [];
    seen.add(chunk.uri);
    return [{
      entry: {
        hostname: entry.hostname,
        allowSubdomains: entry.allowSubdomains,
        researchUrls: [chunk.uri],
      },
      url: chunk.uri,
    }];
  }).slice(0, MAX_REVIEWED_DIRECT_PAGES);
  const settled = await Promise.allSettled(candidates.map(fetchReviewedDirectPage));
  const pages: ReviewedDirectPage[] = [];
  const failures: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      pages.push(result.value);
    } else {
      failures.push(`${candidates[index].url}:${clean(result.reason instanceof Error ? result.reason.message : result.reason)}`);
    }
  });
  return { pages, failures };
}

function toClaimType(value: unknown): BlogInformationClaimType | null {
  const normalized = clean(value) as BlogInformationClaimType;
  return BLOG_INFORMATION_CLAIM_TYPES.includes(normalized) ? normalized : null;
}

function toSourceType(
  value: unknown,
  allowedSourceTypes: string[],
): BlogInformationSourceType | null {
  const normalized = clean(value);
  const persistedType = normalized as BlogInformationSourceType;
  if (BLOG_INFORMATION_SOURCE_TYPES.includes(persistedType) && allowedSourceTypes.includes(normalized)) {
    return persistedType;
  }
  if (BLOG_INFORMATION_SOURCE_TYPES.includes(persistedType)
    && allowedSourceTypes.includes('official')
    && !AUTOMATIC_WEB_SOURCE_TYPES.has(persistedType)
    && persistedType !== 'field_research'
    && persistedType !== 'legal_review'
    && persistedType !== 'internal_reference') {
    return persistedType;
  }

  // The editorial contract intentionally uses a few policy-level labels that
  // are broader than the persisted evidence enum. Collapse those labels to a
  // DB-safe source type without granting official authority.
  if (normalized === 'official' && allowedSourceTypes.includes('official')) {
    return 'official_tourism';
  }
  if (normalized === 'official_climate_data' && allowedSourceTypes.includes('official_climate_data')) {
    return 'meteorological_agency';
  }
  if (normalized === 'reputable_booking_data' && allowedSourceTypes.includes('reputable_booking_data')) {
    return 'reputable_price_source';
  }
  if (allowedSourceTypes.includes('reputable_price_source')) return 'reputable_price_source';
  if (allowedSourceTypes.includes('reputable_local_source')) return 'reputable_local_source';
  if (allowedSourceTypes.includes('reputable_source')) return 'reputable_source';
  return null;
}

function toRiskLevel(value: unknown, claimType?: BlogInformationClaimType): BlogInformationEvidenceRiskLevel {
  const normalized = clean(value).toUpperCase();
  if (normalized === 'HIGH' || normalized === 'MEDIUM' || normalized === 'LOW') {
    return normalized;
  }
  if (claimType === 'entry_visa' || claimType === 'insurance' || claimType === 'policy') return 'HIGH';
  if (claimType === 'price' || claimType === 'currency' || claimType === 'duration') return 'MEDIUM';
  return 'LOW';
}

function sourceKey(url: string, index: number): string {
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return `grounded-${index + 1}-${digest}`;
}

function evidenceKey(source: string, index: number): string {
  return `${source}-e${index + 1}`;
}

function addSnapshotExcerpt(
  snapshots: Map<string, string[]>,
  source: string,
  excerpt: string,
): { start: number; end: number } {
  const parts = snapshots.get(source) ?? [];
  const start = Array.from(parts.join('\n\n')).length + (parts.length > 0 ? 2 : 0);
  parts.push(excerpt);
  snapshots.set(source, parts);
  return { start, end: start + Array.from(excerpt).length };
}

function safeIsoDate(value: unknown): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildScopedEvidenceRecord(input: {
  statement: string;
  country: string;
  destination: string;
  applicableTo: string;
  normalizedValue: string;
  unit: string | null;
  currency: string | null;
  verifiedAt: string;
}): string {
  const value = [
    input.normalizedValue,
    input.unit,
    input.currency,
  ].filter(Boolean).join(' ');
  return [
    input.statement,
    `[검증 범위: ${input.country} ${input.destination}; 대상: ${input.applicableTo}; 기준일: ${input.verifiedAt.slice(0, 10)}; 값: ${value}]`,
  ].join(' ');
}

function authorityForSource(
  url: string,
  sourceType: BlogInformationSourceType,
  registry: BlogInformationOfficialSourceRegistryEntry[],
): BlogInformationAuthorityLevel {
  const trust = resolveBlogInformationOfficialSourceTrust({
    sourceUrl: url,
    sourceType,
    registry,
  });
  return trust?.authorityLevel ?? 'editorial_secondary';
}

function resolveReputableSourceTrust(input: {
  sourceUrl: string;
  sourceType: BlogInformationSourceType;
  intent: string;
  registry: BlogInformationReputableSourceRegistryEntry[];
}): BlogInformationReputableSourceRegistryEntry | null {
  if (!AUTOMATIC_WEB_SOURCE_TYPES.has(input.sourceType) || !isSafeHttpsUrl(input.sourceUrl)) {
    return null;
  }
  const hostname = new URL(input.sourceUrl).hostname;
  return input.registry.find((entry) =>
    entry.sourceTypes.includes(input.sourceType)
    && entry.intents.includes(input.intent)
    && sourceHostnameMatchesRegistry({
      sourceHostname: hostname,
      registryHostname: entry.hostname,
      allowSubdomains: entry.allowSubdomains,
    })) ?? null;
}

function groundedWebChunks(chunks: GroundingChunk[]): Array<{ chunkIndex: number; uri: string; title: string }> {
  const seen = new Set<string>();
  return chunks.flatMap((chunk, chunkIndex) => {
    const uri = chunk.web?.uri;
    if (!isSafeHttpsUrl(uri) || seen.has(uri)) return [];
    seen.add(uri);
    return [{ chunkIndex, uri, title: clean(chunk.web?.title) || new URL(uri).hostname }];
  });
}

async function resolveGroundingRedirects(chunks: GroundingChunk[]): Promise<GroundingChunk[]> {
  return Promise.all(chunks.map(async (chunk) => {
    const uri = chunk.web?.uri;
    if (!isSafeHttpsUrl(uri)) return chunk;
    const parsed = new URL(uri);
    if (parsed.hostname !== 'vertexaisearch.cloud.google.com') return chunk;
    try {
      const response = await fetch(uri, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
        headers: { 'user-agent': 'yeosonam-grounded-research/1.0' },
      });
      const location = response.headers.get('location');
      if (!isSafeHttpsUrl(location)) return chunk;
      return {
        ...chunk,
        web: {
          ...chunk.web,
          uri: location,
        },
      };
    } catch {
      return chunk;
    }
  }));
}

export function buildBlogResearchBundleFromGrounding(input: {
  contentKey: string;
  destination: string;
  locale: string;
  brief: Pick<BlogContentBrief, 'sourcePolicy'> & Partial<Pick<BlogContentBrief, 'intentType'>>;
  payload: GroundedBlogResearchPayload;
  groundingChunks: GroundingChunk[];
  directSourceUrls?: string[];
  officialRegistry?: BlogInformationOfficialSourceRegistryEntry[];
  reputableRegistry?: BlogInformationReputableSourceRegistryEntry[];
  now?: Date;
}): { bundle: BlogInformationResearchBundle | null; issues: string[] } {
  const issues: string[] = [];
  const now = input.now ?? new Date();
  const retrievedAt = now.toISOString();
  const webChunks = groundedWebChunks(input.groundingChunks);
  const registry = input.officialRegistry ?? [];
  const reputableRegistry = input.reputableRegistry ?? [];
  const directSourceUrls = new Set(input.directSourceUrls ?? []);
  const sourceDrafts = Array.isArray(input.payload.sources) ? input.payload.sources : [];
  const chunkByOriginalIndex = new Map(webChunks.map((chunk) => [chunk.chunkIndex, chunk]));
  const sourceRecords = sourceDrafts.flatMap((draft, sourceDraftIndex) => {
    const chunkIndex = Number(draft.groundingChunkIndex);
    const chunk = Number.isInteger(chunkIndex)
      ? chunkByOriginalIndex.get(chunkIndex) ?? webChunks[chunkIndex]
      : null;
    let sourceType = toSourceType(draft.sourceType, input.brief.sourcePolicy.sourceTypes);
    if (!chunk || !sourceType) {
      issues.push(`source_rejected:${sourceDraftIndex}`);
      if (!chunk) issues.push(`source_rejected:${sourceDraftIndex}:grounding_chunk:${clean(draft.groundingChunkIndex) || 'missing'}`);
      if (!sourceType) issues.push(`source_rejected:${sourceDraftIndex}:source_type:${clean(draft.sourceType) || 'missing'}`);
      return [];
    }
    const officialTrust = resolveBlogInformationOfficialSourceTrust({
      sourceUrl: chunk.uri,
      sourceType,
      registry,
    });
    let reputableTrust = resolveReputableSourceTrust({
      sourceUrl: chunk.uri,
      sourceType,
      intent: input.brief.intentType ?? 'general',
      registry: reputableRegistry,
    });
    if (AUTOMATIC_WEB_SOURCE_TYPES.has(sourceType) && !reputableTrust) {
      for (const candidateType of allowedPersistedSourceTypes(input.brief.sourcePolicy.sourceTypes)) {
        if (!AUTOMATIC_WEB_SOURCE_TYPES.has(candidateType)) continue;
        const candidateTrust = resolveReputableSourceTrust({
          sourceUrl: chunk.uri,
          sourceType: candidateType,
          intent: input.brief.intentType ?? 'general',
          registry: reputableRegistry,
        });
        if (!candidateTrust) continue;
        sourceType = candidateType;
        reputableTrust = candidateTrust;
        break;
      }
    }
    if (sourceType === 'field_research' || sourceType === 'legal_review' || sourceType === 'internal_reference') {
      issues.push(`source_rejected:${sourceDraftIndex}`);
      issues.push(`source_rejected:${sourceDraftIndex}:non_web_source_type:${sourceType}`);
      return [];
    }
    if (!AUTOMATIC_WEB_SOURCE_TYPES.has(sourceType) && !officialTrust) {
      issues.push(`source_rejected:${sourceDraftIndex}`);
      issues.push(`source_rejected:${sourceDraftIndex}:official_registry_required:${sourceType}`);
      return [];
    }
    if (AUTOMATIC_WEB_SOURCE_TYPES.has(sourceType) && !reputableTrust) {
      issues.push(`source_rejected:${sourceDraftIndex}`);
      issues.push(`source_rejected:${sourceDraftIndex}:reputable_registry_required:${sourceType}`);
      return [];
    }
    const key = sourceKey(chunk.uri, sourceDraftIndex);
    return [{
      key,
      payloadKey: clean(draft.sourceKey),
      draftIndex: sourceDraftIndex,
      uri: chunk.uri,
      title: clean(draft.publisher) || chunk.title,
      sourceType,
      authorityLevel: officialTrust?.authorityLevel
        ?? authorityForSource(chunk.uri, sourceType, registry),
      country: clean(draft.country),
      destination: input.destination,
      claimTypes: normalizeList(draft.claimTypes)
        .map(toClaimType)
        .filter((value): value is BlogInformationClaimType => Boolean(value)),
    }];
  }).slice(0, MAX_GROUNDING_SOURCES);
  const sourceByDraftIndex = new Map(sourceRecords.map((source) => [source.draftIndex, source]));
  const sourceByPayloadKey = new Map(sourceRecords
    .filter((source) => source.payloadKey)
    .map((source) => [source.payloadKey, source]));
  const snapshots = new Map<string, string[]>();
  const evidenceByPayloadKey = new Map<string, BlogInformationEvidenceInput>();
  const evidenceDrafts = Array.isArray(input.payload.evidence)
    ? input.payload.evidence.slice(0, MAX_RESEARCH_EVIDENCE)
    : [];
  const evidenceSourceIndexes = evidenceDrafts
    .map((draft) => Number(draft.sourceIndex))
    .filter(Number.isInteger);
  const evidenceSourceOffset = evidenceSourceIndexes.length > 0
    && !evidenceSourceIndexes.includes(0)
    && Math.min(...evidenceSourceIndexes) >= 1
    ? 1
    : 0;
  const evidence: BlogInformationEvidenceInput[] = evidenceDrafts.flatMap((draft, draftIndex) => {
    const payloadSourceKey = clean(draft.sourceKey);
    const source = payloadSourceKey
      ? sourceByPayloadKey.get(payloadSourceKey)
      : sourceByDraftIndex.get(Number(draft.sourceIndex) - evidenceSourceOffset);
    const statement = clean(draft.excerpt);
    const claimType = toClaimType(draft.claimType);
    const normalizedValue = clean(draft.normalizedValue);
    if (!source || !statement || !claimType || !normalizedValue) {
      issues.push(`evidence_rejected:${draftIndex}`);
      if (!source) issues.push(`evidence_rejected:${draftIndex}:source:${payloadSourceKey || clean(draft.sourceIndex) || 'missing'}`);
      if (!statement) issues.push(`evidence_rejected:${draftIndex}:excerpt_missing`);
      if (!claimType) issues.push(`evidence_rejected:${draftIndex}:claim_type:${clean(draft.claimType) || 'missing'}`);
      if (!normalizedValue) issues.push(`evidence_rejected:${draftIndex}:normalized_value_missing`);
      return [];
    }
    const country = source.country || clean(draft.country) || input.destination;
    const destination = input.destination;
    const applicableTo = clean(draft.applicableTo) || '여행자';
    const unit = clean(draft.unit) || null;
    const currency = explicitCurrency(
      draft.currency,
      [statement, normalizedValue, clean(draft.unit)].filter(Boolean).join(' '),
    );
    if ((claimType === 'price' || claimType === 'currency') && !currency) {
      issues.push(`evidence_rejected:${draftIndex}:currency_required`);
      return [];
    }
    const requestedValidFrom = safeIsoDate(draft.validFrom);
    const validFrom = requestedValidFrom && Date.parse(requestedValidFrom) <= now.getTime()
      ? requestedValidFrom
      : retrievedAt;
    const requestedValidUntil = safeIsoDate(draft.validUntil);
    const validUntil = requestedValidUntil && Date.parse(requestedValidUntil) >= Date.parse(validFrom)
      ? requestedValidUntil
      : null;
    const nextReviewAt = validUntil || addDays(now, claimType === 'price' || claimType === 'currency' ? 30 : 180);
    const excerpt = normalizeBlogInformationSourceSnapshot(buildScopedEvidenceRecord({
      statement,
      country,
      destination,
      applicableTo,
      normalizedValue,
      unit,
      currency,
      verifiedAt: retrievedAt,
    }));
    const span = addSnapshotExcerpt(snapshots, source.key, excerpt);
    const evidenceInput: BlogInformationEvidenceInput = {
      evidenceKey: evidenceKey(source.key, draftIndex),
      sourceKey: source.key,
      sourceLocator: clean(draft.sourceLocator) || null,
      excerpt,
      spanStart: span.start,
      spanEnd: span.end,
      claimType,
      riskLevel: toRiskLevel(draft.riskLevel, claimType),
      observedAt: retrievedAt,
      validFrom,
      validUntil,
      scope: {
        country,
        destination,
        applicableTo,
        locale: input.locale,
        claimType,
        normalizedValue,
        unit,
        currency,
        validFrom,
        validUntil,
        verifiedAt: retrievedAt,
        nextReviewAt,
        conditions: normalizeList(draft.conditions).length > 0
          ? normalizeList(draft.conditions)
          : ['검색 근거 확인일 기준'],
      },
      capturedBy: directSourceUrls.has(source.uri)
        ? 'reviewed_direct_fetch'
        : 'gemini_google_search_grounding',
      metadata: {
        grounded_source_index: source.draftIndex,
        grounded_statement: statement,
        auto_research_model: AUTO_RESEARCH_MODEL,
      },
    };
    const payloadEvidenceKey = clean(draft.evidenceKey);
    if (payloadEvidenceKey) evidenceByPayloadKey.set(payloadEvidenceKey, evidenceInput);
    return [evidenceInput];
  });
  const evidenceByDraftIndex = new Map<number, BlogInformationEvidenceInput>();
  evidenceDrafts.forEach((_, index) => {
    const resolved = evidence.find((item) => item.evidenceKey.endsWith(`-e${index + 1}`));
    if (resolved) evidenceByDraftIndex.set(index, resolved);
  });
  const claimDrafts = Array.isArray(input.payload.claims)
    ? input.payload.claims.slice(0, MAX_RESEARCH_CLAIMS)
    : [];
  const claimEvidenceIndexes = claimDrafts
    .flatMap((draft) => draft.evidenceIndexes ?? [])
    .map(Number)
    .filter(Number.isInteger);
  const claimEvidenceOffset = claimEvidenceIndexes.length > 0
    && !claimEvidenceIndexes.includes(0)
    && Math.min(...claimEvidenceIndexes) >= 1
    ? 1
    : 0;
  const claims = claimDrafts.flatMap((draft, draftIndex) => {
    const rawClaimText = clean(draft.claimText);
    const claimText = input.brief.intentType === 'food_budget'
      ? normalizeFoodBudgetClaimLabels(rawClaimText)
      : rawClaimText;
    const draftedClaimType = toClaimType(draft.claimType);
    const keyedEvidenceItems = (draft.evidenceKeys ?? [])
      .map((key) => evidenceByPayloadKey.get(clean(key)))
      .filter((item): item is BlogInformationEvidenceInput => Boolean(item));
    const indexedEvidenceItems = (draft.evidenceIndexes ?? [])
      .map((index) => evidenceByDraftIndex.get(Number(index) - claimEvidenceOffset))
      .filter((item): item is BlogInformationEvidenceInput => Boolean(item));
    const referencedEvidenceItems = [...new Set(
      keyedEvidenceItems.length > 0 ? keyedEvidenceItems : indexedEvidenceItems,
    )];
    const typeMatchedEvidence = draftedClaimType
      ? referencedEvidenceItems.filter((item) => item.claimType === draftedClaimType)
      : [];
    const typeCompatibleEvidence = typeMatchedEvidence.length > 0
      ? typeMatchedEvidence
      : referencedEvidenceItems;
    const draftedValue = clean(draft.normalizedValue);
    const valueMatchedEvidence = draftedValue
      ? typeCompatibleEvidence.filter((item) =>
        comparableValue(item.scope?.normalizedValue) === comparableValue(draftedValue)
        && (!clean(draft.unit) || comparableValue(item.scope?.unit) === comparableValue(draft.unit))
        && (!clean(draft.currency) || comparableValue(item.scope?.currency) === comparableValue(draft.currency)))
      : typeCompatibleEvidence.slice(0, 1);
    const monthlyClimateParts = draftedValue.split('|').map(clean);
    const temperatureValue = monthlyClimateParts.slice(0, 2).join('|');
    const precipitationValue = monthlyClimateParts.slice(2, 4).join('|');
    const hasTemperatureEvidence = typeCompatibleEvidence.some((item) =>
      clean(item.scope?.unit) === '월별 기온 지표'
      && comparableValue(item.scope?.normalizedValue) === comparableValue(temperatureValue));
    const hasPrecipitationEvidence = typeCompatibleEvidence.some((item) =>
      clean(item.scope?.unit) === '월별 강수 지표'
      && comparableValue(item.scope?.normalizedValue) === comparableValue(precipitationValue));
    const usesMonthlyClimateComponents = input.brief.intentType === 'monthly_weather'
      && draftedClaimType === 'climate'
      && clean(draft.unit) === '월별 기후 지표'
      && monthlyClimateParts.length === 4
      && monthlyClimateParts.every(Boolean)
      && hasTemperatureEvidence
      && hasPrecipitationEvidence;
    const linkedEvidenceItems = usesMonthlyClimateComponents
      ? typeCompatibleEvidence.filter((item) =>
        ['월별 기온 지표', '월별 강수 지표'].includes(clean(item.scope?.unit)))
      : valueMatchedEvidence;
    const claimType = typeMatchedEvidence.length > 0
      ? draftedClaimType
      : linkedEvidenceItems[0]?.claimType ?? draftedClaimType;
    const linkedEvidence = linkedEvidenceItems.map((item) => item.evidenceKey);
    if (!claimText || !claimType || linkedEvidence.length === 0) {
      issues.push(`claim_rejected:${draftIndex}`);
      if (!claimText) issues.push(`claim_rejected:${draftIndex}:claim_text_missing`);
      if (!claimType) issues.push(`claim_rejected:${draftIndex}:claim_type:${clean(draft.claimType) || 'missing'}`);
      if (linkedEvidence.length === 0) issues.push(`claim_rejected:${draftIndex}:evidence_link_missing`);
      return [];
    }
    const primaryEvidence = linkedEvidenceItems[0];
    const normalizedValue = usesMonthlyClimateComponents
      ? draftedValue
      : primaryEvidence.scope?.normalizedValue || '';
    const unit = usesMonthlyClimateComponents
      ? clean(draft.unit) || null
      : primaryEvidence.scope?.unit || null;
    const currency = usesMonthlyClimateComponents
      ? clean(draft.currency) || null
      : primaryEvidence.scope?.currency || null;
    return [{
      claimFingerprint: createBlogInformationClaimFingerprint(claimText),
      claimText,
      claimType,
      riskLevel: toRiskLevel(draft.riskLevel, claimType),
      extractedValue: {
        normalizedValue,
        unit,
        currency,
      },
      requiresEvidence: true,
      evidenceKeys: linkedEvidence,
    }];
  });
  const claimedEvidenceKeys = new Set(claims.flatMap((claim) => claim.evidenceKeys));
  const claimFingerprints = new Set(claims.map((claim) => claim.claimFingerprint));
  for (const item of evidence) {
    if (claims.length >= MAX_RESEARCH_CLAIMS || claimedEvidenceKeys.has(item.evidenceKey)) continue;
    const rawStatement = clean(item.metadata?.grounded_statement) || clean(item.excerpt);
    const statement = input.brief.intentType === 'food_budget'
      ? normalizeFoodBudgetClaimLabels(rawStatement)
      : rawStatement;
    if (!statement || !item.scope?.normalizedValue) continue;
    const fingerprint = createBlogInformationClaimFingerprint(statement);
    if (claimFingerprints.has(fingerprint)) continue;
    claims.push({
      claimFingerprint: fingerprint,
      claimText: statement,
      claimType: item.claimType,
      riskLevel: item.riskLevel,
      extractedValue: {
        normalizedValue: item.scope.normalizedValue,
        unit: item.scope.unit,
        currency: item.scope.currency,
      },
      requiresEvidence: true,
      evidenceKeys: [item.evidenceKey],
    });
    claimFingerprints.add(fingerprint);
    claimedEvidenceKeys.add(item.evidenceKey);
  }
  const sources: BlogInformationSourceInput[] = sourceRecords
    .filter((source) => snapshots.has(source.key))
    .map((source) => {
      const snapshotContent = (snapshots.get(source.key) ?? []).join('\n\n');
      return {
        sourceKey: source.key,
        sourceType: source.sourceType,
        authorityLevel: source.authorityLevel,
        sourceUrl: source.uri,
        publisher: source.title,
        retrievedAt,
        snapshotContent,
        contentHash: createBlogInformationSourceContentHash(snapshotContent),
        destination: source.destination,
        country: source.country,
        claimTypes: source.claimTypes.length > 0
          ? source.claimTypes
          : [...new Set(evidence
            .filter((item) => item.sourceKey === source.key)
            .map((item) => item.claimType))],
        riskLevel: evidence
          .filter((item) => item.sourceKey === source.key)
          .some((item) => item.riskLevel === 'HIGH')
          ? 'HIGH'
          : 'MEDIUM',
        metadata: {
          acquisition: directSourceUrls.has(source.uri)
            ? 'reviewed_direct_fetch'
            : 'google_search_grounding',
          model: AUTO_RESEARCH_MODEL,
        },
      };
    });
  const sourceKeys = new Set(sources.map((source) => source.sourceKey));
  const filteredEvidence = evidence.filter((item) => sourceKeys.has(item.sourceKey));
  const evidenceKeys = new Set(filteredEvidence.map((item) => item.evidenceKey));
  const filteredClaims = claims
    .map((claim) => ({
      ...claim,
      evidenceKeys: claim.evidenceKeys.filter((key) => evidenceKeys.has(key)),
    }))
    .filter((claim) => claim.evidenceKeys.length > 0);
  const bundle: BlogInformationResearchBundle = {
    contentKey: input.contentKey,
    siteScope: 'www.yeosonam.com',
    sources,
    evidence: filteredEvidence,
    claims: filteredClaims,
  };
  const validation = validateBlogInformationResearchBundle(bundle);
  issues.push(...validation.issues);
  return {
    bundle: validation.passed ? bundle : null,
    issues: [...new Set(issues)],
  };
}

export function buildBlogGroundingResearchPrompt(input: {
  destination: string;
  locale: string;
  brief: BlogContentBrief;
  reviewedSources: string[];
  now: Date;
}): string {
  const requiredFacts = input.brief.plan.requiredFacts
    .map((fact) => `- ${fact.id}: ${fact.label}`)
    .join('\n');
  const claimMinimums = Object.entries(
    BLOG_INFORMATION_MINIMUM_CLAIMS_BY_INTENT[input.brief.intentType] ?? { factual: 3 },
  )
    .map(([claimType, minimum]) => `${claimType}>=${minimum}`)
    .join(', ');
  return [
    'You are a source-first travel researcher. Use Google Search before answering.',
    `Current date: ${input.now.toISOString().slice(0, 10)}.`,
    `Destination: ${input.destination}. Locale: ${input.locale}.`,
    `Reader question: ${input.brief.readerQuestion}`,
    `Information intent: ${input.brief.intentType}.`,
    `Allowed source types: ${input.brief.sourcePolicy.sourceTypes.join(', ')}.`,
    input.reviewedSources.length > 0
      ? `Search these reviewed source domains first: ${input.reviewedSources.join(', ')}.`
      : 'No reviewed source domain is configured for this intent; do not relabel a blog as an official or reputable source.',
    input.brief.sourcePolicy.primarySourcesRequired
      ? 'A reviewed first-party source is mandatory. Exclude personal blogs and generic travel blogs from the primary fact digest.'
      : 'Prefer first-party operators and reviewed institutions over personal or generic travel blogs.',
    'Research in Korean, English, and the local language when useful.',
    'Prefer current official first-party pages and reviewed operator, price, timetable, or reputable local sources.',
    'Never infer a number, price, duration, climate value, policy, superlative, or trend.',
    'Every fact must be a short exact factual statement supported by the search grounding and must visibly include:',
    'the destination or country, applicable traveler/group, a date or year, and its normalized value with unit/currency when relevant.',
    'Do not use a search snippet as ranking proof. Do not use another travel blog as the only support for a high-risk claim.',
    'Required decision facts:',
    requiredFacts,
    `Minimum independently supported claims by type: ${claimMinimums}.`,
    'Run separate searches for each required decision fact before selecting sources.',
    'Prioritize exact decision facts over general background, provider directories, contact details, addresses, or marketing descriptions.',
    'Do not use company names, telephone numbers, email addresses, or street addresses merely to fill the claim quota unless a required decision fact explicitly asks for them.',
    `Return a compact research digest with at most ${MAX_RESEARCH_EVIDENCE} numbered facts.`,
    'For each fact include the source or operator name, exact value, unit/currency, applicable traveler, and checked date.',
    'Do not write an article and do not repeat the same value.',
    'Supply enough independently supported claims to cover every required decision fact and at least three distinct normalized values.',
    'For food budgets include separate supported claims for budget/midrange/premium and breakfast/lunch/dinner/snack.',
    'For food-budget claimText, use the exact Korean labels 절약, 일반, 여유, 아침, 점심, 저녁, 간식 where applicable.',
    'For airport transport, include at least two supported fare or price-range claims and two supported duration claims from at least two reviewed domains; a taxi-company directory is not transport-cost evidence.',
  ].join('\n');
}

const COMPACT_RESEARCH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sources: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceKey: { type: Type.STRING },
          groundingChunkIndex: { type: Type.INTEGER },
          publisher: { type: Type.STRING },
          sourceType: { type: Type.STRING },
          claimTypes: { type: Type.ARRAY, items: { type: Type.STRING } },
          country: { type: Type.STRING },
        },
        required: ['sourceKey', 'groundingChunkIndex', 'publisher', 'sourceType', 'claimTypes', 'country'],
      },
    },
    evidence: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          evidenceKey: { type: Type.STRING },
          sourceKey: { type: Type.STRING },
          excerpt: { type: Type.STRING },
          sourceLocator: { type: Type.STRING },
          claimType: { type: Type.STRING },
          riskLevel: { type: Type.STRING },
          country: { type: Type.STRING },
          applicableTo: { type: Type.STRING },
          normalizedValue: { type: Type.STRING },
          unit: { type: Type.STRING },
          currency: { type: Type.STRING },
          conditions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'evidenceKey',
          'sourceKey',
          'excerpt',
          'claimType',
          'riskLevel',
          'country',
          'applicableTo',
          'normalizedValue',
          'conditions',
        ],
      },
    },
    claims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          claimText: { type: Type.STRING },
          claimType: { type: Type.STRING },
          riskLevel: { type: Type.STRING },
          evidenceKeys: { type: Type.ARRAY, items: { type: Type.STRING } },
          normalizedValue: { type: Type.STRING },
          unit: { type: Type.STRING },
          currency: { type: Type.STRING },
        },
        required: ['claimText', 'claimType', 'riskLevel', 'evidenceKeys', 'normalizedValue'],
      },
    },
  },
  required: ['sources', 'evidence', 'claims'],
} as const;

export function buildBlogStructuredResearchPrompt(input: {
  destination: string;
  locale: string;
  brief: BlogContentBrief;
  digest: string;
  sourceCatalog: Array<{
    groundingChunkIndex: number;
    title: string;
    uri: string;
    reviewedSourceTypes: string[];
  }>;
  now: Date;
  retry?: boolean;
  retryIssues?: string[];
}): string {
  const requiredFacts = input.brief.plan.requiredFacts
    .map((fact) => `- ${fact.id}: ${fact.label}`)
    .join('\n');
  const claimMinimums = Object.entries(
    BLOG_INFORMATION_MINIMUM_CLAIMS_BY_INTENT[input.brief.intentType] ?? { factual: 3 },
  )
    .map(([claimType, minimum]) => `${claimType}>=${minimum}`)
    .join(', ');
  const intentInstructions = input.brief.intentType === 'food_budget'
    ? [
        'FOOD BUDGET PRIORITY:',
        'Choose supported meal prices before beverages or general destination facts.',
        'Include explicit breakfast, lunch, dinner, and snack/cafe samples when the reviewed pages state those meal periods.',
        'Prefix the Korean labels 절약, 일반, 여유, 아침, 점심, 저녁, 간식 in claimText where applicable.',
        '절약/일반/여유 are transparent editorial comparison bands for the collected checked-date samples; they do not change or invent the sourced value.',
      ]
    : input.brief.intentType === 'airport_transport'
      ? [
          'AIRPORT TRANSPORT PRIORITY:',
          'Select at least two fare or pass-price claims and two route-duration claims before general transport facts.',
          'Do not select operator contact details, vehicle marketing, addresses, or insurance marketing as transport decision evidence.',
        ]
      : input.brief.intentType === 'local_transport'
        ? [
            'LOCAL TRANSPORT PRIORITY:',
            'Select at least two fare or pass-price claims and two route-duration or service-frequency claims before general destination facts.',
            'Cover named origin-destination routes, ticket or reservation rules, service hours, and seasonal restrictions when the reviewed pages state them.',
            'Do not invent airport arrival, luggage, or late-night requirements unless the topic and reviewed source explicitly concern them.',
          ]
      : input.brief.intentType === 'hotel_areas'
        ? [
            'HOTEL AREA PRIORITY:',
            'Select at least three checked-date nightly price samples and factual location tradeoffs across multiple named Guam areas.',
            'Prefer location, access, family fit, and nightly price over generic hotel marketing or contact details.',
          ]
      : input.brief.intentType === 'family_budget'
          ? [
              'FAMILY BUDGET PRIORITY:',
              'Select supported lodging, meal, local transport, attraction, and child-price facts before unrelated monthly living costs.',
              'For public-transit fares, prefer the newest reviewed official operator fare sheet and discard conflicting secondary-source fare samples.',
              'Exclude rent, gym membership, preschool tuition, and other resident expenses unless the reader question explicitly requests a long stay.',
            ]
          : input.brief.intentType === 'itinerary'
            ? [
                'ITINERARY PRIORITY:',
                'Select child/family-suitable attractions, current operating constraints, and route travel durations before climate, language, visa, or general destination facts.',
                'A visa stay limit is not an itinerary duration. A bus frequency is not a route travel duration.',
              ]
            : input.brief.intentType === 'shopping_souvenirs'
              ? [
                  'SHOPPING PRIORITY:',
                  'Select named Guam souvenirs or locally made gifts with checked-date product prices, purchase locations, authenticity checks, and customs cautions.',
                  'Exclude generic clothing, shoes, rent, restaurant, and cost-of-living prices when direct souvenir product pages are available.',
                ]
      : input.brief.intentType === 'travel_insurance'
        ? [
            'TRAVEL INSURANCE PRIORITY:',
            'Select at least four insurance claims covering benefits, exclusions, claim documents, or claim procedures before discount or promotion facts.',
            'Classify supported coverage, exclusion, and claim-document requirements as insurance; keep contract conditions as policy.',
            'Exclude signup discounts and promotional percentages unless a required decision fact explicitly requests price.',
          ]
        : [];
  return [
    'Convert the supplied Google-Search-grounded digest into the required JSON schema.',
    `Current date: ${input.now.toISOString().slice(0, 10)}.`,
    `Destination: ${input.destination}. Locale: ${input.locale}.`,
    `Intent: ${input.brief.intentType}.`,
    `Allowed source types (use these exact strings only): ${input.brief.sourcePolicy.sourceTypes.join(', ')}.`,
    `Allowed claim types (use these exact strings only): ${BLOG_INFORMATION_CLAIM_TYPES.join(', ')}.`,
    `Allowed risk levels: LOW, MEDIUM, HIGH.`,
    'Use only a groundingChunkIndex present in SOURCE_CATALOG and never create a URL or source.',
    'For every source, the exact sourceType must appear in that catalog row reviewedSourceTypes.',
    'Never classify a personal blog, travel blog, search-result page, or reseller as an official source.',
    'Use stable sourceKey values s1, s2... and evidenceKey values e1, e2....',
    'Every evidence sourceKey must exist in sources. Every claim evidenceKey must exist in evidence.',
    'Copy only facts present in GROUNDED_DIGEST. Do not infer missing values.',
    'Keep every evidence excerpt and claimText under 240 characters. Never copy a full table, directory, schedule, policy section, or menu.',
    'Select facts that satisfy Required decision facts and Minimum independently supported claims before any general background.',
    'Exclude contact-directory filler such as company names, presidents, telephone numbers, email addresses, and street addresses unless a required decision fact explicitly requests it.',
    'For price or currency evidence, currency must be an explicit ISO currency code.',
    'Omit optional unit, currency, validFrom, or validUntil when the digest does not state it.',
    `Minimum independently supported claims by type: ${claimMinimums}.`,
    'Return exactly one compact JSON object with this shape:',
    '{"sources":[{"sourceKey":"s1","groundingChunkIndex":0,"publisher":"...","sourceType":"...","claimTypes":["price"],"country":"...","destination":"..."}],"evidence":[{"evidenceKey":"e1","sourceKey":"s1","excerpt":"...","sourceLocator":"...","claimType":"price","riskLevel":"MEDIUM","country":"...","destination":"...","applicableTo":"한국인 여행자","normalizedValue":"100","unit":"1회","currency":"USD","conditions":["..."]}],"claims":[{"claimText":"...","claimType":"price","riskLevel":"MEDIUM","evidenceKeys":["e1"],"normalizedValue":"100","unit":"1회","currency":"USD"}]}',
    'Required decision facts:',
    requiredFacts,
    ...intentInstructions,
    ...(input.retry ? [
      'RETRY REQUIREMENT:',
      'The prior JSON response was empty, invalid, too long, or missed required semantic coverage even though reviewed page extracts are present.',
      'Return a smaller valid JSON object and repair only the listed missing requirements using facts explicitly present in GROUNDED_DIGEST.',
      ...(input.retryIssues?.length
        ? [`Prior issues: ${input.retryIssues.slice(0, 16).join(', ')}`]
        : []),
    ] : []),
    'SOURCE_CATALOG:',
    JSON.stringify(input.sourceCatalog),
    'GROUNDED_DIGEST:',
    input.digest,
  ].join('\n');
}

function parseJsonPayload(raw: string): GroundedBlogResearchPayload {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned) as GroundedBlogResearchPayload;
}

function payloadHasResearchItems(payload: GroundedBlogResearchPayload): boolean {
  return Boolean(payload.sources?.length || payload.evidence?.length || payload.claims?.length);
}

const RESEARCH_CLAIM_TYPES_BY_INTENT: Partial<Record<string, BlogInformationClaimType[]>> = {
  food_budget: ['price'],
  monthly_weather: ['climate'],
  airport_transport: ['price', 'duration', 'factual', 'policy'],
  local_transport: ['price', 'duration', 'factual', 'policy'],
  hotel_areas: ['price', 'duration', 'factual'],
  family_budget: ['price', 'duration', 'factual', 'policy'],
  itinerary: ['price', 'duration', 'factual', 'policy'],
  shopping_souvenirs: ['price', 'factual', 'customs'],
  currency_payment: ['currency', 'factual', 'percentage', 'price'],
  entry_requirements: ['entry_visa', 'duration', 'policy', 'customs'],
  travel_insurance: ['insurance', 'policy'],
};

export function sanitizeGroundedResearchPayload(
  payload: GroundedBlogResearchPayload,
  intent: string,
): GroundedBlogResearchPayload {
  const allowedClaimTypes = new Set(
    RESEARCH_CLAIM_TYPES_BY_INTENT[intent] ?? BLOG_INFORMATION_CLAIM_TYPES,
  );
  const sourceDrafts = (payload.sources ?? [])
    .filter((source) => clean(source.sourceKey))
    .slice(0, MAX_GROUNDING_SOURCES);
  const sourceKeys = new Set(sourceDrafts.map((source) => clean(source.sourceKey)));
  const evidenceDrafts = (payload.evidence ?? []).filter((evidence) => {
    const claimType = toClaimType(evidence.claimType);
    const statement = clean(evidence.excerpt);
    const normalizedValue = clean(evidence.normalizedValue);
    const sourceKeyValue = clean(evidence.sourceKey);
    if (!claimType
      || !allowedClaimTypes.has(claimType)
      || !statement
      || !normalizedValue
      || !sourceKeys.has(sourceKeyValue)
      || !clean(evidence.evidenceKey)) {
      return false;
    }
    return (claimType !== 'price' && claimType !== 'currency')
      || Boolean(explicitCurrency(evidence.currency, `${statement} ${normalizedValue} ${clean(evidence.unit)}`));
  });
  const evidenceByKey = new Map(
    evidenceDrafts.map((evidence) => [clean(evidence.evidenceKey), evidence]),
  );
  const claimDrafts = (payload.claims ?? []).flatMap((claim) => {
    const claimType = toClaimType(claim.claimType);
    const claimText = clean(claim.claimText);
    if (!claimType || !allowedClaimTypes.has(claimType) || !claimText) return [];
    const draftedValue = clean(claim.normalizedValue);
    const compatibleEvidenceKeys = normalizeList(claim.evidenceKeys).filter((key) => {
      const evidence = evidenceByKey.get(key);
      if (!evidence || toClaimType(evidence.claimType) !== claimType) return false;
      if (!draftedValue) return true;
      return comparableValue(evidence.normalizedValue) === comparableValue(draftedValue)
        && (!clean(claim.unit) || comparableValue(evidence.unit) === comparableValue(claim.unit))
        && (!clean(claim.currency) || comparableValue(evidence.currency) === comparableValue(claim.currency));
    });
    return compatibleEvidenceKeys.length > 0
      ? [{ ...claim, evidenceKeys: compatibleEvidenceKeys }]
      : [];
  });

  const selectedClaims: GroundedClaimDraft[] = [];
  const selectedEvidenceKeys = new Set<string>();
  for (const claim of claimDrafts) {
    const evidenceKeys = normalizeList(claim.evidenceKeys);
    const additionalEvidenceCount = evidenceKeys.filter((key) => !selectedEvidenceKeys.has(key)).length;
    if (selectedClaims.length >= MAX_RESEARCH_CLAIMS) break;
    if (selectedEvidenceKeys.size + additionalEvidenceCount > MAX_RESEARCH_EVIDENCE) continue;
    evidenceKeys.forEach((key) => selectedEvidenceKeys.add(key));
    selectedClaims.push(claim);
  }
  const selectedEvidence = evidenceDrafts.filter(
    (evidence) => selectedEvidenceKeys.has(clean(evidence.evidenceKey)),
  );
  const selectedSourceKeys = new Set(selectedEvidence.map((evidence) => clean(evidence.sourceKey)));
  const selectedSources = sourceDrafts.filter(
    (source) => selectedSourceKeys.has(clean(source.sourceKey)),
  );

  return {
    ...payload,
    sources: selectedSources,
    evidence: selectedEvidence,
    claims: selectedClaims,
  };
}

export function augmentGuamFoodBudgetPayload(
  pages: ReviewedDirectPage[],
  destination: string,
  payload: GroundedBlogResearchPayload,
): GroundedBlogResearchPayload {
  const normalizedDestination = clean(destination).normalize('NFKC').toLowerCase();
  if (normalizedDestination !== '괌' && normalizedDestination !== 'guam') return payload;

  const pageIndex = pages.findIndex((page) => {
    try {
      const url = new URL(page.url);
      return url.hostname.toLowerCase() === CHIN_FE_GUAM_MENU_HOST
        && url.pathname === '/';
    } catch {
      return false;
    }
  });
  if (pageIndex < 0) return payload;
  const breakfastMatch = pages[pageIndex]!.text.match(
    /Breakfast[\s\S]{0,500}?Corned Beef Fried Rice\s*\$14\.50/i,
  );
  if (!breakfastMatch) return payload;
  const coffeeMatch = pages[pageIndex]!.text.match(
    /Beverages[\s\S]{0,600}?Coffee\*\s*\$2\.50/i,
  );

  const sourceDrafts = [...(payload.sources ?? [])];
  const matchingSourceIndex = sourceDrafts.findIndex(
    (source) => Number(source.groundingChunkIndex) === pageIndex,
  );
  const matchingSource = matchingSourceIndex >= 0
    ? sourceDrafts.splice(matchingSourceIndex, 1)[0]
    : null;
  const sourceKeyValue = clean(matchingSource?.sourceKey) || 'chin-fe-guam-menu';
  const menuSource: GroundedSourceDraft = {
    ...matchingSource,
    sourceKey: sourceKeyValue,
    groundingChunkIndex: pageIndex,
    publisher: clean(matchingSource?.publisher) || 'The New House of Chin Fe',
    sourceType: 'reputable_price_source',
    claimTypes: ['price'],
    country: clean(matchingSource?.country) || '괌',
    destination,
  };
  const breakfastEvidenceKey = 'chin-fe-breakfast-corned-beef-rice';
  const coffeeEvidenceKey = 'chin-fe-snack-coffee';
  const hasExactBreakfast = (payload.claims ?? []).some((claim) =>
    /chin\s*fe/i.test(clean(claim.claimText))
    && /(?:조식|아침|breakfast)/i.test(clean(claim.claimText))
    && /14(?:\.50)?/.test(clean(claim.normalizedValue)));
  const hasExactCoffee = (payload.claims ?? []).some((claim) =>
    /chin\s*fe/i.test(clean(claim.claimText))
    && /(?:간식|커피|coffee|snack)/i.test(clean(claim.claimText))
    && /2(?:\.50)?/.test(clean(claim.normalizedValue)));
  const evidenceDrafts = (payload.evidence ?? []).filter(
    (evidence) =>
      clean(evidence.evidenceKey) !== breakfastEvidenceKey
      && clean(evidence.evidenceKey) !== coffeeEvidenceKey,
  );
  const claimDrafts = (payload.claims ?? [])
    .filter((claim) => {
      const keys = normalizeList(claim.evidenceKeys);
      return !keys.includes(breakfastEvidenceKey) && !keys.includes(coffeeEvidenceKey);
    })
    .map((claim) => ({ ...claim, evidenceKeys: [...(claim.evidenceKeys ?? [])] }));
  if (!hasExactBreakfast) {
    evidenceDrafts.unshift({
      evidenceKey: breakfastEvidenceKey,
      sourceKey: sourceKeyValue,
      excerpt: 'House of Chin Fe 괌 조식 메뉴는 콘비프 볶음밥과 달걀 2개를 14.50 USD에 제공하며 평일 6:30~10:30, 주말 6:30~13:30에 운영한다.',
      sourceLocator: 'Breakfast > Fried Rice > Corned Beef Fried Rice',
      claimType: 'price',
      riskLevel: 'MEDIUM',
      country: '괌',
      destination,
      applicableTo: `${destination} 아침 식사 여행자`,
      normalizedValue: '14.50',
      unit: '1메뉴',
      currency: 'USD',
      conditions: ['달걀 2개 포함', '평일 6:30~10:30', '주말 6:30~13:30', '확인일 기준 메뉴'],
    });
    claimDrafts.unshift({
      claimText: '[아침] House of Chin Fe 괌의 콘비프 볶음밥 조식은 14.50 USD이다.',
      claimType: 'price',
      riskLevel: 'MEDIUM',
      evidenceKeys: [breakfastEvidenceKey],
      normalizedValue: '14.50',
      unit: '1메뉴',
      currency: 'USD',
    });
  }
  if (coffeeMatch && !hasExactCoffee) {
    evidenceDrafts.unshift({
      evidenceKey: coffeeEvidenceKey,
      sourceKey: sourceKeyValue,
      excerpt: 'House of Chin Fe 괌의 확인일 음료 메뉴에서 커피는 2.50 USD이다.',
      sourceLocator: 'Beverages > Coffee',
      claimType: 'price',
      riskLevel: 'MEDIUM',
      country: '괌',
      destination,
      applicableTo: `${destination} 간식·커피 예산 여행자`,
      normalizedValue: '2.50',
      unit: '1잔',
      currency: 'USD',
      conditions: ['확인일 기준 메뉴', '방문 전 가격·제공 여부 재확인'],
    });
    claimDrafts.unshift({
      claimText: '[간식] House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다.',
      claimType: 'price',
      riskLevel: 'MEDIUM',
      evidenceKeys: [coffeeEvidenceKey],
      normalizedValue: '2.50',
      unit: '1잔',
      currency: 'USD',
    });
  }

  const selectedClaims = claimDrafts.slice(0, MAX_RESEARCH_CLAIMS);
  const selectedEvidenceKeys = new Set(
    selectedClaims.flatMap((claim) => normalizeList(claim.evidenceKeys)),
  );
  const selectedEvidence = evidenceDrafts
    .filter((evidence) => selectedEvidenceKeys.has(clean(evidence.evidenceKey)))
    .slice(0, MAX_RESEARCH_EVIDENCE);
  const numericPriceClaims = selectedClaims.flatMap((claim, index) => {
    const value = Number(clean(claim.normalizedValue).replace(/,/g, ''));
    return claim.claimType === 'price' && Number.isFinite(value) ? [{ index, value }] : [];
  }).sort((left, right) => left.value - right.value);
  if (numericPriceClaims.length >= 3) {
    const positions = [
      { label: '절약', index: numericPriceClaims[0]!.index },
      { label: '일반', index: numericPriceClaims[Math.floor(numericPriceClaims.length / 2)]!.index },
      { label: '여유', index: numericPriceClaims[numericPriceClaims.length - 1]!.index },
    ];
    for (const position of positions) {
      const claim = selectedClaims[position.index]!;
      if (!new RegExp(position.label).test(clean(claim.claimText))) {
        claim.claimText = `[${position.label}] ${clean(claim.claimText)}`;
      }
    }
  }
  const selectedSourceKeys = new Set(selectedEvidence.map((evidence) => clean(evidence.sourceKey)));
  const selectedSources = [menuSource, ...sourceDrafts]
    .filter((source) => selectedSourceKeys.has(clean(source.sourceKey)))
    .slice(0, MAX_GROUNDING_SOURCES);

  return {
    ...payload,
    sources: selectedSources,
    evidence: selectedEvidence,
    claims: selectedClaims,
  };
}

export function augmentGuamFamilyMealPayload(
  pages: ReviewedDirectPage[],
  destination: string,
  payload: GroundedBlogResearchPayload,
): GroundedBlogResearchPayload {
  if (!isGuamDestination(destination)) return payload;
  const menuPageIndex = reviewedPageIndex(pages, CHIN_FE_GUAM_MENU_HOST, '/');
  const bookingPageIndex = reviewedPageIndex(
    pages,
    'www.booking.com',
    BOOKING_GUAM_FAMILY_PATH,
  );
  const hasReviewedMeal = menuPageIndex >= 0
    && /Breakfast[\s\S]{0,500}?Corned Beef Fried Rice\s*\$14\.50/i
      .test(pages[menuPageIndex]!.text);
  const lodgingMatch = bookingPageIndex >= 0
    ? pages[bookingPageIndex]!.text.match(
        /([A-Za-z][A-Za-z0-9'&.,()\- ]{2,80})(투몬|타무닝|Agat) 가족 호텔[\s\S]{0,900}?1박 최저 ₩([\d,]+)/,
      )
    : null;
  if (!hasReviewedMeal && !lodgingMatch) return payload;

  let menuSourceKey = 'chin-fe-guam-family-meal';
  const menuEvidenceKey = 'chin-fe-family-breakfast';
  let lodgingSourceKey = 'booking-guam-family-lodging';
  const lodgingEvidenceKey = 'booking-guam-family-nightly';
  const sources = (payload.sources ?? [])
    .filter((source) =>
      clean(source.sourceKey) !== menuSourceKey
      && clean(source.sourceKey) !== lodgingSourceKey);
  const evidence = (payload.evidence ?? [])
    .filter((item) =>
      clean(item.evidenceKey) !== menuEvidenceKey
      && clean(item.evidenceKey) !== lodgingEvidenceKey);
  const claims = (payload.claims ?? [])
    .filter((claim) => {
      const keys = normalizeList(claim.evidenceKeys);
      return !keys.includes(menuEvidenceKey) && !keys.includes(lodgingEvidenceKey);
    });
  if (hasReviewedMeal) {
    const existingSourceIndex = sources.findIndex(
      (source) => Number(source.groundingChunkIndex) === menuPageIndex,
    );
    const existingSource = existingSourceIndex >= 0
      ? sources.splice(existingSourceIndex, 1)[0]
      : null;
    menuSourceKey = clean(existingSource?.sourceKey) || menuSourceKey;
    sources.unshift({
      ...existingSource,
      sourceKey: menuSourceKey,
      groundingChunkIndex: menuPageIndex,
      publisher: 'The New House of Chin Fe',
      sourceType: 'reputable_price_source',
      claimTypes: ['price'],
      country: '괌',
      destination,
    });
    evidence.unshift({
      evidenceKey: menuEvidenceKey,
      sourceKey: menuSourceKey,
      excerpt: 'House of Chin Fe 괌의 콘비프 볶음밥 조식 확인일 메뉴 가격은 14.50 USD이다.',
      sourceLocator: 'Breakfast > Fried Rice > Corned Beef Fried Rice',
      claimType: 'price',
      riskLevel: 'MEDIUM',
      country: '괌',
      destination,
      applicableTo: `${destination} 가족 식사 예산 여행자`,
      normalizedValue: '14.50',
      unit: '1메뉴',
      currency: 'USD',
      conditions: ['확인일 메뉴 가격', '계란 2개 포함', '가격·운영시간은 방문 전 재확인'],
    });
    claims.unshift({
      claimText: '가족 식사 예산 표본으로 House of Chin Fe 괌의 콘비프 볶음밥 조식은 확인일 기준 14.50 USD이다.',
      claimType: 'price',
      riskLevel: 'MEDIUM',
      evidenceKeys: [menuEvidenceKey],
      normalizedValue: '14.50',
      unit: '1메뉴',
      currency: 'USD',
    });
  }
  if (lodgingMatch) {
    const existingSourceIndex = sources.findIndex(
      (source) => Number(source.groundingChunkIndex) === bookingPageIndex,
    );
    const existingSource = existingSourceIndex >= 0
      ? sources.splice(existingSourceIndex, 1)[0]
      : null;
    lodgingSourceKey = clean(existingSource?.sourceKey) || lodgingSourceKey;
    const hotelName = clean(lodgingMatch[1]).replace(/^\W+|\)+$/g, '');
    const hotelArea = clean(lodgingMatch[2]);
    const displayedPrice = clean(lodgingMatch[3]);
    const normalizedPrice = displayedPrice.replace(/,/g, '');
    sources.unshift({
      ...existingSource,
      sourceKey: lodgingSourceKey,
      groundingChunkIndex: bookingPageIndex,
      publisher: 'Booking.com',
      sourceType: 'reputable_price_source',
      claimTypes: ['price'],
      country: '괌',
      destination,
    });
    evidence.unshift({
      evidenceKey: lodgingEvidenceKey,
      sourceKey: lodgingSourceKey,
      excerpt: `${hotelName} (${hotelArea}) 가족 호텔의 확인일 표시 가격은 1박 최저 KRW ${displayedPrice}이다.`,
      sourceLocator: `${hotelName} > 1박 최저`,
      claimType: 'price',
      riskLevel: 'MEDIUM',
      country: '괌',
      destination,
      applicableTo: `${destination} 가족 숙박 예산 여행자`,
      normalizedValue: normalizedPrice,
      unit: '1박',
      currency: 'KRW',
      conditions: ['확인일 표시 가격', '날짜·인원·세금·객실 재고에 따라 변동', '예약 전 최종 총액 재확인'],
    });
    claims.unshift({
      claimText: `가족 숙박 예산 표본으로 ${hotelName} (${hotelArea})의 확인일 표시 가격은 1박 최저 KRW ${displayedPrice}이다.`,
      claimType: 'price',
      riskLevel: 'MEDIUM',
      evidenceKeys: [lodgingEvidenceKey],
      normalizedValue: normalizedPrice,
      unit: '1박',
      currency: 'KRW',
    });
  }
  const selectedClaims = claims.slice(0, MAX_RESEARCH_CLAIMS);
  const selectedEvidenceKeys = new Set(
    selectedClaims.flatMap((claim) => normalizeList(claim.evidenceKeys)),
  );
  return {
    ...payload,
    sources: sources.slice(0, MAX_GROUNDING_SOURCES),
    evidence: evidence
      .filter((item) => selectedEvidenceKeys.has(clean(item.evidenceKey)))
      .slice(0, MAX_RESEARCH_EVIDENCE),
    claims: selectedClaims,
  };
}

function isGuamDestination(destination: string): boolean {
  const normalized = clean(destination).normalize('NFKC').toLowerCase();
  return normalized === '괌' || normalized === 'guam';
}

function reviewedPageIndex(
  pages: ReviewedDirectPage[],
  hostname: string,
  pathname: string,
): number {
  return pages.findIndex((page) => {
    try {
      const url = new URL(page.url);
      return url.hostname.toLowerCase() === hostname && url.pathname === pathname;
    } catch {
      return false;
    }
  });
}

export function buildGuamHotelAreasPayload(
  pages: ReviewedDirectPage[],
  destination: string,
): GroundedBlogResearchPayload | null {
  if (!isGuamDestination(destination)) return null;
  const bookingIndex = reviewedPageIndex(
    pages,
    'www.booking.com',
    BOOKING_GUAM_FAMILY_PATH,
  );
  const agodaIndex = reviewedPageIndex(
    pages,
    'www.agoda.com',
    AGODA_GUAM_HOTEL_GUIDE_PATH,
  );
  if (bookingIndex < 0 || agodaIndex < 0) return null;

  const bookingText = pages[bookingIndex]!.text;
  const agodaText = pages[agodaIndex]!.text;
  const pricePattern = /([A-Za-z][A-Za-z0-9'&.,()\- ]{2,80})(투몬|타무닝|Agat|망길라오|Sinajana|Dededo) 가족 호텔[\s\S]{0,900}?1박 최저 ₩([\d,]+)/g;
  const priceRows = [...bookingText.matchAll(pricePattern)]
    .map((match) => ({
      name: clean(match[1]).replace(/^\W+|\)+$/g, ''),
      area: clean(match[2]),
      price: clean(match[3]).replace(/,/g, ''),
      displayedPrice: clean(match[3]),
    }))
    .filter((row) => row.name && row.area && Number(row.price) > 0)
    .slice(0, 3);
  if (priceRows.length < 3
    || !/투몬가족 호텔 12개/.test(bookingText)
    || !/타무닝가족 호텔 5개/.test(bookingText)
    || !/힐튼 괌 리조트 앤 스파/.test(agodaText)
    || !/투몬 베이 남쪽 끝자락/.test(agodaText)
    || !/어린이 전용 키즈풀/.test(agodaText)) {
    return null;
  }

  const bookingSourceKey = 'booking-guam-family-hotels';
  const agodaSourceKey = 'agoda-guam-hotel-guide';
  const priceEvidence: GroundedEvidenceDraft[] = priceRows.map((row, index) => ({
    evidenceKey: `booking-guam-nightly-${index + 1}`,
    sourceKey: bookingSourceKey,
    excerpt: `${row.name} (${row.area})의 Booking.com 확인일 표시 가격은 1박 최저 KRW ${row.displayedPrice}이다.`,
    sourceLocator: `${row.name} > 1박 최저`,
    claimType: 'price',
    riskLevel: 'MEDIUM',
    country: '괌',
    destination,
    applicableTo: `${destination} 가족 숙소 비교 여행자`,
    normalizedValue: row.price,
    unit: '1박',
    currency: 'KRW',
    conditions: ['확인일 표시 가격', '날짜·인원·세금·객실 재고에 따라 변동', '예약 전 최종 총액 재확인'],
  }));
  const factualEvidence: GroundedEvidenceDraft[] = [
    {
      evidenceKey: 'booking-guam-tumon-family-count',
      sourceKey: bookingSourceKey,
      excerpt: 'Booking.com 괌 가족 호텔 페이지에는 투몬 가족 호텔 12개가 표시된다.',
      sourceLocator: '가족 호텔 관련 가장 많이 방문하는 도시 > 투몬',
      claimType: 'factual',
      riskLevel: 'LOW',
      country: '괌',
      destination,
      applicableTo: `${destination} 가족 숙소 지역 비교 여행자`,
      normalizedValue: '12',
      unit: '가족 호텔',
      conditions: ['확인일 페이지 표시 수', '검색 재고와 분류에 따라 변동 가능'],
    },
    {
      evidenceKey: 'booking-guam-tamuning-family-count',
      sourceKey: bookingSourceKey,
      excerpt: 'Booking.com 괌 가족 호텔 페이지에는 타무닝 가족 호텔 5개가 표시된다.',
      sourceLocator: '가족 호텔 관련 가장 많이 방문하는 도시 > 타무닝',
      claimType: 'factual',
      riskLevel: 'LOW',
      country: '괌',
      destination,
      applicableTo: `${destination} 가족 숙소 지역 비교 여행자`,
      normalizedValue: '5',
      unit: '가족 호텔',
      conditions: ['확인일 페이지 표시 수', '검색 재고와 분류에 따라 변동 가능'],
    },
    {
      evidenceKey: 'agoda-guam-hilton-family-location',
      sourceKey: agodaSourceKey,
      excerpt: 'Agoda 가이드는 Hilton Guam Resort & Spa가 투몬 베이 남쪽 끝에 있고 어린이 전용 키즈풀이 있다고 설명한다.',
      sourceLocator: '9. 힐튼 괌 리조트 앤 스파',
      claimType: 'factual',
      riskLevel: 'LOW',
      country: '괌',
      destination,
      applicableTo: `${destination} 가족 숙소 지역 비교 여행자`,
      normalizedValue: '투몬 베이 남쪽 끝·어린이 전용 키즈풀',
      conditions: ['확인일 호텔 가이드 설명', '시설 운영 여부는 예약 전 호텔에 재확인'],
    },
  ];
  const evidence = [...priceEvidence, ...factualEvidence];
  return {
    sources: [
      {
        sourceKey: bookingSourceKey,
        groundingChunkIndex: bookingIndex,
        publisher: 'Booking.com',
        sourceType: 'reputable_price_source',
        claimTypes: ['price', 'factual'],
        country: '괌',
        destination,
      },
      {
        sourceKey: agodaSourceKey,
        groundingChunkIndex: agodaIndex,
        publisher: 'Agoda',
        sourceType: 'reputable_price_source',
        claimTypes: ['factual'],
        country: '괌',
        destination,
      },
    ],
    evidence,
    claims: evidence.map((item) => ({
      claimText: item.excerpt,
      claimType: item.claimType,
      riskLevel: item.riskLevel,
      evidenceKeys: [item.evidenceKey!],
      normalizedValue: item.normalizedValue,
      unit: item.unit,
      currency: item.currency,
    })),
  };
}

export function buildGuamCurrencyPaymentPayload(
  pages: ReviewedDirectPage[],
  destination: string,
): GroundedBlogResearchPayload | null {
  if (!isGuamDestination(destination)) return null;
  const usaGovIndex = reviewedPageIndex(pages, 'www.usa.gov', USA_GOV_CURRENCY_PATH);
  const visitGuamIndex = reviewedPageIndex(
    pages,
    'www.visitguam.com',
    VISIT_GUAM_PAYMENT_PATH,
  );
  if (usaGovIndex < 0 || visitGuamIndex < 0) return null;

  const usaGovText = pages[usaGovIndex]!.text;
  const visitGuamText = pages[visitGuamIndex]!.text;
  if (!/United States dollar is the official currency of the U\.S\. and its territories/i.test(usaGovText)
    || !/seven denominations:\s*\$1,\s*\$2,\s*\$5,\s*\$10,\s*\$20,\s*\$50,\s*and \$100/i.test(usaGovText)
    || !/coin denominations include 1¢,\s*5¢,\s*10¢,\s*25¢,\s*50¢,\s*and \$1/i.test(usaGovText)
    || !/Guam is a U\.S\. territory and uses the U\.S\. dollar\.\s*Major credit cards are accepted\./i.test(visitGuamText)) {
    return null;
  }

  const usaGovSourceKey = 'usa-gov-currency';
  const visitGuamSourceKey = 'visit-guam-payment';
  const evidence: GroundedEvidenceDraft[] = [
    {
      evidenceKey: 'usa-gov-usd-territories',
      sourceKey: usaGovSourceKey,
      excerpt: 'USAGov는 미국 달러가 미국과 미국령의 공식 통화라고 안내한다.',
      sourceLocator: 'American money',
      claimType: 'currency',
      riskLevel: 'MEDIUM',
      country: '미국',
      destination,
      applicableTo: `${destination} 결제·환전 여행자`,
      normalizedValue: 'USD',
      unit: '공식 통화',
      currency: 'USD',
      conditions: ['확인일 기준 미국 정부 안내'],
    },
    {
      evidenceKey: 'usa-gov-paper-denominations',
      sourceKey: usaGovSourceKey,
      excerpt: 'USAGov는 미국 지폐가 $1, $2, $5, $10, $20, $50, $100의 7개 권종이라고 안내한다.',
      sourceLocator: 'Paper money',
      claimType: 'factual',
      riskLevel: 'LOW',
      country: '미국',
      destination,
      applicableTo: `${destination} 현금 사용 여행자`,
      normalizedValue: '7',
      unit: '지폐 권종',
      conditions: ['확인일 기준 미국 정부 안내'],
    },
    {
      evidenceKey: 'usa-gov-coin-denominations',
      sourceKey: usaGovSourceKey,
      excerpt: 'USAGov는 미국 동전 권종에 1¢, 5¢, 10¢, 25¢, 50¢, $1이 포함된다고 안내한다.',
      sourceLocator: 'U.S. coins',
      claimType: 'factual',
      riskLevel: 'LOW',
      country: '미국',
      destination,
      applicableTo: `${destination} 현금 사용 여행자`,
      normalizedValue: '1¢·5¢·10¢·25¢·50¢·$1',
      conditions: ['확인일 기준 미국 정부 안내'],
    },
    {
      evidenceKey: 'visit-guam-major-credit-cards',
      sourceKey: visitGuamSourceKey,
      excerpt: 'Guam Visitors Bureau는 괌에서 미국 달러를 사용하고 주요 신용카드를 받는다고 안내한다.',
      sourceLocator: 'Money',
      claimType: 'factual',
      riskLevel: 'LOW',
      country: '괌',
      destination,
      applicableTo: `${destination} 카드 결제 여행자`,
      normalizedValue: '주요 신용카드 사용 가능',
      conditions: ['가맹점별 카드 수용 여부·해외결제 수수료는 결제 전 재확인'],
    },
  ];
  return {
    sources: [
      {
        sourceKey: usaGovSourceKey,
        groundingChunkIndex: usaGovIndex,
        publisher: 'USAGov',
        sourceType: 'government',
        claimTypes: ['currency', 'factual'],
        country: '미국',
        destination,
      },
      {
        sourceKey: visitGuamSourceKey,
        groundingChunkIndex: visitGuamIndex,
        publisher: 'Guam Visitors Bureau',
        sourceType: 'official_tourism',
        claimTypes: ['factual'],
        country: '괌',
        destination,
      },
    ],
    evidence,
    claims: evidence.map((item) => ({
      claimText: item.excerpt,
      claimType: item.claimType,
      riskLevel: item.riskLevel,
      evidenceKeys: [item.evidenceKey!],
      normalizedValue: item.normalizedValue,
      unit: item.unit,
      currency: item.currency,
    })),
  };
}

export function buildWmoMonthlyWeatherPayload(
  pages: ReviewedDirectPage[],
  destination: string,
): GroundedBlogResearchPayload | null {
  const destinationAliases: Record<string, string[]> = {
    괌: ['괌', '아가냐괌'],
    나트랑: ['나트랑', '냐짱'],
    발리: ['발리', '덴파사르'],
    오키나와: ['오키나와', '나하'],
    호치민: ['호치민', '호찌민시'],
    서안: ['서안', '시안'],
  };
  const normalizePlace = (value: unknown): string => clean(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[,\s-]+/g, '');
  const expectedDestination = normalizePlace(destination);
  const acceptedCityNames = new Set(
    [destination, ...(destinationAliases[destination] ?? [])].map(normalizePlace),
  );
  const candidateIndexes = pages.flatMap((page, index) => {
    try {
      return new URL(page.url).hostname.toLowerCase() === 'worldweather.wmo.int' ? [index] : [];
    } catch {
      return [];
    }
  });
  let pageIndex = -1;
  let document: WmoClimateDocument | null = null;
  for (const candidateIndex of candidateIndexes) {
    try {
      const candidate = JSON.parse(pages[candidateIndex]!.text) as WmoClimateDocument;
      const cityName = normalizePlace(candidate.city?.cityName);
      const cityMatchesDestination = cityName.length > 0
        && (
          acceptedCityNames.has(cityName)
          || cityName.includes(expectedDestination)
          || expectedDestination.includes(cityName)
        );
      if (cityMatchesDestination && Array.isArray(candidate.city?.climate?.climateMonth)) {
        pageIndex = candidateIndex;
        document = candidate;
        break;
      }
    } catch {
      // A reviewed WMO host may also expose an HTML city page before its JSON feed.
    }
  }
  if (pageIndex < 0 || !document) return null;
  const climate = document.city?.climate;
  const months = Array.isArray(climate?.climateMonth)
    ? [...climate.climateMonth].sort((left, right) => Number(left.month) - Number(right.month))
    : [];
  const periodStart = clean(climate?.datab);
  const periodEnd = clean(climate?.datae);
  if (months.length !== 12 || !periodStart || !periodEnd) return null;

  const rows = months.flatMap((month) => {
    const monthNumber = Number(month.month);
    const maxTemp = clean(month.maxTemp);
    const minTemp = clean(month.minTemp);
    const rainfall = clean(month.rainfall);
    const rainDays = clean(month.raindays);
    if (!Number.isInteger(monthNumber)
      || monthNumber < 1
      || monthNumber > 12
      || !maxTemp
      || !minTemp
      || !rainfall
      || !rainDays) {
      return [];
    }
    const statement = `${periodStart}~${periodEnd} 평년값: ${monthNumber}월 최고기온 ${maxTemp}°C, 최저기온 ${minTemp}°C, 강수량 ${rainfall}mm, 강수일수 ${rainDays}일`;
    return [{
      monthNumber,
      maxTemp,
      minTemp,
      rainfall,
      rainDays,
      statement,
    }];
  });
  if (rows.length !== 12 || new Set(rows.map((row) => row.monthNumber)).size !== 12) return null;

  const sourceKeyValue = `wmo-climate-${normalizePlace(destination)}`;
  return {
    sources: [{
      sourceKey: sourceKeyValue,
      groundingChunkIndex: pageIndex,
      publisher: clean(document.city?.member?.orgName) || '세계기상기구 회원 기상기관',
      sourceType: 'meteorological_agency',
      claimTypes: ['climate'],
      country: clean(document.city?.member?.memName) || undefined,
      destination,
    }],
    evidence: rows.map((row) => ({
      evidenceKey: `wmo-month-${row.monthNumber}`,
      sourceKey: sourceKeyValue,
      excerpt: row.statement,
      sourceLocator: `city.climate.climateMonth[month=${row.monthNumber}]`,
      claimType: 'climate',
      riskLevel: 'LOW',
      country: clean(document.city?.member?.memName) || undefined,
      destination,
      applicableTo: `${destination} 여행자`,
      normalizedValue: [row.maxTemp, row.minTemp, row.rainfall, row.rainDays].join('|'),
      unit: '월별 기후 지표',
      conditions: [`${row.monthNumber}월`, `${periodStart}~${periodEnd} 평년값`],
    })),
    claims: rows.map((row) => ({
      claimText: row.statement,
      claimType: 'climate',
      riskLevel: 'LOW',
      evidenceKeys: [`wmo-month-${row.monthNumber}`],
      normalizedValue: [row.maxTemp, row.minTemp, row.rainfall, row.rainDays].join('|'),
      unit: '월별 기후 지표',
    })),
  };
}

function parseJmaClimateRows(text: string): string[][] {
  const pattern = new RegExp(
    `${JMA_CLIMATE_ROW_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*?)`
      + JMA_CLIMATE_ROW_END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g',
  );
  return [...text.matchAll(pattern)].flatMap((match) => {
    try {
      const parsed = JSON.parse(match[1] ?? '') as unknown;
      return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')
        ? [parsed as string[]]
        : [];
    } catch {
      return [];
    }
  });
}

export function buildJmaMonthlyWeatherPayload(
  pages: ReviewedDirectPage[],
  destination: string,
): GroundedBlogResearchPayload | null {
  const stationAliases: Record<string, string[]> = {
    나가사키: ['長崎'],
    시즈오카: ['静岡'],
    유후인: ['湯布院'],
  };
  const normalizePlace = (value: unknown): string => clean(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（）(),\s-]+/g, '');
  const acceptedStations = new Set(
    [destination, ...(stationAliases[destination] ?? [])].map(normalizePlace),
  );
  const parsedPages = pages.flatMap((page, pageIndex) => {
    try {
      const url = new URL(page.url);
      if (url.hostname.toLowerCase() !== 'data.jma.go.jp'
        && !url.hostname.toLowerCase().endsWith('.data.jma.go.jp')
        || !/^\/stats\/etrn\/view\/nml_(?:amd|sfc)_ym\.php$/.test(url.pathname)) {
        return [];
      }
      const station = page.text.match(/^(.+?)[（(][^)）]+[)）]/)?.[1] ?? '';
      if (!acceptedStations.has(normalizePlace(station))) return [];
      const tableRows = parseJmaClimateRows(page.text);
      const period = tableRows
        .find((row) => row[0] === '統計期間')
        ?.find((value) => /^(?:19|20)\d{2}～(?:19|20)\d{2}$/.test(value));
      const periodMatch = period?.match(/^((?:19|20)\d{2})～((?:19|20)\d{2})$/);
      if (!periodMatch) return [];
      const rows = new Map<number, string[]>();
      for (const row of tableRows) {
        const monthMatch = row[0]?.match(/^(\d{1,2})月$/);
        if (!monthMatch) continue;
        const monthNumber = Number(monthMatch[1]);
        if (monthNumber >= 1 && monthNumber <= 12) rows.set(monthNumber, row);
      }
      if (rows.size !== 12) return [];
      return [{
        pageIndex,
        url,
        rows,
        periodStart: periodMatch[1]!,
        periodEnd: periodMatch[2]!,
        isAmedas: url.pathname.includes('nml_amd_ym.php'),
        view: url.searchParams.get('view') ?? '',
      }];
    } catch {
      return [];
    }
  });
  const temperaturePage = parsedPages.find((page) =>
    page.isAmedas ? page.view === '' || page.view === 'p1' : page.view === 'p1s');
  const precipitationPage = parsedPages.find((page) => page.view === 'a1');
  if (!temperaturePage
    || !precipitationPage
    || temperaturePage.periodStart !== precipitationPage.periodStart
    || temperaturePage.periodEnd !== precipitationPage.periodEnd) {
    return null;
  }

  const numericValue = (value: unknown): string | null => {
    const normalized = clean(value).replace(/\s*@$/, '');
    return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
  };
  const rows = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = index + 1;
    const temperatureRow = temperaturePage.rows.get(monthNumber) ?? [];
    const precipitationRow = precipitationPage.rows.get(monthNumber) ?? [];
    const maxTemp = numericValue(temperatureRow[temperaturePage.isAmedas ? 3 : 5]);
    const minTemp = numericValue(temperatureRow[temperaturePage.isAmedas ? 4 : 6]);
    const rainfall = numericValue(precipitationRow[precipitationPage.isAmedas ? 1 : 3]);
    const rainDays = numericValue(precipitationRow[precipitationPage.isAmedas ? 2 : 6]);
    return maxTemp && minTemp && rainfall && rainDays
      ? { monthNumber, maxTemp, minTemp, rainfall, rainDays }
      : null;
  });
  if (rows.some((row) => !row)) return null;

  const period = `${temperaturePage.periodStart}~${temperaturePage.periodEnd}`;
  const destinationKey = normalizePlace(destination);
  const temperatureSourceKey = `jma-temperature-${destinationKey}`;
  const precipitationSourceKey = `jma-precipitation-${destinationKey}`;
  return {
    sources: [
      {
        sourceKey: temperatureSourceKey,
        groundingChunkIndex: temperaturePage.pageIndex,
        publisher: '일본 기상청',
        sourceType: 'meteorological_agency',
        claimTypes: ['climate'],
        country: '일본',
        destination,
      },
      {
        sourceKey: precipitationSourceKey,
        groundingChunkIndex: precipitationPage.pageIndex,
        publisher: '일본 기상청',
        sourceType: 'meteorological_agency',
        claimTypes: ['climate'],
        country: '일본',
        destination,
      },
    ],
    evidence: rows.flatMap((row) => {
      if (!row) return [];
      return [
        {
          evidenceKey: `jma-temperature-month-${row.monthNumber}`,
          sourceKey: temperatureSourceKey,
          excerpt: `${period} 평년값: ${row.monthNumber}월 최고기온 ${row.maxTemp}°C, 최저기온 ${row.minTemp}°C`,
          sourceLocator: `平年値 row ${row.monthNumber}月 temperature`,
          claimType: 'climate',
          riskLevel: 'LOW',
          country: '일본',
          destination,
          applicableTo: `${destination} 여행자`,
          normalizedValue: [row.maxTemp, row.minTemp].join('|'),
          unit: '월별 기온 지표',
          conditions: [`${row.monthNumber}월`, `${period} 평년값`],
        },
        {
          evidenceKey: `jma-precipitation-month-${row.monthNumber}`,
          sourceKey: precipitationSourceKey,
          excerpt: `${period} 평년값: ${row.monthNumber}월 강수량 ${row.rainfall}mm, 강수일수 ${row.rainDays}일`,
          sourceLocator: `平年値 row ${row.monthNumber}月 precipitation`,
          claimType: 'climate',
          riskLevel: 'LOW',
          country: '일본',
          destination,
          applicableTo: `${destination} 여행자`,
          normalizedValue: [row.rainfall, row.rainDays].join('|'),
          unit: '월별 강수 지표',
          conditions: [`${row.monthNumber}월`, `${period} 평년값`, '강수일수는 1.0mm 이상 일수'],
        },
      ];
    }),
    claims: rows.flatMap((row) => {
      if (!row) return [];
      return [{
        claimText: `${period} 평년값: ${row.monthNumber}월 최고기온 ${row.maxTemp}°C, 최저기온 ${row.minTemp}°C, 강수량 ${row.rainfall}mm, 강수일수 ${row.rainDays}일`,
        claimType: 'climate',
        riskLevel: 'LOW',
        evidenceKeys: [
          `jma-temperature-month-${row.monthNumber}`,
          `jma-precipitation-month-${row.monthNumber}`,
        ],
        normalizedValue: [row.maxTemp, row.minTemp, row.rainfall, row.rainDays].join('|'),
        unit: '월별 기후 지표',
      }];
    }),
  };
}

function parseSingaporeClimateRows(text: string): string[][] {
  const pattern = new RegExp(
    `${SINGAPORE_CLIMATE_ROW_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*?)`
      + SINGAPORE_CLIMATE_ROW_END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g',
  );
  return [...text.matchAll(pattern)].flatMap((match) => {
    try {
      const parsed = JSON.parse(match[1] ?? '') as unknown;
      return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')
        ? [parsed as string[]]
        : [];
    } catch {
      return [];
    }
  });
}

export function buildSingaporeMonthlyWeatherPayload(
  pages: ReviewedDirectPage[],
  destination: string,
): GroundedBlogResearchPayload | null {
  if (clean(destination).normalize('NFKC').toLowerCase() !== '싱가포르') return null;

  const pageIndex = pages.findIndex((page) => {
    try {
      const url = new URL(page.url);
      return (url.hostname.toLowerCase() === 'weather.gov.sg'
          || url.hostname.toLowerCase().endsWith('.weather.gov.sg'))
        && url.pathname === '/climate-climate-of-singapore/';
    } catch {
      return false;
    }
  });
  if (pageIndex < 0) return null;

  const sourceText = pages[pageIndex]!.text;
  if (!/Climatological Reference Period:\s*1991\s*-\s*2020/i.test(sourceText)) return null;
  const tableRows = parseSingaporeClimateRows(sourceText);
  const header = tableRows.find((row) =>
    row.slice(-12).map((value) => value.toLowerCase()).join('|')
      === 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec');
  const rainfallRow = tableRows.find((row) =>
    row[0] === 'Rainfall' && row[1] === 'Mean Monthly/ Annual Total (mm)');
  const rainDaysRow = tableRows.find((row) => row[0] === 'Mean Raindays');
  const maxTempRow = tableRows.find((row) =>
    row[0] === 'Temperature (°C)' && row[1] === 'Mean Daily Maximum');
  const minTempRow = tableRows.find((row) => row[0] === 'Mean Daily Minimum');
  if (!header || !rainfallRow || !rainDaysRow || !maxTempRow || !minTempRow) return null;

  const numericValue = (value: unknown): string | null => {
    const normalized = clean(value);
    return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
  };
  const rows = Array.from({ length: 12 }, (_, index) => {
    const rainfall = numericValue(rainfallRow[index + 2]);
    const rainDays = numericValue(rainDaysRow[index + 1]);
    const maxTemp = numericValue(maxTempRow[index + 2]);
    const minTemp = numericValue(minTempRow[index + 1]);
    return rainfall && rainDays && maxTemp && minTemp
      ? {
          monthNumber: index + 1,
          rainfall,
          rainDays,
          maxTemp,
          minTemp,
        }
      : null;
  });
  if (rows.some((row) => !row)) return null;

  const sourceKeyValue = 'mss-climate-singapore';
  const period = '1991~2020';
  return {
    sources: [{
      sourceKey: sourceKeyValue,
      groundingChunkIndex: pageIndex,
      publisher: 'Meteorological Service Singapore',
      sourceType: 'meteorological_agency',
      claimTypes: ['climate'],
      country: '싱가포르',
      destination,
    }],
    evidence: rows.flatMap((row) => {
      if (!row) return [];
      const statement = `${period} 평년값: ${row.monthNumber}월 최고기온 ${row.maxTemp}°C, 최저기온 ${row.minTemp}°C, 강수량 ${row.rainfall}mm, 강수일수 ${row.rainDays}일`;
      return [{
        evidenceKey: `mss-month-${row.monthNumber}`,
        sourceKey: sourceKeyValue,
        excerpt: statement,
        sourceLocator: `Records of Climate Station Means row ${row.monthNumber}월`,
        claimType: 'climate',
        riskLevel: 'LOW',
        country: '싱가포르',
        destination,
        applicableTo: `${destination} 여행자`,
        normalizedValue: [row.maxTemp, row.minTemp, row.rainfall, row.rainDays].join('|'),
        unit: '월별 기후 지표',
        conditions: [`${row.monthNumber}월`, `${period} Changi Climate Station 평년값`],
      }];
    }),
    claims: rows.flatMap((row) => {
      if (!row) return [];
      return [{
        claimText: `${period} 평년값: ${row.monthNumber}월 최고기온 ${row.maxTemp}°C, 최저기온 ${row.minTemp}°C, 강수량 ${row.rainfall}mm, 강수일수 ${row.rainDays}일`,
        claimType: 'climate',
        riskLevel: 'LOW',
        evidenceKeys: [`mss-month-${row.monthNumber}`],
        normalizedValue: [row.maxTemp, row.minTemp, row.rainfall, row.rainDays].join('|'),
        unit: '월별 기후 지표',
      }];
    }),
  };
}

const PAGASA_MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

export function buildPagasaMonthlyWeatherPayload(
  pages: ReviewedDirectPage[],
  destination: string,
): GroundedBlogResearchPayload | null {
  const stationAliases: Record<string, string[]> = {
    세부: ['세부', 'cebu', 'mactan'],
    보홀: ['보홀', 'bohol', 'tagbilaran', 'dauis'],
    마닐라: ['마닐라', 'manila', 'naia', 'ninoy aquino'],
    클락: ['클락', 'clark', 'clark international airport'],
  };
  const normalizePlace = (value: unknown): string => clean(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[,\s-]+/g, '');
  const expectedAliases = new Set(
    [destination, ...(stationAliases[destination] ?? [])].map(normalizePlace),
  );
  const pageIndex = pages.findIndex((page) => {
    try {
      const url = new URL(page.url);
      if (!url.hostname.toLowerCase().endsWith('pagasa.dost.gov.ph')
        || !url.pathname.toLowerCase().endsWith('.pdf')) {
        return false;
      }
      const station = page.text.match(/STATION:\s*([^\r\n]+)/i)?.[1] ?? '';
      const normalizedStation = normalizePlace(station);
      return normalizedStation.length > 0
        && [...expectedAliases].some((alias) =>
          alias.length > 0
          && (normalizedStation.includes(alias) || alias.includes(normalizedStation)));
    } catch {
      return false;
    }
  });
  if (pageIndex < 0) return null;

  const page = pages[pageIndex]!;
  const periodMatch = page.text.match(
    /PERIOD:\s*((?:19|20)\d{2})\s*-\s*(?:(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+)?((?:19|20)\d{2})/i,
  );
  const periodStart = periodMatch?.[1] ?? '';
  const periodEnd = periodMatch?.[2] ?? '';
  if (!periodStart || !periodEnd) return null;

  const rows = [...page.text.matchAll(
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{1,3}\.\d)(\d{1,2})(\d{2}\.\d)(\d{2}\.\d)(\d{2}\.\d)/g,
  )].flatMap((match) => {
    const monthNumber = PAGASA_MONTHS.indexOf(match[1] as typeof PAGASA_MONTHS[number]) + 1;
    const rainfall = match[2]!;
    const rainDays = match[3]!;
    const maxTemp = match[4]!;
    const minTemp = match[5]!;
    const statement = `${periodStart}~${periodEnd} 평년값: ${monthNumber}월 최고기온 ${maxTemp}°C, 최저기온 ${minTemp}°C, 강수량 ${rainfall}mm, 강수일수 ${rainDays}일`;
    return [{
      monthNumber,
      rainfall,
      rainDays,
      maxTemp,
      minTemp,
      statement,
    }];
  });
  if (rows.length !== 12 || new Set(rows.map((row) => row.monthNumber)).size !== 12) return null;

  const sourceKeyValue = `pagasa-climate-${normalizePlace(destination)}`;
  return {
    sources: [{
      sourceKey: sourceKeyValue,
      groundingChunkIndex: pageIndex,
      publisher: 'PAGASA',
      sourceType: 'meteorological_agency',
      claimTypes: ['climate'],
      country: '필리핀',
      destination,
    }],
    evidence: rows.map((row) => ({
      evidenceKey: `pagasa-month-${row.monthNumber}`,
      sourceKey: sourceKeyValue,
      excerpt: row.statement,
      sourceLocator: `CLIMATOLOGICAL NORMALS row ${PAGASA_MONTHS[row.monthNumber - 1]}`,
      claimType: 'climate',
      riskLevel: 'LOW',
      country: '필리핀',
      destination,
      applicableTo: `${destination} 여행자`,
      normalizedValue: [row.maxTemp, row.minTemp, row.rainfall, row.rainDays].join('|'),
      unit: '월별 기후 지표',
      conditions: [`${row.monthNumber}월`, `${periodStart}~${periodEnd} 평년값`],
    })),
    claims: rows.map((row) => ({
      claimText: row.statement,
      claimType: 'climate',
      riskLevel: 'LOW',
      evidenceKeys: [`pagasa-month-${row.monthNumber}`],
      normalizedValue: [row.maxTemp, row.minTemp, row.rainfall, row.rainDays].join('|'),
      unit: '월별 기후 지표',
    })),
  };
}

function minutesBetweenScheduleTimes(start: string, end: string): number | null {
  const parse = (value: string): number | null => {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || hours > 23 || !Number.isInteger(minutes) || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  };
  const startMinutes = parse(start);
  const endMinutes = parse(end);
  if (startMinutes === null || endMinutes === null) return null;
  const difference = endMinutes - startMinutes;
  return difference >= 0 ? difference : difference + 24 * 60;
}

export function augmentGrtaAirportTransportPayload(
  pages: ReviewedDirectPage[],
  destination: string,
  payload: GroundedBlogResearchPayload,
): GroundedBlogResearchPayload {
  const normalizedDestination = clean(destination).normalize('NFKC').toLowerCase();
  if (normalizedDestination !== '괌' && normalizedDestination !== 'guam') return payload;

  const pageIndex = pages.findIndex((page) => {
    try {
      const url = new URL(page.url);
      return url.hostname.toLowerCase() === 'grta.guam.gov'
        && url.pathname === GRTA_FIXED_ROUTE_SCHEDULE_PATH;
    } catch {
      return false;
    }
  });
  if (pageIndex < 0) return payload;

  const scheduleText = pages[pageIndex]!.text;
  if (!/GIAA Departures,\s*Airport/i.test(scheduleText)
    || !/Kmart/i.test(scheduleText)
    || !/GTA Upper Tumon/i.test(scheduleText)) {
    return payload;
  }

  // pdf-parse flattens the stop ordinals and time columns. Require the exact
  // reviewed first-run sequence before calculating either elapsed duration.
  const compactSchedule = scheduleText.replace(/\s+/g, '');
  const firstRun = compactSchedule.match(/8(5:55)[\s\S]{0,800}?9(6:00)[\s\S]{0,800}?10(6:03)/);
  if (!firstRun) return payload;
  const airportTime = firstRun[1]!;
  const kmartTime = firstRun[2]!;
  const upperTumonTime = firstRun[3]!;
  const kmartMinutes = minutesBetweenScheduleTimes(airportTime, kmartTime);
  const upperTumonMinutes = minutesBetweenScheduleTimes(airportTime, upperTumonTime);
  if (kmartMinutes !== 5 || upperTumonMinutes !== 8) return payload;

  const deterministicSourceKey = 'grta-fixed-route-schedule';
  const sourceDrafts = [...(payload.sources ?? [])];
  const matchingSourceIndex = sourceDrafts.findIndex(
    (source) => Number(source.groundingChunkIndex) === pageIndex,
  );
  const matchingSource = matchingSourceIndex >= 0
    ? sourceDrafts.splice(matchingSourceIndex, 1)[0]
    : null;
  const grtaFarePageIndex = pages.findIndex((page) => {
    try {
      const url = new URL(page.url);
      return url.hostname.toLowerCase() === 'grta.guam.gov'
        && url.pathname === GRTA_FARE_RATE_PATH;
    } catch {
      return false;
    }
  });
  const grtaFareSourceIndex = sourceDrafts.findIndex(
    (source) => Number(source.groundingChunkIndex) === grtaFarePageIndex,
  );
  const matchingFareSource = grtaFareSourceIndex >= 0
    ? sourceDrafts.splice(grtaFareSourceIndex, 1)[0]
    : null;
  const grtaFareSourceKey = clean(matchingFareSource?.sourceKey) || 'grta-fare-sheet';
  const fareText = grtaFarePageIndex >= 0 ? pages[grtaFarePageIndex]!.text : '';
  const hasReviewedRegularFares = /REGULAR FARE PASSES\s*One Ride\s*=\s*\$\s*1\.50\s*One Day Pass\s*=\s*\$\s*4\.00/i
    .test(fareText.replace(/\s+/g, ' '));
  const sourceKeyValue = clean(matchingSource?.sourceKey) || deterministicSourceKey;
  const scheduleSource: GroundedSourceDraft = {
    ...matchingSource,
    sourceKey: sourceKeyValue,
    groundingChunkIndex: pageIndex,
    publisher: clean(matchingSource?.publisher) || 'Guam Regional Transit Authority',
    sourceType: 'transport_operator',
    claimTypes: [...new Set([
      ...normalizeList(matchingSource?.claimTypes),
      'duration',
    ])],
    country: clean(matchingSource?.country) || '괌',
    destination,
  };

  const rows = [
    {
      evidenceKey: 'grta-giaa-kmart-duration',
      destinationLabel: 'Kmart',
      endTime: kmartTime,
      minutes: kmartMinutes,
      stopOrdinal: 9,
    },
    {
      evidenceKey: 'grta-giaa-upper-tumon-duration',
      destinationLabel: 'GTA Upper Tumon',
      endTime: upperTumonTime,
      minutes: upperTumonMinutes,
      stopOrdinal: 10,
    },
  ];
  const deterministicEvidence: GroundedEvidenceDraft[] = rows.map((row) => ({
    evidenceKey: row.evidenceKey,
    sourceKey: sourceKeyValue,
    excerpt: `GRTA Route 14 첫 운행 시간표에서 GIAA(공항) ${airportTime} 출발, ${row.destinationLabel} ${row.endTime} 도착으로 ${row.minutes}분이 소요된다.`,
    sourceLocator: `Route 14 first run, stop 8 to stop ${row.stopOrdinal}`,
    claimType: 'duration',
    riskLevel: 'MEDIUM',
    country: '괌',
    destination,
    applicableTo: `${destination} 공항 대중교통 이용자`,
    normalizedValue: String(row.minutes),
    unit: '분',
    conditions: ['GRTA Route 14 첫 운행 시간표', '2025-11-26 게시본', '운행 전 최신 시간표 재확인'],
  }));
  const deterministicClaims: GroundedClaimDraft[] = rows.map((row) => ({
    claimText: `GRTA Route 14 첫 운행 기준 괌 공항에서 ${row.destinationLabel}까지 ${row.minutes}분이다.`,
    claimType: 'duration',
    riskLevel: 'MEDIUM',
    evidenceKeys: [row.evidenceKey],
    normalizedValue: String(row.minutes),
    unit: '분',
  }));
  const deterministicFareEvidence: GroundedEvidenceDraft[] = hasReviewedRegularFares
    ? [
        {
          evidenceKey: 'grta-regular-one-ride-fare',
          sourceKey: grtaFareSourceKey,
          excerpt: 'GRTA 공식 요금표의 일반 1회 탑승 요금은 1.50 USD이다.',
          sourceLocator: 'REGULAR FARE PASSES > One Ride',
          claimType: 'price',
          riskLevel: 'MEDIUM',
          country: '괌',
          destination,
          applicableTo: `${destination} 대중교통 이용 여행자`,
          normalizedValue: '1.50',
          unit: '1회 탑승',
          currency: 'USD',
          conditions: ['공식 GRTA 확인일 요금', '탑승 전 최신 요금표 재확인'],
        },
        {
          evidenceKey: 'grta-regular-one-day-pass-fare',
          sourceKey: grtaFareSourceKey,
          excerpt: 'GRTA 공식 요금표의 일반 1일권 요금은 4.00 USD이다.',
          sourceLocator: 'REGULAR FARE PASSES > One Day Pass',
          claimType: 'price',
          riskLevel: 'MEDIUM',
          country: '괌',
          destination,
          applicableTo: `${destination} 대중교통 이용 여행자`,
          normalizedValue: '4.00',
          unit: '1일권',
          currency: 'USD',
          conditions: ['공식 GRTA 확인일 요금', '구매 전 최신 요금표 재확인'],
        },
      ]
    : [];
  const deterministicFareClaims: GroundedClaimDraft[] = deterministicFareEvidence.map((item) => ({
    claimText: item.excerpt,
    claimType: 'price',
    riskLevel: 'MEDIUM',
    evidenceKeys: [item.evidenceKey!],
    normalizedValue: item.normalizedValue,
    unit: item.unit,
    currency: item.currency,
  }));
  const deterministicEvidenceKeys = new Set([
    ...rows.map((row) => row.evidenceKey),
    ...deterministicFareEvidence.map((item) => item.evidenceKey!),
  ]);
  const competingTransitFarePattern = /(?:버스|대중교통|현지\s*교통편|bus|일일권|1일권|월간권|월간\s*(?:대중교통\s*)?정기권|정기권|편도\s*티켓|하루\s*이용권|승차당|one\s*day\s*pass|one\s*ride|monthly\s*pass|one-way\s*ticket)/i;
  const originalEvidence = (payload.evidence ?? [])
    .filter((evidence) =>
      !deterministicEvidenceKeys.has(clean(evidence.evidenceKey))
      && Boolean(toClaimType(evidence.claimType))
      && !(
        grtaFarePageIndex >= 0
        && toClaimType(evidence.claimType) === 'price'
        && (hasReviewedRegularFares || clean(evidence.sourceKey) !== grtaFareSourceKey)
        && competingTransitFarePattern.test(clean(evidence.excerpt))
        && !/(?:택시|taxi|수족관|언더워터|aquarium)/i.test(clean(evidence.excerpt))
      ));
  const originalEvidenceByKey = new Map(
    originalEvidence.map((evidence) => [clean(evidence.evidenceKey), evidence]),
  );
  const originalClaims = (payload.claims ?? [])
    .flatMap((claim) => {
      const claimType = toClaimType(claim.claimType);
      if (!claimType
        || (claim.evidenceKeys ?? []).some((key) => deterministicEvidenceKeys.has(clean(key)))) {
        return [];
      }
      if (grtaFarePageIndex >= 0
        && claimType === 'price'
        && competingTransitFarePattern.test(clean(claim.claimText))
        && !/(?:택시|taxi|수족관|언더워터|aquarium)/i.test(clean(claim.claimText))
        && (
          hasReviewedRegularFares
          || !normalizeList(claim.evidenceKeys).some(
            (key) => clean(originalEvidenceByKey.get(key)?.sourceKey) === grtaFareSourceKey,
          )
        )) {
        return [];
      }
      const draftedValue = clean(claim.normalizedValue);
      const compatibleEvidenceKeys = normalizeList(claim.evidenceKeys).filter((key) => {
        const evidence = originalEvidenceByKey.get(key);
        return Boolean(
          evidence
          && toClaimType(evidence.claimType) === claimType
          && (!draftedValue
            || (
              comparableValue(evidence.normalizedValue) === comparableValue(draftedValue)
              && (!clean(claim.unit) || comparableValue(evidence.unit) === comparableValue(claim.unit))
              && (!clean(claim.currency) || comparableValue(evidence.currency) === comparableValue(claim.currency))
            )),
        );
      });
      return compatibleEvidenceKeys.length > 0
        ? [{ ...claim, evidenceKeys: compatibleEvidenceKeys }]
        : [];
    })
    .sort((left, right) => Number(right.claimType === 'price') - Number(left.claimType === 'price'));
  const selectedOriginalClaims: GroundedClaimDraft[] = [];
  const selectedEvidenceKeys = new Set<string>();
  const deterministicClaimsWithFares = [...deterministicClaims, ...deterministicFareClaims];
  for (const claim of originalClaims) {
    const evidenceKeys = normalizeList(claim.evidenceKeys);
    const additionalEvidenceCount = evidenceKeys.filter((key) => !selectedEvidenceKeys.has(key)).length;
    if (selectedOriginalClaims.length >= MAX_RESEARCH_CLAIMS - deterministicClaimsWithFares.length) break;
    if (selectedEvidenceKeys.size + additionalEvidenceCount
      > MAX_RESEARCH_EVIDENCE - deterministicEvidence.length - deterministicFareEvidence.length) {
      continue;
    }
    evidenceKeys.forEach((key) => selectedEvidenceKeys.add(key));
    selectedOriginalClaims.push(claim);
  }
  const selectedClaims = [...deterministicClaimsWithFares, ...selectedOriginalClaims];
  const selectedEvidence = [
    ...deterministicEvidence,
    ...deterministicFareEvidence,
    ...originalEvidence.filter((evidence) => selectedEvidenceKeys.has(clean(evidence.evidenceKey))),
  ];
  const fareSource: GroundedSourceDraft | null = hasReviewedRegularFares
    ? {
        ...matchingFareSource,
        sourceKey: grtaFareSourceKey,
        groundingChunkIndex: grtaFarePageIndex,
        publisher: clean(matchingFareSource?.publisher) || 'Guam Regional Transit Authority',
        sourceType: 'transport_operator',
        claimTypes: ['price'],
        country: clean(matchingFareSource?.country) || '괌',
        destination,
      }
    : null;

  return {
    ...payload,
    sources: [scheduleSource, ...(fareSource ? [fareSource] : []), ...sourceDrafts]
      .slice(0, MAX_GROUNDING_SOURCES),
    evidence: selectedEvidence,
    claims: selectedClaims,
  };
}

export function augmentGuamShoppingPayload(
  pages: ReviewedDirectPage[],
  destination: string,
  payload: GroundedBlogResearchPayload,
): GroundedBlogResearchPayload {
  const normalizedDestination = clean(destination).normalize('NFKC').toLowerCase();
  if (normalizedDestination !== '괌' && normalizedDestination !== 'guam') return payload;

  const pageIndex = pages.findIndex((page) => {
    try {
      const url = new URL(page.url);
      return url.hostname.toLowerCase() === 'www.visitguam.com'
        && url.pathname === VISIT_GUAM_SOUVENIR_PATH;
    } catch {
      return false;
    }
  });
  if (pageIndex < 0) return payload;

  const pageText = pages[pageIndex]!.text.replace(/\s+/g, ' ');
  if (!/official Made in Guam product seal/i.test(pageText)
    || !/Chamorro Village/i.test(pageText)
    || !/Guam Art Boutique/i.test(pageText)
    || !/jewelry,\s*soaps,\s*coconut oils,\s*books/i.test(pageText)) {
    return payload;
  }

  const sourceDrafts = [...(payload.sources ?? [])];
  const matchingSourceIndex = sourceDrafts.findIndex(
    (source) => Number(source.groundingChunkIndex) === pageIndex,
  );
  const matchingSource = matchingSourceIndex >= 0
    ? sourceDrafts.splice(matchingSourceIndex, 1)[0]
    : null;
  const sourceKey = clean(matchingSource?.sourceKey) || 'visit-guam-made-in-guam-souvenirs';
  const officialSource: GroundedSourceDraft = {
    ...matchingSource,
    sourceKey,
    groundingChunkIndex: pageIndex,
    publisher: clean(matchingSource?.publisher) || 'Guam Visitors Bureau',
    sourceType: 'official_tourism',
    claimTypes: [...new Set([...normalizeList(matchingSource?.claimTypes), 'factual'])],
    country: clean(matchingSource?.country) || '괌',
    destination,
  };
  const deterministicEvidence: GroundedEvidenceDraft[] = [
    {
      evidenceKey: 'visit-guam-official-product-seal',
      sourceKey,
      excerpt: 'Guam Visitors Bureau says the government-issued official Made in Guam product seal certifies that an item or product is made in Guam.',
      sourceLocator: 'Authentic Made in Guam Souvenirs > introduction',
      claimType: 'factual',
      riskLevel: 'LOW',
      country: '괌',
      destination,
      applicableTo: `${destination} 기념품 구매 여행자`,
      normalizedValue: 'official Made in Guam product seal',
      conditions: ['제품 포장의 공식 인증 마크 확인'],
    },
    {
      evidenceKey: 'visit-guam-chamorro-village-products',
      sourceKey,
      excerpt: 'Guam Visitors Bureau lists Guam Art Boutique in Chamorro Village and describes locally crafted jewelry, soaps, coconut oils, books, hand-woven accessories, gifts, and souvenirs.',
      sourceLocator: 'Authentic Made in Guam Souvenirs > Chamorro Village',
      claimType: 'factual',
      riskLevel: 'LOW',
      country: '괌',
      destination,
      applicableTo: `${destination} 기념품 구매 여행자`,
      normalizedValue: 'Chamorro Village Guam Art Boutique local souvenirs',
      conditions: ['방문 전 현재 영업 여부와 재고 확인'],
    },
  ];
  const deterministicClaims: GroundedClaimDraft[] = [
    {
      claimText: '괌정부관광청은 공식 Made in Guam 제품 인증 마크가 괌에서 만들어진 상품임을 인증한다고 안내한다.',
      claimType: 'factual',
      riskLevel: 'LOW',
      evidenceKeys: ['visit-guam-official-product-seal'],
      normalizedValue: 'official Made in Guam product seal',
    },
    {
      claimText: '괌정부관광청은 하갓냐 Chamorro Village의 Guam Art Boutique에서 주얼리, 비누, 코코넛 오일, 책, 수공예 액세서리 등 현지 제작 기념품을 찾을 수 있다고 안내한다.',
      claimType: 'factual',
      riskLevel: 'LOW',
      evidenceKeys: ['visit-guam-chamorro-village-products'],
      normalizedValue: 'Chamorro Village Guam Art Boutique local souvenirs',
    },
  ];
  const duplicatePattern = /Made in Guam.{0,80}(?:seal|인증)|Chamorro Village|Guam Art Boutique/i;
  const originalEvidence = (payload.evidence ?? []).filter(
    (evidence) => !duplicatePattern.test(clean(evidence.excerpt)),
  );
  const originalClaims = (payload.claims ?? []).filter(
    (claim) => !duplicatePattern.test(clean(claim.claimText)),
  );

  return {
    ...payload,
    sources: [officialSource, ...sourceDrafts].slice(0, MAX_GROUNDING_SOURCES),
    evidence: [...deterministicEvidence, ...originalEvidence].slice(0, MAX_RESEARCH_EVIDENCE),
    claims: [...deterministicClaims, ...originalClaims].slice(0, MAX_RESEARCH_CLAIMS),
  };
}

async function loadOfficialRegistry(
  intent: string,
  destination: string,
): Promise<BlogInformationOfficialSourceRegistryEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_information_official_source_registry')
    .select('id, hostname, source_type, authority_level, allow_subdomains')
    .eq('status', 'active');
  if (error) throw new Error(`blog_auto_research_registry:${error.message}`);
  const { data: documentRows, error: documentError } = await supabaseAdmin
    .from('blog_information_official_research_documents')
    .select('official_source_registry_id, source_url, intents, destinations')
    .eq('status', 'active')
    .contains('intents', [intent]);
  if (documentError) throw new Error(`blog_auto_research_documents:${documentError.message}`);
  const urlsByRegistryId = new Map<string, string[]>();
  for (const row of documentRows ?? []) {
    if (!matchesBlogResearchDestinationScope({
      destination,
      scopes: row.destinations,
    })) {
      continue;
    }
    const registryId = String(row.official_source_registry_id);
    urlsByRegistryId.set(registryId, [
      ...(urlsByRegistryId.get(registryId) ?? []),
      String(row.source_url),
    ]);
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    hostname: String(row.hostname),
    sourceType: row.source_type,
    authorityLevel: row.authority_level,
    allowSubdomains: Boolean(row.allow_subdomains),
    researchUrls: urlsByRegistryId.get(String(row.id)) ?? [],
  })) as BlogInformationOfficialSourceRegistryEntry[];
}

async function loadReputableRegistry(): Promise<BlogInformationReputableSourceRegistryEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_information_reputable_source_registry')
    .select('id, hostname, source_types, intents, allow_subdomains, review_note, research_urls, research_destinations')
    .eq('status', 'active');
  if (error) throw new Error(`blog_auto_research_reputable_registry:${error.message}`);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    hostname: String(row.hostname),
    sourceTypes: Array.isArray(row.source_types) ? row.source_types : [],
    intents: Array.isArray(row.intents) ? row.intents.map(String) : [],
    allowSubdomains: Boolean(row.allow_subdomains),
    reviewNote: clean(row.review_note) || null,
    researchUrls: Array.isArray(row.research_urls) ? row.research_urls.map(String) : [],
    researchDestinations: Array.isArray(row.research_destinations)
      ? row.research_destinations.map(String)
      : [],
  })) as BlogInformationReputableSourceRegistryEntry[];
}

export function selectReputableResearchRegistryForIntent(
  registry: BlogInformationReputableSourceRegistryEntry[],
  intent: string,
  destination: string,
): BlogInformationReputableSourceRegistryEntry[] {
  const destinationKey = clean(destination);
  return registry.filter((entry) => {
    const destinations = entry.researchDestinations?.map(clean).filter(Boolean) ?? [];
    return entry.intents.includes(intent)
      && (entry.researchUrls?.length ?? 0) > 0
      && (destinations.length === 0 || destinations.includes(destinationKey));
  });
}

function allowedPersistedSourceTypes(sourceTypes: string[]): BlogInformationSourceType[] {
  const values = new Set<BlogInformationSourceType>();
  for (const sourceType of sourceTypes) {
    const normalized = toSourceType(sourceType, sourceTypes);
    if (normalized) values.add(normalized);
  }
  for (const sourceType of BLOG_INFORMATION_SOURCE_TYPES) {
    const normalized = toSourceType(sourceType, sourceTypes);
    if (normalized) values.add(normalized);
  }
  return [...values];
}

function geminiClient(): GoogleGenAI {
  const apiKey = getProviderApiKey('gemini');
  if (!apiKey) throw new Error('BLOG_RESEARCH_REQUIRES_GOOGLE_AI_API_KEY');
  if (cachedGeminiClient && cachedGeminiKey === apiKey) return cachedGeminiClient;
  cachedGeminiKey = apiKey;
  cachedGeminiClient = new GoogleGenAI({ apiKey });
  return cachedGeminiClient;
}

export async function researchBlogInformationAutomatically(input: {
  contentKey: string;
  destination: string;
  locale: string;
  brief: BlogContentBrief;
  now?: Date;
}): Promise<BlogAutoResearchResult> {
  const now = input.now ?? new Date();
  let searchQueries: string[] = [];
  let groundingSourceCount = 0;
  let directSourceCount = 0;
  let directSourceFailures: string[] = [];
  let finishReason: string | null = null;
  let responseTextLength = 0;
  const deadline = Date.now() + AUTO_RESEARCH_TIMEOUT_MS;
  const remainingTimeout = (): number => {
    const remaining = deadline - Date.now();
    if (remaining < 5_000) throw new Error('BLOG_RESEARCH_TIMEOUT_BEFORE_STRUCTURING');
    return remaining;
  };
  try {
    const registry = await loadOfficialRegistry(input.brief.intentType, input.destination);
    const reputableRegistry = await loadReputableRegistry();
    const allowedSourceTypes = allowedPersistedSourceTypes(input.brief.sourcePolicy.sourceTypes);
    const reviewedRegistry = registry.filter((entry) => allowedSourceTypes.includes(entry.sourceType));
    const reviewedReputableRegistry = reputableRegistry.filter((entry) =>
      entry.intents.includes(input.brief.intentType)
      && entry.sourceTypes.some((sourceType) => allowedSourceTypes.includes(sourceType)));
    const directlyReviewedReputableRegistry = selectReputableResearchRegistryForIntent(
      reviewedReputableRegistry,
      input.brief.intentType,
      input.destination,
    );
    const reviewedSources = [
      ...reviewedRegistry.map((entry) => `${entry.hostname} (${entry.sourceType})`),
      ...reviewedReputableRegistry.flatMap((entry) =>
        entry.sourceTypes
          .filter((sourceType) => allowedSourceTypes.includes(sourceType))
          .map((sourceType) => `${entry.hostname} (${sourceType}; ${entry.reviewNote ?? 'reviewed editorial source'})`)),
    ];
    const [officialDirectResult, reputableDirectResult] = await Promise.all([
      fetchReviewedDirectPages(reviewedRegistry),
      fetchReviewedDirectPages(directlyReviewedReputableRegistry),
    ]);
    const directResult = {
      pages: [...officialDirectResult.pages, ...reputableDirectResult.pages],
      failures: [...officialDirectResult.failures, ...reputableDirectResult.failures],
    };
    directSourceFailures = directResult.failures;
    const canUseReviewedPagesOnly = input.brief.sourcePolicy.primarySourcesRequired
      && officialDirectResult.pages.length > 0;
    let trustedSearchPages: ReviewedDirectPage[] = [];
    if (!canUseReviewedPagesOnly) {
      const groundedResponse = await geminiClient().models.generateContent({
        model: AUTO_RESEARCH_MODEL,
        contents: buildBlogGroundingResearchPrompt({ ...input, reviewedSources, now }),
        config: {
          temperature: 0.1,
          maxOutputTokens: 4_096,
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: AbortSignal.timeout(remainingTimeout()),
          httpOptions: { timeout: remainingTimeout() },
          tools: [{ googleSearch: {} }],
        },
      });
      const metadata = groundedResponse.candidates?.[0]?.groundingMetadata;
      searchQueries = metadata?.webSearchQueries ?? [];
      const resolvedSearchChunks = await resolveGroundingRedirects(metadata?.groundingChunks ?? []);
      const trustedSearchResult = await fetchTrustedSearchPages({
        chunks: groundedWebChunks(resolvedSearchChunks),
        officialRegistry: reviewedRegistry,
        reputableRegistry: reviewedReputableRegistry,
        allowedSourceTypes,
        intent: input.brief.intentType,
      });
      trustedSearchPages = trustedSearchResult.pages;
      directSourceFailures = [...directSourceFailures, ...trustedSearchResult.failures];
    }
    const reviewedPages = [...directResult.pages, ...trustedSearchPages]
      .filter((page, index, all) => all.findIndex((candidate) => candidate.url === page.url) === index)
      .slice(0, MAX_SOURCE_CATALOG);
    directSourceCount = reviewedPages.length;
    const groundingChunks: GroundingChunk[] = reviewedPages.map((page) => ({
      web: {
        uri: page.url,
        title: page.title,
      },
    }));
    const webChunks = groundedWebChunks(groundingChunks);
    groundingSourceCount = webChunks.length;
    const groundedDigest = [
      'REVIEWED_PAGE_EXTRACTS:',
      ...reviewedPages.map((page, index) => [
        `[groundingChunkIndex=${index}] ${page.title}`,
        `URL: ${page.url}`,
        page.text,
      ].join('\n')),
    ].filter(Boolean).join('\n');
    const eligibleWebChunks = webChunks;
    if (!groundedDigest || eligibleWebChunks.length === 0) {
      throw new Error('BLOG_RESEARCH_GROUNDING_EMPTY');
    }
    let payload = input.brief.intentType === 'monthly_weather'
      ? buildWmoMonthlyWeatherPayload(reviewedPages, input.destination)
        ?? buildJmaMonthlyWeatherPayload(reviewedPages, input.destination)
        ?? buildSingaporeMonthlyWeatherPayload(reviewedPages, input.destination)
        ?? buildPagasaMonthlyWeatherPayload(reviewedPages, input.destination)
      : input.brief.intentType === 'hotel_areas'
        ? buildGuamHotelAreasPayload(reviewedPages, input.destination)
        : input.brief.intentType === 'currency_payment'
          ? buildGuamCurrencyPaymentPayload(reviewedPages, input.destination)
          : null;
    if (payload) {
      finishReason = input.brief.intentType === 'monthly_weather'
        ? 'DETERMINISTIC_OFFICIAL_CLIMATE'
        : input.brief.intentType === 'hotel_areas'
          ? 'DETERMINISTIC_GUAM_HOTEL_AREAS'
          : 'DETERMINISTIC_GUAM_CURRENCY_PAYMENT';
      responseTextLength = JSON.stringify(payload).length;
    } else {
      const sourceCatalog = eligibleWebChunks
        .slice(0, MAX_SOURCE_CATALOG)
        .map((chunk) => ({
          groundingChunkIndex: chunk.chunkIndex,
          title: chunk.title,
          uri: chunk.uri,
          reviewedSourceTypes: allowedSourceTypes.filter((sourceType) =>
            Boolean(resolveBlogInformationOfficialSourceTrust({
              sourceUrl: chunk.uri,
              sourceType,
              registry,
            }))
            || Boolean(resolveReputableSourceTrust({
              sourceUrl: chunk.uri,
              sourceType,
              intent: input.brief.intentType,
              registry: reputableRegistry,
            }))),
        }));
      const generateStructuredResponse = async (
        retry = false,
        retryIssues: string[] = [],
      ) => geminiClient().models.generateContent({
        model: AUTO_RESEARCH_MODEL,
        contents: buildBlogStructuredResearchPrompt({
          ...input,
          digest: groundedDigest,
          sourceCatalog,
          now,
          retry,
          retryIssues,
        }),
        config: {
          temperature: 0,
          maxOutputTokens: 16_384,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseJsonSchema: COMPACT_RESEARCH_SCHEMA,
          abortSignal: AbortSignal.timeout(remainingTimeout()),
          httpOptions: { timeout: remainingTimeout() },
        },
      });
      let structuredResponse = await generateStructuredResponse();
      finishReason = structuredResponse.candidates?.[0]?.finishReason
        ? String(structuredResponse.candidates[0].finishReason)
        : null;
      let rawText = structuredResponse.text ?? '';
      responseTextLength = rawText.length;
      try {
        payload = parseJsonPayload(rawText);
      } catch (error) {
        if (reviewedPages.length === 0 || remainingTimeout() <= 15_000) throw error;
        structuredResponse = await generateStructuredResponse(true, [
          `invalid_or_truncated_json:${error instanceof Error ? error.message : String(error)}`,
        ]);
        finishReason = structuredResponse.candidates?.[0]?.finishReason
          ? String(structuredResponse.candidates[0].finishReason)
          : finishReason;
        rawText = structuredResponse.text ?? '';
        responseTextLength += rawText.length;
        payload = parseJsonPayload(rawText);
      }
      if (!payloadHasResearchItems(payload) && reviewedPages.length > 0 && remainingTimeout() > 15_000) {
        structuredResponse = await generateStructuredResponse(true, ['empty_research_payload']);
        finishReason = structuredResponse.candidates?.[0]?.finishReason
          ? String(structuredResponse.candidates[0].finishReason)
          : finishReason;
        rawText = structuredResponse.text ?? '';
        responseTextLength += rawText.length;
        payload = parseJsonPayload(rawText);
      }
      payload = sanitizeGroundedResearchPayload(payload, input.brief.intentType);
      if (input.brief.intentType === 'food_budget') {
        payload = augmentGuamFoodBudgetPayload(reviewedPages, input.destination, payload);
      }
      if (input.brief.intentType === 'family_budget') {
        payload = augmentGuamFamilyMealPayload(reviewedPages, input.destination, payload);
      }
      if (input.brief.intentType === 'shopping_souvenirs') {
        payload = augmentGuamShoppingPayload(reviewedPages, input.destination, payload);
      }
      if (input.brief.intentType === 'airport_transport'
        || input.brief.intentType === 'family_budget'
        || input.brief.intentType === 'itinerary') {
        payload = augmentGrtaAirportTransportPayload(reviewedPages, input.destination, payload);
      }
      if (payloadHasResearchItems(payload) && remainingTimeout() > 20_000) {
        const preliminary = buildBlogResearchBundleFromGrounding({
          contentKey: input.contentKey,
          destination: input.destination,
          locale: input.locale,
          brief: input.brief,
          payload,
          groundingChunks,
          directSourceUrls: reviewedPages.map((page) => page.url),
          officialRegistry: registry,
          reputableRegistry,
          now,
        });
        const readiness = preliminary.bundle
          ? evaluateBlogGenerationResearchReadiness({
              meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: preliminary.bundle },
              expectedContentKey: input.contentKey,
              destination: input.destination,
              intent: input.brief.intentType,
              locale: input.locale,
              sourcePolicy: input.brief.sourcePolicy,
              now,
            })
          : null;
        const retryIssues = [
          ...preliminary.issues,
          ...(readiness?.issues ?? []),
        ];
        if ((!preliminary.bundle || !readiness?.passed) && retryIssues.length > 0) {
          structuredResponse = await generateStructuredResponse(true, retryIssues);
          finishReason = structuredResponse.candidates?.[0]?.finishReason
            ? String(structuredResponse.candidates[0].finishReason)
            : finishReason;
          rawText = structuredResponse.text ?? '';
          responseTextLength += rawText.length;
          payload = parseJsonPayload(rawText);
          payload = sanitizeGroundedResearchPayload(payload, input.brief.intentType);
          if (input.brief.intentType === 'food_budget') {
            payload = augmentGuamFoodBudgetPayload(reviewedPages, input.destination, payload);
          }
          if (input.brief.intentType === 'family_budget') {
            payload = augmentGuamFamilyMealPayload(reviewedPages, input.destination, payload);
          }
          if (input.brief.intentType === 'shopping_souvenirs') {
            payload = augmentGuamShoppingPayload(reviewedPages, input.destination, payload);
          }
          if (input.brief.intentType === 'airport_transport'
            || input.brief.intentType === 'family_budget'
            || input.brief.intentType === 'itinerary') {
            payload = augmentGrtaAirportTransportPayload(reviewedPages, input.destination, payload);
          }
        }
      }
    }
    const webChunkByOriginalIndex = new Map(webChunks.map((chunk) => [chunk.chunkIndex, chunk]));
    const observedSources = (payload.sources ?? []).map((source) => {
      const index = Number(source.groundingChunkIndex);
      const chunk = Number.isInteger(index)
        ? webChunkByOriginalIndex.get(index) ?? webChunks[index]
        : null;
      return {
        sourceType: clean(source.sourceType),
        groundingChunkIndex: Number.isInteger(index) ? index : null,
        url: chunk?.uri ?? null,
      };
    });
    const built = buildBlogResearchBundleFromGrounding({
      contentKey: input.contentKey,
      destination: input.destination,
      locale: input.locale,
      brief: input.brief,
      payload,
      groundingChunks,
      directSourceUrls: reviewedPages.map((page) => page.url),
      officialRegistry: registry,
      reputableRegistry,
      now,
    });
    return {
      passed: Boolean(built.bundle),
      bundle: built.bundle,
      issues: built.issues,
      model: AUTO_RESEARCH_MODEL,
      searchQueries,
      groundingSourceCount,
      directSourceCount,
      directSourceFailures,
      observedSourceTypes: [...new Set((payload.sources ?? []).map((source) => clean(source.sourceType)).filter(Boolean))],
      observedGroundingChunkIndexes: [...new Set((payload.sources ?? [])
        .map((source) => Number(source.groundingChunkIndex))
        .filter(Number.isInteger))],
      observedSources,
      finishReason,
      responseTextLength,
    };
  } catch (error) {
    return {
      passed: false,
      bundle: null,
      issues: [error instanceof Error ? error.message : String(error)],
      model: AUTO_RESEARCH_MODEL,
      searchQueries,
      groundingSourceCount,
      directSourceCount,
      directSourceFailures,
      observedSourceTypes: [],
      observedGroundingChunkIndexes: [],
      observedSources: [],
      finishReason,
      responseTextLength,
    };
  }
}
