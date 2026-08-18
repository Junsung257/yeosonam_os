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

function hasProvenOvernightTimeline(rawText: string): boolean {
  return /(?:기내\s*박|선내\s*박|야간\s*출발|심야\s*출발|밤\s*출발|익일\s*(?:도착|귀국|입항)|다음\s*날\s*(?:도착|귀국|입항)|새벽\s*(?:도착|귀국|입항))/u.test(rawText);
}

function timeMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : null;
}

function hasProvenOvernightTransport(variant: JsonObject): boolean {
  return asArray(variant.flight_segments).some(raw => {
    const segment = asObject(raw);
    if (!segment) return false;
    const dayOffset = Number(segment.arr_day_offset ?? segment.arrival_day_offset);
    if (Number.isInteger(dayOffset) && dayOffset >= 1) return true;
    const departure = timeMinutes(segment.dep_time ?? segment.departure_time);
    const arrival = timeMinutes(segment.arr_time ?? segment.arrival_time);
    return departure != null && arrival != null && departure > arrival;
  });
}

function itineraryDayCountMatchesDuration(input: {
  rawText: string;
  durationDays: number;
  days: unknown[];
  variant: JsonObject;
}): boolean {
  if (input.days.length === input.durationDays) return true;
  // Some suppliers omit a separate DAY row for the arrival-only calendar day
  // of an overnight flight or ferry. Accept exactly one missing row only when
  // the original source proves the overnight transition.
  return input.days.length === input.durationDays - 1
    && (hasProvenOvernightTimeline(input.rawText) || hasProvenOvernightTransport(input.variant));
}

function hasSubstantiveCommercialTerm(values: unknown[]): boolean {
  return values.some(raw => {
    const item = asObject(raw);
    const value = item?.value ?? raw;
    const normalized = (typeof value === 'string' ? value.trim() : '').replace(/\s+/g, '').replace(/[:\uff1a]$/, '');
    return normalized.length >= 2
      && !/^(?:include|included|exclude|excluded|\ud3ec\ud568(?:\ub0b4\uc5ed|\uc0ac\ud56d|\uc870\uac74)?|\ubd88\ud3ec\ud568(?:\ub0b4\uc5ed|\uc0ac\ud56d)?|\uc81c\uc678\uc0ac\ud56d)$/i.test(normalized);
  });
}

function hasScopedSellingPrice(values: unknown[]): boolean {
  return values.some(raw => {
    const price = asObject(raw);
    if (!price) return false;
    const amount = Number(price.amount);
    const currency = typeof price.currency === 'string' ? price.currency.trim() : '';
    const range = asObject(price.date_range);
    const date = typeof price.date === 'string' ? price.date.trim() : '';
    const label = typeof price.label === 'string' ? price.label.trim() : '';
    const weekday = Number(price.weekday);
    const hasScope = /^\d{4}-\d{2}-\d{2}$/u.test(date)
      || Boolean(range && /^\d{4}-\d{2}-\d{2}$/u.test(String(range.start ?? ''))
        && /^\d{4}-\d{2}-\d{2}$/u.test(String(range.end ?? '')))
      || (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
      || /\d{1,2}[./-]\d{1,2}/u.test(label);
    return Number.isFinite(amount) && amount > 0 && /^[A-Z]{3}$/u.test(currency) && hasScope;
  });
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
 * Price, departure applicability, itinerary structure, and commercial
 * conflicts remain fail-closed. A genuinely absent inclusion/exclusion list
 * is different from a contradictory list: it can be published in degraded
 * mode with an explicit customer-facing consultation notice. We never
 * manufacture a term or copy one from another product. Missing flight times
 * and explicitly unconfirmed/equivalent lodging follow the same
 * evidence-bound disclosure rule.
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
  const sourceExplicitlyHasNoHotelNight = hasText(
    rawText,
    /(?:무박\s*\d{1,2}\s*일|당일\s*(?:여행|관광|투어|상품))/u,
  );
  const multiItineraryResolution = asObject(input.canonicalSection.multiItineraryResolution);

  if (multiItineraryResolution?.state === 'ambiguous') {
    fields.push(field(
      `sections[${input.sectionIndex}].itinerary_variants`,
      'conflicting',
      'critical',
      '여러 일정표의 기간별 가격·약관 적용 범위를 일의적으로 연결할 수 없습니다.',
    ));
  }

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
      hasScopedSellingPrice(prices)
        ? field(`${prefix}.price`, 'confirmed', 'critical', '원문 근거 가격이 연결되었습니다.')
        : field(`${prefix}.price`, 'unavailable', 'critical', prices.length > 0
            ? '판매가와 출발일 또는 적용 범위의 관계를 확인할 수 없습니다.'
            : '출발일에 적용되는 성인 기준 판매가가 없습니다.'),
    );

    const days = asArray(variant.days);
    const durationDays = Number(variant.duration_days);
    const hasDurationContract = Number.isInteger(durationDays) && durationDays > 0;
    fields.push(days.length === 0
      ? field(`${prefix}.itinerary`, 'unavailable', 'high', '고객에게 보여줄 DAY 일정 구조가 없습니다.')
      : hasDurationContract && !itineraryDayCountMatchesDuration({ rawText, durationDays, days, variant })
        ? field(
            `${prefix}.itinerary`,
            'conflicting',
            'critical',
            `상품 기간은 ${durationDays}일인데 원문 DAY 일정은 ${days.length}일로 재생되었습니다.`,
          )
        : field(`${prefix}.itinerary`, 'confirmed', 'high', 'DAY 일정 구조가 생성되었습니다.'));

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
        : sourceExplicitlyHasNoHotelNight
          ? field(`${prefix}.lodging`, 'not_applicable', 'critical', '원문상 지상 호텔 숙박이 없는 무박 또는 당일 상품입니다.')
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
      hasSubstantiveCommercialTerm(inclusions)
        ? field(`${prefix}.inclusions`, 'confirmed', 'high', '포함사항 근거가 있습니다.')
        : field(
            `${prefix}.inclusions`,
            'unavailable',
            'high',
            '원문에 포함사항이 별도로 기재되지 않아 상담 시 최종 확인이 필요합니다.',
            true,
          ),
    );
    fields.push(
      hasSubstantiveCommercialTerm(exclusions)
        ? field(`${prefix}.exclusions`, 'confirmed', 'high', '불포함사항 근거가 있습니다.')
        : field(
            `${prefix}.exclusions`,
            'unavailable',
            'high',
            '원문에 불포함사항이 별도로 기재되지 않아 상담 시 최종 확인이 필요합니다.',
            true,
          ),
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
