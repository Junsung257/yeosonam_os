import { stripMarkup } from './blog-text-utils';
import {
  isLikelyOfficialBlogSourceUrl,
} from './blog-official-source-url';
import { readVerifiedResearchOfficialSourceUrls } from './blog-verified-research-sources';

export const BLOG_ENGINE_V2_VERSION = 'blog-engine-v2';

export type BlogWriterType = 'info_writer' | 'product_consultant_writer' | 'unknown';
export type BlogEvidenceKind = 'official_source' | 'serp_intent' | 'internal_insight' | 'product_db';
export type BlogEngineFailureBucket =
  | 'passed'
  | 'candidate_shortage'
  | 'evidence_insufficient'
  | 'engine_task_incomplete'
  | 'customer_language'
  | 'ai_naturalness'
  | 'sales_pressure'
  | 'product_decision_helpfulness'
  | 'faithfulness';

export interface BlogEngineEvidenceItem {
  kind: BlogEvidenceKind;
  label: string;
  url?: string;
  source?: string;
}

export interface BlogEngineV2Brief {
  writer_type: BlogWriterType;
  reader_task: string;
  primary_keyword: string | null;
  destination: string | null;
  evidence_items: BlogEngineEvidenceItem[];
  cta_policy: 'runtime_contextual' | 'bottom_soft' | 'product_consult';
  forbidden_claims: string[];
  answer_first?: string | null;
  official_sources_required?: boolean;
  risk_or_change_notes?: string[];
  product_id?: string | null;
  price_from?: number | null;
  departure_city?: string | null;
  duration?: string | null;
  included?: string[];
  excluded?: string[];
  fit_for?: string[];
  not_fit_for?: string[];
  risk_notes?: string[];
  consult_questions?: string[];
}

export interface BlogEngineEvaluation {
  score: number;
  passed: boolean;
  failure_bucket: BlogEngineFailureBucket;
  category_scores: BlogEngineCategoryScore[];
  metrics: {
    task_completion: number;
    customer_language: number;
    naturalness: number;
    faithfulness: number;
    source_support: number;
    sales_pressure: number;
    product_decision_helpfulness: number;
  };
  repair_recommendation: string | null;
  brief: BlogEngineV2Brief;
}

export type BlogEngineCategoryId =
  | 'reader_task_completion'
  | 'customer_language'
  | 'naturalness'
  | 'evidence_faithfulness'
  | 'sales_pressure_control'
  | 'product_decision_helpfulness';

export interface BlogEngineCategoryScore {
  id: BlogEngineCategoryId;
  label: string;
  score: number;
  passed: boolean;
}

export interface BlogPublishabilitySnapshot {
  queued_total: number;
  publishable_count: number;
  duplicate_count: number;
  evidence_insufficient_count: number;
  demand_missing_count?: number;
  destinationless_info_count?: number;
  candidate_contract_blocked_count?: number;
  candidate_shortage: boolean;
  next_action:
    | 'publish_ready'
    | 'refill_candidates'
    | 'quarantine_duplicates'
    | 'collect_evidence'
    | 'collect_demand'
    | 'repair_destinationless_info'
    | 'repair_candidate_contract';
}

type BuildBriefInput = {
  blogHtml?: string | null;
  primaryKeyword?: string | null;
  destination?: string | null;
  contentType?: string | null;
  productId?: string | null;
  generationMeta?: Record<string, unknown> | null;
};

const FORBIDDEN_CLAIMS = [
  '상품 DB에 없는 호텔명',
  '확정되지 않은 항공/일정/혜택',
  '근거 없는 여소남 데이터',
  '허위 희소성/마감 임박',
  '상단 강한 예약 CTA',
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstBodyParagraph(source: string): string {
  for (const chunk of source.split(/\n{2,}/)) {
    const text = chunk
      .replace(/^#{1,6}\s+\S.*$/gm, '')
      .replace(/^!\[[^\]\n]*]\([^)]+\).*$/gm, '')
      .replace(/<figcaption>[\s\S]*?<\/figcaption>/gi, ' ')
      .replace(/^\|.*\|$/gm, '')
      .replace(/^\s*(?:[-*]|\d+\.)\s+\S.*$/gm, '')
      .replace(/[-*]\s+\S.*$/gm, '')
      .replace(/\d+\.\s+\S.*$/gm, '')
      .replace(/[\s\S]*/, (text) => stripMarkup(text))
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 30) return text;
  }
  return '';
}

