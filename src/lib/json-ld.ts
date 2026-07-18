export type JsonLdUrlOptions = {
  fallback: string | null;
  allowedOrigin?: string;
};

const JSON_LD_URL_KEYS = new Set([
  '@context',
  '@id',
  'availability',
  'contentUrl',
  'image',
  'item',
  'sameAs',
  'thumbnailUrl',
  'url',
]);
const DANGEROUS_URL_PROTOCOL_RE = /^(?:javascript|data|vbscript|file):/i;

function isLocalHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
}

/**
 * Validate a URL before it is placed in structured data.
 * Production values are HTTPS-only; local HTTP origins remain available for previews/tests.
 */
export function normalizeJsonLdUrl(value: unknown, options: JsonLdUrlOptions): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return options.fallback;
  }

  try {
    const url = new URL(value);
    if (url.username || url.password) return options.fallback;
    if (url.protocol !== 'https:' && !isLocalHttpUrl(url)) return options.fallback;
    if (options.allowedOrigin && url.origin !== options.allowedOrigin) return options.fallback;
    return url.href;
  } catch {
    return options.fallback;
  }
}

export function normalizeJsonLdText(
  value: unknown,
  maxLength: number,
  fallback = '',
): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  if (!normalized) return fallback;
  return normalized.slice(0, Math.max(0, maxLength));
}

/**
 * JSON.stringify alone is unsafe inside a script element because an attacker-controlled
 * `</script>` ends the element before the browser parses the JSON. Escaping the HTML-significant
 * characters and JavaScript line separators keeps the payload in one inert JSON-LD script.
 */
export function serializeJsonLdForScript(value: unknown): string {
  const serialized = JSON.stringify(value, (key, candidate) => {
    if (typeof candidate !== 'string') return candidate;

    const bounded = candidate
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .slice(0, 20_000);
    if (DANGEROUS_URL_PROTOCOL_RE.test(bounded)) return '';
    if (JSON_LD_URL_KEYS.has(key)) {
      return normalizeJsonLdUrl(bounded, { fallback: null }) ? bounded : '';
    }
    return bounded;
  });
  if (typeof serialized !== 'string') {
    throw new TypeError('JSON-LD value must be JSON serializable');
  }

  return serialized
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
