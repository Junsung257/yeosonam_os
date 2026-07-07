import { stripMarkup } from './blog-text-utils';

export type BlogCustomerQualityIssueSeverity = 'critical' | 'major';

export type BlogCustomerQualityIssueCode =
  | 'generic_answer_opening'
  | 'weak_answer_first'
  | 'product_price_suffix_duplicate'
  | 'product_consult_repetition'
  | 'product_specificity_weak'
  | 'placeholder_destination_copy'
  | 'unsupported_internal_data'
  | 'overbuilt_mechanical_structure'
  | 'early_sales_pressure'
  | 'table_render_risk';

export interface BlogCustomerQualityIssue {
  code: BlogCustomerQualityIssueCode;
  severity: BlogCustomerQualityIssueSeverity;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface BlogCustomerQualityReport {
  passed: boolean;
  score: number;
  issues: BlogCustomerQualityIssue[];
  metrics: {
    customer_language: number;
    answer_usefulness: number;
    product_decision_helpfulness: number;
    naturalness: number;
    trust_and_evidence: number;
  };
  summary: string;
}

export interface BlogCustomerQualityInput {
  blogHtml: string;
  blogType: 'info' | 'product';
  title?: string | null;
  primaryKeyword?: string | null;
  destination?: string | null;
  productId?: string | null;
  generationMeta?: Record<string, unknown> | null;
}

const GENERIC_INFO_OPENINGS = [
  /답부터\s*말하면[,，]?\s*20\d{2}년\s*\d{1,2}월\s*기준\s*[^.]{0,80}(?:비용|일정|준비\s*조건)을\s*함께\s*확인해야/i,
  /먼저\s*볼\s*것은\s*예산\s*범위,\s*이동\s*순서,\s*현지\s*확인\s*사항/i,
  /비용,\s*일정,\s*준비\s*조건을\s*함께\s*확인해야\s*안전합니다/i,
];

const CUSTOMER_PLACEHOLDERS = [
  /여행지\s*여행은/,
  /솔리아_스팟가격/,
  /이미지\s*준비\s*중/i,
  /상세\s*일차별\s*일정은\s*상담에서\s*확정본\s*기준으로\s*확인해야\s*합니다/,
];

const UNSUPPORTED_INTERNAL_DATA_RE =
  /여소남(?:의)?\s*(?:내부\s*)?(?:데이터|예약\s*데이터|상담\s*데이터)(?:로\s*보면|를\s*보면|에\s*따르면|상으로는)?/i;

function addIssue(
  issues: BlogCustomerQualityIssue[],
  code: BlogCustomerQualityIssueCode,
  severity: BlogCustomerQualityIssueSeverity,
  message: string,
  evidence?: Record<string, unknown>,
) {
  issues.push({ code, severity, message, evidence });
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function firstParagraph(markdown: string): string {
  for (const chunk of markdown.split(/\n{2,}/)) {
    const withoutHeadings = chunk
      .replace(/^#{1,6}\s+.*$/gm, '')
      .trim();
    if (!withoutHeadings) continue;
    const text = stripMarkup(withoutHeadings)
      .replace(/^\|.*\|$/gm, '')
      .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 25) return text;
  }
  return '';
}

function hasConcreteAnswer(text: string): boolean {
  return /(\d[\d,]*(?:원|만원|분|시간|일|박|도|℃|mm|%|벌|달러|USD)|먼저|기준|확인|비교|챙기|피하|나누|분리|정리|준비|비용|예산|총액|상품가|개인경비|추가비)/.test(text);
}

function metricFromIssues(
  issues: BlogCustomerQualityIssue[],
  codes: BlogCustomerQualityIssueCode[],
): number {
  let score = 100;
  for (const issue of issues) {
    if (!codes.includes(issue.code)) continue;
    score -= issue.severity === 'critical' ? 35 : 20;
  }
  return Math.max(0, score);
}

function inspectInfo(input: BlogCustomerQualityInput, plain: string, issues: BlogCustomerQualityIssue[]) {
  const first = firstParagraph(input.blogHtml);
  if (!hasConcreteAnswer(first) || first.length < 70) {
    addIssue(
      issues,
      'weak_answer_first',
      'critical',
      '정보성 글은 첫 문단에서 고객 질문에 바로 답해야 합니다.',
      { first: first.slice(0, 160), length: first.length },
    );
  }

  const genericOpening = GENERIC_INFO_OPENINGS.find((pattern) => pattern.test(first));
  if (genericOpening) {
    addIssue(
      issues,
      'generic_answer_opening',
      'major',
      '반복형 답변 도입부가 감지되었습니다. 검색어별로 고객 상황과 수치를 바꿔 써야 합니다.',
      { first: first.slice(0, 180) },
    );
  }

  const early = plain.slice(0, Math.max(300, Math.floor(plain.length * 0.3)));
  if (/(상품\s*보기|패키지\s*보기|카카오톡\s*상담|바로\s*예약|예약\s*문의)/.test(early)) {
    addIssue(
      issues,
      'early_sales_pressure',
      'critical',
      '정보성 글 상단에는 강한 상품/상담 CTA가 들어가면 안 됩니다.',
    );
  }
}

function inspectProduct(input: BlogCustomerQualityInput, plain: string, issues: BlogCustomerQualityIssue[]) {
  const duplicatePriceSuffix = plain.match(/\d[\d,]*원부터부터/g);
  if (duplicatePriceSuffix?.length) {
    addIssue(
      issues,
      'product_price_suffix_duplicate',
      'critical',
      '상품 가격 문장에 "부터부터" 같은 중복 표현이 있습니다.',
      { samples: duplicatePriceSuffix.slice(0, 3) },
    );
  }

  const consultRepeat = countMatches(plain, /상담에서\s*최종\s*확인/g);
  if (consultRepeat >= 4) {
    addIssue(
      issues,
      'product_consult_repetition',
      'major',
      '상품글이 구체 정보 대신 "상담에서 최종 확인"을 반복하고 있습니다.',
      { count: consultRepeat },
    );
  }

  const decisionSignals = [
    /10초\s*판단/,
    /포함\/불포함|포함\s*사항/,
    /맞는\s*사람/,
    /맞지\s*않을\s*수\s*있는\s*사람|안\s*맞는\s*사람/,
    /가격(?:이)?\s*달라질\s*수\s*있는\s*조건|가격\s*변동/,
    /문의\s*전\s*질문/,
  ];
  const presentSignals = decisionSignals.filter((pattern) => pattern.test(plain)).length;
  if (presentSignals < 5) {
    addIssue(
      issues,
      'product_specificity_weak',
      'critical',
      '상품글은 문의 전 판단에 필요한 블록을 충분히 갖춰야 합니다.',
      { presentSignals, requiredSignals: decisionSignals.length },
    );
  }

  const productBrief = input.generationMeta?.product_consult_brief as Record<string, unknown> | undefined;
  if (input.blogType === 'product' && input.productId && productBrief) {
    const evidenceFieldCount = ['included', 'excluded', 'fit_for', 'not_fit_for', 'risk_notes', 'consult_questions']
      .filter((key) => Array.isArray(productBrief[key]) && (productBrief[key] as unknown[]).length > 0)
      .length;
    if (evidenceFieldCount < 5) {
      addIssue(
        issues,
        'product_specificity_weak',
        'major',
        '상품 DB 기반 브리프가 상담 판단 필드를 충분히 채우지 못했습니다.',
        { evidenceFieldCount },
      );
    }
  }
}

function inspectCommon(input: BlogCustomerQualityInput, plain: string, issues: BlogCustomerQualityIssue[]) {
  const placeholder = CUSTOMER_PLACEHOLDERS.find((pattern) => pattern.test(plain));
  if (placeholder) {
    addIssue(
      issues,
      'placeholder_destination_copy',
      'critical',
      '고객에게 보이면 안 되는 placeholder/빈 템플릿 문구가 남아 있습니다.',
      { pattern: String(placeholder) },
    );
  }

  if (UNSUPPORTED_INTERNAL_DATA_RE.test(plain) && !/(집계\s*기준|표본|로그|기간|GSC|서치콘솔|예약\s*건수|상담\s*건수)/.test(plain)) {
    addIssue(
      issues,
      'unsupported_internal_data',
      'critical',
      '여소남 내부 데이터 표현은 집계 기준이 없으면 사용할 수 없습니다.',
    );
  }

  const h2Count = countMatches(input.blogHtml, /^##\s+\S/gm);
  const faqCount = countMatches(plain, /Q\d?\.|Q:|자주\s*묻는\s*질문/g);
  const summaryCount = countMatches(plain, /핵심\s*요약|한눈에\s*보는\s*요약/g);
  if (h2Count >= 10 && faqCount >= 4 && summaryCount >= 2) {
    addIssue(
      issues,
      'overbuilt_mechanical_structure',
      'major',
      'H2/요약/FAQ가 과하게 반복되어 자동 생성 템플릿처럼 보입니다.',
      { h2Count, faqCount, summaryCount },
    );
  }

  const lines = input.blogHtml.split('\n');
  const hasBrokenTableStart = lines.some((line, index) => {
    const currentIsTable = /^\s*\|.+\|\s*$/.test(line);
    if (!currentIsTable) return false;
    const previousIsTable = index > 0 && /^\s*\|.+\|\s*$/.test(lines[index - 1] ?? '');
    if (previousIsTable) return false;
    const next = lines[index + 1] ?? '';
    return !/^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(next);
  });
  const pseudoTableRowPattern = /^\s*[-*]\s*[^:：]{2,42}[:：]\s*.{4,}(?:\s+[\/／|]\s+.{2,}){1,}/;
  const pseudoTableListRows = lines.filter((line) => pseudoTableRowPattern.test(line)).length;
  const orphanNumericRows = lines.filter((line, index) =>
    /^\s*[\d,.]+(?:\s*(?:원|만원|달러|엔|위안|페소|바트))?(?:\s*[~–-]\s*[\d,.]+(?:\s*(?:원|만원|달러|엔|위안|페소|바트))?)?\s*$/.test(line.trim()) &&
    pseudoTableRowPattern.test(lines[index - 2] ?? '')
  ).length;
  if (hasBrokenTableStart || pseudoTableListRows >= 3 || orphanNumericRows > 0) {
    addIssue(
      issues,
      'table_render_risk',
      'critical',
      '마크다운 표 구분선이 부족해 상세 페이지에서 표가 깨질 수 있습니다.',
    );
  }
}

export function inspectBlogCustomerQuality(input: BlogCustomerQualityInput): BlogCustomerQualityReport {
  const plain = stripMarkup(input.blogHtml)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const issues: BlogCustomerQualityIssue[] = [];

  if (input.blogType === 'product') inspectProduct(input, plain, issues);
  else inspectInfo(input, plain, issues);
  inspectCommon(input, plain, issues);

  const metrics = {
    customer_language: metricFromIssues(issues, ['placeholder_destination_copy', 'product_price_suffix_duplicate']),
    answer_usefulness: metricFromIssues(issues, ['weak_answer_first', 'generic_answer_opening']),
    product_decision_helpfulness: input.blogType === 'product'
      ? metricFromIssues(issues, ['product_specificity_weak', 'product_consult_repetition'])
      : 100,
    naturalness: metricFromIssues(issues, ['generic_answer_opening', 'overbuilt_mechanical_structure', 'product_consult_repetition']),
    trust_and_evidence: metricFromIssues(issues, ['unsupported_internal_data', 'early_sales_pressure', 'table_render_risk']),
  };
  const score = Math.round(Object.values(metrics).reduce((sum, value) => sum + value, 0) / Object.values(metrics).length);
  const passed = issues.length === 0 && score >= 90;

  return {
    passed,
    score,
    issues,
    metrics,
    summary: passed
      ? 'Customer quality passed: answer, tone, trust, and decision usefulness are clean.'
      : `Customer quality ${score}/100: ${issues.map((issue) => issue.code).join(', ')}`,
  };
}
