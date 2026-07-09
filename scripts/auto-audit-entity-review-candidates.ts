import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { KOREAN_DESTINATION_TO_ISO } from '../src/lib/destination-iso';
import { terminalNonMasterReason } from '../src/lib/itinerary-entity-resolution-engine';
import { reEnrichAffectedPackages } from '../src/lib/package-reenrich-on-attraction-change';

loadEnv({ path: '.env.local' });
loadEnv();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const allowAutoInternal = args.includes('--allow-auto-internal');
const limit = Number(argValue('--limit', '1000'));

function argValue(name: string, fallback: string): string {
  const found = args.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

type ReviewCandidateRow = {
  id: string;
  candidate_key: string;
  category: string;
  raw_label: string | null;
  normalized_label: string | null;
  canonical_name: string | null;
  destination_scope: string | null;
  country_scope: string | null;
  region_scope: string | null;
  promotion_status: string | null;
  auto_action: string | null;
  auto_verification_status: string | null;
  decision_reason: string | null;
  source_unmatched_ids: string[] | null;
  source_context: Record<string, unknown> | null;
  suggested_master: Record<string, unknown> | null;
};

type ExistingAttractionMatch = {
  id: string;
  name: string;
  aliases?: string[] | null;
  badge_type?: string | null;
  customer_publishable?: boolean | null;
  country?: string | null;
  region?: string | null;
};

type AttractionAliasRow = {
  canonical_name: string | null;
  alias: string | null;
};

type IndexedAttractionTerm = {
  attraction: ExistingAttractionMatch;
  term: string;
  normalized: string;
  primary: boolean;
};

type AttractionIndex = {
  literal: Map<string, ExistingAttractionMatch[]>;
  normalized: Map<string, ExistingAttractionMatch[]>;
  terms: IndexedAttractionTerm[];
};

const GENERIC_CONTAINED_MATCH_TERMS = new Set([
  '관광',
  '관광지',
  '기념촬영',
  '디너크루즈',
  '유람선',
  '입장권',
  '체험',
  '크루즈',
  '테마파크',
  '투어',
  '야시장',
  '시장',
]);
const PRODUCT_LIKE_ATTRACTION_NAME_RE = /(?:투어|티켓|입장권|할인|픽업|당일|즉시|출발|예약|패키지|PKG|\[[^\]]+\])/i;
const SHORT_CONTAINED_ATTRACTION_TERMS = new Set(['예류', '야류', '스펀', '지우펀'].map(normalizedAttractionMatchTerm));

const LODGING_LIKE_ATTRACTION_NAME_RE = /(?:호텔|리조트|윈덤|노보텔|멜리아|하바나|하얏트|풀만|홀리데이|아쿠아썬|스파)/i;
const NON_ATTRACTION_BADGE_TYPES = new Set(['hotel', 'restaurant', 'meal', 'shopping', 'golf']);

const COUNTRY_SCOPE_ALIASES = (() => {
  const aliases = new Map<string, Set<string>>();
  for (const [name, iso] of Object.entries(KOREAN_DESTINATION_TO_ISO)) {
    if (!aliases.has(iso)) aliases.set(iso, new Set([iso]));
    aliases.get(iso)?.add(name);
  }
  const extraAliases: Record<string, string[]> = {
    CN: ['백두산', '연변', '길림', '두만강'],
    JP: ['규슈', '유후인', '쿠로가와'],
    TW: ['기륭', '타이완'],
    VN: ['캠비치', '소나시'],
  };
  for (const [iso, names] of Object.entries(extraAliases)) {
    if (!aliases.has(iso)) aliases.set(iso, new Set([iso]));
    for (const name of names) aliases.get(iso)?.add(name);
  }
  return aliases;
})();

