import { describe, expect, it, vi } from 'vitest';

import type { PexelsPhoto } from '@/lib/pexels';
import type { ProductRegistrationRevisionAggregate } from '@/lib/product-registration-authority/revision-aggregate';
import {
  destinationForReferenceMedia,
  ensureLicensedReferenceMedia,
  normalizeReferenceMediaSubject,
  scorePexelsDestinationPhoto,
  wikidataDestinationMatches,
} from './media-provenance';

const aggregate: ProductRegistrationRevisionAggregate = {
  revision: {
    id: 'revision-1',
    tenant_id: 'tenant-1',
    catalog_product_id: 'catalog-1',
    payload_hash: 'a'.repeat(64),
    source_hash: 'b'.repeat(64),
    revision_no: 1,
    canonical_payload: {
      sections: [{ destinationHint: '다낭', v3: { ledger: { variants: [] } } }],
    },
  },
  departures: [],
  transportSegments: [],
  lodgingStays: [],
  golfRounds: [],
  terms: [],
  media: [],
};

function pexelsPhoto(overrides: Partial<PexelsPhoto> = {}): PexelsPhoto {
  return {
    id: 123,
    width: 1200,
    height: 627,
    url: 'https://www.pexels.com/photo/123/',
    photographer: 'Photographer',
    photographer_url: 'https://www.pexels.com/@photographer',
    alt: 'Da Nang coast travel landscape',
    src: {
      original: 'https://images.pexels.com/original.jpg',
      large2x: 'https://images.pexels.com/large2x.jpg',
      large: 'https://images.pexels.com/large.jpg',
      medium: 'https://images.pexels.com/medium.jpg',
      small: 'https://images.pexels.com/small.jpg',
      portrait: 'https://images.pexels.com/portrait.jpg',
      landscape: 'https://images.pexels.com/landscape.jpg',
      tiny: 'https://images.pexels.com/tiny.jpg',
    },
    ...overrides,
  };
}

function rpcWithoutPool() {
  return vi.fn(async (name: string) => name === 'get_product_registration_reference_media_candidate'
    ? { data: null, error: null }
    : { data: { asset_id: 'asset-1', reused: false }, error: null });
}

