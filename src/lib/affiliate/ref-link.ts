export function buildAffiliateUrl(
  basePath: string,
  referralCode: string,
  sub?: string,
): string {
  if (!referralCode) return basePath;
  try {
    const url = basePath.startsWith('http')
      ? new URL(basePath)
      : new URL(basePath, resolvePublicAppOrigin());
    url.searchParams.set('ref', referralCode);
    if (sub) url.searchParams.set('sub', sub);
    return basePath.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`;
  } catch {
    const sep = basePath.includes('?') ? '&' : '?';
    const subPart = sub ? `&sub=${encodeURIComponent(sub)}` : '';
    return `${basePath}${sep}ref=${encodeURIComponent(referralCode)}${subPart}`;
  }
}

export function buildTrackerUrl(
  referralCode: string,
  packageId?: string,
  sub?: string,
): string {
  const base = resolvePublicAppOrigin();
  const params = new URLSearchParams({ ref: referralCode });
  if (packageId) params.set('pkg', packageId);
  if (sub) params.set('sub', sub);
  return `${buildPublicUrl(`/api/influencer/track?${params.toString()}`)}`;
}
import { buildPublicUrl, resolvePublicAppOrigin } from '@/lib/public-app-origin';
