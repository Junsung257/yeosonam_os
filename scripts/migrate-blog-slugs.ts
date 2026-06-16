import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { BLOG_SLUG_REDIRECTS } from '../src/lib/blog-slug-redirects';

dotenv.config({ path: '.env.local' });
dotenv.config();

const dryRun = !process.argv.includes('--write');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const configuredBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const baseUrl = /localhost|127\.0\.0\.1/i.test(configuredBaseUrl)
  ? 'https://www.yeosonam.com'
  : (configuredBaseUrl || 'https://www.yeosonam.com');

if (!supabaseUrl || !supabaseKey) {
  console.error('[blog-slug-migrate] Missing Supabase env.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function blogUrl(slug: string): string {
  return `${baseUrl}/blog/${slug.replace(/^\/+|\/+$/g, '')}`;
}

async function enqueueIndexingJob(row: { id: string; slug: string }) {
  const url = blogUrl(row.slug);
  const now = new Date().toISOString();

  const { data: existingRows, error: existingError } = await supabase
    .from('blog_indexing_jobs')
    .select('id')
    .eq('url', url)
    .eq('type', 'URL_UPDATED')
    .in('status', ['pending', 'retry', 'processing'])
    .limit(1);

  if (existingError) throw existingError;
  const existing = existingRows?.[0] as { id?: string } | undefined;
  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('blog_indexing_jobs')
      .update({
        content_creative_id: row.id,
        slug: row.slug,
        source: 'slug_migration',
        next_attempt_at: now,
        updated_at: now,
      })
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return { jobId: existing.id, deduped: true };
  }

  const { data, error } = await supabase
    .from('blog_indexing_jobs')
    .insert({
      content_creative_id: row.id,
      slug: row.slug,
      url,
      source: 'slug_migration',
      type: 'URL_UPDATED',
      status: 'pending',
      next_attempt_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (error) throw error;
  return { jobId: (data as { id?: string } | null)?.id, deduped: false };
}

async function main() {
  const entries = Object.entries(BLOG_SLUG_REDIRECTS);
  const oldSlugs = entries.map(([oldSlug]) => oldSlug);
  const newSlugs = entries.map(([, newSlug]) => newSlug);
  const allSlugs = Array.from(new Set([...oldSlugs, ...newSlugs]));

  const { data: existingRows, error: existingError } = await supabase
    .from('content_creatives')
    .select('id, slug')
    .in('slug', allSlugs);
  if (existingError) throw existingError;

  const existingBySlug = new Map((existingRows || []).map((row) => [row.slug, row]));
  const collisions = entries
    .map(([oldSlug, newSlug]) => {
      const oldRow = existingBySlug.get(oldSlug);
      const newRow = existingBySlug.get(newSlug);
      return oldRow && newRow && oldRow.id !== newRow.id
        ? { oldSlug, oldId: oldRow.id, newSlug, newId: newRow.id }
        : null;
    })
    .filter((row): row is { oldSlug: string; oldId: string; newSlug: string; newId: string } => Boolean(row));
  if (collisions.length > 0) {
    console.error('[blog-slug-migrate] New slug collisions:', collisions);
    process.exit(1);
  }

  const { data: rows, error } = await supabase
    .from('content_creatives')
    .select('id, slug, seo_title')
    .in('slug', oldSlugs);
  if (error) throw error;

  const bySlug = new Map((rows || []).map((row) => [row.slug, row]));
  const results: Array<{
    oldSlug: string;
    newSlug: string;
    status: string;
    indexingJobId?: string;
    indexingDeduped?: boolean;
    title?: string | null;
  }> = [];

  for (const [oldSlug, newSlug] of entries) {
    const row = bySlug.get(oldSlug);
    if (!row) {
      results.push({ oldSlug, newSlug, status: 'missing_or_already_migrated' });
      continue;
    }

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('content_creatives')
        .update({ slug: newSlug, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updateError) throw updateError;

      const indexing = await enqueueIndexingJob({ id: row.id, slug: newSlug });
      results.push({
        oldSlug,
        newSlug,
        status: 'updated',
        indexingJobId: indexing.jobId,
        indexingDeduped: indexing.deduped,
        title: row.seo_title,
      });
      continue;
    }

    results.push({ oldSlug, newSlug, status: dryRun ? 'would_update' : 'updated', title: row.seo_title });
  }

  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'write', results }, null, 2));
}

main().catch((error) => {
  console.error('[blog-slug-migrate] fatal:', error);
  process.exit(1);
});
