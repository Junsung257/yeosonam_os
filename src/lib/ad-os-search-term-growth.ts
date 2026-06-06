import {
  classifyPaidKeywordIntent,
  classifyPaidKeywordTier,
  normalizePaidKeyword,
  suggestPaidBidKrw,
  type PaidKeywordPlatform,
  type PaidKeywordTier,
} from '@/lib/ad-os-seo-keyword-bridge';

export type SearchTermGrowthAction = 'add_keyword' | 'add_negative' | 'review';

export type SearchTermGrowthCandidate = {
  id: string;
  platform: PaidKeywordPlatform;
  searchTerm: string;
  parentKeyword?: string | null;
  action: SearchTermGrowthAction;
  priority?: 'high' | 'medium' | 'low' | null;
  impressions: number;
  clicks: number;
  costKrw: number;
  conversions: number;
  ctr?: number | null;
  score: number;
  reason?: string | null;
  source?: string | null;
};

export type SearchTermGrowthPackage = {
  id: string;
  title?: string | null;
  destination?: string | null;
  shortCode?: string | null;
};

export type ExistingKeywordPlanSignal = {
  packageId: string;
  platform: PaidKeywordPlatform;
  keywordText: string;
  matchType: 'exact' | 'phrase' | 'broad';
  tier?: PaidKeywordTier | null;
};

export type SearchTermGrowthDraft = {
  candidateId: string;
  packageId: string;
  platform: PaidKeywordPlatform;
  keyword: string;
  parentKeyword: string | null;
  action: 'create_keyword' | 'create_negative_keyword';
  tier: PaidKeywordTier;
  matchType: 'exact' | 'phrase';
  intent: 'commercial' | 'informational' | 'mixed' | 'negative';
  score: number;
  suggestedBidKrw: number;
  maxCpcGuardKrw: number;
  familyKey: string;
  reason: string;
  evidence: Record<string, unknown>;
};

export type SearchTermGrowthSkipped = {
  candidateId: string;
  searchTerm: string;
  reason: string;
};

export type SearchTermGrowthPlan = {
  keywordDrafts: SearchTermGrowthDraft[];
  negativeDrafts: SearchTermGrowthDraft[];
  skipped: SearchTermGrowthSkipped[];
  summary: {
    candidates: number;
    keyword_drafts: number;
    negative_drafts: number;
    skipped: number;
    blocked_duplicates: number;
    blocked_no_package: number;
    blocked_low_score: number;
    external_spend_krw: 0;
  };
};

const FAMILY_STOP_WORDS = [
  '여행',
  '패키지',
  '상품',
  '예약',
  '가격',
  '비용',
  '일정',
  '코스',
  '후기',
  '추천',
  '날씨',
  '옷차림',
  '항공',
  '출발',
  '가족',
  '효도',
  '단체',
  '문의',
  '상담',
];

export function buildPaidKeywordFamilyKey(keyword: string): string {
  const words = normalizePaidKeyword(keyword)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word && !FAMILY_STOP_WORDS.includes(word));
  return words.slice(0, 6).join(' ') || normalizePaidKeyword(keyword);
}

function compact(value: unknown): string {
  return normalizePaidKeyword(String(value || '')).replace(/\s+/g, '');
}

function findPackageForCandidate(
  candidate: SearchTermGrowthCandidate,
  packages: SearchTermGrowthPackage[],
  existingPlans: ExistingKeywordPlanSignal[],
): SearchTermGrowthPackage | null {
  const parent = normalizePaidKeyword(candidate.parentKeyword || '');
  if (parent) {
    const parentPlan = existingPlans.find((plan) =>
      plan.platform === candidate.platform &&
      normalizePaidKeyword(plan.keywordText) === parent
    );
    const parentPackage = parentPlan ? packages.find((pkg) => pkg.id === parentPlan.packageId) : null;
    if (parentPackage) return parentPackage;
  }

  const term = compact(candidate.searchTerm);
  let best: { pkg: SearchTermGrowthPackage; score: number } | null = null;
  for (const pkg of packages) {
    const destination = compact(pkg.destination);
    const title = compact(pkg.title);
    const shortCode = compact(pkg.shortCode);
    const score =
      (destination && (term.includes(destination) || destination.includes(term)) ? 80 : 0) +
      (title && title.includes(term) ? 30 : 0) +
      (shortCode && term.includes(shortCode) ? 20 : 0);
    if (score > 0 && (!best || score > best.score)) best = { pkg, score };
  }
  return best?.pkg ?? null;
}

function existingKeys(existingPlans: ExistingKeywordPlanSignal[]) {
  const exactKeys = new Set<string>();
  const familyKeys = new Set<string>();
  for (const plan of existingPlans) {
    const keyword = normalizePaidKeyword(plan.keywordText);
    const matchType = plan.matchType || 'exact';
    exactKeys.add(`${plan.packageId}::${plan.platform}::${keyword}::${matchType}`);
    familyKeys.add(`${plan.packageId}::${plan.platform}::${buildPaidKeywordFamilyKey(keyword)}::${plan.tier || 'unknown'}`);
  }
  return { exactKeys, familyKeys };
}

