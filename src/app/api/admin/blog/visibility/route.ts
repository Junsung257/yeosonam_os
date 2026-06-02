import { NextRequest, NextResponse } from 'next/server';
import { buildVisibilityLabel, visibilityFromRank, type VisibilityPlatform } from '@/lib/ad-os-v3-v7';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type VisibilityRow = {
  slug: string;
  url: string;
  platform: VisibilityPlatform;
  request_status: 'not_requested' | 'requested' | 'request_failed' | 'unknown';
  index_status: 'unknown' | 'inspectable' | 'indexed' | 'not_indexed' | 'blocked' | 'verification_unavailable';
  visibility_status: 'unknown' | 'visible' | 'not_visible' | 'ranking_confirmed';
  best_rank: number | null;
  best_query: string | null;
  source: string;
  confidence: number;
  checked_at: string;
};

function latestByPlatform(rows: VisibilityRow[]): Record<VisibilityPlatform, VisibilityRow | null> {
  return {
    google: rows.find((row) => row.platform === 'google') || null,
    naver: rows.find((row) => row.platform === 'naver') || null,
  };
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const slug = request.nextUrl.searchParams.get('slug');
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 80), 1), 200);
  const baseUrl = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://yeosonam.com').replace(/\/$/, '');

  const [contentRes, snapshotRes, rankRes] = await Promise.all([
    supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, destination, published_at, updated_at')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from('blog_visibility_snapshots')
      .select('*')
      .order('checked_at', { ascending: false })
      .limit(limit * 4),
    supabaseAdmin
      .from('rank_history')
      .select('slug, query, date, position, impressions, clicks, source, page_url')
      .order('date', { ascending: false })
      .limit(limit * 10),
  ]);

  const firstError = contentRes.error || snapshotRes.error || rankRes.error;
  if (firstError) {
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const contents = (contentRes.data || []).filter((row: any) => !slug || row.slug === slug);
  const snapshots = (snapshotRes.data || []) as VisibilityRow[];
  const ranks = rankRes.data || [];

  const items = contents.map((content: any) => {
    const contentSlug = String(content.slug);
    const url = `${baseUrl}/blog/${contentSlug}`;
    const snap = latestByPlatform(snapshots.filter((row) => row.slug === contentSlug));
    const googleRank = ranks.find((row: any) => row.slug === contentSlug && String(row.source || '').startsWith('gsc'));
    const naverRank = ranks.find((row: any) => row.slug === contentSlug && String(row.source || '').startsWith('naver'));

    const google = snap.google
      ? {
          platform: 'google' as const,
          requestStatus: snap.google.request_status,
          indexStatus: snap.google.index_status,
          visibilityStatus: snap.google.visibility_status,
          label: buildVisibilityLabel({
            platform: 'google',
            requestStatus: snap.google.request_status,
            indexStatus: snap.google.index_status,
            visibilityStatus: snap.google.visibility_status,
            bestRank: snap.google.best_rank,
          }),
          confidence: snap.google.confidence,
          bestRank: snap.google.best_rank,
          bestQuery: snap.google.best_query,
          source: snap.google.source,
          checkedAt: snap.google.checked_at,
        }
      : visibilityFromRank({
          platform: 'google',
          requestStatus: content.published_at ? 'requested' : 'not_requested',
          rank: googleRank?.position ?? null,
          query: googleRank?.query ?? null,
          checkedAt: googleRank?.date ?? content.updated_at ?? null,
          source: googleRank ? 'gsc/rank_history' : 'google_indexing_request',
        });

    const naver = snap.naver
      ? {
          platform: 'naver' as const,
          requestStatus: snap.naver.request_status,
          indexStatus: snap.naver.index_status,
          visibilityStatus: snap.naver.visibility_status,
          label: buildVisibilityLabel({
            platform: 'naver',
            requestStatus: snap.naver.request_status,
            indexStatus: snap.naver.index_status,
            visibilityStatus: snap.naver.visibility_status,
            bestRank: snap.naver.best_rank,
          }),
          confidence: snap.naver.confidence,
          bestRank: snap.naver.best_rank,
          bestQuery: snap.naver.best_query,
          source: snap.naver.source,
          checkedAt: snap.naver.checked_at,
        }
      : visibilityFromRank({
          platform: 'naver',
          requestStatus: content.published_at ? 'requested' : 'not_requested',
          rank: naverRank?.position ?? null,
          query: naverRank?.query ?? null,
          checkedAt: naverRank?.date ?? content.updated_at ?? null,
          source: naverRank ? 'naver/rank_history' : 'indexnow_request',
        });

    return {
      content_creative_id: content.id,
      slug: contentSlug,
      title: content.seo_title,
      destination: content.destination,
      url,
      published_at: content.published_at,
      google,
      naver,
    };
  });

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    summary: {
      total: items.length,
      google_indexed: items.filter((item) => item.google.indexStatus === 'indexed').length,
      google_visible: items.filter((item) => ['visible', 'ranking_confirmed'].includes(item.google.visibilityStatus)).length,
      naver_index_requested: items.filter((item) => item.naver.requestStatus === 'requested').length,
      naver_visible: items.filter((item) => ['visible', 'ranking_confirmed'].includes(item.naver.visibilityStatus)).length,
    },
    items,
  });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const slug = String(body.slug || '');
  const url = String(body.url || '');
  const platform = body.platform === 'naver' ? 'naver' : 'google';
  if (!slug || !url) {
    return NextResponse.json({ ok: false, error: 'slug and url are required' }, { status: 400 });
  }

  const row = {
    slug,
    url,
    platform,
    request_status: body.request_status || 'requested',
    index_status: body.index_status || (platform === 'naver' ? 'verification_unavailable' : 'inspectable'),
    visibility_status: body.visibility_status || 'unknown',
    best_rank: body.best_rank || null,
    best_query: body.best_query || null,
    source: body.source || (platform === 'naver' ? 'indexnow_request' : 'google_indexing_request'),
    confidence: Number(body.confidence ?? 0.45),
    evidence: body.evidence || {},
  };

  const { data, error } = await supabaseAdmin
    .from('blog_visibility_snapshots')
    .insert(row)
    .select('*')
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, snapshot: data });
});
