import type { SupabaseClient } from '@supabase/supabase-js';

type JsonObject = Record<string, unknown>;

export type PublishedDepartureFact = {
  departure_instance_id?: string;
  departure_date: string;
  variant_key?: string | null;
  adult_selling_price: number | null;
  child_selling_price?: number | null;
  currency: string;
  pricing_state: 'PRICED' | 'REQUEST_ONLY' | 'CONFLICTING' | 'MISSING' | 'UNRESOLVED' | string;
  booking_state: 'AVAILABLE' | 'MANUAL_CONFIRMATION_REQUIRED' | 'SALES_CLOSED' | 'SOLD_OUT' | 'CANCELLED' | 'UNKNOWN' | string;
  inventory_state?: string;
  sale_state?: string;
  price_rule_hash?: string | null;
  price_override_id?: string | null;
  price_override_key?: string | null;
  source_ref_ids?: string[];
  source_confidence?: number | null;
  price_revision?: string | null;
  evidence?: unknown[];
};

export type PublishedProductFact = {
  productId: string;
  packageId: string;
  revisionId: string;
  snapshotId: string;
  snapshotHash: string;
  pointerVersion: number | null;
  cardProjection: JsonObject;
  lpProjection: JsonObject;
  departureInstances: PublishedDepartureFact[];
  entityRelations: JsonObject[];
  browserProofs: JsonObject[];
  sourceRevisionId: string;
  asOfDate?: string;
  refreshRequiredAt?: string;
};

type PublishedViewRow = {
  product_id: string;
  package_id: string;
  revision_id?: string;
  source_revision_id?: string;
  snapshot_id: string;
  snapshot_hash: string;
  pointer_version?: number | null;
  card_projection?: unknown;
  lp_projection?: unknown;
  departure_instances?: unknown;
  entity_relations?: unknown;
  browser_proofs?: unknown;
  as_of_date?: string;
  refresh_required_at?: string;
};

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function array<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function rowToFact(row: PublishedViewRow): PublishedProductFact {
  const revisionId = row.revision_id ?? row.source_revision_id ?? '';
  return {
    productId: row.product_id,
    packageId: row.package_id,
    revisionId,
    sourceRevisionId: row.source_revision_id ?? revisionId,
    snapshotId: row.snapshot_id,
    snapshotHash: row.snapshot_hash,
    pointerVersion: typeof row.pointer_version === 'number' ? row.pointer_version : null,
    cardProjection: object(row.card_projection),
    lpProjection: object(row.lp_projection),
    departureInstances: array<PublishedDepartureFact>(row.departure_instances).filter(item =>
      item && typeof item === 'object' && typeof (item as PublishedDepartureFact).departure_date === 'string'),
    entityRelations: array<JsonObject>(row.entity_relations).filter(item => item && typeof item === 'object'),
    browserProofs: array<JsonObject>(row.browser_proofs).filter(item => item && typeof item === 'object'),
    asOfDate: row.as_of_date,
    refreshRequiredAt: row.refresh_required_at,
  };
}

function queryError(error: unknown): Error {
  return error instanceof Error ? error : new Error('PRODUCT_REGISTRATION_AUTHORITY_READ_FAILED');
}

/**
 * Reads only the V6.1 pointer/snapshot-bound Jarvis fact view. The caller must
 * use a service-role Supabase client; the view itself has no public grants.
 */
export async function getPublishedProductFacts(input: {
  supabase: SupabaseClient;
  productId?: string;
  destination?: string;
  keyword?: string;
  limit?: number;
}): Promise<PublishedProductFact[]> {
  let query = input.supabase.from('product_registration_jarvis_fact_view').select('*');
  if (input.productId) query = query.eq('product_id', input.productId);
  const { data, error } = await query.limit(Math.min(Math.max(input.limit ?? 50, 1), 100));
  if (error) throw queryError(error);
  const facts = (data ?? []).map(row => rowToFact(row as PublishedViewRow));
  const destination = input.destination?.trim().toLocaleLowerCase();
  const keyword = input.keyword?.trim().toLocaleLowerCase();
  return facts.filter(fact => {
    const card = fact.cardProjection;
    const searchable = [
      card.title,
      card.destination,
      fact.lpProjection.title,
      fact.lpProjection.destination,
    ].filter(value => typeof value === 'string').join(' ').toLocaleLowerCase();
    return (!destination || searchable.includes(destination))
      && (!keyword || searchable.includes(keyword));
  });
}