const supabase = createClient(url, key, { auth: { persistSession: false } });
const candidateColumns = [
  'id',
  'candidate_key',
  'category',
  'raw_label',
  'normalized_label',
  'canonical_name',
  'destination_scope',
  'country_scope',
  'region_scope',
  'promotion_status',
  'auto_action',
  'auto_verification_status',
  'decision_reason',
  'source_unmatched_ids',
  'source_context',
  'suggested_master',
].join(', ');

async function fetchRows(): Promise<ReviewCandidateRow[]> {
  const { data: reviewRows, error: reviewError } = await supabase
    .from('entity_master_candidates')
    .select(candidateColumns)
    .eq('promotion_status', 'needs_review')
    .in('category', ['attraction', 'hotel'])
    .limit(limit);
  if (reviewError) throw reviewError;

  const { data: candidateRows, error: candidateError } = await supabase
    .from('entity_master_candidates')
    .select(candidateColumns)
    .eq('promotion_status', 'candidate')
    .in('category', ['attraction', 'hotel'])
    .limit(limit);
  if (candidateError) throw candidateError;

  const allRows = [
    ...((reviewRows ?? []) as unknown as ReviewCandidateRow[]),
    ...((candidateRows ?? []) as unknown as ReviewCandidateRow[]),
  ];
  const rows = new Map<string, ReviewCandidateRow>();
  for (const row of allRows) {
    const isReviewCandidate = row.promotion_status === 'needs_review';
    const isStructuredNonMaster = row.auto_action === 'structure_non_master' ||
      row.auto_action === 'reject_noise' ||
      row.auto_verification_status === 'structured_non_master';
    if (isReviewCandidate || isStructuredNonMaster) rows.set(row.id, row);
  }
  return Array.from(rows.values());
}

function resolutionFor(row: ReviewCandidateRow): { reason: string; canonicalName: string; structured: boolean } | null {
  const canonicalName = row.canonical_name || row.normalized_label || row.raw_label || '';
  const reason = terminalNonMasterReason(row.category, canonicalName, row.raw_label || row.normalized_label || canonicalName);
  if (reason) return { reason, canonicalName, structured: false };
  if (row.auto_action === 'structure_non_master' || row.auto_verification_status === 'structured_non_master') {
    return {
      reason: row.decision_reason || 'structured source fragment, not a master entity',
      canonicalName,
      structured: true,
    };
  }
  if (row.auto_action === 'reject_noise') {
    return {
      reason: row.decision_reason || 'pre-classified non-master or noise candidate',
      canonicalName,
      structured: false,
    };
  }
  return null;
}

function canonicalFor(row: ReviewCandidateRow): string {
  return row.canonical_name || row.normalized_label || row.raw_label || '';
}

function embeddedCandidateTerms(value: string): string[] {
  const terms: string[] = [];
  const patterns = [
    /["“”'‘’「」『』〈〉《》]\s*([^"“”'‘’「」『』〈〉《》]{2,24}?)\s*["“”'‘’「」『』〈〉《》]/g,
    /[([]\s*([^()[\]]{2,24}?)\s*[)\]]/g,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const term = match[1]?.replace(/\s+/g, ' ').trim();
      if (term && term.length >= 2) terms.push(term);
    }
  }
  return terms;
}

function descriptiveAttractionCandidateTerms(value: string): string[] {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const terms: string[] = [];
  const patterns = [
    /(바오다이\s*황제(?:의)?\s*여름별장)/,
    /(두만강\s*강변공원)/,
    /(그랜드\s*월드|그랜드월드)(?:\s*나이트)?/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const term = match?.[1]?.replace(/\s+/g, ' ').trim();
    if (term && term.length >= 2) terms.push(term);
  }

  return terms;
}

function exactCandidateTerms(row: ReviewCandidateRow): string[] {
  const baseTerms = [
    row.canonical_name,
    row.normalized_label,
    row.raw_label,
  ].map(value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''))
    .filter(value => value.length >= 2);

  return Array.from(new Set([
    ...baseTerms,
    ...baseTerms.flatMap(embeddedCandidateTerms),
    ...baseTerms.flatMap(descriptiveAttractionCandidateTerms),
  ]));
}

