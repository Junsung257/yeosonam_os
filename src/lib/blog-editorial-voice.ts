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
    '==highlight==',
  ],
};

const OFFICIAL_SOURCE_INTENTS = new Set(['weather', 'preparation', 'transport', 'visa', 'currency', 'cost']);

export function buildInfoGuideBrief(brief: BlogContentBrief): InfoGuideBrief {
  const answerFirst = `${brief.primaryKeyword}은 먼저 ${brief.requiredSections.slice(0, 2).join(', ')} 기준으로 확인하면 됩니다.`;
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
    '- CTA wording: "이 출발일/인원 기준 가능 여부 확인"; never pressure the reader to book immediately.',
    `- Product consult facts: ${JSON.stringify(brief)}`,
    `- Banned repeated patterns: ${voice.banned_patterns.join(' / ')}`,
  ].join('\n');
}
