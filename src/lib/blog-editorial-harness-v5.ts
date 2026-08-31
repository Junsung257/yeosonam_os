import { createHash } from 'node:crypto';
import {
  createBlogInformationClaimFingerprint,
  type BlogInformationClaimInput,
  type BlogInformationExtractedValue,
  type BlogInformationResearchBundle,
  type BlogInformationSourceInput,
} from './blog-information-evidence';
import type {
  BlogInformationClaimLedgerEntry,
  BlogInformationWriterOutput,
} from './blog-information-claim-ledger';

export const BLOG_EDITORIAL_HARNESS_VERSION = 'blog-editorial-harness-v5.0.0' as const;
export const BLOG_DECISION_ARTIFACT_VERSION = 'blog-decision-artifact-v1' as const;
export const BLOG_EDITORIAL_JUDGE_VERSION = 'blog-editorial-judge-v1' as const;

export type BlogPublicSourceLabel =
  | '정부·공공기관 원문'
  | '운영사 공식 안내'
  | '공식 관광 안내'
  | '가격 조사 자료'
  | '검토한 현지 자료'
  | '여소남 집계'
  | '확인한 원문';

export interface BlogDecisionPublicFactV1 {
  claimFingerprint: string;
  claimText: string;
  claimType: string;
  riskLevel: string;
  sourceUrls: string[];
  sourceLabels: BlogPublicSourceLabel[];
  citationLabel: string;
}

export interface BlogDecisionCalculationOperandV1 {
  claimFingerprint: string;
  label: string;
  amount: number;
  currency: string;
}

export interface BlogDecisionCalculationV1 {
  id: string;
  label: '절약형' | '일반형' | '여유형';
  formula: string;
  result: number;
  currency: string;
  assumptions: string[];
  operands: BlogDecisionCalculationOperandV1[];
  publicClaimText: string;
  publicClaimFingerprint: string;
}

export interface BlogFirstPartyInsightV1 {
  text: string;
  sampleSize: number;
  periodStart: string;
  periodEnd: string;
  sourceKey: string;
}

export interface BlogDecisionArtifactV1 {
  version: typeof BLOG_DECISION_ARTIFACT_VERSION;
  question: string;
  directAnswer: string;
  promiseType: 'daily_budget_scenarios' | 'price_examples' | 'route_decision' | 'direct_answer';
  originalTitle: string;
  resolvedTitle: string;
  publicFacts: BlogDecisionPublicFactV1[];
  calculations: BlogDecisionCalculationV1[];
  firstPartyInsights: BlogFirstPartyInsightV1[];
  gaps: string[];
}

export interface BlogEditorialDimensionV1 {
  passed: boolean;
  reason: string;
}

export interface BlogEditorialJudgeReportV1 {
  version: typeof BLOG_EDITORIAL_JUDGE_VERSION;
  passed: boolean;
  dimensions: {
    usefulness: BlogEditorialDimensionV1;
    naturalKorean: BlogEditorialDimensionV1;
    completeness: BlogEditorialDimensionV1;
    originality: BlogEditorialDimensionV1;
    sourceHonesty: BlogEditorialDimensionV1;
  };
  failureReasons: string[];
}

export interface BlogDeterministicEditorialReportV1 {
  version: typeof BLOG_EDITORIAL_HARNESS_VERSION;
  passed: boolean;
  failureReasons: string[];
  evidence: Record<string, unknown>;
}

export interface BlogEditorialHarnessReportV1 {
  version: typeof BLOG_EDITORIAL_HARNESS_VERSION;
  passed: boolean;
  deterministic: BlogDeterministicEditorialReportV1;
  semantic: BlogEditorialJudgeReportV1 | null;
  failureReasons: string[];
}

export interface BlogPromptTraceV1 {
  version: 'blog-prompt-trace-v1';
  templateVersion: string;
  gitCommitSha: string;
  renderedPromptHash: string;
  briefHash: string;
  claimPacketHash: string;
  model: string;
  temperature: number;
  stage: string;
}