function normalizedAttractionMatchTerm(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()[\]{}<>〈〉《》「」『』【】]/g, '')
    .replace(/[·ㆍ.,/\\|:;'"`~!@#$%^&*_+=?，。]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function addIndexedTerm(
  index: AttractionIndex,
  attraction: ExistingAttractionMatch,
  term: unknown,
  primary = false,
) {
  if (typeof term !== 'string') return;
  const literal = term.replace(/\s+/g, ' ').trim();
  if (literal.length < 2) return;

  const literalRows = index.literal.get(literal) ?? [];
  literalRows.push(attraction);
  index.literal.set(literal, literalRows);

  const normalized = normalizedAttractionMatchTerm(literal);
  if (normalized.length < 2) return;
  const normalizedRows = index.normalized.get(normalized) ?? [];
  normalizedRows.push(attraction);
  index.normalized.set(normalized, normalizedRows);
  index.terms.push({ attraction, term: literal, normalized, primary });
}

async function fetchAttractionIndex(): Promise<AttractionIndex> {
  const index: AttractionIndex = {
    literal: new Map(),
    normalized: new Map(),
    terms: [],
  };
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id, name, aliases, badge_type, customer_publishable, country, region')
      .eq('is_active', true)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as ExistingAttractionMatch[];
    for (const attraction of rows) {
      addIndexedTerm(index, attraction, attraction.name, true);
      for (const alias of attraction.aliases ?? []) addIndexedTerm(index, attraction, alias);
    }
    if (rows.length < pageSize) break;
  }

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('attractions_aliases')
      .select('canonical_name, alias')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const aliasRows = (data ?? []) as AttractionAliasRow[];
    for (const aliasRow of aliasRows) {
      const canonicalName = typeof aliasRow.canonical_name === 'string'
        ? aliasRow.canonical_name.replace(/\s+/g, ' ').trim()
        : '';
      const alias = typeof aliasRow.alias === 'string'
        ? aliasRow.alias.replace(/\s+/g, ' ').trim()
        : '';
      if (!canonicalName || !alias) continue;

      const canonicalAttraction =
        uniqueAttractionMatch(index.literal.get(canonicalName)) ??
        uniqueAttractionMatch(index.normalized.get(normalizedAttractionMatchTerm(canonicalName)));
      if (!canonicalAttraction) continue;
      addIndexedTerm(index, canonicalAttraction, alias);
    }
    if (aliasRows.length < pageSize) break;
  }
  return index;
}

function uniqueAttractionMatch(matches: ExistingAttractionMatch[] | undefined): ExistingAttractionMatch | null {
  if (!matches || matches.length === 0) return null;
  const byId = new Map(matches.map(match => [match.id, match]));
  return byId.size === 1 ? [...byId.values()][0] ?? null : null;
}

function isUnsafeExactAttractionTerm(row: ReviewCandidateRow, term: string): boolean {
  if (row.category !== 'attraction') return false;
  const cleaned = term.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 2) return true;
  return Boolean(terminalNonMasterReason('attraction', cleaned, term));
}

function sourcePackageIds(row: ReviewCandidateRow): string[] {
  const ids = row.source_context?.package_ids;
  return Array.isArray(ids)
    ? ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
}

function compactScopeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(compactScopeText).join(' ');
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(compactScopeText).join(' ');
  }
  return '';
}

function sourceScopeText(row: ReviewCandidateRow): string {
  const source = row.source_context ?? {};
  return [
    row.canonical_name,
    row.raw_label,
    row.normalized_label,
    row.country_scope,
    row.region_scope,
    source.country,
    source.region,
    source.destinations,
    source.regions,
    source.countries,
    source.package_titles,
    source.examples,
  ].map(compactScopeText).join(' ');
}

