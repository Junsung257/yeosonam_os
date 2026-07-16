import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { logError } from '@/lib/sentry-logger';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';
import { getPublishedPackagePublicApi } from '@/lib/public-packages';

export const dynamic = 'force-dynamic';

const getHandler = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase not configured' };
  }

  const today = new Date().toISOString().split('T')[0];
  let archivedCount = 0;
  const archived: Array<{ slug: string; reason: string }> = [];
  let reconciledQueueCount = 0;

  try {
    const { data: posts, error } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, product_id')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .not('product_id', 'is', null);

    if (error) throw error;
    if (!posts || posts.length === 0) {
      return { archivedCount: 0, message: 'No product-linked posts' };
    }

    const productIds = [...new Set((posts as Array<{ product_id?: string | null }>)
      .map(post => post.product_id)
      .filter((id): id is string => Boolean(id)))];
    const publicPackages = new Map(
      (await getPublishedPackagePublicApi(supabaseAdmin, productIds))
        .map(pkg => [String(pkg.package_id), pkg] as const),
    );

    const toArchive: Array<{ id: string; slug: string; reason: string }> = [];

    for (const post of posts) {
      const productId = typeof post.product_id === 'string' ? post.product_id : null;
      const pkg = productId ? publicPackages.get(productId) : null;
      if (!pkg) {
        toArchive.push({ id: post.id, slug: post.slug, reason: 'published_public_snapshot_missing' });
        continue;
      }

      const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates as Array<{ date?: string }> : [];
      const futureDates = priceDates.filter((priceDate) => priceDate.date && priceDate.date >= today);

      if (futureDates.length === 0 && priceDates.length > 0) {
        toArchive.push({ id: post.id, slug: post.slug, reason: 'all_dates_past' });
      }
    }

    if (toArchive.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('content_creatives')
        .update({ status: 'archived' })
        .in('id', toArchive.map((post) => post.id));

      if (upErr) throw upErr;

      for (const post of toArchive) {
        revalidatePublicBlogCache(post.slug);
        archived.push({ slug: post.slug, reason: post.reason });
      }
      archivedCount = toArchive.length;
    }

    const archivedIds = toArchive.map((post) => post.id);
    if (archivedIds.length > 0) {
      const { error: queueSyncErr, count } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({
          status: 'skipped',
          last_error: 'linked article archived by blog lifecycle',
          updated_at: new Date().toISOString(),
        }, { count: 'exact' })
        .eq('status', 'published')
        .in('content_creative_id', archivedIds);

      if (queueSyncErr) throw queueSyncErr;
      reconciledQueueCount += count ?? 0;
    }

    const { data: publishedQueueRows, error: publishedQueueErr } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('id, content_creative_id')
      .eq('status', 'published')
      .not('content_creative_id', 'is', null)
      .limit(200);

    if (publishedQueueErr) throw publishedQueueErr;

    const linkedIds = [...new Set(((publishedQueueRows || []) as Array<{ content_creative_id: string | null }>)
      .map((row) => row.content_creative_id)
      .filter((id): id is string => Boolean(id)))];
    let staleQueueIds: string[] = [];

    if (linkedIds.length > 0) {
      const { data: nonPublicPosts, error: nonPublicErr } = await supabaseAdmin
        .from('content_creatives')
        .select('id, status')
        .in('id', linkedIds)
        .neq('status', 'published');

      if (nonPublicErr) throw nonPublicErr;

      const nonPublicIds = new Set(((nonPublicPosts || []) as Array<{ id: string }>).map((row) => row.id));
      staleQueueIds = ((publishedQueueRows || []) as Array<{ id: string; content_creative_id: string | null }>)
        .filter((row) => row.content_creative_id && nonPublicIds.has(row.content_creative_id))
        .map((row) => row.id);
    }

    if (staleQueueIds.length > 0) {
      const { error: staleSyncErr, count } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({
          status: 'skipped',
          last_error: 'published queue reconciled: linked article is not public',
          updated_at: new Date().toISOString(),
        }, { count: 'exact' })
        .in('id', staleQueueIds);

      if (staleSyncErr) throw staleSyncErr;
      reconciledQueueCount += count ?? 0;
    }

    console.log(`[blog-lifecycle] archived ${archivedCount} blog posts`);
    return { archivedCount, archived, reconciledQueueCount, checkedAt: new Date().toISOString() };
  } catch (err) {
    logError('[cron/blog-lifecycle] lifecycle processing failed', err);
    const msg = sanitizeDbError(err, 'blog lifecycle failed');
    return { errors: [msg] };
  }
};

export const GET = withCronLogging('blog-lifecycle', getHandler);
