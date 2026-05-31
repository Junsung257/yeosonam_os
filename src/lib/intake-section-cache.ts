import type { NormalizedIntake } from './intake-normalizer';
import { REQUIRED_PACKAGE_EVIDENCE_FIELDS } from './source-evidence';
import { splitSupplierFormatSectionBlocks } from './supplier-format-fingerprint';

type SupabaseLike = {
  from: (table: string) => {
    select?: (columns: string) => unknown;
    upsert?: (rows: unknown[], options?: { onConflict?: string }) => PromiseLike<{ error?: { message?: string } | null }>;
    update?: (values: Record<string, unknown>) => SupabaseUpdateBuilder;
  };
};

type SupabaseQueryBuilder = {
  eq: (column: string, value: unknown) => SupabaseQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type SupabaseUpdateBuilder = {
  eq: (column: string, value: unknown) => unknown;
};

export const INTAKE_SECTION_CACHE_TABLE = 'normalized_intake_section_cache';

export type IntakeSectionCachePatch = Partial<Pick<
  NormalizedIntake,
  | 'meta'
  | 'flights'
  | 'priceGroups'
  | 'hotels'
  | 'inclusions'
  | 'excludes'
  | 'surcharges'
  | 'optionalTours'
  | 'days'
  | 'notices'
>>;

export type IntakeSectionCacheEntry = {
  label: string;
  exactHash: string;
  formatHash: string;
  charLength: number;
  rawTextHash: string;
  normalizerVersion: string;
  patch: IntakeSectionCachePatch;
};

export type IntakeSectionCacheStoreResult = {
  attempted: boolean;
  stored: number;
  warnings: string[];
};

export type IntakeSectionCacheCoverage = {
  total: number;
  covered: number;
  missing: string[];
  ratio: number;
  canReduceLlmInput: boolean;
};

export type IntakeSectionCacheReduction = {
  reducedRawText: string;
  reducedCharCount: number;
  replacedLabels: string[];
};

export const SECTION_CACHE_REQUIRED_FIELD_MAP: Record<string, readonly string[]> = {
  header: [
    'meta.region',
    'meta.tripStyle',
    'meta.minParticipants',
    'meta.airline',
    'flights.outbound[0].code',
    'flights.inbound[0].code',
  ],
  itinerary: [
    'flights.outbound[0].code',
    'flights.inbound[0].code',
  ],
  price: [
    'priceGroups[0].adultPrice',
  ],
};

export function isIntakeSectionCacheEnabled(): boolean {
  return process.env.RAW_UPLOAD_SECTION_CACHE_ENABLED === '1';
}

function hasValues(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== 'object') return Boolean(value);
  return Object.values(value as Record<string, unknown>).some(hasValues);
}

function pickPatchForLabel(ir: NormalizedIntake, label: string): IntakeSectionCachePatch {
  switch (label) {
    case 'price':
      return {
        priceGroups: ir.priceGroups,
        surcharges: ir.surcharges,
      };
    case 'itinerary':
      return {
        days: ir.days,
        hotels: ir.hotels,
        flights: ir.flights,
      };
    case 'terms':
      return {
        inclusions: ir.inclusions,
        excludes: ir.excludes,
        optionalTours: ir.optionalTours,
      };
    case 'optional':
      return {
        optionalTours: ir.optionalTours,
      };
    case 'notice':
      return {
        notices: ir.notices,
      };
    case 'header':
      return {
        meta: ir.meta,
        flights: ir.flights,
      };
    default:
      return {};
  }
}

function stripEmptyPatch(patch: IntakeSectionCachePatch): IntakeSectionCachePatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => hasValues(value)),
  ) as IntakeSectionCachePatch;
}

export function buildIntakeSectionCacheEntries(ir: NormalizedIntake): IntakeSectionCacheEntry[] {
  const sections = ir.sourceMeta?.sectionFingerprints ?? [];
  return sections
    .filter(section => Boolean(section.exactHash))
    .map(section => ({
      label: section.label,
      exactHash: section.exactHash as string,
      formatHash: section.hash,
      charLength: section.charLength,
      rawTextHash: ir.rawTextHash,
      normalizerVersion: ir.normalizerVersion,
      patch: stripEmptyPatch(pickPatchForLabel(ir, section.label)),
    }))
    .filter(entry => Object.keys(entry.patch).length > 0);
}

export function findReusableSectionEntry(
  entries: IntakeSectionCacheEntry[],
  section: { label: string; exactHash?: string | null },
  normalizerVersion: string,
): IntakeSectionCacheEntry | null {
  if (!section.exactHash) return null;
  return entries.find(entry =>
    entry.label === section.label
    && entry.exactHash === section.exactHash
    && entry.normalizerVersion === normalizerVersion
  ) ?? null;
}

export function applyIntakeSectionCacheEntries(
  ir: NormalizedIntake,
  entries: IntakeSectionCacheEntry[],
): NormalizedIntake {
  return entries.reduce((next, entry) => {
    switch (entry.label) {
      case 'price':
        return {
          ...next,
          priceGroups: entry.patch.priceGroups ?? next.priceGroups,
          surcharges: entry.patch.surcharges ?? next.surcharges,
        };
      case 'itinerary':
        return {
          ...next,
          days: entry.patch.days ?? next.days,
          hotels: entry.patch.hotels ?? next.hotels,
          flights: entry.patch.flights ?? next.flights,
        };
      case 'terms':
        return {
          ...next,
          inclusions: entry.patch.inclusions ?? next.inclusions,
          excludes: entry.patch.excludes ?? next.excludes,
          optionalTours: entry.patch.optionalTours ?? next.optionalTours,
        };
      case 'optional':
        return {
          ...next,
          optionalTours: entry.patch.optionalTours ?? next.optionalTours,
        };
      case 'notice':
        return {
          ...next,
          notices: entry.patch.notices ?? next.notices,
        };
      case 'header':
        return {
          ...next,
          meta: entry.patch.meta ?? next.meta,
          flights: entry.patch.flights ?? next.flights,
        };
      default:
        return next;
    }
  }, ir);
}

