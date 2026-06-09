import { load } from 'cheerio';
import type { Element } from 'domhandler';

export type BlogStructureIssueCode =
  | 'table_prose_contamination'
  | 'raw_directive_leak'
  | 'heading_shape_invalid'
  | 'duplicate_core_block'
  | 'checklist_shape_invalid'
  | 'content_type_tone_mismatch';

export type BlogStructureIssueSeverity = 'critical' | 'warning';

export interface BlogStructureIssue {
  code: BlogStructureIssueCode;
  severity: BlogStructureIssueSeverity;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface BlogStructureAuditInput {
  rawMarkdown: string;
  renderedHtml: string;
  title?: string | null;
  slug?: string | null;
  angleType?: string | null;
  primaryKeyword?: string | null;
}

export interface BlogStructureAuditReport {
  passed: boolean;
  score: number;
  issues: BlogStructureIssue[];
}

const CORE_BLOCK_HEADINGS = new Set(['핵심 요약', '자주 묻는 질문', 'FAQ', 'Q&A']);
const WEATHER_INTENT_RE = /(날씨|옷차림|월별|우기|기온|계절|강수량|장마)/;
const PRODUCT_TONE_RE = /(상품을 고른 이유|이 상품|상품 상세|출발가|특가|노팁|노쇼핑|포함 사항|불포함 사항)/;
const LONG_PROSE_RE = /(입니다|합니다|하세요|됩니다|좋습니다|추천|여행|준비|확인|주의|팁|가능)/;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function addIssue(
  issues: BlogStructureIssue[],
  code: BlogStructureIssueCode,
  severity: BlogStructureIssueSeverity,
  message: string,
  evidence?: Record<string, unknown>,
): void {
  issues.push({ code, severity, message, evidence });
}

function hasOnlyEmptyTrailingCells(cells: string[]): boolean {
  return cells.length >= 2 && cells.slice(1).every((cell) => normalizeText(cell).length === 0);
}

function inspectTables(input: BlogStructureAuditInput, issues: BlogStructureIssue[]): void {
  const $ = load(input.renderedHtml);

  $('table').each((tableIndex, table) => {
    $(table)
      .find('tr')
      .each((rowIndex, row) => {
        const cells = $(row)
          .children('td, th')
          .toArray()
          .map((cell) => normalizeText($(cell).text()));
        if (cells.length === 0) return;

        const firstCell = cells[0] ?? '';
        const rowHtml = $.html(row);
        const rowHasBlockContent = $(row).find('td aside, td p, td ul, td ol, td blockquote').length > 0;
        const rowHasRawDirective = rowHtml.includes(':::');
        const proseInFirstCell =
          rowIndex > 0 &&
          firstCell.length >= 45 &&
          LONG_PROSE_RE.test(firstCell) &&
          hasOnlyEmptyTrailingCells(cells);

        if (proseInFirstCell || rowHasBlockContent || rowHasRawDirective) {
          addIssue(
            issues,
            'table_prose_contamination',
            'critical',
            'Table contains prose, directives, or block content inside cells. Move narrative text outside the table before publishing.',
            {
              tableIndex,
              rowIndex,
              firstCellPreview: firstCell.slice(0, 120),
              cellCount: cells.length,
              rowHasBlockContent,
              rowHasRawDirective,
            },
          );
        }
      });
  });
}

function inspectRawDirectives(input: BlogStructureAuditInput, issues: BlogStructureIssue[]): void {
  const $ = load(input.renderedHtml);
  const visibleText = normalizeText($.root().text());
  if (visibleText.includes(':::')) {
    addIssue(
      issues,
      'raw_directive_leak',
      'critical',
      'Raw markdown/admonition directive is visible in the article body.',
      { sample: visibleText.match(/.{0,40}:::.{0,40}/)?.[0] ?? ':::' },
    );
  }
}

function inspectHeadings(input: BlogStructureAuditInput, issues: BlogStructureIssue[]): void {
  const $ = load(input.renderedHtml);
  const seen = new Map<string, number>();

  $('h2, h3').each((index, heading) => {
    const text = normalizeText($(heading).text());
    const normalized = text.replace(/\s+/g, ' ');
    if (!normalized) return;

    seen.set(normalized, (seen.get(normalized) ?? 0) + 1);

    const hasQuestionInsideFaqHeading = /^자주 묻는 질문\s+Q\d+[.)]?\s/.test(normalized);
    const hasCollapsedNumberedSection = /\s\d+\.\s+\S/.test(normalized) && normalized.length >= 24;
    const isOverlong = normalized.length > 90;

    if (hasQuestionInsideFaqHeading || hasCollapsedNumberedSection || isOverlong) {
      addIssue(
        issues,
        'heading_shape_invalid',
        'warning',
        'Heading appears to contain collapsed body text or FAQ content.',
        { index, heading: normalized.slice(0, 140), hasQuestionInsideFaqHeading, hasCollapsedNumberedSection, isOverlong },
      );
    }
  });

