import {
  classifyBlogIntent,
  inspectBlogIntentQuality,
  type BlogInfoSubtype,
  type BlogIntentInput,
  type BlogIntentQualityReport,
} from './blog-content-intent';
import { stripMarkup } from './blog-text-utils';

export interface BlogEditorialRepairInput extends BlogIntentInput {
  blogHtml: string;
}

export interface BlogEditorialRepairResult {
  blogHtml: string;
  changed: boolean;
  changes: string[];
  before: BlogIntentQualityReport;
  after: BlogIntentQualityReport;
}

const OFFICIAL_REFERENCE_LINKS: Partial<Record<BlogInfoSubtype, string[]>> = {
  visa: [
    '- [외교부 해외안전여행](https://www.0404.go.kr/dev/main.mofa)',
    '- [대한민국 외교부](https://www.mofa.go.kr/www/index.do)',
  ],
  currency: [
    '- [한국은행 경제통계시스템](https://ecos.bok.or.kr/)',
    '- [외교부 해외안전여행](https://www.0404.go.kr/dev/main.mofa)',
  ],
  transport: [
    '- [인천국제공항](https://www.airport.kr/ap/ko/index.do)',
    '- [외교부 해외안전여행](https://www.0404.go.kr/dev/main.mofa)',
  ],
};

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

function hasExternalLink(markdown: string): boolean {
  return /\]\(https?:\/\/(?!www\.yeosonam\.com|yeosonam\.com)[^)]+\)/i.test(markdown);
}