export function buildSearchTermGrowthPlan(
  candidates: SearchTermGrowthCandidate[],
  options: {
    packages: SearchTermGrowthPackage[];
    existingPlans: ExistingKeywordPlanSignal[];
    maxCpcByPlatform?: Partial<Record<PaidKeywordPlatform, number>>;
    minKeywordScore?: number;
    minNegativeScore?: number;
    limit?: number;
  },
): SearchTermGrowthPlan {
  const minKeywordScore = options.minKeywordScore ?? 45;
  const minNegativeScore = options.minNegativeScore ?? 35;
  const limit = options.limit ?? 100;
  const { exactKeys, familyKeys } = existingKeys(options.existingPlans);
  const keywordDrafts: SearchTermGrowthDraft[] = [];
  const negativeDrafts: SearchTermGrowthDraft[] = [];
  const skipped: SearchTermGrowthSkipped[] = [];

  const sorted = [...candidates]
    .filter((candidate) => candidate.action === 'add_keyword' || candidate.action === 'add_negative')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3);

  for (const candidate of sorted) {
    const keyword = normalizePaidKeyword(candidate.searchTerm);
    if (!keyword || keyword.length < 2) {
      skipped.push({ candidateId: candidate.id, searchTerm: candidate.searchTerm, reason: 'empty_or_too_short' });
      continue;
    }

    const pkg = findPackageForCandidate(candidate, options.packages, options.existingPlans);
    if (!pkg) {
      skipped.push({ candidateId: candidate.id, searchTerm: candidate.searchTerm, reason: 'no_matching_package' });
      continue;
    }

    const intent = candidate.action === 'add_negative' ? 'negative' : classifyPaidKeywordIntent(keyword);
    const tier = candidate.action === 'add_negative' ? 'negative' : classifyPaidKeywordTier(keyword, intent);
    const matchType: 'exact' | 'phrase' = tier === 'core' ? 'phrase' : 'exact';
    const familyKey = buildPaidKeywordFamilyKey(keyword);
    const exactKey = `${pkg.id}::${candidate.platform}::${keyword}::${matchType}`;
    const semanticKey = `${pkg.id}::${candidate.platform}::${familyKey}::${tier}`;

    if (exactKeys.has(exactKey) || familyKeys.has(semanticKey)) {
      skipped.push({ candidateId: candidate.id, searchTerm: candidate.searchTerm, reason: 'duplicate_keyword_family' });
      continue;
    }

    if (candidate.action === 'add_keyword' && (candidate.score < minKeywordScore || intent === 'negative')) {
      skipped.push({ candidateId: candidate.id, searchTerm: candidate.searchTerm, reason: 'low_score_or_negative_intent' });
      continue;
    }

    if (candidate.action === 'add_negative' && (candidate.score < minNegativeScore || candidate.conversions > 0)) {
      skipped.push({ candidateId: candidate.id, searchTerm: candidate.searchTerm, reason: 'negative_not_safe_enough' });
      continue;
    }

    const maxCpcGuardKrw = Math.max(100, options.maxCpcByPlatform?.[candidate.platform] || 1200);
    const score = Math.round(Math.max(0, candidate.score) * 10) / 10;
    const draft: SearchTermGrowthDraft = {
      candidateId: candidate.id,
      packageId: pkg.id,
      platform: candidate.platform,
      keyword,
      parentKeyword: normalizePaidKeyword(candidate.parentKeyword || '') || null,
      action: candidate.action === 'add_negative' ? 'create_negative_keyword' : 'create_keyword',
      tier,
      matchType,
      intent,
      score,
      suggestedBidKrw: candidate.action === 'add_negative'
        ? 0
        : suggestPaidBidKrw({ platform: candidate.platform, tier, score, maxCpcGuardKrw }),
      maxCpcGuardKrw,
      familyKey,
      reason: candidate.reason || (
        candidate.action === 'add_negative'
          ? 'Search term spent without enough conversion signal; keep as negative draft before broad expansion.'
          : 'Search term produced useful performance signal; promote as exact/phrase keyword draft.'
      ),
      evidence: {
        source: candidate.source || 'search_term_growth',
        candidate_id: candidate.id,
        parent_keyword: candidate.parentKeyword || null,
        impressions: candidate.impressions,
        clicks: candidate.clicks,
        cost_krw: candidate.costKrw,
        conversions: candidate.conversions,
        ctr: candidate.ctr ?? null,
        priority: candidate.priority || null,
      },
    };

    exactKeys.add(exactKey);
    familyKeys.add(semanticKey);
    if (candidate.action === 'add_negative') negativeDrafts.push(draft);
    else keywordDrafts.push(draft);
    if (keywordDrafts.length + negativeDrafts.length >= limit) break;
  }

  const countReason = (reason: string) => skipped.filter((row) => row.reason === reason).length;
  return {
    keywordDrafts,
    negativeDrafts,
    skipped,
    summary: {
      candidates: candidates.length,
      keyword_drafts: keywordDrafts.length,
      negative_drafts: negativeDrafts.length,
      skipped: skipped.length,
      blocked_duplicates: countReason('duplicate_keyword_family'),
      blocked_no_package: countReason('no_matching_package'),
      blocked_low_score: countReason('low_score_or_negative_intent') + countReason('negative_not_safe_enough'),
      external_spend_krw: 0,
    },
  };
}
