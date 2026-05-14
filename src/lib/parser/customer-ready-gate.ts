/**
 * @file customer-ready-gate.ts — 자동 approve 게이트 (사장님 손 떼기, 2026-05-14 UX-6)
 *
 * 데이터 + UX + paraphrase + photo 모두 통과해야 status='approved' 자동.
 * 1개라도 실패 → status='review_required' + 정확한 보완 안내.
 */

import type { ExtractedData } from '@/lib/parser';
import { isWeakCopy } from './recommendation-copy';

export type GateResult = {
  ready: boolean;
  reasons: string[];
  warnings: string[];
};

interface GateInput {
  ed: ExtractedData;
  netPrice: number;
  priceRowCount: number;
  confidence: number;
  hasItinerary: boolean;
  hasThumbnail: boolean;
}

export function evaluateCustomerReadyGate(input: GateInput): GateResult {
  const reasons: string[] = []; // BLOCK 사유 (active 진입 차단)
  const warnings: string[] = []; // 권고 (active 가능, 사장님 검수 권장)
  const ed = input.ed;

  // 1) 기본 데이터 검증
  if (!ed.title || ed.title.trim().length < 5) reasons.push('title 누락');
  if (!ed.destination || ed.destination.trim().length < 2) reasons.push('destination 누락');
  if (input.netPrice <= 1 || input.priceRowCount === 0) reasons.push('가격 정보 없음');
  if (!input.hasItinerary) reasons.push('일정표 없음');
  if (!ed.product_type) warnings.push('product_type 미정 (package/cruise/golf 분류)');

  // 2) UX 검증
  const displayTitle = (ed as { display_title?: string }).display_title;
  if (!displayTitle || displayTitle.trim().length < 4) {
    warnings.push('display_title 누락 — 모바일 hero 후킹 없음');
  }
  const productSummary = ed.product_summary;
  if (!productSummary || isWeakCopy(productSummary, ed.title)) {
    warnings.push('product_summary 무의미 — 자동 재생성 권장');
  }

  // 3) 사진
  if (!input.hasThumbnail) {
    warnings.push('thumbnail_urls 없음 — auto-photo-match 실패');
  }

  // 4) ferry/cruise 일관성
  if (ed.product_type === 'cruise' || ed.product_type === 'ferry') {
    if (ed.airline && /^[A-Z]{2}\d{2,4}/.test(ed.airline)) {
      reasons.push('ferry 분류인데 airline 이 항공편 코드 — Critic 자동 수정 실패');
    }
  }

  // 5) confidence 임계값
  if (input.confidence < 0.7) {
    warnings.push(`confidence ${(input.confidence * 100).toFixed(0)}% < 70% — 검수 권장`);
  }

  return {
    ready: reasons.length === 0 && warnings.length === 0,
    reasons,
    warnings,
  };
}

/**
 * 게이트 결과 → status 자동 결정.
 *   ready=true → 'approved' (모바일 노출)
 *   reasons 있으면 → 'review_required'
 *   warnings 만 있으면 → 'draft' (사장님 검수 권장)
 */
export function decideStatusFromGate(gate: GateResult): 'approved' | 'review_required' | 'draft' {
  if (gate.reasons.length > 0) return 'review_required';
  if (gate.warnings.length > 0) return 'draft';
  return 'approved';
}
