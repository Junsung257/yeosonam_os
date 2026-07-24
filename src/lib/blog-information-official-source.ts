import type {
  BlogInformationAuthorityLevel,
  BlogInformationSourceType,
} from './blog-information-evidence';

export interface BlogInformationOfficialSourceRegistryEntry {
  id: string;
  hostname: string;
  sourceType: BlogInformationSourceType;
  authorityLevel: Extract<BlogInformationAuthorityLevel, 'official_primary' | 'official_secondary'>;
  allowSubdomains: boolean;
  researchUrls?: string[];
}

export function canonicalizeBlogInformationSourceHostname(value?: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      return null;
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function sourceHostnameMatchesRegistry(input: {
  sourceHostname: string;
  registryHostname: string;
  allowSubdomains: boolean;
}): boolean {
  const sourceHostname = input.sourceHostname.toLowerCase().replace(/\.$/, '');
  const registryHostname = input.registryHostname.toLowerCase().replace(/\.$/, '');
  return sourceHostname === registryHostname
    || (input.allowSubdomains && sourceHostname.endsWith(`.${registryHostname}`));
}

export function resolveBlogInformationOfficialSourceTrust(input: {
  sourceUrl?: string | null;
  sourceType: BlogInformationSourceType;
  registry: BlogInformationOfficialSourceRegistryEntry[];
}): { registryId: string; authorityLevel: 'official_primary' | 'official_secondary' } | null {
  const sourceHostname = canonicalizeBlogInformationSourceHostname(input.sourceUrl);
  if (!sourceHostname) return null;
  const matched = input.registry.find((entry) => entry.sourceType === input.sourceType
    && sourceHostnameMatchesRegistry({
      sourceHostname,
      registryHostname: entry.hostname,
      allowSubdomains: entry.allowSubdomains,
    }));
  return matched ? { registryId: matched.id, authorityLevel: matched.authorityLevel } : null;
}
