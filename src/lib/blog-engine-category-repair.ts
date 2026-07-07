import {
  evaluateBlogEngineV2,
  type BlogEngineCategoryId,
} from './blog-engine-v2';
import { repairBlogEditorialQuality, repairBlogStructureQuality } from './blog-editorial-repair';
import { appendOfficialReferenceLinksIfNeeded, forceAppendOfficialReferenceLinks } from './blog-official-links';
import { stripMarkup } from './blog-text-utils';

export interface BlogEngineCategoryRepairInput {
  markdown: string;
  blogType: 'info' | 'product';
  title: string;
  slug: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  angleType?: string | null;
  category?: string | null;
  contentType?: string | null;
  productId?: string | null;
  generationMeta?: Record<string, unknown> | null;
}

export interface BlogEngineCategoryRepairResult {
  markdown: string;
  changed: boolean;
  changes: string[];
  beforeScore: number;
  afterScore: number;
  repairedCategories: BlogEngineCategoryId[];
}

function firstParagraph(markdown: string): string {
  for (const chunk of markdown.split(/\n{2,}/)) {
    const text = stripMarkup(chunk)
      .replace(/^#{1,6}\s+\S.*$/gm, '')
      .replace(/^\|.*\|$/gm, '')
      .replace(/^\s*(?:[-*]|\d+\.)\s+\S.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 25) return text;
  }
  return '';
}

function insertAnswerFirstIntro(input: BlogEngineCategoryRepairInput, markdown: string): string {
  const first = firstParagraph(markdown);
  if (first.length >= 95 && /(먼저|확인|비교|준비|비용|가격|날씨|동선|포함|불포함|일정)/.test(first)) {
    return markdown;
  }

  const lines = markdown.split('\n');
  let h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) {
    lines.unshift(`# ${input.title || input.primaryKeyword || input.destination || '여행 정보'}`, '');
    h1Index = 0;
  }

  const topic = input.primaryKeyword || input.destination || input.title || '이번 여행';
  const destination = input.destination || topic;
  const topicParticle = hasBatchim(topic) ? '은' : '는';
  const context = `${input.title || ''} ${input.primaryKeyword || ''} ${input.category || ''}`;
  const infoIntro = /아이|가족|일정|코스/.test(context)
    ? `${destination} 아이와 가족여행은 하루 코스를 많이 넣는 것보다 이동 시간, 숙소 위치, 낮잠·식사 시간을 먼저 맞추는 편이 좋습니다. 첫날은 이동과 휴식, 둘째 날 이후는 호핑투어·리조트·시내 일정을 나눠 잡으면 아이 컨디션을 지키기 쉽습니다.`
    : /예산|비용|식비|경비|쇼핑/.test(context)
      ? `${destination} 여행 예산은 항공·숙소 결제액과 현지 식비, 교통비, 선택 관광, 팁을 따로 봐야 실제 총액이 잡힙니다. 먼저 하루 비용 범위와 추가비 가능 항목을 나누면 과소예산을 줄일 수 있습니다.`
      : /날씨|옷차림|준비물|체크리스트|우기|건기/.test(context)
        ? `${topic}에서 핵심은 낮 기온만 보는 것이 아닙니다. ${destination} 여행은 아침·저녁 기온 차이, 비 예보, 이동 동선을 함께 보고 옷차림과 준비물을 나누는 편이 안전합니다.`
        : `${topic}${topicParticle} 먼저 핵심 조건을 나눠 보면 판단이 쉽습니다. 날씨·비용·이동·준비물처럼 바뀔 수 있는 항목은 출발일 기준으로 다시 확인하고, 표와 체크리스트로 필요한 부분만 빠르게 비교하세요.`;
  const intro = input.blogType === 'product'
    ? `${destination} 상품은 가격만 보지 말고 출발지, 기간, 포함/불포함, 맞는 고객을 함께 보면 문의 전에 판단이 쉬워집니다. 표시 금액과 조건은 출발일, 인원, 항공 좌석, 객실 가능 여부에 따라 달라질 수 있습니다.`
    : infoIntro;

  lines.splice(h1Index + 1, 0, '', intro, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function hasBatchim(value: string): boolean {
  const chars = Array.from(value.trim()).reverse();
  const lastHangul = chars.find((char) => {
    const code = char.charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3;
  });
  if (!lastHangul) return false;
  return ((lastHangul.charCodeAt(0) - 0xac00) % 28) > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    : [];
}

function firstOr(value: string[] | undefined, fallback: string): string {
  const first = value?.find((item) => item.trim().length > 0);
  return first || fallback;
}

function list(items: string[], fallback: string): string {
  const usable = items.slice(0, 5).filter(Boolean);
  return (usable.length > 0 ? usable : [fallback]).map((item) => `- ${item}`).join('\n');
}

function appendProductDecisionBlocks(input: BlogEngineCategoryRepairInput, markdown: string): string {
  if (input.blogType !== 'product') return markdown;
  const plain = stripMarkup(markdown);
  const meta = asRecord(input.generationMeta);
  const brief = asRecord(meta.product_consult_brief);
  const contentBrief = asRecord(meta.content_brief);
  const productBrief = asRecord(contentBrief.product);
  const destination = input.destination || String(productBrief.destination || input.primaryKeyword || '여행');
  const price = typeof brief.price_from === 'number'
    ? `${brief.price_from.toLocaleString()}원부터`
    : typeof productBrief.price_from === 'number'
      ? `${productBrief.price_from.toLocaleString()}원부터`
      : '출발일별 확인';
  const departure = String(brief.departure_city || productBrief.departure_city || '출발지 확인');
  const duration = String(brief.duration || productBrief.duration || '기간 확인');
  const included = asStringArray(brief.included ?? productBrief.included);
  const excluded = asStringArray(brief.excluded ?? productBrief.excluded);
  const fitFor = asStringArray(brief.fit_for ?? productBrief.fit_for);
  const notFitFor = asStringArray(brief.not_fit_for ?? productBrief.not_fit_for);
  const riskNotes = asStringArray(brief.risk_notes ?? productBrief.risk_notes);
  const consultQuestions = asStringArray(brief.consult_questions ?? productBrief.consult_questions);
  const blocks: string[] = [];

  if (!/10초\s*판단/.test(plain)) {
    blocks.push([
      '## 10초 판단',
      '',
      '| 확인 항목 | 현재 기준 | 문의 전 볼 점 |',
      '| --- | --- | --- |',
      `| 가격 | ${price} | 출발일, 좌석, 객실 조건에 따라 변동 가능 |`,
      `| 출발 | ${departure} | 항공 시간과 수하물 조건 확인 |`,
      `| 기간 | ${duration} | 이동일과 실제 현지 체류 시간 구분 |`,
      `| 맞는 고객 | ${firstOr(fitFor, `${destination} 상품을 조건별로 비교하려는 분`)} | 동행자 연령과 이동 강도 확인 |`,
    ].join('\n'));
  }

  if (!/^##\s*포함\s*\/?\s*불포함/m.test(markdown) && !/^##\s*포함\s*항목/m.test(markdown)) {
    blocks.push([
      '## 포함/불포함',
      '',
      '| 구분 | 항목 | 확인 포인트 |',
      '| --- | --- | --- |',
      `| 포함 | ${firstOr(included, '상품 상세 포함 항목 확인')} | 최종 일정표 기준 확인 |`,
      `| 포함 | ${included[1] || '항공/숙소/이동 포함 여부'} | 출발일별 적용 여부 확인 |`,
      `| 불포함 | ${firstOr(excluded, '개인경비와 선택 비용 확인')} | 현지 추가 결제 여부 확인 |`,
    ].join('\n'));
  }

  if (!/맞는\s*사람|맞는\s*분|맞는\s*고객/.test(plain) || !/안\s*맞는\s*사람|맞지\s*않는\s*분|맞지\s*않는\s*고객/.test(plain)) {
    blocks.push([
      '## 맞는 사람과 안 맞는 사람',
      '',
      '### 맞는 사람',
      '',
      list(fitFor, `${destination} 상품을 가격, 일정, 포함 항목 기준으로 비교하려는 분`),
      '',
      '### 안 맞는 사람',
      '',
      list(notFitFor, '숙소, 항공, 현지 일정을 모두 직접 조합하고 싶은 분'),
    ].join('\n'));
  }

  if (!/가격\s*변동\s*조건|가격(?:이|은)?\s*(?:바뀌|달라지|변동)/.test(plain)) {
    blocks.push([
      '## 가격 변동 조건',
      '',
      list(riskNotes, '항공 좌석, 객실 가능 여부, 유류할증료, 환율, 인원 조건에 따라 금액이 달라질 수 있습니다.'),
    ].join('\n'));
  }

  if (!/문의\s*전\s*질문/.test(plain)) {
    blocks.push([
      '## 문의 전 질문',
      '',
      list(consultQuestions, '희망 출발일, 인원, 객실 기준, 꼭 필요한 포함 항목을 먼저 정리했나요?'),
    ].join('\n'));
  }

  if (blocks.length === 0) return markdown;
  return `${markdown.trimEnd()}\n\n${blocks.join('\n\n')}`.replace(/\n{4,}/g, '\n\n\n');
}

function repairEvidenceSupport(markdown: string): string {
  const withConditionalLinks = appendOfficialReferenceLinksIfNeeded(markdown);
  if (/\[[^\]]+]\(https?:\/\/(?![^)]*yeosonam\.com)[^)\s]+/.test(withConditionalLinks)) {
    return withConditionalLinks;
  }
  return forceAppendOfficialReferenceLinks(withConditionalLinks);
}

