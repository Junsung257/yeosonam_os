export type BlogInformationExternalUrlKind =
  | 'NAVER_CAFE'
  | 'DEAL_ROOM'
  | 'CONSULTATION'
  | 'OFFICIAL_SOURCE';

const HOST_ALLOWLIST: Record<Exclude<BlogInformationExternalUrlKind, 'OFFICIAL_SOURCE'>, ReadonlySet<string>> = {
  NAVER_CAFE: new Set(['cafe.naver.com']),
  DEAL_ROOM: new Set([
    'cafe.naver.com',
    'open.kakao.com',
    'pf.kakao.com',
    'yeosonam.com',
    'www.yeosonam.com',
  ]),
  CONSULTATION: new Set([
    'pf.kakao.com',
    'yeosonam.com',
    'www.yeosonam.com',
  ]),
};

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true;
  if (/^(?:127|10)\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return false;
}

export function normalizeBlogInformationExternalUrl(input: {
  kind: BlogInformationExternalUrlKind;
  value?: string | null;
  /** @deprecated Caller-provided provenance is never sufficient for official trust. */
  evidencePinnedOfficial?: boolean;
  officialRegistryHostname?: string | null;
  allowOfficialSubdomains?: boolean;
}): string | null {
  const raw = input.value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !hostname || parsed.username || parsed.password || parsed.port) return null;
    if (isPrivateOrLocalHostname(hostname)) return null;
    if (input.kind === 'OFFICIAL_SOURCE') {
      const registryHostname = input.officialRegistryHostname?.toLowerCase().replace(/\.$/, '');
      if (!registryHostname) return null;
      const exact = hostname === registryHostname;
      const controlledSubdomain = input.allowOfficialSubdomains
        && hostname.endsWith(`.${registryHostname}`);
      if (!exact && !controlledSubdomain) return null;
    } else if (!HOST_ALLOWLIST[input.kind].has(hostname)) {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeBlogInformationInternalHref(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw || raw.startsWith('//') || raw.includes('\\')) return null;
  try {
    const parsed = new URL(raw, 'https://www.yeosonam.com');
    if (parsed.origin !== 'https://www.yeosonam.com') return null;
    if (parsed.pathname !== '/blog' && !parsed.pathname.startsWith('/blog/')) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function isAllowedBlogInformationEventOrigin(input: {
  requestOrigin: string;
  originHeader?: string | null;
  refererHeader?: string | null;
  secFetchSite?: string | null;
}): boolean {
  if (input.secFetchSite && !['same-origin', 'same-site'].includes(input.secFetchSite)) return false;
  const candidates = [input.originHeader, input.refererHeader].filter((value): value is string => Boolean(value));
  if (candidates.length === 0) return false;
  const allowed = new Set(['https://www.yeosonam.com', 'https://yeosonam.com']);
  const requestUrl = new URL(input.requestOrigin);
  if (['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)) {
    allowed.add(requestUrl.origin);
  }
  return candidates.some((value) => {
    try {
      return allowed.has(new URL(value).origin);
    } catch {
      return false;
    }
  });
}
