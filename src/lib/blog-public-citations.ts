import { supabaseAdmin } from '@/lib/supabase';

export interface BlogPublicCitation {
  label: string;
  url: string;
  source: string;
  retrievedAt: string | null;
  authority: 'official' | 'editorial';
}

function safeHttpsUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function loadBlogPublicCitations(input: {
  creativeId?: string | null;
  contentKey?: string | null;
  limit?: number;
}): Promise<BlogPublicCitation[]> {
  const sourceIds = new Set<string>();
  if (input.creativeId) {
    const { data, error } = await supabaseAdmin
      .from('blog_information_evidence')
      .select('source_id')
      .eq('creative_id', input.creativeId)
      .limit(100);
    if (error) throw new Error(`blog_public_citations_evidence:${error.message}`);
    for (const row of data ?? []) sourceIds.add(String(row.source_id));
  }
  if (input.contentKey) {
    const { data, error } = await supabaseAdmin
      .from('blog_information_evidence')
      .select('source_id')
      .eq('content_key', input.contentKey)
      .limit(100);
    if (error) throw new Error(`blog_public_citations_content_key:${error.message}`);
    for (const row of data ?? []) sourceIds.add(String(row.source_id));
  }
  if (sourceIds.size === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('blog_information_sources')
    .select('id, source_url, publisher, authority_level, retrieved_at')
    .in('id', [...sourceIds])
    .order('retrieved_at', { ascending: false })
    .limit(Math.max(1, Math.min(input.limit ?? 6, 10)));
  if (error) throw new Error(`blog_public_citations_sources:${error.message}`);

  const seen = new Set<string>();
  return (data ?? []).flatMap((row) => {
    const url = safeHttpsUrl(row.source_url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const authorityLevel = String(row.authority_level ?? '');
    return [{
      label: String(row.publisher || hostname),
      url,
      source: hostname,
      retrievedAt: typeof row.retrieved_at === 'string' ? row.retrieved_at : null,
      authority: authorityLevel.startsWith('official_') ? 'official' : 'editorial',
    } satisfies BlogPublicCitation];
  });
}
