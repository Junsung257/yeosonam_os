import { evaluateProductPublishGate, type PublishGateFailedCheck, type PublishGateResult } from '@/lib/product-publish-gate';
import { evaluateRenderClaimCoverage, type RenderClaimCoverageResult } from '@/lib/render-claim-coverage';
import {
  evidenceCoverage,
  findEvidenceSpan,
  hashRawText,
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

function parseTripStyleDays(value: string): number | null {
  const compact = value.replace(/\s+/g, '');
  const korean = compact.match(/(?:\d+\uBC15)?(\d+)\uC77C/);
  if (korean) return Number(korean[1]);
  const english = compact.match(/(\d+)\s*D/i);
  return english ? Number(english[1]) : null;
}

function findTripStyleDayEvidence(rawText: string, days: number): string | null {
  const patterns = [
    new RegExp(`${days}\\s*\\uC77C`),
    new RegExp(`${days}\\s*D`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
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
  const rowDuration = typeof row.duration === 'number' ? row.duration : null;
  const tripStyleDays = parseTripStyleDays(tripStyle);
  const derivedDayEvidence = tripStyleDays && rowDuration === tripStyleDays
    ? findTripStyleDayEvidence(rawText, tripStyleDays)
    : null;
  if (!compactTripStyle || (!compactRaw.includes(compactTripStyle) && !derivedDayEvidence)) return evidence;
  return {
    ...evidence,
    'meta.tripStyle': [{
      rawTextHash: derivedDayEvidence ? 'derived-trip-style-days' : 'compact-trip-style',
      start: 0,
      end: 0,
      quote: derivedDayEvidence ?? tripStyle,
      confidence: derivedDayEvidence ? 0.9 : 0.95,
      source: 'deterministic',
    }],
  };
}

function addPriceEvidence(
  evidence: SourceEvidenceMap | null,
  pkg: CustomerDeliveryCheckInput['pkg'],
): SourceEvidenceMap | null {
  if (!evidence || evidence['priceGroups[0].adultPrice']?.length) return evidence;
  const row = pkg as Record<string, unknown>;
  const rawText = typeof row.raw_text === 'string' ? row.raw_text : '';
  if (!rawText) return evidence;
  const priceDates = Array.isArray(row.price_dates) ? row.price_dates : [];
  const priceTiers = Array.isArray(row.price_tiers) ? row.price_tiers : [];
  const candidates = [
    row.price,
    ...priceDates.map(item => (item as { price?: unknown; adult_price?: unknown }).price ?? (item as { adult_price?: unknown }).adult_price),
    ...priceTiers.map(item => (item as { adult_price?: unknown; price?: unknown }).adult_price ?? (item as { price?: unknown }).price),
  ];
  const rawTextHash = hashRawText(rawText);
  for (const candidate of candidates) {
    const span = findEvidenceSpan(rawText, candidate, { rawTextHash, source: 'deterministic', confidence: 0.9 });
    if (!span) continue;
    return {
      ...evidence,
      'priceGroups[0].adultPrice': [span],
    };
  }
  return evidence;
}

export function evaluateCustomerDeliveryReadiness(input: CustomerDeliveryCheckInput): CustomerDeliveryCheckResult {
  const resolved = resolveSourceEvidence(input);
  const sourceEvidence = addPriceEvidence(addCompactTripStyleEvidence(resolved.sourceEvidence, input.pkg), input.pkg);
  const origin = resolved.origin;
  const renderCoverage = evaluateRenderClaimCoverage(input.pkg, sourceEvidence);
  const requiredFields = [...REQUIRED_PACKAGE_EVIDENCE_FIELDS].filter((field) => {
    if (field === 'flights.outbound[0].code') {
      const claim = renderCoverage.claims.find(item => item.id === 'flight.outbound.code');
      return Boolean(claim && /^[A-Z0-9]{2}\d{3,4}$/i.test(claim.value));
    }
    if (field === 'flights.inbound[0].code') {
      const claim = renderCoverage.claims.find(item => item.id === 'flight.inbound.code');
      return Boolean(claim && /^[A-Z0-9]{2}\d{3,4}$/i.test(claim.value));
    }
    return true;
  });
  const sourceCoverage = evidenceCoverage(sourceEvidence, requiredFields);
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