type PriceFact = BlogDecisionPublicFactV1 & {
  amount: number;
  currency: string;
  shortLabel: string;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function hashBlogPromptTraceValueV1(value: unknown): string {
  return createHash('sha256').update(
    typeof value === 'string' ? value : stableJson(value),
  ).digest('hex');
}

export function buildBlogPromptTraceV1(input: {
  prompt: string;
  templateVersion: string;
  brief: unknown;
  claimPacket: unknown;
  model: string;
  temperature: number;
  stage: string;
  gitCommitSha?: string | null;
}): BlogPromptTraceV1 {
  return {
    version: 'blog-prompt-trace-v1',
    templateVersion: input.templateVersion,
    gitCommitSha: String(
      input.gitCommitSha
      || process.env.VERCEL_GIT_COMMIT_SHA
      || process.env.GIT_COMMIT_SHA
      || 'local-unknown',
    ).slice(0, 64),
    renderedPromptHash: hashBlogPromptTraceValueV1(input.prompt),
    briefHash: hashBlogPromptTraceValueV1(input.brief),
    claimPacketHash: hashBlogPromptTraceValueV1(input.claimPacket),
    model: input.model,
    temperature: input.temperature,
    stage: input.stage,
  };
}

export function resolveBlogPublicSourceLabelV1(
  source: Pick<BlogInformationSourceInput, 'sourceType' | 'authorityLevel'>,
): BlogPublicSourceLabel {
  if (source.authorityLevel === 'internal_reference' || source.sourceType === 'internal_reference') {
    return '여소남 집계';
  }
  if ([
    'government', 'embassy', 'immigration', 'customs', 'meteorological_agency',
    'regulator', 'central_bank', 'bank',
  ].includes(source.sourceType)) return '정부·공공기관 원문';
  if (source.sourceType === 'official_tourism') return '공식 관광 안내';
  if ([
    'airport', 'transport_operator', 'official_operator', 'insurer_policy',
  ].includes(source.sourceType)) return '운영사 공식 안내';
  if (source.sourceType === 'reputable_price_source') return '가격 조사 자료';
  if (['reputable_local_source', 'reputable_source'].includes(source.sourceType)) {
    return '검토한 현지 자료';
  }
  if (source.authorityLevel === 'official_primary' || source.authorityLevel === 'official_secondary') {
    return '확인한 원문';
  }
  return '확인한 원문';
}

function citationLabelForSources(sources: BlogInformationSourceInput[]): string {
  const labels = [...new Set(sources.map(resolveBlogPublicSourceLabelV1))];
  const publishers = [...new Set(sources.map((source) => source.publisher.trim()).filter(Boolean))];
  const label = labels[0] ?? '확인한 원문';
  return publishers[0] ? `${label} · ${publishers[0]}` : label;
}

function factsFromBundle(bundle: BlogInformationResearchBundle): BlogDecisionPublicFactV1[] {
  const evidenceByKey = new Map(bundle.evidence.map((evidence) => [evidence.evidenceKey, evidence]));
  const sourceByKey = new Map(bundle.sources.map((source) => [source.sourceKey, source]));
  return bundle.claims.map((claim) => {
    const sources = [...new Map(claim.evidenceKeys.flatMap((evidenceKey) => {
      const evidence = evidenceByKey.get(evidenceKey);
      const source = evidence ? sourceByKey.get(evidence.sourceKey) : null;
      return source ? [[source.sourceKey, source] as const] : [];
    })).values()];
    return {
      claimFingerprint: claim.claimFingerprint,
      claimText: claim.claimText,
      claimType: claim.claimType,
      riskLevel: claim.riskLevel,
      sourceUrls: [...new Set(sources.map((source) => source.sourceUrl).filter((url): url is string => Boolean(url)))],
      sourceLabels: [...new Set(sources.map(resolveBlogPublicSourceLabelV1))],
      citationLabel: citationLabelForSources(sources),
    };
  });
}

function validAggregateInsight(source: BlogInformationSourceInput): BlogFirstPartyInsightV1 | null {
  if (source.sourceType !== 'internal_reference' || source.authorityLevel !== 'internal_reference') return null;
  const metadata = source.metadata ?? {};
  const sampleSize = Number(metadata.sample_size ?? metadata.sampleSize ?? 0);
  const periodStart = String(metadata.period_start ?? metadata.periodStart ?? '');
  const periodEnd = String(metadata.period_end ?? metadata.periodEnd ?? '');
  const publicText = String(metadata.public_text ?? metadata.publicText ?? '').replace(/\s+/g, ' ').trim();
  if (sampleSize < 5 || !publicText || Number.isNaN(Date.parse(periodStart)) || Number.isNaN(Date.parse(periodEnd))) {
    return null;
  }
  return { text: publicText, sampleSize, periodStart, periodEnd, sourceKey: source.sourceKey };
}

function priceValue(claim: BlogInformationClaimInput): { amount: number; currency: string } | null {
  if (claim.claimType !== 'price') return null;
  const amount = Number(String(claim.extractedValue?.normalizedValue ?? '').replace(/,/g, ''));
  const currency = String(claim.extractedValue?.currency ?? '').toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  return { amount, currency };
}

function shortFoodLabel(text: string): string {
  const clean = text
    .replace(/\[[^\]]{1,80}\]\s*/g, '')
    .replace(/(?:확인일\s*기준|가격|금액|비용)(?:은|는|이|가)?/g, '')
    .replace(/(?:USD|KRW|JPY|VND|SGD|EUR|THB|달러|원|엔)\s*\$?\d[\d,.]*/gi, '')
    .replace(/\$\s*\d[\d,.]*/g, '')
    .replace(/\d[\d,.]*\s*(?:USD|KRW|JPY|VND|SGD|EUR|THB|달러|원|엔)/gi, '')
    .replace(/[.。]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, 36) || '확인된 식사 항목';
}

function findPriceFact(
  priceFacts: PriceFact[],
  pattern: RegExp,
  used: Set<string> = new Set(),
): PriceFact | null {
  return priceFacts
    .filter((fact) => !used.has(fact.claimFingerprint) && pattern.test(fact.claimText))
    .sort((left, right) => left.amount - right.amount)[0] ?? null;
}

function money(amount: number): string {
  return Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
}

function calculation(
  label: BlogDecisionCalculationV1['label'],
  operands: BlogDecisionCalculationOperandV1[],
): BlogDecisionCalculationV1 {
  const currency = operands[0]!.currency;
  const result = Number(operands.reduce((sum, operand) => sum + operand.amount, 0).toFixed(2));
  const formula = `${operands.map((operand) => money(operand.amount)).join(' + ')} = ${money(result)} ${currency}`;
  // Fingerprint the normalized table row text. The validator deliberately
  // strips the outer Markdown pipes before classifying table claims.
  const publicClaimText = `${label} | ${operands.map((operand) => operand.label).join(' + ')} | ${formula}`;
  return {
    id: `food-budget-${label === '절약형' ? 'save' : label === '일반형' ? 'standard' : 'comfort'}`,
    label,
    formula,
    result,
    currency,
    assumptions: ['1인 기준', '하루 세 끼와 커피 1잔', '세금·팁·주류 제외', '통계 평균이 아닌 확인 가격 조합'],
    operands,
    publicClaimText,
    publicClaimFingerprint: createBlogInformationClaimFingerprint(publicClaimText),
  };
}

