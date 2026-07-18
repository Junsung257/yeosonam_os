/**
 * GET /api/cron/band-rss
 *
 * 밴드 RSS 피드 → 신규 게시글 자동 임포트
 * vercel.json 스케줄: "0 * * * *" (1시간마다)
 */

import { NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { fetchBandRSS } from '@/lib/band-rss-fetcher';
import { analyzeFromText, BAND_SUPPLIER_CODE, DEFAULT_MARGIN_RATE } from '@/lib/band-ai-analyzer';
import { persistBandImportedProduct } from '@/lib/band-import-persistence';
import { getSecret } from '@/lib/secret-registry';
import { withCronLogging } from '@/lib/cron-observability';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const maxDuration = 300;

async function getNextCode(depCode: string, destCode: string, days: number): Promise<string> {
  const prefix = `${depCode}-BAND-${destCode}-${String(days).padStart(2, '0')}-`;
  const { data } = await supabaseAdmin
    .from('products')
    .select('internal_code')
    .like('internal_code', `${prefix}%`)
    .order('internal_code', { ascending: false })
    .limit(1);

  let seq = 0;
  if (data?.[0]) {
    const n = parseInt((data[0] as { internal_code: string }).internal_code.slice(prefix.length), 10);
    if (!isNaN(n)) seq = n;
  }
  return prefix + String(seq + 1).padStart(4, '0');
}

const handleBandRss = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) return { error: 'DB not configured', errors: ['DB not configured'] };

  const rssUrl = getSecret('BAND_RSS_URL');
  if (!rssUrl) {
    return { skipped: true, reason: 'BAND_RSS_URL not configured', errors: [] as string[] };
  }

  const results = { imported: 0, skipped: 0, failed: 0, errors: [] as string[] };

  try {
    const posts = await fetchBandRSS(rssUrl);
    if (posts.length === 0) return { ok: true, ...results };

    const allUrls = posts.map(p => p.url);
    const { data: existingLogs } = await supabaseAdmin
      .from('band_import_log')
      .select('post_url')
      .in('post_url', allUrls);

    const existingUrls = new Set(
      (existingLogs ?? []).map((l: { post_url: string }) => l.post_url)
    );

    const newPosts = posts.filter(p => !existingUrls.has(p.url));
    results.skipped += posts.length - newPosts.length;
    if (newPosts.length === 0) return { ok: true, ...results };

    const analysisResults = await Promise.allSettled(
      newPosts.map(post => analyzeFromText(`${post.title}\n\n${post.content}`))
    );

    for (let i = 0; i < newPosts.length; i++) {
      const post = newPosts[i];
      const analysis = analysisResults[i];

      if (analysis.status === 'rejected' || analysis.value === null) {
        const { error: skippedLogError } = await supabaseAdmin.from('band_import_log').insert({
          post_url: post.url, post_title: post.title, status: 'skipped',
        });
        if (skippedLogError) {
          const message = sanitizeDbError(skippedLogError, 'Band skipped audit failed');
          results.failed++;
          results.errors.push(message);
        } else {
          results.skipped++;
        }
        continue;
      }

      const ai = analysis.value;
      try {
        const code = await getNextCode(ai.departure_region_code, ai.destination_code, ai.duration_days);

        await persistBandImportedProduct({
          internalCode: code,
          displayName: ai.display_name || post.title,
          departureRegion: ai.departure_region,
          supplierCode: BAND_SUPPLIER_CODE,
          departureDate: ai.departure_date,
          netPrice: ai.net_price ?? 0,
          marginRate: DEFAULT_MARGIN_RATE,
          aiTags: ai.ai_tags,
          sourceFilename: 'band_rss_auto',
          postUrl: post.url,
          postTitle: post.title,
          rawText: safeRawTextExcerpt(post.content, 2000),
        });
        results.imported++;
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
          results.skipped++;
          continue;
        }
        const message = sanitizeDbError(err, 'Band post import failed');
        const { error: failedLogError } = await supabaseAdmin.from('band_import_log').insert({
          post_url: post.url, post_title: post.title,
          status: 'failed', error_msg: message,
        });
        results.failed++;
        results.errors.push(message);
        if (failedLogError) {
          results.errors.push(sanitizeDbError(failedLogError, 'Band failure audit failed'));
        }
      }
    }
  } catch (err) {
    const msg = sanitizeDbError(err, 'RSS fetch failed');
    return { error: msg, ...results, errors: [...results.errors, msg] };
  }

  return { ok: true, ...results };
};

export const GET = withCronLogging('band-rss', handleBandRss);
