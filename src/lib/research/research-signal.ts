import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import { z } from 'zod';

import type { AgentTaskEnvelope } from '@/lib/agent/envelope';

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PINNED_VERSION = /^(?:v?\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?|[a-f0-9]{7,40})$/iu;
const TRACKING_QUERY_KEY = /^(?:fbclid|gclid|utm_.+)$/iu;
const EMAIL_REDACTION = /[^\s@]{1,64}@[^\s@]{1,255}\.[\p{L}]{2,}/gu;
const DOMESTIC_PHONE_REDACTION = /(?<!\d)(?:(?:\+?82|0082)[\s().-]*0?|0)(?:10|11|16|17|18|19|70|2|[3-6][1-5])(?:[\s().-]*\d){7,8}(?!\d)/gu;
const INTERNATIONAL_PHONE_REDACTION = /(?<![\p{L}\p{N}])(?:\+|00)[1-9]\d{0,2}(?:[\s().-]*\d){7,14}(?!\d)/gu;
const RESIDENT_ID_REDACTION = /\d{6}[\s.-]?[1-4]\d{6}/gu;

function containsResearchPii(value: string): boolean {
  return /[^\s@]{1,64}@[^\s@]{1,255}\.[\p{L}]{2,}/u.test(value)
    || /(?<!\d)(?:(?:\+?82|0082)[\s().-]*0?|0)(?:10|11|16|17|18|19|70|2|[3-6][1-5])(?:[\s().-]*\d){7,8}(?!\d)/u.test(value)
    || /(?<![\p{L}\p{N}])(?:\+|00)[1-9]\d{0,2}(?:[\s().-]*\d){7,14}(?!\d)/u.test(value)
    || /\d{6}[\s.-]?[1-4]\d{6}/u.test(value);
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/gu, '');
  return ['accessToken', 'apiKey', 'auth', 'authorization', 'authToken', 'code', 'credential', 'hmac', 'jwt', 'key', 'secret', 'session', 'sessionId', 'sig', 'signed', 'token']
    .map((value) => value.toLowerCase())
    .includes(normalized)
    || normalized.endsWith('signature');
}

const RawResearchSignalEnvelopeV1Schema = z.object({
  schemaVersion: z.literal(1),
  sourceUrl: z.string().trim().min(1).max(2048),
  sourcePlatform: z.enum([
    'youtube',
    'reddit',
    'x',
    'instagram',
    'facebook',
    'xiaohongshu',
    'rss',
    'github',
    'web',
  ]),
  title: z.string().trim().min(1).max(240),
  collectedAt: z.string().datetime({ offset: true }),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  collector: z.enum(['opencli', 'agent-reach', 'crawlee', 'manual']),
  collectorVersion: z.string().trim().min(5).max(80).regex(PINNED_VERSION),
  contentHash: z.string().trim().regex(SHA256),
  excerpt: z.string().trim().min(1).max(1200),
  authorAliasHash: z.string().trim().regex(SHA256).optional(),
  evidenceClass: z.enum(['market_opinion', 'topic_signal', 'official_source_candidate']),
  confidence: z.number().min(0).max(1),
  officialSource: z.literal(false).default(false),
  collectionMethod: z.enum(['public_page', 'authenticated_session', 'rss', 'official_api']),
  contentCheck: z.object({
    bodyPresent: z.literal(true),
    requiredFieldsPresent: z.literal(true),
    emptyResult: z.literal(false),
    loginError: z.literal(false),
  }).strict(),
}).strict();

export type ResearchSignalEnvelopeV1 = z.infer<typeof RawResearchSignalEnvelopeV1Schema>;

