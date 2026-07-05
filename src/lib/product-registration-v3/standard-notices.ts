import type { V3Evidence } from './types';

export type StandardNoticeCategory =
  | 'single_room_surcharge'
  | 'passport_validity'
  | 'visa_entry_rule'
  | 'local_law_restriction'
  | 'room_assignment'
  | 'itinerary_change'
  | 'tip_guideline'
  | 'group_schedule_penalty'
  | 'restaurant_access'
  | 'local_guide_operation'
  | 'optional_tour'
  | 'shopping_visit'
  | 'hotel_notice'
  | 'meal_plan'
  | 'transport_notice'
  | 'surcharge_notice'
  | 'prep_items'
  | 'minimum_departure'
  | 'unknown_notice';

export type StandardNoticeReviewStatus = 'auto_clean' | 'review_needed' | 'manual_approved' | 'rejected';

export interface StandardNoticeDraft {
  source_text: string;
  category: StandardNoticeCategory;
  template_key: string;
  values: Record<string, string | number | boolean | null | string[]>;
  evidence: V3Evidence[];
  visibility: 'customer_visible' | 'internal_only' | 'hidden_by_default';
  risk_level: 'low' | 'medium' | 'high';
  review_status: StandardNoticeReviewStatus;
  standard_text: string;
}

type TemplateDef = {
  category: StandardNoticeCategory;
  risk: StandardNoticeDraft['risk_level'];
  visibility: StandardNoticeDraft['visibility'];
  required: string[];
  render: (values: Record<string, string | number | boolean | null | string[]>) => string;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatMoney(amount: unknown, currency: unknown): string {
  const currencyText = asText(currency) || '원';
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return `${amount ?? ''}${currencyText}`.trim();
  if (currencyText === '원' && amount >= 10000 && amount % 10000 === 0) return `${amount / 10000}만 원`;
  if (currencyText === 'USD' || currencyText === '$') return `$${amount.toLocaleString('en-US')}`;
  return `${amount.toLocaleString('ko-KR')}${currencyText}`;
}

function formatList(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean).join(', ');
  return asText(value);
}

