import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateCustomerMobileProof, type CustomerMobileProofResult } from '@/lib/customer-mobile-proof';
import { evaluateVerifyChecks, type VerifyResult } from '@/lib/upload-verify';
import {
  evaluateRegistrationQualityScorecard,
  type RegistrationQualityProductPrice,
  type RegistrationQualityScorecard,
  type RegistrationQualityVerifyCheck,
} from '@/lib/product-registration/registration-quality-scorecard';
import {
  buildRegistrationEvidencePack,
  type RegistrationEvidencePack,
} from '@/lib/product-registration/registration-evidence-pack';
import {
  evaluateV3CustomerNoticeGate,
  hasSupplierRemarkRawLeakRisk,
  loadLatestV3DraftForPackage,
} from '@/lib/product-registration-v3/customer-payload';

type V3GateLike = {
  blocksApproval?: boolean;
  payloadError?: string | null;
  blockReasons?: string[] | null;
  draftStatus?: string | null;
};

export type CustomerOpenContractResult = {
  ok: boolean;
  status: 'pass' | 'blocked';
  packageId: string | null;
  checkedAt: string;
  blockers: string[];
  warnings: string[];
  nextAction: 'customer_open_candidate' | 'repair_then_reproof_or_review';
  mobileProof: CustomerMobileProofResult;
  qualityScorecard: RegistrationQualityScorecard;
  sourceVerifyStatus?: VerifyResult['status'];
  v3Gate?: {
    status: string | null;
    reasons: string[];
    payloadError: string | null;
  };
  evidencePack: RegistrationEvidencePack;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function v3Blockers(v3Gate: V3GateLike | null | undefined, pkg: Record<string, unknown>): string[] {
  const blockers: string[] = [];
  if (v3Gate?.blocksApproval) {
    blockers.push(...(v3Gate.blockReasons ?? []).map(reason => `v3:${reason}`));
    if ((v3Gate.blockReasons ?? []).length === 0) blockers.push('v3:blocks_approval');
  }
  if (v3Gate?.payloadError) blockers.push(`v3_payload:${v3Gate.payloadError}`);
  if (!v3Gate && hasSupplierRemarkRawLeakRisk(pkg as Parameters<typeof hasSupplierRemarkRawLeakRisk>[0])) {
    blockers.push('v3:supplier_remark_raw_leak_risk_without_latest_gate');
  }
  return blockers;
}

export function evaluateCustomerOpenContract(input: {
  pkg: Record<string, unknown>;
  verifyChecks?: RegistrationQualityVerifyCheck[];
  productPrices?: RegistrationQualityProductPrice[] | null;
  mobileProof?: CustomerMobileProofResult | null;
  v3Gate?: V3GateLike | null;
  sourceVerifyStatus?: VerifyResult['status'];
}): CustomerOpenContractResult {
  const packageId = asString(input.pkg.id);
  const mobileProof = input.mobileProof ?? evaluateCustomerMobileProof({
    auditReport: input.pkg.audit_report ?? null,
    packageUpdatedAt: asString(input.pkg.updated_at),
  });
  const qualityScorecard = evaluateRegistrationQualityScorecard({
    pkg: input.pkg,
    verifyChecks: input.verifyChecks ?? [],
    productPrices: input.productPrices ?? null,
    mobileProof,
  });
  const blockers = unique([
    ...(!mobileProof.ok ? [`mobile_proof:${mobileProof.reason}`] : []),
    ...(!qualityScorecard.customerOpenCandidate
      ? qualityScorecard.blockers.map(blocker => `quality_scorecard:${blocker}`)
      : []),
    ...v3Blockers(input.v3Gate, input.pkg),
  ]);
  const v3GateSnapshot = input.v3Gate
    ? {
        status: input.v3Gate.draftStatus ?? null,
        reasons: [...(input.v3Gate.blockReasons ?? [])],
        payloadError: input.v3Gate.payloadError ?? null,
      }
    : undefined;
  const evidencePack = buildRegistrationEvidencePack({
    pkg: input.pkg,
    mobileProof,
    qualityScorecard,
    blockers,
    productPriceCount: input.productPrices?.length ?? (input.productPrices === null ? null : 0),
    sourceVerifyStatus: input.sourceVerifyStatus,
    v3Gate: v3GateSnapshot,
  });
  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? 'pass' : 'blocked',
    packageId,
    checkedAt: new Date().toISOString(),
    blockers,
    warnings: [],
    nextAction: blockers.length === 0 ? 'customer_open_candidate' : 'repair_then_reproof_or_review',
    mobileProof,
    qualityScorecard,
    sourceVerifyStatus: input.sourceVerifyStatus,
    v3Gate: v3GateSnapshot,
    evidencePack,
  };
}