describe('licensed reference media', () => {
  it('takes and normalizes the destination from the immutable canonical revision', () => {
    expect(destinationForReferenceMedia(aggregate)).toBe('다낭');
    expect(normalizeReferenceMediaSubject('  다낭 / 호이안  ')).toBe('다낭 / 호이안');
  });

  it('reuses an eligible tenant destination pool asset before calling a provider', async () => {
    const rpc = vi.fn(async (name: string) => name === 'get_product_registration_reference_media_candidate'
      ? { data: { asset_id: 'pooled-1' }, error: null }
      : { data: { asset_id: 'pooled-1', reused: true }, error: null });
    const search = vi.fn();

    const result = await ensureLicensedReferenceMedia({
      supabase: { rpc } as never,
      aggregate,
      configured: true,
      search,
      tryWikimedia: false,
    });

    expect(result).toEqual(expect.objectContaining({ linked: true, reason: 'FREE_REFERENCE_MEDIA_REUSED' }));
    expect(search).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenNthCalledWith(2, 'link_product_registration_reference_media', {
      p_payload: expect.objectContaining({ asset_id: 'pooled-1', subject_key: '다낭' }),
    });
  });

  it('uses an exact Wikidata entity only when Commons has a safe free license', async () => {
    const rpc = rpcWithoutPool();
    const result = await ensureLicensedReferenceMedia({
      supabase: { rpc } as never,
      aggregate,
      configured: false,
      wikidataSearch: async () => ({
        qid: 'Q25282',
        description: 'Vietnamese city',
        labels: { ko: '다낭', en: 'Da Nang', zh: null, ja: null },
        aliases: { ko: [], en: [], zh: [], ja: [] },
        image_filename: 'Da Nang skyline.jpg',
        image_thumb_url: null,
        sitelinks: { kowiki: null, enwiki: null, zhwiki: null },
      }),
      commonsFetch: async () => ({
        filename: 'Da Nang skyline.jpg',
        thumb_url: 'https://upload.wikimedia.org/danang.jpg',
        full_url: 'https://upload.wikimedia.org/danang-full.jpg',
        description_url: 'https://commons.wikimedia.org/wiki/File:Da_Nang_skyline.jpg',
        license: 'CC-BY-4.0',
        license_url: 'https://creativecommons.org/licenses/by/4.0/',
        author: 'Commons Author',
        safe_to_use: true,
      }),
      cacheWikimedia: async () => ({
        publicUrl: 'https://tenant.supabase.co/storage/v1/object/public/product-public-media/danang.jpg',
        storageBucket: 'product-public-media',
        storagePath: 'tenant-1/destination-reference/wikimedia/danang.jpg',
      }),
    });

    expect(result.linked).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('link_product_registration_reference_media', {
      p_payload: expect.objectContaining({
        provider: 'wikimedia_commons',
        external_url: 'https://tenant.supabase.co/storage/v1/object/public/product-public-media/danang.jpg',
        delivery_mode: 'licensed_cache',
        storage_bucket: 'product-public-media',
        provider_asset_id: 'Da Nang skyline.jpg',
        source_page_url: 'https://commons.wikimedia.org/wiki/File:Da_Nang_skyline.jpg',
        license_code: 'CC-BY-4.0',
        subject_key: '다낭',
      }),
    });
  });

  it('rejects a similarly named but different Wikidata entity', () => {
    expect(wikidataDestinationMatches('다낭', {
      qid: 'Q1',
      description: null,
      labels: { ko: '단양군', en: 'Danyang County', zh: null, ja: null },
      aliases: { ko: [], en: [], zh: [], ja: [] },
      image_filename: 'wrong.jpg',
      image_thumb_url: null,
      sitelinks: { kowiki: null, enwiki: null, zhwiki: null },
    })).toBe(false);
  });

  it('falls through to Pexels when a safe Commons image cannot be cached', async () => {
    const rpc = rpcWithoutPool();
    const relevant = pexelsPhoto({ id: 77, alt: 'Da Nang city coast travel landscape' });
    const result = await ensureLicensedReferenceMedia({
      supabase: { rpc } as never,
      aggregate,
      configured: true,
      search: async () => [relevant],
      wikidataSearch: async () => ({
        qid: 'Q25282',
        description: 'Vietnamese city',
        labels: { ko: '다낭', en: 'Da Nang', zh: null, ja: null },
        aliases: { ko: [], en: [], zh: [], ja: [] },
        image_filename: 'Da Nang skyline.jpg',
        image_thumb_url: null,
        sitelinks: { kowiki: null, enwiki: null, zhwiki: null },
      }),
      commonsFetch: async () => ({
        filename: 'Da Nang skyline.jpg',
        thumb_url: 'https://upload.wikimedia.org/danang.jpg',
        full_url: 'https://upload.wikimedia.org/danang-full.jpg',
        description_url: 'https://commons.wikimedia.org/wiki/File:Da_Nang_skyline.jpg',
        license: 'CC-BY-4.0',
        license_url: 'https://creativecommons.org/licenses/by/4.0/',
        author: 'Commons Author',
        safe_to_use: true,
      }),
      cacheWikimedia: async () => null,
    });

    expect(result).toEqual(expect.objectContaining({ linked: true, assetId: 'asset-1' }));
    expect(rpc).toHaveBeenLastCalledWith('link_product_registration_reference_media', {
      p_payload: expect.objectContaining({ provider: 'pexels', provider_asset_id: '77' }),
    });
  });

  it('falls through to Pexels when Wikimedia is temporarily unavailable', async () => {
    const rpc = rpcWithoutPool();
    const result = await ensureLicensedReferenceMedia({
      supabase: { rpc } as never,
      aggregate,
      configured: true,
      search: async () => [pexelsPhoto({ id: 88 })],
      wikidataSearch: async () => { throw new Error('temporary outage'); },
    });

    expect(result).toEqual(expect.objectContaining({ linked: true, assetId: 'asset-1' }));
    expect(rpc).toHaveBeenLastCalledWith('link_product_registration_reference_media', {
      p_payload: expect.objectContaining({ provider: 'pexels', provider_asset_id: '88' }),
    });
  });

  it('ranks only Pexels results whose alt text supports the requested destination', async () => {
    const rpc = rpcWithoutPool();
    const unrelated = pexelsPhoto({ id: 1, alt: 'A generic tropical beach' });
    const relevant = pexelsPhoto({ id: 2, alt: 'Da Nang coast travel landscape' });
    expect(scorePexelsDestinationPhoto('다낭', unrelated)).toBe(0);
    expect(scorePexelsDestinationPhoto('다낭', relevant)).toBeGreaterThanOrEqual(0.75);

    const result = await ensureLicensedReferenceMedia({
      supabase: { rpc } as never,
      aggregate,
      configured: true,
      search: async () => [unrelated, relevant],
      tryWikimedia: false,
    });

    expect(result).toEqual(expect.objectContaining({ linked: true, assetId: 'asset-1' }));
    expect(rpc).toHaveBeenLastCalledWith('link_product_registration_reference_media', {
      p_payload: expect.objectContaining({
        external_url: relevant.src.landscape,
        provider: 'pexels',
        provider_asset_id: '2',
        license_reference: 'https://www.pexels.com/license/',
        attribution_text: '여행지 참고 이미지: Photographer / Pexels',
        customer_label: '다낭 여행지 참고 이미지 · 실제 일정과 다를 수 있습니다.',
        metadata: expect.objectContaining({
          source_page_url: 'https://www.pexels.com/photo/123/',
          usage: 'destination_reference_only',
        }),
      }),
    });
  });

  it('degrades safely when neither free provider can establish a relevant image', async () => {
    const rpc = rpcWithoutPool();
    const result = await ensureLicensedReferenceMedia({
      supabase: { rpc } as never,
      aggregate,
      configured: true,
      search: async () => [pexelsPhoto({ alt: 'Unknown beach' })],
      wikidataSearch: async () => null,
    });

    expect(result).toEqual(expect.objectContaining({ linked: false, reason: 'MEDIA_PROVIDER_NO_RELEVANT_RESULT' }));
  });
});
