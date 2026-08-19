import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';

type AnyRecord = Record<string, unknown>;

export type PublicationAuthorityAuditInput = {
  packageRow: AnyRecord;
  pointer?: AnyRecord | null;
  snapshot?: AnyRecord | null;
  revision?: AnyRecord | null;
  /** V6 stores the immutable browser proof in product_registration_v5_proof_runs. */
  proof?: AnyRecord | null;
};

export type PublicationAuthorityAuditResult = {
  customerPublicationExpected: boolean;
  authoritativePublic: boolean;
  /** True when the V6 revision + immutable snapshot + V6 browser proof form the authority chain. */
  v6Authority: boolean;
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

function isV6CanonicalRevision(revision: AnyRecord | null, packageRow: AnyRecord): boolean {
  if (!revision) return false;
  const schemaVersion = asNonEmptyString(revision.schema_version);
  const normalizationVersion = asNonEmptyString(revision.normalization_version);
  const tenantMatches = valueMatches(revision.tenant_id, packageRow.tenant_id);
  const catalogMatches = valueMatches(revision.catalog_product_id, packageRow.catalog_product_id);
  return Boolean(
    tenantMatches
      && catalogMatches
      && schemaVersion?.startsWith('product-registration-v5-canonical-')
      && normalizationVersion?.startsWith('v6-'),
  );
}

function v6SourceProofPassed(input: {
  proof: AnyRecord | null;
  snapshotHash: string | null;
}): boolean {
  const proof = input.proof;
  if (!proof || !input.snapshotHash) return false;
  const result = asRecord(proof.result) ?? proof;
  const proofStatus = String(proof.status ?? result.status ?? '').toLowerCase();
  const source = asNonEmptyString(result.source);
  if (proofStatus !== 'passed' && proofStatus !== 'pass') return false;
  if (source !== 'hwp-mobile-browser-proof') return false;
  const resultSnapshotHash = asNonEmptyString(result.snapshotHash)
    ?? asNonEmptyString(result.public_snapshot_hash);
  if (resultSnapshotHash !== input.snapshotHash) return false;
  const surfaces = Array.isArray(result.surfaces)
    ? result.surfaces.map(String)
    : [];
  if (surfaces.length !== 2 || !surfaces.includes('packages') || !surfaces.includes('lp')) return false;
  const surfaceResults = Array.isArray(result.surface_results) ? result.surface_results : [];
  if (surfaceResults.length !== 2) return false;
  return surfaceResults.every((surface) => {
    const row = asRecord(surface);
    if (!row || row.status !== 'pass' || !['packages', 'lp'].includes(String(row.surface))) return false;
    if (asNonEmptyString(row.public_snapshot_hash) !== input.snapshotHash) return false;
    const checks = Array.isArray(row.checks) ? row.checks : [];
    return checks.length > 0 && checks.every((check) => asRecord(check)?.ok === true);
  });
}

export function auditPublicationAuthority(input: PublicationAuthorityAuditInput): PublicationAuthorityAuditResult {
  const pkg = input.packageRow;
  const pointer = asRecord(input.pointer);
  const snapshot = asRecord(input.snapshot);
  const revision = asRecord(input.revision);
  const v6Proof = v6SourceProofPassed({
    proof: asRecord(input.proof),
    snapshotHash: asNonEmptyString(snapshot?.snapshot_hash),
  });
  const v6CanonicalRevision = isV6CanonicalRevision(revision, pkg);
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
    // V6 revisions are keyed by catalog_product_id.  package_id is nullable
    // by design because the compatibility package projection is created after
    // the immutable revision.  A non-null wrong package id is still a defect.
    if (asNonEmptyString(revision.package_id)
      ? !valueMatches(revision.package_id, pkg.id)
      : !v6CanonicalRevision) {
      addUnique(failures, 'canonical_revision_package_mismatch');
    }
    if (!valueMatches(revision.catalog_product_id, packageCatalogProductId)) addUnique(failures, 'canonical_revision_catalog_mismatch');
    if (!asNonEmptyString(revision.source_document_id)
      || !asNonEmptyString(revision.extraction_id)
      || !asNonEmptyString(revision.payload_hash)
      || !asNonEmptyString(revision.lineage_hash)) {
      addUnique(failures, 'canonical_revision_lineage_incomplete');
    }
    const revisionStatus = String(revision.status ?? '');
    const v6Publishable = v6CanonicalRevision && v6Proof && ['candidate', 'verified', 'approved', 'published'].includes(revisionStatus);
    if (!['approved', 'published'].includes(revisionStatus) && !v6Publishable) {
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
  if (customerPublicationExpected && !evidencePack && !v6Proof) {
    addUnique(failures, 'registration_evidence_pack_missing');
  }

  const packagePriceDateCount = priceDateCount(pkg.price_dates);
  const snapshotPriceDateCount = snapshotPackage ? priceDateCount(snapshotPackage.price_dates) : null;
  if (snapshot && snapshotPriceDateCount !== packagePriceDateCount) {
    addUnique(failures, 'snapshot_price_date_count_mismatch');
  }

  let mobileProofReason: string | null = null;
  if (customerPublicationExpected) {
    if (!v6Proof) {
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
  }

  return {
    customerPublicationExpected,
    authoritativePublic: customerPublicationExpected
      && Boolean(pointer)
      && Boolean(snapshot)
      && Boolean(revision)
      && failures.length === 0,
    v6Authority: v6CanonicalRevision && v6Proof,
    failures,
    evidencePackStatus,
    mobileProofReason,
    packagePriceDateCount,
    snapshotPriceDateCount,
  };
}
