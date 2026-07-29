const OFFICIAL_HOST_PATTERNS = [
  /(?:^|\.)[a-z0-9-]+\.go\.[a-z]{2}$/i,
  /(?:^|\.)[a-z0-9-]+\.gov\.[a-z]{2}$/i,
  /(?:^|\.)[a-z0-9-]+\.go\.kr$/i,
  /(?:^|\.)[a-z0-9-]+\.gov$/i,
  /(?:^|\.)0404\.go\.kr$/i,
  /(?:^|\.)mofa\.go\.kr$/i,
  /(?:^|\.)visitkorea\.or\.kr$/i,
  /(?:^|\.)knto\.or\.kr$/i,
  /(?:^|\.)airportal\.go\.kr$/i,
  /(?:^|\.)korea\.kr$/i,
  /(?:^|\.)travel\.state\.gov$/i,
  /(?:^|\.)japan\.travel$/i,
  /(?:^|\.)wmo\.int$/i,
];

function isPrivateOrLocalHostname(hostname: string): boolean {
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname === 'metadata'
    || hostname === 'metadata.google.internal'
    || hostname === '::1'
  ) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (/^0(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (/^169\.254(?:\.\d{1,3}){2}$/.test(hostname)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(hostname)) return true;
  const private172 = hostname.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return hostname.includes(':');
}

/**
 * Accepts only public HTTPS URLs suitable for display as reviewed research
 * references. Source authority is established separately by the research
 * registry and evidence gate.
 */
export function isSafePublicBlogSourceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== '443') return false;

    const hostname = parsed.hostname.toLowerCase();
    return Boolean(hostname)
      && !hostname.endsWith('.')
      && !isPrivateOrLocalHostname(hostname);
  } catch {
    return false;
  }
}

/**
 * Conservative display/evaluation helper only. Final factual publication trust
 * still comes from the server-managed official-source registry and evidence gate.
 */
export function isLikelyOfficialBlogSourceUrl(value: string): boolean {
  try {
    if (!isSafePublicBlogSourceUrl(value)) return false;
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return OFFICIAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}
