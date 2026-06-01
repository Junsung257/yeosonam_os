import type { V3Evidence, V3SourceLine } from './types';

export function createSourceLineIndex(rawText: string): V3SourceLine[] {
  const lines: V3SourceLine[] = [];
  let cursor = 0;
  const normalized = rawText.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');

  for (let i = 0; i < parts.length; i++) {
    const quote = parts[i];
    const charStart = cursor;
    const charEnd = charStart + quote.length;
    lines.push({
      lineNumber: i + 1,
      charStart,
      charEnd,
      quote,
    });
    cursor = charEnd + 1;
  }

  return lines;
}

export function evidenceFromLines(lines: V3SourceLine[], startLine: number, endLine = startLine): V3Evidence {
  const start = lines[startLine - 1];
  const end = lines[endLine - 1] ?? start;
  if (!start || !end) {
    throw new Error(`Cannot build evidence for missing source lines ${startLine}-${endLine}`);
  }
  return {
    line_start: start.lineNumber,
    line_end: end.lineNumber,
    char_start: start.charStart,
    char_end: end.charEnd,
    quote: lines
      .slice(start.lineNumber - 1, end.lineNumber)
      .map(line => line.quote)
      .join('\n'),
  };
}

export function findLineEvidence(lines: V3SourceLine[], predicate: (line: V3SourceLine) => boolean): V3Evidence | null {
  const found = lines.find(predicate);
  return found ? evidenceFromLines(lines, found.lineNumber) : null;
}
