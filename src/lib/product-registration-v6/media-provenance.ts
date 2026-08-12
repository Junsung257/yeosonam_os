import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  destToEnKeyword,
  isPexelsConfigured,
  searchPexelsPhotos,
  type PexelsPhoto,
} from '@/lib/pexels';
import type { ProductRegistrationRevisionAggregate } from '@/lib/product-registration-authority/revision-aggregate';

type JsonObject = Record<string, unknown>;

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

function assetHash(photo: PexelsPhoto): string {
  return createHash('sha256')
    .update(`pexels:${photo.id}:${photo.src.landscape}`)
    .digest('hex');
}

export async function ensureLicensedReferenceMedia(input: {
  supabase: SupabaseClient;
  aggregate: ProductRegistrationRevisionAggregate;
  configured?: boolean;
  search?: (keyword: string) => Promise<PexelsPhoto[]>;
}): Promise<ReferenceMediaResolution> {
  if (input.aggregate.media.length > 0) {
    return { linked: false, reason: 'MEDIA_ALREADY_LINKED', destination: null, assetId: null };
  }
  const destination = destinationForReferenceMedia(input.aggregate);
  if (!destination) {
    return { linked: false, reason: 'MEDIA_DESTINATION_UNRESOLVED', destination: null, assetId: null };
  }
  if (!(input.configured ?? isPexelsConfigured())) {
    return { linked: false, reason: 'MEDIA_PROVIDER_NOT_CONFIGURED', destination, assetId: null };
  }

  try {
    const search = input.search ?? (async keyword => searchPexelsPhotos(keyword, 5, 1, {
      orientation: 'landscape',
      locale: 'en-US',
    }));
    const photos = await search(destToEnKeyword(destination));
    const photo = photos.find(candidate => candidate.src?.landscape && candidate.url);
    if (!photo) {
      return { linked: false, reason: 'MEDIA_PROVIDER_NO_RESULT', destination, assetId: null };
    }
    const attribution = `여행지 참고 이미지: ${photo.photographer} / Pexels`;
    const { data, error } = await input.supabase.rpc('link_product_registration_reference_media', {
      p_payload: {
        tenant_id: input.aggregate.revision.tenant_id,
        catalog_product_id: input.aggregate.revision.catalog_product_id,
        revision_id: input.aggregate.revision.id,
        external_url: photo.src.landscape,
        sha256: assetHash(photo),
        rights_holder: photo.photographer,
        license_reference: 'https://www.pexels.com/license/',
        attribution_text: attribution,
        customer_label: `${destination} 여행지 참고 이미지 · 실제 일정과 다를 수 있습니다.`,
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
    if (error) throw error;
    const row = object(data);
    return {
      linked: true,
      reason: 'LICENSED_REFERENCE_MEDIA_LINKED',
      destination,
      assetId: typeof row?.asset_id === 'string' ? row.asset_id : null,
    };
  } catch (error) {
    return {
      linked: false,
      reason: `MEDIA_PROVIDER_FAILED:${error instanceof Error ? error.message : String(error)}`,
      destination,
      assetId: null,
    };
  }
}