export function evaluateSectionCacheCoverage(
  entries: IntakeSectionCacheEntry[],
  requiredFields: readonly string[] = REQUIRED_PACKAGE_EVIDENCE_FIELDS,
): IntakeSectionCacheCoverage {
  const coveredFields = new Set<string>();
  for (const entry of entries) {
    for (const field of SECTION_CACHE_REQUIRED_FIELD_MAP[entry.label] ?? []) {
      coveredFields.add(field);
    }
  }
  const missing = requiredFields.filter(field => !coveredFields.has(field));
  const total = requiredFields.length;
  const covered = total - missing.length;
  return {
    total,
    covered,
    missing,
    ratio: total === 0 ? 1 : covered / total,
    canReduceLlmInput: missing.length === 0,
  };
}

export function isSectionCacheInputReductionEnabled(): boolean {
  return process.env.RAW_UPLOAD_SECTION_CACHE_REDUCE_INPUT === '1';
}

export function buildSectionCacheReducedRawText(
  rawText: string,
  entries: IntakeSectionCacheEntry[],
): IntakeSectionCacheReduction | null {
  if (!isSectionCacheInputReductionEnabled()) return null;

  const coverage = evaluateSectionCacheCoverage(entries);
  if (!coverage.canReduceLlmInput) return null;

  const hitKeys = new Set(entries.map(entry => `${entry.label}:${entry.exactHash}`));
  const blocks = splitSupplierFormatSectionBlocks(rawText);
  let reducedCharCount = 0;
  const replacedLabels: string[] = [];
  const reducedRawText = blocks.map(block => {
    if (!hitKeys.has(`${block.label}:${block.exactHash}`)) return block.text;
    reducedCharCount += block.text.length;
    replacedLabels.push(block.label);
    return `[SECTION_CACHE_HIT label=${block.label} exactHash=${block.exactHash} chars=${block.charLength}]`;
  }).join('\n\n');

  if (replacedLabels.length === 0) return null;
  return { reducedRawText, reducedCharCount, replacedLabels };
}

export async function storeIntakeSectionCacheEntries(
  sb: SupabaseLike,
  entries: IntakeSectionCacheEntry[],
): Promise<IntakeSectionCacheStoreResult> {
  if (!isIntakeSectionCacheEnabled() || entries.length === 0) {
    return { attempted: false, stored: 0, warnings: [] };
  }

  const rows = entries.map(entry => ({
    label: entry.label,
    exact_hash: entry.exactHash,
    format_hash: entry.formatHash,
    char_length: entry.charLength,
    raw_text_hash: entry.rawTextHash,
    normalizer_version: entry.normalizerVersion,
    patch: entry.patch,
  }));

  try {
    const { error } = await sb
      .from(INTAKE_SECTION_CACHE_TABLE)
      .upsert?.(rows, { onConflict: 'label,exact_hash,normalizer_version' }) ?? { error: { message: 'upsert unavailable' } };

    if (error) {
      return {
        attempted: true,
        stored: 0,
        warnings: [error.message ?? 'section cache upsert failed'],
      };
    }

    return { attempted: true, stored: rows.length, warnings: [] };
  } catch (e) {
    return {
      attempted: true,
      stored: 0,
      warnings: [e instanceof Error ? e.message : 'section cache upsert failed'],
    };
  }
}

export async function lookupIntakeSectionCacheEntry(
  sb: SupabaseLike,
  section: { label: string; exactHash?: string | null },
  normalizerVersion: string,
): Promise<IntakeSectionCacheEntry | null> {
  if (!isIntakeSectionCacheEnabled() || !section.exactHash) return null;

  try {
    const builder = sb
      .from(INTAKE_SECTION_CACHE_TABLE)
      .select?.('id, label, exact_hash, format_hash, char_length, raw_text_hash, normalizer_version, patch, hit_count') as SupabaseQueryBuilder | undefined;
    if (!builder) return null;

    const { data, error } = await builder
      .eq('label', section.label)
      .eq('exact_hash', section.exactHash)
      .eq('normalizer_version', normalizerVersion)
      .maybeSingle();

    if (error || !data || typeof data !== 'object') return null;
    const row = data as {
      id?: string;
      label?: string;
      exact_hash?: string;
      format_hash?: string;
      char_length?: number;
      raw_text_hash?: string;
      normalizer_version?: string;
      patch?: IntakeSectionCachePatch;
      hit_count?: number;
    };

    if (!row.label || !row.exact_hash || !row.raw_text_hash || !row.normalizer_version || !row.patch) {
      return null;
    }

    if (row.id) {
      const updateBuilder = sb
        .from(INTAKE_SECTION_CACHE_TABLE)
        .update?.({
          hit_count: (row.hit_count ?? 0) + 1,
          last_hit_at: new Date().toISOString(),
        });
      if (updateBuilder) void updateBuilder.eq('id', row.id);
    }

    return {
      label: row.label,
      exactHash: row.exact_hash,
      formatHash: row.format_hash ?? '',
      charLength: row.char_length ?? 0,
      rawTextHash: row.raw_text_hash,
      normalizerVersion: row.normalizer_version,
      patch: row.patch,
    };
  } catch {
    return null;
  }
}
