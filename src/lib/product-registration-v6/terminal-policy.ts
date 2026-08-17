import { createHash } from 'node:crypto';

import type { ProductRegistrationV6Decision } from './types';
import { toTerminalOutcome } from './types';
import {
  resolveSourceSalePriceDisposition,
  type SourceSalePriceDisposition,
} from './source-sale-price-disposition';
import {
  PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
  PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
} from '@/lib/product-registration/future-departure-date-policy';
import { extractSourceWonAmounts } from '@/lib/parser/deterministic/price-ir';

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
  cancellationCoverage?: Array<{
    revisionId: string;
    catalogProductId: string;
    covered: boolean;
    policyHash: string;
    conflict?: boolean;
    conflictReasons?: string[];
  }>;
  departureDateReference?: {
    referenceDate: string;
    timezone: typeof PRODUCT_SOURCE_DEPARTURE_TIMEZONE;
    policyVersion: string;
    rollingInferenceEligible: boolean;
  };
  precomputedSourceSalePriceDispositions?: SourceSalePriceDisposition[];
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

function ticketingConditionDegradedReasons(input: ProductRegistrationV6PolicyInput): string[] {
  const reasons: string[] = [];
  const sections = asArray(input.canonicalPayload.sections);
  sections.forEach((rawSection, sectionIndex) => {
    const ledger = asObject(asObject(rawSection)?.v3)?.ledger;
    const variants = asArray(asObject(ledger)?.variants);
    let resolvedConditionCount = 0;
    variants.forEach((rawVariant, variantIndex) => {
      const condition = asObject(asObject(rawVariant)?.ticketing_condition);
      if (!condition) return;
      resolvedConditionCount += 1;
      const status = text(condition.status);
      const deadline = text(condition.deadline);
      const evidence = asObject(condition.evidence);
      if (!text(evidence?.quote)) {
        reasons.push(`sections[${sectionIndex}].variants[${variantIndex}]:TICKETING_CONDITION_EVIDENCE_MISSING`);
      }
      if (status === 'expired') {
        reasons.push(`sections[${sectionIndex}].variants[${variantIndex}]:TICKETING_DEADLINE_EXPIRED_RECONFIRMATION_REQUIRED:${deadline || 'unknown'}`);
      } else if (status === 'conflicting') {
        reasons.push(`sections[${sectionIndex}].variants[${variantIndex}]:TICKETING_DEADLINE_VARIANTS_REQUIRE_RECONFIRMATION`);
      }
    });
    const sourceText = input.sourceTexts?.[sectionIndex] ?? '';
    if (/발권/u.test(sourceText) && resolvedConditionCount === 0) {
      reasons.push(`sections[${sectionIndex}]:TICKETING_CONDITION_UNRESOLVED_RECONFIRMATION_REQUIRED`);
    }
  });
  return reasons;
}

function hasCancellationEvidence(input: ProductRegistrationV6PolicyInput): boolean {
  if (input.termsTypes?.some(type => type === 'cancellation')) return true;
  const raw = input.sourceTexts?.join('\n') ?? '';
  if (/(?:cancel|cancellation|취소|취소료|해약|여행약관|특별약관|위약금|패널티)/iu.test(raw)) return true;
  return asArray(input.canonicalPayload.sections).some(rawSection => {
    const section = asObject(rawSection);
    const ledger = asObject(asObject(section?.v3)?.ledger);
    return asArray(ledger?.variants).some(rawVariant => {
      const variant = asObject(rawVariant);
      return asArray(variant?.standard_notices).some(rawNotice => {
        const notice = asObject(rawNotice);
        const category = text(notice?.category);
        const value = text(notice?.raw_text) || text(notice?.value) || text(notice?.title);
        return /(?:cancel|cancellation|penalty|terms)/i.test(category)
          || /(?:취소|취소료|해약|여행약관|특별약관|위약금|패널티)/u.test(value);
      });
    });
  });
}