function hasScopeSupport(row: ReviewCandidateRow, attraction: ExistingAttractionMatch): boolean {
  const normalizedScope = normalizedAttractionMatchTerm(sourceScopeText(row));
  const region = normalizedAttractionMatchTerm(attraction.region ?? '');
  const country = normalizedAttractionMatchTerm(attraction.country ?? '');
  const countryAliases = COUNTRY_SCOPE_ALIASES.get(String(attraction.country ?? '').toUpperCase()) ?? new Set();
  const countryAliasSupported = [...countryAliases].some(alias => {
    const normalizedAlias = normalizedAttractionMatchTerm(alias);
    return normalizedAlias.length >= 2 && normalizedScope.includes(normalizedAlias);
  });
  return Boolean(
    (region.length >= 2 && normalizedScope.includes(region)) ||
    (country.length >= 2 && normalizedScope.includes(country)) ||
    countryAliasSupported,
  );
}

function isGenericContainedMatchTerm(entry: IndexedAttractionTerm): boolean {
  if (GENERIC_CONTAINED_MATCH_TERMS.has(entry.normalized)) return true;
  return !entry.primary && entry.normalized.length < 4;
}

function isProductLikeAttractionName(attraction: ExistingAttractionMatch): boolean {
  return PRODUCT_LIKE_ATTRACTION_NAME_RE.test(attraction.name) ||
    LODGING_LIKE_ATTRACTION_NAME_RE.test(attraction.name) ||
    NON_ATTRACTION_BADGE_TYPES.has(String(attraction.badge_type ?? '').toLowerCase());
}

function findContainedExistingAttractionMatch(
  row: ReviewCandidateRow,
  index: AttractionIndex,
): ExistingAttractionMatch | null {
  if (row.category !== 'attraction') return null;

  const matches: IndexedAttractionTerm[] = [];
  for (const term of exactCandidateTerms(row)) {
    if (isUnsafeExactAttractionTerm(row, term)) continue;
    const normalizedCandidate = normalizedAttractionMatchTerm(term);
    if (normalizedCandidate.length < 4 && !SHORT_CONTAINED_ATTRACTION_TERMS.has(normalizedCandidate)) continue;

    for (const entry of index.terms) {
      if (entry.normalized.length < 3) continue;
      if (isGenericContainedMatchTerm(entry)) continue;
      if (!entry.attraction.customer_publishable) continue;
      if (isProductLikeAttractionName(entry.attraction)) continue;
      if (!hasScopeSupport(row, entry.attraction)) continue;

      const primaryName = normalizedAttractionMatchTerm(entry.attraction.name);
      const primaryContained = primaryName.length >= 3 && (
        normalizedCandidate.includes(primaryName) ||
        primaryName.includes(normalizedCandidate)
      );
      const aliasNearExact = !entry.primary &&
        entry.normalized.length >= 4 &&
        Math.min(normalizedCandidate.length, entry.normalized.length) /
          Math.max(normalizedCandidate.length, entry.normalized.length) >= 0.75;

      if (!primaryContained && !aliasNearExact) continue;
      if (!normalizedCandidate.includes(entry.normalized) && !entry.normalized.includes(normalizedCandidate)) continue;
      matches.push(entry);
    }
  }

  const byId = new Map(matches.map(match => [match.attraction.id, match.attraction]));
  return byId.size === 1 ? [...byId.values()][0] ?? null : null;
}

function findExistingAttractionMatch(row: ReviewCandidateRow, index: AttractionIndex): ExistingAttractionMatch | null {
  if (row.category !== 'attraction') return null;
  for (const term of exactCandidateTerms(row)) {
    if (isUnsafeExactAttractionTerm(row, term)) continue;

    const literalMatch = uniqueAttractionMatch(index.literal.get(term));
    if (literalMatch && !isProductLikeAttractionName(literalMatch)) return literalMatch;

    const normalized = normalizedAttractionMatchTerm(term);
    if (normalized.length < 2) continue;
    const normalizedMatch = uniqueAttractionMatch(index.normalized.get(normalized));
    if (normalizedMatch && !isProductLikeAttractionName(normalizedMatch)) return normalizedMatch;
  }
  return findContainedExistingAttractionMatch(row, index);
}

