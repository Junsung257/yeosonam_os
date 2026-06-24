import type { V3Evidence, V3SourceLine } from './types';
import { buildStandardNoticeDraft, type StandardNoticeDraft } from './standard-notices';

export type StructuredFactCategory =
  | 'guide_presence'
  | 'guide_tip'
  | 'shopping_policy'
  | 'hotel_grade'
  | 'room_policy'
  | 'meal_plan'
  | 'transport'
  | 'optional_tour'
  | 'surcharge'
  | 'passport_visa_law'
  | 'schedule_policy'
  | 'prep_items'
  | 'min_pax';

export interface StructuredFact {
  category: StructuredFactCategory;
  values: Record<string, string | number | boolean | string[] | null>;
  evidence: V3Evidence[];
  risk_level: 'low' | 'medium' | 'high';
  visibility: 'customer_visible' | 'internal_only' | 'hidden_by_default';
  review_status: 'auto_clean' | 'review_needed' | 'manual_approved' | 'rejected';
  standard_text: string;
}

export type StructuredFactCustomerFieldPatch = {
  guide_tip?: string | null;
  single_supplement?: string | null;
  optional_tours?: Array<Record<string, unknown>>;
  normalized_surcharges?: Array<Record<string, unknown>>;
  category_attrs?: Record<string, unknown>;
  itinerary_highlights?: {
    shopping?: string | null;
  };
};

export type StructuredFactsResult = {
  structuredFacts: StructuredFact[];
  standardNotices: StandardNoticeDraft[];
  customerFieldPatch: StructuredFactCustomerFieldPatch;
};

export type StructuredFactsInput = {
  rawText?: string | null;
  lines?: V3SourceLine[];
  itinerary_data?: unknown;
  inclusions?: unknown;
  excludes?: unknown;
  notices?: unknown;
  title?: string | null;
  destination?: string | null;
};

