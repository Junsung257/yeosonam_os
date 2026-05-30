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
import { triggerContentGeneration } from '@/lib/auto-content-trigger';
import { getSecret } from '@/lib/secret-registry';
import { withCronLogging } from '@/lib/cron-observability';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';

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
  if (!isSupabaseConfigured) return { error: 'DB 미설정', errors: ['DB 미설정'] };

  const rssUrl = getSecret('BAND_RSS_URL');
  if (!rssUrl) {
    return { skipped: true, reason: 'BAND_RSS_URL 미설정', errors: [] as string[] };
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
        await supabaseAdmin.from('band_import_log').insert({
          post_url: post.url, post_title: post.title, status: 'skipped',
        });
        results.skipped++;
        continue;
      }

      const ai = analysis.value;
      try {
        const code = await getNextCode(ai.departure_region_code, ai.destination_code, ai.duration_days);

        const { data: product, error } = await supabaseAdmin
          .from('products')
          .insert({
            internal_code:         code,
            display_name:          ai.display_name || post.title,
            departure_region:      ai.departure_region,
            departure_region_code: ai.departure_region_code,
            supplier_code:         BAND_SUPPLIER_CODE,
            destination:           ai.destination,
            destination_code:      ai.destination_code,
            duration_days:         ai.duration_days,
            departure_date:        ai.departure_date,
            net_price:             ai.net_price ?? 0,
            margin_rate:           DEFAULT_MARGIN_RATE,
            discount_amount:       0,
            ai_tags:               ai.ai_tags,
            status:                'DRAFT',
            source_filename:       'band_rss_auto',
          })
          .select('id')
          .single();

        if (error) {
          if (error.code === '23505') { results.skipped++; continue; }
          throw error;
        }

        const productId = (product as { id: string }).id;
        await supabaseAdmin.from('band_import_log').insert({
          post_url: post.url, post_title: post.title,
          raw_text: safeRawTextExcerpt(post.content, 2000),
          product_id: productId, status: 'imported',
        });

        void triggerContentGeneration({
          productId, displayName: ai.display_name || post.title,
          destination: ai.destination, destinationCode: ai.destination_code,
        });
        results.imported++;
      } catch (err) {
        await supabaseAdmin.from('band_import_log').insert({
          post_url: post.url, post_title: post.title,
          status: 'failed', error_msg: err instanceof Error ? err.message : '알 수 없는 오류',
        });
        results.failed++;
        results.errors.push(post.title);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'RSS 수신 실패';
    return { error: msg, ...results, errors: [...results.errors, msg] };
  }

  return { ok: true, ...results };
};

export const GET = withCronLogging('band-rss', handleBandRss);
