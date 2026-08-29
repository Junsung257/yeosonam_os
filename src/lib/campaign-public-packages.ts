import type { SupabaseClient } from '@supabase/supabase-js';

import { listPublicCatalog, type PublicCatalogItem } from '@/lib/public-catalog';

type AnyRecord = Record<string, any>;

export type CampaignCreativeWithPublicPackage = AnyRecord & {
  id: string;
  product_id?: string | null;
  channel?: string | null;
  travel_packages?: AnyRecord | null;
};

export const CAMPAIGN_CREATIVE_PUBLIC_FIELDS = [
  'id',
  'product_id',
  'campaign_id',
  'channel',
  'creative_type',
  'variant_index',
  'hook_type',
  'tone',
  'target_segment',
  'key_selling_point',
  'primary_text',
  'headline',
  'description',
  'body',
  'slides',
  'image_url',
  'keywords',
  'ad_copies',
  'status',
  'created_at',
  'launched_at',
  'ended_at',
  'meta_campaign_id',
  'meta_adset_id',
  'meta_ad_id',
  'meta_creative_id',
].join(', ');

const CAMPAIGN_PUBLIC_PACKAGE_FIELDS =
  'id, destination, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data';

function toCampaignPackage(item: PublicCatalogItem): AnyRecord {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    destination: item.destination,
    duration: item.duration,
    price: item.price,
    price_display: item.priceDisplay,
    booking_mode: item.bookingMode,
    last_verified_at: item.lastVerifiedAt,
  };
}

export async function loadPublicPackagesForCampaignCreatives(
  supabase: SupabaseClient,
  creatives: AnyRecord[],
): Promise<Map<string, AnyRecord>> {
  const productIds = [...new Set(
    creatives
      .map((creative) => typeof creative.product_id === 'string' ? creative.product_id : null)
      .filter((id): id is string => Boolean(id)),
  )];
  if (productIds.length === 0) return new Map();

  const publicRows = await listPublicCatalog(supabase, {
    ids: productIds,
    limit: productIds.length,
  });
  return new Map(publicRows.map((row) => [row.id, toCampaignPackage(row)]));
}

export async function attachPublicPackagesToCampaignCreatives<T extends CampaignCreativeWithPublicPackage>(
  supabase: SupabaseClient,
  creatives: T[],
): Promise<T[]> {
  const publicPackagesById = await loadPublicPackagesForCampaignCreatives(supabase, creatives);
  return creatives.map((creative) => {
    const productId = typeof creative.product_id === 'string' ? creative.product_id : '';
    return {
      ...creative,
      travel_packages: publicPackagesById.get(productId) ?? null,
    };
  });
}

export function campaignCreativesMissingPublicPackage<T extends CampaignCreativeWithPublicPackage>(
  creatives: T[],
): T[] {
  return creatives.filter((creative) => !creative.travel_packages);
}
