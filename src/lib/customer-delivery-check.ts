import { evaluateProductPublishGate, type PublishGateFailedCheck, type PublishGateResult } from '@/lib/product-publish-gate';
import { evaluateRenderClaimCoverage, type RenderClaimCoverageResult } from '@/lib/render-claim-coverage';
import {
  evidenceCoverage,
  MIN_PACKAGE_EVIDENCE_COVERAGE,
  REQUIRED_PACKAGE_EVIDENCE_FIELDS,
  type SourceEvidenceMap,
} from '@/lib/source-evidence';
import { pkgToIntake } from '@/lib/pkg-to-ir';

export type CustomerDeliveryCheckInput = {
  pkg: Parameters<typeof evaluateRenderClaimCoverage>[0] & {
    audit_status?: string | null;
    audit_report?: unknown;
    land_operator?: string | null;
  };
  failedChecks?: PublishGateFailedCheck[];
  sourceEvidence?: SourceEvidenceMap | null;
  requireCompletedAudit?: boolean;
};

export type CustomerDeliveryCheckResult = {
  sourceEvidence: SourceEvidenceMap | null;
  sourceEvidenceOrigin: 'intake' | 'fallback' | 'missing';
  sourceEvidenceCoverage: ReturnType<typeof evidenceCoverage>;
  renderClaimCoverage: RenderClaimCoverageResult;
  finalRenderFailedChecks: PublishGateFailedCheck[];
  publishGate: PublishGateResult;
  customerDeliverable: boolean;
};

function resolveSourceEvidence(input: CustomerDeliveryCheckInput): {
  sourceEvidence: SourceEvidenceMap | null;
  origin: 'intake' | 'fallback' | 'missing';
} {
  if (input.sourceEvidence && Object.keys(input.sourceEvidence).length > 0) {
    return { sourceEvidence: input.sourceEvidence, origin: 'intake' };
  }

  try {
    const fallback = pkgToIntake(input.pkg as Parameters<typeof pkgToIntake>[0], {
      landOperatorName: input.pkg.land_operator ?? undefined,
    });
    const evidence = fallback.ir.sourceEvidence;
    if (Object.keys(evidence).length > 0) {
      return { sourceEvidence: evidence, origin: 'fallback' };
    }
  } catch {
    // A missing fallback should surface as low evidence coverage below.
  }

  return { sourceEvidence: null, origin: 'missing' };
}

function isPersistedRenderClaimCheck(check: PublishGateFailedCheck): boolean {
  const id = check.id ?? '';
  return id === 'render_claim_unsupported' || id.startsWith('final_render_unsupported:');
}

function normalizeCustomerGateCheck(check: PublishGateFailedCheck): PublishGateFailedCheck {
  if (check.id === 'confidence_verify_mismatch') {
    return { ...check, severity: 'high' };
  }
  return check;
}

function isNonCustomerBlockingOperationalCheck(check: PublishGateFailedCheck): boolean {
  return check.id === 'cove_unknown' && /CoVe unknown:\s*$/.test(check.message ?? '');
}

export function evaluateCustomerDeliveryReadiness(input: CustomerDeliveryCheckInput): CustomerDeliveryCheckResult {
  const { sourceEvidence, origin } = resolveSourceEvidence(input);
  const requiredFields = [...REQUIRED_PACKAGE_EVIDENCE_FIELDS];
  const sourceCoverage = evidenceCoverage(sourceEvidence, requiredFields);
  const renderCoverage = evaluateRenderClaimCoverage(input.pkg, sourceEvidence);
  const finalRenderFailedChecks: PublishGateFailedCheck[] = renderCoverage.unsupported.map((claim) => ({
    id: `final_render_unsupported:${claim.id}`,
    severity: 'critical',
    passed: false,
    message: `고객 노출 문구 원문 근거 없음: ${claim.value}`,
  }));
  const nonRenderFailedChecks = (input.failedChecks ?? [])
    .filter(check => !isPersistedRenderClaimCheck(check))
    .filter(check => !isNonCustomerBlockingOperationalCheck(check))
    .map(normalizeCustomerGateCheck);
  const publishGate = evaluateProductPublishGate({
    auditStatus: input.pkg.audit_status ?? null,
    auditReport: input.pkg.audit_report ?? null,
    failedChecks: [...nonRenderFailedChecks, ...finalRenderFailedChecks],
    sourceEvidence,
    requiredEvidenceFields: requiredFields,
    minEvidenceCoverage: MIN_PACKAGE_EVIDENCE_COVERAGE,
    requireCompletedAudit: input.requireCompletedAudit ?? true,
  });

  return {
    sourceEvidence,
    sourceEvidenceOrigin: origin,
    sourceEvidenceCoverage: sourceCoverage,
    renderClaimCoverage: renderCoverage,
    finalRenderFailedChecks,
    publishGate,
    customerDeliverable: publishGate.decision === 'allow',
  };
}