export async function getPublishedProductFactById(input: {
  supabase: SupabaseClient;
  productId: string;
}): Promise<PublishedProductFact | null> {
  const byProduct = await getPublishedProductFacts({
    supabase: input.supabase,
    productId: input.productId,
    limit: 1,
  });
  if (byProduct[0]) return byProduct[0];
  const { data, error } = await input.supabase
    .from('product_registration_jarvis_fact_view')
    .select('*')
    .eq('package_id', input.productId)
    .limit(1);
  if (error) throw queryError(error);
  const row = (data ?? [])[0] as PublishedViewRow | undefined;
  return row ? rowToFact(row) : null;
}

async function getFactFromAudienceView(input: {
  supabase: SupabaseClient;
  view: 'product_registration_blog_content_fact_view' | 'product_registration_comparison_fact_view';
  productId: string;
}): Promise<PublishedProductFact | null> {
  for (const key of ['product_id', 'package_id'] as const) {
    const { data, error } = await input.supabase
      .from(input.view)
      .select('*')
      .eq(key, input.productId)
      .limit(1);
    if (error) throw queryError(error);
    const row = (data ?? [])[0] as PublishedViewRow | undefined;
    if (row) return rowToFact(row);
  }
  return null;
}

export function getPublishedBlogContentFactById(input: {
  supabase: SupabaseClient;
  productId: string;
}): Promise<PublishedProductFact | null> {
  return getFactFromAudienceView({ ...input, view: 'product_registration_blog_content_fact_view' });
}

export async function getPublishedComparisonFacts(input: {
  supabase: SupabaseClient;
  productId?: string;
  limit?: number;
}): Promise<PublishedProductFact[]> {
  let query = input.supabase.from('product_registration_comparison_fact_view').select('*');
  if (input.productId) query = query.eq('product_id', input.productId);
  const { data, error } = await query.limit(Math.min(Math.max(input.limit ?? 100, 1), 200));
  if (error) throw queryError(error);
  return (data ?? []).map(row => rowToFact(row as PublishedViewRow));
}

export function getPublishedDepartureFact(fact: PublishedProductFact, departureDate: string): PublishedDepartureFact | null {
  return fact.departureInstances.find(row => row.departure_date === departureDate) ?? null;
}

/**
 * A deliberately narrow adapter for customer-facing Jarvis code. It exposes
 * only current published facts and never invents a legacy excluded_dates or
 * price_tiers fallback. `price_dates` is retained solely as a compatibility
 * shape and is derived from typed departure instances.
 */
export function toJarvisPublishedPackage(fact: PublishedProductFact): JsonObject {
  const card = fact.cardProjection;
  const lp = fact.lpProjection;
  const priceDates = fact.departureInstances
    .filter(row => ['PRICED', 'REQUEST_ONLY'].includes(row.pricing_state))
    .map(row => ({
      date: row.departure_date,
      price: row.adult_selling_price,
      currency: row.currency,
      pricing_state: row.pricing_state,
      booking_state: row.booking_state,
      variant_key: row.variant_key ?? null,
    }));
  return {
    id: fact.packageId,
    package_id: fact.packageId,
    catalog_product_id: fact.productId,
    canonical_revision_id: fact.revisionId,
    title: card.title ?? lp.title ?? null,
    destination: card.destination ?? lp.destination ?? null,
    status: 'published',
    price_dates: priceDates,
    departure_instances: fact.departureInstances,
    entity_relations: fact.entityRelations,
    browser_proofs: fact.browserProofs,
    card_projection: card,
    lp_projection: lp,
    snapshot_id: fact.snapshotId,
    snapshot_hash: fact.snapshotHash,
    source_revision_id: fact.sourceRevisionId,
    as_of_date: fact.asOfDate ?? null,
    refresh_required_at: fact.refreshRequiredAt ?? null,
  };
}
