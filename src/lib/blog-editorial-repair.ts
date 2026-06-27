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

export interface BlogKeywordDensityRepairResult {
  blogHtml: string;
  changed: boolean;
  keyword: string | null;
  beforeCount: number;
  afterCount: number;
  allowedCount: number;
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

function removeRawDirectiveLeaks(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .replace(/^\s*:::\s*(?:[A-Za-z][\w-]*)?\s*$/gm, '')
    .replace(/:::\s*(?:[A-Za-z][\w-]*)?/g, '')
    .replace(/\n{3,}/g, '\n\n');

  return { text, changed: text !== before };
}

function removeRenderArtifacts(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .replace(/(?:^|[\s>])\$[0-9]+(?=[\s<.,!?]|$)/g, ' ')
    .replace(/\$\{[^}]+}/g, '')
    .replace(/\b(?:undefined|NaN|\[object Object\])\b/g, '')
    .replace(/null원/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  return { text, changed: text !== before };
}

export function normalizeBlogVisualAccents(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .replace(/==([^=\n]{1,500}?)==/g, '$1')
    .replace(/<\/?mark\b[^>]*>/gi, '')
    .replace(
      /<strong\b[^>]*\bclass=["'][^"']*\bnum\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/gi,
      '$1',
    )
    .replace(/\n{3,}/g, '\n\n');

  return { text, changed: text !== before };
}

function softenPromotionalInfoTone(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .replace(/완벽\s*가이드/g, '실전 가이드')
    .replace(/완벽\s*정리/g, '핵심 정리')
    .replace(/완벽\s*체크리스트/g, '실전 체크리스트')
    .replace(/꿀팁/g, '체크 포인트')
    .replace(/TOP\s*(\d+)/gi, '$1가지')
    .replace(/추천하는\s*이유/g, '확인해야 하는 이유')
    .replace(/놓치면\s*손해/g, '미리 확인');

  return { text, changed: text !== before };
}

function splitCollapsedChecklistItems(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  let changed = false;
  const next: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (!match) {
      next.push(line);
      continue;
    }

    const [, indent, marker, body] = match;
    if (body.length < 80 || !/\s\d{1,2}\.\s+\S/.test(body)) {
      next.push(line);
      continue;
    }

    const chunks = body
      .split(/(?=\s\d{1,2}\.\s+\S)/g)
      .map((chunk) => chunk.replace(/^\s*\d{1,2}\.\s*/, '').trim())
      .filter(Boolean);

    if (chunks.length < 2) {
      next.push(line);
      continue;
    }

    changed = true;
    for (const chunk of chunks) {
      next.push(`${indent}${marker.startsWith('-') || marker.startsWith('*') ? '-' : '-'} ${chunk}`);
    }
  }

  return { text: next.join('\n'), changed };
}

function hasChecklistIntent(markdown: string, input: BlogEditorialRepairInput): boolean {
  const haystack = [
    input.title,
    input.slug,
    input.primaryKeyword,
    input.category,
    input.contentType,
    markdown.slice(0, 2000),
  ].filter(Boolean).join(' ');

  return /checklist|packing|preparation|weather|budget|itinerary|visa|currency|transport|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uC900\uBE44\uBB3C|\uD544\uC218|\uB0A0\uC528|\uBE44\uC6A9|\uC608\uC0B0|\uC77C\uC815|\uBE44\uC790|\uC11C\uB958|\uD658\uC804|\uAD50\uD1B5/i.test(haystack);
}

function hasChecklistHeading(markdown: string): boolean {
  return /^#{2,3}\s+.*(?:checklist|packing\s+list|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uC900\uBE44\uBB3C|\uD544\uC218\s*\uC544\uC774\uD15C)/im.test(markdown);
}

function ensurePublishChecklist(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  if (!hasChecklistIntent(markdown, input) || hasChecklistHeading(markdown)) {
    return { text: markdown, changed: false };
  }

  const keyword = input.primaryKeyword || input.title || input.slug || '\uC5EC\uD589';
  const block = [
    '',
    '## \uC5EC\uD589 \uCCB4\uD06C\uB9AC\uC2A4\uD2B8',
    '',
    `- ${keyword} \uC77C\uC815\uC740 \uD56D\uACF5, \uC219\uC18C, \uC774\uB3D9 \uC2DC\uAC04\uC744 \uAC19\uC774 \uBE44\uAD50\uD569\uB2C8\uB2E4.`,
    '- \uC5EC\uAD8C, \uC785\uAD6D \uC11C\uB958, \uC608\uC57D \uBC88\uD638\uB97C \uCD9C\uBC1C \uC804\uC5D0 \uB2E4\uC2DC \uD655\uC778\uD569\uB2C8\uB2E4.',
    '- \uD604\uC9C0 \uB0A0\uC528, \uACB0\uC81C \uC218\uB2E8, \uD1B5\uC2E0 \uC900\uBE44\uB97C \uBAA9\uB85D\uC73C\uB85C \uBD84\uB9AC\uD569\uB2C8\uB2E4.',
    '- \uCDE8\uC18C \uADDC\uC815, \uCD94\uAC00 \uBE44\uC6A9, \uBE44\uC0C1 \uC5F0\uB77D\uCC98\uB294 \uB530\uB85C \uC800\uC7A5\uD569\uB2C8\uB2E4.',
    '',
  ].join('\n');

  const firstFaq = markdown.search(/^##\s*(FAQ|Q\s*&\s*A)/im);
  if (firstFaq > 0) {
    return {
      text: `${markdown.slice(0, firstFaq).trimEnd()}\n${block}${markdown.slice(firstFaq).trimStart()}`,
      changed: true,
    };
  }

  return { text: `${markdown.trimEnd()}\n${block}`, changed: true };
}

function splitOverlongHeadings(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  let changed = false;
  const next: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) {
      next.push(line);
      continue;
    }

    const [, level, headingText] = match;
    const plain = stripMarkup(headingText).replace(/\s+/g, ' ').trim();
    if (plain.length <= 90) {
      next.push(line);
      continue;
    }

    const bracket = plain.match(/^\[([^\]]{4,70})]\s+(.{20,})$/);
    if (bracket) {
      next.push(`${level} ${bracket[1].trim()}`);
      next.push('');
      next.push(bracket[2].trim());
      changed = true;
      continue;
    }

