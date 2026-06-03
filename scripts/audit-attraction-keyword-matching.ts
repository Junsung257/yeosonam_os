import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import type { AttractionData } from '../src/lib/attraction-matcher';
import { extractAttractionCandidates } from '../src/lib/itinerary-attraction-candidates';

dotenv.config({ path: '.env.local' });
dotenv.config();

type TravelPackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  status: string | null;
  created_at: string | null;
  itinerary_data: unknown;
};

type ScheduleItem = {
  activity?: string | null;
  note?: string | null;
  type?: string | null;
  attraction_ids?: unknown;
  attraction_names?: unknown;
};

type DayItem = {
  day?: number | null;
  schedule?: ScheduleItem[] | null;
};

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function normalizeDays(input: unknown): DayItem[] {
  if (!input) return [];
  if (typeof input === 'string') {
    try {
      return normalizeDays(JSON.parse(input));
    } catch {
      return [];
    }
  }
  if (Array.isArray(input)) return input as DayItem[];
  if (typeof input !== 'object') return [];
  const obj = input as Record<string, unknown>;
  for (const key of ['days', 'day_list', 'itinerary_days']) {
    if (Array.isArray(obj[key])) return obj[key] as DayItem[];
  }
  return [];
}

function hasStoredAttraction(item: ScheduleItem): boolean {
  return (
    (Array.isArray(item.attraction_ids) && item.attraction_ids.length > 0)
    || (Array.isArray(item.attraction_names) && item.attraction_names.length > 0)
  );
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function top(map: Map<string, number>, limit: number): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function normalizeKeyword(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, '').trim();
}

function inDestinationScope(attraction: AttractionData, destination: string | null | undefined): boolean {
  const dest = destination?.trim();
  if (!dest) return true;
  return (
    !attraction.region
    || dest.includes(attraction.region)
    || attraction.region.includes(dest)
    || Boolean(attraction.country && dest.includes(attraction.country))
  );
}

const NON_ATTRACTION_CATEGORIES = new Set(['accommodation', 'mrt_product']);

function isMatchableAttraction(attraction: AttractionData): boolean {
  return !attraction.category || !NON_ATTRACTION_CATEGORIES.has(attraction.category);
}

function createScopedAttractionGetter(attractions: AttractionData[]) {
  const cache = new Map<string, AttractionData[]>();
  return (destination?: string | null) => {
    const key = destination || '__all__';
    const cached = cache.get(key);
    if (cached) return cached;
    const scoped = attractions
      .filter(isMatchableAttraction)
      .filter(attraction => inDestinationScope(attraction, destination))
      .sort((a, b) => normalizeKeyword(b.name).length - normalizeKeyword(a.name).length);
    cache.set(key, scoped);
    return scoped;
  };
}

type AttractionTerm = {
  term: string;
  normalized: string;
  attraction: AttractionData;
};

function createScopedTermGetter(attractions: AttractionData[]) {
  const scopedGetter = createScopedAttractionGetter(attractions);
  const cache = new Map<string, AttractionTerm[]>();
  return (destination?: string | null) => {
    const key = destination || '__all__';
    const cached = cache.get(key);
    if (cached) return cached;
    const seen = new Set<string>();
    const terms: AttractionTerm[] = [];
    for (const attraction of scopedGetter(destination)) {
      for (const term of [attraction.name, ...(attraction.aliases ?? [])]) {
        const clean = (term ?? '').trim();
        const normalized = normalizeKeyword(clean);
        if (normalized.length < 2 || clean.length > 24) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        terms.push({ term: clean, normalized, attraction });
      }
    }
    terms.sort((a, b) => b.normalized.length - a.normalized.length);
    cache.set(key, terms);
    return terms;
  };
}

function scanRegisteredTermsInText(text: string, terms: AttractionTerm[]): AttractionData[] {
  const normalizedText = normalizeKeyword(text);
  if (normalizedText.length < 2) return [];
  const found = new Map<string, AttractionData>();
  for (const term of terms) {
    if (!normalizedText.includes(term.normalized)) continue;
    const key = String(term.attraction.id ?? term.attraction.name);
    found.set(key, term.attraction);
    if (found.size >= 5) break;
  }
  return [...found.values()];
}

