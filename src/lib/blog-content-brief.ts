import type { SerpAnalysis } from './serp-analyzer';

export type BlogBriefIntent =
  | 'weather'
  | 'preparation'
  | 'cost'
  | 'transport'
  | 'comparison'
  | 'itinerary'
  | 'general';

export interface BlogContentBriefInput {
  topic?: string | null;
  destination?: string | null;
  primaryKeyword?: string | null;
  category?: string | null;
  source?: string | null;
  keywords?: string[] | null;
  serp?: SerpAnalysis | null;
}

export interface BlogContentBrief {
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: BlogBriefIntent;
  readerQuestion: string;
  requiredSections: string[];
  forbiddenAngles: string[];
  sourceRequirements: string[];
  titleCandidates: string[];
  evidence: string[];
  passed: boolean;
  issues: string[];
}

const LODGING_TANGENT_RE = /에어컨|에어콘|숙소|호텔|리조트|숙박|air\s*con|aircon|a\/c|accommodation|hotel|resort/i;
const WEATHER_RE = /날씨|옷차림|우기|건기|기온|강수|비|스콜|태풍|weather|clothing|rain|season/i;
const PREPARATION_RE = /준비물|체크리스트|짐싸기|필수품|packing|checklist|preparation/i;
const COST_RE = /비용|예산|경비|가격|환전|가성비|cost|budget|expense|price/i;
const TRANSPORT_RE = /항공권|공항|교통|이동|비행|flight|airport|transport|transfer/i;
const ITINERARY_RE = /일정|코스|루트|day\s*\d+|itinerary|course|route/i;
const COMPARISON_RE = /비교|추천|순위|best|top|vs|comparison|ranking/i;
const MONTH_RE = /(?:^|\s)(1[0-2]|[1-9])\s*월(?:\s|$)|(?:^|\s)(1[0-2]|[1-9])\s*month(?:\s|$)/i;

