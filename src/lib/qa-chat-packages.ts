import { extractQaDestinationHint } from '@/lib/qa-destination-hint';
import { getPublicCatalogDetail, listPublicCatalog } from '@/lib/public-catalog';
import { getTopRecommendedPackages } from '@/lib/scoring/top-recommended';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type CustomerPackage = Record<string, unknown>;
type CacheEntry = { t: number; rows: CustomerPackage[] };

const cache = new Map<string, CacheEntry>();
const TTL_MS = 90_000;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function toQaCustomerPackage(pkg: CustomerPackage): CustomerPackage | null {
  const id = asString(pkg.id);
  const title = asString(pkg.display_title) ?? asString(pkg.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    display_title: title,
    destination: asString(pkg.destination),
    duration: asNumber(pkg.duration),
    nights: asNumber(pkg.nights),
    price: asNumber(pkg.price),
    product_summary: asString(pkg.product_summary) ?? asString(pkg.summary),
    product_highlights: asStringArray(pkg.product_highlights),
    inclusions: asStringArray(pkg.inclusions),
    excludes: asStringArray(pkg.excludes),
    itinerary: Array.isArray(pkg.itinerary) ? pkg.itinerary : [],
    price_dates: Array.isArray(pkg.price_dates) ? pkg.price_dates : [],
    product_type: asString(pkg.product_type) ?? asString(pkg.product_kind),
    trip_style: asString(pkg.trip_style),
    airline: asString(pkg.airline),
  };
}

function fresh(entry: CacheEntry | undefined, now: number): boolean {
  return Boolean(entry && now - entry.t < TTL_MS);
}

async function rankQaPackagesForHint(rows: CustomerPackage[], destinationHint: string): Promise<CustomerPackage[]> {
  if (rows.length <= 1) return rows;
  try {
    const ranked = await getTopRecommendedPackages({
      destination: destinationHint,
      limit: rows.length,
      minGroupSize: 1,
      maxRank: rows.length,
    });
    const rankMap = new Map(ranked.map((row, index) => [row.package_id, index]));
    return [...rows].sort((left, right) => (
      (rankMap.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER)
      - (rankMap.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER)
    ));
  } catch (error) {
    console.warn('[qa-chat-packages] recommendation ranking unavailable', error);
    return rows;
  }
}

async function loadQaPackages(destination?: string): Promise<CustomerPackage[]> {
  const catalog = await listPublicCatalog(supabaseAdmin, {
    limit: 40,
    ...(destination ? { destination } : {}),
  });
  const details = await Promise.all(catalog.slice(0, 30).map((item) => (
    getPublicCatalogDetail(supabaseAdmin, item.id).catch(() => null)
  )));
  const rows = details
    .map((detail) => detail ? toQaCustomerPackage(detail.package) : null)
    .filter((row): row is CustomerPackage => Boolean(row));
  return destination ? rankQaPackagesForHint(rows, destination) : rows;
}

/** Customer QA receives only exact, currently public snapshot facts. */
export async function getQaChatPackageContext(hintSource?: string): Promise<CustomerPackage[]> {
  if (!isSupabaseConfigured) return [];
  const now = Date.now();
  const hint = hintSource?.trim() ? extractQaDestinationHint(hintSource) : null;
  const key = hint ? `d:${hint}` : 'all';
  const cached = cache.get(key);
  if (fresh(cached, now)) return cached?.rows ?? [];

  try {
    const rows = await loadQaPackages(hint ?? undefined);
    if (hint && rows.length === 0) {
      const all = await loadQaPackages();
      cache.set('all', { t: now, rows: all });
      cache.set(key, { t: now, rows: all });
      return all;
    }
    cache.set(key, { t: now, rows });
    return rows;
  } catch (error) {
    console.error('[qa-chat-packages] public catalog unavailable', error);
    return cached?.rows ?? [];
  }
}

export function invalidateQaChatPackageCache(): void {
  cache.clear();
}