function flatten(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sourceLines(input: StructuredFactsInput): V3SourceLine[] {
  if (input.lines?.length) return input.lines;
  const raw = [
    input.title,
    input.inclusions,
    input.excludes,
    input.notices,
    input.itinerary_data,
    input.rawText,
  ].map(flatten).filter(Boolean).join('\n');
  let offset = 0;
  return raw.split(/\r?\n/).map((quote, index) => {
    const line: V3SourceLine = {
      lineNumber: index + 1,
      charStart: offset,
      charEnd: offset + quote.length,
      quote,
    };
    offset += quote.length + 1;
    return line;
  });
}

function evidenceFromLine(line: V3SourceLine): V3Evidence {
  return {
    line_start: line.lineNumber,
    line_end: line.lineNumber,
    char_start: line.charStart,
    char_end: line.charEnd,
    quote: line.quote.trim(),
  };
}

function makeFact(input: {
  category: StructuredFactCategory;
  values: StructuredFact['values'];
  evidence: V3Evidence;
  risk_level: StructuredFact['risk_level'];
  review_status?: StructuredFact['review_status'];
  standard_text: string;
  visibility?: StructuredFact['visibility'];
}): StructuredFact {
  return {
    category: input.category,
    values: input.values,
    evidence: [input.evidence],
    risk_level: input.risk_level,
    visibility: input.visibility ?? 'customer_visible',
    review_status: input.review_status ?? 'auto_clean',
    standard_text: input.standard_text,
  };
}

function addFact(facts: StructuredFact[], fact: StructuredFact): void {
  const key = `${fact.category}:${fact.standard_text}:${JSON.stringify(fact.values)}`;
  if (facts.some(row => `${row.category}:${row.standard_text}:${JSON.stringify(row.values)}` === key)) return;
  facts.push(fact);
}

function addNotice(out: StandardNoticeDraft[], notice: StandardNoticeDraft | null): void {
  if (!notice) return;
  const key = `${notice.category}:${notice.template_key}:${notice.standard_text}`;
  if (out.some(existing => `${existing.category}:${existing.template_key}:${existing.standard_text}` === key)) return;
  out.push(notice);
}

function parseUsd(text: string): number | null {
  const m = text.match(/(?:USD|US\$|\$)\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : null;
}

function parseKrw(text: string): number | null {
  const koreanMan = text.match(/(\d+(?:\.\d+)?)\s*만\s*원/);
  if (koreanMan) return Math.round(Number(koreanMan[1]) * 10000);
  const koreanWon = text.match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/);
  if (koreanWon) return Number(koreanWon[1].replace(/,/g, ''));
  const man = text.match(/(\d+(?:\.\d+)?)\s*만\s*원?/);
  if (man) return Math.round(Number(man[1]) * 10000);
  const won = text.match(/(\d{2,3}(?:,\d{3})+|\d{5,})\s*원/);
  return won ? Number(won[1].replace(/,/g, '')) : null;
}

function parsePercent(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

function isIncludedCostLine(source: string): boolean {
  return /포함사항|왕복항공료|유류할증료|숙박|식사|그린피|여행자보험|단독차량/.test(source)
    && !/불포함|별도|추가|현지\s*지불|고객이\s*직접\s*페이/.test(source);
}

function isCancellationOrPaymentPolicyLine(source: string): boolean {
  return /취소|캔슬|환불|수수료|예약금|파이널|확정\s*후|예약\s*인원|최종\s*출발\s*인원|현금영수증/.test(source);
}

function isConditionalMinPaxSurchargeLine(source: string): boolean {
  return /(?:최소\s*)?(?:성인\s*)?\d+\s*(?:명|인)\s*이상|인원\s*충족|인원충족|예약\s*조건/.test(source)
    && /추가\s*요금|추가요금|추가금/.test(source)
    && !/(?:\d{2,3}(?:,\d{3})+|\d+\s*만원|\$\s*\d+)/.test(source);
}

function formatGuideTip(values: Record<string, unknown>): string {
  if (values.included) return '가이드/기사 팁은 포함되어 있습니다.';
  if (typeof values.amount === 'number') return `가이드/기사 팁은 1인 기준 $${values.amount} 현지 지불입니다.`;
  return '가이드/기사 팁은 예약 시 확인이 필요합니다.';
}

function parseShoppingItems(text: string): string[] {
  const withoutCount = text
    .replace(/\[?쇼핑\s*\d+\s*회\]?/gi, '')
    .replace(/쇼핑\s*(센터|방문|횟수)?/gi, '')
    .replace(/노\s*쇼핑|NO\s*SHOPPING/gi, '');
  return withoutCount
    .split(/[,&/·ㆍ|]|또는|or/gi)
    .map(item => item.trim())
    .filter(item => item.length >= 2 && item.length <= 20)
    .slice(0, 8);
}

function parseMealSummary(text: string): string | null {
  const compact = text.replace(/\s+/g, ' ');
  if (/(?:\ud328\ud0a4\uc9c0\s*\uc0c1\ud488|\uc77c\uc815\s*\uc911|\uac1c\ubcc4\s*\ud65c\ub3d9|\uc790\uc720\s*\ud65c\ub3d9|\ubd88\uac00|\uc2e4\uc2dc\ubd88\uac00)/.test(compact)) return null;
  const explicitMealLine = compact.match(/(?:^|[\s,])([조중석])\s*[:：]\s*([^,|/]{1,18})/g);
  if (explicitMealLine?.length) {
    return explicitMealLine
      .map(part => {
        const match = part.match(/([조중석])\s*[:：]\s*([^,|/]{1,18})/);
        if (!match) return null;
        const label = match[1] === '조' ? '조식' : match[1] === '중' ? '중식' : '석식';
        return `${label} ${match[2].trim()}`;
      })
      .filter((part): part is string => Boolean(part))
      .join(', ');
  }
  if (/(조식|중식|석식)\s*후/.test(compact)) return null;
  if (!/(조식|중식|석식|식사|특식|호텔식|현지식|무제한)/.test(compact)) return null;
  const parts: string[] = [];
  const breakfast = compact.match(/(?:조|조식)\s*[:：\-/]?\s*([가-힣A-Za-z ]{2,12})/);
  const lunch = compact.match(/(?:중|중식)\s*[:：\-/]?\s*([가-힣A-Za-z ]{2,12})/);
  const dinner = compact.match(/(?:석|석식)\s*[:：\-/]?\s*([가-힣A-Za-z ]{2,12})/);
  if (breakfast) parts.push(`조식 ${breakfast[1].trim()}`);
  if (lunch) parts.push(`중식 ${lunch[1].trim()}`);
  if (dinner) parts.push(`석식 ${dinner[1].trim()}`);
  if (parts.length) return parts.join(', ');
  const generic = compact.match(/호텔식|현지식|한식|중식|일식|양식|특식|기내식|자유식|불포함|뷔페|반쎄오|쌀국수/);
  return generic?.[0] ?? null;
}

function summarizeCategoryAttrs(facts: StructuredFact[]): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const fact of facts) {
    attrs[fact.category] = fact.values;
  }
  return attrs;
}