function softenInfoSalesPressureSurface(input: BlogEngineCategoryRepairInput, markdown: string): string {
  if (input.blogType !== 'info') return markdown;
  const context = `${input.title || ''} ${input.primaryKeyword || ''} ${input.category || ''}`;
  const decisionParagraph = /아이|가족|일정|코스/.test(context)
    ? '출발 전에는 아이 컨디션, 숙소 위치, 차량 이동 시간, 쉬는 시간을 먼저 나누는 편이 안전합니다. 같은 4박 5일이라도 하루 이동량과 식사 시간이 맞지 않으면 체감 피로가 크게 달라질 수 있습니다.'
    : /예산|비용|식비|경비|쇼핑/.test(context)
      ? '출발 전에는 항공·숙소에 포함된 항목과 현지 식비, 교통비, 선택 관광 비용을 따로 보는 편이 안전합니다. 같은 예산처럼 보여도 여행 방식과 환율, 동선에 따라 실제 총액이 달라질 수 있습니다.'
      : '출발 전에는 일정, 이동 시간, 준비물, 현지 추가 비용을 따로 보는 편이 안전합니다. 같은 목적지라도 여행 시기와 동선에 따라 실제 준비 기준이 달라질 수 있습니다.';

  return markdown
    .replace(/예약 전 무엇을 먼저 확인해야 할까요\?/g, '출발 전 무엇을 먼저 확인해야 할까요?')
    .replace(/예약 전에는 총액, 이동 시간, 포함\/불포함을 따로 보는 편이 안전합니다\. 같은 가격처럼 보여도 출발일, 인원, 현지 추가비용에 따라 실제 부담이 달라질 수 있습니다\./g, decisionParagraph)
    .replace(/상품가와/g, '결제액과')
    .replace(/상품가/g, '결제액')
    .replace(/예상 비용은 1인당 [^.\n]+?상품이 활발하게 조회됩니다\./g, '예상 비용은 여행 방식과 포함 항목에 따라 달라지므로 항공·숙소 포함 여부와 현지 추가비를 나눠 확인하세요.')
    .replace(/이번 글에서는\s*/g, '')
    .replace(/오늘은\s*/g, '')
    .replace(/안녕하세요[.!?\s]*/g, '')
    .replace(/예약 전 비교/g, '출발 전 비교')
    .replace(/예약 전 추가 비용 여부/g, '현지 추가 비용 여부')
    .replace(/예약 전에는/g, '출발 전에는')
    .replace(/예약 전/g, '출발 전');
}

