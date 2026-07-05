export type SourceTermsRepairPackage = {
  raw_text?: string | null;
  inclusions?: string[] | null;
  excludes?: string[] | null;
};

export type SourceBackedTermsRepair =
  | {
      status: 'not_needed' | 'unavailable';
      reason: string;
      inclusions?: string[];
      excludes?: string[];
    }
  | {
      status: 'repaired';
      reason: string;
      inclusions?: string[];
      excludes?: string[];
    };

const HTML_ENTITY_RE = /&(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const CUSTOMER_BULLET_RE = /^[\s\-*\u2022\u00b7\u25aa\u25e6\u25cb\u25cf\u25c6\u25c7\u25a0\u25a1\u2605\u2606\u2663\u2660\u2665\u2666\u25b6\u25b7\u25b8\u25b9\u203b]+/u;
const INTERNAL_PROMO_RE = /(?:\uD0C0\uC0AC\s*\uBE44\uAD50\s*\uD544\uC218|\uBE44\uAD50\s*\uD544\uC218|POINT\s*[\u2460-\u24690-9]|\uD3EC\uC778\uD2B8\s*[\u2460-\u24690-9]|\uB2E8\uB3C5\s*\uD2B9\uC804|\uD2B9\uC804\s*POINT)/i;
const NON_EXCLUDE_PROMO_RE = /(?:\uBB34\uB8CC\s*\uC5C5\uADF8\uB808\uC774\uB4DC|\uC11C\uBE44\uC2A4\s*\uC81C\uACF5|\uB9DD\uACE0\s*(?:\uB3C4\uC2DC\uB77D|\uC8FC\uC2A4)|\uC528\uD478\uB4DC|\uD004\uB9AC\uD2F0\s*UP|\uD480\uBE4C\uB77C\s*\uAC00\uB2A5|\uC120\uCC29\uC21C\s*\uB8F8\uB2F9)/i;
const NON_TERM_HEADING_RE = /^(?:\uC635\uC158\s*&\s*\uC1FC\uD551|\uB178\s*\uC635\uC158|\uB178\uC635\uC158|\uC1FC\uD551\s*\d+\s*\uD68C?)$/i;
const EXCLUDE_NOTICE_OR_SECTION_RE = /(?:\uC1FC\s*\uD551|\uBE44\s*\uACE0|\uD544\s*\uB3C5\s*\uC0AC\s*\uD56D|\uBCF8\s*\uC0C1\uD488|\uD655\uC815\s*\uC804|\uD56D\uACF5\s*\uBC1C\uAD8C|\uC154\uD2C0\s*\uBC84\uC2A4|\uB9AC\uC870\uD2B8\s*\uC2DC\uAC04\uD45C|\uD604\uC9C0\s*\uC0AC\uC815)/i;
const SHOPPING_FRAGMENT_RE = /^(?:\d+\s*\uD68C(?:\s|$|\().*|\uCE68\uD5A5.*|\uCEE4\uD53C|\uB77C\uD14D\uC2A4|\uC7A1\uD654.*)$/i;

function decodeHtmlEntity(entity: string): string {
  const lower = entity.toLowerCase();
  if (lower === '&amp;') return '&';
  if (lower === '&lt;') return '<';
  if (lower === '&gt;') return '>';
  if (lower === '&quot;') return '"';
  if (lower === '&apos;') return "'";
  const hex = lower.match(/^&#x([0-9a-f]+);$/);
  if (hex) return String.fromCodePoint(Number.parseInt(hex[1], 16));
  const decimal = lower.match(/^&#(\d+);$/);
  if (decimal) return String.fromCodePoint(Number.parseInt(decimal[1], 10));
  return entity;
}

function cleanLine(line: string): string {
  return line
    .replace(HTML_ENTITY_RE, entity => decodeHtmlEntity(entity))
    .replace(CUSTOMER_BULLET_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return cleanLine(value)
    .replace(/\s+/g, '')
    .replace(/[()[\]{}.,/\\|:;'"!?~\-*_+\u2022\u00b7\u25aa\u25e6\u25cb\u25cf\u25c6\u25c7\u25a0\u25a1\u2605\u2606\u2663\u2660\u2665\u2666\u25b6\u25b7\u25b8\u25b9\u203b]/g, '')
    .toLowerCase();
}

function normalizedHeading(line: string): string {
  return cleanLine(line).replace(/[,\s:：>\-–—]+/g, '').toLowerCase();
}

function isIncludeHeading(line: string): boolean {
  const text = normalizedHeading(line);
  return /^includes?$/.test(text)
    || /^(?:\uD3EC\uD568|\uD3EC\uD568\uB0B4\uC5ED|\uD3EC\uD568\uC0AC\uD56D)$/.test(text)
    || text.includes('ы븿')
    || /^\?{2,}$/.test(text);
}

function isExcludeHeading(line: string): boolean {
  const text = normalizedHeading(line);
  return /^excludes?$/.test(text)
    || /^(?:\uBD88\uD3EC\uD568|\uBD88\uD3EC\uD568\uB0B4\uC5ED|\uBD88\uD3EC\uD568\uC0AC\uD56D)$/.test(text)
    || /遺|遺덊룷/.test(text);
}

function isStopHeading(line: string): boolean {
  const text = cleanLine(line);
  return /^r\s*m\s*k$/i.test(text)
    || /^remark\b/i.test(text)
    || /^day\s*\d+/i.test(text)
    || /^\uC120\uD0DD\s*(\uAD00\uAD11|\uC635\uC158)/.test(text)
    || /^\uC635\uC158\s*&\s*\uC1FC\uD551/i.test(text);
}

function isNoiseLine(line: string): boolean {
  return !line || /^[-_=]{3,}$/.test(line);
}

function splitTermLine(line: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let buf = '';
  const chars = [...line];
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    const numericComma = ch === ','
      && /\d/.test(chars[index - 1] ?? '')
      && /\d/.test(chars[index + 1] ?? '');
    if (ch === ',' && depth === 0 && !numericComma) {
      const item = cleanLine(buf);
      if (item) result.push(item);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const tail = cleanLine(buf);
  if (tail) result.push(tail);
  return result;
}

function isSectionHeading(line: string): boolean {
  return isIncludeHeading(line) || isExcludeHeading(line) || isStopHeading(line);
}

function extractSection(rawText: string, section: 'include' | 'exclude'): string[] {
  const lines = rawText
    .replace(/\r/g, '')
    .split('\n')
    .map(cleanLine);
  const start = lines.findIndex(line => section === 'include' ? isIncludeHeading(line) : isExcludeHeading(line));
  if (start < 0) return [];
  const rows: string[] = [];
  for (let i = start + 1; i < lines.length && rows.length < 12; i += 1) {
    const line = lines[i];
    if (isNoiseLine(line)) continue;
    if (isSectionHeading(line)) break;
    rows.push(...splitTermLine(line));
  }
  return rows
    .map(item => item.replace(/\(\s*\)/g, '').trim())
    .filter(item => item.length >= 2);
}

function hasBrokenOrUnsupportedTerms(pkg: SourceTermsRepairPackage): boolean {
  const current = [...(pkg.inclusions ?? []), ...(pkg.excludes ?? [])].filter(Boolean);
  if ((pkg.inclusions ?? []).length === 0 || (pkg.excludes ?? []).length === 0) return true;
  if (current.some(item => /\(\s*\)/.test(item))) return true;
  if (current.some(item => HTML_ENTITY_RE.test(item))) return true;
  if (current.some(item => INTERNAL_PROMO_RE.test(item))) return true;
  for (let index = 0; index < current.length - 1; index += 1) {
    const item = cleanLine(current[index]);
    const next = cleanLine(current[index + 1]);
    if (/\b\d{1,3}$/.test(item) && /^\d{3}\s*(?:원|엔|달러|위안|krw|jpy|usd|cny|\$)/i.test(next)) return true;
  }
  if ((pkg.excludes ?? []).some(item => NON_TERM_HEADING_RE.test(item) || EXCLUDE_NOTICE_OR_SECTION_RE.test(item) || SHOPPING_FRAGMENT_RE.test(item))) return true;
  const raw = pkg.raw_text ?? '';
  return current.some(item => item.length >= 4 && !compact(raw).includes(compact(item)));
}

function normalizeCustomerTerm(item: string): string {
  return cleanLine(item)
    .replace(CUSTOMER_BULLET_RE, '')
    .replace(/\s*\/\/\s*/g, ' / ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCustomerSafeTerm(item: string, section: 'include' | 'exclude'): boolean {
  const text = item.trim();
  if (!text) return false;
  if (INTERNAL_PROMO_RE.test(text)) return false;
  if (NON_TERM_HEADING_RE.test(text)) return false;
  if (section === 'exclude' && NON_EXCLUDE_PROMO_RE.test(text)) return false;
  if (section === 'exclude' && EXCLUDE_NOTICE_OR_SECTION_RE.test(text)) return false;
  if (section === 'exclude' && SHOPPING_FRAGMENT_RE.test(text)) return false;
  return true;
}

function useful(items: string[], section: 'include' | 'exclude'): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawItem of items) {
    const item = normalizeCustomerTerm(rawItem);
    if (!isCustomerSafeTerm(item, section)) continue;
    const key = compact(item);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function buildSourceBackedTermsRepair(pkg: SourceTermsRepairPackage): SourceBackedTermsRepair {
  const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  if (rawText.length < 50) return { status: 'unavailable', reason: 'raw_text missing or too short' };
  if (!hasBrokenOrUnsupportedTerms(pkg)) return { status: 'not_needed', reason: 'current terms are source-backed' };

  const inclusions = useful(extractSection(rawText, 'include'), 'include');
  const excludes = useful(extractSection(rawText, 'exclude'), 'exclude');
  if (inclusions.length === 0 && excludes.length === 0) {
    return { status: 'unavailable', reason: 'source include/exclude sections not recognized' };
  }

  return {
    status: 'repaired',
    reason: 'replaced customer terms with source-backed include/exclude sections',
    ...(inclusions.length > 0 ? { inclusions } : {}),
    ...(excludes.length > 0 ? { excludes } : {}),
  };
}
