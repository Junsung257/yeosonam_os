import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { classifyBlogFreshnessRisk } from '@/lib/blog-freshness-risk';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function daysBetween(a: string | null, b: Date): number {
  if (!a) return 9999;
  const time = new Date(a).getTime();
  if (!Number.isFinite(time)) return 9999;
  return Math.floor((b.getTime() - time) / 86_400_000);
}

async function runFreshnessMonitor(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase not configured', errors: [] as string[] };
  }

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 80), 1), 250);
  const dryRun = request.nextUrl.searchParams.get('dry_run') === '1';
  const now = new Date();
  const errors: string[] = [];

  try {
    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, seo_description, destination, category, published_at, updated_at, generation_meta')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .order('published_at', { ascending: true })
      .limit(limit);

    if (error) throw error;

    const reviewed = [];
    for (const post of (data || []) as Array<Record<string, any>>) {
      const risk = classifyBlogFreshnessRisk(`${post.seo_title || ''} ${post.seo_description || ''} ${post.destination || ''} ${post.category || ''}`);
      const lastTouchedAt = post.updated_at || post.published_at || null;
      const ageDays = daysBetween(lastTouchedAt, now);
      const stale = ageDays >= risk.suggestedReviewDays;
      const shouldReview = risk.level !== 'low' && stale;
      const meta = {
        ...(post.generation_meta || {}),
        freshness_monitor: {
          checked_at: now.toISOString(),
          risk,
          age_days: ageDays,
          review_due: shouldReview,
          reason: shouldReview ? `${risk.level}_risk_stale_${ageDays}d` : 'fresh_enough',
        },
      };

      reviewed.push({
        id: post.id,
        slug: post.slug,
        risk: risk.level,
        age_days: ageDays,
        review_due: shouldReview,
      });

      if (!dryRun) {
        const { error: updateError } = await supabaseAdmin
          .from('content_creatives')
          .update({ generation_meta: meta })
          .eq('id', post.id);
        if (updateError) errors.push(`${post.slug || post.id}: ${sanitizeDbError(updateError)}`);
      }
    }

    return {
      ok: true,
      dry_run: dryRun,
      reviewed_count: reviewed.length,
      review_due_count: reviewed.filter((row) => row.review_due).length,
      review_due: reviewed.filter((row) => row.review_due).slice(0, 30),
      errors,
      ranAt: now.toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: sanitizeDbError(err, 'blog freshness monitor failed'),
      errors: [sanitizeDbError(err)],
    };
  }
}

export const GET = withCronLogging('blog-freshness-monitor', runFreshnessMonitor);
