export const PUBLICATION_STATES = [
  'draft',
  'needs_review',
  'blocked',
  'approved',
  'published',
  'needs_reaudit',
  'quarantined',
] as const;

export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const PUBLIC_CUSTOMER_STATES: readonly PublicationState[] = ['approved', 'published'];

export type PublishBlockerCode =
  | 'audit_query_failed'
  | 'stale_audit'
  | 'stale_mobile_proof'
  | 'broken_attraction_id'
  | 'optional_tour_display_pollution'
  | 'masked_data_pollution'
  | 'unsupported_title_claim'
  | 'unsupported_customer_claim'
  | 'english_internal_copy'
  | 'risky_reservation_claim'
  | 'price_fragment_display'
  | 'inclusion_optional_mixup'
  | 'itinerary_duration_mismatch'
  | 'public_snapshot_missing'
  | 'public_snapshot_hash_mismatch'
  | 'customer_route_reads_unapproved_field';

export type PublishFinding = {
  code: PublishBlockerCode | string;
  message: string;
  fieldPath?: string;
  severity?: 'warning' | 'high' | 'critical';
};

export type PublicPackageSnapshot = {
  snapshot_version: 'public-package-snapshot-v1';
  package_id: string;
  package_revision: number;
  public_title: string;
  public_subtitle: string | null;
  duration: number | null;
  destinations: string[];
  price_display: string | null;
  option_policy: {
    status: OptionalTourStatus;
    badges: string[];
  };
  canonical_view: Record<string, unknown> | null;
  package: Record<string, unknown>;
  inclusions_public: unknown[];
  exclusions_public: unknown[];
  itinerary_public: unknown;
  optional_tours_public: unknown[];
  images_public: unknown[];
  cta_copy: {
    primary: '상담 요청하기' | '예약 가능 여부 확인' | '출발일 상담하기' | '견적 문의하기';
    helper: string;
  };
  card_projection: Record<string, unknown>;
  lp_projection: Record<string, unknown>;
  route_text_dump: string[];
};

export type OptionalTourStatus = 'none_explicit' | 'paid_options' | 'unknown' | 'polluted';

export function isPublicPublicationState(value: string | null | undefined): value is 'approved' | 'published' {
  return value === 'approved' || value === 'published';
}
