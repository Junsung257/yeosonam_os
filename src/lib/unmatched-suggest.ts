export interface AttractionSuggestRow {
  id: string;
  name: string;
  aliases: string[] | null;
  region: string | null;
  country: string | null;
  category: string | null;
  emoji: string | null;
  short_desc: string | null;
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
    const aliasBonus = isAlias ? 10 : 0;

    if (activityClean.includes(termClean) || termClean.includes(activityClean)) {
      const score = 100 + aliasBonus;
      if (!best || score > best.score) {
        best = { score, matched_via: isAlias ? 'alias' : 'exact', matched_term: term };
      }
      continue;
    }

    const termTokens = tokenize(termClean);
    if (activityTokens.size > 0 && termTokens.size > 0) {
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

    const lcs = commonPrefixLen(activityClean, termClean);
    if (lcs >= 2) {
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