function extractExternalLinks(markdown: string): BlogEngineEvidenceItem[] {
  const out: BlogEngineEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]+]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const url = match[1];
    if (!url || /yeosonam\.com/i.test(url) || seen.has(url) || !isLikelyOfficialBlogSourceUrl(url)) continue;
    seen.add(url);
    out.push({ kind: 'official_source', label: new URL(url).hostname, url, source: 'markdown_link' });
  }
  return out.slice(0, 6);
}

function extractVerifiedResearchSources(meta: Record<string, unknown>): BlogEngineEvidenceItem[] {
  return readVerifiedResearchOfficialSourceUrls(meta)
    .slice(0, 6)
    .map((url) => ({
      kind: 'official_source',
      label: new URL(url).hostname,
      url,
      source: 'verified_research_preflight',
    }));
}

function inferWriter(input: BuildBriefInput): BlogWriterType {
  const meta = asRecord(input.generationMeta);
  if (meta.writer === 'info_writer' || meta.writer === 'product_consultant_writer') {
    return meta.writer;
  }
  if (input.productId || input.contentType === 'package_intro') return 'product_consultant_writer';
  return 'info_writer';
}

export function buildBlogEngineV2Brief(input: BuildBriefInput): BlogEngineV2Brief {
  const meta = asRecord(input.generationMeta);
  const contentBrief = asRecord(meta.content_brief);
  const infoGuide = asRecord(meta.info_guide_brief);
  const productConsult = asRecord(meta.product_consult_brief);
  const productBrief = asRecord(contentBrief.product);
  const writer = inferWriter(input);
  const primaryKeyword =
    typeof input.primaryKeyword === 'string' && input.primaryKeyword.trim()
      ? input.primaryKeyword.trim()
      : typeof contentBrief.primary_keyword === 'string'
        ? contentBrief.primary_keyword
        : null;
  const destination =
    typeof input.destination === 'string' && input.destination.trim()
      ? input.destination.trim()
      : typeof productBrief.destination === 'string'
        ? productBrief.destination
        : null;
  const evidence = [...new Map(
    [
      ...extractExternalLinks(input.blogHtml ?? ''),
      ...extractVerifiedResearchSources(meta),
    ].map((item) => [item.url ?? `${item.kind}:${item.label}`, item]),
  ).values()];

  if (writer === 'product_consultant_writer') {
    evidence.push({
      kind: 'product_db',
      label: input.productId ? `product:${input.productId}` : 'product brief',
      source: 'travel_packages',
    });
  }

  if (contentBrief.search_intent || contentBrief.searchIntent || meta.serp_analysis) {
    evidence.push({
      kind: 'serp_intent',
      label: String(contentBrief.search_intent ?? contentBrief.searchIntent ?? 'serp_analysis'),
      source: meta.serp_analysis ? 'serp_analysis' : 'content_brief',
    });
  }

  for (const item of asStringArray(contentBrief.evidence).slice(0, 3)) {
    evidence.push({ kind: 'internal_insight', label: item, source: 'content_brief.evidence' });
  }

  if (writer === 'product_consultant_writer') {
    return {
      writer_type: writer,
      reader_task: '문의 전 가격, 포함사항, 일정 부담, 맞는 사람/안 맞는 사람을 판단한다.',
      primary_keyword: primaryKeyword,
      destination,
      evidence_items: evidence,
      cta_policy: 'product_consult',
      forbidden_claims: FORBIDDEN_CLAIMS,
      product_id: input.productId ?? (typeof productBrief.product_id === 'string' ? productBrief.product_id : null),
      price_from: asNumber(productConsult.price_from ?? productBrief.price_from),
      departure_city: typeof productConsult.departure_city === 'string' ? productConsult.departure_city : typeof productBrief.departure_city === 'string' ? productBrief.departure_city : null,
      duration: typeof productConsult.duration === 'string' ? productConsult.duration : typeof productBrief.duration === 'string' ? productBrief.duration : null,
      included: asStringArray(productConsult.included ?? productBrief.included),
      excluded: asStringArray(productConsult.excluded ?? productBrief.excluded),
      fit_for: asStringArray(productConsult.fit_for ?? productBrief.fit_for),
      not_fit_for: asStringArray(productConsult.not_fit_for ?? productBrief.not_fit_for),
      risk_notes: asStringArray(productConsult.risk_notes ?? productBrief.risk_notes),
      consult_questions: asStringArray(productConsult.consult_questions ?? productBrief.consult_questions),
    };
  }

  return {
    writer_type: writer,
    reader_task: typeof infoGuide.reader_question === 'string'
      ? infoGuide.reader_question
      : '검색자가 여행 전 비용, 일정, 준비물, 리스크를 빠르게 판단한다.',
    primary_keyword: primaryKeyword,
    destination,
    evidence_items: evidence,
    cta_policy: 'runtime_contextual',
    forbidden_claims: FORBIDDEN_CLAIMS,
    answer_first: typeof infoGuide.answer_first === 'string' ? infoGuide.answer_first : null,
    official_sources_required: Boolean(infoGuide.official_sources_required),
    risk_or_change_notes: asStringArray(contentBrief.source_requirements ?? contentBrief.sourceRequirements),
  };
}

