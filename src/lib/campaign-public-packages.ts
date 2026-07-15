import type { SupabaseClient } from '@supabase/supabase-js';

import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { getPublishedPackageCards } from '@/lib/public-packages';
import { isPublicPublicationState } from '@/lib/package-publication/types';

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
].join(', ');

const CAMPAIGN_PUBLIC_PACKAGE_FIELDS =
  'id, destination, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data';

export function isCampaignPublicSnapshotCandidate(row: unknown): row is Record<string, unknown> {
  if (!row || typeof row !== 'object') return false;
  const item = row as Record<string, unknown>;
  const publicationState = typeof item.publication_state === 'string' ? item.publication_state : null;
  return isPublicPublicationState(publicationState) && isCustomerPubliclyOpenable(item);
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

  const { data, error } = await supabase
    .from('travel_packages')
    .select(CAMPAIGN_PUBLIC_PACKAGE_FIELDS)
    .in('id', productIds)
    .in('publication_state', ['approved', 'published']);
  if (error) throw error;

  const publicRows = await getPublishedPackageCards(
    supabase,
    ((data ?? []) as Array<Record<string, unknown>>).filter(isCampaignPublicSnapshotCandidate),
  );

  return new Map(publicRows.map((row) => [String(row.id), row as AnyRecord]));
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
