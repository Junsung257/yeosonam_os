import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getReadOnlySupabaseV3 } from './lib/blog-corpus-v3';

async function main(): Promise<void> {
  const applyDb = process.argv.includes('--apply-db');
  const writeBundled = process.argv.includes('--write-bundled');
  const writeDetailBundled = process.argv.includes('--write-detail-bundled');
  const detailSlugArg = process.argv.find((arg) => arg.startsWith('--detail-slugs='));
  const detailSlugs = [...new Set((detailSlugArg?.split('=', 2)[1] || '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean))];
  if (detailSlugs.length > 20) throw new Error('detail_snapshot_slug_limit_exceeded:20');
  if (writeDetailBundled && detailSlugs.length === 0) {
    throw new Error('detail_snapshot_slugs_required');
  }
  const client = getReadOnlySupabaseV3();
  const [{ data: publicRows, error: publicError }, { count: snapshotCount, error: snapshotError }, detailResult] = await Promise.all([
    client.from('public_blog_content_creatives')
      .select('id, slug, seo_title, seo_description, og_image_url, angle_type, category, published_at, updated_at, content_modified_at, product_id, destination, content_type, featured, featured_order, view_count')
      .eq('status', 'published').eq('channel', 'naver_blog').not('slug', 'is', null).order('published_at', { ascending: false }),
    client.from('blog_public_snapshots').select('creative_id', { count: 'exact', head: true }).eq('is_current', true),
    detailSlugs.length > 0
      ? client.from('blog_public_snapshots')
        .select('creative_id, slug, title, description, content_document, legacy_markdown, generation_meta, quality_gate, product_id, tracking_id, content_type, target_audience, landing_enabled, landing_headline, landing_subtitle, hero_image, author, review, destination, angle_type, published_at, content_modified_at, fact_checked_at')
        .eq('is_current', true)
        .in('slug', detailSlugs)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (publicError) throw new Error(`public_snapshot_source_failed:${publicError.message}`);
  if (detailResult.error) throw new Error(`detail_snapshot_source_failed:${detailResult.error.message}`);
  const detailRows = (detailResult.data || []).filter((row) => {
    const document = row.content_document as Record<string, unknown> | null;
    const body = row.legacy_markdown
      || (typeof document?.markdown === 'string' ? document.markdown : '');
    return body.replace(/\s+/g, '').length >= 200;
  });
  const checksum = createHash('sha256').update(JSON.stringify(publicRows || [])).digest('hex');
  const preview = {
    dry_run: !applyDb,
    public_rows: publicRows?.length || 0,
    current_snapshot_rows: snapshotError ? null : snapshotCount || 0,
    migration_required: Boolean(snapshotError),
    source_checksum: checksum,
    local_artifact_write: writeBundled,
    requested_detail_slugs: detailSlugs.length,
    usable_detail_rows: detailRows.length,
    local_detail_artifact_write: writeDetailBundled,
  };
  console.log(JSON.stringify(preview, null, 2));
  if (writeBundled) {
    writeFileSync('src/data/blog-public-catalog-snapshot-v3.json', `${JSON.stringify({
      generated_at: new Date().toISOString(), source: 'public_blog_content_creatives_read_only',
      count: publicRows?.length || 0, posts: publicRows || [],
    }, null, 2)}\n`);
  }
  if (writeDetailBundled) {
    const missingSlugs = detailSlugs.filter((slug) => !detailRows.some((row) => row.slug === slug));
    if (missingSlugs.length > 0) throw new Error(`detail_snapshot_missing_or_empty:${missingSlugs.join(',')}`);
    const artifact = `${JSON.stringify({
      generated_at: new Date().toISOString(),
      source: 'blog_public_snapshots_read_only',
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
