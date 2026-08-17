import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  destToEnKeyword,
  isPexelsConfigured,
  searchPexelsPhotos,
  type PexelsPhoto,
} from '@/lib/pexels';
import type { ProductRegistrationRevisionAggregate } from '@/lib/product-registration-authority/revision-aggregate';
import { suggestFromWikidata, type WikidataSuggestion } from '@/lib/wikidata-suggest';
import { fetchCommonsPhotoMeta, type CommonsPhoto } from '@/lib/wikimedia-commons';

type JsonObject = Record<string, unknown>;
const PRODUCT_PUBLIC_MEDIA_BUCKET = 'product-public-media';

type CachedReferenceMedia = {
  publicUrl: string;
  storageBucket: string;
  storagePath: string;
};

export type ReferenceMediaResolution = {
  linked: boolean;
  reason: string;
  destination: string | null;
  assetId: string | null;
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

export function destinationForReferenceMedia(aggregate: ProductRegistrationRevisionAggregate): string | null {
  const payload = aggregate.revision.canonical_payload;
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const section = object(sections[0]);
  const explicit = typeof section?.destinationHint === 'string' ? section.destinationHint.trim() : '';
  if (explicit) return explicit;

  const ledger = object(object(section?.v3)?.ledger);
  const variants = Array.isArray(ledger?.variants) ? ledger.variants : [];
  const variant = object(variants[0]);
  const days = Array.isArray(variant?.days) ? variant.days : [];
  for (const dayValue of days) {
    const day = object(dayValue);
    const route = Array.isArray(day?.route) ? day.route : [];
    const destination = route.find(value => typeof value === 'string' && value.trim() && !/^[A-Z]{3}$/.test(value.trim()));
    if (typeof destination === 'string') return destination.trim();
  }
  return null;
}

function assetHash(provider: string, providerAssetId: string): string {
  return createHash('sha256')
    .update(`${provider}:${providerAssetId}`)
    .digest('hex');
}

async function cacheWikimediaReference(input: {
  supabase: SupabaseClient;
  tenantId: string;
  filename: string;
  url: string;
}): Promise<CachedReferenceMedia | null> {
  try {
    const response = await fetch(input.url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : null;
    if (!extension) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) return null;
    const path = `${input.tenantId}/destination-reference/wikimedia/${assetHash('wikimedia_commons', input.filename)}.${extension}`;
    const { error } = await input.supabase.storage.from(PRODUCT_PUBLIC_MEDIA_BUCKET).upload(path, bytes, {
      contentType: mime,
      cacheControl: '31536000',
      upsert: true,
    });
    if (error) return null;
    const { data } = input.supabase.storage.from(PRODUCT_PUBLIC_MEDIA_BUCKET).getPublicUrl(path);
    return data.publicUrl
      ? { publicUrl: data.publicUrl, storageBucket: PRODUCT_PUBLIC_MEDIA_BUCKET, storagePath: path }
      : null;
  } catch {
    return null;
  }
}

export function normalizeReferenceMediaSubject(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function primaryDestination(destination: string): string {
  return destination.split(/[\/·,|]+/).map(value => value.trim()).find(value => value.length >= 2)
    ?? destination.trim();
}

function normalizedComparable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function wikidataDestinationMatches(destination: string, suggestion: WikidataSuggestion): boolean {
  const expected = normalizedComparable(primaryDestination(destination));
  if (!expected) return false;
  const candidates = [
    ...Object.values(suggestion.labels),
    ...Object.values(suggestion.aliases).flat(),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return candidates.some(value => normalizedComparable(value) === expected);
}

function pexelsLocationPhrase(destination: string): string {
  const query = normalizedComparable(destToEnKeyword(primaryDestination(destination)));
  const countries = new Set([
    'vietnam', 'japan', 'china', 'thailand', 'indonesia', 'malaysia', 'philippines',
    'korea', 'france', 'italy', 'turkey', 'mongolia', 'taiwan',
  ]);
  const generic = new Set([
    'travel', 'destination', 'landscape', 'coast', 'beach', 'city', 'skyline', 'island',
    'nature', 'snow', 'winter', 'temple', 'mountains', 'ocean', 'seaside', 'night',
  ]);
  const tokens = query.split(' ').filter(token => token && !generic.has(token));
  const countryIndex = tokens.findIndex(token => countries.has(token));
  const locationTokens = countryIndex > 0 ? tokens.slice(0, countryIndex) : tokens.slice(0, Math.min(tokens.length, 3));
  return locationTokens.join(' ');
}

export function scorePexelsDestinationPhoto(destination: string, photo: PexelsPhoto): number {
  const alt = normalizedComparable(photo.alt ?? '');
  const location = pexelsLocationPhrase(destination);
  const primary = normalizedComparable(primaryDestination(destination));
  const locationMatch = Boolean(location && (alt.includes(location) || location.includes(alt)))
    || Boolean(primary && alt.includes(primary));
  if (!locationMatch) return 0;

  const ratio = photo.height > 0 ? photo.width / photo.height : 0;
  let score = 0.62;
  if (ratio >= 1.35) score += 0.13;
  if (photo.width >= 1200 && photo.height >= 600) score += 0.15;
  if (/travel|city|coast|beach|landscape|temple|mountain|island|skyline|bay/i.test(photo.alt ?? '')) score += 0.05;
  return Math.min(0.95, score);
}

async function linkReferenceAsset(input: {
  supabase: SupabaseClient;
  aggregate: ProductRegistrationRevisionAggregate;
  destination: string;
  subjectKey: string;
  payload: JsonObject;
}): Promise<ReferenceMediaResolution> {
  const { data, error } = await input.supabase.rpc('link_product_registration_reference_media', {
    p_payload: {
      tenant_id: input.aggregate.revision.tenant_id,
      catalog_product_id: input.aggregate.revision.catalog_product_id,
      revision_id: input.aggregate.revision.id,
      subject_key: input.subjectKey,
      customer_label: `${input.destination} 여행지 참고 이미지 · 실제 일정과 다를 수 있습니다.`,
      ...input.payload,
    },
  });
  if (error) throw error;
  const row = object(data);
  return {
    linked: true,
    reason: row?.reused === true ? 'FREE_REFERENCE_MEDIA_REUSED' : 'LICENSED_REFERENCE_MEDIA_LINKED',
    destination: input.destination,
    assetId: typeof row?.asset_id === 'string' ? row.asset_id : null,
  };
}

export async function ensureLicensedReferenceMedia(input: {
  supabase: SupabaseClient;
  aggregate: ProductRegistrationRevisionAggregate;
  configured?: boolean;
  search?: (keyword: string) => Promise<PexelsPhoto[]>;
  tryWikimedia?: boolean;
  wikidataSearch?: (keyword: string) => Promise<WikidataSuggestion | null>;
  commonsFetch?: (filename: string, width?: number) => Promise<CommonsPhoto | null>;
  cacheWikimedia?: (input: {
    supabase: SupabaseClient;
    tenantId: string;
    filename: string;
    url: string;
  }) => Promise<CachedReferenceMedia | null>;
}): Promise<ReferenceMediaResolution> {
  if (input.aggregate.media.length > 0) {
    return { linked: false, reason: 'MEDIA_ALREADY_LINKED', destination: null, assetId: null };
  }
  const destination = destinationForReferenceMedia(input.aggregate);
  if (!destination) {
    return { linked: false, reason: 'MEDIA_DESTINATION_UNRESOLVED', destination: null, assetId: null };
  }
  const subjectKey = normalizeReferenceMediaSubject(destination);

  try {
    const { data: pooled } = await input.supabase.rpc('get_product_registration_reference_media_candidate', {
      p_tenant_id: input.aggregate.revision.tenant_id,
      p_subject_key: subjectKey,
    });
    const pooledAsset = object(pooled);
    if (typeof pooledAsset?.asset_id === 'string') {
      return await linkReferenceAsset({
        supabase: input.supabase,
        aggregate: input.aggregate,
        destination,
        subjectKey,
        payload: { asset_id: pooledAsset.asset_id },
      });
    }

    if (input.tryWikimedia !== false) {
      try {
        const wikidata = await (input.wikidataSearch ?? suggestFromWikidata)(primaryDestination(destination));
        if (wikidata?.image_filename && wikidataDestinationMatches(destination, wikidata)) {
          const commons = await (input.commonsFetch ?? fetchCommonsPhotoMeta)(wikidata.image_filename, 1600);
          if (commons?.safe_to_use && commons.thumb_url && commons.description_url && commons.license_url) {
            const cached = await (input.cacheWikimedia ?? cacheWikimediaReference)({
              supabase: input.supabase,
              tenantId: input.aggregate.revision.tenant_id,
              filename: commons.filename,
              url: commons.thumb_url,
            });
            // Commons allows direct reuse but discourages hotlinking. Use the
            // free tenant cache when available; otherwise continue to Pexels or
            // the brand fallback without persisting a fragile direct URL.
            if (cached) {
              const attribution = commons.author
                ? `여행지 참고 이미지: ${commons.author} / Wikimedia Commons`
                : '여행지 참고 이미지: Wikimedia Commons';
              return await linkReferenceAsset({
                supabase: input.supabase,
                aggregate: input.aggregate,
                destination,
                subjectKey,
                payload: {
                  external_url: cached.publicUrl,
                  storage_bucket: cached.storageBucket,
                  storage_path: cached.storagePath,
                  delivery_mode: 'licensed_cache',
                  sha256: assetHash('wikimedia_commons', commons.filename),
                  provider: 'wikimedia_commons',
                  provider_asset_id: commons.filename,
                  source_page_url: commons.description_url,
                  rights_holder: commons.author,
                  license_code: commons.license,
                  license_reference: commons.license_url,
                  attribution_text: attribution,
                  quality_score: 0.95,
                  width: 1600,
                  metadata: {
                    provider: 'wikimedia_commons',
                    wikidata_qid: wikidata.qid,
                    commons_filename: commons.filename,
                    source_page_url: commons.description_url,
                    usage: 'destination_reference_only',
                  },
                },
              });
            }
          }
        }
      } catch {
        // A free provider outage must not fail the workflow. Continue to the
        // next licensed provider, then use the brand fallback if needed.
      }
    }

    if (!(input.configured ?? isPexelsConfigured())) {
      return { linked: false, reason: 'MEDIA_PROVIDER_NOT_CONFIGURED', destination, assetId: null };
    }
    const search = input.search ?? (async keyword => searchPexelsPhotos(keyword, 5, 1, {
      orientation: 'landscape',
      locale: 'en-US',
    }));
    const photos = await search(destToEnKeyword(primaryDestination(destination)));
    const ranked = photos
      .map(photo => ({ photo, score: scorePexelsDestinationPhoto(destination, photo) }))
      .filter(candidate => candidate.score >= 0.75 && candidate.photo.src?.landscape && candidate.photo.url)
      .sort((a, b) => b.score - a.score || a.photo.id - b.photo.id);
    const selected = ranked[0];
    const photo = selected?.photo;
    if (!photo) {
      return { linked: false, reason: 'MEDIA_PROVIDER_NO_RELEVANT_RESULT', destination, assetId: null };
    }
    const attribution = `여행지 참고 이미지: ${photo.photographer} / Pexels`;
    return await linkReferenceAsset({
      supabase: input.supabase,
      aggregate: input.aggregate,
      destination,
      subjectKey,
      payload: {
        external_url: photo.src.landscape,
        sha256: assetHash('pexels', String(photo.id)),
        provider: 'pexels',
        provider_asset_id: String(photo.id),
        source_page_url: photo.url,
        photographer_url: photo.photographer_url,
        rights_holder: photo.photographer,
        license_code: 'Pexels License',
        license_reference: 'https://www.pexels.com/license/',
        attribution_text: attribution,
        quality_score: selected.score,
        width: photo.width,
        height: photo.height,
        metadata: {
          provider: 'pexels',
          provider_photo_id: photo.id,
          source_page_url: photo.url,
          photographer_url: photo.photographer_url,
          provider_alt: photo.alt,
          usage: 'destination_reference_only',
        },
      },
    });
  } catch (error) {
    return {
      linked: false,
      reason: `MEDIA_PROVIDER_FAILED:${error instanceof Error ? error.message : String(error)}`,
      destination,
      assetId: null,
    };
  }
}
