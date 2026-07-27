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
import { BLOG_INFORMATION_MINIMUM_CLAIMS_BY_INTENT } from '@/lib/blog-generation-research';
import { supabaseAdmin } from '@/lib/supabase';

const AUTO_RESEARCH_MODEL = process.env.BLOG_RESEARCH_MODEL?.trim() || 'gemini-2.5-flash';
const AUTO_RESEARCH_TIMEOUT_MS = Math.max(
  20_000,
  Math.min(120_000, Number(process.env.BLOG_RESEARCH_TIMEOUT_MS) || 90_000),
);
const MAX_GROUNDING_SOURCES = 12;
const MAX_SOURCE_CATALOG = 40;
const MAX_RESEARCH_EVIDENCE = 12;
const MAX_RESEARCH_CLAIMS = 12;
const MAX_REVIEWED_DIRECT_PAGES = 8;
const MAX_REVIEWED_PAGE_BYTES = 1_500_000;
const MAX_REVIEWED_PAGE_TEXT = 24_000;
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

type ReviewedDirectPage = {
  url: string;
  title: string;
  text: string;
};

function boundedReviewedPageText(value: string): string {
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
      const text = boundedReviewedPageText(parsed.text);
      if (text.length < 80) throw new Error(`content_too_short:${input.entry.hostname}`);
      return { url: currentUrl, title: input.entry.hostname, text };
    }

    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_REVIEWED_PAGE_BYTES) {
      throw new Error(`content_too_large:${input.entry.hostname}`);
    }
    if (contentType.includes('text/plain') || isStructuredText) {
      const text = boundedReviewedPageText(body);
      if (text.length < 80) throw new Error(`content_too_short:${input.entry.hostname}`);
      return { url: currentUrl, title: input.entry.hostname, text };
    }

    const $ = cheerio.load(body);
    $('script,style,noscript,svg,iframe,form,nav,footer').remove();
    const title = clean($('title').first().text()) || input.entry.hostname;
    const text = boundedReviewedPageText($('main,article').first().text() || $('body').text());
    if (text.length < 80) throw new Error(`content_too_short:${input.entry.hostname}`);
    return { url: currentUrl, title, text };
  }
  throw new Error(`too_many_redirects:${input.entry.hostname}`);
}

