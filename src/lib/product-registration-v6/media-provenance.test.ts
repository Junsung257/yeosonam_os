import { describe, expect, it, vi } from 'vitest';

import type { ProductRegistrationRevisionAggregate } from '@/lib/product-registration-authority/revision-aggregate';
import { destinationForReferenceMedia, ensureLicensedReferenceMedia } from './media-provenance';

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

describe('licensed reference media', () => {
  it('takes the destination from the immutable canonical revision', () => {
    expect(destinationForReferenceMedia(aggregate)).toBe('다낭');
  });

  it('records provider page, photographer, license and reference-only label', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { asset_id: 'asset-1' }, error: null });
    const result = await ensureLicensedReferenceMedia({
      supabase: { rpc } as never,
      aggregate,
      configured: true,
      search: async () => [{
        id: 123,
        width: 1200,
        height: 627,
        url: 'https://www.pexels.com/photo/123/',
        photographer: 'Photographer',
        photographer_url: 'https://www.pexels.com/@photographer',
        alt: 'Da Nang coast',
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
      }],
    });

    expect(result).toEqual(expect.objectContaining({ linked: true, assetId: 'asset-1' }));
    expect(rpc).toHaveBeenCalledWith('link_product_registration_reference_media', {
      p_payload: expect.objectContaining({
        external_url: 'https://images.pexels.com/landscape.jpg',
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
});
