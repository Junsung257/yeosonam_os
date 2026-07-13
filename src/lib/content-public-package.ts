import { supabaseAdmin } from '@/lib/supabase';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { fetchAndMergeCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';

export type PublicContentPackage = {
  id: string;
  title: string;
  destination: string | null;
  duration: number | string | null;
  nights: number | null;
  price: number | null;
  airline?: string | null;
  departure_airport?: string | null;
  product_summary?: string | null;
  product_highlights?: string[];
  inclusions?: string[];
  excludes?: string[];
  itinerary?: string[];
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

function isPublicContentPackageCandidate(row: Record<string, unknown>): boolean {
  const publicationState = asString(row.publication_state);
  return isPublicPublicationState(publicationState) && isCustomerPubliclyOpenable(row);
}

function toPublicContentPackage(row: Record<string, unknown>): PublicContentPackage | null {
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    title: asString(row.title) ?? asString(row.display_title) ?? '여소남 추천 패키지',
    destination: asString(row.destination),
    duration: asNumber(row.duration) ?? asString(row.duration),
    nights: asNumber(row.nights),
    price: asNumber(row.price),
    airline: asString(row.airline),
    departure_airport: asString(row.departure_airport),
    product_summary: asString(row.product_summary) ?? asString(row.summary),
    product_highlights: asStringArray(row.product_highlights),
    inclusions: asStringArray(row.inclusions),
    excludes: asStringArray(row.excludes),
    itinerary: asStringArray(row.itinerary),
  };
}

export async function loadPublicContentPackageForGeneration(
  packageId: string,
): Promise<PublicContentPackage | null> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data')
    .eq('id', packageId)
    .in('publication_state', ['approved', 'published'])
    .limit(1);
  if (error) throw error;

  const candidate = ((data ?? []) as Array<Record<string, unknown>>).find(isPublicContentPackageCandidate);
  if (!candidate) return null;

  const publicRows = await fetchAndMergeCurrentPublicPackageCardSnapshots(supabaseAdmin, [candidate]);
  const publicRow = publicRows[0];
  return publicRow ? toPublicContentPackage(publicRow) : null;
}
