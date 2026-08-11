import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { computeBlogImagePerceptualHashV3, findCrossDestinationImageDuplicatesV3 } from '../src/lib/blog-image-quality-v3';
import { extractImagesV3, getReadOnlySupabaseV3, loadCorpusRowsV3, toCsvV3 } from './lib/blog-corpus-v3';

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

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = Math.max(1, Math.min(Number(limitArg?.split('=', 2)[1] || 100), 1000));
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
  let rows = (registryResult.data || []) as MediaRow[];
  if (!apply && (registryResult.error || rows.length === 0)) {
    source = 'content_creatives_read_only_fallback';
    const corpus = await loadCorpusRowsV3(client);
    rows = corpus.flatMap((creative) => [
      ...extractImagesV3(creative.blog_html || '').map((image) => image.url),
      ...(creative.og_image_url ? [creative.og_image_url] : []),
    ].map((url) => {
      const key = createHash('sha256').update(`${url}|${creative.destination || ''}`).digest('hex').slice(0, 24);
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
  const missing = rows.filter((row) => !row.perceptual_hash).slice(0, limit);
  const computed: Array<MediaRow & { perceptual_hash: string }> = [];
  const failures: Array<{ asset_id: string; url: string; reason: string }> = [];
  for (const row of missing) {
    try {
      const perceptualHash = await computeBlogImagePerceptualHashV3(await fetchImage(row.url));
      computed.push({ ...row, perceptual_hash: perceptualHash });
      if (apply) {
        const { error: updateError } = await client.from('blog_media_assets')
          .update({ perceptual_hash: perceptualHash, verified_at: new Date().toISOString() })
          .eq('id', row.id)
          .is('perceptual_hash', null);
        if (updateError) throw new Error(`phash_update_failed:${updateError.message}`);
      }
    } catch (fetchError) {
      failures.push({
        asset_id: row.asset_id,
        url: row.url,
        reason: fetchError instanceof Error ? fetchError.message : 'phash_failed',
      });
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
  const duplicates = findCrossDestinationImageDuplicatesV3(assets, 4);
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
    registry_rows: rows.length,
    missing_hash_before: rows.filter((row) => !row.perceptual_hash).length,
    attempted: missing.length,
    computed: computed.length,
    failed: failures.length,
    cross_destination_duplicate_candidates: duplicates.length,
    exact_url_cross_destination: exactUrlCrossDestination.length,
    failures,
    duplicates,
    exact_url_duplicates: exactUrlCrossDestination,
  };
  mkdirSync('docs/audits', { recursive: true });
  writeFileSync('docs/audits/blog-image-phash-preview.json', `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync('docs/audits/blog-image-phash-preview.csv', `${toCsvV3(duplicates)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