async function persist(
  row: ReviewCandidateRow,
  reason: string,
  canonicalName: string,
  structured = false,
): Promise<void> {
  const verificationStatus = structured ? 'structured_non_master' : 'rejected_noise';
  const suggestedMaster = {
    ...(row.suggested_master ?? {}),
    canonical_name: canonicalName,
    customer_publishable: false,
    verification_status: verificationStatus,
    auto_review: {
      mode: structured ? 'auto_structured_non_master' : 'auto_rejected_non_master',
      reason,
      reviewed_by: 'auto-audit-entity-review-candidates',
      reviewed_at: new Date().toISOString(),
    },
  };

  const { error } = await supabase
    .from('entity_master_candidates')
    .update({
      promotion_status: 'rejected_noise',
      auto_action: structured ? 'structure_non_master' : 'reject_noise',
      auto_verification_status: verificationStatus,
      decision_reason: `auto-reviewed as non-master: ${reason}`,
      suggested_master: suggestedMaster,
      verified_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (error) throw error;
}

async function persistInternalCandidate(row: ReviewCandidateRow): Promise<void> {
  const canonicalName = canonicalFor(row);
  const suggestedMaster = {
    ...(row.suggested_master ?? {}),
    canonical_name: canonicalName,
    customer_publishable: false,
    verification_status: 'auto_internal',
    auto_review: {
      mode: 'auto_internal_candidate',
      reason: 'clean place-like candidate retained as hidden internal candidate; public publishing requires stronger evidence or admin approval',
      reviewed_by: 'auto-audit-entity-review-candidates',
      reviewed_at: new Date().toISOString(),
    },
  };

  const { error } = await supabase
    .from('entity_master_candidates')
    .update({
      promotion_status: 'auto_internal',
      auto_action: 'create_internal_master',
      auto_verification_status: 'unverified',
      decision_reason: 'clean place-like candidate retained as hidden internal candidate; no customer publishing',
      suggested_master: suggestedMaster,
      verified_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (error) throw error;
}

async function persistExistingMatch(row: ReviewCandidateRow, attraction: ExistingAttractionMatch): Promise<string[]> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('entity_master_candidates')
    .update({
      promotion_status: 'promoted',
      promoted_attraction_id: attraction.id,
      promoted_at: now,
      auto_verification_status: attraction.customer_publishable === true ? 'verified_publishable' : 'verified_internal',
      decision_reason: `auto-linked to existing attraction ${attraction.name}`,
    })
    .eq('id', row.id);
  if (error) throw error;

  const sourceUnmatchedIds = (row.source_unmatched_ids ?? []).filter(Boolean);
  let sourceRows: Array<{ package_id: string | null }> = [];
  if (sourceUnmatchedIds.length > 0) {
    const { data: loadedSourceRows, error: sourceRowsError } = await supabase
      .from('unmatched_activities')
      .select('package_id')
      .in('id', sourceUnmatchedIds)
      .not('package_id', 'is', null);
    if (sourceRowsError) throw sourceRowsError;
    sourceRows = (loadedSourceRows ?? []) as Array<{ package_id: string | null }>;

    const { error: closeError } = await supabase
      .from('unmatched_activities')
      .update({
        status: 'added',
        resolved_at: now,
        resolved_kind: 'auto_existing_attraction',
        resolved_attraction_id: attraction.id,
        resolved_by: 'auto-audit-entity-review-candidates',
        updated_at: now,
      })
      .in('id', sourceUnmatchedIds)
      .eq('status', 'pending')
      .is('resolved_at', null);
    if (closeError) throw closeError;
  }

  return Array.from(new Set([
    ...sourcePackageIds(row),
    ...sourceRows
      .map(sourceRow => sourceRow.package_id)
      .filter((value): value is string => Boolean(value)),
  ]));
}

async function main() {
  const rows = await fetchRows();
  const attractionIndex = await fetchAttractionIndex();
  const audited: Array<{ candidate_key: string; category: string; canonical_name: string; reason: string }> = [];
  const linkedExisting: Array<{ candidate_key: string; category: string; canonical_name: string; attraction: string }> = [];
  const internalCandidates: Array<{ candidate_key: string; category: string; canonical_name: string }> = [];
  const remaining: Array<{ candidate_key: string; category: string; canonical_name: string }> = [];
  const errors: Array<{ candidate_key: string; error: string }> = [];
  const affectedAttractionIds = new Set<string>();
  const affectedPackageIds = new Set<string>();

  for (const row of rows) {
    const resolution = resolutionFor(row);
    if (!resolution) {
      if (row.promotion_status !== 'needs_review') {
        remaining.push({
          candidate_key: row.candidate_key,
          category: row.category,
          canonical_name: canonicalFor(row),
        });
        continue;
      }

      const exactMatch = findExistingAttractionMatch(row, attractionIndex);
      if (!exactMatch) {
        const unresolved = {
          candidate_key: row.candidate_key,
          category: row.category,
          canonical_name: canonicalFor(row),
        };
        if (!allowAutoInternal) {
          remaining.push(unresolved);
          continue;
        }

        internalCandidates.push(unresolved);
        if (apply) {
          try {
            await persistInternalCandidate(row);
          } catch (error) {
            errors.push({
              candidate_key: row.candidate_key,
              error: error instanceof Error ? error.message : String(error),
            });
            remaining.push({
              candidate_key: row.candidate_key,
              category: row.category,
              canonical_name: canonicalFor(row),
            });
          }
        }
        continue;
      }

      linkedExisting.push({
        candidate_key: row.candidate_key,
        category: row.category,
        canonical_name: canonicalFor(row),
        attraction: exactMatch.name,
      });

      if (apply) {
        try {
          const packageIds = await persistExistingMatch(row, exactMatch);
          affectedAttractionIds.add(exactMatch.id);
          for (const packageId of packageIds) affectedPackageIds.add(packageId);
        } catch (error) {
          errors.push({
            candidate_key: row.candidate_key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      continue;
    }

    audited.push({
      candidate_key: row.candidate_key,
      category: row.category,
      canonical_name: resolution.canonicalName,
      reason: resolution.reason,
    });

    if (apply) {
      try {
        await persist(row, resolution.reason, resolution.canonicalName, resolution.structured);
      } catch (error) {
        errors.push({
          candidate_key: row.candidate_key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const reEnrich = apply && affectedAttractionIds.size > 0
    ? await reEnrichAffectedPackages([...affectedAttractionIds], {
        packageIds: [...affectedPackageIds],
        maxPackages: Math.max(50, affectedPackageIds.size),
        forceRevalidate: true,
      })
    : null;

  const output = {
    scanned: rows.length,
    auto_rejected: audited.length,
    linked_existing: linkedExisting.length,
    auto_internal_candidates: internalCandidates.length,
    remaining_review: remaining.length,
    apply,
    allow_auto_internal: allowAutoInternal,
    reEnrich,
    errors,
    byReason: audited.reduce<Record<string, number>>((acc, row) => {
      acc[row.reason] = (acc[row.reason] ?? 0) + 1;
      return acc;
    }, {}),
    sampleAutoRejected: audited.slice(0, 20),
    sampleLinkedExisting: linkedExisting.slice(0, 50),
    sampleAutoInternalCandidates: internalCandidates.slice(0, 20),
    sampleRemaining: remaining.slice(0, 20),
  };

  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