function scoreInfoTask(markdown: string, flexibleV3 = false): number {
  const first = firstBodyParagraph(markdown);
  if (!first) return 0;
  let score = 45;
  if (first.length >= 80) score += 20;
  if (/(먼저|기준|확인|준비|주의|비용|가격|날씨|동선|필요|달라질 수|좋습니다|맞습니다|핵심|결론)/.test(first)) score += 25;
  if (!/^(안녕하세요|오늘은|이번\s*글에서는|여소남\s*에디터)/.test(first)) score += 10;
  const answerSignals = [
    /먼저|나눠|비교|확인|준비|챙기|봐야|체크|기준|잡아/,
    /기온|비|소나기|옷차림|숙소|이동|식사|교통|포함|불포함|가격|비용|예산|경비|식비|이동비|선택\s*관광|카드\s*수수료|총액|비자|여권|환율|서류|좌석|호텔|공항/,
    /\d|원|℃|박|일|시간|성수기|우기|건기|출발|현지|공식|~|–|-/,
  ];
  const answerSignalCount = answerSignals.filter((pattern) => pattern.test(first)).length;
  if (answerSignalCount < 2) score = Math.min(score, 75);
  else if (answerSignalCount < 3) score = Math.min(score, 90);
  const structuredEvidence =
    (markdown.match(/(^|\n)\s*\|.+\|/g) ?? []).length >= 3
    || (markdown.match(/(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g) ?? []).length >= 5;
  if (score < 80 && structuredEvidence && /(비용|일정|준비|체크|지역|호텔|동선|날씨|환전|입국)/.test(markdown)) {
    score = 80;
  }
  if (!/\d|[0-9]|~|-|USD|KRW|JPY|VND|\$/.test(first)) {
    score = Math.min(score, 90);
  }
  const actionFirst = /(먼저|기준|확인|비교|나눠|봐야|체크|준비|챙기|판단)/.test(first);
  const customerTravelNeed =
    /(보험|보장|병원|수하물|로밍|유심|데이터|통신|픽업|택시|그랩|셔틀|공항|비자|입국|여권|서류|날씨|옷차림|준비물|일정|동선|비용|예산|경비|식비|이동비|선택\s*관광|카드\s*수수료|가격|숙소|호텔|가족|아이)/.test(first);
  const concreteSignal = /\d|원|℃|박|일|시간|성수기|우기|건기|출발|현지|공식|공항|항공|숙소|~|–|-/.test(first);
  if (actionFirst && customerTravelNeed && concreteSignal) {
    score = Math.max(score, 100);
  }
  if (
    flexibleV3
    && first.length >= 80
    && !/^(안녕하세요|오늘은|이번\s*글에서는|여소남\s*에디터)/.test(first)
    && /(고르|선택|비교|기준|판단|좁혀|대입|정하)/.test(first)
    && /(시간|체력|동행|일정|우선순위|비용|숙소|호텔|교통|날씨|준비)/.test(first)
  ) {
    // Flexible V3 briefs may answer a decision without fabricating a number in
    // the opening paragraph. Numeric facts remain governed by the claim gate.
    score = 100;
  }
  const weatherDecisionFirst =
    /(날씨|옷차림|기온|비|우산|우비|방수|겉옷|자외선|일교차)/.test(first)
    && /(먼저|확인|체크|준비|챙기|나눠|봐야)/.test(first)
    && /(출발|일정|이동|밤|장거리|\d|℃)/.test(first);
  if (weatherDecisionFirst) {
    score = Math.max(score, 100);
  }
  return Math.min(100, score);
}

function scoreProductDecision(markdown: string, brief: BlogEngineV2Brief): number {
  const required = [
    /10초\s*판단/,
    /포함\/불포함|포함\s*사항.*불포함\s*사항/s,
    /이런\s*분께\s*맞|fit_for/i,
    /맞지\s*않을\s*수|not_fit_for/i,
    /가격이\s*달라질\s*수|가격\s*변동|risk_notes/i,
    /문의\s*전\s*질문|consult_questions/i,
  ];
  const readableRequired = [
    /10초\s*판단/,
    /포함\s*\/\s*불포함|포함\s*항목.*불포함\s*항목/s,
    /맞는\s*사람|맞는\s*분|맞는\s*고객/,
    /안\s*맞는\s*사람|맞지\s*않는\s*분|맞지\s*않는\s*고객/,
    /가격\s*변동\s*조건|가격(?:이|은)?\s*(?:바뀌|달라지|변동)/,
    /문의\s*전\s*질문/,
  ];
  const legacyScore = required.filter((pattern) => pattern.test(markdown)).length / required.length * 70;
  const readableScore = readableRequired.filter((pattern) => pattern.test(markdown)).length / readableRequired.length * 70;
  const blockScore = Math.max(legacyScore, readableScore);
  const briefFields = [
    brief.included?.length,
    brief.excluded?.length,
    brief.fit_for?.length,
    brief.not_fit_for?.length,
    brief.risk_notes?.length,
    brief.consult_questions?.length,
  ].filter((count) => (count ?? 0) > 0).length;
  return Math.round(blockScore + briefFields / 6 * 30);
}

function scoreNaturalness(markdown: string): number {
  const plain = stripMarkup(markdown).replace(/https?:\/\/\S+/gi, ' ');
  let score = 100;
  const banned = [
    '이게 말이 되나 싶으시죠',
    '완벽 가이드',
    '총정리',
    '여소남 에디터가 추천',
    '여소남 에디터',
    '놓치면 후회',
    '최고의 선택',
  ];
  score -= banned.filter((word) => plain.includes(word)).length * 18;
  score -= (plain.match(/가격만\s+보지\s+말고\s+출발지,\s*포함사항,\s*일정\s*강도를\s+(?:같이|함께)\s+봐야\s+판단이\s+쉽습니다/g) ?? []).length * 14;
  score -= (plain.match(/답부터\s+말하면,\s*20\d{2}년\s+\d{1,2}월\s+기준/g) ?? []).length * 8;
  score -= (markdown.match(/==[^=\n]{3,120}==|<mark\b/gi) ?? []).length * 25;
  score -= (plain.match(/안녕하세요|오늘은|이번 글에서는/g) ?? []).length * 8;
  return Math.max(0, score);
}

function hasFinalConsonant(char: string): boolean | null {
  const code = char.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0;
}

function particleMisuseCount(plain: string): number {
  const matches = [...plain.matchAll(/([가-힣]{2,12})(은|을)(?=\s|$|[.,!?])/g)];
  let count = 0;
  for (const match of matches) {
    const word = match[1] ?? '';
    const particle = match[2] ?? '';
    const last = word[word.length - 1] ?? '';
    const hasBatchim = hasFinalConsonant(last);
    if (hasBatchim === false && (particle === '은' || particle === '을')) {
      count += 1;
    }
  }
  return count;
}

function scoreCustomerLanguage(markdown: string, writer: BlogWriterType): number {
  const plain = stripMarkup(markdown).replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  let score = 100;
  score -= Math.min(45, particleMisuseCount(plain) * 15);
  if (/(대학생|가족|부모님|아이|고객|여행자)에서\s+먼저\s+볼\s+것은/.test(plain)) score -= 25;
  if (/먼저\s+볼\s+것은\s+비용[·,\s]+일정[·,\s]+현지\s+준비\s+조건/.test(plain)) score -= 12;
  if (/현지에서\s+1\s*[~–-]\s*2시간을\s+아끼고\s+예산\s+오차를\s+줄일\s+수\s+있습니다/.test(plain)) score -= 10;
  if (writer === 'product_consultant_writer') {
    const repeatedIntro = (plain.match(/패키지는\s+가격만\s+보지\s+말고\s+출발지,\s*포함사항,\s*일정\s*강도를\s+(?:같이|함께)\s+봐야\s+판단이\s+쉽습니다/g) ?? []).length;
    score -= repeatedIntro * 18;
    if (/☑|★|\[[A-Z0-9]{1,5}\]|[a-f0-9]{8,}/i.test(plain.slice(0, 500))) score -= 18;
  }
  return Math.max(0, score);
}

function scoreSalesPressure(markdown: string, writer: BlogWriterType): number {
  const bodyWithoutBottomCta = markdown
    .replace(/\n(?:##\s*|\*\*)여행\s*상품과\s*함께\s*확인하기(?:\*\*)?[\s\S]*$/i, '')
    .replace(/\n---[\s\S]*$/i, '');
  const plain = stripMarkup(bodyWithoutBottomCta).replace(/https?:\/\/\S+/gi, ' ');
  const firstThird = plain.slice(0, Math.ceil(plain.length * 0.3));
  const infoTop = plain.slice(0, Math.min(900, Math.ceil(plain.length * 0.3)));
  const koreanHardCta = /(?:\uC9C0\uAE08|\uBC14\uB85C)\s*\uC608\uC57D|\uC608\uC57D\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC0C1\uB2F4|\uBC14\uB85C|\uB9C8\uAC10)|\uC0C1\uB2F4\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC5F0\uACB0|\uBC14\uB85C)|\uBB38\uC758\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uC0C1\uB2F4|\uBC14\uB85C)|\uC0C1\uD488\s*\uBCF4\uAE30|\uD328\uD0A4\uC9C0\s*\uBCF4\uAE30|\uCE74\uCE74\uC624(?:\uD1A1)?\s*(?:\uC0C1\uB2F4|\uBB38\uC758)|\uC794\uC5EC\s*\uC88C\uC11D|\uB9C8\uAC10\s*\uC784\uBC15/i;
  const hardCta = /(지금\s*예약|바로\s*예약|예약\s*마감|잔여\s*좌석|상품\s*보기|패키지\s*보기|카카오(?:톡)?\s*(?:상담|문의|채널|연결)|(?:상담|문의)\s*(?:하기|신청|남기기|바로|가능|예약|마감)|예약\s*(?:하기|문의|상담|신청|바로|마감))/i;
  if (writer === 'info_writer' && (hardCta.test(infoTop) || koreanHardCta.test(infoTop))) return 35;
  if (koreanHardCta.test(plain) && /\uC9C0\uAE08|\uBC14\uB85C|\uB9C8\uAC10|\uC794\uC5EC/.test(plain)) return 45;
  if (/허리띠|마감임박|마지막\s*기회|놓치면\s*후회/i.test(plain)) return 45;
  return 100;
}

