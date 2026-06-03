import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { logError } from '@/lib/sentry-logger';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

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

  try {
    const { data: posts, error } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, product_id, travel_packages(id, status, ticketing_deadline, price_dates)')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .not('product_id', 'is', null);

    if (error) throw error;
    if (!posts || posts.length === 0) {
      return { archivedCount: 0, message: 'No product-linked posts' };
    }

    const toArchive: Array<{ id: string; slug: string; reason: string }> = [];

    for (const post of posts) {
      const pkg = Array.isArray(post.travel_packages) ? post.travel_packages[0] : post.travel_packages;
      if (!pkg) {
        toArchive.push({ id: post.id, slug: post.slug, reason: 'linked_product_missing' });
        continue;
      }

      if (pkg.status === 'archived' || pkg.status === 'rejected') {
        toArchive.push({ id: post.id, slug: post.slug, reason: `product_${pkg.status}` });
        continue;
      }

      const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates as Array<{ date?: string }> : [];
      const futureDates = priceDates.filter((priceDate) => priceDate.date && priceDate.date >= today);
      const deadlineAlive = pkg.ticketing_deadline && pkg.ticketing_deadline >= today;

      if (futureDates.length === 0 && !deadlineAlive && priceDates.length > 0) {
        toArchive.push({ id: post.id, slug: post.slug, reason: 'all_dates_past' });
      }
    }

    if (toArchive.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('content_creatives')
        .update({ status: 'archived' })
        .in('id', toArchive.map((post) => post.id));

      if (upErr) throw upErr;

      try { revalidatePath('/blog'); } catch { /* noop */ }
      for (const post of toArchive) {
        try { revalidatePath(`/blog/${post.slug}`); } catch { /* noop */ }
        archived.push({ slug: post.slug, reason: post.reason });
      }
      archivedCount = toArchive.length;
    }

    console.log(`[blog-lifecycle] archived ${archivedCount} blog posts`);
    return { archivedCount, archived, checkedAt: new Date().toISOString() };
  } catch (err) {
    logError('[cron/blog-lifecycle] lifecycle processing failed', err);
    const msg = sanitizeDbError(err, 'blog lifecycle failed');
    return { errors: [msg] };
  }
};

export const GET = withCronLogging('blog-lifecycle', getHandler);
