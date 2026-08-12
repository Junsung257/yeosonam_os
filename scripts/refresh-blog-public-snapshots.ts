import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getReadOnlySupabaseV3 } from './lib/blog-corpus-v3';

function compactDetailGenerationMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return {
    ...(source.content_brief && typeof source.content_brief === 'object'
      ? { content_brief: source.content_brief }
      : {}),
    ...(source.content_brief_v3 && typeof source.content_brief_v3 === 'object'
      ? { content_brief_v3: source.content_brief_v3 }
      : {}),
  };
}

function compactDetailQualityGate(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const minutes = (value as Record<string, unknown>).rendered_reading_time_minutes;
  return typeof minutes === 'number' ? { rendered_reading_time_minutes: minutes } : {};
}

async function main(): Promise<void> {
  const applyDb = process.argv.includes('--apply-db');
  const writeBundled = process.argv.includes('--write-bundled');
  const writeDetailBundled = process.argv.includes('--write-detail-bundled');
  const allDetails = process.argv.includes('--all-details');
  const detailSlugArg = process.argv.find((arg) => arg.startsWith('--detail-slugs='));
  const detailSlugs = [...new Set((detailSlugArg?.split('=', 2)[1] || '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean))];
  if (!allDetails && detailSlugs.length > 20) throw new Error('detail_snapshot_slug_limit_exceeded:20');
  if (writeDetailBundled && !allDetails && detailSlugs.length === 0) {
    throw new Error('detail_snapshot_slugs_required');
  }
  const client = getReadOnlySupabaseV3();
  let publicResult = await client.from('public_blog_content_creatives')
    .select('id, slug, seo_title, seo_description, og_image_url, angle_type, category, published_at, updated_at, content_modified_at, product_id, destination, content_type, featured, featured_order, view_count')
    .eq('status', 'published').eq('channel', 'naver_blog').not('slug', 'is', null)
    .order('published_at', { ascending: false }).limit(500);
  if (publicResult.error?.code === '42703') {
    publicResult = await client.from('public_blog_content_creatives')
      .select('id, slug, seo_title, seo_description, og_image_url, angle_type, category, published_at, updated_at, product_id, destination, content_type, featured, featured_order, view_count')
      .eq('status', 'published').eq('channel', 'naver_blog').not('slug', 'is', null)
      .order('published_at', { ascending: false }).limit(500) as typeof publicResult;
  }
  if (publicResult.error) throw new Error(`public_snapshot_source_failed:${publicResult.error.message}`);
  const publicRows = (publicResult.data || []).map((row) => ({
    ...row,
    content_modified_at: row.content_modified_at ?? row.updated_at ?? row.published_at,
  }));

  const { count: snapshotCount, error: snapshotError } = await client
    .from('blog_public_snapshots')
    .select('creative_id', { count: 'exact' })
    .eq('is_current', true)
    .limit(1);
  let detailRowsRaw: Array<Record<string, any>> = [];
  let detailSource = 'blog_public_snapshots_read_only';
  if (writeDetailBundled || detailSlugs.length > 0 || allDetails) {
    let snapshotDetailUnavailable = Boolean(snapshotError);
    if (!snapshotError) {
      let query = client.from('blog_public_snapshots')
        .select('creative_id, slug, title, description, content_document, legacy_markdown, generation_meta, quality_gate, product_id, tracking_id, content_type, target_audience, landing_enabled, landing_headline, landing_subtitle, hero_image, author, review, destination, angle_type, published_at, content_modified_at, fact_checked_at')
        .eq('is_current', true)
        .order('published_at', { ascending: false })
        .limit(500);
      if (!allDetails) query = query.in('slug', detailSlugs);
      const result = await query;
      if (result.error) {
        if (['42P01', 'PGRST205'].includes(result.error.code || '')) {
          snapshotDetailUnavailable = true;
        } else {
          throw new Error(`detail_snapshot_source_failed:${result.error.message}`);
        }
      } else {
        detailRowsRaw = (result.data || []) as Array<Record<string, any>>;
      }
    }
    if (snapshotDetailUnavailable) {
      detailSource = 'public_blog_content_creatives_legacy_read_only';
      let query = client.from('public_blog_content_creatives')
        .select('id, slug, seo_title, seo_description, og_image_url, blog_html, generation_meta, quality_gate, product_id, tracking_id, content_type, target_audience, landing_enabled, landing_headline, landing_subtitle, destination, angle_type, published_at, updated_at')
        .eq('status', 'published').eq('channel', 'naver_blog').not('slug', 'is', null)
        .order('published_at', { ascending: false })
        .limit(500);
      if (!allDetails) query = query.in('slug', detailSlugs);
      const result = await query;
      if (result.error) throw new Error(`legacy_detail_snapshot_source_failed:${result.error.message}`);
      detailRowsRaw = (result.data || []).map((row) => ({
        creative_id: row.id,
        slug: row.slug,
        title: row.seo_title || row.slug,
        description: row.seo_description,
        content_document: null,
        legacy_markdown: row.blog_html,
        generation_meta: row.generation_meta || {},
        quality_gate: row.quality_gate || {},
        product_id: row.product_id,
        tracking_id: row.tracking_id,
        content_type: row.content_type,
        target_audience: row.target_audience,
        landing_enabled: Boolean(row.landing_enabled),
        landing_headline: row.landing_headline,
        landing_subtitle: row.landing_subtitle,
        hero_image: row.og_image_url ? { url: row.og_image_url } : null,
        author: null,
        review: null,
        destination: row.destination,
        angle_type: row.angle_type,
        published_at: row.published_at,
        content_modified_at: row.updated_at || row.published_at,
        fact_checked_at: null,
      }));
    }
  }
  const detailRows: Array<Record<string, any>> = detailRowsRaw.map((row): Record<string, any> => ({
    ...row,
    content_document: row.legacy_markdown ? null : row.content_document,
    generation_meta: compactDetailGenerationMeta(row.generation_meta),
    quality_gate: compactDetailQualityGate(row.quality_gate),
  })).filter((row) => {
    const document = row.content_document as Record<string, unknown> | null;
    const body = row.legacy_markdown
      || (typeof document?.markdown === 'string' ? document.markdown : '');
    return body.replace(/\s+/g, '').length >= 200;
  });
  const checksum = createHash('sha256').update(JSON.stringify(publicRows)).digest('hex');
  const preview = {
    dry_run: !applyDb,
    public_rows: publicRows.length,
    current_snapshot_rows: snapshotError ? null : snapshotCount || 0,
    migration_required: Boolean(snapshotError),
    source_checksum: checksum,
    local_artifact_write: writeBundled,
    requested_detail_slugs: allDetails ? publicRows.length : detailSlugs.length,
    usable_detail_rows: detailRows.length,
    local_detail_artifact_write: writeDetailBundled,
  };
  console.log(JSON.stringify(preview, null, 2));
  if (writeBundled) {
    writeFileSync('src/data/blog-public-catalog-snapshot-v3.json', `${JSON.stringify({
      generated_at: new Date().toISOString(), source: 'public_blog_content_creatives_read_only',
      count: publicRows.length, posts: publicRows,
    }, null, 2)}\n`);
  }
  if (writeDetailBundled) {
    const requestedDetailSlugs = allDetails ? publicRows.map((row) => String(row.slug)) : detailSlugs;
    const missingSlugs = requestedDetailSlugs.filter((slug) => !detailRows.some((row) => row.slug === slug));
    if (missingSlugs.length > 0) throw new Error(`detail_snapshot_missing_or_empty:${missingSlugs.join(',')}`);
    const artifact = `${JSON.stringify({
      generated_at: new Date().toISOString(),
      source: detailSource,
      count: detailRows.length,
      posts: detailRows,
    }, null, 2)}\n`;
    if (Buffer.byteLength(artifact, 'utf8') > 8 * 1024 * 1024) {
      throw new Error('detail_snapshot_bundle_exceeds_8mb');
    }
    writeFileSync('src/data/blog-public-detail-snapshot-v3.json', artifact);
  }
  if (!applyDb) return;
  if (process.env.BLOG_SNAPSHOT_APPLY_CONFIRM !== 'PUBLIC_ELIGIBILITY_REVIEWED') throw new Error('snapshot_apply_confirmation_missing');
  const { data, error } = await client.rpc('refresh_blog_public_snapshots_v3');
  if (error) throw new Error(`snapshot_refresh_failed:${error.message}`);
  console.log(JSON.stringify({ applied: true, result: data }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