function scoreFaithfulness(markdown: string, brief: BlogEngineV2Brief): number {
  const plain = stripMarkup(markdown);
  let score = 100;
  const hasUnsupportedYeosonamData =
    /여소남(?:의)?\s*(?:내부\s*)?(?:데이터|예약\s*데이터|상담\s*데이터)(?:로\s*보면|로\s*본|를\s*보면|를\s*기준으로|에\s*따르면|상으로는|상)?/i.test(plain);
  if (hasUnsupportedYeosonamData && !/(예약|상담|검색)\s*(로그|건수|집계)|GSC|서치콘솔|SERP|출처|집계\s*기간|표본|로그/i.test(plain)) {
    score -= 45;
  }
  if (brief.writer_type === 'product_consultant_writer') {
    if (/(확정가|확정입니다|확정\s*보장|보장|무조건|잔여\s*좌석|마감\s*임박)/.test(plain)) score -= 25;
    if (!brief.product_id && brief.evidence_items.every((item) => item.kind !== 'product_db')) score -= 35;
  }
  return Math.max(0, score);
}

function chooseFailureBucket(metrics: BlogEngineEvaluation['metrics']): BlogEngineFailureBucket {
  const entries = Object.entries(metrics) as Array<[keyof typeof metrics, number]>;
  const [lowestMetric, lowestScore] = entries.sort((a, b) => a[1] - b[1])[0];
  if (lowestScore >= 100) return 'passed';
  if (lowestMetric === 'source_support') return 'evidence_insufficient';
  if (lowestMetric === 'task_completion') return 'engine_task_incomplete';
  if (lowestMetric === 'customer_language') return 'customer_language';
  if (lowestMetric === 'naturalness') return 'ai_naturalness';
  if (lowestMetric === 'sales_pressure') return 'sales_pressure';
  if (lowestMetric === 'product_decision_helpfulness') return 'product_decision_helpfulness';
  return 'faithfulness';
}

