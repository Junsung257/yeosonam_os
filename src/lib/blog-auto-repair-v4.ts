export interface BlogAutoRepairInputV4 {
  markdown: string;
  blogType: 'info' | 'product';
  title?: string | null;
  primaryKeyword?: string | null;
  destination?: string | null;
  category?: string | null;
}

export interface BlogAutoRepairResultV4 {
  markdown: string;
  changed: boolean;
  changes: string[];
}

const CHECKLIST_HEADING_RE = /(?:checklist|packing\s+list|체크\s*리스트|체크리스트|준비물|필수\s*아이템|확인\s*목록)/i;
const CHECKLIST_INTENT_RE = /checklist|packing|preparation|체크\s*리스트|체크리스트|준비물|필수|확인\s*목록/i;
const WEATHER_OR_PREPARATION_RE = /weather|packing|preparation|날씨|옷차림|준비물|체크\s*리스트|체크리스트|기온|강수|우기|건기/i;
const SALES_OR_BOOKING_RE = /비용|가격|예약|결제|상담|상품|구매/;

function cleanLabel(value: string | null | undefined): string {
  return String(value || '')
    .replace(/[#*_`[\]()>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function firstBodyParagraphRange(lines: string[], startIndex: number): { start: number; end: number } | null {
  let start = startIndex;
  while (start < lines.length) {
    const line = lines[start]?.trim() || '';
    if (!line || /^!\[[^\]]*\]\([^)]+\)/.test(line)) {
      start += 1;
      continue;
    }
    if (/^#{1,6}\s+/.test(line) || /^\|/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      return null;
    }
    break;
  }
  if (start >= lines.length) return null;

  let end = start;
  while (end < lines.length) {
    const line = lines[end]?.trim() || '';
    if (!line || /^#{1,6}\s+/.test(line) || /^!\[[^\]]*\]\([^)]+\)/.test(line) || /^\|/.test(line)) break;
    end += 1;
  }
  return end > start ? { start, end } : null;
}

function repairInformationalIntro(input: BlogAutoRepairInputV4): { markdown: string; changed: boolean } {
  if (input.blogType !== 'info') return { markdown: input.markdown, changed: false };

  const context = [input.title, input.primaryKeyword, input.destination, input.category]
    .filter(Boolean)
    .join(' ');
  if (!WEATHER_OR_PREPARATION_RE.test(context)) return { markdown: input.markdown, changed: false };

  const lines = input.markdown.split(/\r?\n/);
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const range = firstBodyParagraphRange(lines, h1Index >= 0 ? h1Index + 1 : 0);
  if (!range) return { markdown: input.markdown, changed: false };

  const current = lines.slice(range.start, range.end).join(' ').replace(/\s+/g, ' ').trim();
  if (!SALES_OR_BOOKING_RE.test(current.slice(0, 220))) return { markdown: input.markdown, changed: false };

  const label = cleanLabel(input.primaryKeyword || input.title || input.destination) || '이 여행 정보';
  const safeIntro = `${label}를 준비할 때는 어떤 기준을 먼저 비교할까요? 아래 근거를 확인하고 내 일정에 필요한 조건을 선택하세요.`;
  lines.splice(range.start, range.end - range.start, safeIntro);
  return { markdown: lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim(), changed: true };
}

function splitCollapsedChecklistItems(markdown: string): { markdown: string; changed: boolean } {
  let changed = false;
  const lines = markdown.split(/\r?\n/);
  const next: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (!match) {
      next.push(line);
      continue;
    }

    const [, indent, marker, body] = match;
    if (!/\s\d{1,2}\.\s+\S/.test(body)) {
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
    for (const chunk of chunks) next.push(`${indent}${marker === '1.' ? '-' : marker[0]} ${chunk}`);
  }

  return { markdown: next.join('\n'), changed };
}

function genericChecklistBlock(): string {
  return [
    '## 확인 목록',
    '',
    '- 글에서 확인한 기준을 내 일정에 맞게 표시합니다.',
    '- 출발 전에 최신 공식 안내를 다시 확인합니다.',
    '- 필요하지 않은 항목은 제외하고 남은 조건을 비교합니다.',
  ].join('\n');
}

function repairChecklistShape(input: BlogAutoRepairInputV4): { markdown: string; changed: boolean } {
  const context = [input.title, input.primaryKeyword, input.destination, input.category]
    .filter(Boolean)
    .join(' ');
  if (!CHECKLIST_INTENT_RE.test(context)) return { markdown: input.markdown, changed: false };

  const split = splitCollapsedChecklistItems(input.markdown);
  let markdown = split.markdown;
  let changed = split.changed;
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#{2,3}\s+/.test(line.trim()) && CHECKLIST_HEADING_RE.test(line));

  if (headingIndex >= 0) {
    let end = headingIndex + 1;
    while (end < lines.length && !/^#{1,3}\s+\S/.test(lines[end]?.trim() || '')) end += 1;
    const section = lines.slice(headingIndex + 1, end);
    const itemCount = section.filter((line) => /^\s*[-*]\s+\S/.test(line.trim())).length;
    if (itemCount < 3) {
      lines.splice(headingIndex + 1, 0, '',
        '- 글에서 확인한 기준을 내 일정에 맞게 표시합니다.',
        '- 출발 전에 최신 공식 안내를 다시 확인합니다.',
        '- 필요하지 않은 항목은 제외하고 남은 조건을 비교합니다.',
        '',
      );
      markdown = lines.join('\n');
      changed = true;
    }
    return { markdown: markdown.trim(), changed };
  }

  const ledgerIndex = markdown.search(/<!--\s*INFORMATION_CLAIM_LEDGER_START/i);
  const block = genericChecklistBlock();
  markdown = ledgerIndex >= 0
    ? `${markdown.slice(0, ledgerIndex).trimEnd()}\n\n${block}\n\n${markdown.slice(ledgerIndex).trimStart()}`
    : `${markdown.trimEnd()}\n\n${block}`;
  return { markdown: markdown.trim(), changed: true };
}

/**
 * Applies only source-neutral repairs. It never invents factual claims,
 * numbers, sources, destinations, links, or commercial conditions.
 */
export function repairBlogQualityV4(input: BlogAutoRepairInputV4): BlogAutoRepairResultV4 {
  const changes: string[] = [];
  let markdown = input.markdown;

  const intro = repairInformationalIntro({ ...input, markdown });
  if (intro.changed) {
    markdown = intro.markdown;
    changes.push('repaired_info_intro_intent');
  }

  const checklist = repairChecklistShape({ ...input, markdown });
  if (checklist.changed) {
    markdown = checklist.markdown;
    changes.push('repaired_checklist_shape');
  }

  return { markdown, changed: markdown !== input.markdown, changes };
}