function foodBudgetCalculations(
  bundle: BlogInformationResearchBundle,
  publicFacts: BlogDecisionPublicFactV1[],
): BlogDecisionCalculationV1[] {
  const factByFingerprint = new Map(publicFacts.map((fact) => [fact.claimFingerprint, fact]));
  const priceFacts: PriceFact[] = bundle.claims.flatMap((claim) => {
    const value = priceValue(claim);
    const fact = factByFingerprint.get(claim.claimFingerprint);
    return value && fact ? [{ ...fact, ...value, shortLabel: shortFoodLabel(claim.claimText) }] : [];
  });
  const currencies = new Set(priceFacts.map((fact) => fact.currency));
  if (currencies.size !== 1) return [];

  const coffee = findPriceFact(priceFacts, /커피|coffee|차\b|tea\b|음료|drink/i);
  const breakfast = findPriceFact(priceFacts, /아침|조식|breakfast|브런치|brunch/i);
  const fastFood = findPriceFact(priceFacts, /패스트푸드|맥도날드|버거|콤보|fast\s*food|mcdonald|burger|combo/i);
  const ordinary = findPriceFact(priceFacts, /저렴한\s*레스토랑|일반\s*레스토랑|inexpensive\s*restaurant|casual/i);
  const premium = priceFacts
    .filter((fact) => /뷔페|buffet|파인다이닝|fine\s*dining|스테이크|steak/i.test(fact.claimText))
    .filter((fact) => !/\b2\s*인|2\s*명|for\s*two|2\s*people/i.test(fact.claimText))
    .sort((left, right) => right.amount - left.amount)[0] ?? null;
  if (!coffee || !breakfast || !fastFood || !ordinary || !premium) return [];

  const operand = (fact: PriceFact): BlogDecisionCalculationOperandV1 => ({
    claimFingerprint: fact.claimFingerprint,
    label: fact.shortLabel,
    amount: fact.amount,
    currency: fact.currency,
  });
  return [
    calculation('절약형', [operand(breakfast), operand(fastFood), operand(ordinary), operand(coffee)]),
    calculation('일반형', [operand(breakfast), operand(ordinary), operand(ordinary), operand(coffee)]),
    calculation('여유형', [operand(breakfast), operand(ordinary), operand(premium), operand(coffee)]),
  ];
}

function destinationFromTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s*(?:여행\s*)?(?:식비|외식|예산).*$/u, '').trim();
}

