import type { SupabaseClient } from '@supabase/supabase-js';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';
import { isSafeImageSrc } from '@/lib/image-url';
import { formatKstDate } from '@/lib/kst-date';

type UnknownRecord = Record<string, unknown>;

export interface PublicCatalogDate {
  date: string;
  price: number | null;
  confirmed: boolean | null;
}

export interface PublicCatalogItem {
  id: string;
  slug: string;
  productKind: string;
  title: string;
  destination: string | null;
  country: string | null;
  departureAirport: string | null;
  duration: number | null;
  nights: number | null;
  heroImage: string | null;
  price: number | null;
  priceDisplay: string | null;
  availableDates: PublicCatalogDate[];
  badges: string[];
  bookingMode: 'inquiry' | 'price_check' | 'consultation_only';
  lastVerifiedAt: string;
  catalogGenerationId: string;
  minimumDeparturePax: number | null;
  lodgingState: string | null;
  shoppingCount: number | null;
  mandatoryLocalCosts: unknown;
  mandatoryLocalCostKrw: number | null;
  itineraryIntensity: string | null;
  companionFit: string | null;
  copyQualityScore: number;
  mediaReadinessState: 'verified_documentary';
}

export interface PublicCatalogDetail {
  item: PublicCatalogItem;
  package: UnknownRecord;
  snapshot: UnknownRecord;
  lineage: {
    catalogProductId: string;
    revisionId: string;
    snapshotId: string;
    snapshotHash: string;
    pointerVersion: number;
  };
}

type PublicCatalogRow = {
  tenant_id: string;
  id: string;
  catalog_product_id: string;
  slug: string | null;
  product_kind: string | null;
  title: string | null;
  destination: string | null;
  country: string | null;
  departure_airport: string | null;
  duration: number | string | null;
  nights: number | string | null;
  price: number | string | null;
  price_display: string | null;
  hero_image: string | null;
  badges: unknown;
  available_dates: unknown;
  booking_mode: string | null;
  last_verified_at: string;
  snapshot_id: string;
  snapshot_hash: string;
  revision_id: string;
  pointer_version: number | string;
  catalog_generation_id: string | null;
  minimum_departure_pax: number | string | null;
  lodging_state: string | null;
  shopping_count: number | string | null;
  mandatory_local_costs: unknown;
  mandatory_local_cost_krw: number | string | null;
  itinerary_intensity: string | null;
  companion_fit: string | null;
  copy_quality_score: number | string | null;
  media_readiness_state: string | null;
  public_detail?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function dates(value: unknown): PublicCatalogDate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      return [];
    }
    return [{
      date: entry.date,
      price: nullableNumber(entry.adult_selling_price ?? entry.price ?? entry.selling_price),
      confirmed: typeof entry.confirmed === 'boolean' ? entry.confirmed : null,
    }];
  });
}

function bookingMode(value: unknown): PublicCatalogItem['bookingMode'] {
  return value === 'consultation_only' || value === 'price_check' ? value : 'inquiry';
}

function toItem(row: PublicCatalogRow): PublicCatalogItem | null {
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  const verified = typeof row.last_verified_at === 'string' ? row.last_verified_at : '';
  const heroImage = typeof row.hero_image === 'string' && row.hero_image.trim() ? row.hero_image.trim() : null;
  const catalogGenerationId = typeof row.catalog_generation_id === 'string' ? row.catalog_generation_id.trim() : '';
  const availableDates = dates(row.available_dates).filter((entry) => entry.date >= formatKstDate());
  const copyQualityScore = nullableNumber(row.copy_quality_score) ?? 0;
  const hasForbiddenHero = Boolean(heroImage && (
    /(^|\/)logo(?:[._/-]|$)/iu.test(heroImage)
    || /\/media-assets\/(?:openai_generated|code_rendered)\//iu.test(heroImage)
    || /\/blog-assets\/generated\/blog\//iu.test(heroImage)
  ));
  if (!id || !title || !verified || !catalogGenerationId || !heroImage || hasForbiddenHero
    || !isSafeImageSrc(heroImage) || availableDates.length === 0
    || row.media_readiness_state !== 'verified_documentary' || copyQualityScore < 82) return null;
  return {
    id,
    slug: typeof row.slug === 'string' && row.slug.trim() ? row.slug.trim() : id,
    productKind: typeof row.product_kind === 'string' && row.product_kind.trim()
      ? row.product_kind.trim()
      : 'package',
    title,
    destination: typeof row.destination === 'string' && row.destination.trim() ? row.destination.trim() : null,
    country: typeof row.country === 'string' && row.country.trim() ? row.country.trim() : null,
    departureAirport: typeof row.departure_airport === 'string' && row.departure_airport.trim()
      ? row.departure_airport.trim()
      : null,
    duration: nullableNumber(row.duration),
    nights: nullableNumber(row.nights),
    heroImage,
    price: nullableNumber(row.price),
    priceDisplay: typeof row.price_display === 'string' && row.price_display.trim() ? row.price_display.trim() : null,
    availableDates,
    badges: stringArray(row.badges),
    bookingMode: bookingMode(row.booking_mode),
    lastVerifiedAt: verified,
    catalogGenerationId,
    minimumDeparturePax: nullableNumber(row.minimum_departure_pax),
    lodgingState: typeof row.lodging_state === 'string' && row.lodging_state.trim() ? row.lodging_state.trim() : null,
    shoppingCount: nullableNumber(row.shopping_count),
    mandatoryLocalCosts: row.mandatory_local_costs,
    mandatoryLocalCostKrw: nullableNumber(row.mandatory_local_cost_krw),
    itineraryIntensity: typeof row.itinerary_intensity === 'string' && row.itinerary_intensity.trim()
      ? row.itinerary_intensity.trim()
      : null,
    companionFit: typeof row.companion_fit === 'string' && row.companion_fit.trim() ? row.companion_fit.trim() : null,
    copyQualityScore,
    mediaReadinessState: 'verified_documentary',
  };
}