  for (const [heading, count] of seen.entries()) {
    if (count <= 1 || !CORE_BLOCK_HEADINGS.has(heading)) continue;
    addIssue(
      issues,
      'duplicate_core_block',
      'critical',
      'Core article block heading is duplicated.',
      { heading, count },
    );
  }
}

function closestListItemText($: ReturnType<typeof load>, checklistHeading: Element): string[] {
  const sectionTexts: string[] = [];
  let cursor = $(checklistHeading).next();

  while (cursor.length > 0 && !/^h[1-3]$/i.test(cursor[0]?.tagName ?? '')) {
    cursor.find('li').each((_index, item) => {
      sectionTexts.push(normalizeText($(item).text()));
    });
    cursor = cursor.next();
  }

  return sectionTexts;
}

function inspectChecklist(input: BlogStructureAuditInput, issues: BlogStructureIssue[]): void {
  const $ = load(input.renderedHtml);
  const checklistHeadings = $('h2, h3')
    .toArray()
    .filter((heading) => /체크리스트|준비물|필수 아이템/.test(normalizeText($(heading).text())));

  if (checklistHeadings.length === 0 && /체크리스트|준비물|필수 아이템/.test(input.rawMarkdown)) {
    addIssue(
      issues,
      'checklist_shape_invalid',
      'critical',
      'Checklist intent exists in source but no checklist heading rendered.',
    );
    return;
  }

  let hasValidChecklist = false;
  const invalidChecklistEvidence: Array<Record<string, unknown>> = [];

  for (const heading of checklistHeadings) {
    const items = closestListItemText($, heading);
    const collapsedItems = items.filter((item) => item.length > 150 || /\s\d+\.\s+\S/.test(item));
    if (items.length >= 3 && collapsedItems.length === 0) {
      hasValidChecklist = true;
      continue;
    }

    invalidChecklistEvidence.push({
      heading: normalizeText($(heading).text()),
      itemCount: items.length,
      collapsedItems: collapsedItems.slice(0, 3).map((item) => item.slice(0, 140)),
    });
  }

  if (checklistHeadings.length > 0 && !hasValidChecklist) {
    addIssue(
      issues,
      'checklist_shape_invalid',
      'critical',
      'Checklist must render as short, separate list items instead of collapsed prose.',
      invalidChecklistEvidence[0],
    );
  }
}

function inspectTone(input: BlogStructureAuditInput, issues: BlogStructureIssue[]): void {
  const $ = load(input.renderedHtml);
  const visibleText = normalizeText($.root().text());
  const intentText = normalizeText([
    input.title,
    input.slug,
    input.primaryKeyword,
    input.angleType,
    visibleText.slice(0, 500),
  ].filter(Boolean).join(' '));

  if (WEATHER_INTENT_RE.test(intentText) && PRODUCT_TONE_RE.test(visibleText)) {
    addIssue(
      issues,
      'content_type_tone_mismatch',
      'critical',
      'Informational weather article contains product-sales wording. Use guide/explainer tone or change the content type.',
      {
        matchedIntent: intentText.match(WEATHER_INTENT_RE)?.[0],
        matchedTone: visibleText.match(PRODUCT_TONE_RE)?.[0],
      },
    );
  }
}

export function inspectBlogStructure(input: BlogStructureAuditInput): BlogStructureAuditReport {
  const issues: BlogStructureIssue[] = [];

  inspectTables(input, issues);
  inspectRawDirectives(input, issues);
  inspectHeadings(input, issues);
  inspectChecklist(input, issues);
  inspectTone(input, issues);

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const score = Math.max(0, 100 - criticalCount * 20 - warningCount * 5);

  return {
    passed: criticalCount === 0,
    score,
    issues,
  };
}
