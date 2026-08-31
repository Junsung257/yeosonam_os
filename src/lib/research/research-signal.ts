import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import { z } from 'zod';

import type { AgentTaskEnvelope } from '@/lib/agent/envelope';

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PINNED_VERSION = /^(?:v?\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?|[a-f0-9]{7,40})$/iu;
const SENSITIVE_QUERY_KEY = /(?:^|[-_])(?:access_?token|api_?key|auth(?:orization)?|code|credential|jwt|key|secret|session|signature|token)(?:$|[-_])/iu;
const TRACKING_QUERY_KEY = /^(?:fbclid|gclid|utm_.+)$/iu;

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

function isPrivateIp(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    const [a, b] = hostname.split('.').map(Number);
    return a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || a === 0;
  }
  if (version === 6) {
    const value = hostname.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8');
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
    || isPrivateIp(hostname)
  ) {
    throw new Error('sourceUrl cannot target a local or private host');
  }

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key) || TRACKING_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function redactResearchExcerpt(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[email-redacted]')
    .replace(/(?:\+82[-\s]?(?:10|[2-6][1-5])|0(?:10|[2-6][1-5]))[-\s]?\d{3,4}[-\s]?\d{4}/gu, '[phone-redacted]')
    .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/gu, '[phone-redacted]')
    .replace(/\d{6}[-\s]?[1-4]\d{6}/gu, '[id-redacted]')
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
    const excerpt = redactResearchExcerpt(parsed.data.excerpt);
    if (!excerpt) return { success: false, issues: ['excerpt:empty_after_redaction'] };
    const collectedAt = Date.parse(parsed.data.collectedAt);
    const publishedAt = parsed.data.publishedAt ? Date.parse(parsed.data.publishedAt) : null;
    if (collectedAt > Date.now() + 5 * 60 * 1000) {
      return { success: false, issues: ['collectedAt:future_timestamp'] };
    }
    if (publishedAt !== null && publishedAt > collectedAt + 5 * 60 * 1000) {
      return { success: false, issues: ['publishedAt:after_collection'] };
    }
    return { success: true, data: { ...parsed.data, sourceUrl, excerpt } };
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