export const STANDARD_NOTICE_TEMPLATES: Record<string, TemplateDef> = {
  'single_room_surcharge.full_trip': {
    category: 'single_room_surcharge',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['amount', 'currency'],
    render: ({ amount, currency }) => `1인실 사용 시 일정 기준 1인 ${formatMoney(amount, currency)}의 추가요금이 발생합니다.`,
  },
  'single_room_surcharge.inquiry_required': {
    category: 'single_room_surcharge',
    risk: 'medium',
    visibility: 'customer_visible',
    required: [],
    render: () => '1인실 사용 시 추가 요금은 예약 시 확인이 필요합니다.',
  },
  'passport.validity_months': {
    category: 'passport_validity',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['months'],
    render: ({ months }) => `여권 만료일은 입국일 기준 ${months}개월 이상 남아 있어야 합니다.`,
  },
  'visa.entry_rule': {
    category: 'visa_entry_rule',
    risk: 'high',
    visibility: 'customer_visible',
    required: [],
    render: () => '비자 및 입국 조건은 국적과 여권 상태에 따라 달라질 수 있어 예약 시 확인이 필요합니다.',
  },
  'local_law.prohibited_item': {
    category: 'local_law_restriction',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['item'],
    render: ({ country, item }) => {
      const prefix = asText(country) ? `${country}에서는` : '현지에서는';
      return `${prefix} ${item ?? '해당 물품'} 반입이 금지되어 있습니다.`;
    },
  },
  'room.assignment_not_guaranteed': {
    category: 'room_assignment',
    risk: 'medium',
    visibility: 'customer_visible',
    required: [],
    render: () => '호텔 객실의 층수, 인접 객실, 침대 타입은 사전 확정이 어렵습니다.',
  },
  'itinerary.order_may_change': {
    category: 'itinerary_change',
    risk: 'medium',
    visibility: 'customer_visible',
    required: [],
    render: () => '항공 및 현지 사정에 따라 일정과 행사 순서가 변경될 수 있습니다.',
  },
  'guide.operation_limited_area': {
    category: 'local_guide_operation',
    risk: 'medium',
    visibility: 'customer_visible',
    required: [],
    render: () => '현지 규정에 따라 일부 장소에서는 가이드 안내 방식이 제한될 수 있으며, 필요한 설명은 차량 이동 중 진행될 수 있습니다.',
  },
  'guide.tip_amount_local_payment': {
    category: 'tip_guideline',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['amount', 'currency'],
    render: ({ amount, currency, per }) => `가이드/기사 팁은 ${per ?? '1인'} 기준 ${formatMoney(amount, currency)} 현지 지불입니다.`,
  },
  'guide.tip_included': {
    category: 'tip_guideline',
    risk: 'high',
    visibility: 'customer_visible',
    required: [],
    render: () => '가이드/기사 팁은 포함되어 있습니다.',
  },
  'tip.massage_by_region_duration': {
    category: 'tip_guideline',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['tipTable'],
    render: () => '마사지 이용 시 지역과 이용 시간에 따라 현지 매너팁이 별도로 발생할 수 있습니다.',
  },
  'group.penalty_absence': {
    category: 'group_schedule_penalty',
    risk: 'high',
    visibility: 'customer_visible',
    required: [],
    render: ({ amount, currency, unit }) => {
      if (typeof amount === 'number' && Number.isFinite(amount)) {
        return `단체 일정에 참여하지 않고 개별 일정을 진행하는 경우 현지 규정에 따라 ${unit ? `${unit} ` : ''}${formatMoney(amount, currency)}의 추가 비용이 발생할 수 있습니다.`;
      }
      return '단체 일정에 참여하지 않고 개별 일정을 진행하는 경우 포함 서비스 제공이 어려울 수 있으며, 현지 규정은 예약 시 확인이 필요합니다.';
    },
  },
  'restaurant.short_walk_possible': {
    category: 'restaurant_access',
    risk: 'low',
    visibility: 'customer_visible',
    required: [],
    render: () => '일부 식당은 차량 진입이 어려워 가까운 지점에서 도보 이동이 있을 수 있습니다.',
  },
  'optional.none': {
    category: 'optional_tour',
    risk: 'medium',
    visibility: 'customer_visible',
    required: [],
    render: () => '선택관광이 없는 상품입니다.',
  },
  'optional.available_on_request': {
    category: 'optional_tour',
    risk: 'medium',
    visibility: 'customer_visible',
    required: [],
    render: () => '선택관광을 원할 경우 현지에서 별도 비용으로 진행될 수 있습니다.',
  },
  'shopping.none': {
    category: 'shopping_visit',
    risk: 'medium',
    visibility: 'customer_visible',
    required: [],
    render: () => '쇼핑 방문이 없는 상품입니다.',
  },
  'shopping.visits_count': {
    category: 'shopping_visit',
    risk: 'medium',
    visibility: 'customer_visible',
    required: ['count'],
    render: ({ count, items }) => {
      const itemText = formatList(items);
      return `일정 중 쇼핑센터 ${count}회 방문이 포함되어 있습니다${itemText ? `: ${itemText}` : ''}.`;
    },
  },
  'hotel.grade': {
    category: 'hotel_notice',
    risk: 'medium',
    visibility: 'customer_visible',
    required: ['grade'],
    render: ({ name, grade, equivalent }) => `${name ? `${name} ` : ''}${grade} 호텔${equivalent ? ' 또는 동급' : ''} 이용 예정입니다.`,
  },
  'meal.summary': {
    category: 'meal_plan',
    risk: 'low',
    visibility: 'customer_visible',
    required: ['summary'],
    render: ({ summary }) => `일정표 기준 식사는 ${summary}로 제공됩니다.`,
  },
  'transport.included': {
    category: 'transport_notice',
    risk: 'low',
    visibility: 'customer_visible',
    required: ['items'],
    render: ({ items }) => `${formatList(items)} 이동이 포함되어 있습니다.`,
  },
  'surcharge.generic': {
    category: 'surcharge_notice',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['label'],
    render: ({ label }) => `${label}은 별도 비용으로 발생할 수 있습니다.`,
  },
  'prep.items': {
    category: 'prep_items',
    risk: 'low',
    visibility: 'customer_visible',
    required: ['items'],
    render: ({ items }) => `여행 준비물: ${formatList(items)}.`,
  },
  'minimum_departure.count': {
    category: 'minimum_departure',
    risk: 'medium',
    visibility: 'customer_visible',
    required: ['count'],
    render: ({ count }) => `최소 출발 인원은 ${count}명입니다.`,
  },
};

const DEFAULT_TEMPLATE_BY_CATEGORY: Partial<Record<StandardNoticeCategory, string>> = {};
for (const [key, template] of Object.entries(STANDARD_NOTICE_TEMPLATES)) {
  DEFAULT_TEMPLATE_BY_CATEGORY[template.category] ??= key;
}

export const STANDARD_NOTICE_CATEGORY_TEMPLATE = DEFAULT_TEMPLATE_BY_CATEGORY;

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function reviewStatusFor(
  template: TemplateDef,
  missingRequired: boolean,
  missingEvidence: boolean,
): StandardNoticeReviewStatus {
  if (missingRequired || missingEvidence) return 'review_needed';
  return 'auto_clean';
}