function buildRouteDecisionAnswer(
  publicFacts: BlogDecisionPublicFactV1[],
  originalTitle: string,
): Pick<BlogDecisionArtifactV1, 'directAnswer' | 'gaps' | 'resolvedTitle'> {
  const joined = publicFacts.map((fact) => fact.claimText).join(' ');
  const hasGrta = /GRTA|Route\s*14|14번\s*노선/i.test(joined);
  const hasKakaoTaxi = /카카오\s*T\s*괌택시|Kakao\s*T.*Guam\s*Taxi/i.test(joined);
  const hasFare = publicFacts.some((fact) => fact.claimType === 'price'
    && /GRTA|승차|일일권|1일권|one\s*ride|day\s*pass/i.test(fact.claimText)
    && !/취소|변경|추가\s*인원/i.test(fact.claimText));
  const hasLuggage = /수하물|캐리어|luggage|baggage/i.test(joined);
  const hasFlightDelay = /항공\s*지연|비행편명|flight\s*(?:number|delay)/i.test(joined);
  const hasTaxiBaseFare = publicFacts.some((fact) => fact.claimType === 'price'
    && /괌.{0,30}택시|Guam.{0,30}Taxi/i.test(fact.claimText)
    && /기본|미터\s*요금|승차\s*요금|base\s*fare|flag\s*rate/i.test(fact.claimText));
  const hasDoorToDoorDuration = publicFacts.some((fact) => fact.claimType === 'duration'
    && /공항|GIAA|airport/i.test(fact.claimText)
    && /숙소|호텔|lodging|hotel/i.test(fact.claimText));
  const hasTaxiPickupLocation = publicFacts.some((fact) =>
    /택시\s*카운터|서쪽\s*도착\s*터미널|west\s*arrival|taxi\s*counter|curb/i.test(fact.claimText));
  const hasTransitToTumon = publicFacts.some((fact) =>
    /대중교통\s*노선[\s\S]{0,80}투몬\s*호텔|transit[\s\S]{0,80}tumon\s*hotel/i.test(fact.claimText));
  const hasExactBusBoardingLocation = publicFacts.some((fact) =>
    /GRTA|버스|대중교통|transit|bus/i.test(fact.claimText)
    && /승차\s*(?:장소|위치)|타는\s*곳|정류장|승강장|platform|stop/i.test(fact.claimText));

  const fullRouteDecision = hasGrta && hasKakaoTaxi && hasFare && hasTaxiBaseFare
    && hasTaxiPickupLocation && hasLuggage && hasFlightDelay && hasTransitToTumon;
  const directAnswer = fullRouteDecision
    ? '현지 미터택시는 서쪽 도착 터미널 건물 밖 카운터에서 확인할 수 있고, 표준요금은 기본 호출 2.40 USD·최초 1마일 4.00 USD·이후 0.25마일마다 0.80 USD입니다. GRTA는 일반 1회 1.50 USD, 1일권 4.00 USD이며 Route 14 첫차는 공항에서 5:55에 출발합니다.'
    : hasGrta && hasKakaoTaxi
      ? '대중교통 요금을 확인하려면 GRTA 항목을, 현지 택시 요금·공항 승차 위치와 카카오 T 괌택시의 수하물·항공 지연 대응을 확인하려면 택시 항목을 보면 됩니다.'
    : '대중교통과 택시에서 확인할 항목을 나누어 보면 됩니다.';
  const colonPrefix = originalTitle.split(':')[0]?.trim() || originalTitle.trim();
  const directionalPrefix = colonPrefix.match(/^(.+?\s*공항)(?:에서)?\s*(.+?)(?:까지)?\s*(?:교통(?:수단)?|이동(?:수단|방법)?)$/u);
  const titlePrefix = directionalPrefix
    ? `${directionalPrefix[1]} ${directionalPrefix[2]} 교통`.replace(/\s+/g, ' ').trim()
    : colonPrefix;
  const airportDestination = titlePrefix.match(/^(.+?)\s*공항/u)?.[1]?.trim();
  const conciseTitlePrefix = airportDestination && /택시|GRTA|요금/i.test(titlePrefix)
    ? `${airportDestination} 공항 교통`
    : titlePrefix;
  const resolvedTitle = fullRouteDecision
    ? `${conciseTitlePrefix}: 택시 위치·미터요금과 GRTA 요금 비교`
    : hasGrta && hasKakaoTaxi && hasFare && hasLuggage && hasFlightDelay
      ? `${titlePrefix}: GRTA 요금과 괌택시 수하물·지연 대응`
    : `${titlePrefix}: 공식 근거와 예약 전 확인 항목`;
  const gaps = [
    ...(!hasTaxiBaseFare ? ['택시 기본요금은 현재 승인된 근거에서 확인되지 않아 예약 화면에서 재확인 필요'] : []),
    ...(!hasDoorToDoorDuration ? ['공항에서 숙소까지의 실제 소요시간은 현재 승인된 근거에서 확인되지 않아 출발 전 재확인 필요'] : []),
    ...(!hasTaxiPickupLocation ? ['공항 택시 승차 위치는 현재 승인된 근거에서 확인되지 않아 공항 공식 채널에서 재확인 필요'] : []),
    ...(!hasExactBusBoardingLocation ? ['공항의 정확한 GRTA 승차 위치는 현재 승인된 근거에서 확인되지 않아 GRTA 공식 채널에서 재확인 필요'] : []),
  ];
  return { directAnswer, gaps, resolvedTitle };
}

export function buildBlogDecisionArtifactV1(input: {
  title: string;
  question: string;
  primaryDecision: string;
  intentType: string;
  bundle: BlogInformationResearchBundle;
}): BlogDecisionArtifactV1 {
  const publicFacts = factsFromBundle(input.bundle);
  const firstPartyInsights = input.bundle.sources.flatMap((source) => {
    const insight = validAggregateInsight(source);
    return insight ? [insight] : [];
  });
  const isFoodBudget = input.intentType === 'food_budget';
  const calculations = isFoodBudget ? foodBudgetCalculations(input.bundle, publicFacts) : [];
  if (isFoodBudget && calculations.length === 3) {
    return {
      version: BLOG_DECISION_ARTIFACT_VERSION,
      question: input.question,
      directAnswer: '확인된 메뉴 가격을 1인·하루 세 끼·커피 1잔 기준으로 조합해 절약형, 일반형, 여유형의 합계를 비교합니다.',
      promiseType: 'daily_budget_scenarios',
      originalTitle: input.title,
      resolvedTitle: input.title,
      publicFacts,
      calculations,
      firstPartyInsights,
      gaps: ['세금·팁·주류·실시간 메뉴 변경은 합계에서 제외'],
    };
  }
  if (isFoodBudget) {
    const destination = destinationFromTitle(input.title);
    return {
      version: BLOG_DECISION_ARTIFACT_VERSION,
      question: input.question,
      directAnswer: '현재 근거만으로는 하루 총식비를 책임 있게 계산할 수 없어, 확인된 메뉴 가격과 빠진 항목을 공개합니다.',
      promiseType: 'price_examples',
      originalTitle: input.title,
      resolvedTitle: `${destination ? `${destination} ` : ''}외식 메뉴 가격 예시: 하루 식비 계산 전 확인할 항목`,
      publicFacts,
      calculations: [],
      firstPartyInsights,
      gaps: ['아침·점심·저녁과 음료를 같은 1인 기준으로 조합할 근거 부족'],
    };
  }
  if (['airport_transport', 'local_transport'].includes(input.intentType)) {
    const routeDecision = buildRouteDecisionAnswer(publicFacts, input.title);
    return {
      version: BLOG_DECISION_ARTIFACT_VERSION,
      question: input.question,
      directAnswer: routeDecision.directAnswer,
      promiseType: 'route_decision',
      originalTitle: input.title,
      resolvedTitle: routeDecision.resolvedTitle,
      publicFacts,
      calculations: [],
      firstPartyInsights,
      gaps: routeDecision.gaps,
    };
  }
  return {
    version: BLOG_DECISION_ARTIFACT_VERSION,
    question: input.question,
    directAnswer: input.primaryDecision,
    promiseType: 'direct_answer',
    originalTitle: input.title,
    resolvedTitle: input.title,
    publicFacts,
    calculations: [],
    firstPartyInsights,
    gaps: [],
  };
}

