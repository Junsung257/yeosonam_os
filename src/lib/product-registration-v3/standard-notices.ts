import type { V3Evidence } from './types';

export type StandardNoticeCategory =
  | 'single_room_surcharge'
  | 'passport_validity'
  | 'local_law_restriction'
  | 'room_assignment'
  | 'itinerary_change'
  | 'tip_guideline'
  | 'group_schedule_penalty'
  | 'restaurant_access'
  | 'local_guide_operation'
  | 'unknown_notice';

export type StandardNoticeReviewStatus = 'auto_clean' | 'review_needed' | 'manual_approved' | 'rejected';

export interface StandardNoticeDraft {
  source_text: string;
  category: StandardNoticeCategory;
  template_key: string;
  values: Record<string, string | number | boolean | null>;
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
  render: (values: Record<string, string | number | boolean | null>) => string;
};

export const STANDARD_NOTICE_TEMPLATES: Record<string, TemplateDef> = {
  'single_room_surcharge.full_trip': {
    category: 'single_room_surcharge',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['amount', 'currency'],
    render: ({ amount, currency }) => `1인실 사용 시 전 일정 기준 1인 ${amount}${currency}의 추가 요금이 발생합니다.`,
  },
  'passport.validity_months': {
    category: 'passport_validity',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['months'],
    render: ({ months }) => `여권 만료일은 입국일 기준 ${months}개월 이상 남아 있어야 합니다.`,
  },
  'local_law.prohibited_item': {
    category: 'local_law_restriction',
    risk: 'high',
    visibility: 'customer_visible',
    required: ['country', 'item'],
    render: ({ country, item }) => `${country}은(는) ${item} 반입이 금지되어 있습니다.`,
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
    render: () => '항공 및 현지 사정에 따라 일정과 식사 순서는 변경될 수 있습니다.',
  },
  'guide.operation_limited_area': {
    category: 'local_guide_operation',
    risk: 'medium',
    visibility: 'customer_visible',
    required: [],
    render: () => '현지 규정상 일부 장소에서는 안내 방식이 제한될 수 있으며, 필요한 설명은 차량 이동 중 진행될 수 있습니다.',
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
    required: ['amount', 'currency', 'unit'],
    render: ({ amount, currency, unit }) => `단체 일정에 참여하지 않고 개별 일정을 진행하는 경우 현지 규정에 따라 ${unit} ${amount}${currency}의 추가 비용이 발생할 수 있습니다.`,
  },
  'restaurant.short_walk_possible': {
    category: 'restaurant_access',
    risk: 'low',
    visibility: 'customer_visible',
    required: [],
    render: () => '일부 식당은 차량 진입이 어려워 가까운 지점에서 도보 이동이 있을 수 있습니다.',
  },
};

export const STANDARD_NOTICE_CATEGORY_TEMPLATE: Partial<Record<StandardNoticeCategory, string>> = Object.fromEntries(
  Object.entries(STANDARD_NOTICE_TEMPLATES).map(([key, template]) => [template.category, key]),
) as Partial<Record<StandardNoticeCategory, string>>;

function reviewStatusFor(
  category: StandardNoticeCategory,
  risk: StandardNoticeDraft['risk_level'],
  missingRequired: boolean,
): StandardNoticeReviewStatus {
  return missingRequired || (risk === 'high' && (
    category === 'single_room_surcharge' ||
    category === 'tip_guideline' ||
    category === 'group_schedule_penalty' ||
    category === 'local_guide_operation'
  ))
    ? 'review_needed'
    : 'auto_clean';
}

export function buildStandardNoticeDraft(input: {
  source_text: string;
  category: StandardNoticeCategory;
  values: Record<string, string | number | boolean | null>;
  evidence: V3Evidence[];
  visibility?: StandardNoticeDraft['visibility'];
  review_status?: StandardNoticeReviewStatus;
}): StandardNoticeDraft | null {
  const template_key = STANDARD_NOTICE_CATEGORY_TEMPLATE[input.category];
  if (!template_key) return null;
  const template = STANDARD_NOTICE_TEMPLATES[template_key];
  if (!template) return null;
  const missingRequired = template.required.some(key => input.values[key] == null || input.values[key] === '');
  return {
    source_text: input.source_text,
    category: input.category,
    template_key,
    values: input.values,
    evidence: input.evidence,
    visibility: input.visibility ?? template.visibility,
    risk_level: template.risk,
    review_status: input.review_status ?? reviewStatusFor(input.category, template.risk, missingRequired),
    standard_text: template.render(input.values),
  };
}

