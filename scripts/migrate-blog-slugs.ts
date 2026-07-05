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

type BlogSlugMigrationRow = {
  id: string;
  slug: string | null;
  seo_title: string | null;
  blog_html?: string | null;
  og_image_url?: string | null;
  generation_meta?: unknown;
};

function replaceSlugReferences(value: string | null | undefined, oldSlug: string, newSlug: string): string | null | undefined {
  if (typeof value !== 'string' || !value) return value;
  const encodedOld = encodeURIComponent(oldSlug);
  const encodedNew = encodeURIComponent(newSlug);
  const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replaceBounded = (text: string, from: string, to: string) => {
    const pattern = new RegExp(`(?<![a-z0-9-])${escapeRegExp(from)}(?![a-z0-9-])`, 'gi');
    return text.replace(pattern, to);
  };
  let next = value
    .replace(new RegExp(`/blog/${escapeRegExp(oldSlug)}(?=\\b|[/?#"'&])`, 'g'), `/blog/${newSlug}`)
    .replace(new RegExp(`/blog/${escapeRegExp(encodedOld)}(?=\\b|[/?#"'&])`, 'g'), `/blog/${encodedNew}`)
    .replace(new RegExp(`([?&](?:blog|utm_campaign|utm_content)=)${escapeRegExp(oldSlug)}(?=\\b|[&#"'])`, 'g'), `$1${newSlug}`)
    .replace(new RegExp(`([?&](?:blog|utm_campaign|utm_content)=)${escapeRegExp(encodedOld)}(?=\\b|[&#"'])`, 'g'), `$1${encodedNew}`)
    .replace(new RegExp(`("slug"\\s*:\\s*")${escapeRegExp(oldSlug)}(")`, 'g'), `$1${newSlug}$2`)
    .replace(new RegExp(`("utm_campaign"\\s*:\\s*")${escapeRegExp(oldSlug)}(")`, 'g'), `$1${newSlug}$2`)
    .replace(new RegExp(`("utm_content"\\s*:\\s*")${escapeRegExp(oldSlug)}(")`, 'g'), `$1${newSlug}$2`)
    .replace(new RegExp(`("blog"\\s*:\\s*")${escapeRegExp(oldSlug)}(")`, 'g'), `$1${newSlug}$2`)
    .replace(new RegExp(`(blog=)${escapeRegExp(oldSlug)}(?=\\b|[&#"'])`, 'g'), `$1${newSlug}`)
    .replace(new RegExp(`(blog=)${escapeRegExp(encodedOld)}(?=\\b|[&#"'])`, 'g'), `$1${encodedNew}`);
  next = replaceBounded(next, oldSlug, newSlug);
  next = replaceBounded(next, encodedOld, encodedNew);
  return next;
}

function replaceSlugReferencesInJson(value: unknown, oldSlug: string, newSlug: string): unknown {
  if (value == null) return value;
  const serialized = JSON.stringify(value);
  if (!serialized.includes(oldSlug) && !serialized.includes(encodeURIComponent(oldSlug))) return value;
  return JSON.parse(replaceSlugReferences(serialized, oldSlug, newSlug) || serialized);
}

function buildReferencePatch(row: BlogSlugMigrationRow, oldSlug: string, newSlug: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const nextHtml = replaceSlugReferences(row.blog_html, oldSlug, newSlug);
  if (typeof nextHtml === 'string' && nextHtml !== row.blog_html) patch.blog_html = nextHtml;

  const nextOg = replaceSlugReferences(row.og_image_url, oldSlug, newSlug);
  if (typeof nextOg === 'string' && nextOg !== row.og_image_url) patch.og_image_url = nextOg;

  const nextMeta = replaceSlugReferencesInJson(row.generation_meta, oldSlug, newSlug);
  if (nextMeta !== row.generation_meta) patch.generation_meta = nextMeta;

  return patch;
}

async function main() {
  const entries = Object.entries(BLOG_SLUG_REDIRECTS);
  const oldSlugs = entries.map(([oldSlug]) => oldSlug);
  const newSlugs = entries.map(([, newSlug]) => newSlug);
  const allSlugs = Array.from(new Set([...oldSlugs, ...newSlugs]));

  const { data: existingRows, error: existingError } = await supabase
    .from('content_creatives')
    .select('id, slug, seo_title, blog_html, og_image_url, generation_meta')
    .in('slug', allSlugs);
  if (existingError) throw existingError;

  const existingBySlug = new Map(((existingRows || []) as BlogSlugMigrationRow[]).map((row) => [row.slug, row]));
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

  const results: Array<{
    oldSlug: string;
    newSlug: string;
    status: string;
    indexingJobId?: string;
    indexingDeduped?: boolean;
    internalReferencesRewritten?: boolean;
    title?: string | null;
  }> = [];

  for (const [oldSlug, newSlug] of entries) {
    const row = existingBySlug.get(oldSlug);
    if (!row) {
      const alreadyMigrated = existingBySlug.get(newSlug);
      const referencePatch = alreadyMigrated ? buildReferencePatch(alreadyMigrated, oldSlug, newSlug) : {};
      if (alreadyMigrated && Object.keys(referencePatch).length > 0) {
        let indexing: Awaited<ReturnType<typeof enqueueIndexingJob>> | null = null;
        if (!dryRun) {
          const { error: rewriteError } = await supabase
            .from('content_creatives')
            .update({ ...referencePatch, updated_at: new Date().toISOString() })
            .eq('id', alreadyMigrated.id);
          if (rewriteError) throw rewriteError;
          indexing = await enqueueIndexingJob({ id: alreadyMigrated.id, slug: newSlug });
        }
        results.push({
          oldSlug,
          newSlug,
          status: dryRun ? 'would_rewrite_internal_references' : 'rewrote_internal_references',
          indexingJobId: indexing?.jobId,
          indexingDeduped: indexing?.deduped,
          internalReferencesRewritten: true,
          title: alreadyMigrated.seo_title,
        });
        continue;
      }
      results.push({ oldSlug, newSlug, status: 'missing_or_already_migrated' });
      continue;
    }

    const referencePatch = buildReferencePatch(row, oldSlug, newSlug);
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('content_creatives')
        .update({ ...referencePatch, slug: newSlug, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updateError) throw updateError;

      const indexing = await enqueueIndexingJob({ id: row.id, slug: newSlug });
      results.push({
        oldSlug,
        newSlug,
        status: 'updated',
        indexingJobId: indexing.jobId,
        indexingDeduped: indexing.deduped,
        internalReferencesRewritten: Object.keys(referencePatch).length > 0,
        title: row.seo_title,
      });
      continue;
    }

    results.push({
      oldSlug,
      newSlug,
      status: dryRun ? 'would_update' : 'updated',
      internalReferencesRewritten: Object.keys(referencePatch).length > 0,
      title: row.seo_title,
    });
  }

  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'write', results }, null, 2));
}

main().catch((error) => {
  console.error('[blog-slug-migrate] fatal:', error);
  process.exit(1);
});