function clean(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = clean(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function inferMonth(text: string): string | null {
  const match = text.match(MONTH_RE);
  const month = match?.[1] || match?.[2];
  return month ? `${Number(month)}월` : null;
}

function inferIntent(text: string): BlogBriefIntent {
  if (WEATHER_RE.test(text)) return 'weather';
  if (PREPARATION_RE.test(text)) return 'preparation';
  if (COST_RE.test(text)) return 'cost';
  if (TRANSPORT_RE.test(text)) return 'transport';
  if (ITINERARY_RE.test(text)) return 'itinerary';
  if (COMPARISON_RE.test(text)) return 'comparison';
  return 'general';
}

function inferDestination(input: BlogContentBriefInput, text: string): string {
  const destination = clean(input.destination);
  if (destination) return destination;

  const primary = clean(input.primaryKeyword);
  const topic = clean(input.topic);
  const source = primary || topic || text;
  const withoutMonth = source.replace(MONTH_RE, ' ').replace(/\s+/g, ' ').trim();
  const stop = /^(여행|해외여행|여름|휴가|가이드|준비물|날씨|옷차림|비용|예산)$/;
  return withoutMonth
    .split(/[\s,/|]+/)
    .map((token) => token.trim())
    .find((token) => token.length >= 2 && !stop.test(token)) || '';
}

function weatherBrief(destination: string, month: string): Pick<
  BlogContentBrief,
  'title' | 'primaryKeyword' | 'secondaryKeywords' | 'readerQuestion' | 'requiredSections' | 'forbiddenAngles' | 'sourceRequirements' | 'titleCandidates'
> {
  const base = `${destination} ${month}`;
  return {
    title: `${base} 날씨 옷차림 여행 준비물 체크리스트`,
    primaryKeyword: `${base} 날씨`,
    secondaryKeywords: [
      `${base} 옷차림`,
      `${destination} 여행 준비물`,
      `${base} 우기`,
      `${base} 스콜`,
      `${base} 태풍`,
    ],
    readerQuestion: `${base} 여행을 준비하는 사람이 날씨, 옷차림, 준비물을 한 번에 판단할 수 있어야 한다.`,
    requiredSections: [
      `${base} 날씨 한눈에 보기`,
      `${month} 기온/강수/습도 표`,
      `${base} 옷차림`,
      `${destination} 여행 준비물 체크리스트`,
      `우기/스콜/태풍 리스크`,
      `출발 전 최종 확인 FAQ`,
    ],
    forbiddenAngles: [
      '에어컨 없는 숙소가 중심 주제가 되면 안 됨',
      '호텔/리조트 추천 글로 바뀌면 안 됨',
      '패키지 판매 문구가 날씨 답변보다 앞서면 안 됨',
    ],
    sourceRequirements: [
      '기온, 강수, 태풍처럼 변동되는 정보는 공식/권위 출처 확인 링크가 필요함',
      '월별 또는 시즌별 표가 본문에 실제 Markdown table로 있어야 함',
    ],
    titleCandidates: [
      `${base} 날씨 옷차림 여행 준비물 체크리스트`,
      `${base} 우기 여행 준비: 날씨, 옷차림, 준비물`,
      `${base} 여행 전 확인할 날씨와 짐싸기`,
    ],
  };
}

function genericBrief(
  destination: string,
  primaryKeyword: string,
  intent: BlogBriefIntent,
  keywords: string[],
): Pick<
  BlogContentBrief,
  'title' | 'primaryKeyword' | 'secondaryKeywords' | 'readerQuestion' | 'requiredSections' | 'forbiddenAngles' | 'sourceRequirements' | 'titleCandidates'
> {
  const primary = primaryKeyword || (destination ? `${destination} 여행 가이드` : '해외여행 가이드');
  const baseTitle = primary.length >= 10 ? primary : `${primary} 여행 가이드`;
  const sectionByIntent: Record<BlogBriefIntent, string[]> = {
    weather: ['날씨 핵심 요약', '월별/시즌별 표', '옷차림', '준비물', '주의할 날씨 변수', 'FAQ'],
    preparation: ['준비물 핵심 요약', '필수 체크리스트', '상황별 짐싸기', '출발 전 확인', '현지에서 필요한 것', 'FAQ'],
    cost: ['비용 핵심 요약', '항목별 예산 표', '절약 팁', '추가 비용', '추천 예산 시나리오', 'FAQ'],
    transport: ['이동 핵심 요약', '공항/항공권 체크', '현지 교통', '시간대별 주의점', '공식 확인 링크', 'FAQ'],
    comparison: ['선택 기준', '비교표', '추천 대상', '장단점', '주의점', 'FAQ'],
    itinerary: ['일정 핵심 요약', '일차별 코스', '이동 동선', '소요 시간', '대안 일정', 'FAQ'],
    general: ['핵심 요약', '여행 전 확인', '현지 팁', '주의점', '체크리스트', 'FAQ'],
  };

  const sourceRequirements = intent === 'transport'
    ? ['항공/공항/교통처럼 변동되는 정보는 공식/권위 출처 확인 링크가 필요함']
    : intent === 'cost'
      ? ['비용 글은 구체적인 금액 또는 예산 범위가 필요함']
      : ['검색의도에 직접 답하는 근거 또는 확인 링크가 필요함'];

  return {
    title: baseTitle,
    primaryKeyword: primary,
    secondaryKeywords: unique([
      ...keywords,
      destination ? `${destination} 여행 준비` : null,
      destination ? `${destination} 여행 팁` : null,
      `${primary} 체크리스트`,
    ]).filter((keyword) => keyword !== primary).slice(0, 6),
    readerQuestion: `${primary}을 검색한 사람이 가장 먼저 해결하려는 질문에 첫 화면에서 답해야 한다.`,
    requiredSections: sectionByIntent[intent],
    forbiddenAngles: [
      '검색 키워드와 무관한 숙소/상품/지역으로 주제를 옮기면 안 됨',
      '근거 없는 일반론으로 분량만 늘리면 안 됨',
    ],
    sourceRequirements,
    titleCandidates: [
      baseTitle,
      `${baseTitle} 체크리스트`,
      `${baseTitle} 2026 최신 정리`,
    ],
  };
}

export function buildBlogContentBrief(input: BlogContentBriefInput): BlogContentBrief {
  const keywords = unique(input.keywords || []);
  const text = clean([
    input.topic,
    input.destination,
    input.primaryKeyword,
    input.category,
    input.source,
    ...keywords,
  ].filter(Boolean).join(' '));
  const month = inferMonth(text);
  const destination = inferDestination(input, text);
  const rawPrimary = clean(input.primaryKeyword) || clean(input.topic);
  const rawIntent = inferIntent(text);
  const isDestinationMonth = Boolean(destination && month);
  const shouldForceWeather = Boolean(
    isDestinationMonth &&
    (input.source === 'seasonal' || WEATHER_RE.test(text) || PREPARATION_RE.test(text) || LODGING_TANGENT_RE.test(text)),
  );

  const base = shouldForceWeather
    ? weatherBrief(destination, month as string)
    : genericBrief(destination, rawPrimary, rawIntent, keywords);

  const serpEntities = input.serp?.recommended_entities_to_include || [];
  const secondaryKeywords = unique([
    ...base.secondaryKeywords,
    ...keywords,
    ...serpEntities.slice(0, 4),
  ]).filter((keyword) => keyword !== base.primaryKeyword).slice(0, 8);

  const evidence = unique([
    input.source ? `source:${input.source}` : null,
    month ? `month:${month}` : null,
    destination ? `destination:${destination}` : null,
    input.serp ? `serp:${input.serp.source}` : null,
  ]);

  const issues: string[] = [];
  if (base.primaryKeyword.length < 2) issues.push('missing_primary_keyword');
  if (secondaryKeywords.length < 3) issues.push('not_enough_secondary_keywords');
  if (base.requiredSections.length < 4) issues.push('not_enough_required_sections');
  if (shouldForceWeather && LODGING_TANGENT_RE.test(base.title)) issues.push('seasonal_title_lodging_tangent');
  if (shouldForceWeather && !WEATHER_RE.test(`${base.title} ${base.primaryKeyword}`)) issues.push('seasonal_weather_intent_missing');

  return {
    ...base,
    secondaryKeywords,
    searchIntent: shouldForceWeather ? 'weather' : rawIntent,
    evidence,
    passed: issues.length === 0,
    issues,
  };
}

export function buildBlogContentBriefPromptBlock(brief: BlogContentBrief): string {
  return [
    '## Content Brief - must follow before writing',
    `- Final title/topic: ${brief.title}`,
    `- Primary keyword: ${brief.primaryKeyword}`,
    `- Secondary keywords: ${brief.secondaryKeywords.join(', ')}`,
    `- Search intent: ${brief.searchIntent}`,
    `- Reader question: ${brief.readerQuestion}`,
    `- Required H2 sections: ${brief.requiredSections.join(' / ')}`,
    `- Forbidden angles: ${brief.forbiddenAngles.join(' / ')}`,
    `- Source requirements: ${brief.sourceRequirements.join(' / ')}`,
    '- Do not copy SERP articles. Use SERP only to understand intent, missing subtopics, and reader expectations.',
  ].join('\n');
}