function parseAmountKrw(text: string): { amount: number | null; currency: string | null } {
  const m = text.match(/(\d+)\s*만\s*원|(\d[\d,]*)\s*원/);
  if (!m) return { amount: null, currency: null };
  if (m[1]) return { amount: Number(m[1]) * 10000, currency: '원' };
  return { amount: Number(m[2].replace(/,/g, '')), currency: '원' };
}

function parseUsd(text: string): number | null {
  const m = text.match(/\$\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export function detectStandardNoticeFromLine(
  line: string,
  evidence: V3Evidence,
): StandardNoticeDraft | null {
  const source = line.trim();
  const lower = source.toLowerCase();
  let category: StandardNoticeCategory = 'unknown_notice';
  let template_key = '';
  const values: Record<string, string | number | boolean | null> = {};

  if (/싱글\s*차지|독실료|1인실/.test(source)) {
    category = 'single_room_surcharge';
    template_key = 'single_room_surcharge.full_trip';
    const { amount, currency } = parseAmountKrw(source);
    values.amount = amount;
    values.currency = currency;
  } else if (/여권/.test(source) && /6\s*개월|만료/.test(source)) {
    category = 'passport_validity';
    template_key = 'passport.validity_months';
    const m = source.match(/(\d+)\s*개월/);
    values.months = m ? Number(m[1]) : null;
  } else if (/공항미팅|관광지\s*방문\s*불가|차량에서\s*대체|현지\s*가이드/.test(source)) {
    category = 'local_guide_operation';
    template_key = 'guide.operation_limited_area';
  } else if (/전자담배|반입\s*불가|금지/.test(source) && /(베트남|태국|일본|국가|현지)/.test(source)) {
    category = 'local_law_restriction';
    template_key = 'local_law.prohibited_item';
    values.country = source.match(/(베트남|태국|일본|중국|필리핀)/)?.[1] ?? '현지 국가';
    values.item = /전자담배/.test(source) ? '전자담배' : '해당 품목';
  } else if (/룸배정|개런티\s*불가|베드\s*타입|옆방|같은\s*층/.test(source)) {
    category = 'room_assignment';
    template_key = 'room.assignment_not_guaranteed';
  } else if (/일정|식사\s*순서/.test(source) && /변경/.test(source)) {
    category = 'itinerary_change';
    template_key = 'itinerary.order_may_change';
  } else if (/마사지/.test(source) && /팁/.test(source)) {
    category = 'tip_guideline';
    template_key = 'tip.massage_by_region_duration';
    values.tipTable = source;
  } else if (/미참여|불참|패널티/.test(source) && /\$/.test(source)) {
    category = 'group_schedule_penalty';
    template_key = 'group.penalty_absence';
    const usd = parseUsd(source);
    values.amount = usd;
    values.currency = 'USD';
    values.unit = /1인\s*\/?\s*1박|1인.*1박/.test(source) ? '1인 1박당' : '1인당';
  } else if (/주차장|도보\s*이동|차량\s*진입/.test(source)) {
    category = 'restaurant_access';
    template_key = 'restaurant.short_walk_possible';
  } else if ((/공항미팅|관광지\s*방문\s*불가|차량에서\s*대체/.test(source) || /현지\s*가이드/.test(source)) && /베트남|현지/.test(source)) {
    category = 'local_guide_operation';
    template_key = 'guide.operation_limited_area';
  } else if (/remark|비고|주의사항/.test(lower)) {
    category = 'unknown_notice';
  } else {
    return null;
  }

  return buildStandardNoticeDraft({
    source_text: source,
    category,
    values,
    evidence: [evidence],
  });
}

export function extractStandardNoticesFromRemarkLines(lines: Array<{ text: string; evidence: V3Evidence }>): StandardNoticeDraft[] {
  const out: StandardNoticeDraft[] = [];
  for (const item of lines) {
    const parsed = detectStandardNoticeFromLine(item.text, item.evidence);
    if (parsed) out.push(parsed);
  }
  return out;
}