function buildCategoryScores(
  metrics: BlogEngineEvaluation['metrics'],
  brief: BlogEngineV2Brief,
): BlogEngineCategoryScore[] {
  const categories: BlogEngineCategoryScore[] = [
    {
      id: 'reader_task_completion',
      label: brief.writer_type === 'product_consultant_writer'
        ? '문의 전 판단 완성도'
        : '검색 의도 답변 완성도',
      score: metrics.task_completion,
      passed: metrics.task_completion >= 100,
    },
    {
      id: 'customer_language',
      label: '고객 언어와 한국어 자연스러움',
      score: metrics.customer_language,
      passed: metrics.customer_language >= 100,
    },
    {
      id: 'naturalness',
      label: 'AI 티/반복 템플릿 억제',
      score: metrics.naturalness,
      passed: metrics.naturalness >= 100,
    },
    {
      id: 'evidence_faithfulness',
      label: '근거 충실도와 출처 지원',
      score: Math.min(metrics.faithfulness, metrics.source_support),
      passed: metrics.faithfulness >= 100 && metrics.source_support >= 100,
    },
    {
      id: 'sales_pressure_control',
      label: brief.writer_type === 'product_consultant_writer'
        ? '과장/희소성 억제'
        : '정보성 상단 강CTA 억제',
      score: metrics.sales_pressure,
      passed: metrics.sales_pressure >= 100,
    },
  ];

  if (brief.writer_type === 'product_consultant_writer') {
    categories.push({
      id: 'product_decision_helpfulness',
      label: '상품 문의 전 판단 도움성',
      score: metrics.product_decision_helpfulness,
      passed: metrics.product_decision_helpfulness >= 100,
    });
  }

  return categories;
}

