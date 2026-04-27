/**
 * GET /api/admin/published-feed
 *
 * 최근 14일 자동 발행물 통합 피드.
 * - content_distributions (IG/Threads/MetaAds/Kakao/GoogleAds 발행 큐)
 * - card_news (변형 + IG/Threads 직접 큐)
 * - content_creatives (블로그 발행)
 *
 * Query:
 *   ?days=14 (기본 14, 최대 60)
 *   ?platform=instagram_caption (옵션 필터)
 *   ?status=published|scheduled|failed
 *   ?limit=50 (기본 50, 최대 200)
 *   ?tenant_id=UUID (옵션, 미지정 시 전체)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FeedItem {
  source: 'distribution' | 'card_news' | 'blog';
  id: string;
  platform: string;
  status: string;
  title: string | null;
  product_id: string | null;
  product_title?: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  external_url: string | null;
  external_id: string | null;
  created_at: string;
  tenant_id: string | null;
  meta?: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [], counts: {} });

  const { searchParams } = request.nextUrl;
  const days = Math.min(60, Math.max(1, parseInt(searchParams.get('days') ?? '14', 10)));
  const limit = Math.min(200, Math.max(10, parseInt(searchParams.get('limit') ?? '50', 10)));
  const platformFilter = searchParams.get('platform') ?? undefined;
  const statusFilter = searchParams.get('status') ?? undefined;
  const tenantFilter = searchParams.get('tenant_id') ?? undefined;

  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    // 1) content_distributions
    let distQuery = supabaseAdmin
      .from('content_distributions')
      .select('id, product_id, card_news_id, platform, status, scheduled_for, published_at, external_id, external_url, created_at, tenant_id, payload')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (platformFilter) distQuery = distQuery.eq('platform', platformFilter);
    if (statusFilter) distQuery = distQuery.eq('status', statusFilter);
    if (tenantFilter) distQuery = distQuery.eq('tenant_id', tenantFilter);

    // 2) card_news 직접 큐 (IG / Threads)
    const cardQuery = supabaseAdmin
      .from('card_news')
      .select('id, title, package_id, ig_publish_status, ig_post_id, ig_published_at, ig_scheduled_for, threads_publish_status, threads_post_id, threads_published_at, threads_scheduled_for, created_at')
      .or('ig_publish_status.in.(queued,publishing,published,failed),threads_publish_status.in.(queued,publishing,published,failed)')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);

    // 3) content_creatives (블로그)
    let blogQuery = supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, product_id, channel, status, published_at, created_at, tenant_id')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (tenantFilter) blogQuery = blogQuery.eq('tenant_id', tenantFilter);

    const [{ data: dists }, { data: cards }, { data: blogs }] = await Promise.all([
      distQuery, cardQuery, blogQuery,
    ]);

    // product_id 묶어서 title 한 번에 조회 (N+1 방지)
    const productIds = new Set<string>();
    ((dists ?? []) as Array<{ product_id: string | null }>).forEach((d) => { if (d.product_id) productIds.add(d.product_id); });
    ((cards ?? []) as Array<{ package_id: string | null }>).forEach((c) => { if (c.package_id) productIds.add(c.package_id); });
    ((blogs ?? []) as Array<{ product_id: string | null }>).forEach((b) => { if (b.product_id) productIds.add(b.product_id); });
    const productTitleMap = new Map<string, string>();
    if (productIds.size > 0) {
      const { data: prods } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title')
        .in('id', Array.from(productIds));
      ((prods ?? []) as Array<{ id: string; title: string }>).forEach((p) => productTitleMap.set(p.id, p.title));
    }

    const items: FeedItem[] = [];

    for (const d of dists ?? []) {
      items.push({
        source: 'distribution',
        id: d.id,
        platform: d.platform,
        status: d.status,
        title: extractPayloadTitle(d.platform, d.payload as Record<string, unknown>),
        product_id: d.product_id,
        product_title: d.product_id ? productTitleMap.get(d.product_id) ?? null : null,
        scheduled_for: d.scheduled_for,
        published_at: d.published_at,
        external_url: d.external_url,
        external_id: d.external_id,
        created_at: d.created_at,
        tenant_id: d.tenant_id,
      });
    }

    for (const c of cards ?? []) {
      // IG row
      if (c.ig_publish_status && ['queued', 'publishing', 'published', 'failed'].includes(c.ig_publish_status)) {
        if (!platformFilter || platformFilter === 'instagram_carousel') {
          if (!statusFilter || c.ig_publish_status === statusFilter) {
            items.push({
              source: 'card_news',
              id: `${c.id}::ig`,
              platform: 'instagram_carousel',
              status: c.ig_publish_status,
              title: c.title,
              product_id: c.package_id,
              product_title: c.package_id ? productTitleMap.get(c.package_id) ?? null : null,
              scheduled_for: c.ig_scheduled_for,
              published_at: c.ig_published_at,
              external_url: c.ig_post_id ? `https://www.instagram.com/p/${c.ig_post_id}/` : null,
              external_id: c.ig_post_id,
              created_at: c.created_at,
              tenant_id: null,
            });
          }
        }
      }
      // Threads row
      if (c.threads_publish_status && ['queued', 'publishing', 'published', 'failed'].includes(c.threads_publish_status)) {
        if (!platformFilter || platformFilter === 'threads_carousel') {
          if (!statusFilter || c.threads_publish_status === statusFilter) {
            items.push({
              source: 'card_news',
              id: `${c.id}::threads`,
              platform: 'threads_carousel',
              status: c.threads_publish_status,
              title: c.title,
              product_id: c.package_id,
              product_title: c.package_id ? productTitleMap.get(c.package_id) ?? null : null,
              scheduled_for: c.threads_scheduled_for,
              published_at: c.threads_published_at,
              external_url: c.threads_post_id ? `https://www.threads.net/post/${c.threads_post_id}` : null,
              external_id: c.threads_post_id,
              created_at: c.created_at,
              tenant_id: null,
            });
          }
        }
      }
    }

    for (const b of blogs ?? []) {
      if (platformFilter && platformFilter !== 'blog_body') continue;
      if (statusFilter && b.status !== statusFilter) continue;
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://yeosonam.com';
      items.push({
        source: 'blog',
        id: b.id,
        platform: 'blog_body',
        status: b.status,
        title: b.seo_title,
        product_id: b.product_id,
        product_title: b.product_id ? productTitleMap.get(b.product_id) ?? null : null,
        scheduled_for: null,
        published_at: b.published_at,
        external_url: b.slug ? `${baseUrl}/blog/${b.slug}` : null,
        external_id: b.slug,
        created_at: b.created_at,
        tenant_id: b.tenant_id,
      });
    }

    // 시간 역순 정렬 + limit 적용
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const trimmed = items.slice(0, limit);

    // 카운트 집계
    const counts: Record<string, number> = {};
    for (const i of items) {
      const key = `${i.platform}:${i.status}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }

    return NextResponse.json({
      items: trimmed,
      counts,
      total: items.length,
      window_days: days,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}

function extractPayloadTitle(platform: string, payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (platform === 'instagram_caption') return ((payload.preview_hook as string) ?? (payload.caption as string) ?? '').slice(0, 60) || null;
  if (platform === 'threads_post') return ((payload.main as string) ?? '').slice(0, 60) || null;
  if (platform === 'meta_ads') return ((payload.headlines as string[])?.[0]) ?? null;
  if (platform === 'kakao_channel') return ((payload.message_text as string) ?? '').slice(0, 60) || null;
  if (platform === 'google_ads_rsa') return ((payload.headlines as string[])?.[0]) ?? null;
  return null;
}
