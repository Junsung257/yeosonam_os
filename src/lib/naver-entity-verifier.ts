import { getSecret } from '@/lib/secret-registry';
import { fetchNaverKeywordTool, type NaverKeywordToolItem } from '@/lib/search-ads-api';
import type { CandidateExternalSource } from '@/lib/entity-master-candidates';

type NaverSearchTarget = 'blog' | 'webkr' | 'encyc' | 'local';

export type NaverSearchEvidenceItem = {
  target: NaverSearchTarget;
  query: string;
  total: number;
  itemCount: number;
  matchedItems: number;
  exactTitleMatches: number;
  regionMatches: number;
  addressMatches: number;
  topTitles: string[];
  topLinks: string[];
};

export type NaverKeywordEvidenceItem = {
  keyword: string;
  monthlyPc: number;
  monthlyMobile: number;
  monthlyTotal: number;
  competition: number | null;
};

export type NaverEntityVerificationInput = {
  label: string;
  aliases?: string[];
  region?: string | null;
  country?: string | null;
  destination?: string | null;
  scopeHints?: string[];
  category?: string | null;
  fetchImpl?: typeof fetch;
};

export type NaverEntityVerificationResult = {
  configured: boolean;
  canonicalName: string;
  canonicalNameSource: 'naver_searchad' | 'naver_search' | 'input';
  searchScore: number;
  keywordScore: number;
  overallScore: number;
  searchEvidence: NaverSearchEvidenceItem[];
  keywordEvidence: NaverKeywordEvidenceItem[];
  sources: CandidateExternalSource[];
  attempts: Array<{
    source: 'naver_search' | 'naver_searchad';
    query: string;
    status: 'success' | 'empty' | 'error' | 'skipped';
    score: number;
    evidence: Record<string, unknown>;
    error?: string;
  }>;
};

const NAVER_OPEN_API_BASE = 'https://openapi.naver.com/v1/search';

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function stripNaverHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return stripNaverHtml(value).toLowerCase().replace(/[\s"'`.,()[\]{}:;!?/\\|-]+/g, '');
}

function normalizeKeywordCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '< 10') return 0;
  return Number(trimmed.replace(/,/g, '')) || 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => stripNaverHtml(value)).filter(Boolean))];
}

function agreesWithAnyName(candidate: string, names: string[]): boolean {
  const compacted = compact(candidate);
  if (compacted.length < 2) return false;
  return names.some(name => {
    const other = compact(name);
    return other.length >= 2 && (
      compacted === other ||
      compacted.includes(other) ||
      other.includes(compacted)
    );
  });
}

function isShortNameCandidate(value: string): boolean {
  const clean = stripNaverHtml(value);
  if (clean.length < 2 || clean.length > 28) return false;
  if (/[\r\n]/.test(clean)) return false;
  if (/(?:여행|관광|방문|코스|일정|패키지|투어|입장권|가격|후기|추천)/i.test(clean) && clean.length > 10) {
    return false;
  }
  return /[가-힣A-Za-z0-9]/.test(clean);
}

function hasHangul(value: string): boolean {
  return /[가-힣]/.test(value);
}

function toSearchAdHint(value: string): string | null {
  const compacted = stripNaverHtml(value).replace(/[^가-힣A-Za-z0-9]/g, '');
  if (compacted.length < 2 || compacted.length > 20) return null;
  if (/^\d+$/.test(compacted)) return null;
  return compacted;
}

export function chooseCanonicalNameFromNaver(input: {
  fallback: string;
  aliases?: string[];
  keywordEvidence?: NaverKeywordEvidenceItem[];
  searchEvidence?: NaverSearchEvidenceItem[];
}): { name: string; source: 'naver_searchad' | 'naver_search' | 'input' } {
  const fallback = stripNaverHtml(input.fallback);
  const preferHangul = hasHangul(fallback) || (input.aliases ?? []).some(hasHangul);
  const sourceNames = unique([fallback, ...(input.aliases ?? [])]);
  const keywordWinner = (input.keywordEvidence ?? [])
    .filter(row => isShortNameCandidate(row.keyword))
    .filter(row => !preferHangul || hasHangul(row.keyword))
    .filter(row => agreesWithAnyName(row.keyword, sourceNames))
    .sort((a, b) => b.monthlyTotal - a.monthlyTotal || a.keyword.length - b.keyword.length)[0];
  if (keywordWinner && keywordWinner.monthlyTotal > 0) {
    return { name: keywordWinner.keyword, source: 'naver_searchad' };
  }

  const aliasWinner = unique([...(input.aliases ?? []), fallback])
    .filter(isShortNameCandidate)
    .sort((a, b) => a.length - b.length)[0];
  if (aliasWinner) return { name: aliasWinner, source: 'input' };

  const titleToken = (input.searchEvidence ?? [])
    .flatMap(row => row.topTitles)
    .map(title => stripNaverHtml(title).split(/\s+/).find(isShortNameCandidate))
    .filter((value): value is string => Boolean(value))
    .filter(value => agreesWithAnyName(value, sourceNames))[0];
  if (titleToken) return { name: titleToken, source: 'naver_search' };

  return { name: fallback, source: 'input' };
}

