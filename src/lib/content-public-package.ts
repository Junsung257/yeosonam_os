import { supabaseAdmin } from '@/lib/supabase';
import { getCurrentPublicPackage } from '@/lib/package-publication/repository';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';

export type PublicContentPackage = {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  nights?: number;
  price?: number;
  price_tiers?: Array<{ adult_price?: number; period_label?: string }>;
  price_dates?: Array<{ date: string; price: number; confirmed: boolean; min_travelers?: number; max_travelers?: number; price_note?: string }>;
  product_type?: string;
  airline?: string;
  departure_airport?: string;
  product_summary?: string;
  product_highlights?: string[];
  inclusions?: string[];
  excludes?: string[];
  itinerary?: string[];
  hero_image_url?: string;
  images_public?: Array<{
    url: string;
    source: string;
    alt?: string | null;
  }>;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
}

function asPublicImages(value: unknown): NonNullable<PublicContentPackage['images_public']> {
  const images: NonNullable<PublicContentPackage['images_public']> = [];
  for (const item of asRecordArray(value)) {
    const url = asString(item.url);
    const source = asString(item.source);
    if (!url || !source) continue;
    images.push({ url, source, alt: asString(item.alt) });
  }
  return images;
}

function asPriceTiers(value: unknown): Array<{ adult_price?: number; period_label?: string }> {
  return asRecordArray(value).map((item) => ({
    adult_price: asNumber(item.adult_price) ?? asNumber(item.price) ?? undefined,
    period_label: asString(item.period_label) ?? asString(item.label) ?? undefined,
  }));
}

function asPriceDates(value: unknown): Array<{ date: string; price: number; confirmed: boolean; min_travelers?: number; max_travelers?: number; price_note?: string }> {
  return asRecordArray(value)
    .map((item) => {
      const date = asString(item.date) ?? asString(item.departure_date);
      const price = asNumber(item.price) ?? asNumber(item.adult_price);
      if (!date || price === null) return null;
      return {
        date,
        price,
        confirmed: Boolean(item.confirmed),
        ...(asNumber(item.min_travelers) != null ? { min_travelers: asNumber(item.min_travelers)! } : {}),
        ...(asNumber(item.max_travelers) != null ? { max_travelers: asNumber(item.max_travelers)! } : {}),
        ...(asString(item.price_note) ? { price_note: asString(item.price_note)! } : {}),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function toPublicContentPackage(row: Record<string, unknown>): PublicContentPackage | null {
  const id = asString(row.id);
  const title = asString(row.title) ?? asString(row.display_title);
  if (!id) return null;
  if (!title) return null;
  return {
    id,
    title,
    destination: asString(row.destination) ?? undefined,
    duration: asNumber(row.duration) ?? undefined,
    nights: asNumber(row.nights) ?? undefined,
    price: asNumber(row.price) ?? undefined,
    price_tiers: asPriceTiers(row.price_tiers),
    price_dates: asPriceDates(row.price_dates),
    product_type: asString(row.product_type) ?? undefined,
    airline: asString(row.airline) ?? undefined,
    departure_airport: asString(row.departure_airport) ?? undefined,
    product_summary: asString(row.product_summary) ?? asString(row.summary) ?? undefined,
    product_highlights: asStringArray(row.product_highlights),
    inclusions: asStringArray(row.inclusions),
    excludes: asStringArray(row.excludes),
    itinerary: asStringArray(row.itinerary),
    hero_image_url: asString(row.hero_image_url) ?? undefined,
    images_public: asPublicImages(row.images_public),
  };
}

export async function loadPublicContentPackageForGeneration(
  packageId: string,
): Promise<PublicContentPackage | null> {
  const current = await getCurrentPublicPackage(supabaseAdmin, {
    tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
    packageRef: packageId,
    channel: 'customer',
    locale: 'ko-KR',
  });
  return current ? toPublicContentPackage(current.package) : null;
}
