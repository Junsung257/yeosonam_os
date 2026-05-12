/**
 * GET /api/cron/band-rss
 *
 * 밴드 RSS 피드 → 신규 게시글 자동 임포트
 * vercel.json 스케줄: "0 * * * *" (1시간마다)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { fetchBandRSS } from '@/lib/band-rss-fetcher';
import { analyzeFromText, BAND_SUPPLIER_CODE, DEFAULT_MARGIN_RATE } from '@/lib/band-ai-analyzer';
import { triggerContentGeneration } from '@/lib/auto-content-trigger';
import { getSecret } from '@/lib/secret-registry';

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

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const rssUrl = getSecret('BAND_RSS_URL');
  if (!rssUrl) {
    return NextResponse.json({ skipped: true, reason: 'BAND_RSS_URL 미설정' });
  }

  const results = { imported: 0, skipped: 0, failed: 0, errors: [] as string[] };

  try {
    const posts = await fetchBandRSS(rssUrl);
    if (posts.length === 0) return NextResponse.json({ ok: true, ...results });

    // 중복 URL 벌크 조회 (N+1 → 1 쿼리)
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

    if (newPosts.length === 0) return NextResponse.json({ ok: true, ...results });

    // AI 분석 병렬 실행
    const analysisResults = await Promise.allSettled(
      newPosts.map(post => analyzeFromText(`${post.title}\n\n${post.content}`))
    );

    // products INSERT 순차 실행 (internal_code 중복 방지)
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
          if (error.code === '23505') {
            results.skipped++;
            continue;
          }
          throw error;
        }

        const productId = (product as { id: string }).id;

        await supabaseAdmin.from('band_import_log').insert({
          post_url:   post.url,
          post_title: post.title,
          raw_text:   post.content.slice(0, 2000),
          product_id: productId,
          status:     'imported',
        });

        void triggerContentGeneration({
          productId,
          displayName:     ai.display_name || post.title,
          destination:     ai.destination,
          destinationCode: ai.destination_code,
        });
        results.imported++;
      } catch (err) {
        await supabaseAdmin.from('band_import_log').insert({
          post_url:  post.url,
          post_title: post.title,
          status:    'failed',
          error_msg: err instanceof Error ? err.message : '알 수 없는 오류',
        });
        results.failed++;
        results.errors.push(post.title);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'RSS 수신 실패', ...results },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, ...results });
}
