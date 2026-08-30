import {
  classifyBlogIntent,
  inspectBlogIntentQuality,
  type BlogInfoSubtype,
  type BlogIntentInput,
  type BlogIntentQualityReport,
} from './blog-content-intent';
import { canonicalizeBlogPublicLinks } from './blog-link-surface';
import { repairBlogPromptInstructionResidue } from './blog-prompt-residue';
import { computeReadability } from './blog-readability';
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

const GENERIC_DESTINATION_STOPWORDS = new Set([
  '가족',
  '여름',
  '휴가',
  '해외여행자',
  '보험',
  '여행',
  '가이드',
  '준비물',
  '체크리스트',
]);

function inferDestinationLabelForSurfaceRepair(input: BlogEditorialRepairInput): string | null {
  const candidates = [input.destination, input.primaryKeyword, input.title, input.category].filter((value): value is string =>
    Boolean(value && value.trim()),
  );
  for (const candidate of candidates) {
    const first = candidate
      .replace(/[|·:()[\]{}]/g, ' ')
      .trim()
      .split(/\s+/)[0]
      ?.trim();
    if (!first) continue;
    if (!/^[가-힣]{2,10}$/.test(first)) continue;
    if (GENERIC_DESTINATION_STOPWORDS.has(first)) continue;
    return first;
  }
  return null;
}

function naturalImageContextLabel(input: BlogEditorialRepairInput): string {
  const destination = inferDestinationLabelForSurfaceRepair(input);
  if (destination) return destination;

  const topic = `${input.primaryKeyword || ''} ${input.title || ''} ${input.category || ''}`;
  const parts: string[] = [];
  const month = topic.match(/\b(?:[1-9]|1[0-2])월\b/)?.[0];
  if (month) parts.push(`${month} 출발`);

  const region = topic.match(/황금연휴|동남아|유럽|일본|중국|베트남|태국|필리핀|해외여행|해외/)?.[0];
  if (region) parts.push(region);

  const theme = topic.match(/가족|항공권|공항|보험|보장|입국|비자|서류|유심|로밍|통신|환전|결제|카드|예산|경비|비용/)?.[0];
  if (theme) parts.push(theme);

  const label = [...new Set(parts)].join(' ').trim();
  if (label) return label;
  if (/insurance/i.test(topic)) return '해외여행 보험';
  if (/flight|airport/i.test(topic)) return '공항 출발 준비';
  if (/visa|esta|etias/i.test(topic)) return '입국 서류 준비';
  if (/esim|usim|wifi/i.test(topic)) return '현지 통신 준비';
  if (/currency/i.test(topic)) return '현지 결제 준비';
  if (/budget|cost/i.test(topic)) return '여행 예산 준비';
  return '여행 준비';
}

function repairGeneratedImageContext(
  markdown: string,
  input: BlogEditorialRepairInput,
): { text: string; changed: boolean } {
  const before = markdown;
  const label = naturalImageContextLabel(input);
  const naturalAlt = `${label} 여행 준비 장면`;
  const generatedContextRe =
    /(?:참고\s*이미지|여행\s*준비\s*이미지|travel\s*image|image|photo)\s*\d+|준비\s*기준을\s*함께\s*확인합니다|[a-f0-9]{6,}|[가-힣].*\b[a-z]{3,}(?:[\s_-]+[a-z]{3,}){1,}\b/i;

  const text = markdown
    .replace(/!\[([^\]\n]*)]\(([^)\n]+)\)/g, (match, alt: string, src: string) => {
      const cleanAlt = String(alt || '').replace(/\s+/g, ' ').trim();
      if (!generatedContextRe.test(cleanAlt)) return match;
      return `![${naturalAlt}](${src})`;
    })
    .replace(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi, (_match, caption: string) => {
      const cleanCaption = stripMarkup(String(caption || '')).replace(/\s+/g, ' ').trim();
      if (!generatedContextRe.test(cleanCaption)) return _match;
      return '';
    })
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (/^!\[/.test(trimmed) || /^<figcaption\b/i.test(trimmed)) return true;
      return !/(?:참고\s*이미지|여행\s*준비\s*이미지)\s*\d+/i.test(trimmed);
    })
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n');

  return { text, changed: text !== before };
}

function removeRepetitiveAnswerScaffold(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const plainHead = stripMarkup(markdown.slice(0, 900)).replace(/\s+/g, ' ').trim();
  const hasAnswerFirstIntro = /답부터\s+말하면|먼저\s+확인|핵심은|결론부터/.test(plainHead);
  if (!hasAnswerFirstIntro) return { text: markdown, changed: false };

  const lines = markdown.split('\n');
  const next: string[] = [];
  let removed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!/^##\s+예약\s*전\s+무엇을\s+먼저\s+확인해야\s*할까요\??\s*$/.test(line.trim())) {
      next.push(line);
      continue;
    }

    const block: string[] = [line];
    let cursor = index + 1;
    while (cursor < lines.length && !/^##\s+\S/.test((lines[cursor] ?? '').trim())) {
      block.push(lines[cursor] ?? '');
      cursor += 1;
    }

    const blockPlain = stripMarkup(block.join('\n')).replace(/\s+/g, ' ').trim();
    const isGeneric =
      /답부터\s+말하면/.test(blockPlain)
      && /(?:비용[·,\s]+일정|일정[·,\s]+준비|준비\s*조건|현지에서\s+생기는\s+추가\s+부담|1\s*[~–-]\s*2시간)/.test(blockPlain);
    if (isGeneric) {
      removed = true;
      index = cursor - 1;
      continue;
    }

    next.push(...block);
    index = cursor - 1;
  }

  const text = next.join('\n').replace(/\n{3,}/g, '\n\n');
  return { text, changed: removed && text !== before };
}

function removeRepeatedGenericAnswerHeadings(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const lines = markdown.split('\n');
  const next: string[] = [];
  let keptQuestion = false;
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const questionMatch = trimmed.match(
      /^##\s+(예약\s*전\s*무엇을\s*먼저\s*확인해야\s*할까요\?|출발\s*전\s*핵심\s*조건\s*할까요\?|일정별\s*확인\s*항목\s*할까요\?)(.*)$/i,
    );
    if (!questionMatch) {
      next.push(line);
      continue;
    }

    const heading = questionMatch[1] ?? '';
    const tail = questionMatch[2] ?? '';
    const isGenericTail = /답부터\s+말하면|추가\s+부담을\s+줄일\s+수\s+있습니다|불필요한\s+이동/.test(tail);
    if (/출발\s*전\s*핵심\s*조건|일정별\s*확인\s*항목/.test(heading) || keptQuestion) {
      changed = true;
      continue;
    }

    keptQuestion = true;
    if (isGenericTail) {
      next.push(`## ${heading}`);
      next.push('');
      next.push('답부터 말하면, 비용·일정·준비 조건을 함께 확인해야 현지에서 생기는 추가 부담을 줄일 수 있습니다.');
      changed = true;
      continue;
    }

    next.push(line);
  }

  const text = next.join('\n').replace(/\n{3,}/g, '\n\n');
  return { text, changed: changed && text !== before };
}

function isFaqHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  return /^(?:#{2,3}\s*)?(?:\*\*)?(?:자주\s*묻는\s*질문|FAQ|Q\s*&\s*A)(?:\*\*)?\s*$/i.test(trimmed);
}

function isFaqBlockBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,3}\s+\S/.test(trimmed) && !isFaqHeadingLine(trimmed)) return true;
  if (/^---+$/.test(trimmed)) return true;
  return /^\*\*(?:공식\s*확인\s*링크|여행\s*상품과\s*함께\s*확인하기|상품과\s*함께\s*확인하기)\*\*/.test(trimmed);
}

function dedupeRepeatedFaqBlocks(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let seenFaq = false;
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isFaqHeadingLine(line)) {
      next.push(line);
      continue;
    }

    if (!seenFaq) {
      seenFaq = true;
      next.push(line);
      continue;
    }

    changed = true;
    let cursor = index + 1;
    while (cursor < lines.length && !isFaqBlockBoundary(lines[cursor] ?? '')) {
      cursor += 1;
    }
    index = cursor - 1;
  }

  const text = next.join('\n').replace(/\n{3,}/g, '\n\n');
  return { text, changed: changed && text !== markdown };
}

function isQuickDecisionHeadingLine(line: string): boolean {
  return /^#{2,3}\s+(?:.+\s+)?빠른 판단표\s*$/i.test(line.trim());
}

function dedupeRepeatedQuickDecisionBlocks(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let seen = false;
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isQuickDecisionHeadingLine(line)) {
      next.push(line);
      continue;
    }

    if (!seen) {
      seen = true;
      next.push(line);
      continue;
    }

    changed = true;
    let cursor = index + 1;
    while (cursor < lines.length && !/^#{1,3}\s+\S/.test((lines[cursor] ?? '').trim())) {
      cursor += 1;
    }
    index = cursor - 1;
  }

  const text = next.join('\n').replace(/\n{3,}/g, '\n\n');
  return { text, changed: changed && text !== markdown };
}

