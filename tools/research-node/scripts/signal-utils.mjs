import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SENSITIVE_QUERY_KEY = /(?:^|[-_])(?:access_?token|api_?key|auth(?:orization)?|code|credential|jwt|key|secret|session|signature|token)(?:$|[-_])/iu;
const TRACKING_QUERY_KEY = /^(?:fbclid|gclid|utm_.+)$/iu;

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function validateIntakeEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('RESEARCH_INTAKE_URL must be a valid URL');
  }
  if (
    endpoint.origin !== 'https://www.yeosonam.com'
    || endpoint.pathname !== '/api/internal/research/signals'
    || endpoint.search
    || endpoint.hash
    || endpoint.username
    || endpoint.password
  ) {
    throw new Error('RESEARCH_INTAKE_URL must be the canonical Yeosonam research intake URL');
  }
  return endpoint;
}

function isPrivateIp(hostname) {
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

export function validateReviewedSource(source) {
  if (!source || typeof source !== 'object') throw new Error('source must be an object');
  const id = String(source.id ?? '').trim();
  const approvedHostname = String(source.approvedHostname ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/u.test(id)) throw new Error(`invalid source id: ${id || '(empty)'}`);
  if (!approvedHostname || approvedHostname.includes('/') || approvedHostname.includes(':')) {
    throw new Error(`invalid approved hostname for ${id}`);
  }

  const url = new URL(String(source.url ?? ''));
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error(`source ${id} must use credential-free HTTPS`);
  }
  if (isPrivateIp(hostname) || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error(`source ${id} targets a private host`);
  }
  const hostMatches = hostname === approvedHostname
    || (source.allowSubdomains === true && hostname.endsWith(`.${approvedHostname}`));
  if (!hostMatches) throw new Error(`source ${id} does not match its reviewed hostname`);
  if (source.evidenceClass !== 'official_source_candidate') {
    throw new Error(`source ${id} must remain an official_source_candidate`);
  }

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key)) throw new Error(`source ${id} contains a sensitive query key`);
    if (TRACKING_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return {
    id,
    url: url.toString(),
    approvedHostname,
    allowSubdomains: source.allowSubdomains === true,
    evidenceClass: source.evidenceClass,
  };
}

export function compactText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function redactExcerpt(value) {
  return compactText(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[email-redacted]')
    .replace(/(?:\+82[-\s]?(?:10|[2-6][1-5])|0(?:10|[2-6][1-5]))[-\s]?\d{3,4}[-\s]?\d{4}/gu, '[phone-redacted]')
    .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/gu, '[phone-redacted]')
    .replace(/\d{6}[-\s]?[1-4]\d{6}/gu, '[id-redacted]');
}

export function buildSignal({ source, title, text, collectedAt, collectorVersion }) {
  const body = compactText(text);
  const pageTitle = compactText(title);
  const bodyPresent = body.length >= 200;
  const requiredFieldsPresent = pageTitle.length > 0 && bodyPresent;
  return {
    schemaVersion: 1,
    sourceUrl: source.url,
    sourcePlatform: 'web',
    collectedAt,
    collector: 'crawlee',
    collectorVersion,
    contentHash: sha256(body),
    excerpt: redactExcerpt(body.slice(0, 1200)),
    evidenceClass: source.evidenceClass,
    confidence: requiredFieldsPresent ? 0.8 : 0,
    officialSource: false,
    collectionMethod: 'public_page',
    contentCheck: {
      bodyPresent,
      requiredFieldsPresent,
      emptyResult: body.length === 0,
      loginError: /(?:로그인|sign in|log in)\s+(?:필요|required)/iu.test(body.slice(0, 500)),
    },
    collectorMeta: {
      sourceId: source.id,
      title: pageTitle.slice(0, 240),
    },
  };
}

export function validateSignal(signal) {
  const errors = [];
  if (signal?.schemaVersion !== 1) errors.push('schemaVersion');
  if (!SHA256.test(String(signal?.contentHash ?? ''))) errors.push('contentHash');
  if (signal?.officialSource !== false) errors.push('officialSource');
  if (signal?.evidenceClass !== 'official_source_candidate') errors.push('evidenceClass');
  if (signal?.contentCheck?.bodyPresent !== true) errors.push('bodyPresent');
  if (signal?.contentCheck?.requiredFieldsPresent !== true) errors.push('requiredFieldsPresent');
  if (signal?.contentCheck?.emptyResult !== false) errors.push('emptyResult');
  if (signal?.contentCheck?.loginError !== false) errors.push('loginError');
  if (!String(signal?.excerpt ?? '').trim()) errors.push('excerpt');
  return errors;
}

export function intakePayload(signal) {
  const { collectorMeta: _collectorMeta, ...payload } = signal;
  return payload;
}