const LIST_COLUMNS = [
  'tenant_id',
  'id',
  'catalog_product_id',
  'slug',
  'product_kind',
  'title',
  'destination',
  'country',
  'departure_airport',
  'duration',
  'nights',
  'price',
  'price_display',
  'hero_image',
  'badges',
  'available_dates',
  'booking_mode',
  'last_verified_at',
  'snapshot_id',
  'snapshot_hash',
  'revision_id',
  'pointer_version',
  'catalog_generation_id',
  'minimum_departure_pax',
  'lodging_state',
  'shopping_count',
  'mandatory_local_costs',
  'mandatory_local_cost_krw',
  'itinerary_intensity',
  'companion_fit',
  'copy_quality_score',
  'media_readiness_state',
].join(',');

/**
 * Temporary compatibility projection for existing card components. The data
 * still originates exclusively from public_catalog_view; no legacy table or
 * snapshot fallback is introduced here.
 */
export function publicCatalogItemToLegacyCard(item: PublicCatalogItem): Record<string, unknown> {
  return {
    id: item.id,
    catalog_id: item.catalogGenerationId,
    slug: item.slug,
    title: item.title,
    display_title: item.title,
    destination: item.destination,
    country: item.country,
    duration: item.duration,
    nights: item.nights,
    price: item.price,
    price_dates: item.availableDates.map(date => ({
      date: date.date,
      price: date.price,
      confirmed: date.confirmed ?? false,
    })),
    product_type: item.productKind,
    departure_airport: item.departureAirport,
    product_highlights: item.badges,
    product_tags: item.badges,
    hero_image_url: item.heroImage,
    thumbnail_urls: item.heroImage ? [item.heroImage] : [],
    booking_mode: item.bookingMode,
    minimum_departure_pax: item.minimumDeparturePax,
    lodging_state: item.lodgingState,
    shopping_count: item.shoppingCount,
    mandatory_local_costs: item.mandatoryLocalCosts,
    mandatory_local_cost_krw: item.mandatoryLocalCostKrw,
    itinerary_intensity: item.itineraryIntensity,
    recommended_for: item.companionFit,
    copy_quality_score: item.copyQualityScore,
    last_verified_at: item.lastVerifiedAt,
  };
}

export async function listPublicCatalog(
  supabase: SupabaseClient,
  options: {
    limit?: number;
    destination?: string;
    productKind?: string;
    tenantId?: string;
    ids?: string[];
  } = {},
): Promise<PublicCatalogItem[]> {
  const limit = Math.max(1, Math.min(5_000, options.limit ?? 1_000));
  const ids = options.ids
    ? [...new Set(options.ids.map((id) => id.trim()).filter(Boolean))].slice(0, 5_000)
    : null;
  if (ids && ids.length === 0) return [];
  let query = supabase
    .from('public_catalog_view')
    .select(LIST_COLUMNS)
    .eq('tenant_id', options.tenantId ?? PLATFORM_PRODUCT_REGISTRATION_TENANT_ID)
    .order('last_verified_at', { ascending: false })
    .limit(limit);
  if (options.destination?.trim()) query = query.ilike('destination', `%${options.destination.trim()}%`);
  if (options.productKind?.trim()) query = query.eq('product_kind', options.productKind.trim());
  if (ids) query = query.in('id', ids);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as PublicCatalogRow[])
    .map(toItem)
    .filter((item): item is PublicCatalogItem => Boolean(item));
}

export async function getPublicCatalogDetail(
  supabase: SupabaseClient,
  packageRef: string,
  options: { tenantId?: string } = {},
): Promise<PublicCatalogDetail | null> {
  const ref = packageRef.trim();
  if (!ref) return null;
  const byId = await supabase
    .from('public_catalog_view')
    .select('*')
    .eq('tenant_id', options.tenantId ?? PLATFORM_PRODUCT_REGISTRATION_TENANT_ID)
    .eq('id', ref)
    .limit(1)
    .maybeSingle();
  if (byId.error) throw byId.error;
  const bySlug = byId.data
    ? null
    : await supabase
      .from('public_catalog_view')
      .select('*')
      .eq('tenant_id', options.tenantId ?? PLATFORM_PRODUCT_REGISTRATION_TENANT_ID)
      .eq('slug', ref)
      .limit(1)
      .maybeSingle();
  if (bySlug?.error) throw bySlug.error;
  const data = byId.data ?? bySlug?.data ?? null;
  if (!data) return null;
  const row = data as unknown as PublicCatalogRow;
  const item = toItem(row);
  const snapshot = isRecord(row.public_detail) ? row.public_detail : null;
  const customerPackage = snapshot && isRecord(snapshot.package) ? snapshot.package : null;
  if (!item || !snapshot || !customerPackage) return null;
  return {
    item,
    package: customerPackage,
    snapshot,
    lineage: {
      catalogProductId: row.catalog_product_id,
      revisionId: row.revision_id,
      snapshotId: row.snapshot_id,
      snapshotHash: row.snapshot_hash,
      pointerVersion: Number(row.pointer_version),
    },
  };
}