export function buildStandardNoticeDraft(input: {
  source_text: string;
  category: StandardNoticeCategory;
  values: Record<string, string | number | boolean | null | string[]>;
  evidence: V3Evidence[];
  visibility?: StandardNoticeDraft['visibility'];
  review_status?: StandardNoticeReviewStatus;
  template_key?: string;
}): StandardNoticeDraft | null {
  const template_key = input.template_key ?? STANDARD_NOTICE_CATEGORY_TEMPLATE[input.category];
  if (!template_key) return null;
  const template = STANDARD_NOTICE_TEMPLATES[template_key];
  if (!template || template.category !== input.category) return null;
  const missingRequired = template.required.some(key => !hasValue(input.values[key]));
  const visibility = input.visibility ?? template.visibility;
  const missingEvidence = visibility === 'customer_visible' && input.evidence.length === 0;

  return {
    source_text: input.source_text,
    category: input.category,
    template_key,
    values: input.values,
    evidence: input.evidence,
    visibility,
    risk_level: template.risk,
    review_status: input.review_status ?? reviewStatusFor(template, missingRequired, missingEvidence),
    standard_text: template.render(input.values),
  };
}

function parseKrw(textValue: string): { amount: number | null; currency: string | null } {
  const koreanMan = textValue.match(/(\d+(?:\.\d+)?)\s*만\s*원/);
  if (koreanMan) return { amount: Math.round(Number(koreanMan[1]) * 10000), currency: '원' };
  const koreanWon = textValue.match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/);
  if (koreanWon) return { amount: Number(koreanWon[1].replace(/,/g, '')), currency: '원' };
  const man = textValue.match(/(\d+(?:\.\d+)?)\s*만\s*원?/);
  if (man) return { amount: Math.round(Number(man[1]) * 10000), currency: '원' };
  const won = textValue.match(/(\d{2,3}(?:,\d{3})+|\d{5,})\s*원/);
  if (won) return { amount: Number(won[1].replace(/,/g, '')), currency: '원' };
  return { amount: null, currency: null };
}

