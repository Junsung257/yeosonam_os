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
  information_risk: 'low' | 'medium' | 'high';
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
const HIGH_RISK_INTENTS = new Set(['visa', 'currency', 'transport']);
const MEDIUM_RISK_INTENTS = new Set(['weather', 'preparation', 'cost', 'itinerary', 'comparison']);

function topicParticle(topic: string): '은' | '는' {
  const last = topic.trim().at(-1);
  if (!last) return '은';
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return '은';
  return (code - 0xac00) % 28 === 0 ? '는' : '은';
}

function classifyInformationRisk(searchIntent: string): InfoGuideBrief['information_risk'] {
  if (HIGH_RISK_INTENTS.has(searchIntent)) return 'high';
  if (MEDIUM_RISK_INTENTS.has(searchIntent)) return 'medium';
  return 'low';
}

export function buildInfoGuideBrief(brief: BlogContentBrief): InfoGuideBrief {
  const sections = brief.requiredSections.slice(0, 2).filter(Boolean);
  const firstCriteria = sections.length > 0 ? sections.join(', ') : '핵심 기준';
  const answerFirst = `${brief.primaryKeyword}${topicParticle(brief.primaryKeyword)} 먼저 ${firstCriteria} 기준으로 나눠 보면 됩니다.`;
  return {
    reader_question: brief.readerQuestion,
    answer_first: answerFirst,
    search_intent: brief.searchIntent,
    information_risk: classifyInformationRisk(brief.searchIntent),
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
    `- Information risk level: ${brief.information_risk}. Higher risk topics require weaker claims and clearer verification conditions.`,
    `- Official/primary source links required: ${brief.official_sources_required ? 'yes' : 'no'}`,
    `- Destination required unless intentionally generic: ${brief.destination_required ? 'yes' : 'no'}`,
    '- Internally analyze the title promise before writing: what answer the reader clicked for, what decision they must make, and which facts are unsafe to guess.',
    '- Do not fill length with facts outside the title promise. Do not invent prices, discounts, booking dates, penalties, fees, visa rules, insurance terms, customs limits, transport rules, hotels, vendors, or place names.',
    '- For high or medium risk topics, separate official rules from practical travel advice. If a number or rule can change, state the verification condition instead of presenting it as permanent.',
    '- Headings must be specific to the query, not generic labels like "핵심 요약", "체크리스트", or "상황별 선택 기준" repeated in every article.',
    '- Use examples or option lists only when the query asks for places, routes, choices, products, or comparison candidates; never invent unknown names.',
    '- Keep Markdown, source links, and valid tables when useful because this is a web /blog article, not a Naver copy-paste draft.',
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
    '- Title and intro must help customers judge price, departure city, destination, duration, and one concrete decision keyword. Do not use vague titles like "상품 정보 정리" or "여행 안내".',
    '- Keep source fidelity: never invent prices, dates, flights, hotels, room types, benefits, no-option/no-shopping/no-tip claims, insurance, visa, or confirmed schedules.',
    '- Remove customer-hidden business data: commission, margin, net cost, settlement price, B2B notes, internal memo, staff names, bank accounts, wholesale wording, and seller-only instructions.',
    '- If present in product data, disclose customer-critical conditions such as guide/driver fee, fuel surcharge, single charge, hotel surcharge, optional tours, shopping count/items, manner tips, deposits, penalties, join events, room assignment limits, flight seat limits, and document restrictions.',
    '- Explain choices factually. Do not say a cheaper or premium option is better; explain what is included, excluded, or variable.',
    '- Use short mobile-readable paragraphs. Price, flights, included/excluded items, shopping, and cautions should be scannable.',
    '- Never invent hotels, confirmed schedules, benefits, airline facts, or scarce seats that are not in the product data.',
    '- CTA wording: "이 출발일/인원 기준 가능 여부 확인"; never pressure the reader to book immediately.',
    `- Product consult facts: ${JSON.stringify(brief)}`,
    `- Banned repeated patterns: ${voice.banned_patterns.join(' / ')}`,
  ].join('\n');
}
