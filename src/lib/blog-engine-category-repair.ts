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
  repairRounds: number;
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

function deterministicVariantIndex(seed: string, size: number): number {
  if (size <= 1) return 0;
  let hash = 0;
  for (const char of seed) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash % size;
}

function pickVariant(seed: string, variants: string[]): string {
  return variants[deterministicVariantIndex(seed, variants.length)] ?? variants[0] ?? '';
}

function hasWeakAnswerFirstBoilerplate(text: string): boolean {
  return /기준으로\s*(?:보면|확인하면)\s*됩니다|(?:날씨|비용|예산|준비물|체크리스트)(?:은|는)\s*먼저|(?:날씨[,\s]*)?출발\s*\d+\s*일\s*전\s*무엇을\s*다시\s*봐야\s*할까요/.test(text);
}

function insertAnswerFirstIntro(input: BlogEngineCategoryRepairInput, markdown: string): string {
  const first = firstParagraph(markdown);
  if (
    first.length >= 95
    && !hasWeakAnswerFirstBoilerplate(first)
    && /(먼저|핵심|기준|확인|비교|준비|비용|가격|날씨|동선|포함|불포함|일정)/.test(first)
    && /\d|원|℃|박|일|시간|성수기|우기|건기|출발|현지|공식|~|–|-/.test(first)
  ) {
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
  const seed = `${input.slug || ''}|${input.title || ''}|${input.primaryKeyword || ''}|${destination || ''}`;
  const naturalInfoIntro = /(?:budget|cost|food|shopping|expense|money)|예산|비용|경비|식비|쇼핑/.test(context)
    ? pickVariant(seed, [
      `${destination} 예산은 상품가 1개만 보면 부족합니다. 항공·숙소 결제액과 현지 식비, 교통비, 선택 관광, 팁을 나눠 비교하면 실제 총액이 먼저 보입니다.`,
      `${destination} 비용은 1인 금액과 가족·동행자 전체 총액을 따로 비교해야 합니다. 현지 식비, 이동비, 선택 비용까지 분리하면 과소예산을 줄일 수 있습니다.`,
      `${destination} 여행비가 비슷해 보여도 포함 항목과 현지 추가비 3가지에 따라 체감 총액이 달라집니다. 예약 전에는 결제액, 현장 지출, 변동 가능 비용을 비교하세요.`,
      `${destination}에서 돈이 새는 지점은 보통 식사, 이동, 선택 관광, 팁 4가지입니다. 상품가와 현지 지출을 한 표로 비교하면 내 일정에 맞는 예산인지 빠르게 판단할 수 있습니다.`,
      `${destination} 경비는 항공권처럼 이미 낸 돈과 현지에서 다시 쓰는 돈 2가지를 나눠 봐야 합니다. 식비, 이동비, 선택 관광, 카드 수수료를 따로 적으면 실제 부담이 더 선명해집니다.`,
      `${destination} 예산을 잡을 때는 최저가보다 빠질 수 있는 항목 3가지를 먼저 확인하는 편이 안전합니다. 1인 금액, 가족 총액, 현지 추가비를 나누면 예약 후 당황할 가능성이 줄어듭니다.`,
      `${destination} 비용 비교는 표시 가격보다 포함/불포함 2가지를 먼저 보는 쪽이 정확합니다. 공항 이동, 식사, 선택 관광, 팁까지 더하면 같은 가격도 체감 총액이 달라질 수 있습니다.`,
      `${destination} 여행 경비는 출발 전 결제액과 현지 지출액을 따로 계산해야 합니다. 특히 가족 일정은 1인 기준보다 전체 인원 총액으로 보는 편이 실수 없습니다.`,
    ])
    : /(?:weather|packing|clothes|clothing|rain|july|june)|날씨|옷차림|준비물|체크리스트|우기|건기|비\s*예보|기온/.test(context)
      ? pickVariant(seed, [
        `${destination} 날씨는 낮 최고기온보다 일교차, 비 예보, 이동 동선을 함께 봐야 합니다. 출발 7일 전에는 겉옷·방수용품·자외선 차단 품목을 다시 확인하는 편이 좋습니다.`,
        `${destination} 옷차림은 한 벌을 두껍게 준비하기보다 얇은 옷과 겉옷을 나누는 방식이 안전합니다. 출발 7일 전 비 예보가 있으면 접는 우산, 우비, 잘 마르는 신발 3가지를 같이 보세요.`,
        `${destination} 준비물은 기온표만 보고 고르면 빠지는 게 생깁니다. 출발 24시간 전 아침·저녁 기온, 소나기 가능성, 차량 이동 시간을 기준으로 옷·상비약·전자기기를 나눠 챙기세요.`,
        `${destination} 여행 전에는 오늘 날씨보다 출발일 전후 예보가 더 중요합니다. 출발 7일 전과 24시간 전 비 예보, 체감온도, 실내외 이동 비중을 확인하면 현지 불편을 줄일 수 있습니다.`,
        `${destination} 날씨 글은 평균 기온만 보면 준비가 부족합니다. 낮 이동, 밤 일정, 비 오는 시간대를 나눠 보고 겉옷·우산·방수 파우치부터 먼저 챙기세요.`,
        `${destination} 옷차림은 낮 기온보다 하루 중 가장 불편할 순간을 기준으로 잡는 편이 좋습니다. 출발 7일 전에는 비 예보, 냉방 강도, 장거리 이동 시간을 함께 확인하세요.`,
        `${destination} 준비물은 더위나 추위 하나만 보고 정하면 빠뜨리기 쉽습니다. 출발 7일 전 예보와 24시간 전 항공·현지 안내를 다시 보고 옷, 약, 충전기, 방수용품을 나누세요.`,
        `${destination} 날씨는 여행 만족도보다 일정 운영에 더 직접적으로 영향을 줍니다. 비가 오면 바꿀 실내 일정, 젖어도 되는 신발, 여벌 옷을 먼저 정해 두는 편이 안전합니다.`,
      ])
      : null;
  const infoIntro = /보험|보장|병원|수하물|상해|질병|분실/.test(context)
    ? `${topic}${topicParticle} 출발 전 항공 지연, 병원 이용, 수하물 분실, 현지 결제 가능 범위를 먼저 나눠 보면 필요 여부를 판단하기 쉽습니다. 여행 기간, 동행자 나이, 기존 카드 보험, 목적지 의료비를 확인한 뒤 부족한 보장만 추가하세요.`
    : /로밍|유심|이심|eSIM|데이터|통신|전화/.test(context)
      ? `${topic}${topicParticle} 첫날 공항에서 1~2시간을 줄이려면 가격만 보지 말고 개통 방식, 데이터 용량, 통화 필요 여부, 현지 앱 인증 가능성을 함께 확인해야 합니다. 짧은 일정은 로밍, 장기·가족 일정은 유심이나 eSIM 비교가 유리한 경우가 많습니다.`
      : /비자|입국|서류|여권|세관|면세/.test(context)
        ? `${topic}${topicParticle} 출발 2주 전 무비자 가능 여부, 체류 가능 일수, 여권 6개월 기준, 항공사 요구 서류를 공식 안내로 다시 확인해야 합니다. 먼저 여권·항공권·숙소 정보·입국 신고 조건을 나누면 공항에서 빠뜨릴 항목을 줄일 수 있습니다.`
        : /공항|픽업|택시|렌터카|교통|이동|동선|로밍|유심|데이터/.test(context)
          ? `${topic}${topicParticle} 이동 시간과 결제 수단을 함께 봐야 첫날 1~2시간 손실을 줄일 수 있습니다. 공항 도착 시간, 숙소 위치, 현지 앱 사용 가능 여부, 비상 연락 수단을 먼저 확인하세요.`
          : /아이|가족|일정|코스/.test(context)
            ? `${destination} 아이와 가족여행은 하루 코스를 많이 넣기보다 이동 1회당 시간, 숙소 위치, 낮잠·식사 시간을 먼저 맞추는 편이 좋습니다. 첫날은 이동과 휴식, 둘째 날 이후는 투어·리조트·시내 일정을 나눠 잡으면 아이 컨디션을 지키기 쉽습니다.`
            : /예산|비용|식비|경비|쇼핑/.test(context)
              ? `${destination} 여행 예산은 항공·숙소 결제액과 현지 식비, 교통비, 선택 관광, 팁을 따로 봐야 실제 총액이 잡힙니다. 먼저 1인 비용과 가족 총액, 현지 추가비 가능 항목을 나누면 과소예산을 줄일 수 있습니다.`
              : /날씨|옷차림|준비물|체크리스트|우기|건기/.test(context)
                ? `${topic}에서 핵심은 낮 기온만 보는 것이 아닙니다. 출발 7일 전과 24시간 전 비 예보, 아침·저녁 기온 차이, 이동 동선을 함께 보고 옷차림과 준비물을 나누는 편이 안전합니다.`
                : `${topic}${topicParticle} 먼저 핵심 조건을 3가지로 나눠 보면 판단이 쉽습니다. 날씨·비용·이동·준비물처럼 바뀔 수 있는 항목은 출발일 기준으로 다시 확인하고, 표와 체크리스트로 필요한 부분만 빠르게 비교하세요.`;
  const intro = input.blogType === 'product'
    ? `${destination} 상품은 가격만 보지 말고 출발지, 기간, 포함/불포함, 맞는 고객을 함께 보면 문의 전에 판단이 쉬워집니다. 표시 금액과 조건은 출발일, 인원, 항공 좌석, 객실 가능 여부에 따라 달라질 수 있습니다.`
    : naturalInfoIntro ?? infoIntro;

  let bodyStart = h1Index + 1;
  while (bodyStart < lines.length && lines[bodyStart]?.trim() === '') bodyStart += 1;
  if (bodyStart < lines.length && !/^#{1,6}\s+\S/.test(lines[bodyStart]?.trim() ?? '')) {
    let bodyEnd = bodyStart + 1;
    while (bodyEnd < lines.length && lines[bodyEnd]?.trim() !== '') bodyEnd += 1;
    const existingLead = lines.slice(bodyStart, bodyEnd).join(' ').replace(/\s+/g, ' ').trim();
    if (/핵심\s*요약|가장\s*먼저\s*해결|먼저\s*핵심\s*조건/.test(existingLead) || hasWeakAnswerFirstBoilerplate(existingLead)) {
      lines.splice(bodyStart, bodyEnd - bodyStart, intro);
      return lines.join('\n').replace(/\n{3,}/g, '\n\n');
    }
  }

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
  const repairedCategorySet = new Set<BlogEngineCategoryId>();
  const changes: string[] = [];
  let markdown = input.markdown;
  let repairRounds = 0;

  if (hasWeakAnswerFirstBoilerplate(firstParagraph(markdown))) {
    const next = insertAnswerFirstIntro(input, markdown);
    if (next !== markdown) {
      markdown = next;
      changes.push('engine_category_reader_task_intro');
    }
  }

  for (let round = 1; round <= 3; round += 1) {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: markdown,
      primaryKeyword: input.primaryKeyword,
      destination: input.destination,
      contentType: input.contentType,
      productId: input.productId,
      generationMeta: input.generationMeta,
    });
    const weakCategories = evaluation.category_scores
      .filter((category) => category.score < 100 || !category.passed)
      .map((category) => category.id);

    if (evaluation.score === 100 && weakCategories.length === 0) break;

    const beforeRound = markdown;
    for (const category of weakCategories) repairedCategorySet.add(category);

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

    if (markdown !== beforeRound) {
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
      repairRounds = round;
      continue;
    }

    break;
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
    repairedCategories: Array.from(repairedCategorySet),
    repairRounds,
  };
}