function customerFactContradictionBlockers(canonicalPayload: Record<string, unknown>): string[] {
  const blockers: string[] = [];
  asArray(canonicalPayload.sections).forEach((rawSection, sectionIndex) => {
    const ledger = asObject(asObject(asObject(rawSection)?.v3)?.ledger);
    asArray(ledger?.variants).forEach((rawVariant, variantIndex) => {
      const variant = asObject(rawVariant);
      const notices = asArray(variant?.standard_notices).map(asObject).filter((value): value is JsonObject => Boolean(value));
      const keys = new Set(notices
        .filter(notice => text(notice.review_status) !== 'rejected')
        .map(notice => text(notice.template_key)));
      const guideFacts = asArray(variant?.structured_facts)
        .map(asObject)
        .filter((value): value is JsonObject => Boolean(value))
        .filter(fact => text(fact.category) === 'guide_tip' && text(fact.review_status) !== 'rejected');
      const guideFactValues = guideFacts
        .map(fact => asObject(fact.values))
        .filter((value): value is JsonObject => Boolean(value));
      const hasIncludedGuideFact = guideFactValues.some(values => values.included === true);
      const hasExcludedGuideFact = guideFactValues.some(values => values.included === false);
      const prefix = `sections[${sectionIndex}].variants[${variantIndex}]`;
      if (
        (keys.has('guide.tip_included') && keys.has('guide.tip_amount_local_payment'))
        || (hasIncludedGuideFact && hasExcludedGuideFact)
      ) {
        blockers.push(`${prefix}:CUSTOMER_FACT_CONTRADICTION:GUIDE_TIP_INCLUDED_AND_LOCAL_PAYMENT`);
      }
      if (keys.has('optional.none') && asArray(variant?.options).length > 0) {
        blockers.push(`${prefix}:CUSTOMER_FACT_CONTRADICTION:NO_OPTION_WITH_OPTION_ITEMS`);
      }
      if (keys.has('shopping.none') && asArray(variant?.shopping).length > 0) {
        blockers.push(`${prefix}:CUSTOMER_FACT_CONTRADICTION:NO_SHOPPING_WITH_SHOPPING_ITEMS`);
      }
    });
  });
  return blockers;
}

function priceAmountsFromEvidenceQuote(value: string): number[] {
  return [...new Set(extractSourceWonAmounts(value, {
    allowBareSaleShorthand: /(?:특가|판매\s*가|상품\s*가|행사\s*가|할인\s*가|최종\s*가|성인|1\s*인)/u.test(value),
    minAmount: 30_000,
    maxAmount: 100_000_000,
  }).map(candidate => candidate.amount))];
}

