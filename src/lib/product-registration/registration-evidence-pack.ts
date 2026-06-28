import { createHash } from 'node:crypto';

import type { CustomerMobileProofResult } from '@/lib/customer-mobile-proof';
import type { VerifyResult } from '@/lib/upload-verify';
import type { RegistrationQualityScorecard } from '@/lib/product-registration/registration-quality-scorecard';

type V3GateSnapshot = {
  status?: string | null;
  reasons?: string[] | null;
  payloadError?: string | null;
};

export type RegistrationEvidencePack = {
  version: 'registration_evidence_pack_v1';
  status: 'pass' | 'blocked';
  generated_at: string;
  package_id: string | null;
  source: {
    raw_text_present: boolean;
    raw_text_length: number;
    raw_text_sha256: string | null;
    stored_raw_text_hash: string | null;
    package_updated_at: string | null;
  };
  price_dates: {
    package_price_dates: number;
    product_prices: number | null;
    scorecard_status: string | null;
  };
  mobile_proof: {
    status: string | null;
    ok: boolean;
    reason: string;
    checked_at: string | null;
    package_updated_at: string | null;
    stale_or_missing_proof: boolean;
    surfaces: string[];
  };
  downstream_eligibility: {
    customer_open: boolean;
    blog_publish: boolean;
    marketing_stage: boolean;
    blockers: string[];
  };
  scorecard: {
    min_score: number;
    average_score: number;
    customer_open_candidate: boolean;
    failing_domains: string[];
  };
  source_verify_status: VerifyResult['status'] | null;
  v3_gate: V3GateSnapshot | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sha256OrNull(value: string | null): string | null {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex');
}

export function buildRegistrationEvidencePack(input: {
  pkg: Record<string, unknown>;
  mobileProof: CustomerMobileProofResult;
  qualityScorecard: RegistrationQualityScorecard;
  blockers: string[];
  productPriceCount?: number | null;
  sourceVerifyStatus?: VerifyResult['status'] | null;
  v3Gate?: V3GateSnapshot | null;
}): RegistrationEvidencePack {
  const rawText = asString(input.pkg.raw_text);
  const priceDates = asArray(input.pkg.price_dates);
  const proof = input.mobileProof.proof;
  const surfaces = new Set<string>();
  for (const surface of proof?.surfaces ?? []) {
    if (surface) surfaces.add(surface);
  }
  for (const surfaceResult of proof?.surface_results ?? []) {
    if (surfaceResult.surface) surfaces.add(surfaceResult.surface);
  }

  const failingDomains = input.qualityScorecard.domains
    .filter(domain => domain.status !== 'pass' || domain.score < input.qualityScorecard.thresholds.domainMin)
    .map(domain => domain.id);
  const priceDomain = input.qualityScorecard.domains.find(domain => domain.id === 'price_dates');
  const blockers = [...new Set(input.blockers.map(blocker => blocker.trim()).filter(Boolean))];
  const proofBlocked = blockers.some(blocker => /mobile_proof|packages_mobile|lp_mobile|mobile proof|browser proof|actual .* proof/i.test(blocker));
  const openable = blockers.length === 0 && input.mobileProof.ok && input.qualityScorecard.customerOpenCandidate;

  return {
    version: 'registration_evidence_pack_v1',
    status: openable ? 'pass' : 'blocked',
    generated_at: new Date().toISOString(),
    package_id: asString(input.pkg.id),
    source: {
      raw_text_present: Boolean(rawText),
      raw_text_length: rawText?.length ?? 0,
      raw_text_sha256: sha256OrNull(rawText),
      stored_raw_text_hash: asString(input.pkg.raw_text_hash),
      package_updated_at: asString(input.pkg.updated_at),
    },
    price_dates: {
      package_price_dates: priceDates.length,
      product_prices: input.productPriceCount ?? null,
      scorecard_status: priceDomain?.status ?? null,
    },
    mobile_proof: {
      status: proof?.status ?? null,
      ok: input.mobileProof.ok,
      reason: input.mobileProof.reason,
      checked_at: proof?.checked_at ?? null,
      package_updated_at: proof?.package_updated_at ?? null,
      stale_or_missing_proof: !input.mobileProof.ok || proofBlocked,
      surfaces: [...surfaces],
    },
    downstream_eligibility: {
      customer_open: openable,
      blog_publish: openable,
      marketing_stage: openable,
      blockers,
    },
    scorecard: {
      min_score: input.qualityScorecard.minScore,
      average_score: input.qualityScorecard.averageScore,
      customer_open_candidate: input.qualityScorecard.customerOpenCandidate,
      failing_domains: failingDomains,
    },
    source_verify_status: input.sourceVerifyStatus ?? null,
    v3_gate: input.v3Gate
      ? {
          status: input.v3Gate.status ?? null,
          reasons: [...(input.v3Gate.reasons ?? [])],
          payloadError: input.v3Gate.payloadError ?? null,
        }
      : null,
  };
}

export function summarizeEvidencePackForApi(pack: RegistrationEvidencePack): Record<string, unknown> {
  return {
    evidence_pack_status: pack.status,
    stale_or_missing_proof: pack.mobile_proof.stale_or_missing_proof,
    downstream_blockers: pack.downstream_eligibility.blockers,
    downstream_eligibility: pack.downstream_eligibility,
  };
}