async function loadProductPrices(
  supabase: SupabaseClient,
  internalCode: unknown,
): Promise<RegistrationQualityProductPrice[] | null> {
  const code = asString(internalCode);
  if (!code) return [];
  const { data, error } = await supabase
    .from('product_prices')
    .select('target_date,net_price,adult_selling_price,child_price,note')
    .eq('product_id', code)
    .limit(1000);
  if (error) return null;
  return (data ?? []) as RegistrationQualityProductPrice[];
}

export async function loadCustomerOpenContractForPackage(
  supabase: SupabaseClient,
  packageId: string,
): Promise<CustomerOpenContractResult> {
  const { data, error } = await supabase
    .from('travel_packages')
    .select('*')
    .eq('id', packageId)
    .single();
  if (error || !data) {
    const pkg = { id: packageId };
    const mobileProof = evaluateCustomerMobileProof({ auditReport: null, packageUpdatedAt: null });
    const qualityScorecard = evaluateRegistrationQualityScorecard({
      pkg,
      verifyChecks: [],
      productPrices: null,
      mobileProof,
    });
    return {
      ok: false,
      status: 'blocked',
      packageId,
      checkedAt: new Date().toISOString(),
      blockers: [`package_lookup:${error?.message ?? 'not_found'}`],
      warnings: [],
      nextAction: 'repair_then_reproof_or_review',
      mobileProof,
      qualityScorecard,
      evidencePack: buildRegistrationEvidencePack({
        pkg,
        mobileProof,
        qualityScorecard,
        blockers: [`package_lookup:${error?.message ?? 'not_found'}`],
      }),
    };
  }

  const pkg = asRecord(data) ?? { id: packageId };
  const sourceVerify = evaluateVerifyChecks({
    ...pkg,
    status: 'active',
    audit_status: 'clean',
  } as Parameters<typeof evaluateVerifyChecks>[0]);
  const productPrices = await loadProductPrices(supabase, pkg.internal_code);
  const latestV3Draft = await loadLatestV3DraftForPackage(supabase, packageId);
  const v3Gate = evaluateV3CustomerNoticeGate(packageId, latestV3Draft);
  return evaluateCustomerOpenContract({
    pkg,
    verifyChecks: sourceVerify.checks,
    productPrices,
    v3Gate,
    sourceVerifyStatus: sourceVerify.status,
  });
}

export function customerOpenContractAuditPayload(contract: CustomerOpenContractResult): Record<string, unknown> {
  return {
    status: contract.status,
    ok: contract.ok,
    checked_at: contract.checkedAt,
    blockers: contract.blockers,
    warnings: contract.warnings,
    next_action: contract.nextAction,
    mobile_browser_proof: contract.mobileProof,
    quality_scorecard: contract.qualityScorecard,
    source_verify_status: contract.sourceVerifyStatus ?? null,
    v3_gate: contract.v3Gate ?? null,
    registration_evidence_pack_v1: contract.evidencePack,
    evidence_pack_status: contract.evidencePack.status,
    stale_or_missing_proof: contract.evidencePack.mobile_proof.stale_or_missing_proof,
    downstream_blockers: contract.evidencePack.downstream_eligibility.blockers,
  };
}