export function evaluateBlogEngineV2(input: BuildBriefInput): BlogEngineEvaluation {
  const blogHtml = input.blogHtml ?? '';
  const brief = buildBlogEngineV2Brief(input);
  const evidenceKinds = new Set(brief.evidence_items.map((item) => item.kind));
  const hasMinimumEvidence = brief.writer_type === 'product_consultant_writer'
    ? evidenceKinds.has('product_db')
    : brief.official_sources_required
      ? evidenceKinds.has('official_source')
      : evidenceKinds.has('official_source') || evidenceKinds.has('serp_intent') || evidenceKinds.has('internal_insight');

  const metrics = {
    task_completion: brief.writer_type === 'product_consultant_writer'
      ? scoreProductDecision(blogHtml, brief)
      : scoreInfoTask(blogHtml, Boolean(asRecord(input.generationMeta).content_brief_v3)),
    customer_language: scoreCustomerLanguage(blogHtml, brief.writer_type),
    naturalness: scoreNaturalness(blogHtml),
    faithfulness: scoreFaithfulness(blogHtml, brief),
    source_support: hasMinimumEvidence ? 100 : 35,
    sales_pressure: scoreSalesPressure(blogHtml, brief.writer_type),
    product_decision_helpfulness: brief.writer_type === 'product_consultant_writer'
      ? scoreProductDecision(blogHtml, brief)
      : 100,
  };
  const category_scores = buildCategoryScores(metrics, brief);
  const score = Math.round(category_scores.reduce((sum, value) => sum + value.score, 0) / category_scores.length);
  const failure_bucket = chooseFailureBucket(metrics);

  return {
    score,
    passed: score === 100 && failure_bucket === 'passed' && category_scores.every((category) => category.passed),
    failure_bucket,
    category_scores,
    metrics,
    repair_recommendation: failure_bucket === 'passed'
      ? null
      : failure_bucket === 'evidence_insufficient'
        ? '공식 링크, SERP intent, 내부 상담/상품DB 근거 중 최소 1개를 브리프에 추가하세요.'
        : failure_bucket === 'product_decision_helpfulness'
          ? '상품글을 10초 판단, 포함/불포함, 맞는 사람/안 맞는 사람, 가격 변동 조건, 문의 전 질문 구조로 재작성하세요.'
          : '도입 답변, CTA 위치, 과장 표현, 근거 없는 claim을 수리한 뒤 재평가하세요.',
    brief,
  };
}
