import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { getSecret } from '@/lib/secret-registry';

/**
 * 순위 스냅샷 크론 — SERPAPI_KEY 설정 시에만 동작
 * (키 없으면 no-op — 비용 방지)
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function runSerpRankSnapshot(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const serpApiKey = getSecret('SERPAPI_KEY');
  if (!serpApiKey) {
    return { skipped: true, reason: 'SERPAPI_KEY 미설정', errors: [] as string[] };
  }

  const { data: rows } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('primary_keyword, destination')
    .eq('status', 'queued')
    .not('primary_keyword', 'is', null)
    .order('priority', { ascending: false })
    .limit(8);

  const keywords = [...new Set((rows ?? []).map((r: { primary_keyword: string | null }) => r.primary_keyword).filter(Boolean))] as string[];

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/$/, '');
  const inserted: string[] = [];
  const errors: string[] = [];

  for (const kw of keywords) {
    try {
      const url = `https://serpapi.com/search.json?engine=naver&q=${encodeURIComponent(kw)}&api_key=${serpApiKey}`;
      const res = await fetch(url, { next: { revalidate: 0 } });
      if (!res.ok) {
        errors.push(`serpapi HTTP ${res.status} (${kw})`);
        continue;
      }
      const json = (await res.json()) as Record<string, unknown>;
      const organic = Array.isArray(json.organic_results)
        ? json.organic_results
        : Array.isArray(json.web_results)
          ? json.web_results
          : [];
      const first = organic[0] as { position?: number; link?: string } | undefined;
      const position = first?.position ?? null;
      const link = typeof first?.link === 'string' ? first.link : '';
      const { error: insErr } = await supabaseAdmin.from('serp_rank_snapshots').insert({
        keyword: kw,
        engine: 'naver',
        url: link || `${baseUrl}/blog`,
        position: position ?? null,
        raw: { engine: 'naver', organic_len: organic.length },
      });
      if (insErr) {
        errors.push(`serp_rank_snapshots(${kw}): ${insErr.message}`);
        continue;
      }
      inserted.push(kw);
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      errors.push(`${kw}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: true, sampled: inserted.length, keywords: inserted, errors };
}

export const GET = withCronLogging('serp-rank-snapshot', runSerpRankSnapshot);
