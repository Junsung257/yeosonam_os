import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';

type AnyRecord = Record<string, unknown>;

export type PublicationAuthorityAuditInput = {
  packageRow: AnyRecord;
  pointer?: AnyRecord | null;
  snapshot?: AnyRecord | null;
  revision?: AnyRecord | null;
};

export type PublicationAuthorityAuditResult = {
  customerPublicationExpected: boolean;
  authoritativePublic: boolean;
  failures: string[];
  evidencePackStatus: string | null;
  mobileProofReason: string | null;
  packagePriceDateCount: number;
  snapshotPriceDateCount: number | null;
};

const LEGACY_PUBLIC_STATUSES = new Set(['approved', 'active', 'published']);
const PUBLICATION_STATES = new Set(['approved', 'published']);

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function valueMatches(left: unknown, right: unknown): boolean {
  const a = asNonEmptyString(left);
  const b = asNonEmptyString(right);
  return Boolean(a && b && a === b);
}

function priceDateCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function addUnique(target: string[], code: string): void {
  if (!target.includes(code)) target.push(code);
}

export function auditPublicationAuthority(input: PublicationAuthorityAuditInput): PublicationAuthorityAuditResult {
  const pkg = input.packageRow;
  const pointer = asRecord(input.pointer);
  const snapshot = asRecord(input.snapshot);
  const revision = asRecord(input.revision);
  const auditReport = asRecord(pkg.audit_report);
  const evidencePack = asRecord(auditReport?.registration_evidence_pack_v1);
  const customerOpenContract = asRecord(auditReport?.customer_open_contract);
  const snapshotJson = asRecord(snapshot?.snapshot_json);
  const snapshotPackage = asRecord(snapshotJson?.package);
  const failures: string[] = [];

  const legacyPublic = LEGACY_PUBLIC_STATUSES.has(String(pkg.status ?? '').toLowerCase());
  const publicationStatePublic = PUBLICATION_STATES.has(String(pkg.publication_state ?? '').toLowerCase());
  const customerPublicationExpected = legacyPublic || publicationStatePublic || Boolean(pointer);
  const packageTenantId = asNonEmptyString(pkg.tenant_id);
  const packageCatalogProductId = asNonEmptyString(pkg.catalog_product_id);
  const packageRevisionId = asNonEmptyString(pkg.canonical_revision_id);

  if (customerPublicationExpected) {
    if (!packageTenantId) addUnique(failures, 'publication_tenant_missing');
    if (!packageCatalogProductId) addUnique(failures, 'catalog_product_identity_missing');
    if (!packageRevisionId) addUnique(failures, 'canonical_revision_missing');
    if (!pointer) addUnique(failures, 'publication_pointer_missing');
  }

  if (pointer) {
    if (pointer.state !== 'published') addUnique(failures, 'publication_pointer_not_published');
    if (pointer.channel !== 'customer' || pointer.locale !== 'ko-KR') addUnique(failures, 'publication_pointer_channel_mismatch');
    if (!valueMatches(pointer.tenant_id, packageTenantId)) addUnique(failures, 'publication_pointer_tenant_mismatch');
    if (!valueMatches(pointer.package_id, pkg.id)) addUnique(failures, 'publication_pointer_package_mismatch');
    if (!valueMatches(pointer.catalog_product_id, packageCatalogProductId)) addUnique(failures, 'publication_pointer_catalog_mismatch');
    if (!valueMatches(pointer.current_revision_id, packageRevisionId)) addUnique(failures, 'publication_pointer_revision_mismatch');
    if (!asNonEmptyString(pointer.current_snapshot_id)) addUnique(failures, 'publication_pointer_snapshot_missing');
    if (!snapshot) addUnique(failures, 'publication_snapshot_missing');
  }

  if (snapshot) {
    if (snapshot.status !== 'published') addUnique(failures, 'publication_snapshot_not_published');
    if (!valueMatches(snapshot.id, pointer?.current_snapshot_id)) addUnique(failures, 'publication_snapshot_pointer_mismatch');
    if (!valueMatches(snapshot.tenant_id, packageTenantId)) addUnique(failures, 'publication_snapshot_tenant_mismatch');
    if (!valueMatches(snapshot.package_id, pkg.id)) addUnique(failures, 'publication_snapshot_package_mismatch');
    if (!valueMatches(snapshot.catalog_product_id, packageCatalogProductId)) addUnique(failures, 'publication_snapshot_catalog_mismatch');
    if (!valueMatches(snapshot.canonical_revision_id, packageRevisionId)) addUnique(failures, 'publication_snapshot_revision_mismatch');
    if (!asNonEmptyString(snapshot.snapshot_hash)) addUnique(failures, 'publication_snapshot_hash_missing');
    const expectedPackageRevision = Number(pkg.package_revision);
    const actualPackageRevision = Number(snapshot.package_revision);
    if (!Number.isFinite(expectedPackageRevision) || !Number.isFinite(actualPackageRevision)
      || expectedPackageRevision !== actualPackageRevision) {
      addUnique(failures, 'publication_snapshot_package_revision_mismatch');
    }
  }

  if (revision) {
    if (!valueMatches(revision.id, packageRevisionId)) addUnique(failures, 'canonical_revision_row_mismatch');
    if (!valueMatches(revision.tenant_id, packageTenantId)) addUnique(failures, 'canonical_revision_tenant_mismatch');
    if (!valueMatches(revision.package_id, pkg.id)) addUnique(failures, 'canonical_revision_package_mismatch');
    if (!valueMatches(revision.catalog_product_id, packageCatalogProductId)) addUnique(failures, 'canonical_revision_catalog_mismatch');
    if (!asNonEmptyString(revision.source_document_id)
      || !asNonEmptyString(revision.extraction_id)
      || !asNonEmptyString(revision.payload_hash)
      || !asNonEmptyString(revision.lineage_hash)) {
      addUnique(failures, 'canonical_revision_lineage_incomplete');
    }
    if (!['approved', 'published'].includes(String(revision.status ?? ''))) {
      addUnique(failures, 'canonical_revision_not_publishable');
    }
  } else if (customerPublicationExpected) {
    addUnique(failures, 'canonical_revision_row_missing');
  }

  const evidencePackStatus = asNonEmptyString(evidencePack?.status);
  if (evidencePackStatus === 'blocked') addUnique(failures, 'registration_evidence_pack_blocked');
  const evidenceScorecard = asRecord(evidencePack?.scorecard);
  if (evidenceScorecard?.customer_open_candidate === false) addUnique(failures, 'customer_open_candidate_false');
  const downstreamEligibility = asRecord(evidencePack?.downstream_eligibility);
  if (downstreamEligibility?.customer_open === false) addUnique(failures, 'evidence_customer_open_false');
  if (customerOpenContract?.ok === false || customerOpenContract?.status === 'blocked') {
    addUnique(failures, 'customer_open_contract_blocked');
  }
  if (customerPublicationExpected && !evidencePack) addUnique(failures, 'registration_evidence_pack_missing');

  const packagePriceDateCount = priceDateCount(pkg.price_dates);
  const snapshotPriceDateCount = snapshotPackage ? priceDateCount(snapshotPackage.price_dates) : null;
  if (snapshot && snapshotPriceDateCount !== packagePriceDateCount) {
    addUnique(failures, 'snapshot_price_date_count_mismatch');
  }

  let mobileProofReason: string | null = null;
  if (customerPublicationExpected) {
    const mobileProof = evaluateCustomerMobileProof({
      auditReport: pkg.audit_report,
      packageUpdatedAt: asNonEmptyString(pkg.updated_at),
      packageRevision: pkg.package_revision as string | number | null | undefined,
      publicSnapshotHash: asNonEmptyString(snapshot?.snapshot_hash),
    });
    if (!mobileProof.ok) {
      mobileProofReason = mobileProof.reason;
      addUnique(failures, 'mobile_browser_proof_invalid_or_stale');
    }
  }

  return {
    customerPublicationExpected,
    authoritativePublic: customerPublicationExpected
      && Boolean(pointer)
      && Boolean(snapshot)
      && Boolean(revision)
      && failures.length === 0,
    failures,
    evidencePackStatus,
    mobileProofReason,
    packagePriceDateCount,
    snapshotPriceDateCount,
  };
}
