import { createHash } from 'node:crypto';

type AnyRecord = Record<string, unknown>;

export type QuarantineReasonCode =
  | 'price_fragment_in_itinerary'
  | 'notice_fragment_in_itinerary'
  | 'inclusion_fragment_in_itinerary'
  | 'inclusion_fragment_in_optional_tours'
  | 'condition_badge_in_optional_tours'
  | 'non_paid_item_in_optional_tours'
  | 'placeholder_or_internal_copy'
  | 'fragmentary_route_text';

export type FieldQuarantineCandidate = {
  fieldPath: string;
  originalValue: unknown;
  originalValueHash: string;
  sourceSection: string | null;
  reasonCode: QuarantineReasonCode;
  detectorRuleVersion: string;
  resolutionStatus: 'active_unresolved';
};

export const PACKAGE_FIELD_QUARANTINE_RULE_VERSION = 'package-field-quarantine-v1';

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = asRecord(value);
  if (record) {
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function compactText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  const record = asRecord(value);
  if (!record) return '';
  return [record.name, record.title, record.label, record.description, record.price]
    .map(item => String(item ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

function optionalTourReason(value: unknown): QuarantineReasonCode | null {
  const text = compactText(value);
  const record = asRecord(value);
  if (!text) return 'fragmentary_route_text';
  if (/노옵션|선택\s*관광\s*(?:없음|없습니다|노옵션)/i.test(text)) return 'condition_badge_in_optional_tours';
  if (/^(?:\d{1,3}|\d+\s*월\s*\d+일?|\d{1,3}(?:,\d{3})*\s*원\s*\/?\s*인)$/i.test(text)) return 'fragmentary_route_text';
  if (/포\s*함\s*내\s*역|포함내역|불포함내역|차량|가이드|기사|유류할증료|예약금|상품가/i.test(text)) {
    return 'inclusion_fragment_in_optional_tours';
  }
  const hasName = Boolean(String(record?.name ?? record?.title ?? record?.label ?? '').trim());
  const hasPriceBasis = Boolean(
    Number(record?.price ?? record?.amount) > 0
    || /(?:USD|KRW|달러|원|현지\s*별도\s*문의)/i.test(text),
  );
  return hasName && hasPriceBasis ? null : 'non_paid_item_in_optional_tours';
}

function itineraryReason(value: unknown): QuarantineReasonCode | null {
  const text = compactText(value);
  if (!text) return null;
  if (/^(?:\d{1,3}|\d+\s*월\s*\d+일?|\d{1,3}(?:,\d{3})*\s*원\s*\/?\s*인)$/i.test(text)) return 'price_fragment_in_itinerary';
  if (/포\s*함\s*내\s*역|포함내역|불포함내역|차량|가이드|기사|유류할증료|예약금|상품가/i.test(text)) return 'inclusion_fragment_in_itinerary';
  if (/교환|환불|취소\s*규정|수수료|유의\s*사항/i.test(text)) return 'notice_fragment_in_itinerary';
  if (/사진\s*준비\s*중|이미지\s*준비\s*중|Decision\s+guide/i.test(text)) return 'placeholder_or_internal_copy';
  return null;
}

function candidate(
  fieldPath: string,
  value: unknown,
  sourceSection: string,
  reasonCode: QuarantineReasonCode,
): FieldQuarantineCandidate {
  return {
    fieldPath,
    originalValue: value,
    originalValueHash: hashValue(value),
    sourceSection,
    reasonCode,
    detectorRuleVersion: PACKAGE_FIELD_QUARANTINE_RULE_VERSION,
    resolutionStatus: 'active_unresolved',
  };
}

export function detectPackageFieldPollution(pkg: AnyRecord): FieldQuarantineCandidate[] {
  const findings: FieldQuarantineCandidate[] = [];
  const optionalTours = Array.isArray(pkg.optional_tours) ? pkg.optional_tours : [];
  optionalTours.forEach((value, index) => {
    const reason = optionalTourReason(value);
    if (reason) findings.push(candidate(`optional_tours.${index}`, value, 'optional_tours', reason));
  });

  const itinerary = asRecord(pkg.itinerary_data);
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  days.forEach((day, dayIndex) => {
    const dayRecord = asRecord(day);
    const schedule = Array.isArray(dayRecord?.schedule) ? dayRecord.schedule : [];
    schedule.forEach((value, scheduleIndex) => {
      const reason = itineraryReason(value);
      if (reason) findings.push(candidate(
        `itinerary_data.days.${dayIndex}.schedule.${scheduleIndex}`,
        value,
        'itinerary',
        reason,
      ));
    });
  });
  return findings;
}

export function quarantineIdempotencyKey(packageId: string, finding: FieldQuarantineCandidate): string {
  return [packageId, finding.fieldPath, finding.originalValueHash, finding.detectorRuleVersion].join(':');
}

export function applyDeterministicFieldQuarantine(pkg: AnyRecord): {
  repairedPackage: AnyRecord;
  findings: FieldQuarantineCandidate[];
} {
  const findings = detectPackageFieldPollution(pkg);
  if (findings.length === 0) return { repairedPackage: pkg, findings };

  const optionalIndexes = new Set(
    findings
      .map(item => item.fieldPath.match(/^optional_tours\.(\d+)$/)?.[1])
      .filter((index): index is string => Boolean(index))
      .map(Number),
  );
  const schedulePaths = new Set(
    findings
      .filter(item => item.fieldPath.startsWith('itinerary_data.days.'))
      .map(item => item.fieldPath),
  );
  const itinerary = asRecord(pkg.itinerary_data);
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  const repairedDays = days.map((day, dayIndex) => {
    const dayRecord = asRecord(day);
    if (!dayRecord || !Array.isArray(dayRecord.schedule)) return day;
    return {
      ...dayRecord,
      schedule: dayRecord.schedule.filter((_, scheduleIndex) => !schedulePaths.has(
        `itinerary_data.days.${dayIndex}.schedule.${scheduleIndex}`,
      )),
    };
  });

  return {
    findings,
    repairedPackage: {
      ...pkg,
      optional_tours: Array.isArray(pkg.optional_tours)
        ? pkg.optional_tours.filter((_, index) => !optionalIndexes.has(index))
        : pkg.optional_tours,
      itinerary_data: itinerary ? { ...itinerary, days: repairedDays } : pkg.itinerary_data,
    },
  };
}
