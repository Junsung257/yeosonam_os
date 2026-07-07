import { stripMarkup } from './blog-text-utils';

export const BLOG_ENGINE_V2_VERSION = 'blog-engine-v2';
export const BLOG_ENGINE_V2_PUBLISH_SCORE = 95;

export type BlogWriterType = 'info_writer' | 'product_consultant_writer' | 'unknown';
export type BlogEvidenceKind = 'official_source' | 'serp_intent' | 'internal_insight' | 'product_db';
export type BlogEngineFailureBucket =
  | 'passed'
  | 'candidate_shortage'
  | 'evidence_insufficient'
  | 'engine_task_incomplete'
  | 'ai_naturalness'
  | 'customer_language'
  | 'decision_clarity'
  | 'risk_disclosure'
  | 'template_repetition'
  | 'sales_pressure'
  | 'product_decision_helpfulness'
  | 'faithfulness';

export interface BlogEngineEvidenceItem {
  kind: BlogEvidenceKind;
  label: string;
  url?: string;
  source?: string;
}

export interface BlogEvidencePack {
  engine_version: typeof BLOG_ENGINE_V2_VERSION;
  writer_type: BlogWriterType;
  items: BlogEngineEvidenceItem[];
  official_source_count: number;
  internal_insight_count: number;
  product_db_count: number;
  serp_intent_count: number;
  score: number;
  sufficient: boolean;
  missing: string[];
}

export interface BlogEngineV2Brief {
  writer_type: BlogWriterType;
  reader_task: string;
  primary_keyword: string | null;
  destination: string | null;
  evidence_items: BlogEngineEvidenceItem[];
  cta_policy: 'bottom_soft' | 'product_consult';
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
  metrics: {
    task_completion: number;
    naturalness: number;
    faithfulness: number;
    source_support: number;
    sales_pressure: number;
    product_decision_helpfulness: number;
    customer_language: number;
    decision_clarity: number;
    risk_disclosure: number;
    template_repetition: number;
  };
  repair_recommendation: string | null;
  brief: BlogEngineV2Brief;
  evidence_pack: BlogEvidencePack;
  publish_threshold: typeof BLOG_ENGINE_V2_PUBLISH_SCORE;
}

export interface BlogPublishabilitySnapshot {
  queued_total: number;
  publishable_count: number;
  duplicate_count: number;
  evidence_insufficient_count: number;
  destinationless_info_count?: number;
  candidate_contract_blocked_count?: number;
  candidate_shortage: boolean;
  next_action:
    | 'publish_ready'
    | 'refill_candidates'
    | 'quarantine_duplicates'
    | 'collect_evidence'
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
    const text = stripMarkup(chunk
      .replace(/^#{1,6}\s+\S.*$/gm, '')
      .replace(/^\s*!\[[^\]]*]\([^)]+\)\s*$/gm, '')
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/^\|.*\|$/gm, '')
      .replace(/^\s*(?:[-*]|\d+\.)\s+\S.*$/gm, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 30) return text;
  }
  return '';
}

