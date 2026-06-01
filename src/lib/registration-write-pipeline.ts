/**
 * @file registration-write-pipeline.ts — 신규 등록 write-time SSOT
 *
 * postProcess → sanitize → L1 CRC → travel_packages / products status 를
 * upload · register-via-ir 가 동일하게 사용.
 */

import {
  computeWriteTimePackageState,
  type PostProcessCatalogInput,
} from '@/lib/package-post-process';
import {
  evaluateL1CustomerReadyGate,
  decidePackageStatusFromL1,
  type L1GateResult,
} from '@/lib/l1-customer-ready-gate';
import type { GateResult } from '@/lib/parser/customer-ready-gate';

type ItineraryLike = Parameters<typeof computeWriteTimePackageState>[0]['itinerary_data'];

export type RegistrationWriteInput = {
  row: PostProcessCatalogInput & {
    itinerary_data?: ItineraryLike;
    parser_version?: string | null;
    surcharges?: unknown[] | null;
  };
  rawText?: string | null;
  internalCode?: string | null;
  shortCode?: string | null;
  confidence?: number;
  minConfidence?: number;
  allowWarningsApprove?: boolean;
  /** upload G4 legacy — display_title·썸네일 등 products 전용 보완 */
  legacyProductsGate?: GateResult;
};

export type RegistrationWriteResult = {
  row: RegistrationWriteInput['row'];
  l1: L1GateResult;
  travelPackageStatus: 'approved' | 'pending_review';
  productsStatus: 'approved' | 'REVIEW_NEEDED' | 'draft';
};

export function mapTravelPackageUploadStatus(
  status: RegistrationWriteResult['travelPackageStatus'],
): 'approved' | 'pending' {
  return status === 'pending_review' ? 'pending' : status;
}

export function mapProductsStatusFromL1(
  l1: L1GateResult,
  travelPackageStatus: 'approved' | 'pending_review',
): 'approved' | 'REVIEW_NEEDED' | 'draft' {
  if (l1.reasons.length > 0) return 'REVIEW_NEEDED';
  if (travelPackageStatus === 'pending_review') {
    if (l1.warnings.length > 0) return 'draft';
    return 'REVIEW_NEEDED';
  }
  return 'approved';
}

function applyLegacyProductsGate(
  base: RegistrationWriteResult['productsStatus'],
  gate?: GateResult,
): RegistrationWriteResult['productsStatus'] {
  if (!gate) return base;
  if (gate.reasons.length > 0) return 'REVIEW_NEEDED';
  if (gate.warnings.length > 0 && base === 'approved') return 'draft';
  return base;
}

/** INSERT 직전 — postProcess + sanitize + L1 + 양 테이블 status */
export function prepareRegistrationWrite(input: RegistrationWriteInput): RegistrationWriteResult {
  const row = computeWriteTimePackageState(input.row);
  const l1 = evaluateL1CustomerReadyGate({
    row,
    rawText: input.rawText,
    internalCode: input.internalCode,
    shortCode: input.shortCode,
    alreadyProcessed: true,
  });
  const travelPackageStatus = decidePackageStatusFromL1(l1, {
    confidence: input.confidence,
    minConfidence: input.minConfidence ?? 0.85,
    allowWarningsApprove: input.allowWarningsApprove ?? false,
  });
  let productsStatus = mapProductsStatusFromL1(l1, travelPackageStatus);
  productsStatus = applyLegacyProductsGate(productsStatus, input.legacyProductsGate);
  return { row, l1, travelPackageStatus, productsStatus };
}
