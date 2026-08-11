export type RegistrationFieldState =
  | 'confirmed'
  | 'pending_supplier'
  | 'not_applicable'
  | 'conflicting'
  | 'unavailable';

export type RegistrationFieldCompletion = {
  fieldPath: string;
  state: RegistrationFieldState;
  criticality: 'critical' | 'high' | 'normal';
  reason: string;
};

export type CanonicalCompleteness = {
  fields: RegistrationFieldCompletion[];
  confirmedCount: number;
  pendingSupplierCount: number;
  conflictingCount: number;
  unavailableCount: number;
  publicReady: boolean;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasText(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function field(
  fieldPath: string,
  state: RegistrationFieldState,
  criticality: RegistrationFieldCompletion['criticality'],
  reason: string,
): RegistrationFieldCompletion {
  return { fieldPath, state, criticality, reason };
}

/**
 * Converts parser gaps into explicit workflow states. Missing source facts are
 * not silently treated as parser failures and are never filled with guesses.
 */
export function evaluateCanonicalCompleteness(input: {
  rawText: string;
  canonicalSection: Record<string, unknown>;
  sectionIndex: number;
}): CanonicalCompleteness {
  const v3 = asObject(input.canonicalSection.v3);
  const ledger = asObject(v3?.ledger);
  const variants = asArray(ledger?.variants).map(asObject).filter((value): value is JsonObject => Boolean(value));
  const fields: RegistrationFieldCompletion[] = [];
  const rawText = input.rawText;
  const sourcePending = hasText(rawText, /(?:별도\s*문의|추후\s*확정|미정|출시\s*예정|상기\s*참조)/u);

  if (variants.length === 0) {
    fields.push(field(`sections[${input.sectionIndex}].variants`, 'unavailable', 'critical', '정규화된 상품 변형이 없습니다.'));
  }

  variants.forEach((variant, variantIndex) => {
    const prefix = `sections[${input.sectionIndex}].variants[${variantIndex}]`;
    const prices = asArray(variant.price_calendar);
    fields.push(
      prices.length > 0
        ? field(`${prefix}.price`, 'confirmed', 'critical', '원문 근거 가격이 생성되었습니다.')
        : field(`${prefix}.price`, sourcePending ? 'pending_supplier' : 'unavailable', 'critical', '고객 판매 가격이 없습니다.'),
    );

    const days = asArray(variant.days);
    fields.push(
      days.length > 0
        ? field(`${prefix}.itinerary`, 'confirmed', 'high', '일정 DAY 구조가 생성되었습니다.')
        : field(`${prefix}.itinerary`, 'unavailable', 'high', '일정 DAY 구조가 없습니다.'),
    );

    const flights = asArray(variant.flight_segments).map(asObject).filter((value): value is JsonObject => Boolean(value));
    if (flights.length === 0) {
      fields.push(
        hasText(rawText, /(?:페리|선박|크루즈|배편|카멜리아|부산항)/u)
          ? field(`${prefix}.flight`, 'not_applicable', 'critical', '원문이 항공이 아닌 선박/페리 상품입니다.')
          : field(`${prefix}.flight`, sourcePending ? 'pending_supplier' : 'unavailable', 'critical', '왕복 항공 근거가 없습니다.'),
      );
    } else {
      const incomplete = flights.some(flight => {
        const leg = String(flight.leg ?? '');
        return (leg === 'outbound' || leg === 'inbound') && (!flight.dep_time || !flight.arr_time);
      });
      fields.push(
        incomplete
          ? field(`${prefix}.flight_times`, 'pending_supplier', 'critical', '항공편은 있으나 출발·도착 시간이 모두 연결되지 않았습니다.')
          : field(`${prefix}.flight_times`, 'confirmed', 'critical', '왕복 항공편과 시간이 연결되었습니다.'),
      );
    }

    const hotels = days
      .map(day => asObject(day)?.hotel)
      .map(asObject)
      .filter((value): value is JsonObject => Boolean(value));
    fields.push(
      hotels.some(hotel => typeof hotel.raw_text === 'string' && hotel.raw_text.trim())
        ? field(`${prefix}.lodging`, 'confirmed', 'critical', '숙박 근거가 일정에 연결되었습니다.')
        : field(`${prefix}.lodging`, sourcePending ? 'pending_supplier' : 'unavailable', 'critical', '숙박명 또는 숙박 정책 근거가 없습니다.'),
    );

    const inclusions = asArray(variant.inclusions);
    const exclusions = asArray(variant.exclusions);
    fields.push(
      inclusions.length > 0
        ? field(`${prefix}.inclusions`, 'confirmed', 'high', '포함사항 근거가 있습니다.')
        : field(`${prefix}.inclusions`, 'pending_supplier', 'high', '포함사항 확인이 필요합니다.'),
    );
    fields.push(
      exclusions.length > 0
        ? field(`${prefix}.exclusions`, 'confirmed', 'high', '불포함사항 근거가 있습니다.')
        : field(`${prefix}.exclusions`, 'pending_supplier', 'high', '불포함사항 확인이 필요합니다.'),
    );
  });

  const confirmedCount = fields.filter(item => item.state === 'confirmed' || item.state === 'not_applicable').length;
  const pendingSupplierCount = fields.filter(item => item.state === 'pending_supplier').length;
  const conflictingCount = fields.filter(item => item.state === 'conflicting').length;
  const unavailableCount = fields.filter(item => item.state === 'unavailable').length;
  const publicReady = fields.every(item => item.state === 'confirmed' || item.state === 'not_applicable');
  return {
    fields,
    confirmedCount,
    pendingSupplierCount,
    conflictingCount,
    unavailableCount,
    publicReady,
  };
}
