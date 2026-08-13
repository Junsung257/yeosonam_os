import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { computeBlogImagePerceptualHashV3, findCrossDestinationImageDuplicatesV3 } from '../src/lib/blog-image-quality-v3';
import {
  extractImagesV3,
  getReadOnlySupabaseV3,
  loadCorpusRowsV3,
  toCsvV3,
  type CorpusRowV3,
} from './lib/blog-corpus-v3';

interface MediaRow {
  id: string;
  asset_id: string;
  url: string;
  location_entity_id: string | null;
  image_type: string;
  is_first_party: boolean;
  is_generated: boolean;
  perceptual_hash: string | null;
  width: number | null;
  height: number | null;
}

interface HashResult {
  url: string;
  perceptualHash: string | null;
  reason: string | null;
  durationMs: number;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    if (value.startsWith('::ffff:') && value.includes('.')) {
      return isPrivateAddress(value.slice('::ffff:'.length));
    }
    return value === '::1' || value === '::' || value.startsWith('fc')
      || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9')
      || value.startsWith('fea') || value.startsWith('feb');
  }
  return true;
}

async function assertPublicImageUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('unsafe_image_url');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('private_image_address');
  return url;
}

async function fetchImage(raw: string): Promise<Buffer> {
  let current = raw;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const url = await assertPublicImageUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: { 'user-agent': 'YeosonamBlogImageAudit/3.0' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('image_redirect_without_location');
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new Error(`image_http_${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) throw new Error('image_content_type_required');
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > 12 * 1024 * 1024) throw new Error('image_exceeds_12mb');
    if (!response.body) throw new Error('image_body_missing');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 12 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('image_exceeds_12mb');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), received);
  }
  throw new Error('image_redirect_limit');
}

function mediaRowsFromCorpus(rows: Array<Pick<CorpusRowV3, 'id' | 'destination' | 'blog_html' | 'og_image_url'>>): MediaRow[] {
  return rows.flatMap((creative) => [
    ...extractImagesV3(creative.blog_html || '').map((image) => image.url),
    ...(creative.og_image_url ? [creative.og_image_url] : []),
  ].map((url, occurrenceIndex) => {
    const key = createHash('sha256')
      .update(`${url}|${creative.id}|${occurrenceIndex}`)
      .digest('hex')
      .slice(0, 24);
    return {
      id: `corpus:${key}`,
      asset_id: `corpus:${key}`,
      url,
      location_entity_id: creative.destination,
      image_type: 'stock',
      is_first_party: false,
      is_generated: false,
      perceptual_hash: null,
      width: null,
      height: null,
    };
  }));
}

function canonicalSourceAssetKey(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase()}${url.pathname}`;
  } catch {
    return raw;
  }
}

function loadBundledPublicSnapshotRows(): MediaRow[] {
  const snapshotPath = 'src/data/blog-public-detail-snapshot-v3.json';
  if (!existsSync(snapshotPath)) throw new Error('blog_public_detail_snapshot_missing');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
    posts?: Array<{
      creative_id?: string;
      destination?: string | null;
      legacy_markdown?: string | null;
      hero_image?: string | { url?: string | null } | null;
    }>;
  };
  const posts = Array.isArray(snapshot.posts) ? snapshot.posts : [];
  return mediaRowsFromCorpus(posts.map((post, index) => {
    const heroImageUrl = typeof post.hero_image === 'string'
      ? post.hero_image
      : post.hero_image?.url;
    return {
      id: String(post.creative_id || `snapshot-${index}`),
      destination: post.destination || null,
      blog_html: post.legacy_markdown || null,
      og_image_url: heroImageUrl || null,
    };
  }));
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = Math.max(1, Math.min(Number(limitArg?.split('=', 2)[1] || 100), 1000));
  const concurrencyArg = process.argv.find((arg) => arg.startsWith('--concurrency='));
  const concurrency = Math.max(
    1,
    Math.min(Number(concurrencyArg?.split('=', 2)[1] || (apply ? 2 : 8)), 16),
  );
  if (apply && process.env.BLOG_IMAGE_PHASH_APPLY_CONFIRM !== 'DRY_RUN_REVIEWED') {
    throw new Error('phash_apply_confirmation_missing');
  }
  const client = getReadOnlySupabaseV3();
  const registryResult = await client.from('blog_media_assets')
    .select('id, asset_id, url, location_entity_id, image_type, is_first_party, is_generated, perceptual_hash, width, height')
    .order('created_at', { ascending: true })
    .limit(5000);
  if (apply && registryResult.error) throw new Error(`media_registry_read_failed:${registryResult.error.message}`);
  let source = 'blog_media_assets';
  let sourceReadError: string | null = registryResult.error?.message || null;
  let rows = (registryResult.data || []) as MediaRow[];
  if (!apply && (registryResult.error || rows.length === 0)) {
    source = 'content_creatives_read_only_fallback';
    try {
      rows = mediaRowsFromCorpus(await loadCorpusRowsV3(client));
      sourceReadError = null;
    } catch (corpusError) {
      source = 'bundled_public_detail_snapshot_fallback';
      sourceReadError = corpusError instanceof Error ? corpusError.message : 'corpus_read_failed';
      rows = loadBundledPublicSnapshotRows();
    }
  }
  const missingRows = rows.filter((row) => !row.perceptual_hash);
  const uniqueMissingUrls = [...new Set(missingRows.map((row) => row.url))];
  const selectedUrls = uniqueMissingUrls.slice(0, limit);
  const selectedUrlSet = new Set(selectedUrls);
  const failures: Array<{ asset_id: string; url: string; reason: string }> = [];
  const hashResults = await mapWithConcurrency(selectedUrls, concurrency, async (url): Promise<HashResult> => {
    const fetchStartedAt = Date.now();
    try {
      return {
        url,
        perceptualHash: await computeBlogImagePerceptualHashV3(await fetchImage(url)),
        reason: null,
        durationMs: Date.now() - fetchStartedAt,
      };
    } catch (fetchError) {
      return {
        url,
        perceptualHash: null,
        reason: fetchError instanceof Error ? fetchError.message : 'phash_failed',
        durationMs: Date.now() - fetchStartedAt,
      };
    }
  });
  const hashByUrl = new Map(
    hashResults
      .filter((result): result is HashResult & { perceptualHash: string } => Boolean(result.perceptualHash))
      .map((result) => [result.url, result.perceptualHash]),
  );
  const computed = missingRows
    .filter((row) => selectedUrlSet.has(row.url) && hashByUrl.has(row.url))
    .map((row) => ({ ...row, perceptual_hash: hashByUrl.get(row.url)! }));
  for (const result of hashResults) {
    if (!result.reason) continue;
    const row = missingRows.find((candidate) => candidate.url === result.url);
    failures.push({
      asset_id: row?.asset_id || createHash('sha256').update(result.url).digest('hex').slice(0, 24),
      url: result.url,
      reason: result.reason,
    });
  }
  if (apply) {
    for (const row of computed) {
      try {
        const { error: updateError } = await client.from('blog_media_assets')
          .update({ perceptual_hash: row.perceptual_hash, verified_at: new Date().toISOString() })
          .eq('id', row.id)
          .is('perceptual_hash', null);
        if (updateError) throw new Error(`phash_update_failed:${updateError.message}`);
      } catch (updateError) {
        failures.push({
          asset_id: row.asset_id,
          url: row.url,
          reason: updateError instanceof Error ? updateError.message : 'phash_update_failed',
        });
      }
    }
  }
  const assets = [...rows.filter((row) => row.perceptual_hash), ...computed].map((row) => ({
    assetId: row.asset_id,
    url: row.url,
    destinationId: row.location_entity_id,
    imageType: row.image_type,
    isFirstParty: row.is_first_party,
    isGenerated: row.is_generated,
    perceptualHash: row.perceptual_hash,
    alt: '',
    width: row.width,
    height: row.height,
  }));
  const visualUseByKey = new Map<string, (typeof assets)[number]>();
  for (const asset of assets) {
    const key = `${asset.destinationId || ''}|${canonicalSourceAssetKey(asset.url)}`;
    if (!visualUseByKey.has(key)) visualUseByKey.set(key, asset);
  }
  const visualUses = [...visualUseByKey.values()];
  const duplicates = findCrossDestinationImageDuplicatesV3(visualUses, 4);
  const assetById = new Map(visualUses.map((asset) => [asset.assetId, asset]));
  const duplicateDetails = duplicates.map((duplicate) => {
    const left = assetById.get(duplicate.leftAssetId);
    const right = assetById.get(duplicate.rightAssetId);
    return {
      ...duplicate,
      leftUrl: left?.url || '',
      rightUrl: right?.url || '',
      leftDestination: left?.destinationId || '',
      rightDestination: right?.destinationId || '',
      exactUrlMatch: Boolean(left?.url && right?.url && left.url === right.url),
      sameSourceAsset: Boolean(
        left?.url
        && right?.url
        && canonicalSourceAssetKey(left.url) === canonicalSourceAssetKey(right.url)
      ),
    };
  });
  const urlDestinations = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.location_entity_id) continue;
    const destinations = urlDestinations.get(row.url) || new Set<string>();
    destinations.add(row.location_entity_id);
    urlDestinations.set(row.url, destinations);
  }
  const exactUrlCrossDestination = [...urlDestinations.entries()]
    .filter(([, destinations]) => destinations.size > 1)
    .map(([url, destinations]) => ({ url, destinations: [...destinations].sort(), destination_count: destinations.size }));
  const report = {
    generated_at: new Date().toISOString(),
    dry_run: !apply,
    source,
    source_scope: source === 'bundled_public_detail_snapshot_fallback'
      ? 'last_known_good_public_eligible_posts'
      : 'registered_or_full_blog_corpus',
    source_read_error: sourceReadError,
    registry_rows: source === 'blog_media_assets' ? rows.length : 0,
    input_image_occurrences: rows.length,
    audited_visual_uses: visualUses.length,
    unique_urls: new Set(rows.map((row) => row.url)).size,
    missing_hash_before: missingRows.length,
    unique_urls_missing_before: uniqueMissingUrls.length,
    limit_semantics: 'unique_image_urls',
    concurrency,
    attempted: missingRows.filter((row) => selectedUrlSet.has(row.url)).length,
    attempted_unique_urls: selectedUrls.length,
    computed: computed.length,
    computed_unique_urls: hashByUrl.size,
    hash_coverage_rate: selectedUrls.length > 0 ? hashByUrl.size / selectedUrls.length : 1,
    reused_occurrences: Math.max(0, computed.length - hashByUrl.size),
    failed: failures.length,
    failed_unique_urls: hashResults.filter((result) => result.reason).length,
    duration_ms: Date.now() - startedAt,
    cross_destination_duplicate_candidates: duplicateDetails.length,
    perceptual_duplicate_pairs_different_url: duplicateDetails.filter((item) => !item.exactUrlMatch).length,
    same_source_asset_variant_pairs: duplicateDetails.filter((item) => !item.exactUrlMatch && item.sameSourceAsset).length,
    distinct_source_perceptual_pairs: duplicateDetails.filter((item) => !item.sameSourceAsset).length,
    exact_url_duplicate_pairs: duplicateDetails.filter((item) => item.exactUrlMatch).length,
    exact_url_cross_destination: exactUrlCrossDestination.length,
    failures,
    fetch_durations_ms: hashResults.map((result) => ({
      url: result.url,
      duration_ms: result.durationMs,
      status: result.reason ? 'failed' : 'computed',
    })),
    duplicates: duplicateDetails,
    exact_url_duplicates: exactUrlCrossDestination,
  };
  mkdirSync('docs/audits', { recursive: true });
  writeFileSync('docs/audits/blog-image-phash-preview.json', `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync('docs/audits/blog-image-phash-preview.csv', `${toCsvV3(duplicateDetails)}\n`);
  const verbose = process.argv.includes('--verbose');
  console.log(JSON.stringify(verbose ? report : {
    generated_at: report.generated_at,
    dry_run: report.dry_run,
    source: report.source,
    source_scope: report.source_scope,
    source_read_error: report.source_read_error,
    registry_rows: report.registry_rows,
    input_image_occurrences: report.input_image_occurrences,
    audited_visual_uses: report.audited_visual_uses,
    unique_urls: report.unique_urls,
    attempted_unique_urls: report.attempted_unique_urls,
    computed_unique_urls: report.computed_unique_urls,
    failed_unique_urls: report.failed_unique_urls,
    hash_coverage_rate: report.hash_coverage_rate,
    duration_ms: report.duration_ms,
    cross_destination_duplicate_candidates: report.cross_destination_duplicate_candidates,
    perceptual_duplicate_pairs_different_url: report.perceptual_duplicate_pairs_different_url,
    same_source_asset_variant_pairs: report.same_source_asset_variant_pairs,
    distinct_source_perceptual_pairs: report.distinct_source_perceptual_pairs,
    exact_url_duplicate_pairs: report.exact_url_duplicate_pairs,
    exact_url_cross_destination: report.exact_url_cross_destination,
    report_json: 'docs/audits/blog-image-phash-preview.json',
    report_csv: 'docs/audits/blog-image-phash-preview.csv',
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
