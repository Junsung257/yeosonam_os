type PublicTermKind = 'inclusion' | 'exclusion';

type PublicTermPolicyInput = {
  inclusions: unknown;
  exclusions: unknown;
  rawText?: string | null;
};

export type PublicTermsPolicyResult = {
  inclusionsPublic: string[];
  exclusionsPublic: string[];
  rejected: Array<{
    kind: PublicTermKind;
    value: string;
    reason: 'empty' | 'fragment' | 'unsupported';
  }>;
};

const SECTION_STOP_PATTERN =
  /^(?:선택\s*관광|쇼핑\s*센터|일정표|여행\s*일정|상품\s*정보|요금표|출발일|예약|특전|유의\s*사항|공지|취소\s*규정|비고|주의\s*사항|룸\s*타입|PKG)\b/i;

const INCLUSION_HEADING_PATTERN = /(?:포\s*함\s*내\s*역|포함\s*사항|포함\s*내역|포함사항)/;
const EXCLUSION_HEADING_PATTERN = /(?:불\s*포\s*함\s*내\s*역|불포함\s*사항|불포함\s*내역|불포함사항|추가\s*요금|추가요금)/;

const PUBLIC_TERM_FRAGMENT_PATTERNS = [
  /^[-•ㆍ·*]+$/,
  /^\d{1,3}$/,
  /^0{2,3}\s*원?\s*\/?\s*인?$/,
  /^\d{1,3}(?:,\d{3})*\s*원?\s*\/?\s*인?$/,
  /^\d{1,2}\s*월\s*\d{1,2}\s*(?:일)?$/,
  /^\d{1,2}\s*[/-]\s*\d{1,2}(?:\s|$)/,
  /^상품\s*가$/,
  /^출발\s*일$/,
  /^예약\s*금$/,
  /^요금\s*표$/,
  /^일정\s*표$/,
  /^선택\s*관광$/,
  /^쇼핑\s*센터$/,
  /^포\s*함(?:\s*내\s*역|\s*사항)?$/,
  /^불\s*포\s*함(?:\s*내\s*역|\s*사항)?$/,
  /^노\s*옵션$/,
];

const INCLUSION_RULES: Array<[RegExp, string]> = [
  [/왕복\s*항공|항공\s*료|항공권/, '왕복항공료'],
  [/유류\s*할증료/, '유류할증료'],
  [/숙박|호텔/, '숙박'],
  [/식사/, '일정표상 식사'],
  [/입장\s*료|관광지\s*입장/, '관광지 입장료'],
  [/현지\s*차량|전용\s*차량|차량/, '현지차량'],
  [/여행자\s*보험|보험/, '여행자보험'],
  [/가이드/, '가이드'],
];

const EXCLUSION_RULES: Array<[RegExp, string]> = [
  [/개인\s*경비/, '개인경비'],
  [/매너\s*팁/, '매너팁'],
  [/기사\s*\/?\s*가이드\s*경비|가이드\s*경비|기사\s*경비/, '기사/가이드 경비'],
  [/선택\s*관광.*비용|선택\s*관광/, '선택관광 비용'],
  [/싱글\s*룸|싱글\s*차지|1\s*인\s*실/, '싱글룸 추가비'],
  [/비자\s*비|비자/, '비자비'],
  [/불\s*포\s*함.*식사|식사.*불\s*포\s*함/, '불포함 식사'],
];

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return [
    record.name,
    record.title,
    record.label,
    record.value,
    record.description,
    record.note,
  ]
    .map(part => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function normalizeTermText(value: unknown): string {
  return textOf(value)
    .replace(/[•ㆍ·*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTermText(value: string): string[] {
  return value
    .split(/[\r\n|,，•ㆍ·*]+/)
    .map(part => normalizeTermText(part))
    .filter(Boolean);
}

function isFragment(text: string): boolean {
  return PUBLIC_TERM_FRAGMENT_PATTERNS.some(pattern => pattern.test(text));
}

function termCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap(item => splitTermText(textOf(item)));
}

function splitRawLine(line: string): string[] {
  return splitTermText(line);
}

function extractSectionCandidates(rawText: string | null | undefined, heading: RegExp): string[] {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const output: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (heading.test(line)) {
      collecting = true;
      const inline = line.replace(heading, '').replace(/^[:：\-\s]+/, '').trim();
      if (inline) output.push(...splitRawLine(inline));
      continue;
    }
    if (!collecting) continue;
    if (SECTION_STOP_PATTERN.test(line)) break;
    if (INCLUSION_HEADING_PATTERN.test(line) || EXCLUSION_HEADING_PATTERN.test(line)) break;
    output.push(...splitRawLine(line));
  }

  return output;
}

function classifyTerm(kind: PublicTermKind, value: string): string | null {
  if (kind === 'inclusion' && /가이드\s*경비|기사\s*\/?\s*가이드/.test(value)) return null;
  const rules = kind === 'inclusion' ? INCLUSION_RULES : EXCLUSION_RULES;
  for (const [pattern, publicLabel] of rules) {
    if (pattern.test(value)) return publicLabel;
  }
  return null;
}

function buildTerms(
  kind: PublicTermKind,
  explicitCandidates: string[],
  rawCandidates: string[],
  rejected: PublicTermsPolicyResult['rejected'],
): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [...explicitCandidates, ...rawCandidates]) {
    const text = normalizeTermText(candidate);
    if (!text) {
      rejected.push({ kind, value: '', reason: 'empty' });
      continue;
    }
    if (isFragment(text)) {
      rejected.push({ kind, value: text, reason: 'fragment' });
      continue;
    }
    const publicLabel = classifyTerm(kind, text);
    if (!publicLabel) {
      rejected.push({ kind, value: text, reason: 'unsupported' });
      continue;
    }
    if (seen.has(publicLabel)) continue;
    seen.add(publicLabel);
    output.push(publicLabel);
  }

  return output;
}

export function buildPublicTermsPolicy(input: PublicTermPolicyInput): PublicTermsPolicyResult {
  const rejected: PublicTermsPolicyResult['rejected'] = [];
  const rawText = input.rawText ?? '';

  const inclusionsPublic = buildTerms(
    'inclusion',
    termCandidates(input.inclusions),
    extractSectionCandidates(rawText, INCLUSION_HEADING_PATTERN),
    rejected,
  );
  const exclusionsPublic = buildTerms(
    'exclusion',
    termCandidates(input.exclusions),
    extractSectionCandidates(rawText, EXCLUSION_HEADING_PATTERN),
    rejected,
  );

  return {
    inclusionsPublic,
    exclusionsPublic,
    rejected,
  };
}