export function repairBlogEngineCategoryGaps(input: BlogEngineCategoryRepairInput): BlogEngineCategoryRepairResult {
  const beforeEvaluation = evaluateBlogEngineV2({
    blogHtml: input.markdown,
    primaryKeyword: input.primaryKeyword,
    destination: input.destination,
    contentType: input.contentType,
    productId: input.productId,
    generationMeta: input.generationMeta,
  });
  const weakCategories = beforeEvaluation.category_scores
    .filter((category) => category.score < 100 || !category.passed)
    .map((category) => category.id);
  const changes: string[] = [];
  let markdown = input.markdown;

  if (weakCategories.includes('reader_task_completion')) {
    const next = insertAnswerFirstIntro(input, markdown);
    if (next !== markdown) {
      markdown = next;
      changes.push('engine_category_reader_task_intro');
    }
  }

  if (weakCategories.includes('evidence_faithfulness')) {
    const next = repairEvidenceSupport(markdown);
    if (next !== markdown) {
      markdown = next;
      changes.push('engine_category_evidence_links');
    }
  }

  if (
    weakCategories.includes('sales_pressure_control')
    || weakCategories.includes('naturalness')
    || weakCategories.includes('reader_task_completion')
  ) {
    const next = softenInfoSalesPressureSurface(input, markdown);
    if (next !== markdown) {
      markdown = next;
      changes.push('engine_category_softened_info_sales_pressure');
    }
  }

  if (weakCategories.includes('product_decision_helpfulness')) {
    const next = appendProductDecisionBlocks(input, markdown);
    if (next !== markdown) {
      markdown = next;
      changes.push('engine_category_product_decision_blocks');
    }
  }

  if (
    weakCategories.includes('customer_language')
    || weakCategories.includes('naturalness')
    || weakCategories.includes('sales_pressure_control')
  ) {
    const editorialRepair = repairBlogEditorialQuality({
      title: input.title,
      slug: input.slug,
      primaryKeyword: input.primaryKeyword,
      destination: input.destination,
      angleType: input.angleType,
      category: input.category,
      contentType: input.contentType,
      productId: input.productId,
      blogHtml: markdown,
    });
    if (editorialRepair.changed) {
      markdown = editorialRepair.blogHtml;
      changes.push(...editorialRepair.changes.map((change) => `engine_category_${change}`));
    }
  }

  if (changes.length > 0) {
    const structureRepair = repairBlogStructureQuality({
      title: input.title,
      slug: input.slug,
      primaryKeyword: input.primaryKeyword,
      destination: input.destination,
      angleType: input.angleType,
      category: input.category,
      contentType: input.contentType,
      productId: input.productId,
      blogHtml: markdown,
    });
    if (structureRepair.changed) {
      markdown = structureRepair.blogHtml;
      changes.push(...structureRepair.changes.map((change) => `engine_category_${change}`));
    }
  }

  const afterEvaluation = evaluateBlogEngineV2({
    blogHtml: markdown,
    primaryKeyword: input.primaryKeyword,
    destination: input.destination,
    contentType: input.contentType,
    productId: input.productId,
    generationMeta: input.generationMeta,
  });

  return {
    markdown,
    changed: markdown !== input.markdown,
    changes,
    beforeScore: beforeEvaluation.score,
    afterScore: afterEvaluation.score,
    repairedCategories: weakCategories,
  };
}