function extractExternalLinks(markdown: string): BlogEngineEvidenceItem[] {
  const out: BlogEngineEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(/\[[^\]]+]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (typeof match.index === 'number' && markdown[match.index - 1] === '!') continue;
    const url = match[1];
    if (!url || /yeosonam\.com/i.test(url) || seen.has(url)) continue;
    if (/\.(?:jpe?g|png|webp|gif|svg)(?:[?#].*)?$/i.test(url)) continue;
    seen.add(url);
    out.push({ kind: 'official_source', label: new URL(url).hostname, url, source: 'markdown_link' });
  }
  return out.slice(0, 6);
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
  const evidence = extractExternalLinks(input.blogHtml ?? '');

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
    cta_policy: 'bottom_soft',
    forbidden_claims: FORBIDDEN_CLAIMS,
    answer_first: typeof infoGuide.answer_first === 'string' ? infoGuide.answer_first : null,
    official_sources_required: Boolean(infoGuide.official_sources_required),
    risk_or_change_notes: asStringArray(contentBrief.source_requirements ?? contentBrief.sourceRequirements),
  };
}

function scoreInfoTask(markdown: string): number {
  const first = firstBodyParagraph(markdown);
  if (!first) return 0;
  let score = 45;
  if (first.length >= 70) score += 20;
  if (/(먼저|기준|확인|준비|주의|비용|가격|날씨|동선|필요|달라질 수|좋습니다|맞습니다|핵심|결론)/.test(first)) score += 25;
  if (!/^(안녕하세요|오늘은|이번\s*글에서는|여소남\s*에디터)/.test(first)) score += 10;
  const structuredEvidence =
    (markdown.match(/(^|\n)\s*\|.+\|/g) ?? []).length >= 3
    || (markdown.match(/(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g) ?? []).length >= 5;
  if (score < 80 && structuredEvidence && /(비용|일정|준비|체크|지역|호텔|동선|날씨|환전|입국)/.test(markdown)) {
    score = 80;
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
  const blockScore = required.filter((pattern) => pattern.test(markdown)).length / required.length * 70;
  const briefFields = [
    brief.included?.length,
    brief.excluded?.length,
    brief.fit_for?.length,
    brief.not_fit_for?.length,
    brief.risk_notes?.length,
    brief.consult_questions?.length,
  ].filter((count) => (count ?? 0) > 0).length;
  const first = firstBodyParagraph(markdown);
  const openingSignals = [
    /\d[\d,]*\s*원|만원|가격|출발가/.test(first),
    Boolean(brief.departure_city && first.includes(brief.departure_city)) || /출발/.test(first),
    Boolean(brief.duration && first.includes(brief.duration)) || /\d+\s*박\s*\d+\s*일|\d+\s*일/.test(first),
    /맞는|추천|고객|가족|부모님|단체|자유일정/.test(first),
  ].filter(Boolean).length;
  const openingScore = openingSignals >= 2 ? 10 : 0;
  return Math.round(blockScore + briefFields / 6 * 20 + openingScore);
}

function scoreNaturalness(markdown: string): number {
  const narrativeMarkdown = markdown
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
        return trimmed
          && !/^#{1,6}\s+/.test(trimmed)
          && !/^\s*(?:[-*]|\d+\.)\s+/.test(trimmed)
          && !/^\s*\|.*\|\s*$/.test(trimmed)
          && !/^\s*!\[[^\]]*]\([^)]+\)/.test(trimmed)
          && !/^\s*\[[^\]]+]\([^)]+\)\s*$/.test(trimmed)
          && !/^<\/?[a-z][^>]*>/i.test(trimmed);
    })
    .join('\n');
  const plain = stripMarkup(markdown).replace(/https?:\/\/\S+/gi, ' ');
  const narrativePlain = stripMarkup(narrativeMarkdown).replace(/https?:\/\/\S+/gi, ' ');
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
  score -= (markdown.match(/==[^=\n]{3,120}==|<mark\b/gi) ?? []).length * 25;
  score -= (narrativePlain.match(/안녕하세요|오늘은|이번 글에서는/g) ?? []).length * 8;
  const sentenceStarts = narrativePlain
    .split(/[.!?。！？\n]+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim().slice(0, 11))
    .filter((start) => start.length >= 8);
  const repeatedStarts = sentenceStarts.filter((start, index) => sentenceStarts.indexOf(start) !== index);
  score -= Math.min(24, repeatedStarts.length * 8);
  return Math.max(0, score);
}

