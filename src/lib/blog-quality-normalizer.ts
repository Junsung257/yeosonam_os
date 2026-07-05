import { ensureRequiredBlogDecisionBlocks } from './blog-required-structure';

interface NormalizeBlogContentInput {
  markdown: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  maxHighlights?: number;
}

const SUMMARY_HEADING_REGEX = /(^|\n)##\s*(TL;DR|핵심 요약|한눈에|요약)\s*($|\n)/im;
const FAQ_HEADING_REGEX = /(^|\n)##\s*(FAQ|자주 묻는 질문)\s*($|\n)/im;
const REWRITE_KR = '\uC7AC\uC791\uC131';
const BOOSTER_KR = '(?:\\uCD94\\uCC9C|\\uC644\\uBCBD|\\uC9C1\\uC811)';
const REWRITE_ARTIFACT_REGEXES = [
  new RegExp(`\\s*[-–—:|/]\\s*(${REWRITE_KR}|rewrite)\\s*v?\\d+\\b`, 'gi'),
  new RegExp(`\\((${REWRITE_KR}|rewrite)\\s*v?\\d+\\)`, 'gi'),
  new RegExp(`\\[((${REWRITE_KR}|rewrite)\\s*v?\\d+)\\]`, 'gi'),
  new RegExp(`\\b(${REWRITE_KR}|rewrite)\\s*v?\\d+\\b`, 'gi'),
];

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function removeRewriteArtifactsTitle(value: string): string {
  let next = value;
  for (const pattern of REWRITE_ARTIFACT_REGEXES) {
    next = next.replace(pattern, '');
  }
  return next
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([)|\]])/g, '$1')
    .replace(/([(|\[])\s+/g, '$1')
    .replace(/\s+[-–—:|/]\s*$/g, '')
    .trim();
}

function removeRewriteArtifactsMarkdown(value: string): string {
  let next = value;
  for (const pattern of REWRITE_ARTIFACT_REGEXES) {
    next = next.replace(pattern, '');
  }
  return next
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([)|\]])/g, '$1')
        .replace(/([(|\[])[ \t]+/g, '$1')
        .replace(/[ \t]+$/g, ''),
    )
    .join('\n')
    .trim();
}

function removeBoosterSuffixes(value: string): string {
  return value
    .replace(new RegExp(`\\s*[-–—|]\\s*${BOOSTER_KR}(?=\\s*$)`, 'gi'), '')
    .replace(new RegExp(`\\s*[-–—]\\s*${BOOSTER_KR}\\s*([|·])`, 'gi'), ' $1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function collapseAdjacentDuplicateTitleTokens(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  const collapsed: string[] = [];
  for (const token of tokens) {
    const previous = collapsed[collapsed.length - 1];
    const normalized = token.replace(/[|·ㆍ•,()[\]{}:!?]/g, '').toLowerCase();
    const previousNormalized = previous?.replace(/[|·ㆍ•,()[\]{}:!?]/g, '').toLowerCase();
    if (normalized.length >= 2 && normalized === previousNormalized && !/^20\d{2}$/.test(normalized)) {
      continue;
    }
    collapsed.push(token);
  }
  return collapsed.join(' ');
}

function limitHighlights(markdown: string, maxHighlights: number): string {
  let count = 0;
  let next = markdown.replace(/==([^=]+)==/g, (full, inner) => {
    count += 1;
    return count <= maxHighlights ? full : inner.trim();
  });

  next = next.replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, (full, inner) => {
    count += 1;
    return count <= maxHighlights ? full : String(inner).trim();
  });

  return next;
}

function buildSummaryBullets(destination: string, primaryKeyword: string, markdown: string): string[] {
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)]
    .map((match) => cleanText(match[1].replace(/\[|\]/g, '')))
    .filter((heading) => !/FAQ|자주 묻는 질문|핵심 요약|한눈에|요약/i.test(heading))
    .slice(0, 4);

  if (headings.length >= 3) {
    return headings.map((heading) => `- ${heading} 포인트를 먼저 확인하세요.`);
  }

  return [
    `- ${destination} 여행 전에는 날씨, 이동, 비용 변수를 먼저 확인하세요.`,
    `- ${primaryKeyword} 관련 준비물과 예약 타이밍을 함께 점검하는 편이 안전합니다.`,
    '- 운영시간, 입장 조건, 환불 기준은 출발 직전에 한 번 더 재확인하세요.',
    '- 광고성 표현보다 실제 일정에 영향을 주는 조건부터 체크하는 것이 효율적입니다.',
  ];
}

function ensureSummarySection(markdown: string, destination: string, primaryKeyword: string): string {
  if (SUMMARY_HEADING_REGEX.test(markdown)) return markdown;

  const summaryBlock = `## 핵심 요약\n\n${buildSummaryBullets(destination, primaryKeyword, markdown).join('\n')}\n\n`;
  const firstH2Index = markdown.search(/^##\s+/m);
  if (firstH2Index >= 0) {
    return `${markdown.slice(0, firstH2Index).trimEnd()}\n\n${summaryBlock}${markdown.slice(firstH2Index).trimStart()}`;
  }
  return `${markdown.trimEnd()}\n\n${summaryBlock}`;
}

function buildFaqSection(destination: string, primaryKeyword: string): string {
  return [
    '## 자주 묻는 질문',
    '',
    `### ${destination} 여행은 언제 준비하는 편이 좋나요?`,
    `항공권, 숙소, 환율, 현지 운영시간을 함께 보려면 최소 2~4주 전에 ${primaryKeyword} 관련 조건을 비교하는 편이 안전합니다.`,
    '',
    `### ${primaryKeyword} 정보를 볼 때 가장 먼저 확인할 항목은 무엇인가요?`,
    '가격보다 먼저 출발 가능일, 이동 동선, 취소 조건, 현지 운영 여부를 확인해야 실제 일정이 틀어지지 않습니다.',
    '',
    `### 출발 직전에 다시 확인해야 할 것은 무엇인가요?`,
    `${destination} 현지 날씨, 공식 운영 공지, 항공 스케줄, 입장 규정처럼 당일 변동 가능성이 있는 항목은 출발 직전에 다시 확인하는 편이 좋습니다.`,
    '',
  ].join('\n');
}

function ensureFaqSection(markdown: string, destination: string, primaryKeyword: string): string {
  if (FAQ_HEADING_REGEX.test(markdown)) return markdown;
  return `${markdown.trimEnd()}\n\n${buildFaqSection(destination, primaryKeyword)}`;
}

export function normalizeBlogTitle(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null;
  const cleaned = collapseAdjacentDuplicateTitleTokens(removeBoosterSuffixes(removeRewriteArtifactsTitle(title))
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s*·\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim());
  return cleaned || null;
}

export function normalizeBlogDescription(description: string | null | undefined): string | null {
  if (typeof description !== 'string') return null;
  const cleaned = removeBoosterSuffixes(removeRewriteArtifactsTitle(description))
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s*·\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || null;
}

export function normalizeBlogContent(input: NormalizeBlogContentInput): string {
  const destination = cleanText(removeRewriteArtifactsTitle(input.destination || '여행지'));
  const primaryKeyword = cleanText(removeRewriteArtifactsTitle(input.primaryKeyword || destination || '여행 정보'));
  let next = removeRewriteArtifactsMarkdown(input.markdown);
  next = ensureSummarySection(next, destination, primaryKeyword);
  next = ensureRequiredBlogDecisionBlocks(next, { destination, primaryKeyword });
  next = ensureFaqSection(next, destination, primaryKeyword);
  next = limitHighlights(next, input.maxHighlights ?? 5);
  return next.trim();
}
