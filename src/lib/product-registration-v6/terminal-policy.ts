import { createHash } from 'node:crypto';

import type { ProductRegistrationV6Decision } from './types';
import { toTerminalOutcome } from './types';

type JsonObject = Record<string, unknown>;

export type ProductRegistrationV6PolicyInput = {
  canonicalPayload: Record<string, unknown>;
  packageIds?: string[];
  revisionIds?: string[];
  sourceTexts?: string[];
  sourceHash?: string | null;
  expectedSourceHash?: string | null;
  tenantId?: string | null;
  sourceTenantId?: string | null;
  sharedFactBlockers?: string[];
  sharedFactDegradedReasons?: string[];
  termsTypes?: string[];
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function hasCancellationEvidence(input: ProductRegistrationV6PolicyInput): boolean {
  if (input.termsTypes?.some(type => type === 'cancellation' || type === 'refund')) return true;
  const raw = input.sourceTexts?.join('\n') ?? '';
  if (/(?:취소|환불|해약|여행약관|특별약관|취소료|위약금)/u.test(raw)) return true;
  return asArray(input.canonicalPayload.sections).some(rawSection => {
    const section = asObject(rawSection);
    const ledger = asObject(asObject(section?.v3)?.ledger);
    return asArray(ledger?.variants).some(rawVariant => {
      const variant = asObject(rawVariant);
      return asArray(variant?.standard_notices).some(rawNotice => {
        const notice = asObject(rawNotice);
        const category = text(notice?.category);
        const value = text(notice?.raw_text) || text(notice?.value) || text(notice?.title);
        return /(?:cancel|refund|penalty|terms)/i.test(category) || /(?:취소|환불|위약금|특별약관)/u.test(value);
      });
    });
  });
}

function priceAndDepartureBlockers(canonicalPayload: Record<string, unknown>): string[] {
  const blockers: string[] = [];
  asArray(canonicalPayload.sections).forEach((rawSection, sectionIndex) => {
    const section = asObject(rawSection);
    const ledger = asObject(asObject(section?.v3)?.ledger);
    asArray(ledger?.variants).forEach((rawVariant, variantIndex) => {
      const prices = asArray(asObject(rawVariant)?.price_calendar);
      if (prices.length === 0) return;
      prices.forEach((rawPrice, priceIndex) => {
        const price = asObject(rawPrice);
        const amount = Number(price?.amount);
        const currency = text(price?.currency) || 'KRW';
        const hasDateScope = Boolean(
          text(price?.date)
          || asObject(price?.date_range)
          || text(price?.weekday)
          || text(price?.label).match(/\d{1,2}[./-]\d{1,2}/),
        );
        const path = `sections[${sectionIndex}].variants[${variantIndex}].price_calendar[${priceIndex}]`;
        if (!Number.isFinite(amount) || amount <= 0) blockers.push(`${path}: 성인 기준 판매가가 유효하지 않습니다.`);
        if (!/^[A-Z]{3}$/.test(currency)) blockers.push(`${path}: 통화 코드가 불명확합니다.`);
        if (!hasDateScope) blockers.push(`${path}: 판매가와 출발일 적용 관계가 불명확합니다.`);
      });
    });
  });
  return blockers;
}

export function evaluateProductRegistrationV6Policy(
  input: ProductRegistrationV6PolicyInput,
): ProductRegistrationV6Decision & { decisionHash: string } {
  const blockers: string[] = [];
  const degradedReasons: string[] = [];

  if (input.expectedSourceHash && input.sourceHash && input.expectedSourceHash !== input.sourceHash) {
    blockers.push('SOURCE_HASH_MISMATCH: 보관 원문과 처리 원문의 해시가 다릅니다.');
  }
  if (input.tenantId && input.sourceTenantId && input.tenantId !== input.sourceTenantId) {
    blockers.push('TENANT_LINEAGE_MISMATCH: 다른 테넌트의 원문 또는 revision이 섞였습니다.');
  }

  const sections = asArray(input.canonicalPayload.sections);
  if (sections.length === 0) blockers.push('PRODUCT_SEGMENTATION_FAILED: 상품 구간을 만들지 못했습니다.');
  sections.forEach((rawSection, sectionIndex) => {
    const completeness = asObject(asObject(rawSection)?.completeness);
    if (!completeness) {
      blockers.push(`sections[${sectionIndex}]: V6 completeness 결과가 없습니다.`);
      return;
    }
    blockers.push(...asArray(completeness.blockers).map(String));
    degradedReasons.push(...asArray(completeness.degradedReasons).map(String));
  });

  blockers.push(...priceAndDepartureBlockers(input.canonicalPayload));
  blockers.push(...(input.sharedFactBlockers ?? []));
  degradedReasons.push(...(input.sharedFactDegradedReasons ?? []));
  if (!hasCancellationEvidence(input)) {
    blockers.push('CANCELLATION_POLICY_MISSING: 적용할 취소·환불 조건의 원문 근거가 없습니다.');
  }

  const finalBlockers = unique(blockers);
  const finalDegradedReasons = unique(degradedReasons);
  const outcome: ProductRegistrationV6Decision['outcome'] = finalBlockers.length > 0
    ? 'blocked'
    : finalDegradedReasons.length > 0
      ? 'degraded'
      : 'verified';
  const decision: ProductRegistrationV6Decision = {
    outcome,
    terminalOutcome: toTerminalOutcome(outcome),
    degradedReasons: finalDegradedReasons,
    blockers: finalBlockers,
    packageIds: input.packageIds ?? [],
    revisionIds: input.revisionIds ?? [],
  };
  return {
    ...decision,
    decisionHash: createHash('sha256').update(JSON.stringify(decision)).digest('hex'),
  };
}