export function restrictBlogDecisionArtifactFactsV1(
  artifact: BlogDecisionArtifactV1,
  approvedClaims: Array<Pick<BlogInformationClaimInput, 'claimText'>>,
): BlogDecisionArtifactV1 {
  const approvedTexts = new Set(approvedClaims.map((claim) => claim.claimText.normalize('NFKC').trim()));
  return {
    ...artifact,
    publicFacts: artifact.publicFacts.filter((fact) =>
      approvedTexts.has(fact.claimText.normalize('NFKC').trim())),
  };
}

function derivedExtractedValue(
  calculationRow: BlogDecisionCalculationV1,
): BlogInformationExtractedValue {
  return {
    normalizedValue: String(calculationRow.result),
    unit: '1인 하루',
    currency: calculationRow.currency,
    derivation: {
      version: 'blog-claim-derivation-v1',
      operation: 'sum',
      operandClaimFingerprints: calculationRow.operands.map((operand) => operand.claimFingerprint),
      operandValues: calculationRow.operands.map((operand) => String(operand.amount)),
      formula: calculationRow.formula,
      assumptions: calculationRow.assumptions,
    },
  };
}

export function withBlogDecisionArtifactClaimsV1(
  bundle: BlogInformationResearchBundle,
  artifact: BlogDecisionArtifactV1,
): BlogInformationResearchBundle {
  if (artifact.calculations.length === 0) return bundle;
  const claimByFingerprint = new Map(bundle.claims.map((claim) => [claim.claimFingerprint, claim]));
  const derivedClaims: BlogInformationClaimInput[] = artifact.calculations.map((row) => ({
    claimFingerprint: row.publicClaimFingerprint,
    claimText: row.publicClaimText,
    claimType: 'price',
    riskLevel: 'MEDIUM',
    extractedValue: derivedExtractedValue(row),
    requiresEvidence: true,
    evidenceKeys: [...new Set(row.operands.flatMap((operand) =>
      claimByFingerprint.get(operand.claimFingerprint)?.evidenceKeys ?? []))],
  }));
  return {
    ...bundle,
    claims: [...bundle.claims, ...derivedClaims.filter((claim) => !claimByFingerprint.has(claim.claimFingerprint))],
  };
}

export function buildBlogDecisionArtifactPromptBlockV1(artifact: BlogDecisionArtifactV1): string {
  return [
    '## Decision artifact — reader promise and calculation source of truth',
    `- Version: ${artifact.version}`,
    `- Exact public title: ${artifact.resolvedTitle}`,
    `- Reader question: ${artifact.question}`,
    `- Direct answer: ${artifact.directAnswer}`,
    `- Promise type: ${artifact.promiseType}`,
    '- Do not expose internal claim labels, source domains, prompt instructions, or audit terminology.',
    '- Cite a source with the supplied public citation label. Never call a price survey or community estimate an official source.',
    '- Public factual claims and honest citation labels:',
    ...artifact.publicFacts.flatMap((fact, index) => [
      `  ${index + 1}. ${fact.claimText}`,
      `     citation: [${fact.citationLabel}](${fact.sourceUrls[0] || ''})`,
    ]),
    ...(artifact.calculations.length > 0 ? [
      '- The deterministic publisher inserts the scenario table. Do not invent, repeat, paraphrase, or recalculate its totals.',
      ...artifact.calculations.map((row) => `  - ${row.label}: ${row.formula}; assumptions=${row.assumptions.join(', ')}`),
    ] : []),
    ...(artifact.gaps.length > 0 ? [
      '- Evidence gaps that must remain explicit:',
      ...artifact.gaps.map((gap) => `  - ${gap}`),
    ] : []),
    ...(artifact.firstPartyInsights.length > 0 ? [
      '- PII-free first-party aggregates (show sample and period whenever used):',
      ...artifact.firstPartyInsights.map((insight) =>
        `  - ${insight.text} (n=${insight.sampleSize}, ${insight.periodStart}~${insight.periodEnd})`),
    ] : []),
  ].join('\n');
}

function decisionTableMarkdown(artifact: BlogDecisionArtifactV1): string {
  if (artifact.calculations.length === 0) return '';
  return [
    '<!-- blog_decision_artifact:food_budget:v1 -->',
    '## 1인 하루 식비 시나리오',
    '',
    '공통 가정은 하루 세 끼와 커피 1잔이며, 세금·팁·주류는 제외했습니다. 통계적 평균이 아니라 아래에 인용한 확인 가격을 조합한 계산입니다.',
    '',
    '| 시나리오 | 포함 항목 | 계산식과 1인 하루 합계 |',
    '|---|---|---:|',
    ...artifact.calculations.map((row) => `| ${row.publicClaimText} |`),
    '<!-- /blog_decision_artifact:food_budget:v1 -->',
  ].join('\n');
}

const ROUTE_DECISION_BLOCK_START = '<!-- blog_decision_artifact:route_decision:v1 -->';
const ROUTE_DECISION_BLOCK_END = '<!-- /blog_decision_artifact:route_decision:v1 -->';

