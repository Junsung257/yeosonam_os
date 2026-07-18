import { getSecret } from './secret-registry';
import {
  buildBlogInformationalCtaSettings,
  readBlogInformationalOfficialSourceUrl,
  type BlogInformationalCtaDefinition,
} from './blog-informational-cta';
import { normalizeBlogInformationExternalUrl } from './blog-information-url-policy';
import { supabaseAdmin } from './supabase';

export function loadBlogInformationalCtaSettings(input: {
  destination?: string | null;
  relatedArticlesHref?: string | null;
  officialSourceUrl?: string | null;
  officialSourceRegistryHostname?: string | null;
  officialSourceAllowSubdomains?: boolean;
}): BlogInformationalCtaDefinition[] {
  return buildBlogInformationalCtaSettings({
    ...input,
    naverCafeUrl: getSecret('BLOG_NAVER_CAFE_URL'),
    dealRoomUrl: getSecret('BLOG_DEAL_ROOM_URL'),
    consultationUrl: getSecret('BLOG_CONSULTATION_URL'),
    kakaoChannelId: getSecret('KAKAO_CHANNEL_ID'),
    officialSourceUrl: input.officialSourceUrl,
  });
}

export async function loadBlogInformationalOfficialSourceUrl(input: {
  creativeId: string;
  generationMeta?: Record<string, unknown> | null;
}): Promise<{
  url: string;
  registryHostname: string;
  allowSubdomains: boolean;
} | null> {
  void readBlogInformationalOfficialSourceUrl(input.generationMeta);
  try {
    const { data: claims, error: claimsError } = await supabaseAdmin
      .from('blog_information_claims')
      .select('id')
      .eq('creative_id', input.creativeId)
      .eq('requires_evidence', true);
    if (claimsError || !claims?.length) return null;
    const { data: links, error: linksError } = await supabaseAdmin
      .from('blog_information_claim_evidence')
      .select('evidence_id')
      .in('claim_id', claims.map((claim) => claim.id))
      .eq('support_type', 'supports');
    if (linksError || !links?.length) return null;
    const { data: evidence, error: evidenceError } = await supabaseAdmin
      .from('blog_information_evidence')
      .select('source_version_id')
      .in('id', [...new Set(links.map((link) => link.evidence_id))]);
    if (evidenceError || !evidence?.length) return null;
    const versionIds = [...new Set(evidence
      .map((item) => item.source_version_id)
      .filter((id): id is string => Boolean(id)))];
    if (!versionIds.length) return null;
    const { data: versions, error: versionsError } = await supabaseAdmin
      .from('blog_information_source_versions')
      .select('source_url, authority_level, status, retrieved_at, official_source_registry_id')
      .in('id', versionIds)
      .eq('authority_level', 'official_primary')
      .eq('status', 'active')
      .order('retrieved_at', { ascending: false })
      .limit(10);
    if (versionsError) return null;
    const registryIds = [...new Set((versions ?? [])
      .map((version) => version.official_source_registry_id)
      .filter((id): id is string => Boolean(id)))];
    if (!registryIds.length) return null;
    const { data: registry, error: registryError } = await supabaseAdmin
      .from('blog_information_official_source_registry')
      .select('id, hostname, allow_subdomains')
      .in('id', registryIds)
      .eq('status', 'active');
    if (registryError) return null;
    const registryById = new Map((registry ?? []).map((entry) => [entry.id, entry]));
    for (const version of versions ?? []) {
      const registryEntry = registryById.get(version.official_source_registry_id);
      if (!registryEntry) continue;
      const url = normalizeBlogInformationExternalUrl({
        kind: 'OFFICIAL_SOURCE',
        value: version.source_url,
        officialRegistryHostname: registryEntry.hostname,
        allowOfficialSubdomains: registryEntry.allow_subdomains,
      });
      if (url) return {
        url,
        registryHostname: registryEntry.hostname,
        allowSubdomains: registryEntry.allow_subdomains,
      };
    }
    return null;
  } catch {
    return null;
  }
}