async function fetchReviewedDirectPages(
  registry: BlogInformationOfficialSourceRegistryEntry[],
): Promise<{ pages: ReviewedDirectPage[]; failures: string[] }> {
  const candidates = registry
    .flatMap((entry) => (entry.researchUrls ?? []).map((url) => ({ entry, url })))
    .slice(0, MAX_REVIEWED_DIRECT_PAGES);
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
    const sourceType = toSourceType(draft.sourceType, input.brief.sourcePolicy.sourceTypes);
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
    const reputableTrust = resolveReputableSourceTrust({
      sourceUrl: chunk.uri,
      sourceType,
      intent: input.brief.intentType ?? 'general',
      registry: reputableRegistry,
    });
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
    const country = clean(draft.country) || source.country || input.destination;
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
    const linkedEvidenceItems = valueMatchedEvidence;
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
    const normalizedValue = primaryEvidence.scope?.normalizedValue || '';
    const unit = primaryEvidence.scope?.unit || null;
    const currency = primaryEvidence.scope?.currency || null;
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

function groundingResearchPrompt(input: {
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
    `Return a compact research digest with at most ${MAX_RESEARCH_EVIDENCE} numbered facts.`,
    'For each fact include the source or operator name, exact value, unit/currency, applicable traveler, and checked date.',
    'Do not write an article and do not repeat the same value.',
    'Supply enough independently supported claims to cover every required decision fact and at least three distinct normalized values.',
    'For food budgets include separate supported claims for budget/midrange/premium and breakfast/lunch/dinner/snack.',
    'For food-budget claimText, use the exact Korean labels 절약, 일반, 여유, 아침, 점심, 저녁, 간식 where applicable.',
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

function structuredResearchPrompt(input: {
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
    'For price or currency evidence, currency must be an explicit ISO currency code.',
    'Omit optional unit, currency, validFrom, or validUntil when the digest does not state it.',
    `Minimum independently supported claims by type: ${claimMinimums}.`,
    'Return exactly one compact JSON object with this shape:',
    '{"sources":[{"sourceKey":"s1","groundingChunkIndex":0,"publisher":"...","sourceType":"...","claimTypes":["price"],"country":"...","destination":"..."}],"evidence":[{"evidenceKey":"e1","sourceKey":"s1","excerpt":"...","sourceLocator":"...","claimType":"price","riskLevel":"MEDIUM","country":"...","destination":"...","applicableTo":"한국인 여행자","normalizedValue":"100","unit":"1회","currency":"USD","conditions":["..."]}],"claims":[{"claimText":"...","claimType":"price","riskLevel":"MEDIUM","evidenceKeys":["e1"],"normalizedValue":"100","unit":"1회","currency":"USD"}]}',
    'Required decision facts:',
    requiredFacts,
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
  return Boolean(
    payload.sources?.length
    || payload.evidence?.length
    || payload.claims?.length,
  );
}

async function loadOfficialRegistry(intent: string): Promise<BlogInformationOfficialSourceRegistryEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_information_official_source_registry')
    .select('id, hostname, source_type, authority_level, allow_subdomains')
    .eq('status', 'active');
  if (error) throw new Error(`blog_auto_research_registry:${error.message}`);
  const { data: documentRows, error: documentError } = await supabaseAdmin
    .from('blog_information_official_research_documents')
    .select('official_source_registry_id, source_url, intents')
    .eq('status', 'active')
    .contains('intents', [intent]);
  if (documentError) throw new Error(`blog_auto_research_documents:${documentError.message}`);
  const urlsByRegistryId = new Map<string, string[]>();
  for (const row of documentRows ?? []) {
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
    .select('id, hostname, source_types, intents, allow_subdomains')
    .eq('status', 'active');
  if (error) throw new Error(`blog_auto_research_reputable_registry:${error.message}`);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    hostname: String(row.hostname),
    sourceTypes: Array.isArray(row.source_types) ? row.source_types : [],
    intents: Array.isArray(row.intents) ? row.intents.map(String) : [],
    allowSubdomains: Boolean(row.allow_subdomains),
  })) as BlogInformationReputableSourceRegistryEntry[];
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
    const registry = await loadOfficialRegistry(input.brief.intentType);
    const reputableRegistry = await loadReputableRegistry();
    const allowedSourceTypes = allowedPersistedSourceTypes(input.brief.sourcePolicy.sourceTypes);
    const reviewedRegistry = registry.filter((entry) => allowedSourceTypes.includes(entry.sourceType));
    const reviewedReputableRegistry = reputableRegistry.filter((entry) =>
      entry.intents.includes(input.brief.intentType)
      && entry.sourceTypes.some((sourceType) => allowedSourceTypes.includes(sourceType)));
    const reviewedSources = [
      ...reviewedRegistry.map((entry) => `${entry.hostname} (${entry.sourceType})`),
      ...reviewedReputableRegistry.flatMap((entry) =>
        entry.sourceTypes
          .filter((sourceType) => allowedSourceTypes.includes(sourceType))
          .map((sourceType) => `${entry.hostname} (${sourceType})`)),
    ];
    const directResult = await fetchReviewedDirectPages(reviewedRegistry);
    directSourceFailures = directResult.failures;
    const canUseReviewedPagesOnly = input.brief.sourcePolicy.primarySourcesRequired
      && directResult.pages.length > 0;
    let trustedSearchPages: ReviewedDirectPage[] = [];
    if (!canUseReviewedPagesOnly) {
      const groundedResponse = await geminiClient().models.generateContent({
        model: AUTO_RESEARCH_MODEL,
        contents: groundingResearchPrompt({ ...input, reviewedSources, now }),
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
    const buildStructuredPrompt = (retry = false): string => {
      const prompt = structuredResearchPrompt({
        ...input,
        digest: groundedDigest,
        sourceCatalog,
        now,
      });
      if (!retry) return prompt;
      return [
        prompt,
        '',
        'RETRY REQUIREMENT:',
        'The previous conversion returned an empty or unusable object even though reviewed source extracts are present.',
        'Extract only claims that are explicitly visible in REVIEWED_PAGE_EXTRACTS.',
        'If one required fact is absent, still return the supported sources, evidence, and claims that are present; validation will handle missing coverage.',
        'Do not return empty arrays unless every reviewed extract is completely irrelevant to the reader question.',
      ].join('\n');
    };
    const generateStructuredResponse = async (retry = false) => geminiClient().models.generateContent({
      model: AUTO_RESEARCH_MODEL,
      contents: buildStructuredPrompt(retry),
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
    let structuredResponse = await generateStructuredResponse(false);
    finishReason = structuredResponse.candidates?.[0]?.finishReason
      ? String(structuredResponse.candidates[0].finishReason)
      : null;
    let rawText = structuredResponse.text ?? '';
    responseTextLength = rawText.length;
    let payload = parseJsonPayload(rawText);
    if (!payloadHasResearchItems(payload) && reviewedPages.length > 0 && remainingTimeout() > 15_000) {
      structuredResponse = await generateStructuredResponse(true);
      finishReason = structuredResponse.candidates?.[0]?.finishReason
        ? String(structuredResponse.candidates[0].finishReason)
        : finishReason;
      rawText = structuredResponse.text ?? '';
      responseTextLength = rawText.length;
      payload = parseJsonPayload(rawText);
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