    const splitAt = Math.max(
      plain.lastIndexOf(' ', 78),
      plain.indexOf('. ') > 35 ? plain.indexOf('. ') + 1 : -1,
    );
    if (splitAt > 35 && splitAt < plain.length - 20) {
      next.push(`${level} ${plain.slice(0, splitAt).trim()}`);
      next.push('');
      next.push(plain.slice(splitAt).trim());
      changed = true;
      continue;
    }

    next.push(`${level} ${plain.slice(0, 86).trim()}`);
    next.push('');
    next.push(plain.slice(86).trim());
    changed = true;
  }

  return { text: next.join('\n'), changed };
}

function parseMarkdownTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.includes('|', 1)) return [];
  return trimmed
    .slice(1, trimmed.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = parseMarkdownTableCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function splitTableProseRows(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  const pendingProse: string[] = [];
  let changed = false;
  let inTable = false;

  const flushPending = () => {
    if (pendingProse.length === 0) return;
    if (next[next.length - 1]?.trim()) next.push('');
    next.push(...pendingProse);
    next.push('');
    pendingProse.length = 0;
  };

  for (const line of lines) {
    const cells = parseMarkdownTableCells(line);
    const isTableLine = cells.length >= 2;

    if (!isTableLine) {
      if (inTable) flushPending();
      inTable = false;
      next.push(line);
      continue;
    }

    inTable = true;
    if (isMarkdownTableSeparator(line)) {
      next.push(line);
      continue;
    }

    const firstCell = stripMarkup(cells[0] || '').replace(/\s+/g, ' ').trim();
    const emptyTrailingCells = cells.slice(1).every((cell) => stripMarkup(cell).trim().length === 0);
    const hasSentenceShape = /[.!?。！？]|\uB2E4\.|\uC694\.|\uB2C8\uB2E4/.test(firstCell);
    const startsLikeNote = /^(?:check\s*point|note|tip|key\s*point|[\uCCB4]\uD06C\s*\uD3EC\uC778\uD2B8)/i.test(firstCell);
    const looksLikeProseRow =
      cells.length >= 2 &&
      firstCell.length >= 45 &&
      hasSentenceShape &&
      (emptyTrailingCells || firstCell.length >= 95 || startsLikeNote);

    if (looksLikeProseRow) {
      pendingProse.push(firstCell);
      changed = true;
      continue;
    }

    next.push(line);
  }

  if (inTable) flushPending();

  return {
    text: next.join('\n').replace(/\n{4,}/g, '\n\n\n'),
    changed,
  };
}

function splitHtmlTableProseRows(markdown: string): { text: string; changed: boolean } {
  const extracted: string[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const text = markdown.replace(rowRe, (row, rowInner) => {
    const cells = [...String(rowInner).matchAll(cellRe)].map((match) =>
      stripMarkup(match[1] || '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length < 2) return row;

    const firstCell = cells[0] || '';
    const emptyTrailingCells = cells.slice(1).every((cell) => cell.length === 0);
    const hasSentenceShape = /[.!?。！？]|\uB2E4\.|\uC694\.|\uB2C8\uB2E4/.test(firstCell);
    const startsLikeNote = /^(?:check\s*point|note|tip|key\s*point|[\uCCB4]\uD06C\s*\uD3EC\uC778\uD2B8)/i.test(firstCell);
    if (firstCell.length < 45 || !hasSentenceShape || (!emptyTrailingCells && firstCell.length < 95 && !startsLikeNote)) {
      return row;
    }

    extracted.push(firstCell);
    return '';
  });

  if (extracted.length === 0) return { text: markdown, changed: false };

  const insert = `\n\n${extracted.join('\n\n')}\n`;
  const tableEnd = text.search(/<\/table>/i);
  if (tableEnd >= 0) {
    const endMatch = text.slice(tableEnd).match(/<\/table>/i);
    const endIndex = tableEnd + (endMatch?.[0].length ?? 8);
    return {
      text: `${text.slice(0, endIndex)}${insert}${text.slice(endIndex)}`.replace(/\n{4,}/g, '\n\n\n'),
      changed: true,
    };
  }

  return { text: `${text.trimEnd()}${insert}`, changed: true };
}

function ensureMarkdownTableBoundaries(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let changed = false;

  for (const line of lines) {
    const previous = next[next.length - 1] ?? '';
    const previousIsTable = parseMarkdownTableCells(previous).length >= 2;
    const currentIsTable = parseMarkdownTableCells(line).length >= 2;
    const currentIsContent = line.trim().length > 0;

    if (previousIsTable && currentIsContent && !currentIsTable) {
      next.push('');
      changed = true;
    }

    next.push(line);
  }

  return { text: next.join('\n').replace(/\n{4,}/g, '\n\n\n'), changed };
}

function markdownTableSeparatorFor(headerLine: string): string {
  const cellCount = Math.max(1, parseMarkdownTableCells(headerLine).length);
  return `| ${Array.from({ length: cellCount }, () => '---').join(' | ')} |`;
}

function markdownTableBlockToBullets(block: string[]): string[] {
  const header = parseMarkdownTableCells(block[0] ?? '');
  const hasSeparator = /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(block[1] ?? '');
  const rows = block.slice(hasSeparator ? 2 : 1)
    .map((line) => parseMarkdownTableCells(line))
    .filter((cells) => cells.length >= 2);

  if (rows.length === 0) return [header.join(' / ')];

  return rows.map((cells) => {
    const pairs = cells.map((cell, index) => {
      const label = header[index] || `Column ${index + 1}`;
      return `${label}: ${cell}`;
    });
    return `- ${pairs.join(' / ')}`;
  });
}

function repairLooseMarkdownTables(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const tableCells = parseMarkdownTableCells(lines[index] ?? '');
    if (tableCells.length < 2) {
      next.push(lines[index] ?? '');
      continue;
    }

    const block: string[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const current = lines[cursor] ?? '';
      if (parseMarkdownTableCells(current).length >= 2) {
        block.push(current.trim());
        cursor += 1;
        continue;
      }
      if (current.trim() === '') {
        let lookahead = cursor + 1;
        while (lookahead < lines.length && (lines[lookahead] ?? '').trim() === '') {
          lookahead += 1;
        }
        if (lookahead < lines.length && parseMarkdownTableCells(lines[lookahead] ?? '').length >= 2) {
          changed = true;
          cursor = lookahead;
          continue;
        }
      }
      break;
    }

    if (block.length === 1) {
      next.push(tableCells.join(' / '));
      changed = true;
    } else {
      const hasSeparator = /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(block[1] ?? '');
      const normalizedBlock = hasSeparator
        ? [block[0], block[1], ...block.slice(2)]
        : [block[0], markdownTableSeparatorFor(block[0]), ...block.slice(1)];
      if (!hasSeparator) changed = true;

      if (normalizedBlock.length < 5) {
        next.push(...markdownTableBlockToBullets(normalizedBlock));
        changed = true;
      } else {
        next.push(...normalizedBlock);
      }
    }

    index = cursor - 1;
  }

  return { text: next.join('\n').replace(/\n{4,}/g, '\n\n\n'), changed };
}

function capH2Headings(markdown: string, maxH2 = 9): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  let h2Count = 0;
  let changed = false;
  const next = lines.map((line) => {
    if (!/^##[ \t]+\S/.test(line) || /^###[ \t]+/.test(line)) return line;
    h2Count += 1;
    if (h2Count <= maxH2) return line;
    changed = true;
    return line.replace(/^##[ \t]+/, '### ');
  });

  return { text: next.join('\n'), changed };
}

function dedupeRepeatedHeadings(markdown: string, maxRepeats = 2): { text: string; changed: boolean } {
  const seen = new Map<string, number>();
  let changed = false;
  const lines = markdown.split('\n');
  const next = lines.filter((line) => {
    const match = line.match(/^(#{2,3})[ \t]+(.+)$/);
    if (!match) return true;
    const key = stripMarkup(match[2] || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) return true;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count <= maxRepeats) return true;
    changed = true;
    return false;
  });

  return { text: next.join('\n').replace(/\n{4,}/g, '\n\n\n'), changed };
}

function repairBlankHeadingLines(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!/^#{2,3}\s*$/.test(line)) {
      next.push(line);
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && (lines[cursor] ?? '').trim() === '') cursor += 1;
    const headingText = (lines[cursor] ?? '').trim();
    if (/^\d{1,2}\.\s+\S/.test(headingText)) {
      next.push(`### ${headingText}`);
      index = cursor;
    }
    changed = true;
  }

  return { text: next.join('\n').replace(/\n{4,}/g, '\n\n\n'), changed };
}

function dedupeRepeatedSupportBlocks(markdown: string): { text: string; changed: boolean } {
  const blocks = markdown.split(/\n{2,}/);
  const seen = new Set<string>();
  let changed = false;

  const next = blocks.filter((block) => {
    const trimmed = block.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^\|/.test(trimmed)) return true;
    const plain = stripMarkup(trimmed).replace(/\s+/g, ' ').trim();
    if (plain.length < 35 || plain.length > 260) return true;

    const isSupportBlock =
      /^[-*]\s+/.test(trimmed) ||
      /월별 기온|성수기 혼잡도|예약 타이밍|출발 직전|현지 결제|추가 비용|취소 조건/.test(plain);
    if (!isSupportBlock) return true;

    const repeatedWeatherPhrase = plain.match(/월별 기온, 우기, 성수기 혼잡도를[^.。!?]+/);
    const repeatedPlanningPhrase = plain.match(/비용, 이동 시간, 현지 결제[^.。!?]+/);
    const key = (repeatedWeatherPhrase?.[0] || repeatedPlanningPhrase?.[0] || plain).toLowerCase();
    if (seen.has(key)) {
      changed = true;
      return false;
    }
    seen.add(key);
    return true;
  });

  return { text: next.join('\n\n'), changed };
}

function softenRepeatedLongtailBulletPrefixes(markdown: string): { text: string; changed: boolean } {
  const prefixCounts = new Map<string, number>();
  let changed = false;
  const text = markdown.replace(
    /^([-*][ \t]+)([^:\n]{8,80})[ \t]+(일정|비용|준비물|예약|날씨|사용법|비교|속도):/gm,
    (match, marker: string, prefix: string, topic: string) => {
      const key = prefix.replace(/\s+/g, ' ').trim();
      const count = (prefixCounts.get(key) || 0) + 1;
      prefixCounts.set(key, count);
      if (count <= 3) return match;
      changed = true;
      return `${marker}${topic}:`;
    },
  );

  return { text, changed };
}

function flattenMalformedInlineTables(markdown: string): { text: string; changed: boolean } {
  const blocks = markdown.split(/\n{2,}/);
  let changed = false;
  const next = blocks.map((block) => {
    if (!/\|:?-{2,}|:?-{2,}\s*\|/.test(block)) return block;
    const tableLineCount = block
      .split('\n')
      .filter((line) => parseMarkdownTableCells(line).length >= 2).length;
    if (tableLineCount >= 2) return block;

    changed = true;
    return block
      .replace(/\s*\|?\s*:?-{2,}:?(?:\s*\|\s*:?-{2,}:?)+\s*\|?/g, ' ')
      .replace(/\s*\|\s*/g, ' / ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  });

  return { text: next.join('\n\n'), changed };
}

function limitRepeatedPlanningHooks(markdown: string): { text: string; changed: boolean } {
  let definitionCount = 0;
  let planningCount = 0;
  let questionBlockCount = 0;
  let questionHeadingCount = 0;
  const text = markdown
    .replace(
      /\n{0,2}##[ \t]+[^\n]{0,80}에서 가장 먼저 확인할 것은\?[ \t]*\n\s*\n1\.[ \t]*현지 결제 가능 수단\s*\n2\.[ \t]*공항·호텔 이동 시간\s*\n3\.[ \t]*예약 전 추가 비용 여부\s*/g,
      (match) => {
        questionBlockCount += 1;
        return questionBlockCount <= 1 ? match : '\n';
      },
    )
    .replace(/^#{2,3}[ \t]+[^\n]{0,80}에서 가장 먼저 확인할 것은\?[ \t]*$/gm, (match) => {
      questionHeadingCount += 1;
      return questionHeadingCount <= 2 ? match : '';
    })
    .replace(
      /[^\n.。!?]{1,80}에서 가장 먼저 확인할 것은 무엇일까요\?\s*여행 전 비용, 이동 시간, 현지 결제 조건을 비교하면 현지에서 낭비되는 1~2시간을 줄일 수 있습니다\./g,
      (match) => {
        definitionCount += 1;
        return definitionCount <= 2 ? match : '';
      },
    )
    .replace(
      /[^\n.。!?]{0,50}비용, 이동 시간, 현지 결제 조건을 비교하면 현지에서 낭비되는 1~2시간을 줄일 수 있습니다\./g,
      (match) => {
        planningCount += 1;
        return planningCount <= 2 ? match : '';
      },
    )
    .replace(/\n{4,}/g, '\n\n\n');

  return { text, changed: text !== markdown };
}

function ensureMinimumReadingStructure(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  let text = markdown;
  const before = text;
  const h2Count = countMatches(text, /^##\s+\S/gm);
  const listItems = countMatches(text, /(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g);
  const tableRows = countMatches(text, /(^|\n)\s*\|.+\|/g);
  const designAidCount =
    countMatches(text, /:::tip|:::warn|<aside\b|<mark\b/gi) +
    countMatches(text, /==[^=\n]{3,120}==/g);
  const plain = stripMarkup(text);
  const numericFacts = countMatches(plain, /\d[\d,]*(?:\s*(?:%|km|m|day|days|hour|hours|min|minutes|won|usd|vnd))?/gi);

  const keyword = input.primaryKeyword || input.title || input.slug || 'travel';
  const blocks: string[] = [];

  if (h2Count < 4) {
    blocks.push(
      '',
      '## 핵심 요약',
      '',
      `- ${keyword} 일정은 출발 7일 전, 3일 전, 전날 기준으로 나눠 확인합니다.`,
      '- 항공, 숙소, 이동, 현지 결제 조건을 한 번에 보지 말고 항목별로 분리합니다.',
      '- 가족 여행은 이동 시간 30분 차이도 체감 피로가 커질 수 있습니다.',
    );
  }

  if (listItems < 3 && tableRows < 3) {
    blocks.push(
      '',
      '## 빠른 체크리스트',
      '',
      '- 여권 유효기간과 항공권 영문 이름을 확인합니다.',
      '- 숙소 위치와 공항 이동 시간을 지도 기준으로 다시 봅니다.',
      '- 현지 결제 카드, 소액 현금, 비상 연락처를 분리해 준비합니다.',
      '- 비 예보가 있으면 우산보다 방수 가방과 여분 양말을 먼저 챙깁니다.',
      '',
      '## 비교 표',
      '',
      '| 확인 항목 | 권장 기준 | 놓치기 쉬운 점 |',
      '| --- | --- | --- |',
      '| 이동 | 1회 이동 60분 안팎 | 아이 동반이면 대기 시간이 더 크게 느껴집니다. |',
      '| 비용 | 총액과 현장 추가비 분리 | 선택 관광, 팁, 교통비를 따로 봅니다. |',
      '| 일정 | 오전 1개, 오후 1~2개 핵심 동선 | 더운 지역은 낮 시간 휴식이 필요합니다. |',
    );
  }

  if (tableRows < 3 && listItems >= 3) {
    blocks.push(
      '',
      '## 판단 기준 빠른 비교',
      '',
      '| 확인 항목 | 고객이 볼 기준 | 결정 포인트 |',
      '| --- | --- | --- |',
      '| 일정 | 이동 시간과 쉬는 시간이 무리 없는지 | 첫날과 마지막 날은 여유를 둡니다. |',
      '| 비용 | 기본 비용과 현장 추가 비용이 분리됐는지 | 총액 기준으로 비교합니다. |',
      '| 준비 | 여권, 결제, 통신, 비상 연락이 준비됐는지 | 출발 전날 다시 확인합니다. |',
      '',
    );
  }

  if (designAidCount < 2 || numericFacts < 6) {
    blocks.push(
      '',
      '<aside class="blog-callout blog-callout-tip">',
      '<strong>읽는 순서</strong>',
      '<p>먼저 3줄 요약을 보고, 표에서 비용과 이동 시간을 확인한 뒤, 마지막 체크리스트만 저장해도 됩니다.</p>',
      '</aside>',
      '',
      '==숫자는 확정값이 아니라 비교 기준입니다. 출발 7일 전과 24시간 전에는 공식 안내와 예약 조건을 다시 확인하세요.==',
    );
  }

  if (blocks.length > 0) {
    text = `${text.trim()}\n${blocks.join('\n')}\n`;
  }

  return { text, changed: text !== before };
}

export function repairKeywordDensityToTarget(
  markdown: string,
  primaryKeyword?: string | null,
  blogType: 'product' | 'info' = 'info',
): BlogKeywordDensityRepairResult {
  const keyword = primaryKeyword?.trim() || null;
  if (!keyword || keyword.length < 2) {
    return { blogHtml: markdown, changed: false, keyword, beforeCount: 0, afterCount: 0, allowedCount: 0 };
  }

  const plainLength = markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>|=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
  if (plainLength === 0) {
    return { blogHtml: markdown, changed: false, keyword, beforeCount: 0, afterCount: 0, allowedCount: 0 };
  }

  const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const beforeCount = (markdown.match(pattern) || []).length;
  const targetDensity = blogType === 'info' ? 1.65 : 2.35;
  const allowedCount = Math.max(2, Math.floor((plainLength * targetDensity) / (keyword.length * 100)));
  if (beforeCount <= allowedCount) {
    return { blogHtml: markdown, changed: false, keyword, beforeCount, afterCount: beforeCount, allowedCount };
  }

  const words = keyword.split(/\s+/).filter(Boolean);
  const replacement = words.length > 1 ? words[words.length - 1] : '현지';
  let seen = 0;
  const blogHtml = markdown.replace(pattern, () => {
    seen += 1;
    return seen <= allowedCount ? keyword : replacement;
  });
  const afterCount = (blogHtml.match(pattern) || []).length;

  return {
    blogHtml,
    changed: blogHtml !== markdown,
    keyword,
    beforeCount,
    afterCount,
    allowedCount,
  };
}

export function repairBlogStructureQuality(input: BlogEditorialRepairInput): BlogEditorialRepairResult {
  const before = inspectBlogIntentQuality(input);
  const changes: string[] = [];
  let blogHtml = input.blogHtml;

  const accentRepair = normalizeBlogVisualAccents(blogHtml);
  if (accentRepair.changed) {
    blogHtml = accentRepair.text;
    changes.push('normalized_visual_accents');
  }

  const artifactRepair = removeRenderArtifacts(blogHtml);
  if (artifactRepair.changed) {
    blogHtml = artifactRepair.text;
    changes.push('removed_render_artifacts');
  }

  const toneRepair = softenPromotionalInfoTone(blogHtml);
  if (toneRepair.changed) {
    blogHtml = toneRepair.text;
    changes.push('softened_promotional_info_tone');
  }

  const directiveRepair = removeRawDirectiveLeaks(blogHtml);
  if (directiveRepair.changed) {
    blogHtml = directiveRepair.text;
    changes.push('removed_raw_directive_leaks');
  }

  const checklistRepair = splitCollapsedChecklistItems(blogHtml);
  if (checklistRepair.changed) {
    blogHtml = checklistRepair.text;
    changes.push('split_collapsed_checklist_items');
  }

  const headingRepair = splitOverlongHeadings(blogHtml);
  if (headingRepair.changed) {
    blogHtml = headingRepair.text;
    changes.push('split_overlong_headings');
  }

  const blankHeadingRepair = repairBlankHeadingLines(blogHtml);
  if (blankHeadingRepair.changed) {
    blogHtml = blankHeadingRepair.text;
    changes.push('repaired_blank_headings');
  }

  const publishChecklistRepair = ensurePublishChecklist(blogHtml, input);
  if (publishChecklistRepair.changed) {
    blogHtml = publishChecklistRepair.text;
    changes.push('added_publish_checklist');
  }

  const tableBoundaryRepair = ensureMarkdownTableBoundaries(blogHtml);
  if (tableBoundaryRepair.changed) {
    blogHtml = tableBoundaryRepair.text;
    changes.push('added_markdown_table_boundaries');
  }

  const looseTableRepair = repairLooseMarkdownTables(blogHtml);
  if (looseTableRepair.changed) {
    blogHtml = looseTableRepair.text;
    changes.push('repaired_loose_markdown_tables');
  }

  const tableProseRepair = splitTableProseRows(blogHtml);
  if (tableProseRepair.changed) {
    blogHtml = tableProseRepair.text;
    changes.push('split_table_prose_rows');
  }

  const htmlTableProseRepair = splitHtmlTableProseRows(blogHtml);
  if (htmlTableProseRepair.changed) {
    blogHtml = htmlTableProseRepair.text;
    changes.push('split_html_table_prose_rows');
  }

  const inlineSplitRepair = splitInlineScanElements(blogHtml);
  if (inlineSplitRepair.changed) {
    blogHtml = inlineSplitRepair.text;
    changes.push('split_inline_scan_elements');
  }

  const paragraphRepair = splitLongParagraphs(blogHtml);
  if (paragraphRepair.changed) {
    blogHtml = paragraphRepair.text;
    changes.push('split_long_paragraphs');
  }

  const readingRepair = ensureMinimumReadingStructure(blogHtml, input);
  if (readingRepair.changed) {
    blogHtml = readingRepair.text;
    changes.push('added_minimum_reading_structure');
  }

  const designRepair = addReadingDesignAid(blogHtml);
  if (designRepair.changed) {
    blogHtml = designRepair.text;
    changes.push('added_reading_design_tip');
  }

  const h2CapRepair = capH2Headings(blogHtml);
  if (h2CapRepair.changed) {
    blogHtml = h2CapRepair.text;
    changes.push('capped_h2_headings');
  }

  const repeatedHeadingRepair = dedupeRepeatedHeadings(blogHtml);
  if (repeatedHeadingRepair.changed) {
    blogHtml = repeatedHeadingRepair.text;
    changes.push('deduped_repeated_headings');
  }

  const repeatedSupportRepair = dedupeRepeatedSupportBlocks(blogHtml);
  if (repeatedSupportRepair.changed) {
    blogHtml = repeatedSupportRepair.text;
    changes.push('deduped_repeated_support_blocks');
  }

  const longtailPrefixRepair = softenRepeatedLongtailBulletPrefixes(blogHtml);
  if (longtailPrefixRepair.changed) {
    blogHtml = longtailPrefixRepair.text;
    changes.push('softened_repeated_longtail_bullet_prefixes');
  }

  const malformedTableRepair = flattenMalformedInlineTables(blogHtml);
  if (malformedTableRepair.changed) {
    blogHtml = malformedTableRepair.text;
    changes.push('flattened_malformed_inline_tables');
  }

  const repeatedPlanningHookRepair = limitRepeatedPlanningHooks(blogHtml);
  if (repeatedPlanningHookRepair.changed) {
    blogHtml = repeatedPlanningHookRepair.text;
    changes.push('limited_repeated_planning_hooks');
  }

  const finalLooseTableRepair = repairLooseMarkdownTables(blogHtml);
  if (finalLooseTableRepair.changed) {
    blogHtml = finalLooseTableRepair.text;
    if (!changes.includes('repaired_loose_markdown_tables')) {
      changes.push('repaired_loose_markdown_tables');
    }
  }

  const finalAccentRepair = normalizeBlogVisualAccents(blogHtml);
  if (finalAccentRepair.changed) {
    blogHtml = finalAccentRepair.text;
    changes.push('normalized_visual_accents_final');
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

function splitInlineScanElements(markdown: string): { text: string; changed: boolean } {
  let text = markdown;
  const before = text;

  text = text
    .replace(/^(#{2,3}[ \t]+(?:\uC5EC\uD589 \uC900\uBE44\uB97C \uC704\uD55C \uC2E4\uC804 \uD301|\uC790\uC8FC \uBB3B\uB294 \uC9C8\uBB38))[ \t]+(.+)$/gm, '$1\n\n$2')
    .replace(/^(#{2,3}[^\n]+?)[ \t]+(#{2,3}[ \t]+)/gm, '$1\n\n$2');

  text = text
    .replace(/\s+(##[ \t]+\uD56D\uACF5)/g, '\n\n$1')
    .replace(/([.!?。！？]|\uB2E4\.|\uC694\.|\uB2C8\uB2E4\.)\s+(\|[^|\n]+(?:\|[^|\n]+){1,}\|)/g, '$1\n\n$2')
    .replace(/(\|[^|\n]+\|[^|\n]+\|)[ \t]+(?=[\uAC00-\uD7A3A-Za-z][^|\n]{45,})/g, '$1\n\n')
    .replace(/\|\s+\|(?=\s*\*)/g, '|\n\n|');

  text = text
    .replace(/([.!?。！？]|\uB2E4\.|\uC694\.|\uB2C8\uB2E4\.)\s+(#{1,6}\s+)/g, '$1\n\n$2')
    .replace(/\s+(TL;DR:)/gi, '\n\n$1');

  text = text
    .replace(/\|\s+\|(?=\s*(?::?-{2,}|[가-힣A-Za-z0-9]))/g, '|\n\n|')
    .replace(/\s+(Q[.:]\s*)/g, '\n\n$1')
    .replace(/\s+(A[.:]\s*)/g, '\n\n$1')
    .replace(/\s+(-\s*\[[ xX]\]\s*)/g, '\n\n$1')
    .replace(/\s+(-\s+(?=\S))/g, '\n\n$1')
    .replace(/\s+(\*\s+(?=\S))/g, '\n\n$1')
    .replace(/\s+(\*\*\d{1,2}\.\s+[^*]{2,60}\*\*)/g, '\n\n$1')
    .replace(/(?<!#)\s+(\d{1,2}\.\s+(?=\S))/g, '\n\n$1');

  return { text, changed: text !== before };
}

function splitLongParagraphs(markdown: string): { text: string; changed: boolean } {
  const paragraphs = markdown.split(/\n{2,}/);
  let changed = false;

  const next = paragraphs.map((paragraph) => {
    const trimmed = paragraph.trim();
    const plain = stripMarkup(trimmed).replace(/\s+/g, ' ').trim();
    if (
      plain.length < 420 ||
      /^#{1,6}\s/.test(trimmed) ||
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
    const sentenceParts = sentences.length >= 4
      ? sentences
      : trimmed
        .split(/(?<=[.!?。！？])\s+|(?<=\uB2E4\.)\s+|(?<=\uC694\.)\s+|(?<=\uB2C8\uB2E4\.)\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);

    if (sentenceParts.length < 4) {
      const words = trimmed.split(/\s+/).filter(Boolean);
      if (words.length < 30) return paragraph;

      const chunks: string[] = [];
      let chunk = '';
      for (const word of words) {
        const candidate = chunk ? `${chunk} ${word}` : word;
        if (stripMarkup(candidate).length > 260 && chunk) {
          chunks.push(chunk);
          chunk = word;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) chunks.push(chunk);
      if (chunks.length <= 1) return paragraph;

      changed = true;
      return chunks.join('\n\n');
    }

    const chunks: string[] = [];
    let chunk = '';
    for (const sentence of sentenceParts) {
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

  const accentRepair = normalizeBlogVisualAccents(blogHtml);
  if (accentRepair.changed) {
    blogHtml = accentRepair.text;
    changes.push('normalized_visual_accents');
  }

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

  const inlineSplitRepair = splitInlineScanElements(blogHtml);
  if (inlineSplitRepair.changed) {
    blogHtml = inlineSplitRepair.text;
    changes.push('split_inline_scan_elements');
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

  const finalAccentRepair = normalizeBlogVisualAccents(blogHtml);
  if (finalAccentRepair.changed) {
    blogHtml = finalAccentRepair.text;
    changes.push('normalized_visual_accents_final');
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
