const DEFAULT_CANONICAL_ORIGIN = 'https://www.yeosonam.com';

function cleanUrlProperty(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith('sc-domain:')) {
    return raw.replace(/\/+$/, '');
  }

  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (isLocalHost(parsed.hostname)) return null;
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function cleanOrigin(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw.startsWith('sc-domain:')) return null;

  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (isLocalHost(parsed.hostname)) return null;
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  return /^(localhost|127\.|0\.0\.0\.0)/i.test(hostname);
}

function apexHostFromUrlProperty(value: string): string | null {
  if (value.startsWith('sc-domain:')) {
    return value.slice('sc-domain:'.length).replace(/^www\./, '') || null;
  }

  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function getCanonicalGscUrlProperty(): string {
  return cleanUrlProperty(
    process.env.BLOG_CANONICAL_ORIGIN
    || process.env.NEXT_PUBLIC_SITE_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || DEFAULT_CANONICAL_ORIGIN,
  ) || `${DEFAULT_CANONICAL_ORIGIN}/`;
}

export function buildGscSearchSiteUrlCandidates(
  configuredSiteUrl?: string | null,
  options?: {
    canonicalOrigin?: string | null;
    includeDomainProperty?: boolean;
  },
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    const cleaned = cleanUrlProperty(value);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    candidates.push(cleaned);
  };

  const configured = cleanUrlProperty(configuredSiteUrl || process.env.GSC_SITE_URL);
  const canonical = cleanUrlProperty(
    cleanOrigin(options?.canonicalOrigin)
    || process.env.BLOG_CANONICAL_ORIGIN
    || process.env.NEXT_PUBLIC_SITE_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || DEFAULT_CANONICAL_ORIGIN,
  );

  if (configured?.startsWith('sc-domain:')) add(configured);
  add(canonical);
  add(configured);

  const hosts = [
    canonical ? apexHostFromUrlProperty(canonical) : null,
    configured ? apexHostFromUrlProperty(configured) : null,
    apexHostFromUrlProperty(`${DEFAULT_CANONICAL_ORIGIN}/`),
  ].filter((host): host is string => Boolean(host));

  for (const host of hosts) {
    add(`https://www.${host}/`);
    add(`https://${host}/`);
  }

  if (options?.includeDomainProperty !== false) {
    for (const host of hosts) {
      add(`sc-domain:${host}`);
    }
  }

  return candidates;
}