function buildQueries(input: NaverEntityVerificationInput): string[] {
  const base = unique([input.label, ...(input.aliases ?? [])]).filter(value => value.length >= 2);
  const scopes = unique([
    input.region ?? '',
    input.destination ?? '',
    input.country ?? '',
    ...(input.scopeHints ?? []),
  ])
    .filter(value => value.length >= 2 && value.length <= 24)
    .filter(value => !/^[A-Z]{2}$/i.test(value));
  const scoped = base.flatMap(label => {
    const queries = [label];
    for (const scope of scopes.slice(0, 5)) {
      if (!label.includes(scope)) queries.push(`${scope} ${label}`);
    }
    if (input.category === 'attraction') queries.push(`${label} 관광`);
    if (input.category === 'hotel') queries.push(`${label} 호텔`);
    return queries;
  });
  return unique(scoped).slice(0, 12);
}

async function searchNaver(
  target: NaverSearchTarget,
  query: string,
  label: string,
  region: string | null | undefined,
  fetchImpl: typeof fetch,
): Promise<NaverSearchEvidenceItem> {
  const clientId = getSecret('NAVER_CLIENT_ID');
  const clientSecret = getSecret('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    return {
      target,
      query,
      total: 0,
      itemCount: 0,
      matchedItems: 0,
      exactTitleMatches: 0,
      regionMatches: 0,
      addressMatches: 0,
      topTitles: [],
      topLinks: [],
    };
  }

  const url = new URL(`${NAVER_OPEN_API_BASE}/${target}.json`);
  url.searchParams.set('query', query);
  url.searchParams.set('display', '5');
  url.searchParams.set('start', '1');
  url.searchParams.set('sort', 'sim');

  const res = await fetchImpl(url.toString(), {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  });
  if (!res.ok) {
    throw new Error(`naver ${target} ${res.status}`);
  }

  const json = await res.json() as {
    total?: number;
    items?: Array<{ title?: string; description?: string; link?: string; address?: string; roadAddress?: string }>;
  };
  const labelCompact = compact(label);
  const labelProbe = labelCompact.slice(0, Math.min(labelCompact.length, 16));
  const regionCompact = compact(region ?? '');
  const items = json.items ?? [];
  let matchedItems = 0;
  let exactTitleMatches = 0;
  let regionMatches = 0;
  let addressMatches = 0;
  const topTitles: string[] = [];
  const topLinks: string[] = [];
  for (const item of items) {
    const title = stripNaverHtml(item.title ?? '');
    const description = stripNaverHtml(item.description ?? '');
    const address = stripNaverHtml(item.address ?? item.roadAddress ?? '');
    const titleCompact = compact(title);
    const addressCompact = compact(address);
    const haystack = compact(`${title} ${description} ${address}`);
    const hasLabel = labelProbe.length >= 2 && haystack.includes(labelProbe);
    const hasExactTitle = labelCompact.length >= 2 && (
      titleCompact === labelCompact ||
      titleCompact.includes(labelCompact) ||
      labelCompact.includes(titleCompact)
    );
    const hasRegion = regionCompact.length >= 2 && haystack.includes(regionCompact);
    const hasAddressRegion = target === 'local' && regionCompact.length >= 2 && addressCompact.includes(regionCompact);
    if (hasLabel || hasExactTitle) {
      matchedItems += 1;
    }
    if (hasExactTitle) exactTitleMatches += 1;
    if (hasRegion) regionMatches += 1;
    if (hasAddressRegion) addressMatches += 1;
    if (title && topTitles.length < 3) topTitles.push(title);
    if (item.link && topLinks.length < 3) topLinks.push(item.link);
  }

  return {
    target,
    query,
    total: json.total ?? 0,
    itemCount: items.length,
    matchedItems,
    exactTitleMatches,
    regionMatches,
    addressMatches,
    topTitles,
    topLinks,
  };
}

function keywordEvidenceFrom(items: NaverKeywordToolItem[]): NaverKeywordEvidenceItem[] {
  return items
    .map(item => {
      const monthlyPc = normalizeKeywordCount(item.monthlyPcQcCnt);
      const monthlyMobile = normalizeKeywordCount(item.monthlyMobileQcCnt);
      return {
        keyword: stripNaverHtml(item.relKeyword),
        monthlyPc,
        monthlyMobile,
        monthlyTotal: monthlyPc + monthlyMobile,
        competition: typeof item.compIdx === 'number' ? item.compIdx : null,
      };
    })
    .filter(row => row.keyword.length >= 2)
    .sort((a, b) => b.monthlyTotal - a.monthlyTotal)
    .slice(0, 20);
}

