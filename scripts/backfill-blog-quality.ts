import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { finalizeBlogPost } from '../src/lib/blog-post-finalizer';
import { normalizeBlogDescription, normalizeBlogTitle } from '../src/lib/blog-quality-normalizer';
import { destToEnKeyword, getRandomPexelsPhoto, isPexelsConfigured } from '../src/lib/pexels';
import { extractDestination } from '../src/lib/slug-utils';

dotenv.config({ path: '.env.local' });
dotenv.config();

type BlogRow = {
  id: string;
  slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  destination: string | null;
  blog_html: string | null;
};

type AuditRow = {
  slug: string;
  missingOgBefore: boolean;
  missingOgAfter: boolean;
  imageCountBefore: number;
  imageCountAfter: number;
  faqMissingBefore: boolean;
  faqMissingAfter: boolean;
  tldrMissingBefore: boolean;
  tldrMissingAfter: boolean;
  rewriteTraceBefore: boolean;
  rewriteTraceAfter: boolean;
  highlightCountBefore: number;
  highlightCountAfter: number;
  titleChanged: boolean;
  descriptionChanged: boolean;
  changed: boolean;
};

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--write');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const slugArg = process.argv.find((arg) => arg.startsWith('--slug='));
const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] || '', 10) : 100;
const slugFilter = slugArg ? slugArg.split('=').slice(1).join('=').trim() : '';
const configuredBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const baseUrl = /localhost|127\.0\.0\.1/i.test(configuredBaseUrl)
  ? 'https://www.yeosonam.com'
  : (configuredBaseUrl || 'https://www.yeosonam.com');
const rewriteTracePattern = new RegExp('\\uC7AC\\uC791\\uC131\\s*v?\\d|rewrite\\s*v?\\d', 'i');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[blog-quality] Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function countInlineImages(html: string): number {
  return (html.match(/!\[[^\]]*\]\(([^)]+)\)|<img\b/gi) || []).length;
}

function countHighlights(html: string): number {
  const markMatches = html.match(/<mark\b/gi) || [];
  const markdownMatches = html.match(/==[^=]+==/g) || [];
  return markMatches.length + markdownMatches.length;
}

function hasFaq(html: string): boolean {
  return /(^|\n)##\s*(FAQ|자주 묻는 질문)/im.test(html);
}

function hasSummary(html: string): boolean {
  return /(TL;DR|핵심 요약|한눈에|요약)/i.test(html);
}

function hasRewriteTrace(text: string): boolean {
  return rewriteTracePattern.test(text);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function primaryKeywordFor(row: BlogRow): string {
  const basis = row.destination || row.seo_title || row.slug || 'travel';
  return basis.trim();
}

async function resolveOgImage(row: BlogRow): Promise<string | null> {
  if (row.og_image_url?.trim()) return row.og_image_url.trim();
  if (!isPexelsConfigured()) return null;

  const destination = row.destination || extractDestination(row.seo_title || row.slug || '');
  const query = destToEnKeyword(destination || primaryKeywordFor(row));
  try {
    const photo = await getRandomPexelsPhoto(query);
    return photo?.src?.large2x || photo?.src?.large || photo?.src?.original || null;
  } catch (err) {
    console.warn(`[blog-quality] Pexels fallback failed for ${row.slug}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function revalidate(paths: string[]) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || paths.length === 0) return;

  try {
    await fetch(`${baseUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, secret }),
    });
  } catch (err) {
    console.warn('[blog-quality] revalidate failed:', err instanceof Error ? err.message : err);
  }
}

