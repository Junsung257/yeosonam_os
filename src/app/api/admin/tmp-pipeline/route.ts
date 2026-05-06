/**
 * GET /api/admin/tmp-pipeline
 *
 * TMP 파이프라인 현황: 임포트된 상품들의 카드뉴스·블로그·발행 상태를 한 번에 조회
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface PipelineRow {
  productId: string;
  internalCode: string;
  displayName: string;
  destination: string;
  source: string;
  importedAt: string;
  bandPostUrl: string | null;
  cardNewsStatus: string | null;
  cardNewsId: string | null;
  blogStatus: string | null;
  igPublishedAt: string | null;
  threadsPublishedAt: string | null;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ rows: [] });

  const { searchParams } = request.nextUrl;
  const source = searchParams.get('source') ?? 'all';
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));

  try {
    // 임포트된 상품 목록
    let q = supabaseAdmin
      .from('products')
      .select('id, internal_code, display_name, destination, source_filename, created_at')
      .in('source_filename', ['band_rss', 'band_text_paste', 'file_scan', 'band_rss_auto'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (source !== 'all') q = q.eq('source_filename', source);

    type ProductRow = { id: string; internal_code: string; display_name: string; destination: string; source_filename: string; created_at: string };

    const { data: products, error } = await q;
    if (error) throw error;
    if (!products?.length) return NextResponse.json({ rows: [] });

    const productIds = (products as ProductRow[]).map(p => p.id);

    // 3개 쿼리 병렬 실행
    const [{ data: cardNewsRows }, { data: blogRows }, { data: importLogs }] = await Promise.all([
      supabaseAdmin
        .from('card_news')
        .select('id, package_id, status, ig_published_at')
        .in('package_id', productIds)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('blog_topic_queue')
        .select('id, product_id, status')
        .in('product_id', productIds),
      supabaseAdmin
        .from('band_import_log')
        .select('product_id, post_url, imported_at')
        .in('product_id', productIds)
        .eq('status', 'imported'),
    ]);

    // 맵 구성
    type CardNewsRow = { id: string; package_id: string; status: string; ig_published_at: string | null };
    type BlogRow = { id: string; product_id: string; status: string };
    type ImportLog = { product_id: string; post_url: string; imported_at: string };

    const cnMap = new Map<string, CardNewsRow>();
    for (const cn of (cardNewsRows ?? []) as CardNewsRow[]) {
      if (!cnMap.has(cn.package_id)) cnMap.set(cn.package_id, cn);
    }
    const blogMap = new Map<string, BlogRow>();
    for (const b of (blogRows ?? []) as BlogRow[]) {
      if (!blogMap.has(b.product_id)) blogMap.set(b.product_id, b);
    }
    const importMap = new Map<string, ImportLog>();
    for (const l of (importLogs ?? []) as ImportLog[]) {
      if (!importMap.has(l.product_id)) importMap.set(l.product_id, l);
    }

    const rows: PipelineRow[] = (products as ProductRow[]).map(p => {
      const cn   = cnMap.get(p.id);
      const blog = blogMap.get(p.id);
      const log  = importMap.get(p.id);
      return {
        productId:           p.id,
        internalCode:        p.internal_code,
        displayName:         p.display_name,
        destination:         p.destination ?? '',
        source:              p.source_filename ?? 'manual',
        importedAt:          log?.imported_at ?? p.created_at,
        bandPostUrl:         log?.post_url ?? null,
        cardNewsStatus:      cn?.status ?? null,
        cardNewsId:          cn?.id ?? null,
        blogStatus:          blog?.status ?? null,
        igPublishedAt:       cn?.ig_published_at ?? null,
        threadsPublishedAt:  null,
      };
    });

    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
