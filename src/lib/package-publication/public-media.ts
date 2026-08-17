import { isSafeImageSrc } from '@/lib/image-url';

import type { PublicMediaKind, PublicMediaRole, PublicPackageMedia } from './types';

type AnyRecord = Record<string, unknown>;

const MEDIA_KINDS = new Set<PublicMediaKind>([
  'product',
  'destination_reference',
  'entity_reference',
  'legacy_reference',
  'brand',
]);
const MEDIA_ROLES = new Set<PublicMediaRole>(['hero', 'gallery', 'itinerary', 'hotel', 'golf', 'reference']);

function record(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function inferKind(row: AnyRecord): PublicMediaKind {
  const explicit = text(row.kind);
  if (explicit && MEDIA_KINDS.has(explicit as PublicMediaKind)) return explicit as PublicMediaKind;

  const provenance = text(row.provenance_type) ?? text(row.source) ?? '';
  const subject = text(row.subject_type);
  if (provenance === 'supplier_product' || provenance === 'operator_product') return 'product';
  if (subject === 'attraction' || subject === 'hotel' || subject === 'golf') return 'entity_reference';
  if (provenance === 'destination_reference' || provenance === 'licensed_stock') return 'destination_reference';
  if (provenance === 'brand_fallback') return 'brand';
  if (provenance === 'attraction_photo') return 'entity_reference';
  return 'legacy_reference';
}

function defaultLabel(kind: PublicMediaKind): string {
  if (kind === 'product') return '상품 제공 이미지';
  if (kind === 'destination_reference') return '여행지 참고 이미지';
  if (kind === 'entity_reference') return '관광지 참고 이미지';
  if (kind === 'brand') return '여소남 안내 이미지';
  return '참고 이미지';
}

export function normalizePublicPackageMedia(value: unknown, fallbackAlt = '여행 이미지'): PublicPackageMedia | null {
  const row = record(value);
  if (!row) return null;
  const url = text(row.url) ?? text(row.external_url) ?? text(row.public_url);
  if (!url || !isSafeImageSrc(url)) return null;

  const kind = inferKind(row);
  const roleValue = text(row.role);
  const role = roleValue && MEDIA_ROLES.has(roleValue as PublicMediaRole)
    ? roleValue as PublicMediaRole
    : 'reference';
  const referenceOnly = typeof row.reference_only === 'boolean'
    ? row.reference_only
    : kind !== 'product' && kind !== 'brand';
  const sourcePageUrl = text(row.source_page_url) ?? text(row.attribution_url);

  return {
    url,
    source: text(row.source) ?? text(row.provenance_type),
    kind,
    role,
    label: text(row.label) ?? text(row.customer_label) ?? defaultLabel(kind),
    alt: text(row.alt) ?? text(row.customer_label) ?? fallbackAlt,
    reference_only: referenceOnly,
    provider: text(row.provider),
    provider_asset_id: text(row.provider_asset_id),
    attribution_text: text(row.attribution_text) ?? text(row.attribution),
    attribution_url: sourcePageUrl,
    source_page_url: sourcePageUrl,
    license_code: text(row.license_code),
    license_url: text(row.license_url) ?? text(row.license_reference),
  };
}

export function publicMediaFromLegacyUrl(input: {
  url: unknown;
  source: string;
  alt?: unknown;
  role?: PublicMediaRole;
}): PublicPackageMedia | null {
  return normalizePublicPackageMedia({
    url: input.url,
    source: input.source,
    role: input.role ?? (input.source === 'package_hero' ? 'hero' : 'reference'),
    alt: input.alt,
    kind: input.source === 'brand_fallback'
      ? 'brand'
      : input.source === 'attraction_photo'
        ? 'entity_reference'
        : 'legacy_reference',
    reference_only: input.source !== 'brand_fallback',
  }, typeof input.alt === 'string' ? input.alt : '여행 참고 이미지');
}

export function selectPublicHeroMedia(value: unknown): PublicPackageMedia | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map(item => normalizePublicPackageMedia(item))
    .filter((item): item is PublicPackageMedia => Boolean(item));
  return normalized.find(item => item.role === 'hero') ?? normalized[0] ?? null;
}

export function shouldBypassImageOptimization(media: PublicPackageMedia | null | undefined): boolean {
  return media?.provider === 'pexels' || media?.provider === 'wikimedia_commons';
}