function routeDecisionFact(
  facts: BlogDecisionPublicFactV1[],
  pattern: RegExp,
  claimType?: string,
): BlogDecisionPublicFactV1 | null {
  return facts.find((fact) => (!claimType || fact.claimType === claimType) && pattern.test(fact.claimText)) ?? null;
}

function routeDecisionSourceLabel(url: string, fallback: string): string {
  if (/grta_bus_pass_sales_information_sheet/i.test(url)) return '공식 GRTA 요금표 원문';
  if (/master_-_fixed_route_schedule/i.test(url)) return '공식 GRTA Route 14 시간표 원문';
  if (/guamairport\.com/i.test(url)) return '괌 공항 교통 안내 원문';
  if (/visitguam\.com/i.test(url)) return '괌 관광청 교통 안내 원문';
  if (/kakaomobility\.com/i.test(url)) return '카카오 T 괌택시 FAQ 원문';
  return fallback;
}

function routeDecisionFactMarkdown(fact: BlogDecisionPublicFactV1): string {
  const url = fact.sourceUrls[0] ?? '';
  const citation = url ? ` [${routeDecisionSourceLabel(url, fact.citationLabel)}](${url})` : '';
  return `${fact.claimText}${citation}`;
}

function routeDecisionTableCell(facts: BlogDecisionPublicFactV1[]): string {
  return facts.map((fact) => fact.claimText).join('<br>').replace(/\|/g, '\\|');
}

