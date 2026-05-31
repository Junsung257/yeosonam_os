import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import type { TravelPackageForSearchAds } from '@/lib/search-ads-auto-planner';

export type AdOsLearningContext = {
  applied: boolean;
  winningKeywords: string[];
  negativeTerms: string[];
  landingLessons: string[];
  ctaLessons: string[];
  summary: string;
};

type LearningEventRow = {
  signal_type: string | null;
  product_id: string | null;
  keyword_text: string | null;
  search_term: string | null;
  score: number | string | null;
  recommendation: string | null;
  status: string | null;
};

type SearchTermCandidateRow = {
  search_term: string | null;
  action: string | null;
  score: number | string | null;
  status: string | null;
};

type MinimalPostgrestResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;

type LearningDb = {
  from: (table: string) => {
    select: (columns?: string) => {
      in: (column: string, values: string[]) => {
        order: (column: string, options?: { ascending?: boolean }) => {
          limit: (count: number) => MinimalPostgrestResult<unknown[]>;
        };
      };
    };
  };
};

const EMPTY_CONTEXT: AdOsLearningContext = {
  applied: false,
  winningKeywords: [],
  negativeTerms: [],
  landingLessons: [],
  ctaLessons: [],
  summary: '',
};

function getLearningDb(): LearningDb | null {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;
  return supabaseAdmin as unknown as LearningDb;
}

function asScore(value: number | string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueLimit(values: Array<string | null | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }

  return out;
}

function matchesPackage(row: LearningEventRow, pkg: TravelPackageForSearchAds): boolean {
  if (row.product_id && row.product_id === pkg.id) return true;
  if (!row.product_id && !row.keyword_text && !row.search_term) return true;
  const destination = String(pkg.destination || '').trim();
  if (!destination) return true;
  const haystack = [row.keyword_text, row.search_term, row.recommendation].join(' ');
  return haystack.includes(destination);
}

export async function getAdOsLearningContextForPackage(pkg: TravelPackageForSearchAds): Promise<AdOsLearningContext> {
  const db = getLearningDb();
  if (!db) return EMPTY_CONTEXT;

  const [eventRes, searchTermRes] = await Promise.all([
    db
      .from('ad_os_learning_events')
      .select('signal_type,product_id,keyword_text,search_term,score,recommendation,status')
      .in('status', ['candidate', 'approved', 'applied'])
      .order('score', { ascending: false })
      .limit(100),
    db
      .from('ad_os_search_term_candidates')
      .select('search_term,action,score,status')
      .in('status', ['candidate', 'approved'])
      .order('score', { ascending: false })
      .limit(100),
  ]);

  if (eventRes.error || searchTermRes.error) return EMPTY_CONTEXT;

  const events = ((eventRes.data || []) as LearningEventRow[])
    .filter((row) => matchesPackage(row, pkg))
    .sort((a, b) => asScore(b.score) - asScore(a.score));
  const searchTerms = ((searchTermRes.data || []) as SearchTermCandidateRow[])
    .sort((a, b) => asScore(b.score) - asScore(a.score));

  const winningKeywords = uniqueLimit([
    ...events
      .filter((row) => ['search_term_win', 'conversion', 'margin_win', 'cta_click'].includes(row.signal_type || ''))
      .map((row) => row.search_term || row.keyword_text),
    ...searchTerms
      .filter((row) => row.action === 'add_keyword')
      .map((row) => row.search_term),
  ], 12);

  const negativeTerms = uniqueLimit([
    ...events
      .filter((row) => ['search_term_negative', 'landing_underperform', 'keyword_underperform'].includes(row.signal_type || ''))
      .map((row) => row.search_term || row.keyword_text),
    ...searchTerms
      .filter((row) => row.action === 'add_negative')
      .map((row) => row.search_term),
  ], 12);

  const landingLessons = uniqueLimit(
    events
      .filter((row) => ['landing_click', 'landing_underperform', 'conversion'].includes(row.signal_type || ''))
      .map((row) => row.recommendation),
    5,
  );
  const ctaLessons = uniqueLimit(
    events
      .filter((row) => ['cta_click', 'conversion', 'margin_win'].includes(row.signal_type || ''))
      .map((row) => row.recommendation),
    5,
  );

  const parts = [
    winningKeywords.length ? `winners ${winningKeywords.slice(0, 3).join(', ')}` : '',
    negativeTerms.length ? `avoid ${negativeTerms.slice(0, 3).join(', ')}` : '',
    ctaLessons.length ? `cta ${ctaLessons.slice(0, 1).join('')}` : '',
    landingLessons.length ? `landing ${landingLessons.slice(0, 1).join('')}` : '',
  ].filter(Boolean);

  return {
    applied: parts.length > 0,
    winningKeywords,
    negativeTerms,
    landingLessons,
    ctaLessons,
    summary: parts.join(' / '),
  };
}
