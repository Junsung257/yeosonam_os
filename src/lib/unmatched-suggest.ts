export interface AttractionSuggestRow {
  id: string;
  name: string;
  aliases: string[] | null;
  region: string | null;
  country: string | null;
  category: string | null;
  badge_type?: string | null;
  emoji: string | null;
  short_desc: string | null;
  is_active?: boolean | null;
  customer_publishable?: boolean | null;
  mrt_gid?: string | null;
}

export interface Suggestion {
  id: string;
  name: string;
  aliases: string[];
  region: string | null;
  country: string | null;
  category: string | null;
  emoji: string | null;
  short_desc: string | null;
  score: number;
  matched_via: 'exact' | 'jaccard' | 'lcs' | 'alias';
  matched_term: string;
}

export function cleanActivity(text: string): string {
  return text
    .replace(/^[▶☆※♣♠♥♦*]+\s*/, '')
    .replace(/[(\[].*?[)\]]/g, ' ')
    .replace(/[·,.\-+/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter(t => t.length >= 2));
}

const GENERIC_SUGGEST_TERMS = new Set([
  '시내',
  '야경',
  '투어',
  '나이트투어',
  '시티투어',
  '대협곡',
  '협곡',
  '유람선',
  '나룻배',
  '케이블카',
  '전동차',
  '관광',
  '관람',
  '방문',
  '감상',
  '체험',
  '쇼',
  '공연',
  '시장',
  '야시장',
  '전망',
  '전망대',
]);

const UNSAFE_ALIAS_PHRASE_RE =
  /(볼\s*수|느낄\s*수|있는|없는|최대|번화가|시내|관광|감상|방문|등정|체험|포함|특전|일정|가득|고즈넉|아름다운|대표|핵심|이동|진행|포토|투어|나이트투어|시티투어)/i;

const UNSAFE_ALIAS_FRAGMENTS = [
  '시내',
  '야경',
  '투어',
  '나이트투어',
  '시티투어',
  '관광',
  '관람',
  '방문',
  '감상',
  '체험',
  '유람선',
  '나룻배',
  '케이블카',
  '전동차',
  '등정',
  '전망',
];

function compactText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').trim();
}

function isHangulSyllable(value: string): boolean {
  return /^[\uAC00-\uD7A3]$/.test(value);
}

function hasTermBoundary(text: string, term: string): boolean {
  const needle = term.trim();
  if (!needle) return false;
  let index = text.indexOf(needle);
  while (index >= 0) {
    const before = index > 0 ? text[index - 1] : '';
    const after = text[index + needle.length] ?? '';
    if (!isHangulSyllable(before) && !isHangulSyllable(after)) return true;
    index = text.indexOf(needle, index + 1);
  }
  return false;
}

function isGenericSuggestTerm(term: string): boolean {
  return GENERIC_SUGGEST_TERMS.has(compactText(term));
}

function isUnsafeSuggestAliasTerm(term: string): boolean {
  const trimmed = term.trim();
  const compact = compactText(trimmed);
  if (!compact) return true;
  if (isGenericSuggestTerm(trimmed)) return true;
  if (compact.length > 24) return true;
  if (/\s/.test(trimmed) && compact.length > 12) return true;
  if (UNSAFE_ALIAS_FRAGMENTS.some(fragment => compact.includes(fragment))) return true;
  return UNSAFE_ALIAS_PHRASE_RE.test(trimmed);
}

function termOccursInActivity(activityClean: string, termClean: string): boolean {
  const compactTerm = compactText(termClean);
  if (!compactTerm) return false;
  if (compactTerm.length <= 2) return hasTermBoundary(activityClean, termClean);
  if (/\s/.test(termClean)) return compactText(activityClean).includes(compactTerm);
  return hasTermBoundary(activityClean, termClean);
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;
  return i;
}

function scoreCandidate(
  activityClean: string,
  activityTokens: Set<string>,
  attr: AttractionSuggestRow,
): Omit<Suggestion, 'id' | 'name' | 'aliases' | 'region' | 'country' | 'category' | 'emoji' | 'short_desc'> | null {
  const candidates: { term: string; isAlias: boolean }[] = [
    { term: attr.name, isAlias: false },
    ...((attr.aliases || []).map(a => ({ term: a, isAlias: true }))),
  ];

  let best: Omit<Suggestion, 'id' | 'name' | 'aliases' | 'region' | 'country' | 'category' | 'emoji' | 'short_desc'> | null = null;

  for (const { term, isAlias } of candidates) {
    if (!term || term.length < 2) continue;
    const termClean = term.toLowerCase().trim();
    if (isGenericSuggestTerm(termClean)) continue;
    if (isAlias && isUnsafeSuggestAliasTerm(termClean)) continue;
    const aliasBonus = isAlias ? 10 : 0;

    if (termOccursInActivity(activityClean, termClean) || termClean === activityClean) {
      const score = 100 + aliasBonus;
      if (!best || score > best.score) {
        best = { score, matched_via: isAlias ? 'alias' : 'exact', matched_term: term };
      }
      continue;
    }

    const termTokens = tokenize(termClean);
    if (!isAlias && activityTokens.size > 0 && termTokens.size > 0) {
      let intersect = 0;
      for (const t of activityTokens) if (termTokens.has(t)) intersect++;
      const union = activityTokens.size + termTokens.size - intersect;
      const jaccard = union > 0 ? intersect / union : 0;
      if (jaccard >= 0.4) {
        const score = jaccard * 70 + aliasBonus;
        if (!best || score > best.score) {
          best = { score, matched_via: isAlias ? 'alias' : 'jaccard', matched_term: term };
        }
      }
    }

    const lcs = !isAlias ? commonPrefixLen(activityClean, termClean) : 0;
    if (lcs >= 3) {
      const ratio = lcs / Math.min(activityClean.length, termClean.length);
      if (ratio >= 0.5) {
        const score = ratio * 50 + aliasBonus;
        if (!best || score > best.score) {
          best = { score, matched_via: isAlias ? 'alias' : 'lcs', matched_term: term };
        }
      }
    }
  }
  return best;
}

export function suggestAttractionsForActivity(
  activity: string,
  candidates: AttractionSuggestRow[],
  minScore = 30,
  limit = 3,
): { activity_clean: string; suggestions: Suggestion[] } {
  const activityClean = cleanActivity(activity);
  const activityTokens = tokenize(activityClean);
  const suggestions: Suggestion[] = [];
  for (const attr of candidates) {
    const sc = scoreCandidate(activityClean, activityTokens, attr);
    if (sc && sc.score >= minScore) {
      suggestions.push({
        id: attr.id,
        name: attr.name,
        aliases: attr.aliases || [],
        region: attr.region,
        country: attr.country,
        category: attr.category,
        emoji: attr.emoji,
        short_desc: attr.short_desc,
        ...sc,
      });
    }
  }
  suggestions.sort((a, b) => b.score - a.score);
  return { activity_clean: activityClean, suggestions: suggestions.slice(0, limit) };
}