export async function verifyNaverEntityName(
  input: NaverEntityVerificationInput,
): Promise<NaverEntityVerificationResult> {
  const clientConfigured = Boolean(getSecret('NAVER_CLIENT_ID') && getSecret('NAVER_CLIENT_SECRET'));
  const queries = buildQueries(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const attempts: NaverEntityVerificationResult['attempts'] = [];

  if (!clientConfigured) {
    return {
      configured: false,
      canonicalName: stripNaverHtml(input.label),
      canonicalNameSource: 'input',
      searchScore: 0,
      keywordScore: 0,
      overallScore: 0,
      searchEvidence: [],
      keywordEvidence: [],
      sources: [],
      attempts: queries.map(query => ({
        source: 'naver_search',
        query,
        status: 'skipped',
        score: 0,
        evidence: { reason: 'NAVER_CLIENT_ID/NAVER_CLIENT_SECRET missing' },
      })),
    };
  }

  const searchEvidence: NaverSearchEvidenceItem[] = [];
  for (const query of queries.slice(0, 4)) {
    for (const target of ['blog', 'webkr', 'encyc', 'local'] as NaverSearchTarget[]) {
      try {
        const evidence = await searchNaver(target, query, input.label, input.region ?? input.country, fetchImpl);
        searchEvidence.push(evidence);
        const score = clamp(
          Math.min(0.45, evidence.matchedItems * 0.08) +
          Math.min(0.22, evidence.exactTitleMatches * 0.11) +
          Math.min(0.14, evidence.regionMatches * 0.07) +
          Math.min(0.12, evidence.addressMatches * 0.08) +
          Math.min(0.07, Math.log10(evidence.total + 1) / 12),
        );
        attempts.push({
          source: 'naver_search',
          query: `${target}:${query}`,
          status: evidence.itemCount > 0 ? 'success' : 'empty',
          score,
          evidence,
        });
      } catch (error) {
        attempts.push({
          source: 'naver_search',
          query: `${target}:${query}`,
          status: 'error',
          score: 0,
          evidence: {},
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  let keywordEvidence: NaverKeywordEvidenceItem[] = [];
  try {
    const keywordHints = unique([input.label, ...(input.aliases ?? [])])
      .map(toSearchAdHint)
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);
    const keywordRows = keywordHints.length > 0 ? await fetchNaverKeywordTool(keywordHints) : [];
    keywordEvidence = keywordEvidenceFrom(keywordRows);
    const totalVolume = keywordEvidence[0]?.monthlyTotal ?? 0;
    attempts.push({
      source: 'naver_searchad',
      query: keywordHints.join(','),
      status: keywordRows.length > 0 ? 'success' : 'empty',
      score: clamp(Math.log10(totalVolume + 1) / 5),
      evidence: { keyword_count: keywordRows.length, top: keywordEvidence.slice(0, 5) },
    });
  } catch (error) {
    attempts.push({
      source: 'naver_searchad',
      query: input.label,
      status: 'error',
      score: 0,
      evidence: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const totalSearchMatches = searchEvidence.reduce((sum, row) => sum + row.matchedItems, 0);
  const totalExactTitleMatches = searchEvidence.reduce((sum, row) => sum + row.exactTitleMatches, 0);
  const totalRegionMatches = searchEvidence.reduce((sum, row) => sum + row.regionMatches, 0);
  const totalAddressMatches = searchEvidence.reduce((sum, row) => sum + row.addressMatches, 0);
  const localMatches = searchEvidence
    .filter(row => row.target === 'local')
    .reduce((sum, row) => sum + row.matchedItems + row.exactTitleMatches + row.addressMatches, 0);
  const totalSearchItems = searchEvidence.reduce((sum, row) => sum + row.itemCount, 0);
  const totalSearchVolume = searchEvidence.reduce((sum, row) => sum + row.total, 0);
  const searchScore = clamp(
    Math.min(0.36, totalSearchMatches * 0.032) +
    Math.min(0.22, totalExactTitleMatches * 0.075) +
    Math.min(0.12, totalRegionMatches * 0.04) +
    Math.min(0.14, totalAddressMatches * 0.07) +
    Math.min(0.08, localMatches * 0.04) +
    Math.min(0.08, totalSearchItems * 0.003) +
    Math.min(0.1, Math.log10(totalSearchVolume + 1) / 14),
  );
  const keywordScore = clamp(Math.log10((keywordEvidence[0]?.monthlyTotal ?? 0) + 1) / 5);
  const canonical = chooseCanonicalNameFromNaver({
    fallback: input.label,
    aliases: input.aliases,
    keywordEvidence,
    searchEvidence,
  });
  const overallScore = clamp(searchScore * 0.65 + keywordScore * 0.35);
  const sources: CandidateExternalSource[] = [];

  if (searchScore >= 0.25 && totalSearchMatches > 0) {
    sources.push({
      source: 'naver_search',
      id: canonical.name,
      url: `https://search.naver.com/search.naver?query=${encodeURIComponent(canonical.name)}`,
      confidence: searchScore,
      name: canonical.name,
    });
  }
  if (keywordEvidence.length > 0) {
    sources.push({
      source: 'naver_searchad',
      id: keywordEvidence[0].keyword,
      confidence: keywordScore,
      name: keywordEvidence[0].keyword,
    });
  }

  return {
    configured: true,
    canonicalName: canonical.name,
    canonicalNameSource: canonical.source,
    searchScore,
    keywordScore,
    overallScore,
    searchEvidence,
    keywordEvidence,
    sources,
    attempts,
  };
}