function dedupeRepeatedShortParagraphs(markdown: string): { text: string; changed: boolean } {
  const blocks = markdown.split(/\n{2,}/);
  const seen = new Set<string>();
  let changed = false;

  const next = blocks.filter((block) => {
    const trimmed = block.trim();
    if (!trimmed) return true;
    if (/^#{1,6}\s|^\s*[-*]\s|^\s*\||^!\[|^<\w+/i.test(trimmed)) return true;
    const plain = stripMarkup(trimmed).replace(/\s+/g, ' ').trim();
    if (plain.length < 35 || plain.length > 220) return true;
    const key = plain.toLowerCase();
    if (seen.has(key)) {
      changed = true;
      return false;
    }
    seen.add(key);
    return true;
  });

  return { text: next.join('\n\n'), changed };
}

function removePlaceholderReferenceLinks(markdown: string): { text: string; changed: boolean } {
  const before = markdown.trim();
  const placeholderLinkRe = /(?:예시링크|%EC%98%88%EC%8B%9C%EB%A7%81%ED%81%AC|placeholder\s*link|example\s*link)/i;
  const text = markdown
    .split('\n')
    .filter((line) => !placeholderLinkRe.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, changed: text !== before };
}

function repairAwkwardSemanticSurface(
  markdown: string,
  input: BlogEditorialRepairInput,
): { text: string; changed: boolean } {
  const before = markdown;
  let text = markdown
    .replace(/즐기기할\s+수/g, '즐길 수')
    .replace(/즐기기할/g, '즐길')
    .replace(/즐기기하세요/g, '즐기세요')
    .replace(/즐기기합니다/g, '즐깁니다')
    .replace(/즐기기했습니다/g, '즐겼습니다')
    .replace(/즐기기하는/g, '즐기는')
    .replace(/즐기기하고/g, '즐기고')
    .replace(/즐기기하며/g, '즐기며')
    .replace(/즐기기하기/g, '즐기기')
    .replace(/즐기기하/g, '즐기')
    .replace(/확인하시는 것이 좋습니다/g, '확인하는 편이 안전합니다')
    .replace(/현지\s+현지/g, '현지')
    .replace(/정보를(?:를)+/g, '정보를')
    .replace(/여소남이\s+이\s+이\s+정보/g, '여소남이 이 정보')
    .replace(/(^|\s)(이|그|저|여행|준비|정보)\s+\2(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/여소남이\s+이\s+정보(?!를)/g, '여소남이 이 정보를')
    .replace(/이\s+순서로\s+봐야\s+현지에서\s+1\s*[~–-]\s*2시간을\s+아끼고\s+예산\s+오차를\s+줄일\s+수\s+있습니다\./g, '표와 체크리스트로 기준을 잡아두면 출발 전 비교가 훨씬 쉬워집니다.')
    .replace(/먼저\s+볼\s+것은\s+비용[·,\s]+일정[·,\s]+현지\s+준비\s+조건입니다\./g, '먼저 볼 것은 예산 범위, 이동 순서, 현지 확인 사항입니다.')
    .replace(/([가-힣]{2,12})(은|을)(?=\s|$|[.,!?])/g, (match, word: string, token: string) => {
      const hasBatchim = hasFinalConsonant(word);
      if (hasBatchim !== false) return match;
      if (token === '은') return `${word}는`;
      if (token === '을') return `${word}를`;
      return match;
    })
    .replace(/(대학생|가족|부모님|아이|고객|여행자)에서\s+먼저\s+볼\s+것은/g, '$1 여행에서 먼저 볼 것은');

  text = text
    .replace(/(^|\n)([-*]\s+)([가-힣A-Za-z/·\s]{2,40}\s+)?예산는\s/g, '$1$2$3예산은 ')
    .replace(/(^|\n)([-*]\s+)([가-힣A-Za-z/·\s]{2,40}\s+)?비용는\s/g, '$1$2$3비용은 ')
    .replace(/(^|\n)([-*]\s+)([가-힣A-Za-z/·\s]{2,40}\s+)?경비는\s/g, '$1$2$3경비는 ');

  const destination = inferDestinationLabelForSurfaceRepair(input);
  if (destination) {
    text = text
      .replace(/현지\s+참고\s*이미지/g, `${destination} 참고 이미지`)
      .replace(/현지\s+([1-9]\d?월\s+날씨)/g, `${destination} $1`)
      .replace(/현지\s+월별\s+날씨/g, `${destination} 월별 날씨`)
      .replace(/현지\s+날씨와\s+옷차림/g, `${destination} 날씨와 옷차림`)
      .replace(/현지\s+가이드\s+옷차림/g, `${destination} 날씨 옷차림`)
      .replace(/현지역/g, `${destination} 지역`)
      .replace(/현지\s+지역/g, `${destination} 지역`)
      .replace(/현지현/g, destination)
      .replace(/현지항/g, `${destination} 공항`)
      .replace(/부산→현지/g, `부산→${destination}`)
      .replace(/현지\s+마츠리/g, `${destination} 축제`)
      .replace(/현지\s+명물\s*['"‘’“”]?현지['"‘’“”]?/g, `${destination} 명물`)
      .replace(/현지\s+명물/g, `${destination} 명물`)
      .replace(/현지\s+명물관/g, `${destination} 명소`)
      .replace(/현지\s+자체예요/g, `${destination} 현지 분위기입니다`);
  }

  text = text.replace(
    /([가-힣/·\s]{2,40})\s*패키지는\s+가격만\s+보지\s+말고\s+출발지,\s*포함사항,\s*일정\s*강도를\s+(?:같이|함께)\s+봐야\s+판단이\s+쉽습니다\./g,
    (_match, productLabel: string) => {
      const label = String(productLabel || destination || '이 상품').replace(/\s+/g, ' ').trim();
      return `${label} 패키지는 시작가, 출발지, 포함/불포함, 이동량을 나눠 보면 문의 전에 판단하기 쉽습니다.`;
    },
  );

  return { text, changed: text !== before };
}

export function repairBlogSemanticSurface(input: BlogEditorialRepairInput): BlogEditorialRepairResult {
  const before = inspectBlogIntentQuality(input);
  const semanticRepair = repairAwkwardSemanticSurface(input.blogHtml, input);
  const imageRepair = repairGeneratedImageContext(semanticRepair.text, input);
  const placeholderLinkRepair = removePlaceholderReferenceLinks(imageRepair.text);
  const directiveRepair = removeRawDirectiveLeaks(placeholderLinkRepair.text);
  const answerRepair = removeRepetitiveAnswerScaffold(directiveRepair.text);
  const faqRepair = dedupeRepeatedFaqBlocks(answerRepair.text);
  const decisionRepair = dedupeRepeatedQuickDecisionBlocks(faqRepair.text);
  const paragraphRepair = dedupeRepeatedShortParagraphs(decisionRepair.text);
  const blogHtml = paragraphRepair.text;
  const changes = [
    semanticRepair.changed ? 'repaired_semantic_surface' : null,
    imageRepair.changed ? 'repaired_generated_image_context' : null,
    placeholderLinkRepair.changed ? 'removed_placeholder_reference_links' : null,
    directiveRepair.changed ? 'removed_raw_directive_leaks' : null,
    answerRepair.changed ? 'removed_repetitive_answer_scaffold' : null,
    faqRepair.changed ? 'deduped_repeated_faq_blocks' : null,
    decisionRepair.changed ? 'deduped_repeated_quick_decision_blocks' : null,
    paragraphRepair.changed ? 'deduped_repeated_short_paragraphs' : null,
  ].filter((value): value is string => Boolean(value));
  return {
    blogHtml,
    changed: changes.length > 0,
    changes,
    before,
    after: inspectBlogIntentQuality({ ...input, blogHtml }),
  };
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

const READABLE_HARD_CTA_RE =
  /(?:\uC9C0\uAE08|\uBC14\uB85C)\s*\uC608\uC57D|\uC608\uC57D\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC0C1\uB2F4|\uBC14\uB85C|\uB9C8\uAC10)|\uC0C1\uB2F4\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC5F0\uACB0|\uBC14\uB85C)|\uBB38\uC758\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uC0C1\uB2F4|\uBC14\uB85C)|\uC0C1\uD488\s*\uBCF4\uAE30|\uD328\uD0A4\uC9C0\s*\uBCF4\uAE30|\uCE74\uCE74\uC624(?:\uD1A1)?\s*(?:\uC0C1\uB2F4|\uBB38\uC758)|\uC794\uC5EC\s*\uC88C\uC11D|\uB9C8\uAC10\s*\uC784\uBC15/i;

function sanitizeInfoSalesTone(markdown: string): { text: string; changed: boolean } {
  let text = markdown;
  const before = text;
  const replacements: Array<[RegExp, string]> = [
    [/(?:\uC9C0\uAE08|\uBC14\uB85C)\s*\uC608\uC57D(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC0C1\uB2F4)?/gi, '\uCD9C\uBC1C \uC870\uAC74 \uD655\uC778'],
    [/\uC608\uC57D\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC0C1\uB2F4|\uBC14\uB85C)/gi, '\uCD9C\uBC1C \uC870\uAC74 \uD655\uC778'],
    [/\uC608\uC57D\s*\uB9C8\uAC10|\uB9C8\uAC10\s*\uC784\uBC15|\uC794\uC5EC\s*\uC88C\uC11D/gi, '\uD655\uC778\uC774 \uD544\uC694\uD55C \uC870\uAC74'],
    [/\uC0C1\uD488\s*\uBCF4\uAE30|\uD328\uD0A4\uC9C0\s*\uBCF4\uAE30/gi, '\uAD00\uB828 \uC870\uAC74 \uD655\uC778'],
    [/\uCE74\uCE74\uC624(?:\uD1A1)?\s*(?:\uC0C1\uB2F4|\uBB38\uC758)/gi, '\uC77C\uC815 \uC870\uAC74 \uD655\uC778'],
    [/\uC0C1\uB2F4\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC5F0\uACB0|\uBC14\uB85C)/gi, '\uD544\uC694\uD55C \uC870\uAC74 \uD655\uC778'],
    [/\uBB38\uC758\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uC0C1\uB2F4|\uBC14\uB85C)/gi, '\uC870\uAC74 \uD655\uC778'],
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

const YEOSONAM_DATA_EVIDENCE_RE = /(예약|상담|검색)\s*(로그|건수|집계)|GSC|서치콘솔|SERP|출처|집계\s*기간|표본|로그/i;
const READABLE_YEOSONAM_DATA_EVIDENCE_RE = /(?:\uC608\uC57D|\uC0C1\uB2F4|\uAC80\uC0C9)\s*(?:\uB85C\uADF8|\uAC74\uC218|\uC9D1\uACC4)|GSC|\uC11C\uCE58\uCF58\uC194|SERP|\uCD9C\uCC98|\uC9D1\uACC4\s*\uAE30\uAC04|\uD45C\uBCF8|\uB85C\uADF8/i;
const UNSUPPORTED_YEOSONAM_DATA_CLAIM_RE =
  /여소남(?:의)?\s*(?:내부\s*)?(?:데이터|예약\s*데이터|상담\s*데이터)(?:로\s*보면|로\s*본|를\s*보면|를\s*기준으로|에\s*따르면|상으로는|상)?/i;
const YEOSONAM_EDITOR_VOICE_RE = /여소남\s*에디터(?:가|는|의)?/i;

const READABLE_UNSUPPORTED_YEOSONAM_DATA_CLAIM_RE =
  /\uC5EC\uC18C\uB0A8(?:\uC758)?\s*(?:\uB0B4\uBD80\s*)?(?:\uB370\uC774\uD130|\uC0C1\uD488\s*(?:\uBC0F|\/|\u00B7|,)?\s*\uC608\uC57D\s*\uB370\uC774\uD130|\uC0C1\uD488\/\uC608\uC57D\s*\uB370\uC774\uD130|\uC608\uC57D\s*\uB370\uC774\uD130|\uC0C1\uB2F4\s*\uB370\uC774\uD130)(?:\uB85C\s*\uBCF4\uBA74|\uB85C\s*\uBCF8|\uB97C\s*\uBCF4\uBA74|\uB97C\s*\uAE30\uC900\uC73C\uB85C|\uC5D0\s*\uB530\uB974\uBA74|\uC0C1\uC73C\uB85C\uB294)?/i;

function removeAiEditorialCliches(markdown: string): { text: string; changed: boolean } {
  let text = markdown;
  const before = text;
  const replacements: Array<[RegExp, string]> = [
    [/이게\s*말이\s*되나\s*싶으시죠\??\s*/g, ''],
    [/안녕하세요[!.\s]*\s*친구에게\s+좋은\s+여행을\s+추천해\s+드리는\s*입니다\.?\s*/g, ''],
    [/친구에게\s+좋은\s+여행을\s+추천해\s+드리는\s*입니다\.?\s*/g, ''],
    [/가치\s+있는\s+여행을\s+소개하는\s*입니다\.?\s*/g, ''],
    [/완벽\s*가이드/g, '실전 가이드'],
    [/총정리/g, '정리'],
    [/놓치면\s*후회(?:하는|할)?/g, '미리 확인할'],
    [/최고의\s*선택/g, '선택 기준'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return { text, changed: text !== before };
}

function softenUnsupportedYeosonamDataClaims(markdown: string): { text: string; changed: boolean } {
  const plain = stripMarkup(markdown);
  const hasUnsupportedClaim =
    UNSUPPORTED_YEOSONAM_DATA_CLAIM_RE.test(plain) || READABLE_UNSUPPORTED_YEOSONAM_DATA_CLAIM_RE.test(plain);
  if (!hasUnsupportedClaim) {
    return { text: markdown, changed: false };
  }

  let text = markdown;
  const before = text;
  const replacements: Array<[RegExp, string]> = [
    [/\uC5EC\uC18C\uB0A8(?:\uC758)?\s*(?:\uB0B4\uBD80\s*)?\uB370\uC774\uD130(?:\uB85C\s*\uBCF4\uBA74|\uB85C\s*\uBCF8|\uB97C\s*\uBCF4\uBA74|\uB97C\s*\uAE30\uC900\uC73C\uB85C|\uC5D0\s*\uB530\uB974\uBA74|\uC0C1\uC73C\uB85C\uB294)?/gi, '\uCD9C\uBC1C \uC804 \uD655\uC778 \uAE30\uC900'],
    [/\uC5EC\uC18C\uB0A8(?:\uC758)?\s*(?:\uB0B4\uBD80\s*)?\uC0C1\uD488\s*(?:\uBC0F|\/|\u00B7|,)?\s*\uC608\uC57D\s*\uB370\uC774\uD130(?:\uB85C\s*\uBCF4\uBA74|\uB85C\s*\uBCF8|\uB97C\s*\uBCF4\uBA74|\uB97C\s*\uAE30\uC900\uC73C\uB85C|\uC5D0\s*\uB530\uB974\uBA74|\uC0C1\uC73C\uB85C\uB294)?/gi, '\uD604\uC7AC \uD655\uC778 \uAC00\uB2A5\uD55C \uC0C1\uD488 \uC870\uAC74'],
    [/\uC5EC\uC18C\uB0A8(?:\uC758)?\s*(?:\uB0B4\uBD80\s*)?\uC0C1\uD488\/\uC608\uC57D\s*\uB370\uC774\uD130(?:\uB85C\s*\uBCF4\uBA74|\uB85C\s*\uBCF8|\uB97C\s*\uBCF4\uBA74|\uB97C\s*\uAE30\uC900\uC73C\uB85C|\uC5D0\s*\uB530\uB974\uBA74|\uC0C1\uC73C\uB85C\uB294)?/gi, '\uD604\uC7AC \uD655\uC778 \uAC00\uB2A5\uD55C \uC0C1\uD488 \uC870\uAC74'],
    [/\uC5EC\uC18C\uB0A8(?:\uC758)?\s*(?:\uC608\uC57D|\uC0C1\uB2F4)\s*\uB370\uC774\uD130(?:\uB85C\s*\uBCF4\uBA74|\uB85C\s*\uBCF8|\uB97C\s*\uBCF4\uBA74|\uB97C\s*\uAE30\uC900\uC73C\uB85C|\uC5D0\s*\uB530\uB974\uBA74|\uC0C1\uC73C\uB85C\uB294)?/gi, '\uCD9C\uBC1C \uC804 \uD655\uC778 \uAE30\uC900'],
    [/여소남(?:의)?\s*(?:내부\s*)?데이터로\s*본/g, '출발 전 확인 기준으로 본'],
    [/여소남(?:의)?\s*(?:내부\s*)?데이터로\s*보면/g, '출발 전 확인 기준으로 보면'],
    [/여소남\s*데이터로\s*보면/g, '출발 전 확인 기준으로 보면'],
    [/여소남\s*데이터\s*기준(?:으로)?/g, '현재 확인 가능한 기준으로'],
    [/여소남\s*데이터(?:에\s*따르면|상으로는|상)?/g, '일반적인 여행 준비 기준으로'],
    [/여소남(?:의)?\s*(?:예약|상담)\s*데이터(?:에\s*따르면|상으로는|상)?/g, '현재 확인 가능한 여행 준비 기준으로'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return { text, changed: text !== before };
}

function removeYeosonamEditorVoice(markdown: string): { text: string; changed: boolean } {
  if (!YEOSONAM_EDITOR_VOICE_RE.test(markdown)) {
    return { text: markdown, changed: false };
  }

  const before = markdown;
  const text = markdown
    .split('\n')
    .map((line) => {
      if (!YEOSONAM_EDITOR_VOICE_RE.test(line)) return line;
      return line
        .replace(/여소남\s*에디터가\s*여러\s*정보를\s*비교\s*분석하여,?\s*/g, '')
        .replace(/여소남\s*에디터가\s*꼼꼼(?:하|히)게\s*정리(?:해\s*드립니다|했습니다|합니다)\.?/g, '핵심 기준을 정리했습니다.')
        .replace(/여소남\s*에디터가\s*추천(?:하는|한)?/g, '여행 전 확인할')
        .replace(/여소남\s*에디터(?:가|는|의)?\s*/g, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return { text, changed: text !== before };
}

function hasHardCtaSignal(text: string): boolean {
  return (
    READABLE_HARD_CTA_RE.test(text) ||
    /(상품\s*보기|패키지\s*보기|지금\s*상품|카카오(?:톡)?\s*(?:상담|문의|채널|연결)|group-inquiry|\/packages\?)/i.test(text) ||
    /(상담|문의)\s*(?:하기|신청|남기기|바로|가능|예약|마감)/i.test(text) ||
    /예약\s*(?:하기|문의|상담|신청|바로|마감|가능)/i.test(text)
  );
}

function hasReadableHardAction(text: string): boolean {
  if (READABLE_HARD_CTA_RE.test(text)) return true;
  return /\/packages\?|group-inquiry|카카오(?:톡)?\s*(?:상담|문의|채널|연결)|상품\s*보기|패키지\s*보기|상담\s*(?:하기|신청|문의|남기기|바로)|문의\s*(?:하기|신청|바로)|예약\s*(?:하기|신청|문의|상담|바로|마감)/i.test(text);
}

function hasMarkdownLink(text: string): boolean {
  return /\[[^\]\n]{2,80}]\([^)]+(?:\s+"[^"]*")?\)/.test(text);
}

function softenHardCtaText(markdown: string): { text: string; changed: boolean } {
  let text = markdown;
  const before = text;
  const replacements: Array<[RegExp, string]> = [
    [/(?:\uC9C0\uAE08|\uBC14\uB85C)\s*\uC608\uC57D(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC0C1\uB2F4)?/gi, '\uCD9C\uBC1C \uC870\uAC74 \uD655\uC778'],
    [/\uC608\uC57D\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC0C1\uB2F4|\uBC14\uB85C)/gi, '\uCD9C\uBC1C \uC870\uAC74 \uD655\uC778'],
    [/\uC608\uC57D\s*\uB9C8\uAC10|\uB9C8\uAC10\s*\uC784\uBC15|\uC794\uC5EC\s*\uC88C\uC11D/gi, '\uD655\uC778\uC774 \uD544\uC694\uD55C \uC870\uAC74'],
    [/\uC0C1\uD488\s*\uBCF4\uAE30|\uD328\uD0A4\uC9C0\s*\uBCF4\uAE30/gi, '\uAD00\uB828 \uC870\uAC74 \uD655\uC778'],
    [/\uCE74\uCE74\uC624(?:\uD1A1)?\s*(?:\uC0C1\uB2F4|\uBB38\uC758)/gi, '\uC77C\uC815 \uC870\uAC74 \uD655\uC778'],
    [/\uC0C1\uB2F4\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uBB38\uC758|\uC5F0\uACB0|\uBC14\uB85C)/gi, '\uD544\uC694\uD55C \uC870\uAC74 \uD655\uC778'],
    [/\uBB38\uC758\s*(?:\uD558\uAE30|\uC2E0\uCCAD|\uC0C1\uB2F4|\uBC14\uB85C)/gi, '\uC870\uAC74 \uD655\uC778'],
    [/지금\s*예약(?:하기|문의|상담|신청|바로)?/gi, '출발 조건 확인'],
    [/바로\s*예약(?:하기|문의|상담|신청)?/gi, '출발 조건 확인'],
    [/예약\s*(?:하기|문의|상담|신청|바로)/gi, '출발 조건 확인'],
    [/예약\s*마감/gi, '확인 필요'],
    [/잔여\s*좌석/gi, '가능 여부'],
    [/상품\s*보기|패키지\s*보기/gi, '관련 조건 확인'],
    [/카카오톡?\s*(?:무료\s*)?상담/gi, '일정 조건 확인'],
    [/상담\s*(?:하기|신청|문의|남기기|바로)/gi, '필요한 조건 확인'],
    [/문의\s*(?:하기|신청|바로)/gi, '조건 확인'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return { text, changed: text !== before };
}

function compactAnswerFirstLabel(value?: string | null): string {
  return stripMarkup(value ?? '')
    .replace(/[#*_`[\]()>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function currentKstYearMonth(): { year: number; month: number } {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { year: kstNow.getUTCFullYear(), month: kstNow.getUTCMonth() + 1 };
}

function hasFinalConsonant(value: string): boolean | null {
  const last = value.trim().replace(/[^\uAC00-\uD7A3]/g, '').slice(-1);
  if (!last) return null;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0;
}

function particle(value: string, withBatchim: string, withoutBatchim: string): string {
  const hasBatchim = hasFinalConsonant(value);
  return hasBatchim === false ? withoutBatchim : withBatchim;
}

type CustomerInfoTopicKind =
  | 'weather'
  | 'communication'
  | 'visa'
  | 'currency'
  | 'cost'
  | 'transport'
  | 'itinerary'
  | 'general';

function inferCustomerInfoTopicKind(input: BlogEditorialRepairInput): CustomerInfoTopicKind {
  const strongText = [
    input.slug,
    input.destination,
    input.primaryKeyword,
    input.category,
  ].filter(Boolean).join(' ').toLowerCase();
  const titleText = String(input.title || '').toLowerCase();
  const text = `${strongText} ${titleText}`;

  if (/insurance|coverage|\uBCF4\uD5D8|\uBCF4\uC7A5/i.test(strongText)) return 'general';
  if (/weather|packing|\uB0A0\uC528|\uC637\uCC28\uB9BC|\uC900\uBE44\uBB3C|\uAE30\uC628|\uAC15\uC218|\uC6B0\uAE30|\uAC74\uAE30/i.test(strongText)) return 'weather';
  if (/wifi|wi-fi|usim|e-?sim|roaming|\uC720\uC2EC|\uB85C\uBC0D|\uC640\uC774\uD30C\uC774|\uD1B5\uC2E0/i.test(strongText)) return 'communication';
  if (/visa|immigration|esta|etias|\uBE44\uC790|\uC785\uAD6D|\uC5EC\uAD8C|\uC11C\uB958/i.test(strongText)) return 'visa';
  if (/currency|money|payment|\uD658\uC804|\uD658\uC728|\uD604\uAE08|\uCE74\uB4DC|\uD654\uD3D0/i.test(strongText)) return 'currency';
  if (/cost|budget|price|\uBE44\uC6A9|\uC608\uC0B0|\uACBD\uBE44|\uBB3C\uAC00|\uAC00\uACA9/i.test(strongText)) return 'cost';
  if (/transport|transfer|mobility|\uAD50\uD1B5|\uC774\uB3D9|\uACF5\uD56D|\uD53D\uC5C5/i.test(strongText)) return 'transport';
  if (/itinerary|route|course|\uC77C\uC815|\uCF54\uC2A4|\uB3D9\uC120|\uB8E8\uD2B8/i.test(strongText)) return 'itinerary';

  if (/weather|packing|\uB0A0\uC528|\uC637\uCC28\uB9BC|\uC900\uBE44\uBB3C|\uAE30\uC628|\uAC15\uC218|\uC6B0\uAE30|\uAC74\uAE30/i.test(text)) return 'weather';
  if (/wifi|wi-fi|usim|e-?sim|roaming|\uC720\uC2EC|\uB85C\uBC0D|\uC640\uC774\uD30C\uC774|\uD1B5\uC2E0/i.test(text)) return 'communication';
  if (/visa|immigration|esta|etias|\uBE44\uC790|\uC785\uAD6D|\uC5EC\uAD8C|\uC11C\uB958/i.test(text)) return 'visa';
  if (/currency|money|payment|\uD658\uC804|\uD658\uC728|\uD604\uAE08|\uCE74\uB4DC|\uD654\uD3D0/i.test(text)) return 'currency';
  if (/cost|budget|price|\uBE44\uC6A9|\uC608\uC0B0|\uACBD\uBE44|\uBB3C\uAC00|\uAC00\uACA9/i.test(text)) return 'cost';
  if (/transport|transfer|mobility|\uAD50\uD1B5|\uC774\uB3D9|\uACF5\uD56D|\uD53D\uC5C5/i.test(text)) return 'transport';
  if (/itinerary|route|course|\uC77C\uC815|\uCF54\uC2A4|\uB3D9\uC120|\uB8E8\uD2B8/i.test(text)) return 'itinerary';
  return 'general';
}

function buildAnswerFirstIntro(input: BlogEditorialRepairInput): string {
  const topic = compactAnswerFirstLabel(input.primaryKeyword || input.title || input.category)
    || '\uC5EC\uD589 \uC900\uBE44';
  const destination = compactAnswerFirstLabel(input.destination);
  const destinationLabel = destination || topic.split(/\s+/)[0] || '\uC5EC\uD589\uC9C0';
  const kind = inferCustomerInfoTopicKind(input);

  if (kind === 'transport') {
    return topic + ', \uACF5\uD56D\uC774\uB098 \uC2DC\uB0B4\uB85C \uC774\uB3D9\uD560 \uB54C\uB294 \uC2DC\uAC04\u00B7\uBE44\uC6A9\u00B7\uD53D\uC5C5 \uC704\uCE58\uB97C \uBA3C\uC800 \uBE44\uAD50\uD574\uC57C \uD569\uB2C8\uB2E4. ' + destinationLabel + ' \uD604\uC9C0\uC5D0\uC11C\uB294 \uCC28\uB7C9 \uB300\uAE30\uC2DC\uAC04\uACFC \uC218\uD558\uBB3C \uC218\uB97C \uD568\uAED8 \uBCF4\uBA74 \uC774\uB3D9 \uC2E4\uC218\uAC00 \uC904\uC5B4\uB4ED\uB2C8\uB2E4.';
  }
  if (kind === 'cost') {
    return topic + ', \uCD1D\uC561\uC740 \uC0C1\uD488\uAC00\u00B7\uD604\uC9C0 \uAC1C\uC778\uACBD\uBE44\u00B7\uC120\uD0DD \uAD00\uAD11\uBE44\uB97C \uB530\uB85C \uBD10\uC57C \uD569\uB2C8\uB2E4. \uC608\uC57D \uC804\uC5D0 \uD3EC\uD568/\uBD88\uD3EC\uD568\uACFC \uD658\uC728\uC744 \uAC19\uC774 \uD655\uC778\uD558\uBA74 \uC608\uC0B0 \uC624\uCC28\uB97C \uC904\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4.';
  }
  if (kind === 'weather') {
    return topic + ', \uB0AE\uACFC \uBC24 \uAE30\uC628, \uBE44 \uC608\uBCF4, \uC637\uCC28\uB9BC\uC744 \uBA3C\uC800 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4. \uCCB4\uAC10 \uC628\uB3C4\uB294 \uC544\uCE68\u00B7\uC800\uB141 \uAE30\uC628\uCC28\uC640 \uAC15\uC218 \uAC00\uB2A5\uC131\uC5D0 \uB354 \uD06C\uAC8C \uC88C\uC6B0\uB429\uB2C8\uB2E4. ' + destinationLabel + ' \uCD9C\uBC1C \uC804\uC5D0\uB294 \uACB9\uCCD0 \uC785\uC744 \uC637, \uBC29\uC218\uC6A9\uD488, \uC790\uC678\uC120 \uCC28\uB2E8\uC744 \uBA3C\uC800 \uCC59\uAE30\uBA74 \uC637\uCC28\uB9BC \uC2E4\uC218\uAC00 \uC904\uC5B4\uB4ED\uB2C8\uB2E4.';
  }
  if (kind === 'communication') {
    return topic + ', \uAC1C\uD1B5 \uC804\uC5D0 \uC0AC\uC6A9 \uC9C0\uC5ED, \uB370\uC774\uD130 \uC6A9\uB7C9, \uD1B5\uD654 \uD544\uC694 \uC5EC\uBD80\uB97C \uBA3C\uC800 \uBCF4\uC138\uC694. \uC774 \uC138 \uAC00\uC9C0\uB97C \uD655\uC778\uD558\uBA74 \uD604\uC9C0\uC5D0\uC11C \uC720\uC2EC\u00B7eSIM\u00B7\uB85C\uBC0D \uC120\uD0DD\uC774 \uD6E8\uC52C \uBE68\uB77C\uC9D1\uB2C8\uB2E4.';
  }
  if (kind === 'visa') {
    return topic + ', \uC5EC\uAD8C \uC720\uD6A8\uAE30\uAC04\uACFC \uCCB4\uB958 \uAE30\uAC04, \uC785\uAD6D \uC11C\uB958\uB97C \uBA3C\uC800 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4. \uC785\uAD6D \uC815\uCC45\uC740 \uBC14\uB014 \uC218 \uC788\uC73C\uB2C8 \uC608\uC57D \uC804\uACFC \uCD9C\uBC1C \uC9C1\uC804\uC5D0 \uACF5\uC2DD \uC548\uB0B4\uB97C \uB2E4\uC2DC \uBCF4\uB294 \uD3B8\uC774 \uC548\uC804\uD569\uB2C8\uB2E4.';
  }
  if (kind === 'currency') {
    return topic + ', \uD604\uAE08\uACFC \uCE74\uB4DC \uC911 \uBB34\uC5C7\uC744 \uBA3C\uC800 \uC900\uBE44\uD560\uC9C0\uB294 \uD658\uC728, \uC218\uC218\uB8CC, \uD604\uC9C0 \uACB0\uC81C \uAC00\uB2A5 \uC5EC\uBD80\uB85C \uACB0\uC815\uD558\uBA74 \uB429\uB2C8\uB2E4. \uCD5C\uC18C 2\uAC00\uC9C0 \uACB0\uC81C \uC218\uB2E8\uC744 \uB098\uB204\uC5B4 \uCC59\uAE30\uB294 \uAC83\uC774 \uC548\uC804\uD569\uB2C8\uB2E4.';
  }
  if (kind === 'itinerary') {
    return topic + ', \uD558\uB8E8\uC5D0 \uBA87 \uACF3\uC744 \uB123\uB294\uC9C0\uBCF4\uB2E4 \uC774\uB3D9 \uC2DC\uAC04\uACFC \uB3D9\uC120 \uC21C\uC11C\uB97C \uBA3C\uC800 \uBCF4\uB294 \uD3B8\uC774 \uC88B\uC2B5\uB2C8\uB2E4. ' + destinationLabel + ' \uC5EC\uD589\uC740 \uB3D9\uC120\uC744 \uC904\uC774\uBA74 \uC2E4\uC81C \uC5EC\uC720 \uC2DC\uAC04\uC774 1~2\uC2DC\uAC04 \uB298\uC5B4\uB0A0 \uC218 \uC788\uC2B5\uB2C8\uB2E4.';
  }

  return topic + ', \uC608\uC57D \uC804\uC5D0\uB294 \uC77C\uC815, \uBE44\uC6A9, \uC774\uB3D9 \uC870\uAC74\uC744 2\uAC00\uC9C0 \uC774\uC0C1 \uAE30\uC900\uC73C\uB85C \uBE44\uAD50\uD574\uC57C \uD569\uB2C8\uB2E4. ' + destinationLabel + ' \uC5EC\uD589\uC5D0\uC11C \uBC14\uB014 \uC218 \uC788\uB294 \uC870\uAC74\uC744 \uBA3C\uC800 \uC904\uC774\uBA74 \uD604\uC9C0 \uC2E4\uC218\uAC00 \uC904\uC5B4\uB4ED\uB2C8\uB2E4.';
}

function insertIntroAfterTitle(markdown: string, intro: string): string {
  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (headingIndex < 0) {
    return `${intro}\n\n${markdown.trim()}`;
  }

  let restStart = headingIndex + 1;
  while (restStart < lines.length && lines[restStart].trim() === '') restStart += 1;
  return [
    ...lines.slice(0, headingIndex + 1),
    '',
    intro,
    '',
    ...lines.slice(restStart),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function ensureInfoAnswerFirst(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  const report = inspectBlogIntentQuality({ ...input, blogHtml: markdown });
  if (!report.issues.some((issue) => issue.code === 'missing_answer_first')) {
    return { text: markdown, changed: false };
  }

  const intro = buildAnswerFirstIntro(input);
  if (markdown.includes(intro)) return { text: markdown, changed: false };
  const text = insertIntroAfterTitle(markdown, intro);
  return { text, changed: text !== markdown };
}

function repairGenericInfoAnswerOpening(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  const genericOpening =
    /답부터\s*말하면[,，]?\s*20\d{2}년\s*\d{1,2}월\s*기준[\s\S]{0,260}?(?:현지\s*확인\s*사항|준비\s*조건)[^.?!\n]*[.?!]\s*(?:포함\/불포함|포함과\s*불포함)[\s\S]{0,220}?(?:줄일\s*수\s*있습니다|줄일\s*수\s*있어요|도움이\s*됩니다)[.?!]/;
  if (!genericOpening.test(markdown)) return { text: markdown, changed: false };

  const intro = buildAnswerFirstIntro(input);
  const text = markdown.replace(genericOpening, intro);
  return { text, changed: text !== markdown };
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function moveEarlyStrongInfoCtaToBottom(markdown: string): { text: string; changed: boolean } {
  const blocks = markdown.split(/\n{2,}/);
  const earlyLimit = Math.ceil(markdown.length * 0.3);
  let cursor = 0;
  let changed = false;
  const kept: string[] = [];
  const moved: string[] = [];

  for (const block of blocks) {
    const start = cursor;
    cursor += block.length + 2;
    if (start <= earlyLimit && hasHardCtaSignal(block) && hasReadableHardAction(block)) {
      if (!hasMarkdownLink(block)) {
        const softened = softenHardCtaText(block.trim());
        if (
          softened.changed
          && !(hasHardCtaSignal(softened.text) && hasReadableHardAction(softened.text))
        ) {
          kept.push(softened.text);
          changed = true;
          continue;
        }
      }
      moved.push(block.trim());
      changed = true;
      continue;
    }
    kept.push(block);
  }

  if (!changed) return { text: markdown, changed: false };

  let text = kept.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (/^##\s*여행\s*상품과\s*함께\s*확인하기\b/im.test(text)) {
    return { text, changed: text !== markdown };
  }

  const seen = new Set<string>();
  const linkLines = [...moved.join('\n').matchAll(/\[([^\]\n]{2,80})]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((match) => {
      const rawLabel = match[1].trim();
      const href = match[2].trim();
      if (!/\/packages|group-inquiry|kakao|pf\.kakao|utm_|consult|yeosonam\.com/i.test(safeDecodeUriComponent(href))) {
        return null;
      }
      const key = `${rawLabel}|${href}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const label = /상품|패키지/i.test(rawLabel)
        ? '관련 패키지 보기'
        : /카카오/i.test(rawLabel)
          ? '카카오톡으로 일정 확인'
          : /상담|문의|예약/i.test(rawLabel)
            ? '내 일정 기준으로 가능 여부 확인'
            : rawLabel;
      return `- [${label}](${href})`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 3);

  if (linkLines.length > 0) {
    text = [
      text,
      '',
      '## 여행 상품과 함께 확인하기',
      '',
      '위 내용을 먼저 확인한 뒤, 실제 출발일과 인원 기준으로 가능한 상품만 따로 확인하면 됩니다.',
      '',
      ...linkLines,
    ].join('\n');
  }

  return { text, changed: text !== markdown };
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
  if (/^#{2,4}\s*.*(?:\uBE44\uC6A9\s*\uAE30\uC900\s*\uB2E4\uC2DC\s*\uBCF4\uAE30|\uBE44\uC6A9\s*\uBE44\uAD50\s*\uAE30\uC900|\uD56D\uBAA9\uBCC4\s*\uC608\uC0B0|\uC608\uC0B0\s*\uD45C)/m.test(markdown)) {
    return { text: markdown, changed: false };
  }
  if (/\uBE60\uB978\s*\uD310\uB2E8\uD45C[\s\S]{0,160}(?:\uB193\uCE58\uAE30\s*\uC26C\uC6B4\s*\uBE44\uC6A9|\uBE44\uC6A9)/.test(markdown)) {
    return { text: markdown, changed: false };
  }
  if (subtype !== 'cost' && subtype !== 'currency') return { text: markdown, changed: false };
  if (/##\s*\uBE44\uC6A9\s*\uAE30\uC900\s*\uB2E4\uC2DC\s*\uBCF4\uAE30/.test(markdown)) {
    return { text: markdown, changed: false };
  }

  const block = [
    '',
    '## \uBE44\uC6A9 \uAE30\uC900 \uB2E4\uC2DC \uBCF4\uAE30',
    '',
    '| \uD56D\uBAA9 | \uC77C\uBC18\uC801\uC778 \uD655\uC778 \uBC94\uC704 | \uC65C \uBD10\uC57C \uD558\uB098\uC694 |',
    '| --- | --- | --- |',
    '| \uD604\uC9C0 \uAD50\uD1B5 | 1\uD68C \uC774\uB3D9\uBE44\uC640 1\uC77C \uAD50\uD1B5\uBE44\uB97C \uB098\uB220 \uBD05\uB2C8\uB2E4. | \uC77C\uC815\uC774 \uAE38\uC218\uB85D \uCD1D\uC561 \uCC28\uC774\uAC00 \uCEE4\uC9D1\uB2C8\uB2E4. |',
    '| \uC2DD\uC0AC\u00B7\uAC04\uC2DD | 1\uC778 1\uB07C \uAE30\uC900 \uC608\uC0B0\uC744 \uD655\uC778\uD569\uB2C8\uB2E4. | \uAC00\uC871 \uC5EC\uD589\uC740 \uC2DD\uBE44 \uBCC0\uB3D9\uC774 \uD07D\uB2C8\uB2E4. |',
    '| \uC120\uD0DD \uAD00\uAD11 | \uBCC4\uB3C4 \uBE44\uC6A9 \uBC1C\uC0DD \uC5EC\uBD80\uB97C \uD655\uC778\uD569\uB2C8\uB2E4. | \uC0C1\uD488\uAC00\uC640 \uD604\uC9C0 \uCD94\uAC00\uBE44\uB97C \uBD84\uB9AC\uD574 \uBD05\uB2C8\uB2E4. |',
    '',
  ].join('\\n');

  return { text: `${markdown.trim()}\n${block}`, changed: true };
}

const REQUIRED_PUBLIC_INFO_TABLE_RE =
  /budget|cost|weather|itinerary|checklist|visa|currency|expense|\uBE44\uC6A9|\uC608\uC0B0|\uB0A0\uC528|\uC6D4\uBCC4|\uC77C\uC815|\uC900\uBE44\uBB3C|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uBE44\uC790|\uD658\uC804|\uACBD\uBE44|\uAC00\uACA9/i;

function hasRenderableMarkdownTable(markdown: string): boolean {
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index]?.trim() ?? '';
    const next = lines[index + 1]?.trim() ?? '';
    if (!/^\|.+\|\s*$/.test(line)) continue;
    if (!/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(next)) continue;

    let bodyRows = 0;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex]?.trim() ?? '';
      if (!/^\|.+\|\s*$/.test(row)) break;
      bodyRows += 1;
    }
    if (bodyRows >= 3) return true;
  }
  return false;
}

function readableDestinationLabel(input: BlogEditorialRepairInput): string {
  const candidates = [input.destination, input.primaryKeyword, input.title, input.category]
    .filter((value): value is string => Boolean(value && value.trim()));
  for (const candidate of candidates) {
    const first = candidate
      .replace(/[|:()[\]{}]/g, ' ')
      .trim()
      .split(/\s+/)[0]
      ?.trim();
    if (first && /^[\uAC00-\uD7A3A-Za-z]{2,16}$/.test(first) && !GENERIC_DESTINATION_STOPWORDS.has(first)) {
      return first;
    }
  }
  return '\uC5EC\uD589\uC9C0';
}

function requiredInfoDecisionTableKind(
  input: BlogEditorialRepairInput,
  subtype: BlogInfoSubtype | null,
  markdown: string,
): 'cost' | 'weather' | 'itinerary' | 'prep' | 'visa' | 'generic' {
  const source = `${input.slug || ''} ${input.title || ''} ${input.primaryKeyword || ''} ${input.category || ''} ${markdown.slice(0, 1400)}`;
  if (subtype === 'weather' || /weather|\uB0A0\uC528|\uC637\uCC28\uB9BC|\uAE30\uC628|\uAC15\uC218|\uC6B0\uAE30/i.test(source)) return 'weather';
  if (subtype === 'itinerary' || /itinerary|\uC77C\uC815|\uB3D9\uC120|\uCF54\uC2A4/i.test(source)) return 'itinerary';
  if (subtype === 'preparation' || /checklist|\uC900\uBE44\uBB3C|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uC900\uBE44/i.test(source)) return 'prep';
  if (subtype === 'visa' || subtype === 'currency' || /visa|currency|\uBE44\uC790|\uD658\uC804|\uC5EC\uAD8C|\uC785\uAD6D|\uACB0\uC81C/i.test(source)) return 'visa';
  if (subtype === 'cost' || subtype === 'food' || /budget|cost|expense|\uBE44\uC6A9|\uC608\uC0B0|\uACBD\uBE44|\uC2DD\uC0AC|\uB9DB\uC9D1|\uBA39\uAC70\uB9AC/i.test(source)) return 'cost';
  return 'generic';
}

function buildRequiredInfoDecisionTable(
  input: BlogEditorialRepairInput,
  subtype: BlogInfoSubtype | null,
  markdown: string,
): string {
  const label = readableDestinationLabel(input);
  const kind = requiredInfoDecisionTableKind(input, subtype, markdown);
  if (kind === 'weather') {
    return [
      '',
      `## ${label} \uB0A0\uC528\u00B7\uC900\uBE44 \uD310\uB2E8\uD45C`,
      '',
      '| \uD655\uC778 \uD56D\uBAA9 | \uBA3C\uC800 \uBCFC \uAC83 | \uCD9C\uBC1C \uC804 \uD589\uB3D9 |',
      '| --- | --- | --- |',
      '| \uB0AE \uAE30\uC628 | \uAC00\uC7A5 \uB354\uC6B4 \uC2DC\uAC04\uB300\uC640 \uD587\uBE5B \uAC15\uB3C4 | \uD1B5\uD48D\uB418\uB294 \uC637\uACFC \uC790\uC678\uC120 \uCC28\uB2E8\uC81C\uB97C \uCC59\uAE41\uB2C8\uB2E4. |',
      '| \uBC24 \uAE30\uC628 | \uC77C\uAD50\uCC28\uC640 \uC219\uC18C \uB0C9\uBC29\u00B7\uB09C\uBC29 \uC870\uAC74 | \uC587\uC740 \uAC89\uC637\uC774\uB098 \uAC00\uBCBC\uC6B4 \uBC29\uD55C\uC6A9 \uC637\uC744 \uB354\uD569\uB2C8\uB2E4. |',
      '| \uBE44 \uC608\uBCF4 | \uC18C\uB098\uAE30\u00B7\uC6B0\uAE30\u00B7\uD0DC\uD48D \uC601\uD5A5 | \uC6B0\uC0B0, \uBC29\uC218 \uAC89\uC637, \uC5EC\uBD84 \uC591\uB9D0\uC744 \uC900\uBE44\uD569\uB2C8\uB2E4. |',
      '',
    ].join('\n');
  }
  if (kind === 'itinerary') {
    return [
      '',
      `## ${label} \uC77C\uC815 \uD310\uB2E8\uD45C`,
      '',
      '| \uAD6C\uAC04 | \uBA3C\uC800 \uBCFC \uAC83 | \uCD9C\uBC1C \uC804 \uD655\uC778 |',
      '| --- | --- | --- |',
      '| \uCCAB\uB0A0 | \uD56D\uACF5 \uB3C4\uCC29 \uC2DC\uAC04\uACFC \uC219\uC18C \uC774\uB3D9 | \uB2A6\uC740 \uB3C4\uCC29\uC774\uBA74 \uC77C\uC815\uC744 \uC904\uC785\uB2C8\uB2E4. |',
      '| \uC911\uAC04\uC77C | \uD575\uC2EC \uAD00\uAD11\uC9C0 \uAC04 \uC774\uB3D9 \uC2DC\uAC04 | \uC544\uC774\u00B7\uBD80\uBAA8\uB2D8 \uB3D9\uBC18\uC740 \uD558\uB8E8 \uC774\uB3D9\uB7C9\uC744 \uB0AE\uCD9D\uB2C8\uB2E4. |',
      '| \uB9C8\uC9C0\uB9C9\uB0A0 | \uC1FC\uD551, \uC790\uC720\uC2DC\uAC04, \uACF5\uD56D \uC774\uB3D9 | \uC218\uD558\uBB3C\uACFC \uD0D1\uC2B9 \uC2DC\uAC04\uC744 \uD568\uAED8 \uD655\uC778\uD569\uB2C8\uB2E4. |',
      '',
    ].join('\n');
  }
  if (kind === 'prep' || kind === 'visa') {
    return [
      '',
      `## ${label} \uCD9C\uBC1C \uC804 \uD655\uC778\uD45C`,
      '',
      '| \uD56D\uBAA9 | \uD655\uC778 \uAE30\uC900 | \uB193\uCE58\uBA74 \uC548 \uB418\uB294 \uC774\uC720 |',
      '| --- | --- | --- |',
      '| \uC5EC\uAD8C\u00B7\uC785\uAD6D | \uC720\uD6A8\uAE30\uAC04, \uBE44\uC790, \uC785\uAD6D \uC11C\uB958 | \uADDC\uC815\uC774 \uBC14\uB00C\uBA74 \uD56D\uACF5 \uD0D1\uC2B9\uBD80\uD130 \uB9C9\uD790 \uC218 \uC788\uC2B5\uB2C8\uB2E4. |',
      '| \uACB0\uC81C\u00B7\uD658\uC804 | \uD604\uAE08, \uCE74\uB4DC, \uD604\uC9C0 \uC218\uC218\uB8CC | \uD604\uC9C0\uC5D0\uC11C \uC2DC\uAC04\uACFC \uC608\uC0B0\uC744 \uC544\uB07C\uB294 \uAE30\uC900\uC785\uB2C8\uB2E4. |',
      '| \uC0C1\uBE44\uC57D\u00B7\uD1B5\uC2E0 | \uAC1C\uC778\uC57D, eSIM, \uBCF4\uC870\uBC30\uD130\uB9AC | \uC678\uACFD \uC77C\uC815\uC77C\uC218\uB85D \uD604\uC9C0 \uAD6C\uB9E4\uAC00 \uC5B4\uB824\uC6B8 \uC218 \uC788\uC2B5\uB2C8\uB2E4. |',
      '',
    ].join('\n');
  }
  return [
    '',
    `## ${label} \uBE44\uC6A9\u00B7\uD310\uB2E8 \uD45C`,
    '',
    '| \uD56D\uBAA9 | \uBA3C\uC800 \uBCFC \uAC83 | \uBB38\uC758 \uC804 \uD655\uC778 |',
    '| --- | --- | --- |',
    '| \uCD1D\uC561 | \uC0C1\uD488\uAC00\uC640 \uD604\uC9C0 \uCD94\uAC00\uBE44\uB97C \uB098\uB220 \uBD05\uB2C8\uB2E4. | \uD3EC\uD568\u00B7\uBD88\uD3EC\uD568\uC744 \uD56D\uBAA9\uBCC4\uB85C \uD655\uC778\uD569\uB2C8\uB2E4. |',
    '| \uC2DD\uC0AC\u00B7\uC774\uB3D9 | 1\uC778 \uC2DD\uBE44\uC640 \uC774\uB3D9 \uC2DC\uAC04\uC744 \uD568\uAED8 \uBD05\uB2C8\uB2E4. | \uC544\uC774\u00B7\uBD80\uBAA8\uB2D8 \uB3D9\uBC18\uC740 \uB3D9\uC120 \uAC15\uB3C4\uB97C \uB0AE\uCD9C\uC9C0 \uD655\uC778\uD569\uB2C8\uB2E4. |',
    '| \uC120\uD0DD \uC870\uAC74 | \uC120\uD0DD\uAD00\uAD11, \uC1FC\uD551, \uC790\uC720\uC2DC\uAC04 \uC720\uBB34 | \uAC19\uC740 \uAC00\uACA9\uC774\uB77C\uB3C4 \uCCB4\uAC10 \uC77C\uC815\uC774 \uB2EC\uB77C\uC9D1\uB2C8\uB2E4. |',
    '',
  ].join('\n');
}

function ensureRequiredInfoDecisionTable(
  markdown: string,
  input: BlogEditorialRepairInput,
  subtype: BlogInfoSubtype | null,
): { text: string; changed: boolean } {
  const source = `${input.slug || ''} ${input.title || ''} ${input.primaryKeyword || ''} ${input.category || ''} ${markdown.slice(0, 1600)}`;
  if (!REQUIRED_PUBLIC_INFO_TABLE_RE.test(source)) return { text: markdown, changed: false };
  if (hasRenderableMarkdownTable(markdown)) return { text: markdown, changed: false };

  const table = buildRequiredInfoDecisionTable(input, subtype, markdown);
  const firstH2 = markdown.search(/\n##\s+/);
  if (firstH2 >= 0) {
    return {
      text: `${markdown.slice(0, firstH2)}${table}${markdown.slice(firstH2)}`,
      changed: true,
    };
  }
  return { text: `${markdown.trim()}${table}`, changed: true };
}

function hasItineraryFlowTable(markdown: string): boolean {
  return (
    /^#{2,4}\s*\uC77C\uC815\s*\uD750\uB984\s*\uBE60\uB978\s*\uBCF4\uAE30/m.test(markdown) ||
    /\|\s*\uAD6C\uAC04\s*\|\s*\uCD94\uCC9C\s*\uD750\uB984\s*\|\s*\uD655\uC778\s*\uD3EC\uC778\uD2B8\s*\|/.test(markdown)
  );
}

function ensureItineraryStructure(markdown: string): { text: string; changed: boolean } {
  if (hasItineraryFlowTable(markdown)) {
    return { text: markdown, changed: false };
  }

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
  const promptResidueRepair = repairBlogPromptInstructionResidue(markdown);
  const text = promptResidueRepair.text
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

function cleanMachineHyphenKeyword(value: string): string {
  return value
    .replace(
      /(^|[\s([{"'`])((?=[가-힣A-Za-z0-9-]*[가-힣])(?:[0-9]{1,2}월|[가-힣A-Za-z0-9]+)(?:-[가-힣A-Za-z0-9]+){2,})(?=(?:에서|은|는|을|를|이|가|로|과|와|도|까지|부터|처럼|이라면|\s|[.,!?)]|$))/g,
      (_match, prefix: string, phrase: string) => `${prefix}${phrase.replace(/-/g, ' ')}`,
    )
    .replace(/\s+(?=(?:에서|은|는|을|를|이|가|로|과|와|도|까지|부터|처럼|이라면)(?:\s|[.,!?)]|$))/g, '');
}

function removeLegacySurfaceArtifacts(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .split('\n')
    .map((line) => {
      let next = line
        .replace(/^\s*:{2,3}\s*tip\s*TL;?\s*DR\s*:?\s*$/i, '## 핵심 요약')
        .replace(/^\s*tip\s*TL;?\s*DR\s*:?\s*$/i, '## 핵심 요약')
        .replace(/^\s*tip\s*$/i, '')
        .replace(/\btip\s+\*{0,2}\s*TL;?\s*DR\b\s*\*{0,2}\s*(?:[—-]\s*)?/gi, '핵심 요약: ')
        .replace(/\btip\s+(?=[가-힣])/gi, '')
        .replace(/\btip\s+TL;?\s*DR\b\s*:?\s*/gi, '핵심 요약: ')
        .replace(/\bTL;?\s*DR\s*:/gi, '핵심 요약:')
        .replace(/\bTL;?\s*DR\s*[—-]\s*/gi, '핵심 요약: ')
        .replace(/!\[[^\]\n]*]\([^)]+\)/g, (match) => (/^#{1,6}\s/.test(line.trim()) ? '' : match))
        .replace(/\s+![가-힣A-Za-z0-9][^\n]{0,120}$/g, '')
        .replace(/\s+tip\s*$/i, '')
        .replace(/[ \t]+---(?=\s*$)/g, '')
        .replace(/여여소남/g, '여소남')
        .replace(/여소남이이/g, '여소남이 이')
        .replace(/여소남\s+여소남/g, '여소남')
        .replace(/상품\s*상세\s*보기\s*→\s*여소남/g, '여소남에서 상품 상세 보기');
      if (!/https?:\/\//i.test(next) && /[가-힣A-Za-z0-9]+-[가-힣A-Za-z0-9]+-[가-힣A-Za-z0-9-]+/.test(next)) {
        next = cleanMachineHyphenKeyword(next);
      }
      return next;
    })
    .filter((line) => !/^\s*-\s*$/.test(line))
    .join('\n')
    .replace(/\btip\s*\n\s*\*{0,2}\s*TL;?\s*DR\*{0,2}\s*:?\s*/gi, '핵심 요약: ')
    .replace(/포인트를\s+먼저\s+확인하세요[.。]?\s*/g, '')
    .replace(
      /(?:예약|문의)?하시면\s+(?:현재\s*)?(?:\n\s*)+([0-9]{1,2}월\s+좌석\s+현황도\s+바로\s+확인\s+가능합니다[.。]?)/g,
      '문의하시면 현재 $1',
    )
    .replace(/\s*하시면\s+현지\s+여행\s+Q&A를\s+더\s+상세히\s+알려드려요\.?/g, '')
    .replace(/(^|\s)에서\s+실시간\s+좌석과\s+요금을\s+바로\s+확인하실\s+수\s+있습니다[.。]?/g, '$1여소남에서 실시간 좌석과 요금을 바로 확인하실 수 있습니다.')
    .replace(/\*\*([^*\n]{1,180}?)\*\*/g, (_match, inner: string) => inner.replace(/\s+/g, ' ').trim())
    .replace(/__([^_\n]{1,180}?)__/g, (_match, inner: string) => inner.replace(/\s+/g, ' ').trim())
    .replace(/[ \t]+---[ \t]+(?=(?:#{1,6}\s|\*\*|해시태그|#))/g, '\n\n')
    .replace(/\n?---\s*>\s*여소남\s+여행\s+준비[\s\S]*?(?=\n(?:<aside\b|#{2,4}\s*준비|#{2,4}\s*빠른|#{2,4}\s*공식|#{2,4}\s*여행\s*상품|$))/g, '\n')
    .replace(/\s*(?:---\s*(?:>|&gt;|\\u0026gt;)\s*)?여소남\s+여행\s+준비\*{0,2}[\s\S]*?(?=\n(?:<aside\b|#{2,4}\s|$))/g, '\n')
    .replace(/\n+여소남\s+여행\s+준비\s*\n[\s\S]*?(?=\n(?:<aside\b|#{2,4}\s|$))/g, '\n')
    .replace(/\n+여소남\s+여행\s+준비\s+[^\n]{0,500}(?=\n(?:<aside\b|#{2,4}\s|$))/g, '\n')
    .replace(/\n?---\s*\*\*함께\s*보면\s*좋은\s*글\*\*[\s\S]*?(?=\n(?:<aside\b|#{2,4}\s|$))/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, changed: text !== before };
}

function repairCustomerVisiblePlaceholderCopy(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .replace(
      /-\s*상세\s*일차별\s*일정은\s*상담에서\s*확정본\s*기준으로\s*확인해야\s*합니다\./g,
      '- 일차별 상세 코스가 비어 있다면 항공 도착/귀국 시간, 장거리 이동일, 자유시간 비중을 먼저 확인해야 합니다.',
    )
    .replace(
      /상세\s*일차별\s*일정은\s*상담에서\s*확정본\s*기준으로\s*확인해야\s*합니다\./g,
      '일차별 상세 코스가 비어 있다면 항공 도착/귀국 시간, 장거리 이동일, 자유시간 비중을 먼저 확인해야 합니다.',
    )
    .replace(/(\d[\d,]*원부터)부터/g, '$1')
    .replace(/여행지\s*여행은/g, '해당 여행은')
    .replace(/솔리아_스팟가격/g, '상품 가격');

  return { text, changed: text !== before };
}

function repairCommonParticleMisuse(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .replace(/여부을/g, '여부를')
    .replace(/연휴을/g, '연휴를')
    .replace(/유심을을/g, '유심을')
    .replace(/데이터을/g, '데이터를')
    .replace(/([가-힣]{2,12})(은|을)(?=\s|$|[.,!?])/g, (match, word: string, particleValue: string) => {
      if (hasFinalConsonant(word) !== false) return match;
      return `${word}${particleValue === '은' ? '는' : '를'}`;
    });
  return { text, changed: text !== before };
}

export function normalizeBlogVisualAccents(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .split('\n')
    .map((line) => {
      let next = line
        .replace(/==([^=\n]{1,500}?)==/g, '$1')
        .replace(/<\/?mark\b[^>]*>/gi, '')
        .replace(
          /<strong\b[^>]*\bclass=["'][^"']*\bnum\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/gi,
          '$1',
        );
      if (!/(?:https?:\/\/|!\[[^\]]*]\(|\[[^\]]+]\(|[?&][A-Za-z0-9_-]+=)/.test(next)) {
        next = next.replace(/=([^=\n]{8,220})=/g, '$1');
      }
      return next;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return { text, changed: text !== before };
}

function removeResidualHtmlMarkdownBold(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const stripBold = (value: string) => value
    .replace(/^\s*>?\s*(?:<p\b[^>]*>)?\s*(?:\*\*|__)\s*(?:<\/p>)?\s*$/gi, '')
    .replace(/(?:\\\*){2}([^\\\n]{1,180}?)(?:\\\*){2}/g, (_match, inner: string) => inner.replace(/\s+/g, ' ').trim())
    .replace(/\*\*([^*\n]{1,180}?)\*\*/g, (_match, inner: string) => inner.replace(/\s+/g, ' ').trim())
    .replace(/__([^_\n]{1,180}?)__/g, (_match, inner: string) => inner.replace(/\s+/g, ' ').trim());
  const text = markdown
    .replace(/<strong\b[^>]*>\s*(?:\*\*|__)\s*<\/strong>/gi, '')
    .replace(/<b\b[^>]*>\s*(?:\*\*|__)\s*<\/b>/gi, '')
    .replace(/<p\b([^>]*)>\s*(?:\*\*|__)\s*<\/p>/gi, '')
    .split('\n')
    .map((line) => stripBold(line))
    .join('\n')
    .replace(/(^|\n)\s*>?\s*(?:\*\*|__)\s*(?=\n|$)/g, '$1')
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

function buildWeatherAnswerFirstIntro(input: BlogEditorialRepairInput): string {
  const keyword = input.primaryKeyword || input.title || '여행 날씨';
  const destination = input.destination || keyword.split(/\s+/)[0] || '여행지';
  return `${keyword}에서 핵심은 낮 기온만 보는 것이 아닙니다. ${destination} 여행은 아침·저녁 기온 차이, 비 예보, 이동 동선을 함께 보고 얇은 긴팔과 바람막이, 비 대비 용품을 준비하는 편이 안전합니다.`;
}

function buildReadableWeatherAnswerFirstIntro(input: BlogEditorialRepairInput): string {
  const keyword = (input.primaryKeyword || input.title || '여행 날씨와 옷차림').replace(/\s+/g, ' ').trim();
  const destination = (input.destination || keyword.split(/\s+/)[0] || '여행지').replace(/\s+/g, ' ').trim();
  return `${keyword}은 낮과 밤 기온, 비 예보, 일교차를 먼저 봐야 옷차림 실수를 줄일 수 있습니다. ${destination} 출발 전에는 아래 체크리스트 기준으로 얇은 겉옷, 방수용품, 자외선 차단, 여벌 옷을 일정과 이동 동선에 맞춰 나눠 준비하세요.`;
}

function repairWeatherAnswerFirstLead(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  const weatherTopic = /weather|날씨|옷차림|월별\s*날씨|기온|강수|우기|건기|일교차/i.test(
    `${input.primaryKeyword || ''} ${input.title || ''} ${input.category || ''} ${input.slug || ''}`,
  );
  if (!weatherTopic) return { text: markdown, changed: false };

  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) return { text: markdown, changed: false };

  let leadStart = h1Index + 1;
  while (leadStart < lines.length && lines[leadStart]?.trim() === '') leadStart += 1;
  if (leadStart >= lines.length || /^#{2,6}\s+\S/.test(lines[leadStart]?.trim() ?? '')) {
    return { text: markdown, changed: false };
  }

  let leadEnd = leadStart + 1;
  while (leadEnd < lines.length && lines[leadEnd]?.trim() !== '') leadEnd += 1;

  const lead = lines.slice(leadStart, leadEnd).join(' ').replace(/\s+/g, ' ').trim();
  const hasWrongLead = /일정,\s*비용,\s*이동|비용,\s*이동|현지\s*결제|예약|상품|상담|포함\/불포함|예산\s*범위|이동\s*순서/i.test(lead.slice(0, 180));
  if (!hasWrongLead) return { text: markdown, changed: false };

  lines.splice(leadStart, leadEnd - leadStart, buildReadableWeatherAnswerFirstIntro(input));
  return {
    text: lines.join('\n').replace(/\n{3,}/g, '\n\n'),
    changed: true,
  };
}

function ensureWeatherChecklistList(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  const weatherTopic = /weather|날씨|옷차림|월별\s*날씨|기온|강수|우기|건기|일교차/i.test(
    `${input.primaryKeyword || ''} ${input.title || ''} ${input.category || ''} ${input.slug || ''}`,
  );
  if (!weatherTopic) return { text: markdown, changed: false };
  if (!/checklist|체크\s*리스트|체크리스트/i.test(`${input.primaryKeyword || ''} ${input.title || ''} ${markdown.slice(0, 900)}`)) {
    return { text: markdown, changed: false };
  }
  if (/^##\s+.*(?:체크리스트|준비물|확인\s*목록)[\s\S]{0,420}(?:^|\n)\s*[-*]\s+\S[\s\S]{0,420}(?:^|\n)\s*[-*]\s+\S[\s\S]{0,420}(?:^|\n)\s*[-*]\s+\S/m.test(markdown)) {
    return { text: markdown, changed: false };
  }

  const destination = (input.destination || input.primaryKeyword || '여행지').replace(/\s+/g, ' ').trim();
  const block = [
    '',
    '## 출발 전 날씨 준비물 체크리스트',
    '',
    `- ${destination} 출발 7일 전에는 낮·밤 기온과 비 예보를 함께 확인합니다.`,
    '- 얇은 겉옷, 우산 또는 우비, 방수 가방을 일정 중 바로 꺼낼 수 있게 나눠 담습니다.',
    '- 강한 햇볕에 대비해 선크림, 모자, 선글라스, 보습제를 따로 챙깁니다.',
    '- 밤 일정이나 장거리 이동이 있으면 여벌 양말과 가벼운 방풍 겉옷을 추가합니다.',
    '- 출발 24시간 전에는 항공 운항, 현지 교통, 공식 안전 안내를 다시 확인합니다.',
    '',
  ].join('\n');

  return { text: `${markdown.trimEnd()}\n${block}`.replace(/\n{4,}/g, '\n\n\n'), changed: true };
}

function repairArticleQualityV2Surface(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  const before = markdown;
  const isWeatherInfo = /날씨|옷차림|준비물|체크리스트|weather|packing/i.test(
    `${input.primaryKeyword || ''} ${input.title || ''} ${input.category || ''} ${input.slug || ''}`,
  );
  let replacedWeatherIntro = false;
  const answerFirstIntro = buildWeatherAnswerFirstIntro(input);

  const lines = markdown
    .replace(/날씨은/g, '날씨는')
    .replace(/비용은은/g, '비용은')
    .replace(/일정은은/g, '일정은')
    .replace(/여행을 즐길 수 있는하기/g, '여행하기')
    .replace(/이 정보는\s*20\d{2}년\s*\d{1,2}월\s*\d{1,2}일\s*확인\s*기준으로\s*작성되었습니다\.?/g, '출발 전에는 공식 예보와 예약 조건을 다시 확인하세요.')
    .replace(/20\d{2}년\s*\d{1,2}월\s*\d{1,2}일\s*확인\s*기준(?:으로\s*작성되었습니다\.?)?/g, '출발 전 공식 안내 확인 기준')
    .replace(/여소남\s*내부\s*(?:상품|예약|상품\s*\/\s*예약)\s*데이터\s*기준[,，]?\s*/g, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (
        isWeatherInfo &&
        !replacedWeatherIntro &&
        trimmed.length > 20 &&
        /날씨는/.test(trimmed) &&
        /(비용|가격|예약|결제|이동\s*시간)/.test(trimmed)
      ) {
        replacedWeatherIntro = true;
        return answerFirstIntro;
      }
      return line;
    });

  let text = lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
  const readableWeatherLead = repairWeatherAnswerFirstLead(text, input);
  if (readableWeatherLead.changed) text = readableWeatherLead.text;
  const weatherChecklist = ensureWeatherChecklistList(text, input);
  if (weatherChecklist.changed) text = weatherChecklist.text;
  return { text, changed: text !== before };
}

function isTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  return (trimmed.match(/\|/g) || []).length >= 2 && !isTableSeparatorLine(trimmed);
}

function isTableSeparatorLine(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function genericTableHeader(cellCount: number): string {
  if (cellCount >= 4) return '| 항목 | 내용 | 비용 | 비고 |';
  if (cellCount === 3) return '| 항목 | 확인 기준 | 비고 |';
  return '| 항목 | 내용 |';
}

function looseTableRowToBullet(row: string, labels: string[]): string {
  const cells = tableCells(row).filter((cell) => cell.length > 0);
  const parts = cells.map((cell, index) => `${labels[index] || `col${index + 1}`}: ${cell}`);
  return `- ${parts.join(' / ')}`;
}

function firstRowLooksLikeTableData(row: string): boolean {
  const firstCell = tableCells(row)[0]?.replace(/[*_`~]/g, '').trim() || '';
  if (/^(구분|항목|상황|지역|일정|날짜|대상|비교|체크|확인)/.test(firstCell)) return false;
  return /[0-9]|원|달러|USD|EUR|JPY|THB|일차|차|식료품|기념품|관광|액티비티|보험|비상금|총 예상/.test(row);
}

function repairMisplacedMarkdownTableSeparators(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const following = lines[index + 1] ?? '';
    const previous = next[next.length - 1] ?? '';

    if (isTableRowLine(line) && isTableSeparatorLine(following) && firstRowLooksLikeTableData(line)) {
      const cells = tableCells(line);
      const labels = tableCells(genericTableHeader(cells.length));
      if (/\|\s*$/.test(previous.trim()) && !isTableRowLine(previous)) {
        next.pop();
      }
      next.push(looseTableRowToBullet(line, labels));
      index += 1;
      while (index + 1 < lines.length) {
        const candidate = lines[index + 1] ?? '';
        if (isTableSeparatorLine(candidate)) {
          index += 1;
          continue;
        }
        if (!isTableRowLine(candidate)) break;
        next.push(looseTableRowToBullet(candidate, labels));
        index += 1;
      }
      changed = true;
      continue;
    }

    next.push(line);
  }

  return { text: next.join('\n').replace(/\n{4,}/g, '\n\n\n'), changed };
}

function flattenListPipes(markdown: string): { text: string; changed: boolean } {
  const before = markdown;
  const text = markdown
    .split('\n')
    .map((line) => {
      if (!/^\s*[-*]\s+/.test(line) || !line.includes('|')) return line;
      return line.replace(/\s*\|\s*/g, ' - ');
    })
    .join('\n');
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

function repairWeakChecklistSection(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  if (!hasChecklistIntent(markdown, input) || !hasChecklistHeading(markdown)) {
    return { text: markdown, changed: false };
  }

  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) =>
    /^#{2,3}\s+.*(?:checklist|packing\s+list|체크리스트|준비물|필수\s*아이템|확인\s*목록)/i.test(line.trim()),
  );
  if (headingIndex < 0) return { text: markdown, changed: false };

  let cursor = headingIndex + 1;
  const sectionLines: string[] = [];
  while (cursor < lines.length && !/^#{1,3}\s+\S/.test((lines[cursor] ?? '').trim())) {
    sectionLines.push(lines[cursor] ?? '');
    cursor += 1;
  }

  const itemCount = sectionLines.filter((line) => /^\s*[-*]\s+\S/.test(line.trim())).length;
  const collapsedItem = sectionLines.some((line) => /\s\d{1,2}\.\s+\S/.test(line) && line.length > 120);
  if (itemCount >= 3 && !collapsedItem) return { text: markdown, changed: false };

  const keyword = input.primaryKeyword || input.title || '여행 준비';
  const additions = [
    '',
    `- ${keyword} 일정은 항공, 숙소, 이동 시간을 함께 비교합니다.`,
    '- 여권, 입국 서류, 예약 번호는 출발 전 다시 확인합니다.',
    '- 현지 날씨, 결제 수단, 통신 준비는 따로 목록으로 저장합니다.',
    '- 취소 규정, 추가 비용, 비상 연락처는 동행자와 공유합니다.',
    '',
  ];

  const next = [
    ...lines.slice(0, headingIndex + 1),
    ...additions,
    ...lines.slice(headingIndex + 1),
  ].join('\n').replace(/\n{4,}/g, '\n\n\n');

  return { text: next, changed: next !== markdown };
}

function ensureComparisonDecisionBlock(markdown: string, input: BlogEditorialRepairInput): { text: string; changed: boolean } {
  const haystack = [
    input.title,
    input.slug,
    input.primaryKeyword,
    input.category,
    markdown.slice(0, 2500),
  ].filter(Boolean).join(' ');
  const hasRecommendationIntent = /(compare|recommend|best|\uBE44\uAD50|\uCD94\uCC9C|\uC120\uD0DD|\uC0C1\uD669\uBCC4|\uC544\uC774|\uAC00\uC871|\uC548\uC804|\uD734\uC591\uC9C0)/i.test(haystack);
  if (!hasRecommendationIntent) return { text: markdown, changed: false };
  if (/^#{2,3}\s+.*(?:\uC0C1\uD669\uBCC4|\uC120\uD0DD\s*\uAE30\uC900|\uB9DE\uB294\s*\uC0AC\uB78C|\uC548\s*\uB9DE\uB294\s*\uC0AC\uB78C|decision|fit\s*for)/im.test(markdown)) {
    return { text: markdown, changed: false };
  }

  const keyword = input.primaryKeyword || input.title || '\uAC00\uC871 \uC5EC\uD589';
  const block = [
    '',
    '## \uC0C1\uD669\uBCC4 \uC120\uD0DD \uAE30\uC900',
    '',
    `| \uC0C1\uD669 | ${keyword}\uC5D0\uC11C \uBA3C\uC800 \uBCFC \uAC83 | \uBB38\uC758 \uC804 \uD655\uC778\uD560 \uC810 |`,
    '| --- | --- | --- |',
    '| \uC544\uC774 \uB3D9\uBC18 | \uBE44\uD589 \uC2DC\uAC04, \uC219\uC18C \uC774\uB3D9 \uB3D9\uC120, \uBCD1\uC6D0 \uC811\uADFC\uC131 | \uC5F0\uB839\uBCC4 \uC218\uC601\uC7A5\u00B7\uC2DD\uC0AC\u00B7\uCE68\uB300 \uC870\uAC74 |',
    '| \uCCAB \uD574\uC678\uC5EC\uD589 | \uC785\uAD6D \uC11C\uB958, \uD604\uC9C0 \uC774\uB3D9 \uB09C\uC774\uB3C4, \uD55C\uAD6D\uC5B4 \uC9C0\uC6D0 | \uD56D\uACF5\u00B7\uC219\uC18C\u00B7\uC774\uB3D9\uC774 \uD55C \uBC88\uC5D0 \uC815\uB9AC\uB418\uB294\uC9C0 |',
    '| \uC608\uC0B0 \uC911\uC2EC | \uCD1D\uC561, \uD604\uC9C0 \uCD94\uAC00\uBE44, \uC120\uD0DD \uAD00\uAD11 \uC720\uBB34 | \uAC00\uACA9\uC774 \uBC14\uB010 \uC218 \uC788\uB294 \uB0A0\uC9DC\u00B7\uC778\uC6D0 \uC870\uAC74 |',
    '',
    '## \uB9DE\uB294 \uC0AC\uB78C\uACFC \uC548 \uB9DE\uB294 \uC0AC\uB78C',
    '',
    '- \uB9DE\uB294 \uC0AC\uB78C: \uAC00\uC871 \uC774\uB3D9 \uB3D9\uC120\uACFC \uC548\uC804 \uBCC0\uC218\uB97C \uBA3C\uC800 \uC904\uC774\uACE0 \uC2F6\uC740 \uBD84.',
    '- \uC548 \uB9DE\uB294 \uC0AC\uB78C: \uC219\uC18C\u00B7\uC774\uB3D9\u00B7\uD604\uC9C0 \uC77C\uC815\uC744 \uBAA8\uB450 \uC9C1\uC811 \uC870\uD569\uD558\uACE0 \uC2F6\uC740 \uBD84.',
    '- \uBCF4\uB958\uD560 \uAC83: \uCD9C\uBC1C\uC77C, \uC544\uC774 \uC5F0\uB839, \uD56D\uACF5 \uC2DC\uAC04\uB300\uAC00 \uD655\uC815\uB418\uAE30 \uC804\uC5D0\uB294 \uCD1D\uC561\uC744 \uC815\uD574 \uB193\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.',
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

function hasQualityGateTableSeparator(line: string): boolean {
  return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function forceRepairRemainingBrokenMarkdownTables(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (!isTableRowLine(line)) {
      next.push(lines[index] ?? '');
      continue;
    }

    const block: string[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const current = lines[cursor]?.trim() ?? '';
      if (!isTableRowLine(current) && !isTableSeparatorLine(current)) break;
      block.push(current);
      cursor += 1;
    }

    const headerCells = parseMarkdownTableCells(block[0] ?? '');
    if (headerCells.length < 2) {
      next.push(stripMarkup(block.join(' ')).replace(/\s*\|\s*/g, ' / ').trim());
      changed = true;
      index = cursor - 1;
      continue;
    }

    const hasSeparator = block.length >= 2 && hasQualityGateTableSeparator(block[1] ?? '');
    const withSeparator = hasSeparator
      ? [block[0], block[1], ...block.slice(2)]
      : [block[0], markdownTableSeparatorFor(block[0] ?? ''), ...block.slice(1)];
    const bodyRows = withSeparator.slice(2);
    const hasMismatchedCells = bodyRows.some((row) => parseMarkdownTableCells(row).length !== headerCells.length);

    if (!hasSeparator) changed = true;

    if (withSeparator.length < 5 || hasMismatchedCells) {
      next.push(...markdownTableBlockToBullets(withSeparator));
      changed = true;
    } else {
      next.push(...withSeparator);
    }

    index = cursor - 1;
  }

  return { text: next.join('\n').replace(/\n{4,}/g, '\n\n\n'), changed };
}

function repairTooShortMarkdownTables(markdown: string): { text: string; changed: boolean } {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (!line.startsWith('|') || !line.endsWith('|')) {
      next.push(lines[index] ?? '');
      continue;
    }

    const block: string[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const current = lines[cursor]?.trim() ?? '';
      if (!current.startsWith('|') || !current.endsWith('|')) break;
      block.push(current);
      cursor += 1;
    }

    const hasSeparator = block.length >= 2 && hasQualityGateTableSeparator(block[1] ?? '');
    const bodyRows = block.slice(hasSeparator ? 2 : 1).filter((row) => parseMarkdownTableCells(row).length >= 2);

    if (bodyRows.length < 2) {
      const normalizedBlock = hasSeparator
        ? block
        : [block[0] ?? '', markdownTableSeparatorFor(block[0] ?? ''), ...block.slice(1)];
      next.push(...markdownTableBlockToBullets(normalizedBlock));
      changed = true;
    } else {
      next.push(...block);
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

function demoteDuplicateH1Headings(markdown: string): { text: string; changed: boolean } {
  let h1Count = 0;
  let changed = false;
  const text = markdown
    .split('\n')
    .map((line) => {
      if (!/^#\s+\S/.test(line.trim())) return line;
      h1Count += 1;
      if (h1Count === 1) return line;
      changed = true;
      return line.replace(/^#\s+/, '## ');
    })
    .join('\n');
  return { text, changed };
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

const REPEATED_PLANNING_PHRASE_SIGNAL_RE =
  /(?:\uC608\uC57D|\uBE44\uC6A9|\uC77C\uC815|\uD604\uC9C0|\uD655\uC778|\uC900\uBE44|\uCCB4\uD06C|\uC0C1\uB2F4|\uD568\uAED8\s*\uBCF4\uB824\uBA74|\uCD5C\uC18C\s*2\s*~\s*4\uC8FC)/;

const READABILITY_PHRASE_ALTERNATIVES = [
  '\uCD9C\uBC1C \uC804 \uD575\uC2EC \uC870\uAC74',
  '\uC77C\uC815\uBCC4 \uD655\uC778 \uD56D\uBAA9',
  '\uD604\uC9C0\uC5D0\uC11C \uB2EC\uB77C\uC9C0\uB294 \uBCC0\uC218',
  '\uC0C1\uB2F4 \uC804 \uC810\uAC80 \uD3EC\uC778\uD2B8',
];

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function softenRepeatedReadabilityPhrases(markdown: string, maxExactRepeats = 3): { text: string; changed: boolean } {
  let text = markdown;
  let changed = false;
  const directPatterns = [
    /\uD568\uAED8\s*\uBCF4\uB824\uBA74\s*\uCD5C\uC18C\s*2\s*~\s*4\uC8FC\s*\uC804\uC5D0/g,
    /\uAD00\uB828\s*\uC870\uAC74\uC744\s*\uBE44\uAD50\uD558\uB294\s*\uD3B8\uC774\s*\uC548\uC804\uD569\uB2C8\uB2E4/g,
    /\uD56D\uACF5\s*\uC2A4\uCF00\uC904,\s*\uC785\uC7A5\s*\uADDC\uC815\uCC98\uB7FC\s*\uB2F9\uC77C/g,
  ];
  for (const directPattern of directPatterns) {
    let seen = 0;
    text = text.replace(directPattern, (match) => {
      seen += 1;
      if (seen <= maxExactRepeats) return match;
      changed = true;
      return READABILITY_PHRASE_ALTERNATIVES[(seen - maxExactRepeats - 1) % READABILITY_PHRASE_ALTERNATIVES.length] || match;
    });
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const duplicates = computeReadability(text).duplicate_phrases
      .filter((item) =>
        item.count > maxExactRepeats &&
        REPEATED_PLANNING_PHRASE_SIGNAL_RE.test(item.phrase) &&
        !READABILITY_PHRASE_ALTERNATIVES.some((alternative) => item.phrase.includes(alternative)));
    if (duplicates.length === 0) break;

    let passChanged = false;
    for (const duplicate of duplicates) {
      let seen = 0;
      const pattern = new RegExp(escapeRegexLiteral(duplicate.phrase), 'g');
      text = text.replace(pattern, (match) => {
        seen += 1;
        if (seen <= maxExactRepeats) return match;
        passChanged = true;
        changed = true;
        return READABILITY_PHRASE_ALTERNATIVES[(seen - maxExactRepeats - 1) % READABILITY_PHRASE_ALTERNATIVES.length] || match;
      });
    }
    if (!passChanged) break;
  }

  for (const alternative of READABILITY_PHRASE_ALTERNATIVES) {
    const pattern = new RegExp(`${escapeRegexLiteral(alternative)}(?:\\s+${escapeRegexLiteral(alternative)})+`, 'g');
    text = text.replace(pattern, () => {
      changed = true;
      return alternative;
    });
  }

  return { text, changed: changed && text !== markdown };
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

function repairKeywordDensityToTargetLegacy(
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
  const targetDensity = blogType === 'info' ? 1.45 : 2.05;
  const allowedCount = Math.max(2, Math.floor((plainLength * targetDensity) / (keyword.length * 100)));
  if (beforeCount <= allowedCount) {
    return { blogHtml: markdown, changed: false, keyword, beforeCount, afterCount: beforeCount, allowedCount };
  }

  const words = keyword.split(/\s+/).filter(Boolean);
  const replacement = words.length > 1 ? words[words.length - 1] : '이곳';
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

export function repairKeywordDensityToTarget(
  markdown: string,
  primaryKeyword?: string | null,
  blogType: 'product' | 'info' = 'info',
): BlogKeywordDensityRepairResult {
  const keyword = primaryKeyword?.trim() || null;
  if (!keyword || keyword.length < 2) {
    return { blogHtml: markdown, changed: false, keyword, beforeCount: 0, afterCount: 0, allowedCount: 0 };
  }

  const plainTextLength = (value: string) => value
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>|=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
  const plainLength = plainTextLength(markdown);
  if (plainLength === 0) {
    return { blogHtml: markdown, changed: false, keyword, beforeCount: 0, afterCount: 0, allowedCount: 0 };
  }

  const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const beforeCount = (markdown.match(pattern) || []).length;
  const targetDensity = blogType === 'info' ? 1.45 : 2.05;
  const allowedCount = Math.max(2, Math.floor((plainLength * targetDensity) / (keyword.length * 100)));
  if (beforeCount <= allowedCount) {
    return { blogHtml: markdown, changed: false, keyword, beforeCount, afterCount: beforeCount, allowedCount };
  }

  const words = keyword.split(/\s+/).filter(Boolean);
  const replacement = words.length > 1 ? words[words.length - 1] : '이곳';
  const gateMaxDensity = blogType === 'info' ? 1.8 : 2.5;
  const renderWithKeepCount = (keepCount: number) => {
    let seen = 0;
    return markdown.replace(pattern, () => {
      seen += 1;
      return seen <= keepCount ? keyword : replacement;
    });
  };

  let finalAllowedCount = allowedCount;
  let blogHtml = renderWithKeepCount(finalAllowedCount);
  while (finalAllowedCount > 1) {
    const nextCount = (blogHtml.match(pattern) || []).length;
    const nextLength = plainTextLength(blogHtml);
    const nextDensity = nextLength > 0 ? (nextCount * keyword.length / nextLength) * 100 : 0;
    if (nextDensity <= gateMaxDensity - 0.05) break;
    finalAllowedCount -= 1;
    blogHtml = renderWithKeepCount(finalAllowedCount);
  }

  const afterCount = (blogHtml.match(pattern) || []).length;
  return {
    blogHtml,
    changed: blogHtml !== markdown,
    keyword,
    beforeCount,
    afterCount,
    allowedCount: finalAllowedCount,
  };
}

export function repairBlogStructureQuality(input: BlogEditorialRepairInput): BlogEditorialRepairResult {
  const before = inspectBlogIntentQuality(input);
  const intent = classifyBlogIntent(input);
  const changes: string[] = [];
  let blogHtml = input.blogHtml;

  const clicheRepair = removeAiEditorialCliches(blogHtml);
  if (clicheRepair.changed) {
    blogHtml = clicheRepair.text;
    changes.push('removed_ai_editorial_cliches');
  }

  const semanticSurfaceRepair = repairAwkwardSemanticSurface(blogHtml, input);
  if (semanticSurfaceRepair.changed) {
    blogHtml = semanticSurfaceRepair.text;
    changes.push('repaired_semantic_surface');
  }

  const articleQualityV2Repair = repairArticleQualityV2Surface(blogHtml, input);
  if (articleQualityV2Repair.changed) {
    blogHtml = articleQualityV2Repair.text;
    changes.push('repaired_article_quality_v2_surface');
    if (/weather|날씨|옷차림|월별\s*날씨|기온|강수|우기|건기|일교차/i.test(`${input.primaryKeyword || ''} ${input.title || ''} ${input.category || ''} ${input.slug || ''}`)) {
      changes.push('repaired_generic_answer_opening');
    }
  }

  const generatedImageContextRepair = repairGeneratedImageContext(blogHtml, input);
  if (generatedImageContextRepair.changed) {
    blogHtml = generatedImageContextRepair.text;
    changes.push('repaired_generated_image_context');
  }

  const placeholderReferenceRepair = removePlaceholderReferenceLinks(blogHtml);
  if (placeholderReferenceRepair.changed) {
    blogHtml = placeholderReferenceRepair.text;
    changes.push('removed_placeholder_reference_links');
  }

  const answerScaffoldRepair = removeRepetitiveAnswerScaffold(blogHtml);
  if (answerScaffoldRepair.changed) {
    blogHtml = answerScaffoldRepair.text;
    changes.push('removed_repetitive_answer_scaffold');
  }

  const repeatedAnswerHeadingRepair = removeRepeatedGenericAnswerHeadings(blogHtml);
  if (repeatedAnswerHeadingRepair.changed) {
    blogHtml = repeatedAnswerHeadingRepair.text;
    changes.push('removed_repeated_generic_answer_headings');
  }

  const faqRepair = dedupeRepeatedFaqBlocks(blogHtml);
  if (faqRepair.changed) {
    blogHtml = faqRepair.text;
    changes.push('deduped_repeated_faq_blocks');
  }

  const quickDecisionRepair = dedupeRepeatedQuickDecisionBlocks(blogHtml);
  if (quickDecisionRepair.changed) {
    blogHtml = quickDecisionRepair.text;
    changes.push('deduped_repeated_quick_decision_blocks');
  }

  const shortParagraphRepair = dedupeRepeatedShortParagraphs(blogHtml);
  if (shortParagraphRepair.changed) {
    blogHtml = shortParagraphRepair.text;
    changes.push('deduped_repeated_short_paragraphs');
  }

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

  const residualBoldRepair = removeResidualHtmlMarkdownBold(blogHtml);
  if (residualBoldRepair.changed) {
    blogHtml = residualBoldRepair.text;
    changes.push('removed_residual_html_markdown_bold');
  }

  const legacySurfaceRepair = removeLegacySurfaceArtifacts(blogHtml);
  if (legacySurfaceRepair.changed) {
    blogHtml = legacySurfaceRepair.text;
    changes.push('removed_legacy_surface_artifacts');
  }

  const customerPlaceholderRepair = repairCustomerVisiblePlaceholderCopy(blogHtml);
  if (customerPlaceholderRepair.changed) {
    blogHtml = customerPlaceholderRepair.text;
    changes.push('repaired_customer_visible_placeholder_copy');
  }

  const particleRepair = repairCommonParticleMisuse(blogHtml);
  if (particleRepair.changed) {
    blogHtml = particleRepair.text;
    changes.push('repaired_common_particle_misuse');
  }

  const toneRepair = softenPromotionalInfoTone(blogHtml);
  if (toneRepair.changed) {
    blogHtml = toneRepair.text;
    changes.push('softened_promotional_info_tone');
  }

  if (intent.mode === 'info') {
    const ctaRepair = moveEarlyStrongInfoCtaToBottom(blogHtml);
    if (ctaRepair.changed) {
      blogHtml = ctaRepair.text;
      changes.push('moved_early_info_cta_to_bottom');
    }
  }

  if (intent.mode === 'product' || intent.productSubtype) {
    const productConsultRepair = ensureProductConsultDecisionBlocks(blogHtml, input);
    if (productConsultRepair.changed) {
      blogHtml = productConsultRepair.text;
      changes.push('added_product_consult_decision_blocks');
    }
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

  const duplicateH1Repair = demoteDuplicateH1Headings(blogHtml);
  if (duplicateH1Repair.changed) {
    blogHtml = duplicateH1Repair.text;
    changes.push('demoted_duplicate_h1_headings');
  }

  const publishChecklistRepair = ensurePublishChecklist(blogHtml, input);
  if (publishChecklistRepair.changed) {
    blogHtml = publishChecklistRepair.text;
    changes.push('added_publish_checklist');
  }

  const weakChecklistRepair = repairWeakChecklistSection(blogHtml, input);
  if (weakChecklistRepair.changed) {
    blogHtml = weakChecklistRepair.text;
    changes.push('repaired_weak_checklist_section');
  }

  const comparisonDecisionRepair = ensureComparisonDecisionBlock(blogHtml, input);
  if (comparisonDecisionRepair.changed) {
    blogHtml = comparisonDecisionRepair.text;
    changes.push('added_comparison_decision_block');
  }

  const tableBoundaryRepair = ensureMarkdownTableBoundaries(blogHtml);
  if (tableBoundaryRepair.changed) {
    blogHtml = tableBoundaryRepair.text;
    changes.push('added_markdown_table_boundaries');
  }

  const earlyMisplacedTableSeparatorRepair = repairMisplacedMarkdownTableSeparators(blogHtml);
  if (earlyMisplacedTableSeparatorRepair.changed) {
    blogHtml = earlyMisplacedTableSeparatorRepair.text;
    changes.push('repaired_misplaced_table_separators');
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

  const repeatedHeadingRepair = dedupeRepeatedHeadings(blogHtml, 1);
  if (repeatedHeadingRepair.changed) {
    blogHtml = repeatedHeadingRepair.text;
    changes.push('deduped_repeated_headings');
  }

  const repeatedSupportRepair = dedupeRepeatedSupportBlocks(blogHtml);
  if (repeatedSupportRepair.changed) {
    blogHtml = repeatedSupportRepair.text;
    changes.push('deduped_repeated_support_blocks');
  }

  const listPipeRepair = flattenListPipes(blogHtml);
  if (listPipeRepair.changed) {
    blogHtml = listPipeRepair.text;
    changes.push('flattened_list_pipes');
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

  const repeatedReadabilityPhraseRepair = softenRepeatedReadabilityPhrases(blogHtml);
  if (repeatedReadabilityPhraseRepair.changed) {
    blogHtml = repeatedReadabilityPhraseRepair.text;
    changes.push('softened_repeated_readability_phrases');
  }

  const finalLooseTableRepair = repairLooseMarkdownTables(blogHtml);
  if (finalLooseTableRepair.changed) {
    blogHtml = finalLooseTableRepair.text;
    if (!changes.includes('repaired_loose_markdown_tables')) {
      changes.push('repaired_loose_markdown_tables');
    }
  }

  const finalBrokenTableRepair = forceRepairRemainingBrokenMarkdownTables(blogHtml);
  if (finalBrokenTableRepair.changed) {
    blogHtml = finalBrokenTableRepair.text;
    changes.push('force_repaired_broken_markdown_tables');
  }

  const shortTableRepair = repairTooShortMarkdownTables(blogHtml);
  if (shortTableRepair.changed) {
    blogHtml = shortTableRepair.text;
    changes.push('repaired_too_short_markdown_tables');
  }

  const finalAccentRepair = normalizeBlogVisualAccents(blogHtml);
  if (finalAccentRepair.changed) {
    blogHtml = finalAccentRepair.text;
    changes.push('normalized_visual_accents_final');
  }

  const finalLegacySurfaceRepair = removeLegacySurfaceArtifacts(blogHtml);
  if (finalLegacySurfaceRepair.changed) {
    blogHtml = finalLegacySurfaceRepair.text;
    if (!changes.includes('removed_legacy_surface_artifacts')) {
      changes.push('removed_legacy_surface_artifacts');
    }
  }

  const finalResidualBoldRepair = removeResidualHtmlMarkdownBold(blogHtml);
  if (finalResidualBoldRepair.changed) {
    blogHtml = finalResidualBoldRepair.text;
    if (!changes.includes('removed_residual_html_markdown_bold')) {
      changes.push('removed_residual_html_markdown_bold');
    }
  }

  const publicLinksRepaired = canonicalizeBlogPublicLinks(blogHtml);
  if (publicLinksRepaired !== blogHtml) {
    blogHtml = publicLinksRepaired;
    changes.push('repaired_public_link_surface');
  }

  const finalWeakChecklistRepair = repairWeakChecklistSection(blogHtml, input);
  if (finalWeakChecklistRepair.changed) {
    blogHtml = finalWeakChecklistRepair.text;
    if (!changes.includes('repaired_weak_checklist_section')) {
      changes.push('repaired_weak_checklist_section');
    }
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
    if (/^#{1,6}\s/.test(trimmed)) {
      const lines = paragraph.split('\n');
      const heading = lines[0] ?? '';
      const rest = lines.slice(1).join('\n').trim();
      if (!rest || stripMarkup(rest).replace(/\s+/g, ' ').trim().length < 360) {
        return paragraph;
      }
      if (/\[[^\]\n]+]\([^)]+/.test(rest)) {
        return `${heading.trim()}\n\n${rest}`;
      }

      const repairedRest = splitLongParagraphs(rest);
      changed = true;
      return `${heading.trim()}\n\n${repairedRest.text}`;
    }

    if (
      plain.length < 360 ||
      /\[[^\]\n]+]\([^)]+/.test(trimmed) ||
      /^\[[^\]\n]+]\([^)]+\)$/.test(trimmed) ||
      /^[-*]\s+\[[^\]\n]+]\([^)]+\)$/.test(trimmed) ||
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

function hasProductConsultDecisionContract(markdown: string): boolean {
  const source = markdown;
  const plain = stripMarkup(markdown).replace(/\s+/g, ' ').trim();
  return (
    /10\s*\uCD08\s*\uD310\uB2E8|\uBB38\uC758\s*\uC804\s*(?:\uD310\uB2E8|\uC694\uC57D)/i.test(source)
    && /\uD3EC\uD568\/\uBD88\uD3EC\uD568|\uD3EC\uD568\s*\uC0AC\uD56D[\s\S]{0,300}\uBD88\uD3EC\uD568\s*\uC0AC\uD56D/i.test(source)
    && /(\uC77C\uC815|\uAE30\uAC04|\uD56D\uACF5|\uCD9C\uBC1C|duration|airline)/i.test(plain)
    && /(\uAC00\uACA9|\uC694\uAE08|\uCD9C\uBC1C|price)/i.test(plain)
    && /\uB9DE\uB294\s*(?:\uC0AC\uB78C|\uBD84|\uACE0\uAC1D)|fit_for/i.test(source)
    && /\uC548\s*\uB9DE\uB294\s*(?:\uC0AC\uB78C|\uBD84|\uACE0\uAC1D)|\uB9DE\uC9C0\s*\uC54A\uB294|not_fit_for/i.test(source)
    && /\uAC00\uACA9\s*\uBCC0\uB3D9|\uAC00\uACA9(?:\uC774|\uC740)?\s*(?:\uB2EC\uB77C\uC9C8|\uBC14\uB00C|\uBCC0\uB3D9\uB420)\s*\uC218|risk_notes/i.test(source)
    && /\uBB38\uC758\s*\uC804\s*\uC9C8\uBB38|consult_questions/i.test(source)
  );
}

function ensureProductConsultDecisionBlocks(
  markdown: string,
  input: BlogEditorialRepairInput,
): { text: string; changed: boolean } {
  if (hasProductConsultDecisionContract(markdown)) {
    return { text: markdown, changed: false };
  }

  const destination = compactAnswerFirstLabel(input.destination || input.category || input.primaryKeyword || '\uC5EC\uD589\uC9C0') || '\uC5EC\uD589\uC9C0';
  const keyword = compactAnswerFirstLabel(input.primaryKeyword || input.title || (destination + ' \uD328\uD0A4\uC9C0')) || (destination + ' \uD328\uD0A4\uC9C0');
  const cta = /group-inquiry|\b\/packages\//i.test(markdown)
    ? ''
    : ['', '### \uB0B4 \uC77C\uC815 \uAE30\uC900\uC73C\uB85C \uD655\uC778', '', '- \uCD9C\uBC1C\uC77C, \uC778\uC6D0, \uAC1D\uC2E4 \uC870\uAC74\uC744 \uC54C\uB824\uC8FC\uC2DC\uBA74 \uD604\uC7AC \uAC00\uB2A5\uD55C \uC870\uAC74\uB9CC \uB2E4\uC2DC \uD655\uC778\uD569\uB2C8\uB2E4.'].join('\n');

  const block = [
    '',
    '## \uBB38\uC758 \uC804 10\uCD08 \uD310\uB2E8\uD45C',
    '',
    '| \uD655\uC778 \uD56D\uBAA9 | \uBA3C\uC800 \uBCFC \uB0B4\uC6A9 | \uBB38\uC758 \uC804 \uCCB4\uD06C |',
    '| --- | --- | --- |',
    '| \uAC00\uACA9/\uC694\uAE08 | ' + keyword + '\uC758 \uCD5C\uC885 \uAE08\uC561\uC740 \uCD9C\uBC1C\uC77C, \uC88C\uC11D, \uAC1D\uC2E4 \uC870\uAC74\uC5D0 \uB530\uB77C \uB2EC\uB77C\uC9C8 \uC218 \uC788\uC2B5\uB2C8\uB2E4. | \uD604\uC7AC \uAC00\uB2A5\uD55C \uB0A0\uC9DC\uC640 \uC778\uC6D0\uC744 \uD655\uC778\uD569\uB2C8\uB2E4. |',
    '| \uCD9C\uBC1C/\uAE30\uAC04 | \uD56D\uACF5 \uC2DC\uAC04, \uC774\uB3D9 \uB3D9\uC120, \uC219\uBC15 \uC218\uB97C \uD568\uAED8 \uBD10\uC57C \uC77C\uC815 \uBD80\uB2F4\uC744 \uD310\uB2E8\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. | \uC544\uC774/\uBD80\uBAA8\uB2D8 \uB3D9\uBC18\uC774\uBA74 \uC774\uB3D9 \uC2DC\uAC04\uC744 \uBA3C\uC800 \uD655\uC778\uD569\uB2C8\uB2E4. |',
    '| \uD3EC\uD568/\uBD88\uD3EC\uD568 | \uD3EC\uD568 \uC0AC\uD56D\uACFC \uBD88\uD3EC\uD568 \uC0AC\uD56D\uC744 \uB098\uB204\uC5B4 \uBD10\uC57C \uD604\uC9C0 \uCD94\uAC00\uBE44\uB97C \uC904\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4. | \uC120\uD0DD\uAD00\uAD11, \uAC1C\uC778\uACBD\uBE44, \uD301 \uC870\uAC74\uC744 \uD655\uC778\uD569\uB2C8\uB2E4. |',
    '',
    '### \uD3EC\uD568/\uBD88\uD3EC\uD568 \uD655\uC778',
    '',
    '- \uD3EC\uD568 \uC0AC\uD56D: \uC0C1\uD488 DB\uC5D0 \uBA85\uC2DC\uB41C \uD56D\uACF5, \uC219\uBC15, \uC77C\uC815, \uC2DD\uC0AC, \uCC28\uB7C9 \uC870\uAC74\uC744 \uAE30\uC900\uC73C\uB85C \uD655\uC778\uD569\uB2C8\uB2E4.',
    '- \uBD88\uD3EC\uD568 \uC0AC\uD56D: \uAC1C\uC778\uACBD\uBE44, \uC120\uD0DD\uAD00\uAD11, \uD604\uC9C0 \uACB0\uC81C \uC870\uAC74\uC740 \uC608\uC57D \uC804 \uB2E4\uC2DC \uD655\uC778\uD569\uB2C8\uB2E4.',
    '',
    '### \uC774\uB7F0 \uBD84\uAED8 \uB9DE\uC2B5\uB2C8\uB2E4',
    '',
    '- ' + destination + ' \uC77C\uC815\uC744 \uC9C1\uC811 \uBE44\uAD50\uD558\uAE30\uBCF4\uB2E4 \uAC00\uACA9, \uD3EC\uD568\uC0AC\uD56D, \uC774\uB3D9 \uBD80\uB2F4\uC744 \uBA3C\uC800 \uC815\uB9AC\uD558\uACE0 \uC2F6\uC740 \uBD84',
    '- \uCD9C\uBC1C \uAC00\uB2A5\uC77C\uACFC \uC778\uC6D0 \uAE30\uC900\uC73C\uB85C \uC2E4\uC81C \uC608\uC57D \uAC00\uB2A5 \uC5EC\uBD80\uB97C \uD655\uC778\uD558\uACE0 \uC2F6\uC740 \uBD84',
    '',
    '### \uB9DE\uC9C0 \uC54A\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4',
    '',
    '- \uC790\uC720\uC77C\uC815 \uBE44\uC911\uC774 \uD070 \uAC1C\uBCC4\uC5EC\uD589\uC744 \uC6D0\uD558\uB294 \uBD84',
    '- \uD638\uD154\uBA85, \uD56D\uACF5 \uC2DC\uAC04, \uAC1D\uC2E4 \uC870\uAC74\uC774 \uD655\uC815\uB418\uAE30 \uC804\uC5D0 \uBB38\uC758\uB97C \uC6D0\uD558\uC9C0 \uC54A\uB294 \uBD84',
    '',
    '### \uAC00\uACA9 \uBCC0\uB3D9 \uC870\uAC74',
    '',
    '- \uAC00\uACA9\uC774 \uB2EC\uB77C\uC9C8 \uC218 \uC788\uB294 \uD56D\uBAA9: \uCD9C\uBC1C\uC77C, \uC88C\uC11D \uC0C1\uD669, \uAC1D\uC2E4 \uB4F1\uAE09, \uD658\uC728, \uC120\uD0DD\uAD00\uAD11, \uC778\uC6D0 \uAD6C\uC131',
    '- \uC0C1\uD488 DB\uC5D0 \uC5C6\uB294 \uD655\uC815 \uD61C\uD0DD\uC774\uB098 \uD638\uD154\uBA85\uC740 \uC784\uC758\uB85C \uD310\uB2E8\uD558\uC9C0 \uC54A\uACE0 \uC0C1\uB2F4\uC5D0\uC11C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.',
    '',
    '### \uBB38\uC758 \uC804 \uC9C8\uBB38',
    '',
    '- \uCD9C\uBC1C \uAC00\uB2A5\uD55C \uB0A0\uC9DC\uC640 \uC778\uC6D0\uC740 \uC5B4\uB5BB\uAC8C \uB418\uB098\uC694?',
    '- \uC544\uC774, \uBD80\uBAA8\uB2D8, \uB2E8\uCCB4 \uB3D9\uBC18 \uC5EC\uBD80\uAC00 \uC788\uB098\uC694?',
    '- \uAF2D \uD3EC\uD568\uB418\uC5B4\uC57C \uD558\uB294 \uC77C\uC815\uC774\uB098 \uD53C\uD558\uACE0 \uC2F6\uC740 \uC77C\uC815\uC774 \uC788\uB098\uC694?',
    cta,
  ].filter(Boolean).join('\n');

  const text = `${markdown.trim()}\n\n${block}`.replace(/\n{4,}/g, '\n\n\n').trim();
  return { text, changed: text !== markdown };
}

export function repairBlogEditorialQuality(input: BlogEditorialRepairInput): BlogEditorialRepairResult {
  const before = inspectBlogIntentQuality(input);
  const intent = classifyBlogIntent(input);
  const changes: string[] = [];
  let blogHtml = input.blogHtml;

  const clicheRepair = removeAiEditorialCliches(blogHtml);
  if (clicheRepair.changed) {
    blogHtml = clicheRepair.text;
    changes.push('removed_ai_editorial_cliches');
  }

  const semanticSurfaceRepair = repairAwkwardSemanticSurface(blogHtml, input);
  if (semanticSurfaceRepair.changed) {
    blogHtml = semanticSurfaceRepair.text;
    changes.push('repaired_semantic_surface');
  }

  const articleQualityV2Repair = repairArticleQualityV2Surface(blogHtml, input);
  if (articleQualityV2Repair.changed) {
    blogHtml = articleQualityV2Repair.text;
    changes.push('repaired_article_quality_v2_surface');
    if (/weather|날씨|옷차림|월별\s*날씨|기온|강수|우기|건기|일교차/i.test(`${input.primaryKeyword || ''} ${input.title || ''} ${input.category || ''} ${input.slug || ''}`)) {
      changes.push('repaired_generic_answer_opening');
    }
  }

  const generatedImageContextRepair = repairGeneratedImageContext(blogHtml, input);
  if (generatedImageContextRepair.changed) {
    blogHtml = generatedImageContextRepair.text;
    changes.push('repaired_generated_image_context');
  }

  const placeholderReferenceRepair = removePlaceholderReferenceLinks(blogHtml);
  if (placeholderReferenceRepair.changed) {
    blogHtml = placeholderReferenceRepair.text;
    changes.push('removed_placeholder_reference_links');
  }

  const directiveRepair = removeRawDirectiveLeaks(blogHtml);
  if (directiveRepair.changed) {
    blogHtml = directiveRepair.text;
    changes.push('removed_raw_directive_leaks');
  }

  const answerScaffoldRepair = removeRepetitiveAnswerScaffold(blogHtml);
  if (answerScaffoldRepair.changed) {
    blogHtml = answerScaffoldRepair.text;
    changes.push('removed_repetitive_answer_scaffold');
  }

  const repeatedAnswerHeadingRepair = removeRepeatedGenericAnswerHeadings(blogHtml);
  if (repeatedAnswerHeadingRepair.changed) {
    blogHtml = repeatedAnswerHeadingRepair.text;
    changes.push('removed_repeated_generic_answer_headings');
  }

  const faqRepair = dedupeRepeatedFaqBlocks(blogHtml);
  if (faqRepair.changed) {
    blogHtml = faqRepair.text;
    changes.push('deduped_repeated_faq_blocks');
  }

  const quickDecisionRepair = dedupeRepeatedQuickDecisionBlocks(blogHtml);
  if (quickDecisionRepair.changed) {
    blogHtml = quickDecisionRepair.text;
    changes.push('deduped_repeated_quick_decision_blocks');
  }

  const shortParagraphRepair = dedupeRepeatedShortParagraphs(blogHtml);
  if (shortParagraphRepair.changed) {
    blogHtml = shortParagraphRepair.text;
    changes.push('deduped_repeated_short_paragraphs');
  }

  const repeatedReadabilityPhraseRepair = softenRepeatedReadabilityPhrases(blogHtml);
  if (repeatedReadabilityPhraseRepair.changed) {
    blogHtml = repeatedReadabilityPhraseRepair.text;
    changes.push('softened_repeated_readability_phrases');
  }

  const accentRepair = normalizeBlogVisualAccents(blogHtml);
  if (accentRepair.changed) {
    blogHtml = accentRepair.text;
    changes.push('normalized_visual_accents');
  }

  const legacySurfaceRepair = removeLegacySurfaceArtifacts(blogHtml);
  if (legacySurfaceRepair.changed) {
    blogHtml = legacySurfaceRepair.text;
    changes.push('removed_legacy_surface_artifacts');
  }

  const customerPlaceholderRepair = repairCustomerVisiblePlaceholderCopy(blogHtml);
  if (customerPlaceholderRepair.changed) {
    blogHtml = customerPlaceholderRepair.text;
    changes.push('repaired_customer_visible_placeholder_copy');
  }

  const particleRepair = repairCommonParticleMisuse(blogHtml);
  if (particleRepair.changed) {
    blogHtml = particleRepair.text;
    changes.push('repaired_common_particle_misuse');
  }

  const yeosonamDataRepair = softenUnsupportedYeosonamDataClaims(blogHtml);
  if (yeosonamDataRepair.changed) {
    blogHtml = yeosonamDataRepair.text;
    changes.push('softened_unsupported_yeosonam_data_claims');
  }

  const editorVoiceRepair = removeYeosonamEditorVoice(blogHtml);
  if (editorVoiceRepair.changed) {
    blogHtml = editorVoiceRepair.text;
    changes.push('removed_yeosonam_editor_voice');
  }

  if (intent.mode === 'info') {
    const answerFirstRepair = ensureInfoAnswerFirst(blogHtml, { ...input, blogHtml });
    if (answerFirstRepair.changed) {
      blogHtml = answerFirstRepair.text;
      changes.push('added_answer_first_intro');
    }

    const genericAnswerRepair = repairGenericInfoAnswerOpening(blogHtml, { ...input, blogHtml });
    if (genericAnswerRepair.changed) {
      blogHtml = genericAnswerRepair.text;
      changes.push('repaired_generic_answer_opening');
    }

    const ctaRepair = moveEarlyStrongInfoCtaToBottom(blogHtml);
    if (ctaRepair.changed) {
      blogHtml = ctaRepair.text;
      changes.push('moved_early_info_cta_to_bottom');
    }

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

  if (intent.mode === 'info' || intent.mode === 'hybrid') {
    const requiredInfoTableRepair = ensureRequiredInfoDecisionTable(blogHtml, input, intent.infoSubtype);
    if (requiredInfoTableRepair.changed) {
      blogHtml = requiredInfoTableRepair.text;
      changes.push('added_required_info_decision_table');
    }
  }

  if (intent.infoSubtype === 'comparison' || intent.readerIntent === 'decide') {
    const comparisonDecisionRepair = ensureComparisonDecisionBlock(blogHtml, input);
    if (comparisonDecisionRepair.changed) {
      blogHtml = comparisonDecisionRepair.text;
      changes.push('added_comparison_decision_block');
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

  if (intent.mode === 'product' || intent.productSubtype) {
    const productConsultRepair = ensureProductConsultDecisionBlocks(blogHtml, input);
    if (productConsultRepair.changed) {
      blogHtml = productConsultRepair.text;
      changes.push('added_product_consult_decision_blocks');
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

  const finalLegacySurfaceRepair = removeLegacySurfaceArtifacts(blogHtml);
  if (finalLegacySurfaceRepair.changed) {
    blogHtml = finalLegacySurfaceRepair.text;
    if (!changes.includes('removed_legacy_surface_artifacts')) {
      changes.push('removed_legacy_surface_artifacts');
    }
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
