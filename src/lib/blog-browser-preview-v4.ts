import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getSecret } from './secret-registry';

export const BLOG_BROWSER_PREVIEW_VERSION = 'blog-browser-preview-v4.0.0' as const;
export const BLOG_BROWSER_PREVIEW_META_KEY = 'browser_preview_v4' as const;
export const BLOG_BROWSER_PUBLIC_META_KEY = 'browser_public_v4' as const;
const MAX_PREVIEW_TTL_SECONDS = 15 * 60;

type BlogPreviewTokenPayload = {
  version: 1;
  creativeId: string;
  slug: string;
  expiresAt: number;
};

export type BlogBrowserPreviewEvidenceV4 = {
  version: typeof BLOG_BROWSER_PREVIEW_VERSION;
  passed: boolean;
  score: number;
  mobileScore: number;
  desktopScore: number;
  auditedAt: string;
  previewPath: string;
  issues: string[];
  evaluator: 'playwright';
  contentHash: string;
};

export function createBlogPreviewContentHash(input: {
  slug: string;
  title?: string | null;
  description?: string | null;
  markdown?: string | null;
}): string {
  return createHash('sha256').update([
    input.slug,
    input.title || '',
    input.description || '',
    input.markdown || '',
  ].join('\u0000')).digest('hex');
}

function previewSecret(): string | null {
  return getSecret('BLOG_PREVIEW_SECRET') || getSecret('CRON_SECRET');
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createBlogPreviewToken(input: {
  creativeId: string;
  slug: string;
  now?: Date;
  ttlSeconds?: number;
  secret?: string;
}): string {
  const secret = input.secret || previewSecret();
  if (!secret) throw new Error('blog_preview_secret_missing');
  const ttlSeconds = Math.max(30, Math.min(MAX_PREVIEW_TTL_SECONDS, Math.trunc(input.ttlSeconds ?? 600)));
  const now = input.now ?? new Date();
  const payload: BlogPreviewTokenPayload = {
    version: 1,
    creativeId: input.creativeId,
    slug: input.slug,
    expiresAt: Math.floor(now.getTime() / 1_000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyBlogPreviewToken(input: {
  token: string | null | undefined;
  slug: string;
  now?: Date;
  secret?: string;
}): BlogPreviewTokenPayload | null {
  const secret = input.secret || previewSecret();
  if (!secret || !input.token) return null;
  const [encoded, providedSignature, extra] = input.token.split('.');
  if (!encoded || !providedSignature || extra) return null;
  const expectedSignature = sign(encoded, secret);
  const provided = Buffer.from(providedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as BlogPreviewTokenPayload;
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    if (payload.version !== 1
      || payload.slug !== input.slug
      || !/^[0-9a-f-]{36}$/i.test(payload.creativeId)
      || !Number.isSafeInteger(payload.expiresAt)
      || payload.expiresAt < nowSeconds
      || payload.expiresAt > nowSeconds + MAX_PREVIEW_TTL_SECONDS) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function readBlogBrowserPreviewEvidenceV4(
  generationMeta: unknown,
): BlogBrowserPreviewEvidenceV4 | null {
  if (!generationMeta || typeof generationMeta !== 'object' || Array.isArray(generationMeta)) return null;
  const evidence = (generationMeta as Record<string, unknown>)[BLOG_BROWSER_PREVIEW_META_KEY];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const value = evidence as Record<string, unknown>;
  if (value.version !== BLOG_BROWSER_PREVIEW_VERSION
    || value.evaluator !== 'playwright'
    || typeof value.passed !== 'boolean'
    || !Number.isFinite(Number(value.score))) {
    return null;
  }
  return {
    version: BLOG_BROWSER_PREVIEW_VERSION,
    passed: value.passed,
    score: Math.max(0, Math.min(100, Number(value.score))),
    mobileScore: Math.max(0, Math.min(100, Number(value.mobileScore ?? 0))),
    desktopScore: Math.max(0, Math.min(100, Number(value.desktopScore ?? 0))),
    auditedAt: String(value.auditedAt || ''),
    previewPath: String(value.previewPath || ''),
    issues: Array.isArray(value.issues)
      ? value.issues.filter((issue): issue is string => typeof issue === 'string')
      : [],
    evaluator: 'playwright',
    contentHash: String(value.contentHash || ''),
  };
}

export function readBlogBrowserPublicEvidenceV4(
  generationMeta: unknown,
): BlogBrowserPreviewEvidenceV4 | null {
  if (!generationMeta || typeof generationMeta !== 'object' || Array.isArray(generationMeta)) return null;
  const evidence = (generationMeta as Record<string, unknown>)[BLOG_BROWSER_PUBLIC_META_KEY];
  return readBlogBrowserPreviewEvidenceV4({ [BLOG_BROWSER_PREVIEW_META_KEY]: evidence });
}