function deterministicRouteDecisionArticle(
  artifact: BlogDecisionArtifactV1,
): { markdown: string; facts: BlogDecisionPublicFactV1[] } | null {
  const facts = artifact.publicFacts;
  const oneRide = routeDecisionFact(facts, /GRTA[\s\S]{0,80}(?:1회\s*탑승|One\s*Ride)[\s\S]{0,80}1\.50\s*USD/i, 'price');
  const oneDay = routeDecisionFact(facts, /GRTA[\s\S]{0,80}(?:1일권|One\s*Day)[\s\S]{0,80}4\.00\s*USD/i, 'price');
  const kmartDuration = routeDecisionFact(facts, /괌\s*공항[\s\S]{0,100}Kmart[\s\S]{0,40}5분/i, 'duration');
  const upperTumonDuration = routeDecisionFact(facts, /괌\s*공항[\s\S]{0,100}GTA\s*Upper\s*Tumon[\s\S]{0,40}8분/i, 'duration');
  const firstDeparture = routeDecisionFact(facts, /GRTA[\s\S]{0,80}괌\s*공항[\s\S]{0,50}첫차[\s\S]{0,40}5:55/i);
  const taxiMeter = routeDecisionFact(facts, /택시[\s\S]{0,80}(?:미터\s*요금|기본\s*호출)[\s\S]{0,80}2\.40\s*USD/i, 'price');
  const taxiPickup = routeDecisionFact(facts, /택시\s*카운터[\s\S]{0,100}서쪽\s*도착\s*터미널/i);
  const tumonTransit = routeDecisionFact(facts, /대중교통\s*노선[\s\S]{0,100}투몬\s*호텔/i);
  const luggage = routeDecisionFact(facts, /카카오\s*T\s*괌택시[\s\S]{0,100}(?:캐리어|수하물)/i);
  const delay = routeDecisionFact(facts, /카카오\s*T\s*괌택시[\s\S]{0,100}(?:항공\s*지연|비행편명)/i);
  const required = [
    oneRide, oneDay, kmartDuration, upperTumonDuration, firstDeparture,
    taxiMeter, taxiPickup, tumonTransit, luggage, delay,
  ];
  if (required.some((fact) => !fact)) return null;
  const selectedFacts = required as BlogDecisionPublicFactV1[];
  const gapLines = artifact.gaps.length > 0
    ? artifact.gaps.map((gap) => `- ${gap}`)
    : ['- 출발일의 최신 운행·요금 조건은 각 공식 링크에서 다시 확인하세요.'];
  const sourceLines = [...new Map(selectedFacts.flatMap((fact) => fact.sourceUrls.map((url) => [
    url,
    `- [${routeDecisionSourceLabel(url, fact.citationLabel)}](${url})`,
  ] as const))).values()];
  const fareFacts = [oneRide!, oneDay!];

  return {
    facts: selectedFacts,
    markdown: [
      ROUTE_DECISION_BLOCK_START,
      `# ${artifact.resolvedTitle}`,
      '',
      artifact.directAnswer,
      '',
      '공식 근거가 확인된 범위만 표에 넣었습니다. 택시의 실제 숙소 도착 시간과 공항의 정확한 GRTA 승차 위치처럼 확인되지 않은 항목은 별도로 표시합니다.',
      '',
      '## 교통수단별 공식 확인 결과',
      '',
      '### GRTA 요금',
      '',
      '| 수단 | 공식 요금 |',
      '| --- | --- |',
      `| GRTA Route 14 | ${routeDecisionTableCell(fareFacts)} |`,
      '',
      '### GRTA 첫 운행 기준',
      '',
      '| 구간 | 확인된 소요시간·운행 | 이용 조건 |',
      '| --- | --- | --- |',
      `| 공항→Kmart | ${routeDecisionTableCell([firstDeparture!, kmartDuration!])} | 정확한 공항 승차 위치는 출발 전에 재확인 |`,
      `| 공항→GTA Upper Tumon | 첫차 운행 기준<br>${routeDecisionTableCell([upperTumonDuration!])} | ${routeDecisionTableCell([tumonTransit!])} |`,
      '',
      '### 현지 미터택시',
      '',
      '| 수단 | 공식 요금 | 공항 승차 위치 |',
      '| --- | --- | --- |',
      `| 현지 미터택시 | ${routeDecisionTableCell([taxiMeter!])} | ${routeDecisionTableCell([taxiPickup!])} |`,
      '',
      '대중교통은 공식 시간표와 요금을 먼저 맞춰 보고, 택시는 미터요금·공항 카운터 위치·수하물 조건을 함께 확인하면 됩니다. 확인되지 않은 택시 소요시간을 임의로 예상값으로 바꾸지 않았습니다.',
      '',
      '## 수하물·항공 지연·늦은 도착 확인',
      '',
      `- ${routeDecisionFactMarkdown(luggage!)}`,
      `- ${routeDecisionFactMarkdown(delay!)}`,
      '- 늦은 도착편은 예약 화면에 비행편 정보를 정확히 입력하고, 최종 배차·탑승 안내를 다시 확인하세요.',
      '',
      '## 아직 공식 근거로 확정하지 못한 범위',
      '',
      ...gapLines,
      '',
      '## 출발 전에 확인할 순서',
      '',
      '1. GRTA를 이용한다면 공식 시간표에서 출발일 운행 여부와 공항 승차 위치를 확인합니다.',
      '2. 현지 미터택시를 이용한다면 공항 택시 카운터 위치와 현장 미터요금을 확인합니다.',
      '3. 예약 택시를 이용한다면 인원·수하물·비행편 정보를 입력한 뒤 최종 요금을 확인합니다.',
      '4. 숙소까지 실제 소요시간은 도착 시각과 교통 상황을 반영해 당일 다시 확인합니다.',
      '',
      '## 확인한 공식 원문',
      '',
      ...sourceLines,
      '',
      '괌의 다른 준비 정보는 [여소남 여행지 가이드](/destinations)에서 이어서 확인할 수 있습니다.',
      '',
      ROUTE_DECISION_BLOCK_END,
    ].join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

export function applyBlogDecisionArtifactToWriterOutputV1(input: {
  output: BlogInformationWriterOutput;
  artifact: BlogDecisionArtifactV1;
}): BlogInformationWriterOutput {
  if (!['daily_budget_scenarios', 'route_decision'].includes(input.artifact.promiseType)) return input.output;
  if (input.artifact.promiseType === 'route_decision') {
    const deterministic = deterministicRouteDecisionArticle(input.artifact);
    if (deterministic) {
      return {
        markdown: deterministic.markdown,
        claimLedger: deterministic.facts.map((fact) => ({
          claimFingerprint: fact.claimFingerprint,
          claimText: fact.claimText,
          claimType: fact.claimType as BlogInformationClaimLedgerEntry['claimType'],
          riskLevel: fact.riskLevel as BlogInformationClaimLedgerEntry['riskLevel'],
        })),
        ledgerIssues: [],
      };
    }
  }
  const lines = input.output.markdown.trim().split(/\r?\n/);
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const nextH2 = lines.findIndex((line, index) => index > h1Index && /^##\s+\S/.test(line.trim()));
  if (h1Index < 0) return {
    ...input.output,
    ledgerIssues: [...new Set([...input.output.ledgerIssues, 'decision_artifact_h1_missing'])],
  };
  const insertAt = nextH2 > h1Index ? nextH2 : h1Index + 1;
  const opening = input.artifact.directAnswer;
  const table = decisionTableMarkdown(input.artifact);
  const markdown = [
    ...lines.slice(0, h1Index + 1),
    '',
    opening,
    '',
    table,
    '',
    ...lines.slice(insertAt),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const derivedLedger: BlogInformationClaimLedgerEntry[] = input.artifact.calculations.map((row) => ({
    claimFingerprint: row.publicClaimFingerprint,
    claimText: row.publicClaimText,
    claimType: 'price',
    riskLevel: 'MEDIUM',
  }));
  return {
    markdown,
    claimLedger: [...new Map(
      [...input.output.claimLedger, ...derivedLedger].map((claim) => [claim.claimFingerprint, claim]),
    ).values()],
    ledgerIssues: input.output.ledgerIssues,
  };
}

const INTERNAL_LABEL_RE = /\[(?:절약형|일반형|여유형|간식|아침|점심|저녁|[A-Z_]{3,}|(?:price|factual|duration|medium|low|high)[/\]])[^\n]{0,80}\]/i;
const GENERIC_COMMAND_RE = /(?:확인|비교|결정|고르|선택)하세요/g;

export function inspectBlogEditorialDeterministicallyV1(input: {
  title: string;
  markdown: string;
  intentType: string;
  artifact?: BlogDecisionArtifactV1 | null;
}): BlogDeterministicEditorialReportV1 {
  const visible = input.markdown.replace(/<!--[\s\S]*?-->/g, ' ').trim();
  const openingWindow = visible.slice(0, 1_200);
  const failures: string[] = [];
  const internalLabelLeak = INTERNAL_LABEL_RE.test(visible);
  if (internalLabelLeak) failures.push('internal_label_leak');
  const sourceLabelMisleading = (visible.match(/\[(?:공식\s*근거|공식\s*자료)\]\(/g) ?? []).length >= 2
    && input.artifact?.publicFacts.some((fact) =>
      fact.sourceLabels.some((label) => ['가격 조사 자료', '검토한 현지 자료', '여소남 집계'].includes(label))) === true;
  if (sourceLabelMisleading) failures.push('source_label_misleading');

  const budgetPromise = input.intentType === 'food_budget'
    && /(?:하루|일일|여행\s*방식별).{0,20}(?:식비|예산)|(?:식비|예산).{0,20}(?:하루|시나리오)/i.test(input.title);
  const scenarioRows = (visible.match(/\|\s*(?:절약형|일반형|여유형)\s*\|/g) ?? []).length;
  const hasBudgetAmountEarly = /\d[\d,.]*(?:\s*[+~=~–-]\s*\d[\d,.]*)*\s*(?:USD|KRW|JPY|VND|SGD|EUR|THB|달러|원|엔)/i.test(openingWindow);
  if (budgetPromise && (!hasBudgetAmountEarly || scenarioRows < 3)) failures.push('reader_task_unanswered');

  const citations = (visible.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) ?? []).length;
  const genericCommands = (visible.match(GENERIC_COMMAND_RE) ?? []).length;
  const hasCalculation = /\d[\d,.]*\s*\+\s*\d[\d,.]*\s*=\s*\d[\d,.]*/.test(visible);
  if (input.intentType === 'food_budget' && citations >= 4 && genericCommands >= 5 && !hasCalculation) {
    failures.push('commodity_source_stitching');
  }
  if (input.artifact?.promiseType === 'daily_budget_scenarios'
    && !input.artifact.calculations.every((calculationRow) => visible.includes(calculationRow.publicClaimText))) {
    failures.push('decision_artifact_missing');
  }
  return {
    version: BLOG_EDITORIAL_HARNESS_VERSION,
    passed: failures.length === 0,
    failureReasons: [...new Set(failures)],
    evidence: {
      internalLabelLeak,
      sourceLabelMisleading,
      budgetPromise,
      scenarioRows,
      hasBudgetAmountEarly,
      citations,
      genericCommands,
      hasCalculation,
    },
  };
}

export function buildBlogEditorialJudgePromptV1(input: {
  title: string;
  primaryQuery: string;
  primaryDecision: string;
  markdown: string;
  artifact: BlogDecisionArtifactV1;
}): string {
  return [
    '당신은 여소남 자동발행의 독립 편집 심사자입니다. 작성자가 아니며 점수를 후하게 주면 안 됩니다.',
    '독자가 검색 질문에 실제 답을 얻는지, 자연스러운 한국어인지, 제목 약속을 끝까지 이행하는지, 출처를 정직하게 부르는지 판정하세요.',
    '각 차원은 반드시 passed=true 또는 false입니다. 평균 점수로 실패를 감추지 마세요. 한 차원이라도 false이면 전체 passed=false입니다.',
    '오직 아래 JSON 하나만 반환하세요. 설명이나 코드펜스를 붙이지 마세요.',
    '{"passed":false,"dimensions":{"usefulness":{"passed":false,"reason":"..."},"naturalKorean":{"passed":false,"reason":"..."},"completeness":{"passed":false,"reason":"..."},"originality":{"passed":false,"reason":"..."},"sourceHonesty":{"passed":false,"reason":"..."}},"failureReasons":["usefulness"]}',
    `제목: ${input.title}`,
    `검색 질문: ${input.primaryQuery}`,
    `독자 결정: ${input.primaryDecision}`,
    `결정 아티팩트: ${stableJson(input.artifact)}`,
    '평가할 본문:',
    input.markdown,
  ].join('\n\n');
}

export function parseBlogEditorialJudgeReportV1(raw: string): BlogEditorialJudgeReportV1 {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const dimensions = parsed.dimensions as Record<string, unknown> | undefined;
  const keys = ['usefulness', 'naturalKorean', 'completeness', 'originality', 'sourceHonesty'] as const;
  const normalized = Object.fromEntries(keys.map((key) => {
    const dimension = dimensions?.[key] as Record<string, unknown> | undefined;
    if (typeof dimension?.passed !== 'boolean' || typeof dimension.reason !== 'string' || !dimension.reason.trim()) {
      throw new Error(`blog_editorial_judge_invalid_dimension:${key}`);
    }
    return [key, { passed: dimension.passed, reason: dimension.reason.trim().slice(0, 500) }];
  })) as BlogEditorialJudgeReportV1['dimensions'];
  const failedKeys = keys.filter((key) => !normalized[key].passed);
  const declaredPassed = parsed.passed === true;
  if (declaredPassed !== (failedKeys.length === 0)) throw new Error('blog_editorial_judge_inconsistent_pass');
  return {
    version: BLOG_EDITORIAL_JUDGE_VERSION,
    passed: failedKeys.length === 0,
    dimensions: normalized,
    failureReasons: failedKeys,
  };
}

export function combineBlogEditorialHarnessV1(input: {
  deterministic: BlogDeterministicEditorialReportV1;
  semantic: BlogEditorialJudgeReportV1 | null;
}): BlogEditorialHarnessReportV1 {
  const semanticFailures = input.semantic?.failureReasons.map((reason) => `semantic_${reason}`)
    ?? ['semantic_judge_missing'];
  const failures = [
    ...input.deterministic.failureReasons.map((reason) => `deterministic_${reason}`),
    ...semanticFailures,
  ];
  return {
    version: BLOG_EDITORIAL_HARNESS_VERSION,
    passed: input.deterministic.passed && input.semantic?.passed === true,
    deterministic: input.deterministic,
    semantic: input.semantic,
    failureReasons: failures,
  };
}
