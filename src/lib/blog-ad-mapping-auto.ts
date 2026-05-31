import { supabaseAdmin } from './supabase';
import { applyUtmToUrl, buildUtm, normalizeUtmValue } from './utm-builder';

const AD_PLATFORMS = ['naver', 'google', 'meta', 'kakao'] as const;

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean),
    ),
  ).slice(0, 5);
}

function campaignSlugFor(keyword: string, slug: string): string {
  return normalizeUtmValue(`${slug}_${keyword}`) || normalizeUtmValue(slug) || 'blog';
}

function buildDkiHeadline(keyword: string, seoTitle: string | null, destination: string | null): string {
  const cleanKeyword = keyword.replace(/_/g, ' ').trim();
  if (!cleanKeyword) return seoTitle || '여행 가이드';
  if (seoTitle && seoTitle.includes(cleanKeyword)) return seoTitle.slice(0, 60);
  const suffix = destination ? `${destination} 여행 가이드` : '여행 가이드';
  return `${cleanKeyword} ${suffix}`.slice(0, 60);
}

export async function ensureAutoAdMappingsForBlog(input: {
  contentCreativeId: string;
  slug: string;
  seoTitle?: string | null;
  destination?: string | null;
  primaryKeyword?: string | null;
  targetKeywords?: string[] | null;
  baseUrl?: string;
}): Promise<{ inserted: number; skipped: number; keywords: string[] }> {
  const baseUrl = (input.baseUrl || process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/$/, '');
  const keywords = uniq([
    ...(input.targetKeywords || []),
    input.primaryKeyword,
    input.destination ? `${input.destination} 패키지` : null,
    input.destination ? `${input.destination} 여행` : null,
  ]);

  if (!input.slug || keywords.length === 0) {
    return { inserted: 0, skipped: 0, keywords: [] };
  }

  const { data: existing } = await supabaseAdmin
    .from('ad_landing_mappings')
    .select('platform, keyword')
    .eq('content_creative_id', input.contentCreativeId);

  const existingKeys = new Set(
    ((existing || []) as Array<{ platform: string; keyword: string }>)
      .map((r) => `${r.platform}::${r.keyword}`),
  );

  const rows: Array<Record<string, unknown>> = [];
  for (const keyword of keywords) {
    for (const platform of AD_PLATFORMS) {
      const key = `${platform}::${keyword}`;
      if (existingKeys.has(key)) continue;

      const campaignSlug = campaignSlugFor(keyword, input.slug);
      const utm = buildUtm({
        base_url: `${baseUrl}/blog/${input.slug}`,
        platform,
        campaign_slug: campaignSlug,
        keyword,
        creative_variant: 'auto',
      });

      rows.push({
        content_creative_id: input.contentCreativeId,
        platform,
        keyword,
        match_type: platform === 'naver' ? 'phrase' : 'broad',
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        utm_content: utm.utm_content,
        utm_term: utm.utm_term,
        dki_headline: buildDkiHeadline(keyword, input.seoTitle ?? null, input.destination ?? null),
        dki_subtitle: input.destination ? `${input.destination} 상담과 상품 연결까지 한 번에 확인하세요.` : null,
        landing_url: applyUtmToUrl(`${baseUrl}/blog/${input.slug}`, utm),
        active: false,
        operational_status: 'candidate',
        automation_level: 1,
        intent_cluster: keyword,
        scenario_type: input.destination ? 'destination_landing' : 'blog_landing',
        funnel_stage: 'consideration',
        decision_reason: 'Auto-generated mapping candidate. External ad delivery requires approval/deployment.',
      });
    }
  }

  if (rows.length === 0) return { inserted: 0, skipped: existingKeys.size, keywords };

  const { data, error } = await supabaseAdmin
    .from('ad_landing_mappings')
    .upsert(rows, {
      onConflict: 'platform,utm_campaign,utm_term,content_creative_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) throw error;

  return {
    inserted: data?.length ?? 0,
    skipped: rows.length - (data?.length ?? 0),
    keywords,
  };
}