function sanitizeInfoSalesTone(markdown: string): { text: string; changed: boolean } {
  let text = markdown;
  const before = text;
  const replacements: Array<[RegExp, string]> = [
    [/상품을\s*고른\s*이유/g, '이 정보를 정리한 이유'],
    [/이\s*상품/g, '이 여행 정보'],
    [/상품\s*상세/g, '상세 정보'],
    [/상품을\s*소개하는\s*것/g, '여행 정보를 정리하는 것'],
    [/출발가/g, '예상 비용'],
    [/특가/g, '가격 변동'],
    [/예약\s*마감/g, '확인 필요'],
    [/잔여\s*좌석/g, '가능 여부'],
    [/노팁|노쇼핑/g, '운영 조건'],
    [/포함\s*사항/g, '포함 정보'],
    [/불포함\s*사항/g, '별도 확인 정보'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return { text, changed: text !== before };
}

function appendOfficialReferences(markdown: string, subtype: BlogInfoSubtype | null): { text: string; changed: boolean } {
  if (!subtype || hasExternalLink(markdown)) return { text: markdown, changed: false };
  const links = OFFICIAL_REFERENCE_LINKS[subtype];
  if (!links?.length) return { text: markdown, changed: false };

  const block = [
    '',
    '## 공식 확인 링크',
    '',
    '입국, 환전, 이동 정보는 현지 정책과 운영 상황에 따라 바뀔 수 있습니다. 출발 전 아래 공식 경로로 한 번 더 확인해 주세요.',
    '',
    ...links,
    '',
  ].join('\n');

  return { text: `${markdown.trim()}\n${block}`, changed: true };
}

function ensureWeatherChecklistTable(markdown: string): { text: string; changed: boolean } {
  const tableRows = countMatches(markdown, /(^|\n)\s*\|.+\|/g);
  if (tableRows >= 4) return { text: markdown, changed: false };

  const table = [
    '',
    '## 월별 날씨 체크표',
    '',
    '| 구간 | 확인 포인트 | 옷차림 준비 |',
    '| --- | --- | --- |',
    '| 1~2월 | 기온과 바람 예보 확인 | 겉옷과 얇은 이너 |',
    '| 3~5월 | 일교차와 비 예보 확인 | 가벼운 겉옷, 편한 신발 |',
    '| 6~8월 | 우기·강수 가능성 확인 | 우산, 방수 가방, 통풍 옷 |',
    '| 9~10월 | 건기 전환과 체감 온도 확인 | 얇은 긴팔, 걷기 좋은 신발 |',
    '| 11~12월 | 계절 변화와 야간 기온 확인 | 겉옷, 보온 소품 |',
    '',
    '==정확한 기온은 출발 직전 예보가 기준입니다. 이 표는 월별로 무엇을 확인해야 하는지 정리한 준비 기준이에요.==',
    '',
  ].join('\n');

  const firstH2 = markdown.search(/\n##\s+/);
  if (firstH2 >= 0) {
    return {
      text: `${markdown.slice(0, firstH2)}${table}${markdown.slice(firstH2)}`,
      changed: true,
    };
  }

  return { text: `${markdown.trim()}\n${table}`, changed: true };
}

function ensurePreparationChecklist(markdown: string): { text: string; changed: boolean } {
  const listItems = countMatches(markdown, /(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g);
  if (listItems >= 5) return { text: markdown, changed: false };

  const block = [
    '',
    '## 빠른 체크리스트 보강',
    '',
    '- 여권 유효기간과 항공권 이름을 확인합니다.',
    '- 현지 결제용 카드와 소액 현금을 나눠 준비합니다.',
    '- 날씨에 맞는 겉옷, 우산, 편한 신발을 챙깁니다.',
    '- 유심, eSIM, 포켓와이파이 중 하나를 미리 정합니다.',
    '- 상비약, 충전기, 어댑터를 출발 전 한 번 더 확인합니다.',
    '',
  ].join('\n');

  return { text: `${markdown.trim()}\n${block}`, changed: true };
}

function ensureScannableInfoStructure(markdown: string, subtype: BlogInfoSubtype | null): { text: string; changed: boolean } {
  const listItems = countMatches(markdown, /(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g);
  const tableRows = countMatches(markdown, /(^|\n)\s*\|.+\|/g);
  if (listItems >= 3 || tableRows >= 3) return { text: markdown, changed: false };

  const label = subtype === 'transport'
    ? '이동/항공'
    : subtype === 'cost' || subtype === 'currency'
      ? '비용'
      : '여행 판단';

  const block = [
    '',
    `## ${label} 빠른 판단표`,
    '',
    '| 확인 항목 | 보면 좋은 기준 | 예약 전 체크 |',
    '| --- | --- | --- |',
    '| 일정 영향 | 이동 시간, 대기 시간, 현지 체류 시간 | 첫날과 마지막 날 일정은 여유 있게 잡습니다. |',
    '| 비용 영향 | 항공, 숙소, 현지 결제, 선택 관광 | 총액과 현장 추가 비용을 나누어 봅니다. |',
    '| 동행자 적합도 | 부모님, 아이, 초행자, 자유시간 선호 | 무리한 이동과 늦은 귀가 동선을 줄입니다. |',
    '',
  ].join('\n');

  return { text: `${markdown.trim()}\n${block}`, changed: true };
}

function ensureCostAnchorBlock(markdown: string, subtype: BlogInfoSubtype | null): { text: string; changed: boolean } {
  if (subtype !== 'cost' && subtype !== 'currency') return { text: markdown, changed: false };
  if (/##\s*비용 기준 다시 보기/.test(markdown)) {
    return { text: markdown, changed: false };
  }

  const block = [
    '',
    '## 비용 기준 다시 보기',
    '',
    '| 항목 | 대략적인 확인 범위 | 왜 봐야 하나요 |',
    '| --- | --- | --- |',
    '| 현지 교통 | 1회 이동비와 1일 교통비 1만원 단위 | 일정이 길수록 총액 차이가 커집니다. |',
    '| 식사/간식 | 1인 1끼 기준 예산 2만원 단위 | 가족 여행은 식비 변동이 큽니다. |',
    '| 선택 관광 | 1인 추가 비용 3만원 이상 여부 | 상품가와 별도 비용을 분리해 봅니다. |',
    '',
  ].join('\n');

  return { text: `${markdown.trim()}\n${block}`, changed: true };
}

function ensureItineraryStructure(markdown: string): { text: string; changed: boolean } {
  if (/^##\s*\uC77C\uC815\s*\uD750\uB984\s*\uBE60\uB978\s*\uBCF4\uAE30/m.test(markdown)) {
    return { text: markdown, changed: false };
  }
  const dayMarkers = countMatches(markdown, /(^|\n)\s*(?:#{2,4}\s*)?(?:DAY\s*\d+|Day\s*\d+|\d+\s*일차|\d+\s*일\s*차|\d+일차)/gi);
  const timeMarkers = countMatches(markdown, /\b(?:오전|오후|아침|점심|저녁|\d{1,2}:\d{2})\b/g);
  if (dayMarkers >= 2 || timeMarkers >= 3) return { text: markdown, changed: false };

  const block = [
    '',
    '## 일정 흐름 빠른 보기',
    '',
    '| 구간 | 추천 흐름 | 확인 포인트 |',
    '| --- | --- | --- |',
    '| 1일차 | 도착 후 숙소 이동과 주변 산책 | 늦은 도착이면 무리한 야간 일정을 피합니다. |',
    '| 2일차 | 핵심 명소와 이동 시간이 긴 코스 배치 | 차량 이동 시간과 휴식 시간을 같이 봅니다. |',
    '| 3일차 | 시장, 카페, 쇼핑처럼 가벼운 일정 | 귀국 전 짐 정리와 공항 이동 시간을 확보합니다. |',
    '',
    '이 일정표는 실제 항공 시간과 숙소 위치에 맞춰 조정해야 합니다.',
    '',
  ].join('\n');

  return { text: `${markdown.trim()}\n${block}`, changed: true };
}

function addReadingDesignAid(markdown: string): { text: string; changed: boolean } {
  const designAidCount =
    countMatches(markdown, /:::tip|:::warn|<aside\b|<mark\b/gi) +
    countMatches(markdown, /==[^=\n]{3,120}==/g);
  if (designAidCount >= 2) return { text: markdown, changed: false };

  const block = [
    '',
    '<aside class="blog-callout blog-callout-tip">',
    '<strong>읽는 순서</strong>',
    '<p>처음 읽는 분은 표와 체크리스트를 먼저 보고, 세부 설명은 필요한 부분만 골라 읽으면 됩니다.</p>',
    '</aside>',
    '',
  ].join('\n');
  return { text: `${markdown.trim()}\n${block}`, changed: true };
}

function splitLongParagraphs(markdown: string): { text: string; changed: boolean } {
  const paragraphs = markdown.split(/\n{2,}/);
  let changed = false;

  const next = paragraphs.map((paragraph) => {
    const trimmed = paragraph.trim();
    const plain = stripMarkup(trimmed).replace(/\s+/g, ' ').trim();
    if (
      plain.length < 520 ||
      /^#{1,6}\s/.test(trimmed) ||
      /^[-*]\s/.test(trimmed) ||
      /^\d+\.\s/.test(trimmed) ||
      /^\|/.test(trimmed) ||
      /^:::/m.test(trimmed) ||
      /^!\[/.test(trimmed)
    ) {
      return paragraph;
    }

    const sentences = trimmed
      .split(/(?<=[.!?。！？]|요\.|다\.|죠\.|니다\.)\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (sentences.length < 4) return paragraph;

    const chunks: string[] = [];
    let chunk = '';
    for (const sentence of sentences) {
      const candidate = chunk ? `${chunk} ${sentence}` : sentence;
      if (stripMarkup(candidate).length > 280 && chunk) {
        chunks.push(chunk);
        chunk = sentence;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) chunks.push(chunk);
    if (chunks.length <= 1) return paragraph;

    changed = true;
    return chunks.join('\n\n');
  });

  return { text: next.join('\n\n'), changed };
}

export function repairBlogEditorialQuality(input: BlogEditorialRepairInput): BlogEditorialRepairResult {
  const before = inspectBlogIntentQuality(input);
  const intent = classifyBlogIntent(input);
  const changes: string[] = [];
  let blogHtml = input.blogHtml;

  if (intent.mode === 'info') {
    const salesRepair = sanitizeInfoSalesTone(blogHtml);
    if (salesRepair.changed) {
      blogHtml = salesRepair.text;
      changes.push('sanitized_info_sales_tone');
    }
  }

  if (intent.infoSubtype === 'weather') {
    const tableRepair = ensureWeatherChecklistTable(blogHtml);
    if (tableRepair.changed) {
      blogHtml = tableRepair.text;
      changes.push('added_weather_check_table');
    }
  }

  if (intent.infoSubtype === 'preparation') {
    const checklistRepair = ensurePreparationChecklist(blogHtml);
    if (checklistRepair.changed) {
      blogHtml = checklistRepair.text;
      changes.push('added_preparation_checklist');
    }
  }

  if (intent.infoSubtype === 'itinerary') {
    const itineraryRepair = ensureItineraryStructure(blogHtml);
    if (itineraryRepair.changed) {
      blogHtml = itineraryRepair.text;
      changes.push('added_itinerary_structure');
    }
  }

  if (intent.infoSubtype) {
    const sourceRepair = appendOfficialReferences(blogHtml, intent.infoSubtype);
    if (sourceRepair.changed) {
      blogHtml = sourceRepair.text;
      changes.push('added_official_reference_links');
    }

    const costRepair = ensureCostAnchorBlock(blogHtml, intent.infoSubtype);
    if (costRepair.changed) {
      blogHtml = costRepair.text;
      changes.push('added_cost_anchor_block');
    }

    const scanRepair = ensureScannableInfoStructure(blogHtml, intent.infoSubtype);
    if (scanRepair.changed) {
      blogHtml = scanRepair.text;
      changes.push('added_scannable_info_table');
    }
  }

  const paragraphRepair = splitLongParagraphs(blogHtml);
  if (paragraphRepair.changed) {
    blogHtml = paragraphRepair.text;
    changes.push('split_long_paragraphs');
  }

  const designRepair = addReadingDesignAid(blogHtml);
  if (designRepair.changed) {
    blogHtml = designRepair.text;
    changes.push('added_reading_design_tip');
  }

  const after = inspectBlogIntentQuality({ ...input, blogHtml });

  return {
    blogHtml,
    changed: blogHtml !== input.blogHtml,
    changes,
    before,
    after,
  };
}