async function main() {
  let query = supabase
    .from('content_creatives')
    .select('id, slug, seo_title, seo_description, og_image_url, destination, blog_html')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false });

  if (slugFilter) {
    query = query.eq('slug', slugFilter);
  } else if (Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = ((data || []) as BlogRow[]).filter((row) => typeof row.slug === 'string' && typeof row.blog_html === 'string');
  const auditRows: AuditRow[] = [];
  const changedSlugs: string[] = [];

  for (const row of rows) {
    const originalHtml = row.blog_html || '';
    const originalOg = row.og_image_url?.trim() || null;
    const originalTitle = row.seo_title?.trim() || null;
    const originalDescription = row.seo_description?.trim() || null;
    const destination = row.destination || extractDestination(row.seo_title || row.slug || '');
    const primaryKeyword = primaryKeywordFor(row);
    const resolvedOgImage = await resolveOgImage(row);
    const normalizedTitle = normalizeBlogTitle(row.seo_title) || row.seo_title || row.slug || '여행 가이드';
    const normalizedDescription = normalizeBlogDescription(row.seo_description) || row.seo_description || null;

    const finalized = await finalizeBlogPost({
      blogHtml: originalHtml,
      destination,
      primaryKeyword,
      ogImageUrl: resolvedOgImage,
      inlineImageSeedUrl: resolvedOgImage,
      minImages: 3,
      maxImages: 4,
      fallbackOgImageUrl: `${baseUrl}/og-image.png`,
    });

    const nextHtml = finalized.blogHtml;
    const nextOg = finalized.ogImageUrl;
    const changed =
      nextHtml !== originalHtml ||
      nextOg !== originalOg ||
      normalizedTitle !== originalTitle ||
      normalizedDescription !== originalDescription;
    const slug = row.slug || row.id;

    auditRows.push({
      slug,
      missingOgBefore: !originalOg,
      missingOgAfter: !nextOg,
      imageCountBefore: countInlineImages(originalHtml),
      imageCountAfter: countInlineImages(nextHtml),
      faqMissingBefore: !hasFaq(originalHtml),
      faqMissingAfter: !hasFaq(nextHtml),
      tldrMissingBefore: !hasSummary(originalHtml),
      tldrMissingAfter: !hasSummary(nextHtml),
      rewriteTraceBefore: hasRewriteTrace(`${row.seo_title || ''}\n${originalHtml}`),
      rewriteTraceAfter: hasRewriteTrace(`${normalizedTitle}\n${nextHtml}`),
      highlightCountBefore: countHighlights(originalHtml),
      highlightCountAfter: countHighlights(nextHtml),
      titleChanged: normalizedTitle !== originalTitle,
      descriptionChanged: normalizedDescription !== originalDescription,
      changed,
    });

    if (!changed || dryRun) continue;

    const { error: updateError } = await supabase
      .from('content_creatives')
      .update({
        blog_html: nextHtml,
        og_image_url: nextOg,
        seo_title: normalizedTitle,
        seo_description: normalizedDescription,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) {
      console.error(`[blog-quality] update failed for ${slug}:`, updateError.message);
      continue;
    }

    changedSlugs.push(slug);
    console.log(`[blog-quality] updated ${slug}`);
  }

  if (!dryRun && changedSlugs.length > 0) {
    await revalidate(['/blog', ...changedSlugs.map((slug) => `/blog/${slug}`)]);
  }

  const highlightCountsBefore = auditRows.map((row) => row.highlightCountBefore);
  const highlightCountsAfter = auditRows.map((row) => row.highlightCountAfter);
  const summary = {
    mode: dryRun ? 'dry-run' : 'write',
    scanned: auditRows.length,
    changed: auditRows.filter((row) => row.changed).length,
    updated: changedSlugs.length,
    titlesNormalized: auditRows.filter((row) => row.titleChanged).length,
    descriptionsNormalized: auditRows.filter((row) => row.descriptionChanged).length,
    missingOgBefore: auditRows.filter((row) => row.missingOgBefore).length,
    missingOgAfter: auditRows.filter((row) => row.missingOgAfter).length,
    zeroImagePostsBefore: auditRows.filter((row) => row.imageCountBefore === 0).length,
    zeroImagePostsAfter: auditRows.filter((row) => row.imageCountAfter === 0).length,
    faqMissingBefore: auditRows.filter((row) => row.faqMissingBefore).length,
    faqMissingAfter: auditRows.filter((row) => row.faqMissingAfter).length,
    tldrMissingBefore: auditRows.filter((row) => row.tldrMissingBefore).length,
    tldrMissingAfter: auditRows.filter((row) => row.tldrMissingAfter).length,
    rewriteTraceBefore: auditRows.filter((row) => row.rewriteTraceBefore).length,
    rewriteTraceAfter: auditRows.filter((row) => row.rewriteTraceAfter).length,
    highlightAverageBefore: highlightCountsBefore.length > 0
      ? Number((highlightCountsBefore.reduce((sum, value) => sum + value, 0) / highlightCountsBefore.length).toFixed(2))
      : 0,
    highlightAverageAfter: highlightCountsAfter.length > 0
      ? Number((highlightCountsAfter.reduce((sum, value) => sum + value, 0) / highlightCountsAfter.length).toFixed(2))
      : 0,
    highlightMedianBefore: percentile(highlightCountsBefore, 0.5),
    highlightMedianAfter: percentile(highlightCountsAfter, 0.5),
    highlightP75Before: percentile(highlightCountsBefore, 0.75),
    highlightP75After: percentile(highlightCountsAfter, 0.75),
    highlightMaxBefore: highlightCountsBefore.length > 0 ? Math.max(...highlightCountsBefore) : 0,
    highlightMaxAfter: highlightCountsAfter.length > 0 ? Math.max(...highlightCountsAfter) : 0,
    samples: auditRows.filter((row) => row.changed).slice(0, 10).map((row) => row.slug),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[blog-quality] fatal:', err);
  process.exit(1);
});
