import type { BlogInformationClaimInput } from './blog-information-evidence';
import type { BlogInformationIntent } from './blog-information-contract';

export interface BlogAiReadableRepairInput {
  markdown: string;
  keyword: string;
  intent: BlogInformationIntent;
  approvedClaims?: BlogInformationClaimInput[];
  maxH2?: number;
}

export interface BlogAiReadableRepairResult {
  markdown: string;
  changed: boolean;
  changes: string[];
}

const FAQ_HEADING = /^##\s*(?:자주\s*묻는\s*질문|FAQ|Q\s*&\s*A|자주\s*하는\s*질문)\s*$/i;
const QUESTION_H2 = /^##\s+.+[?？]\s*$/;

const PROTECTED_SECONDARY_HEADING = /^(?:#{3,6})\s+(?:Q\d{0,2}[.:]?\s|근거로\s*확인한|지역별\s*가격\s*차이|세금·서비스료·예약\s*조건)/i;

function clean(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function buildFoodBudgetFaq(keyword: string, claims: BlogInformationClaimInput[]): string | null {
  const exactClaims = claims
    .map((claim) => clean(claim.claimText))
    .filter(Boolean);
  const daily = exactClaims.filter((claim) => /하루\s*식비/.test(claim));
  const meals = exactClaims.filter((claim) => /(?:아침|점심|저녁)\s*식사/.test(claim));
  const snack = exactClaims.find((claim) => /간식|커피|카페|스낵/.test(claim));
  if (daily.length < 3 || meals.length < 3 || !snack) return null;

  return [
    '## 자주 묻는 질문',
    '',
    `### Q1. ${keyword}의 1인 하루 식비는 예산 유형별로 얼마인가요?`,
    "A. 위의 '근거로 확인한 1인 하루 식비' 표에서 절약·일반·여유 유형을 비교하세요. 조사 근거에 연결된 값만 표에 표시했습니다.",
    '',
    `### Q2. ${keyword}의 아침·점심·저녁 식비는 어느 정도인가요?`,
    "A. 위의 '근거로 확인한 끼니별 가격' 표에서 아침·점심·저녁 항목을 확인하세요. 같은 기준의 근거값을 한 표로 모았습니다.",
    '',
    `### Q3. ${keyword}의 간식·커피 기준 가격은 얼마인가요?`,
    "A. '근거로 확인한 끼니별 가격' 표의 간식·커피 행을 확인하세요. 본문은 근거에 없는 추가 금액을 추정하지 않습니다.",
  ].join('\n');
}

function makeQuestionHeading(line: string, keyword: string): string {
  const heading = line
    .replace(/^##\s+/, '')
    .replace(/[?？]\s*$/, '')
    .replace(/\s*(?:확인\s*방법|가이드|정리|체크)\s*$/, '')
    .trim();
  const subject = heading || keyword;
  if (/가격\s*차이/.test(subject)) return `## ${subject}는 어떻게 확인할까?`;
  return `## ${subject}, 무엇을 확인해야 할까?`;
}

function ensureQuestionH2(markdown: string, keyword: string): { markdown: string; changed: boolean } {
  if (markdown.split('\n').some((line) => QUESTION_H2.test(line.trim()))) {
    return { markdown, changed: false };
  }

  const lines = markdown.split('\n');
  const preferred = lines.findIndex((line) =>
    /^##\s+\S/.test(line.trim())
    && !FAQ_HEADING.test(line.trim())
    && /확인\s*방법|가격\s*차이|선택\s*기준|주의|체크|준비|비교/.test(line),
  );
  const fallback = lines.findIndex((line) => /^##\s+\S/.test(line.trim()) && !FAQ_HEADING.test(line.trim()));
  const index = preferred >= 0 ? preferred : fallback;
  if (index >= 0) {
    lines[index] = makeQuestionHeading(lines[index] || '', keyword);
    return { markdown: lines.join('\n'), changed: true };
  }

  return {
    markdown: `${markdown.trim()}\n\n## ${keyword}, 무엇을 확인해야 할까?\n\n본문의 근거와 비교 기준을 순서대로 확인하세요.`,
    changed: true,
  };
}

function capH2PreservingAnswerBlocks(markdown: string, maxH2: number): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const h2Indexes = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => /^##\s+\S/.test(line));
  let excess = h2Indexes.length - maxH2;
  if (excess <= 0) return { markdown, changed: false };

  const demotionCandidates = h2Indexes
    .filter(({ line }) => !QUESTION_H2.test(line) && !FAQ_HEADING.test(line))
    .reverse();
  for (const candidate of demotionCandidates) {
    if (excess <= 0) break;
    lines[candidate.index] = (lines[candidate.index] || '').replace(/^##\s+/, '### ');
    excess -= 1;
  }

  return { markdown: lines.join('\n'), changed: true };
}

function capTotalHeadings(markdown: string, maxHeadings: number): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const headingIndexes = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => /^#{2,6}\s+\S/.test(line));
  const originalExcess = headingIndexes.length - maxHeadings;
  let excess = originalExcess;
  if (excess <= 0) return { markdown, changed: false };

  const candidates = headingIndexes
    .filter(({ line }) => /^#{3,6}\s+\S/.test(line) && !PROTECTED_SECONDARY_HEADING.test(line))
    .reverse();
  for (const candidate of candidates) {
    if (excess <= 0) break;
    const label = candidate.line.replace(/^#{3,6}\s+/, '').trim();
    lines[candidate.index] = `**${label}**`;
    excess -= 1;
  }

  return { markdown: lines.join('\n'), changed: excess < originalExcess };
}

function removeEmptyHeadingSections(markdown: string): { markdown: string; changed: boolean } {
  const lines = markdown.split('\n');
  const headings = lines
    .map((line, index) => {
      const match = line.trim().match(/^(#{2,6})\s+\S/);
      return match ? { index, depth: match[1]!.length } : null;
    })
    .filter((heading): heading is { index: number; depth: number } => heading !== null);
  const remove = new Set<number>();

  for (const heading of headings) {
    const boundary = headings.find((candidate) =>
      candidate.index > heading.index && candidate.depth <= heading.depth)?.index ?? lines.length;
    const hasContent = lines.slice(heading.index + 1, boundary).some((line) => {
      const value = line.trim();
      if (!value || /^#{2,6}\s+\S/.test(value) || /^<!--(?:[\s\S]*?)-->$/.test(value)) return false;
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(value)) return false;
      if (/^(?:!\[[^\]]*]\([^)]+\)|[-*+]\s+\S|\d+[.)]\s+\S|>\s+\S|\|.*\|)$/.test(value)) return true;
      if (/<(?:img|table|ul|ol|blockquote)\b/i.test(value)) return true;
      return value.replace(/<[^>]+>/g, '').trim().length > 0;
    });
    if (!hasContent) remove.add(heading.index);
  }

  if (remove.size === 0) return { markdown, changed: false };
  return {
    markdown: lines.filter((_, index) => !remove.has(index)).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    changed: true,
  };
}

/**
 * Repairs AI-readable structure without inventing facts. Evidence-backed FAQ answers
 * are emitted only for an intent whose required claims have already passed preflight.
 */
export function repairBlogAiReadableStructure(input: BlogAiReadableRepairInput): BlogAiReadableRepairResult {
  const changes: string[] = [];
  const keyword = clean(input.keyword) || '여행 정보';
  const maxH2 = Math.max(5, Math.min(9, input.maxH2 ?? 9));
  let markdown = input.markdown.trim();

  const questionRepair = ensureQuestionH2(markdown, keyword);
  if (questionRepair.changed) {
    markdown = questionRepair.markdown;
    changes.push('ensured_question_h2');
  }

  if (!markdown.split('\n').some((line) => FAQ_HEADING.test(line.trim())) && input.intent === 'food_budget') {
    const faq = buildFoodBudgetFaq(keyword, input.approvedClaims ?? []);
    if (faq) {
      markdown = `${markdown.trim()}\n\n${faq}`;
      changes.push('added_evidence_grounded_food_budget_faq');
    }
  }

  const capRepair = capH2PreservingAnswerBlocks(markdown, maxH2);
  if (capRepair.changed) {
    markdown = capRepair.markdown;
    changes.push('capped_h2_preserving_question_and_faq');
  }

  const totalCapRepair = capTotalHeadings(markdown, 20);
  if (totalCapRepair.changed) {
    markdown = totalCapRepair.markdown;
    changes.push('capped_total_heading_count');
  }

  const emptyHeadingRepair = removeEmptyHeadingSections(markdown);
  if (emptyHeadingRepair.changed) {
    markdown = emptyHeadingRepair.markdown;
    changes.push('removed_empty_heading_sections');
  }

  return {
    markdown,
    changed: markdown !== input.markdown,
    changes,
  };
}