function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase();
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (dotted) {
    const bytes = dotted.split('.').map(Number);
    value = value.slice(0, -dotted.length) + `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? Array(Math.max(0, 8 - left.length - right.length)).fill('0') : [];
  const groups = [...left, ...fill, ...right].map((group) => Number.parseInt(group || '0', 16));
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  return groups;
}

function embeddedIpv4FromIpv6(address: string): string | null {
  const groups = ipv6Groups(address);
  if (!groups) return null;
  return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
}

function mappedIpv4FromIpv6(address: string): string | null {
  const groups = ipv6Groups(address);
  if (!groups) return null;
  if (groups.slice(0, 5).some((group) => group !== 0) || groups[5] !== 0xffff) return null;
  return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
}

function isPrivateNetworkAddress(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    const [a, b, c] = hostname.split('.').map(Number);
    return a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a === 0
      || a >= 224;
  }
  if (version === 6) {
    const value = hostname.toLowerCase();
    const first = Number.parseInt(value.split(':')[0] || '0', 16);
    const mappedIpv4 = mappedIpv4FromIpv6(value);
    const embeddedIpv4 = embeddedIpv4FromIpv6(value);
    return value === '::'
      || value === '::1'
      || value.startsWith('fc')
      || value.startsWith('fd')
      || (Number.isFinite(first) && (first & 0xffc0) === 0xfe80)
      || value.startsWith('ff')
      || value.startsWith('2001:db8:')
      || (mappedIpv4 ? isPrivateNetworkAddress(mappedIpv4) : false)
      || (embeddedIpv4 ? isPrivateNetworkAddress(embeddedIpv4) : false);
  }
  return false;
}

export function normalizeResearchSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('sourceUrl must be a valid URL');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('sourceUrl must be a credential-free HTTPS URL');
  }
  if (url.port && url.port !== '443') throw new Error('sourceUrl must use the default HTTPS port');
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || isPrivateNetworkAddress(hostname)
  ) {
    throw new Error('sourceUrl cannot target a local or private host');
  }

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveQueryKey(key) || TRACKING_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function redactResearchExcerpt(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/\p{Dash_Punctuation}/gu, '-')
    .replace(EMAIL_REDACTION, '[email-redacted]')
    .replace(DOMESTIC_PHONE_REDACTION, '[phone-redacted]')
    .replace(INTERNATIONAL_PHONE_REDACTION, '[phone-redacted]')
    .replace(RESIDENT_ID_REDACTION, '[id-redacted]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function parseResearchSignalEnvelopeV1(input: unknown):
  | { success: true; data: ResearchSignalEnvelopeV1 }
  | { success: false; issues: string[] } {
  const parsed = RawResearchSignalEnvelopeV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}:${issue.code}`),
    };
  }

  try {
    const sourceUrl = normalizeResearchSourceUrl(parsed.data.sourceUrl);
    const title = redactResearchExcerpt(parsed.data.title);
    const excerpt = redactResearchExcerpt(parsed.data.excerpt);
    if (!title) return { success: false, issues: ['title:empty_after_redaction'] };
    if (!excerpt) return { success: false, issues: ['excerpt:empty_after_redaction'] };
    if (containsResearchPii(title) || containsResearchPii(excerpt)) {
      return { success: false, issues: ['content:residual_pii'] };
    }
    const collectedAt = Date.parse(parsed.data.collectedAt);
    const publishedAt = parsed.data.publishedAt ? Date.parse(parsed.data.publishedAt) : null;
    if (collectedAt > Date.now() + 5 * 60 * 1000) {
      return { success: false, issues: ['collectedAt:future_timestamp'] };
    }
    if (publishedAt !== null && publishedAt > collectedAt + 5 * 60 * 1000) {
      return { success: false, issues: ['publishedAt:after_collection'] };
    }
    return { success: true, data: { ...parsed.data, sourceUrl, title, excerpt } };
  } catch (error) {
    return {
      success: false,
      issues: [error instanceof Error ? error.message : 'invalid sourceUrl'],
    };
  }
}

export function buildResearchSignalTaskEnvelope(
  signal: ResearchSignalEnvelopeV1,
  correlationId = randomUUID(),
): AgentTaskEnvelope {
  const digest = createHash('sha256')
    .update(`${signal.sourcePlatform}\n${signal.sourceUrl}\n${signal.contentHash}`, 'utf8')
    .digest('hex');

  return {
    correlationId,
    source: 'research_node',
    agentType: 'marketing',
    specialistId: 'research-intake',
    performative: 'inform',
    riskLevel: 'medium',
    status: 'queued',
    idempotencyKey: `research-signal:v1:${digest}`,
    taskContext: {
      schema: 'ResearchSignalEnvelopeV1',
      disposition: 'review_required',
      publicationAllowed: false,
      productFactAllowed: false,
      signal,
    },
    createdBy: `research-node:${signal.collector}`,
  };
}