function detectTransportItems(source: string): string[] {
  const items: string[] = [];
  if (/전용\s*차량|전용버스|리무진|버스/i.test(source)) items.push('전용차량');
  if (/페리|ferry/i.test(source)) items.push('페리');
  if (/케이블카/i.test(source)) items.push('케이블카');
  if (/도보/.test(source)) items.push('도보');
  if (/기차|열차|고속철|KTX/i.test(source)) items.push('열차');
  if (/보트|스피드보트|크루즈/i.test(source)) items.push('보트');
  return [...new Set(items)];
}

export function extractStructuredFactsFromSupplierText(input: StructuredFactsInput): StructuredFactsResult {
  const facts: StructuredFact[] = [];
  const notices: StandardNoticeDraft[] = [];
  const patch: StructuredFactCustomerFieldPatch = {};
  const lines = sourceLines(input);
  let currentCostSection: 'include' | 'exclude' | null = null;

  for (const line of lines) {
    const source = line.quote.trim();
    if (!source) continue;
    const evidence = evidenceFromLine(line);
    if (/^(?:포\s*함\s*내\s*역|포함사항|포함\s*내역)$/i.test(source)) {
      currentCostSection = 'include';
      continue;
    }
    if (/^(?:불\s*포\s*함\s*내\s*역|불포함사항|불포함\s*내역)$/i.test(source)) {
      currentCostSection = 'exclude';
      continue;
    }
    if (/^(?:선택관광|쇼핑센터|비\s*고|일\s*자|REMARK)$/i.test(source)) {
      currentCostSection = null;
    }

    if (/한국어\s*가이드|현지\s*가이드|가이드\s*(동행|미팅|안내|포함|없음|불포함|미포함|NO|전문)|인솔자\s*(동행|포함|없음|불포함|미동행)/i.test(source)) {
      const absent = /가이드\s*(없음|불포함|미포함|NO\s*가이드)|인솔자\s*(없음|불포함|미동행)/i.test(source);
      addFact(facts, makeFact({
        category: 'guide_presence',
        values: { present: !absent, mode: absent ? 'none' : 'guided' },
        evidence,
        risk_level: 'medium',
        standard_text: absent ? '가이드 동행이 없는 상품입니다.' : '현지 가이드 안내가 포함되어 있습니다.',
      }));
    }

    if ((/가이드|기사/.test(source) && /(팁|경비|매너팁|TIP)/i.test(source)) || /노\s*팁|NO\s*TIP/i.test(source)) {
      const included = /포함|노\s*팁|NO\s*TIP/i.test(source)
        || (currentCostSection === 'include' && !/불포함|별도|현지\s*지불|현지지불|개인경비/i.test(source));
      const usdAmount = parseUsd(source);
      const krwAmount = usdAmount == null ? parseKrw(source) : null;
      const amount = usdAmount ?? krwAmount;
      const currency = usdAmount ? 'USD' : krwAmount ? '원' : null;
      const values = included
        ? { included: true, amount: null, currency: null, payment: null }
        : { included: false, amount, currency, payment: 'local' };
      const reviewStatus = included || amount ? 'auto_clean' : 'review_needed';
      addFact(facts, makeFact({
        category: 'guide_tip',
        values,
        evidence,
        risk_level: 'high',
        review_status: reviewStatus,
        standard_text: formatGuideTip(values),
      }));
      patch.guide_tip = included ? '포함' : amount ? `$${amount}/인` : null;
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'tip_guideline',
        template_key: included ? 'guide.tip_included' : 'guide.tip_amount_local_payment',
        values: included ? { included: true } : { amount, currency: amount ? 'USD' : null, per: '1인' },
        evidence: [evidence],
        review_status: reviewStatus,
      }));
    }

    if (/노\s*옵션|NO\s*OPTION|선택\s*관광\s*(없|무|0회)/i.test(source)) {
      addFact(facts, makeFact({
        category: 'optional_tour',
        values: { none: true },
        evidence,
        risk_level: 'medium',
        standard_text: '선택관광이 없는 상품입니다.',
      }));
      patch.optional_tours = [];
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'optional_tour',
        template_key: 'optional.none',
        values: { none: true },
        evidence: [evidence],
      }));
    } else if (/선택\s*관광|옵션|optional/i.test(source) && /\$|USD|현지\s*지불|별도/i.test(source)) {
      const amount = parseUsd(source);
      addFact(facts, makeFact({
        category: 'optional_tour',
        values: { none: false, amount, currency: amount ? 'USD' : null },
        evidence,
        risk_level: 'medium',
        review_status: amount ? 'auto_clean' : 'review_needed',
        standard_text: '선택관광을 원할 경우 현지에서 별도 비용으로 진행될 수 있습니다.',
      }));
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'optional_tour',
        template_key: 'optional.available_on_request',
        values: { amount, currency: amount ? 'USD' : null },
        evidence: [evidence],
      }));
    }

    if (/노\s*쇼핑|NO\s*SHOPPING|쇼핑\s*0\s*회/i.test(source)) {
      addFact(facts, makeFact({
        category: 'shopping_policy',
        values: { none: true, count: 0, items: [] },
        evidence,
        risk_level: 'medium',
        standard_text: '쇼핑 방문이 없는 상품입니다.',
      }));
      patch.itinerary_highlights = { shopping: '쇼핑 방문이 없는 상품입니다.' };
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'shopping_visit',
        template_key: 'shopping.none',
        values: { none: true, count: 0 },
        evidence: [evidence],
      }));
    }

    const shoppingCount = source.match(/쇼핑(?:센터)?\s*(\d+)\s*회|\[?쇼핑\s*(\d+)\s*회\]?/i);
    if (shoppingCount) {
      const count = Number(shoppingCount[1] ?? shoppingCount[2]);
      const items = parseShoppingItems(source);
      addFact(facts, makeFact({
        category: 'shopping_policy',
        values: { none: false, count, items },
        evidence,
        risk_level: 'medium',
        review_status: count >= 0 ? 'auto_clean' : 'review_needed',
        standard_text: `일정 중 쇼핑센터 ${count}회 방문이 포함되어 있습니다${items.length ? `: ${items.join(', ')}` : ''}.`,
      }));
      patch.itinerary_highlights = { shopping: `쇼핑센터 ${count}회${items.length ? ` (${items.join(', ')})` : ''}` };
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'shopping_visit',
        template_key: 'shopping.visits_count',
        values: { count, items },
        evidence: [evidence],
      }));
    }

    const bracketGrade = source.match(/\[?\s*((?:준)?[345]\s*성급)\s*\]?/i);
    const hotelGrade = bracketGrade ?? source.match(/(?:HOTEL|호텔|리조트).*?(\[?\s*(?:준)?[345]\s*성급\s*\]?|특급|준특급|일급|디럭스|럭셔리|프리미엄)/i);
    if (hotelGrade) {
      const grade = hotelGrade[1].replace(/[\[\]]/g, '').replace(/\s+/g, '');
      const name = source.match(/(?:HOTEL|호텔|리조트)\s*[:：-]?\s*([^\[\n,]+?)(?:또는|or|\[|$)/i)?.[1]?.trim() ?? null;
      const equivalent = /동급|또는|or/i.test(source);
      addFact(facts, makeFact({
        category: 'hotel_grade',
        values: { name, grade, equivalent },
        evidence,
        risk_level: 'medium',
        standard_text: `${name ? `${name} ` : ''}${grade} 호텔${equivalent ? ' 또는 동급' : ''} 이용 예정입니다.`,
      }));
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'hotel_notice',
        template_key: 'hotel.grade',
        values: { name, grade, equivalent },
        evidence: [evidence],
      }));
    }

    if (/싱글\s*(차지|룸|사용)|1\s*인실|독실|single\s*(charge|room)/i.test(source)) {
      const amount = parseKrw(source);
      const inquiry = amount == null;
      addFact(facts, makeFact({
        category: 'room_policy',
        values: { single_supplement_amount: amount, currency: amount ? '원' : null, inquiry },
        evidence,
        risk_level: amount ? 'high' : 'medium',
        review_status: amount ? 'auto_clean' : 'review_needed',
        standard_text: amount
          ? `1인실 사용 시 일정 기준 1인 ${amount / 10000}만 원의 추가요금이 발생합니다.`
          : '1인실 사용 시 추가 요금은 예약 시 확인이 필요합니다.',
      }));
      patch.single_supplement = amount ? `${amount}` : '문의 필요';
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'single_room_surcharge',
        template_key: amount ? 'single_room_surcharge.full_trip' : 'single_room_surcharge.inquiry_required',
        values: { amount, currency: amount ? '원' : null },
        evidence: [evidence],
        review_status: amount ? undefined : 'review_needed',
      }));
    }

    const mealSummary = parseMealSummary(source);
    if (mealSummary) {
      addFact(facts, makeFact({
        category: 'meal_plan',
        values: { summary: mealSummary },
        evidence,
        risk_level: 'low',
        standard_text: `일정표 기준 식사는 ${mealSummary}로 제공됩니다.`,
      }));
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'meal_plan',
        template_key: 'meal.summary',
        values: { summary: mealSummary },
        evidence: [evidence],
      }));
    }

    const transportItems = detectTransportItems(source);
    if (transportItems.length) {
      addFact(facts, makeFact({
        category: 'transport',
        values: { items: transportItems },
        evidence,
        risk_level: 'low',
        standard_text: `${transportItems.join(', ')} 이동이 포함되어 있습니다.`,
      }));
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'transport_notice',
        template_key: 'transport.included',
        values: { items: transportItems },
        evidence: [evidence],
      }));
    }

    if (/여권|비자|무비자|전자비자|입국|반입\s*금지|출입국/i.test(source)) {
      const passportNotice = buildStandardNoticeDraft({
        source_text: source,
        category: /여권/.test(source) ? 'passport_validity' : 'visa_entry_rule',
        template_key: /여권/.test(source) ? 'passport.validity_months' : 'visa.entry_rule',
        values: /여권/.test(source) ? { months: Number(source.match(/(\d+)\s*개월/)?.[1] ?? 6) } : {},
        evidence: [evidence],
      });
      if (passportNotice) {
        addNotice(notices, passportNotice);
        addFact(facts, makeFact({
          category: 'passport_visa_law',
          values: passportNotice.values,
          evidence,
          risk_level: 'high',
          review_status: passportNotice.review_status,
          standard_text: passportNotice.standard_text,
        }));
      }
    }

    if (/일정|행사\s*순서|현지\s*사정|항공\s*사정/.test(source) && /변경|조정|달라|변동/.test(source)) {
      addFact(facts, makeFact({
        category: 'schedule_policy',
        values: { order_may_change: true },
        evidence,
        risk_level: 'medium',
        standard_text: '항공 및 현지 사정에 따라 일정과 행사 순서가 변경될 수 있습니다.',
      }));
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'itinerary_change',
        template_key: 'itinerary.order_may_change',
        values: {},
        evidence: [evidence],
      }));
    }

    if (/준비물|수영복|(?<!\uACF5\uC6D0)우산(?!\uACF5\uC6D0)|운동화|모자|선크림|여권\s*사본|상비약/i.test(source)) {
      const items = source.split(/[,:：/·ㆍ]/).map(item => item.trim()).filter(item => item.length >= 2).slice(0, 8);
      addFact(facts, makeFact({
        category: 'prep_items',
        values: { items },
        evidence,
        risk_level: 'low',
        standard_text: `여행 준비물: ${items.join(', ')}.`,
      }));
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'prep_items',
        template_key: 'prep.items',
        values: { items },
        evidence: [evidence],
      }));
    }

    const minPax = source.match(/최소\s*출발\s*(\d+)\s*명|출발\s*확정\s*(\d+)\s*명|모객\s*(\d+)\s*명/i);
    if (minPax) {
      const count = Number(minPax[1] ?? minPax[2] ?? minPax[3]);
      addFact(facts, makeFact({
        category: 'min_pax',
        values: { count },
        evidence,
        risk_level: 'medium',
        standard_text: `최소 출발 인원은 ${count}명입니다.`,
      }));
      addNotice(notices, buildStandardNoticeDraft({
        source_text: source,
        category: 'minimum_departure',
        template_key: 'minimum_departure.count',
        values: { count },
        evidence: [evidence],
      }));
    }

    if (
      /유류\s*할증료|추가\s*(요금|비용|금액)|별도\s*(비용|요금)|불포함\s*(비용|요금|금액)|입장료|관광세|리조트피|비자비|환경세/i.test(source)
      && !isIncludedCostLine(source)
      && !isCancellationOrPaymentPolicyLine(source)
      && !/왕복항공료|유류할증료|포함|관광지\s*입장료|여행자보험|중국비자|비자\s*필요/i.test(source)
    ) {
      const amount = parseKrw(source) ?? parseUsd(source);
      const percent = amount == null ? parsePercent(source) : null;
      const conditionalMinPax = isConditionalMinPaxSurchargeLine(source);
      const currency = /\$|USD/i.test(source) ? 'USD' : amount ? '원' : null;
      addFact(facts, makeFact({
        category: 'surcharge',
        values: { label: source.slice(0, 80), amount, currency, percent },
        evidence,
        risk_level: amount || percent || !conditionalMinPax ? 'high' : 'medium',
        review_status: amount || percent || conditionalMinPax ? 'auto_clean' : 'review_needed',
        standard_text: amount || percent
          ? `${source.slice(0, 40)}은 별도 비용으로 발생할 수 있습니다.`
          : conditionalMinPax
            ? '기준 인원 미충족 시 추가요금이 발생할 수 있어 예약 시 확인이 필요합니다.'
            : '별도 비용 항목은 예약 시 확인이 필요합니다.',
      }));
    }
  }

  patch.category_attrs = summarizeCategoryAttrs(facts);
  return { structuredFacts: facts, standardNotices: notices, customerFieldPatch: patch };
}

export function collectStructuredFactsFromLedger(ledger: unknown): StructuredFact[] {
  if (typeof ledger !== 'object' || ledger === null || !Array.isArray((ledger as { variants?: unknown }).variants)) return [];
  const facts: StructuredFact[] = [];
  for (const variant of (ledger as { variants: unknown[] }).variants) {
    if (typeof variant !== 'object' || variant === null || !Array.isArray((variant as { structured_facts?: unknown }).structured_facts)) continue;
    for (const fact of (variant as { structured_facts: StructuredFact[] }).structured_facts) {
      facts.push(fact);
    }
  }
  return facts;
}