function priceAndDepartureBlockers(
  canonicalPayload: Record<string, unknown>,
  departureDateReference?: ProductRegistrationV6PolicyInput['departureDateReference'],
): string[] {
  const blockers: string[] = [];
  asArray(canonicalPayload.sections).forEach((rawSection, sectionIndex) => {
    const section = asObject(rawSection);
    const ledger = asObject(asObject(section?.v3)?.ledger);
    const yearEvidence = asObject(section?.priceYearEvidence);
    const sectionDatePolicy = asObject(section?.departureDatePolicy);
    blockers.push(...asArray(sectionDatePolicy?.blockers).map(value =>
      `sections[${sectionIndex}]:${String(value)}`));
    if (departureDateReference && (
      text(sectionDatePolicy?.referenceDate) !== departureDateReference.referenceDate
      || text(sectionDatePolicy?.policyVersion) !== departureDateReference.policyVersion
      || text(sectionDatePolicy?.timezone) !== departureDateReference.timezone
    )) {
      blockers.push(`sections[${sectionIndex}]:DEPARTURE_DATE_POLICY_LINEAGE_MISMATCH`);
    }
    let hasCalendarDate = false;
    asArray(ledger?.variants).forEach((rawVariant, variantIndex) => {
      const prices = asArray(asObject(rawVariant)?.price_calendar);
      if (prices.length === 0) return;
      const amountByExactScope = new Map<string, number>();
      prices.forEach((rawPrice, priceIndex) => {
        const price = asObject(rawPrice);
        const amount = Number(price?.amount);
        const currency = text(price?.currency);
        const dateRange = asObject(price?.date_range);
        const weekday = typeof price?.weekday === 'number' ? price.weekday : Number.NaN;
        const hasDateScope = Boolean(
          /^\d{4}-\d{2}-\d{2}$/u.test(text(price?.date))
          || (dateRange && /^\d{4}-\d{2}-\d{2}$/u.test(text(dateRange.start)) && /^\d{4}-\d{2}-\d{2}$/u.test(text(dateRange.end)))
          || (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
          || text(price?.label).match(/\d{1,2}[./-]\d{1,2}/),
        );
        if (/^\d{4}-\d{2}-\d{2}$/u.test(text(price?.date)) || dateRange) hasCalendarDate = true;
        const path = `sections[${sectionIndex}].variants[${variantIndex}].price_calendar[${priceIndex}]`;
        const exactDate = text(price?.date);
        const rangeStart = text(dateRange?.start);
        const rangeEnd = text(dateRange?.end);
        const scopeIdentity = exactDate
          ? `date:${exactDate}`
          : rangeStart && rangeEnd
            ? `range:${rangeStart}:${rangeEnd}:weekday:${Number.isInteger(weekday) ? weekday : ''}`
            : Number.isInteger(weekday)
              ? `weekday:${weekday}`
              : '';
        if (scopeIdentity && Number.isFinite(amount)) {
          const commercialScope = [
            scopeIdentity,
            currency,
            price?.min_travelers == null ? '' : String(price.min_travelers),
            price?.max_travelers == null ? '' : String(price.max_travelers),
            text(price?.price_relation),
            text(price?.option_type),
            text(price?.option_label),
          ].join('|');
          const previousAmount = amountByExactScope.get(commercialScope);
          if (previousAmount != null && previousAmount !== amount) {
            blockers.push(`${path}:PRICE_SCOPE_CONFLICT:${previousAmount}:${amount}`);
          } else {
            amountByExactScope.set(commercialScope, amount);
          }
        }
        if (departureDateReference && (exactDate || dateRange)) {
          const dateResolution = asObject(price?.date_resolution);
          if (
            text(dateResolution?.reference_date) !== departureDateReference.referenceDate
            || text(dateResolution?.timezone) !== departureDateReference.timezone
            || text(dateResolution?.policy_version) !== PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION
          ) {
            blockers.push(`${path}:DEPARTURE_DATE_RESOLUTION_LINEAGE_MISSING`);
          }
          if (exactDate && exactDate < departureDateReference.referenceDate) {
            blockers.push(`${path}:PAST_DEPARTURE_DATE_FORBIDDEN`);
          }
          if (rangeEnd && rangeEnd < departureDateReference.referenceDate) {
            blockers.push(`${path}:PAST_DEPARTURE_RANGE_FORBIDDEN`);
          }
          if (rangeStart && rangeStart < departureDateReference.referenceDate) {
            blockers.push(`${path}:UNCLIPPED_PAST_DEPARTURE_RANGE_FORBIDDEN`);
          }
        }
        if (!Number.isFinite(amount) || amount <= 0) blockers.push(`${path}: 성인 기준 판매가가 유효하지 않습니다.`);
        if (!/^[A-Z]{3}$/.test(currency)) blockers.push(`${path}: 통화 코드가 불명확합니다.`);
        if (!hasDateScope) blockers.push(`${path}: 판매가와 출발일 적용 관계가 불명확합니다.`);
        const evidence = asObject(price?.evidence);
        const quote = text(evidence?.quote).normalize('NFKC');
        const evidenceAmounts = priceAmountsFromEvidenceQuote(quote);
        if (
          evidence?.extraction_method === 'document_ir_table_cell'
          && Number(evidence?.source_amount_scale) === 1000
        ) {
          for (const match of quote.matchAll(/(?:^|[^\d])(\d{3}|\d{1,2},\d{3})(?:[^\d]|$)/gu)) {
            const scaled = Number(match[1].replace(/,/gu, '')) * 1_000;
            if (Number.isFinite(scaled)) evidenceAmounts.push(scaled);
          }
        }
        if (!evidenceAmounts.includes(amount)) {
          blockers.push(`${path}: 판매가 금액이 원문 evidence 문구에서 재확인되지 않습니다.`);
        }
      });
    });
    const nearestFuturePolicyValidated = yearEvidence?.source === 'nearest_future_policy'
      && yearEvidence?.validated === true
      && text(yearEvidence?.referenceDate) === departureDateReference?.referenceDate
      && text(yearEvidence?.policyVersion) === PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION
      && text(yearEvidence?.timezone) === PRODUCT_SOURCE_DEPARTURE_TIMEZONE;
    if (hasCalendarDate && yearEvidence?.validated === false && !nearestFuturePolicyValidated) {
      blockers.push(`sections[${sectionIndex}]: 출발 연도가 원문 본문 또는 파일명에서 확인되지 않아 자동 추정 연도를 공개할 수 없습니다.`);
    }
  });
  return blockers;
}

export function evaluateProductRegistrationV6Policy(
  input: ProductRegistrationV6PolicyInput,
): ProductRegistrationV6Decision & {
  decisionHash: string;
  sourceSalePriceDispositions: Array<{
    sectionIndex: number;
    disposition: SourceSalePriceDisposition;
  }>;
} {
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
  const sourceSalePriceDispositions = sections.map((rawSection, sectionIndex) => ({
    sectionIndex,
    disposition: input.precomputedSourceSalePriceDispositions?.[sectionIndex]
      ?? resolveSourceSalePriceDisposition({
        sourceText: input.sourceTexts?.[sectionIndex] ?? '',
        canonicalSection: asObject(rawSection) ?? {},
      }),
  }));
  sourceSalePriceDispositions
    .filter(item => item.disposition.shouldDiscard)
    .forEach(item => blockers.push(
      `sections[${item.sectionIndex}]:SOURCE_SALE_PRICE_ABSENT: 원문에 성인 기준 판매가가 없어 등록 대상에서 제외합니다.`,
    ));
  sourceSalePriceDispositions
    .filter(item => item.disposition.state === 'source_price_requires_resolution')
    .forEach(item => blockers.push(
      `sections[${item.sectionIndex}]:SOURCE_SALE_PRICE_REQUIRES_RESOLUTION: 원문에 판매가 후보가 있지만 가격 엔진이 확정하지 못했습니다.`,
    ));
  sections.forEach((rawSection, sectionIndex) => {
    const completeness = asObject(asObject(rawSection)?.completeness);
    if (!completeness) {
      blockers.push(`sections[${sectionIndex}]: V6 completeness 결과가 없습니다.`);
      return;
    }
    blockers.push(...asArray(completeness.blockers).map(String));
    degradedReasons.push(...asArray(completeness.degradedReasons).map(String));
  });

  degradedReasons.push(...ticketingConditionDegradedReasons(input));

  blockers.push(...customerFactContradictionBlockers(input.canonicalPayload));
  blockers.push(...priceAndDepartureBlockers(input.canonicalPayload, input.departureDateReference));
  blockers.push(...(input.sharedFactBlockers ?? []));
  degradedReasons.push(...(input.sharedFactDegradedReasons ?? []));
  if (input.cancellationCoverage && input.cancellationCoverage.length > 0) {
    input.cancellationCoverage
      .filter(item => item.conflict)
      .forEach(item => blockers.push(
        `CANCELLATION_POLICY_CONFLICT:${item.catalogProductId}:${(item.conflictReasons ?? []).join(',') || 'SOURCE_TERMS_CONFLICT'}`,
      ));
    input.cancellationCoverage
      .filter(item => !item.covered && !item.conflict)
      .forEach(item => blockers.push(
        `CANCELLATION_POLICY_MISSING:${item.catalogProductId}: 적용할 취소·환불 조건의 원문 또는 승인 정책 근거가 없습니다.`,
      ));
  } else if (!hasCancellationEvidence(input)) {
    blockers.push('CANCELLATION_POLICY_MISSING: 적용할 취소·환불 조건의 원문 또는 승인 정책 근거가 없습니다.');
  }

  const finalBlockers = unique(blockers);
  const finalDegradedReasons = unique(degradedReasons);
  const outcome: ProductRegistrationV6Decision['outcome'] = finalBlockers.length > 0
    ? 'blocked'
    : finalDegradedReasons.length > 0
      ? 'degraded'
      : 'verified';
  const everySectionMissingSourceSalePrice = sourceSalePriceDispositions.length > 0
    && sourceSalePriceDispositions.every(item => item.disposition.shouldDiscard);
  const decision: ProductRegistrationV6Decision = {
    outcome,
    terminalOutcome: everySectionMissingSourceSalePrice
      ? 'discarded_source_incomplete'
      : toTerminalOutcome(outcome),
    degradedReasons: finalDegradedReasons,
    blockers: finalBlockers,
    packageIds: input.packageIds ?? [],
    revisionIds: input.revisionIds ?? [],
  };
  return {
    ...decision,
    sourceSalePriceDispositions,
    decisionHash: createHash('sha256').update(JSON.stringify({
      decision,
      sourceSalePriceDispositions,
      cancellationCoverage: input.cancellationCoverage ?? null,
    })).digest('hex'),
  };
}