function matchKeywordFirst(
  candidate: string,
  scopedAttractions: AttractionData[],
  destination?: string | null,
): AttractionData[] {
  const normalizedCandidate = normalizeKeyword(candidate);
  if (normalizedCandidate.length < 2) return [];

  void destination;
  const exact = scopedAttractions.find(attraction => normalizeKeyword(attraction.name) === normalizedCandidate);
  if (exact) return [exact];

  const aliasExact = scopedAttractions.find(attraction =>
    (attraction.aliases ?? []).some(alias => normalizeKeyword(alias) === normalizedCandidate),
  );
  if (aliasExact) return [aliasExact];

  const matches = scopedAttractions.filter((attraction) => {
    const name = normalizeKeyword(attraction.name);
    if (name.length >= 2 && (normalizedCandidate.includes(name) || name.includes(normalizedCandidate))) return true;
    return (attraction.aliases ?? []).some((alias) => {
      const normalizedAlias = normalizeKeyword(alias);
      return normalizedAlias.length >= 2
        && (normalizedCandidate.includes(normalizedAlias) || normalizedAlias.includes(normalizedCandidate));
    });
  });

  return matches
    .slice(0, 3);
}

async function fetchAllAttractions(
  // The audit script is read-only and does not need generated DB generics.
  supabase: { from: ReturnType<typeof createClient>['from'] },
): Promise<AttractionData[]> {
  const pageSize = 1000;
  const all: AttractionData[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('attractions')
      .select('id,name,short_desc,long_desc,aliases,country,region,category,emoji,photos,mrt_gid')
      .eq('is_active', true)
      .range(from, to);
    if (error) throw new Error(`attractions query failed: ${error.message}`);
    all.push(...((data ?? []) as AttractionData[]));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase URL/key is missing.');

  const days = Number(getArg('days', '3'));
  const limit = Number(getArg('limit', '500'));
  const mode = getArg('mode', 'recent');
  const topLimit = Number(getArg('top', '30'));
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let packageQuery = supabase
    .from('travel_packages')
    .select('id,title,destination,status,created_at,itinerary_data')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (mode === 'recent') {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    packageQuery = packageQuery.gte('created_at', since);
  }

  const [{ data: packages, error: packageError }, activeAttractions, { data: unmatchedRows }] =
    await Promise.all([
      packageQuery,
      fetchAllAttractions(supabase),
      supabase
        .from('unmatched_activities')
        .select('activity,package_id,status,created_at')
        .order('created_at', { ascending: false })
        .limit(5000),
    ]);

  if (packageError) throw new Error(`travel_packages query failed: ${packageError.message}`);

  const scopedAttractionsFor = createScopedAttractionGetter(activeAttractions);
  const scopedTermsFor = createScopedTermGetter(activeAttractions);
  const rows = (packages ?? []) as TravelPackageRow[];
  const unmatchedByPackage = new Map<string, number>();
  for (const row of (unmatchedRows ?? []) as Array<{ package_id?: string | null }>) {
    if (row.package_id) bump(unmatchedByPackage, row.package_id);
  }

  const unmatchedCandidateCounts = new Map<string, number>();
  const matchedNameCounts = new Map<string, number>();
  const directMatchedNameCounts = new Map<string, number>();
  const destinationStats = new Map<string, { packages: number; candidates: number; matched: number; stored: number }>();

  let packagesWithDays = 0;
  let packagesWithStoredAttractions = 0;
  let scheduleItems = 0;
  let candidateCount = 0;
  let matchedCandidateCount = 0;
  let directScanItemMatchCount = 0;
  let directScanMatchCount = 0;
  let storedAttractionItems = 0;
  let packagesWithUnmatchedQueue = 0;
  const packageFindings: Array<{
    id: string;
    title: string | null;
    destination: string | null;
    status: string | null;
    candidates: number;
    matched: number;
    directMatched: number;
    stored: number;
    unmatchedQueue: number;
    matchRate: number;
  }> = [];

  for (const pkg of rows) {
    const daysData = normalizeDays(pkg.itinerary_data);
    if (daysData.length > 0) packagesWithDays++;
    const destKey = pkg.destination || '(unknown)';
    const destStats = destinationStats.get(destKey) ?? { packages: 0, candidates: 0, matched: 0, stored: 0 };
    destStats.packages++;

    let pkgCandidates = 0;
    let pkgMatched = 0;
    let pkgDirectMatched = 0;
    let pkgStored = 0;

    for (const day of daysData) {
      for (const item of day.schedule ?? []) {
        scheduleItems++;
        const directMatches = scanRegisteredTermsInText(
          [item.activity ?? '', item.note ?? ''].filter(Boolean).join(' '),
          scopedTermsFor(pkg.destination ?? undefined),
        );
        if (directMatches.length > 0) {
          directScanItemMatchCount++;
          directScanMatchCount += directMatches.length;
          pkgDirectMatched += directMatches.length;
          for (const match of directMatches) bump(directMatchedNameCounts, match.name);
        }
        if (hasStoredAttraction(item)) {
          storedAttractionItems++;
          pkgStored++;
        }
        const candidates = extractAttractionCandidates(item.activity ?? '', item.note ?? null);
        for (const candidate of candidates) {
          candidateCount++;
          pkgCandidates++;
          const matches = matchKeywordFirst(
            candidate,
            scopedAttractionsFor(pkg.destination ?? undefined),
            pkg.destination ?? undefined,
          );
          if (matches.length > 0) {
            matchedCandidateCount++;
            pkgMatched++;
            for (const match of matches) bump(matchedNameCounts, match.name);
          } else {
            bump(unmatchedCandidateCounts, candidate);
          }
        }
      }
    }

    if (pkgStored > 0) packagesWithStoredAttractions++;
    const queueCount = unmatchedByPackage.get(pkg.id) ?? 0;
    if (queueCount > 0) packagesWithUnmatchedQueue++;
    destStats.candidates += pkgCandidates;
    destStats.matched += pkgMatched;
    destStats.stored += pkgStored;
    destinationStats.set(destKey, destStats);

    packageFindings.push({
      id: pkg.id,
      title: pkg.title,
      destination: pkg.destination,
      status: pkg.status,
      candidates: pkgCandidates,
      matched: pkgMatched,
      directMatched: pkgDirectMatched,
      stored: pkgStored,
      unmatchedQueue: queueCount,
      matchRate: pct(pkgMatched, pkgCandidates),
    });
  }

  const destinationSummary = [...destinationStats.entries()]
    .map(([destination, s]) => ({
      destination,
      packages: s.packages,
      candidates: s.candidates,
      matched: s.matched,
      stored: s.stored,
      matchRate: pct(s.matched, s.candidates),
    }))
    .sort((a, b) => b.candidates - a.candidates)
    .slice(0, topLimit);

  const weakPackages = packageFindings
    .filter(pkg => pkg.candidates > 0)
    .sort((a, b) => a.matchRate - b.matchRate || b.candidates - a.candidates)
    .slice(0, topLimit);

  const result = {
    scope: { mode, days: mode === 'recent' ? days : null, limit },
    totals: {
      packages: rows.length,
      activeAttractions: activeAttractions.length,
      packagesWithDays,
      scheduleItems,
      candidateCount,
      matchedCandidateCount,
      unmatchedCandidateCount: candidateCount - matchedCandidateCount,
      matchRate: pct(matchedCandidateCount, candidateCount),
      directScanItemMatchCount,
      directScanItemMatchRate: pct(directScanItemMatchCount, scheduleItems),
      directScanMatchCount,
      storedAttractionItems,
      packagesWithStoredAttractions,
      packagesWithUnmatchedQueue,
    },
    topDirectScanMatchedAttractions: top(directMatchedNameCounts, topLimit),
    topMatchedAttractions: top(matchedNameCounts, topLimit),
    topUnmatchedCandidates: top(unmatchedCandidateCounts, topLimit),
    destinationSummary,
    weakPackages,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
