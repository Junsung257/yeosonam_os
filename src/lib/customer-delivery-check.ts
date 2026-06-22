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
  let fallbackEvidence: SourceEvidenceMap | null = null;
  try {
    const fallback = pkgToIntake(input.pkg as Parameters<typeof pkgToIntake>[0], {
      landOperatorName: input.pkg.land_operator ?? undefined,
    });
    fallbackEvidence = fallback.ir.sourceEvidence;
  } catch {
    fallbackEvidence = null;
  }

  if (input.sourceEvidence && Object.keys(input.sourceEvidence).length > 0) {
    return {
      sourceEvidence: {
        ...(fallbackEvidence ?? {}),
        ...input.sourceEvidence,
      },
      origin: 'intake',
    };
  }

  if (fallbackEvidence && Object.keys(fallbackEvidence).length > 0) {
    return { sourceEvidence: fallbackEvidence, origin: 'fallback' };
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

function addCompactTripStyleEvidence(
  evidence: SourceEvidenceMap | null,
  pkg: CustomerDeliveryCheckInput['pkg'],
): SourceEvidenceMap | null {
  if (!evidence || evidence['meta.tripStyle']?.length) return evidence;
  const row = pkg as Record<string, unknown>;
  const rawText = typeof row.raw_text === 'string' ? row.raw_text : '';
  const tripStyle = typeof row.trip_style === 'string' ? row.trip_style.trim() : '';
  if (!rawText || !tripStyle) return evidence;
  const compactRaw = rawText.replace(/\s+/g, '');
  const compactTripStyle = tripStyle.replace(/\s+/g, '');
  if (!compactTripStyle || !compactRaw.includes(compactTripStyle)) return evidence;
  return {
    ...evidence,
    'meta.tripStyle': [{
      rawTextHash: 'compact-trip-style',
      start: 0,
      end: 0,
      quote: tripStyle,
      confidence: 0.95,
      source: 'deterministic',
    }],
  };
}

export function evaluateCustomerDeliveryReadiness(input: CustomerDeliveryCheckInput): CustomerDeliveryCheckResult {
  const resolved = resolveSourceEvidence(input);
  const sourceEvidence = addCompactTripStyleEvidence(resolved.sourceEvidence, input.pkg);
  const origin = resolved.origin;
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
