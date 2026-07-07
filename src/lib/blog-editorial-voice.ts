import type { BlogContentBrief } from './blog-content-brief';
import type { ProductBlogBrief } from './blog-product-brief';

export type EditorialVoice = {
  role: 'consulting_editor';
  tone: 'direct, calm, non-hype';
  cta_policy: 'bottom_soft';
  banned_patterns: string[];
};

export type InfoGuideBrief = {
  reader_question: string;
  answer_first: string;
  search_intent: string;
  official_sources_required: boolean;
  destination_required: boolean;
  cta_policy: 'bottom_soft';
};

export type ProductConsultBrief = {
  price_from: number | null;
  departure_city: string | null;
  duration: string | null;
  included: string[];
  excluded: string[];
  fit_for: string[];
  not_fit_for: string[];
  risk_notes: string[];
  consult_questions: string[];
};

export const BLOG_EDITORIAL_VOICE: EditorialVoice = {
  role: 'consulting_editor',
  tone: 'direct, calm, non-hype',
  cta_policy: 'bottom_soft',
  banned_patterns: [
    '이게 말이 되나 싶으시죠?',
    '완벽 가이드',
    '총정리',
    '여소남 에디터가 추천',
    '여소남 데이터',
    '놓치면 후회',
    '최고의 선택',
    '강력 추천',
    '역대급',
    '최저가',
    '고민하고 계셨나요',
    '준비되어 있습니다',
    '확인해 주시기 바랍니다',
    '==highlight==',
  ],
};

const OFFICIAL_SOURCE_INTENTS = new Set(['weather', 'preparation', 'transport', 'visa', 'currency', 'cost']);

function hasFinalConsonant(value: string): boolean {
  const last = value.trim().replace(/[^\uAC00-\uD7A3]/g, '').slice(-1);
  if (!last) return true;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return true;
  return (code - 0xac00) % 28 !== 0;
}

function topicParticle(value: string, withBatchim: string, withoutBatchim: string): string {
  return hasFinalConsonant(value) ? withBatchim : withoutBatchim;
}

export function buildInfoGuideBrief(brief: BlogContentBrief): InfoGuideBrief {
  const answerFirst = `${brief.primaryKeyword}${topicParticle(brief.primaryKeyword, '은', '는')} 먼저 ${brief.requiredSections.slice(0, 2).join(', ')} 기준으로 확인하면 됩니다.`;
  return {
    reader_question: brief.readerQuestion,
    answer_first: answerFirst,
    search_intent: brief.searchIntent,
    official_sources_required: OFFICIAL_SOURCE_INTENTS.has(brief.searchIntent),
    destination_required: !/^해외여행|여행|가족|여름|로밍|보험/.test(brief.primaryKeyword),
    cta_policy: 'bottom_soft',
  };
}

export function buildInfoWriterPromptBlock(brief: InfoGuideBrief, voice: EditorialVoice = BLOG_EDITORIAL_VOICE): string {
  return [
    '## Writer: info_writer',
    `- Role: ${voice.role}. Tone: ${voice.tone}.`,
    '- You are not a product salesperson. You are a travel editor who reduces pre-trip uncertainty.',
    `- Reader question: ${brief.reader_question}`,
    `- Answer-first sentence to satisfy in the first 120-180 Korean characters: ${brief.answer_first}`,
    `- Search intent: ${brief.search_intent}`,
    `- Official/primary source links required: ${brief.official_sources_required ? 'yes' : 'no'}`,
    `- Destination required unless intentionally generic: ${brief.destination_required ? 'yes' : 'no'}`,
    '- Structure must be: answer first -> situation-based judgement -> checklist/table only when useful -> mistakes/risks -> official checks -> soft bottom CTA.',
    '- First paragraph must sound like a Korean travel editor answering a real question. Do not repeat the exact phrase "답부터 말하면" across posts.',
    '- For risky or changeable facts such as visa, fees, weather, airport, insurance, refund, ticketing, customs, or baggage rules, avoid hard certainty and explain that official/current conditions should be checked.',
    '- Keep mobile paragraphs short: usually 1-3 Korean sentences per paragraph, with lists/tables only where they help the reader save or compare.',
    '- CTA policy: bottom only, soft wording such as "내 일정 기준으로 확인하기"; no hard sales CTA in the first 30% of the article.',
    `- Banned repeated patterns: ${voice.banned_patterns.join(' / ')}`,
  ].join('\n');
}

export function buildProductConsultBrief(brief: ProductBlogBrief): ProductConsultBrief {
  return {
    price_from: brief.price_from,
    departure_city: brief.departure_city,
    duration: brief.duration,
    included: brief.included,
    excluded: brief.excluded,
    fit_for: brief.fit_for,
    not_fit_for: brief.not_fit_for,
    risk_notes: brief.risk_notes,
    consult_questions: brief.consult_questions,
  };
}

export function buildProductConsultantPromptBlock(
  brief: ProductConsultBrief,
  voice: EditorialVoice = BLOG_EDITORIAL_VOICE,
): string {
  return [
    '## Writer: product_consultant_writer',
    `- Role: ${voice.role}. Tone: ${voice.tone}.`,
    '- You are not an ad copywriter. You are a consulting manager helping customers decide before inquiry.',
    '- First paragraph must start with at least two of: price, departure city, duration, fit-for customer, verification variable.',
    '- Required structure: 10-second judgement -> included/excluded -> itinerary feel -> fit_for/not_fit_for -> price-change conditions -> questions before inquiry -> CTA.',
    '- Never invent hotels, confirmed schedules, benefits, airline facts, or scarce seats that are not in the product data.',
    '- Remove customer-hidden supplier/business terms such as commission, margin, net price, land settlement, internal memo, account number, wholesale, B2B, or staff names.',
    '- If present in product data, do not hide guide/driver fees, fuel surcharge, single charge, hotel surcharge, optional tours, shopping count/items, manners tip, deposit, no-show/no-participation penalty, room assignment limits, join events, passport/visa documents, or cancellation conditions.',
    '- Write for mobile readers in their 40s-60s: short paragraphs, direct words, no hype, no vague adjectives such as special, perfect, best, lowest, or legendary.',
    '- CTA wording: "이 출발일/인원 기준 가능 여부 확인"; never pressure the reader to book immediately.',
    `- Product consult facts: ${JSON.stringify(brief)}`,
    `- Banned repeated patterns: ${voice.banned_patterns.join(' / ')}`,
  ].join('\n');
}
