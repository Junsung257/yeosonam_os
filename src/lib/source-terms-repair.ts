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

const INCLUDE_HEADING_RE = /^(?:포\s*함|포함\s*내역|포함사항|includes?)\s*[:：]?$/i;
const EXCLUDE_HEADING_RE = /^(?:불\s*포\s*함|불포함\s*내역|불포함사항|excludes?)\s*[:：]?$/i;
const STOP_HEADING_RE = /^(?:쇼핑센터|쇼\s*핑|비\s*고|r\s*m\s*k|remark|일\s*정|제\s*\d+\s*일|day\s*\d+|선택\s*관광|옵션)(?:\s|[:：]|$)/i;

function cleanLine(line: string): string {
  return line
    .replace(/^[\s\-*•·ㆍ▶▷△▲■□◆◇★※]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTermLine(line: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of [...line]) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === '，') && depth === 0) {
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

function isNoiseLine(line: string): boolean {
  return !line
    || /^[-_=]{3,}$/.test(line)
    || /^상품명|^출발일|^상품가|^룸\s*타입|^인\s*원/.test(line);
}

function extractSection(rawText: string, heading: RegExp): string[] {
  const lines = rawText
    .replace(/\r/g, '')
    .split('\n')
    .map(cleanLine);
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return [];
  const rows: string[] = [];
  for (let i = start + 1; i < lines.length && rows.length < 12; i += 1) {
    const line = lines[i];
    if (isNoiseLine(line)) continue;
    if (INCLUDE_HEADING_RE.test(line) || EXCLUDE_HEADING_RE.test(line) || STOP_HEADING_RE.test(line)) break;
    rows.push(...splitTermLine(line));
  }
  return rows
    .map(item => item.replace(/\(\s*\)/g, '').trim())
    .filter(item => item.length >= 2);
}

function compact(value: string): string {
  return value.replace(/\s+/g, '').replace(/[()[\]{}·ㆍ,./\\|:;'"!?~\-–—_*★▶△※&+]/g, '');
}

function hasBrokenOrUnsupportedTerms(pkg: SourceTermsRepairPackage): boolean {
  const current = [...(pkg.inclusions ?? []), ...(pkg.excludes ?? [])].filter(Boolean);
  if (current.some(item => /\(\s*\)/.test(item))) return true;
  const raw = pkg.raw_text ?? '';
  return current.some(item => item.length >= 4 && !compact(raw).includes(compact(item)));
}

function useful(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
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

  const inclusions = useful(extractSection(rawText, INCLUDE_HEADING_RE));
  const excludes = useful(extractSection(rawText, EXCLUDE_HEADING_RE));
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
