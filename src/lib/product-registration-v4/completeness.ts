export type RegistrationFieldState =
  | 'confirmed'
  | 'pending_supplier'
  | 'not_applicable'
  | 'conflicting'
  | 'unavailable';

export type ProductRegistrationPublicationOutcome = 'verified' | 'degraded' | 'blocked';

export type RegistrationFieldCompletion = {
  fieldPath: string;
  state: RegistrationFieldState;
  criticality: 'critical' | 'high' | 'normal';
  reason: string;
  safeToDegrade: boolean;
};

export type CanonicalCompleteness = {
  fields: RegistrationFieldCompletion[];
  confirmedCount: number;
  pendingSupplierCount: number;
  conflictingCount: number;
  unavailableCount: number;
  publicationOutcome: ProductRegistrationPublicationOutcome;
  degradedReasons: string[];
  blockers: string[];
  /** Compatibility alias. In V6 a safely degraded section is publishable. */
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
  safeToDegrade = false,
): RegistrationFieldCompletion {
  return { fieldPath, state, criticality, reason, safeToDegrade };
}

function outcomeFor(fields: RegistrationFieldCompletion[]): Pick<
  CanonicalCompleteness,
  'publicationOutcome' | 'degradedReasons' | 'blockers' | 'publicReady'
> {
  const unresolved = fields.filter(item => item.state !== 'confirmed' && item.state !== 'not_applicable');
  const blockers = unresolved.filter(item => !item.safeToDegrade).map(item => `${item.fieldPath}: ${item.reason}`);
  const degradedReasons = unresolved.filter(item => item.safeToDegrade).map(item => `${item.fieldPath}: ${item.reason}`);
  const publicationOutcome: ProductRegistrationPublicationOutcome = blockers.length > 0
    ? 'blocked'
    : degradedReasons.length > 0
      ? 'degraded'
      : 'verified';
  return {
    publicationOutcome,
    degradedReasons,
    blockers,
    publicReady: publicationOutcome !== 'blocked',
  };
}

/**
 * Converts parser gaps into one of the V6 terminal policy classes.
 *
 * Only facts that do not change the purchase decision may degrade. Price,
 * departure applicability, itinerary structure, inclusions/exclusions, and a
 * source-backed cancellation policy remain fail-closed in later validation.
 * Missing flight times and explicitly unconfirmed/equivalent lodging are
 * rendered with a customer-facing final-confirmation notice instead of being
 * guessed or copied from another product.
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
  const sourceExplicitlyPending = hasText(
    rawText,
    /(?:추후\s*확정|미정|동급|예정|별도\s*안내|별도\s*문의|상담\s*시\s*확인|출시\s*예정)/u,
  );
  const sourceIsNonAir = hasText(rawText, /(?:훼리|페리|선박|배편|카멜리아|부산항|크루즈)/u);

  if (variants.length === 0) {
    fields.push(field(
      `sections[${input.sectionIndex}].variants`,
      'unavailable',
      'critical',
      '상품 구간에서 판매 가능한 상품 변형을 확인하지 못했습니다.',
    ));
  }

  variants.forEach((variant, variantIndex) => {
    const prefix = `sections[${input.sectionIndex}].variants[${variantIndex}]`;
    const prices = asArray(variant.price_calendar);
    fields.push(
      prices.length > 0
        ? field(`${prefix}.price`, 'confirmed', 'critical', '원문 근거 가격이 연결되었습니다.')
        : field(`${prefix}.price`, 'unavailable', 'critical', '출발일에 적용되는 성인 기준 판매가가 없습니다.'),
    );

    const days = asArray(variant.days);
    fields.push(
      days.length > 0
        ? field(`${prefix}.itinerary`, 'confirmed', 'high', 'DAY 일정 구조가 생성되었습니다.')
        : field(`${prefix}.itinerary`, 'unavailable', 'high', '고객에게 보여줄 DAY 일정 구조가 없습니다.'),
    );

    const flights = asArray(variant.flight_segments).map(asObject).filter((value): value is JsonObject => Boolean(value));
    if (flights.length === 0) {
      fields.push(
        sourceIsNonAir
          ? field(`${prefix}.flight`, 'not_applicable', 'critical', '원문상 항공편이 아닌 선박 상품입니다.')
          : sourceExplicitlyPending
            ? field(
                `${prefix}.flight`,
                'pending_supplier',
                'critical',
                '원문에서 항공편이 미정 또는 추후 확정으로 표시되었습니다.',
                true,
              )
            : field(`${prefix}.flight`, 'unavailable', 'critical', '항공 또는 대체 이동수단 근거가 없습니다.'),
      );
    } else {
      const incomplete = flights.some(flight => {
        const leg = String(flight.leg ?? '');
        return (leg === 'outbound' || leg === 'inbound') && (!flight.dep_time || !flight.arr_time);
      });
      fields.push(
        incomplete
          ? field(
              `${prefix}.flight_times`,
              'pending_supplier',
              'critical',
              '항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다.',
              true,
            )
          : field(`${prefix}.flight_times`, 'confirmed', 'critical', '항공편과 출도착 시각이 연결되었습니다.'),
      );
    }

    const hotels = days
      .map(day => asObject(day)?.hotel)
      .map(asObject)
      .filter((value): value is JsonObject => Boolean(value));
    fields.push(
      hotels.some(hotel => typeof hotel.raw_text === 'string' && hotel.raw_text.trim())
        ? field(`${prefix}.lodging`, 'confirmed', 'critical', '숙박 근거가 일정에 연결되었습니다.')
        : sourceExplicitlyPending
          ? field(
              `${prefix}.lodging`,
              'pending_supplier',
              'critical',
              '원문에서 호텔이 미정 또는 동급으로 표시되었습니다.',
              true,
            )
          : field(`${prefix}.lodging`, 'unavailable', 'critical', '숙박명 또는 숙박 확정 상태의 근거가 없습니다.'),
    );

    const inclusions = asArray(variant.inclusions);
    const exclusions = asArray(variant.exclusions);
    fields.push(
      inclusions.length > 0
        ? field(`${prefix}.inclusions`, 'confirmed', 'high', '포함사항 근거가 있습니다.')
        : field(`${prefix}.inclusions`, 'unavailable', 'high', '포함사항을 확인할 수 없습니다.'),
    );
    fields.push(
      exclusions.length > 0
        ? field(`${prefix}.exclusions`, 'confirmed', 'high', '불포함사항 근거가 있습니다.')
        : field(`${prefix}.exclusions`, 'unavailable', 'high', '불포함사항을 확인할 수 없습니다.'),
    );
  });

  const confirmedCount = fields.filter(item => item.state === 'confirmed' || item.state === 'not_applicable').length;
  const pendingSupplierCount = fields.filter(item => item.state === 'pending_supplier').length;
  const conflictingCount = fields.filter(item => item.state === 'conflicting').length;
  const unavailableCount = fields.filter(item => item.state === 'unavailable').length;
  return {
    fields,
    confirmedCount,
    pendingSupplierCount,
    conflictingCount,
    unavailableCount,
    ...outcomeFor(fields),
  };
}