function scoreCustomerLanguage(markdown: string): number {
  const plain = stripMarkup(markdown).replace(/https?:\/\/\S+/gi, ' ');
  let score = 100;
  const bannedPhrases = [
    /권해드립니다/g,
    /적합합니다/g,
    /추천(?:드립|합니|합니다|해요)/g,
    /가성비(?:가\s*좋|좋|추천|최고|끝판|혜택)/g,
    /합리적인\s*비용/g,
    /실속\s*있는\s*구성/g,
    /비용\s*부담\s*제로/g,
    /고객\s*만족도/g,
    /원활한\s*상담/g,
    /현명합니다/g,
    /특별한\s*(?:경험|추억)/g,
    /인생\s*사진/g,
    /풍성|알차|만끽|짜릿한|신비로운/g,
    /확인해\s*주시기\s*바랍니다/g,
    /상세\s*일정을\s*체크해\s*드릴게요/g,
  ];
  for (const pattern of bannedPhrases) {
    score -= Math.min(24, (plain.match(pattern) ?? []).length * 12);
  }
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((chunk) => stripMarkup(chunk).replace(/\s+/g, ' ').trim())
    .filter((chunk) => chunk.length >= 80 && !/^#{1,6}\s/.test(chunk));
  const overlongParagraphs = paragraphs.filter((chunk) => {
    const sentenceCount = (chunk.match(/[.!?。！？]/g) ?? []).length;
    return sentenceCount >= 4 || chunk.length >= 420;
  }).length;
  score -= Math.min(8, overlongParagraphs * 4);
  if (/상품표를\s*줄글|아래를\s*복사|자가점검|고정댓글/i.test(plain)) score -= 30;
  return Math.max(0, score);
}

function scoreDecisionClarity(markdown: string, brief: BlogEngineV2Brief, productDecisionScore: number): number {
  if (brief.writer_type === 'product_consultant_writer') {
    let score = productDecisionScore;
    const first = firstBodyParagraph(markdown);
    const openingSignals = [
      /\d[\d,]*\s*원|만원|가격|출발가|부터/.test(first),
      /출발/.test(first),
      /\d+\s*박\s*\d+\s*일|\d+\s*일|기간|일정/.test(first),
      /맞는|안\s*맞|조건|확인|변동/.test(first),
    ].filter(Boolean).length;
    if (openingSignals < 3) score -= 15;
    if (!/(선택지|차이|비교|라이트|품격|등급|4성|5성|노옵션|쇼핑|항공\s*시간)/.test(markdown)) {
      score -= 5;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  const first = firstBodyParagraph(markdown);
  let score = scoreInfoTask(markdown);
  if (first.length < 60 || !/(먼저|기준|결론|핵심|확인|나눠|보면|준비)/.test(first)) score -= 15;
  const hasJudgement =
    /(상황별|기준|비교|체크|주의|리스크|실수|공식\s*확인|최종\s*확인)/.test(markdown)
    || (markdown.match(/(^|\n)\s*\|.+\|/g) ?? []).length >= 3;
  if (!hasJudgement) score -= 15;
  if (brief.official_sources_required && !/(공식|외교부|기상|대사관|항공사|IATA|최신)/.test(markdown)) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreRiskDisclosure(markdown: string, brief: BlogEngineV2Brief): number {
  const plain = stripMarkup(markdown);
  if (brief.writer_type === 'product_consultant_writer') {
    let score = 100;
    if ((brief.excluded?.length ?? 0) === 0) score -= 25;
    if ((brief.risk_notes?.length ?? 0) === 0) score -= 25;
    const includesBriefItem = (items: string[] | undefined): boolean => {
      const usable = (items ?? [])
        .map((item) => item.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim())
        .filter((item) => item.length >= 2);
      if (usable.length === 0) return false;
      return usable.some((item) => {
        const tokens = item.split(/\s+/).filter((token) => token.length >= 2);
        if (plain.includes(item)) return true;
        return tokens.some((token) => plain.includes(token));
      });
    };
    if ((brief.excluded?.length ?? 0) > 0 && !includesBriefItem(brief.excluded)) score -= 25;
    if ((brief.risk_notes?.length ?? 0) > 0 && !includesBriefItem(brief.risk_notes)) score -= 25;
    if (!/(불포함|추가\s*비용|선택관광|쇼핑|가이드|기사|유류|싱글|써차지|계약금|패널티|조인|객실|좌석|달라질 수|변동|최종\s*확인)/.test(plain)) {
      score -= 30;
    }
    if (/(무조건|보장|확정입니다|마감\s*임박|잔여\s*좌석)/.test(plain)) score -= 20;
    return Math.max(0, score);
  }

  if (brief.official_sources_required || (brief.risk_or_change_notes?.length ?? 0) > 0) {
    let score = 100;
    if (!/(공식|최신|변동|달라질 수|다시\s*확인|확인하는\s*편이\s*안전|출발\s*전)/.test(plain)) score -= 30;
    if (brief.official_sources_required && brief.evidence_items.every((item) => item.kind !== 'official_source')) score -= 35;
    return Math.max(0, score);
  }
  return 100;
}

function scoreTemplateRepetition(markdown: string): number {
  let score = 100;
  const genericHeadings = markdown.match(/^##\s*(?:핵심\s*요약|상황별\s*선택\s*기준|읽는\s*순서|여행\s*준비를\s*위한\s*실전\s*팁|공식\s*확인\s*링크)\s*$/gm) ?? [];
  score -= Math.min(30, genericHeadings.length * 8);
  const h2s = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]?.trim()).filter(Boolean);
  const duplicatedH2s = h2s.filter((heading, index) => h2s.indexOf(heading) !== index);
  score -= Math.min(30, duplicatedH2s.length * 15);
  return Math.max(0, score);
}

function scoreSalesPressure(markdown: string, writer: BlogWriterType): number {
  const bodyWithoutBottomCta = markdown
    .replace(/\n##\s*여행\s*상품과\s*함께\s*확인하기[\s\S]*$/i, '')
    .replace(/\n---[\s\S]*$/i, '');
  const plain = stripMarkup(bodyWithoutBottomCta).replace(/https?:\/\/\S+/gi, ' ');
  const firstThird = plain.slice(0, Math.ceil(plain.length * 0.3));
  const koreanHardCta = /(?:\uC9C0\uAE08|\uBC14\uB85C)\s*\uC608\uC57D|\uC608\uC57D\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC0C1\uB2F4|\uBC14\uB85C|\uB9C8\uAC10)|\uC0C1\uB2F4\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC5F0\uACB0|\uBC14\uB85C)|\uBB38\uC758\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uC0C1\uB2F4|\uBC14\uB85C)|\uC0C1\uD488\s*\uBCF4\uAE30|\uD328\uD0A4\uC9C0\s*\uBCF4\uAE30|\uCE74\uCE74\uC624(?:\uD1A1)?\s*(?:\uC0C1\uB2F4|\uBB38\uC758)|\uC794\uC5EC\s*\uC88C\uC11D|\uB9C8\uAC10\s*\uC784\uBC15/i;
  const hardCta = /(지금\s*예약|바로\s*예약|예약\s*마감|잔여\s*좌석|상품\s*보기|패키지\s*보기|카카오|(?:상담|문의)\s*(?:하기|신청|남기기|바로|가능|예약|마감)|예약\s*(?:하기|문의|상담|신청|바로|마감|가능))/i;
  if (writer === 'info_writer' && (hardCta.test(firstThird) || koreanHardCta.test(firstThird))) return 35;
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

const METRIC_THRESHOLDS: BlogEngineEvaluation['metrics'] = {
  task_completion: BLOG_ENGINE_V2_PUBLISH_SCORE,
  naturalness: BLOG_ENGINE_V2_PUBLISH_SCORE,
  faithfulness: BLOG_ENGINE_V2_PUBLISH_SCORE,
  source_support: BLOG_ENGINE_V2_PUBLISH_SCORE,
  sales_pressure: BLOG_ENGINE_V2_PUBLISH_SCORE,
  product_decision_helpfulness: BLOG_ENGINE_V2_PUBLISH_SCORE,
  customer_language: 90,
  decision_clarity: 90,
  risk_disclosure: BLOG_ENGINE_V2_PUBLISH_SCORE,
  template_repetition: 90,
};

function chooseFailureBucket(metrics: BlogEngineEvaluation['metrics']): BlogEngineFailureBucket {
  const failingEntries = (Object.entries(metrics) as Array<[keyof typeof metrics, number]>)
    .filter(([metric, score]) => score < METRIC_THRESHOLDS[metric])
    .sort((a, b) => a[1] - b[1]);
  if (failingEntries.length === 0) return 'passed';
  const [lowestMetric] = failingEntries[0];
  if (metrics.source_support < METRIC_THRESHOLDS.source_support) return 'evidence_insufficient';
  if (
    metrics.product_decision_helpfulness < METRIC_THRESHOLDS.product_decision_helpfulness
    && metrics.product_decision_helpfulness <= metrics.task_completion
  ) {
    return 'product_decision_helpfulness';
  }
  if (lowestMetric === 'task_completion') return 'engine_task_incomplete';
  if (lowestMetric === 'naturalness') return 'ai_naturalness';
  if (lowestMetric === 'customer_language') return 'customer_language';
  if (lowestMetric === 'decision_clarity') return 'decision_clarity';
  if (lowestMetric === 'risk_disclosure') return 'risk_disclosure';
  if (lowestMetric === 'template_repetition') return 'template_repetition';
  if (lowestMetric === 'sales_pressure') return 'sales_pressure';
  if (lowestMetric === 'product_decision_helpfulness') return 'product_decision_helpfulness';
  return 'faithfulness';
}

function buildEvidencePack(brief: BlogEngineV2Brief): BlogEvidencePack {
  const officialSourceCount = brief.evidence_items.filter((item) => item.kind === 'official_source').length;
  const internalInsightCount = brief.evidence_items.filter((item) => item.kind === 'internal_insight').length;
  const productDbCount = brief.evidence_items.filter((item) => item.kind === 'product_db').length;
  const serpIntentCount = brief.evidence_items.filter((item) => item.kind === 'serp_intent').length;
  const missing: string[] = [];

  if (brief.writer_type === 'product_consultant_writer') {
    if (productDbCount === 0) missing.push('product_db');
  } else {
    if (officialSourceCount + internalInsightCount + serpIntentCount === 0) {
      missing.push('official_source_or_serp_intent_or_internal_insight');
    }
    if (brief.official_sources_required && officialSourceCount === 0) {
      missing.push('official_source');
    }
  }

  const sufficient = missing.length === 0;
  const score = sufficient
    ? 100
    : brief.writer_type === 'info_writer' && officialSourceCount + internalInsightCount + serpIntentCount > 0
      ? 70
      : 35;

  return {
    engine_version: BLOG_ENGINE_V2_VERSION,
    writer_type: brief.writer_type,
    items: brief.evidence_items,
    official_source_count: officialSourceCount,
    internal_insight_count: internalInsightCount,
    product_db_count: productDbCount,
    serp_intent_count: serpIntentCount,
    score,
    sufficient,
    missing,
  };
}

export function evaluateBlogEngineV2(input: BuildBriefInput): BlogEngineEvaluation {
  const blogHtml = input.blogHtml ?? '';
  const brief = buildBlogEngineV2Brief(input);
  const evidencePack = buildEvidencePack(brief);
  const productDecisionScore = scoreProductDecision(blogHtml, brief);

  const metrics = {
    task_completion: brief.writer_type === 'product_consultant_writer'
      ? productDecisionScore
      : scoreInfoTask(blogHtml),
    naturalness: scoreNaturalness(blogHtml),
    faithfulness: scoreFaithfulness(blogHtml, brief),
    source_support: evidencePack.score,
    sales_pressure: scoreSalesPressure(blogHtml, brief.writer_type),
    product_decision_helpfulness: brief.writer_type === 'product_consultant_writer'
      ? productDecisionScore
      : 100,
    customer_language: scoreCustomerLanguage(blogHtml),
    decision_clarity: scoreDecisionClarity(blogHtml, brief, productDecisionScore),
    risk_disclosure: scoreRiskDisclosure(blogHtml, brief),
    template_repetition: scoreTemplateRepetition(blogHtml),
  };
  const score = Math.round(Object.values(metrics).reduce((sum, value) => sum + value, 0) / Object.values(metrics).length);
  const failure_bucket = chooseFailureBucket(metrics);

  return {
    score,
    passed: score >= BLOG_ENGINE_V2_PUBLISH_SCORE && failure_bucket === 'passed',
    failure_bucket,
    metrics,
    repair_recommendation: failure_bucket === 'passed'
      ? null
      : failure_bucket === 'evidence_insufficient'
        ? '공식 링크, SERP intent, 내부 상담/상품DB 근거 중 최소 1개를 브리프에 추가하세요.'
        : failure_bucket === 'product_decision_helpfulness'
          ? '상품글을 10초 판단, 포함/불포함, 맞는 사람/안 맞는 사람, 가격 변동 조건, 문의 전 질문 구조로 재작성하세요.'
          : failure_bucket === 'customer_language'
            ? '고객이 쓰는 말로 바꾸고 추천/가성비/권유형 문구와 긴 문단을 줄이세요.'
            : failure_bucket === 'decision_clarity'
              ? '첫 문단과 섹션을 독자가 바로 결정할 수 있는 가격, 조건, 비교, 체크 기준 중심으로 재정리하세요.'
              : failure_bucket === 'risk_disclosure'
                ? '공식 확인 조건이나 불포함/추가비용/변동 가능성을 본문에 명확히 드러내세요.'
                : failure_bucket === 'template_repetition'
                  ? '반복되는 범용 제목과 같은 문장 시작을 줄이고 주제별 섹션명으로 바꾸세요.'
          : '도입 답변, CTA 위치, 과장 표현, 근거 없는 claim을 수리한 뒤 재평가하세요.',
    brief,
    evidence_pack: evidencePack,
    publish_threshold: BLOG_ENGINE_V2_PUBLISH_SCORE,
  };
}