function parseUsd(textValue: string): number | null {
  const m = textValue.match(/(?:USD|US\$|\$)\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : null;
}

function detectCountry(source: string): string | null {
  if (/방콕|파타야|푸켓|치앙마이|치앙라이|코사무이/i.test(source)) return '태국';
  if (/다낭|나트랑|냐짱|달랏|하노이|호치민|푸꾸옥/i.test(source)) return '베트남';
  if (/장가계|상하이|북경|베이징|서안|시안|연길/i.test(source)) return '중국';
  if (/오사카|도쿄|후쿠오카|삿포로|홋카이도|오키나와/i.test(source)) return '일본';
  return source.match(/베트남|중국|일본|대만|태국|라오스|캄보디아|싱가포르|필리핀|말레이시아/)?.[0] ?? null;
}

export function detectStandardNoticeFromLine(
  line: string,
  evidence: V3Evidence,
): StandardNoticeDraft | null {
  const source = line.trim();
  if (!source) return null;

  if (/싱글\s*(차지|룸|사용)|1\s*인실|독실|single\s*(charge|room)/i.test(source)) {
    const { amount, currency } = parseKrw(source);
    const inquiryOnly = amount == null;
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'single_room_surcharge',
      template_key: amount || !inquiryOnly ? 'single_room_surcharge.full_trip' : 'single_room_surcharge.inquiry_required',
      values: { amount, currency },
      evidence: [evidence],
      review_status: amount ? undefined : 'review_needed',
    });
  }

  if (/여권/.test(source) && /(6\s*개월|만료|유효)/.test(source)) {
    const months = Number(source.match(/(\d+)\s*개월/)?.[1] ?? 6);
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'passport_validity',
      template_key: 'passport.validity_months',
      values: { months },
      evidence: [evidence],
    });
  }

  if (/전자\s*담배|아이코스|담배/i.test(source) && /반입|금지|불가/.test(source)) {
    const country = detectCountry(source);
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'local_law_restriction',
      template_key: 'local_law.prohibited_item',
      values: { country, item: /전자\s*담배|아이코스/i.test(source) ? '전자담배' : '담배' },
      evidence: [evidence],
      review_status: country ? undefined : 'review_needed',
    });
  }

  if (/룸\s*배정|객실\s*배정|층수|인접\s*객실|커넥팅룸|트윈|더블|침대/.test(source) && /불가|어렵|미정|확정|개런티/.test(source)) {
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'room_assignment',
      template_key: 'room.assignment_not_guaranteed',
      values: {},
      evidence: [evidence],
    });
  }

  if (/일정|행사\s*순서|현지\s*사정|항공\s*사정/.test(source) && /변경|조정|달라|변동/.test(source)) {
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'itinerary_change',
      template_key: 'itinerary.order_may_change',
      values: {},
      evidence: [evidence],
    });
  }

  if (/가이드/.test(source) && /(공항\s*미팅|관광지\s*방문\s*불가|차량.*설명|동행|안내\s*제한)/.test(source)) {
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'local_guide_operation',
      template_key: 'guide.operation_limited_area',
      values: {},
      evidence: [evidence],
    });
  }

  if (/가이드|기사/.test(source) && /(팁|경비|매너팁|TIP)/i.test(source)) {
    const included = /포함|노팁|NO\s*TIP/i.test(source);
    const usdAmount = parseUsd(source);
    const krwAmount = usdAmount == null ? parseKrw(source) : { amount: null, currency: null };
    const amount = usdAmount ?? krwAmount.amount;
    const currency = usdAmount ? 'USD' : krwAmount.currency;
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'tip_guideline',
      template_key: included ? 'guide.tip_included' : 'guide.tip_amount_local_payment',
      values: included
        ? { included: true }
        : { amount, currency, per: /\/P|person|1\s*인/i.test(source) ? '1인' : null },
      evidence: [evidence],
      review_status: included || amount ? undefined : 'review_needed',
    });
  }

  if (/마사지/.test(source) && /(팁|매너팁)/i.test(source)) {
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'tip_guideline',
      template_key: 'tip.massage_by_region_duration',
      values: { tipTable: source },
      evidence: [evidence],
    });
  }

  if (/미\s*참여|불참|패널티|노쇼|개별\s*일정/.test(source) && !/캔슬|취소|파이널|확정\s*후|노\s*쇼핑|NO\s*SHOPPING|노\s*옵션|NO\s*OPTION/i.test(source)) {
    const amount = parseUsd(source);
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'group_schedule_penalty',
      template_key: 'group.penalty_absence',
      values: { amount, currency: amount ? 'USD' : null, unit: /1\s*박/.test(source) ? '1인 1박당' : '1인당' },
      evidence: [evidence],
    });
  }

  if (/식당/.test(source) && /도보|차량\s*진입|주차/.test(source)) {
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'restaurant_access',
      template_key: 'restaurant.short_walk_possible',
      values: {},
      evidence: [evidence],
    });
  }

  if (/노\s*옵션|NO\s*OPTION|선택\s*관광\s*(없|무|0회)/i.test(source)) {
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'optional_tour',
      template_key: 'optional.none',
      values: { none: true },
      evidence: [evidence],
    });
  }

  if (/노\s*쇼핑|NO\s*SHOPPING|쇼핑\s*0\s*회/i.test(source)) {
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'shopping_visit',
      template_key: 'shopping.none',
      values: { none: true, count: 0 },
      evidence: [evidence],
    });
  }

  const shoppingCount = source.match(/쇼핑(?:센터)?\s*(\d+)\s*회|\[?쇼핑\s*(\d+)\s*회\]?/i);
  if (shoppingCount) {
    return buildStandardNoticeDraft({
      source_text: source,
      category: 'shopping_visit',
      template_key: 'shopping.visits_count',
      values: { count: Number(shoppingCount[1] ?? shoppingCount[2]), items: source.replace(shoppingCount[0], '').trim() || null },
      evidence: [evidence],
    });
  }

  return null;
}

export function extractStandardNoticesFromRemarkLines(lines: Array<{ text: string; evidence: V3Evidence }>): StandardNoticeDraft[] {
  const out: StandardNoticeDraft[] = [];
  const seen = new Set<string>();
  let currentCostSection: 'include' | 'exclude' | null = null;
  for (const item of lines) {
    const text = item.text.trim();
    if (/^(?:포\s*함\s*내\s*역|포함사항|포함\s*내역)$/i.test(text)) {
      currentCostSection = 'include';
      continue;
    }
    if (/^(?:불\s*포\s*함\s*내\s*역|불포함사항|불포함\s*내역)$/i.test(text)) {
      currentCostSection = 'exclude';
      continue;
    }
    if (/^(?:선택관광|쇼핑센터|비\s*고|일\s*자|REMARK)$/i.test(text)) {
      currentCostSection = null;
    }
    let parsed = detectStandardNoticeFromLine(item.text, item.evidence);
    if (
      parsed?.category === 'tip_guideline'
      && parsed.review_status === 'review_needed'
      && currentCostSection === 'include'
      && /가이드|기사/.test(text)
      && !/불포함|별도|현지\s*지불|현지지불|개인경비/i.test(text)
    ) {
      parsed = buildStandardNoticeDraft({
        source_text: text,
        category: 'tip_guideline',
        template_key: 'guide.tip_included',
        values: { included: true },
        evidence: [item.evidence],
      });
    }
    if (!parsed) continue;
    const key = `${parsed.category}:${parsed.template_key}:${parsed.standard_text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}
