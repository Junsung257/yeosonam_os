import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getReadOnlySupabaseV3 } from './lib/blog-corpus-v3';

async function main(): Promise<void> {
  const applyDb = process.argv.includes('--apply-db');
  const writeBundled = process.argv.includes('--write-bundled');
  const client = getReadOnlySupabaseV3();
  const [{ data: publicRows, error: publicError }, { count: snapshotCount, error: snapshotError }] = await Promise.all([
    client.from('public_blog_content_creatives')
      .select('id, slug, seo_title, seo_description, og_image_url, angle_type, category, published_at, updated_at, content_modified_at, product_id, destination, content_type, featured, featured_order, view_count')
      .eq('status', 'published').eq('channel', 'naver_blog').not('slug', 'is', null).order('published_at', { ascending: false }),
    client.from('blog_public_snapshots').select('creative_id', { count: 'exact', head: true }).eq('is_current', true),
  ]);
  if (publicError) throw new Error(`public_snapshot_source_failed:${publicError.message}`);
  const checksum = createHash('sha256').update(JSON.stringify(publicRows || [])).digest('hex');
  const preview = {
    dry_run: !applyDb,
    public_rows: publicRows?.length || 0,
    current_snapshot_rows: snapshotError ? null : snapshotCount || 0,
    migration_required: Boolean(snapshotError),
    source_checksum: checksum,
    local_artifact_write: writeBundled,
  };
  console.log(JSON.stringify(preview, null, 2));
  if (writeBundled) {
    writeFileSync('src/data/blog-public-catalog-snapshot-v3.json', `${JSON.stringify({
      generated_at: new Date().toISOString(), source: 'public_blog_content_creatives_read_only',
      count: publicRows?.length || 0, posts: publicRows || [],
    }, null, 2)}\n`);
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
