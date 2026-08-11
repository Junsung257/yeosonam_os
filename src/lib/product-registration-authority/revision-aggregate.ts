import type { SupabaseClient } from '@supabase/supabase-js';

import { ledgerToRenderPackageInputs } from '@/lib/product-registration-v3/render-contract-adapter';
import type { V3DraftLedger } from '@/lib/product-registration-v3/types';

type JsonObject = Record<string, unknown>;

export type ProductRegistrationRevisionAggregate = {
  revision: {
    id: string;
    tenant_id: string;
    catalog_product_id: string;
    payload_hash: string;
    source_hash: string;
    revision_no: number;
    canonical_payload: JsonObject;
  };
  departures: JsonObject[];
  transportSegments: JsonObject[];
  lodgingStays: JsonObject[];
  golfRounds: JsonObject[];
  terms: JsonObject[];
  media: JsonObject[];
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function list(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(object).filter((row): row is JsonObject => Boolean(row)) : [];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`REVISION_AGGREGATE_MISSING:${field}`);
  return value;
}

export async function loadProductRegistrationRevisionAggregate(input: {
  supabase: SupabaseClient;
  revisionId: string;
}): Promise<ProductRegistrationRevisionAggregate> {
  const { data, error } = await input.supabase.rpc('get_product_registration_revision_aggregate', {
    p_revision_id: input.revisionId,
  });
  if (error) throw error;
  const payload = object(data);
  const revision = object(payload?.revision);
  const canonicalPayload = object(revision?.canonical_payload);
  if (!payload || !revision || !canonicalPayload) throw new Error('REVISION_AGGREGATE_INVALID');
  return {
    revision: {
      id: requiredString(revision.id, 'revision.id'),
      tenant_id: requiredString(revision.tenant_id, 'revision.tenant_id'),
      catalog_product_id: requiredString(revision.catalog_product_id, 'revision.catalog_product_id'),
      payload_hash: requiredString(revision.payload_hash, 'revision.payload_hash'),
      source_hash: requiredString(revision.source_hash, 'revision.source_hash'),
      revision_no: Number(revision.revision_no),
      canonical_payload: canonicalPayload,
    },
    departures: list(payload.departures),
    transportSegments: list(payload.transport_segments),
    lodgingStays: list(payload.lodging_stays),
    golfRounds: list(payload.golf_rounds),
    terms: list(payload.terms),
    media: list(payload.media),
  };
}

function canonicalLedger(canonicalPayload: JsonObject): V3DraftLedger {
  const sections = Array.isArray(canonicalPayload.sections) ? canonicalPayload.sections : [];
  const section = object(sections[0]);
  const ledger = object(object(section?.v3)?.ledger);
  if (!ledger || !Array.isArray(ledger.variants) || ledger.variants.length !== 1) {
    throw new Error('REVISION_VARIANT_CARDINALITY_UNSUPPORTED');
  }
  return ledger as unknown as V3DraftLedger;
}

export function buildPackageProjectionFromRevision(input: {
  packageId: string;
  aggregate: ProductRegistrationRevisionAggregate;
  operationalIdentity?: JsonObject;
}): JsonObject {
  const ledger = canonicalLedger(input.aggregate.revision.canonical_payload);
  const renderInputs = ledgerToRenderPackageInputs(ledger);
  if (renderInputs.length !== 1) throw new Error('REVISION_RENDER_PROJECTION_CARDINALITY_MISMATCH');
  const render = renderInputs[0] as unknown as JsonObject;
  const variant = object(ledger.variants[0]) ?? {};
  const days = Array.isArray(variant.days) ? variant.days.map(object).filter((row): row is JsonObject => Boolean(row)) : [];
  const destinations = [...new Set(days.flatMap(day => Array.isArray(day.route) ? day.route : [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
  const prices = Array.isArray(render.price_dates)
    ? render.price_dates.map(row => Number(object(row)?.price)).filter(Number.isFinite)
    : [];
  const media = input.aggregate.media
    .map(row => {
      const url = typeof row.external_url === 'string'
        ? row.external_url
        : typeof row.public_url === 'string'
          ? row.public_url
          : null;
      if (!url) return null;
      return {
        url,
        role: row.role ?? 'reference',
        source: row.provenance_type ?? 'licensed',
        alt: row.customer_label ?? render.title ?? destinations[0] ?? '여행 참고 이미지',
        attribution: row.attribution_text ?? null,
        reference_only: row.provenance_type === 'destination_reference',
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const hero = media.find(row => row.role === 'hero') ?? media[0] ?? null;
  return {
    ...(input.operationalIdentity ?? {}),
    ...render,
    id: input.packageId,
    catalog_product_id: input.aggregate.revision.catalog_product_id,
    tenant_id: input.aggregate.revision.tenant_id,
    canonical_revision_id: input.aggregate.revision.id,
    canonical_payload_hash: input.aggregate.revision.payload_hash,
    package_revision: input.aggregate.revision.revision_no,
    display_title: render.title,
    destination: destinations[0] ?? null,
    duration: Number(variant.duration_days ?? days.length) || null,
    days: Number(variant.duration_days ?? days.length) || null,
    nights: Number(variant.nights ?? 0) || null,
    price: prices.length > 0 ? Math.min(...prices) : null,
    images_public: media,
    hero_image_url: hero?.url ?? null,
    publication_state: 'published',
    status: 'active',
    revision_aggregate_hash: input.aggregate.revision.payload_hash,
  };
}
