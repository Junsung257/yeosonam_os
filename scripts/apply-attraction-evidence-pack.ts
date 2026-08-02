import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

type Candidate = {
  name: string;
  short_desc: string;
  long_desc: string;
  country: string;
  region: string;
  badge_type: string;
  emoji: string;
  aliases: string[];
  official_source_url: string;
  supporting_source_urls: string[];
  source_phrases: string[];
  verification_method: string;
  evidence_summary: string;
};

type Pack = {
  candidateMasters: Candidate[];
  holds: unknown[];
  activeCatalogConflicts: unknown[];
};

const AUTHORIZATION = 'user_delegated_automation_2026_07_31';
const ALLOWED_BADGES = new Set([
  'tour', 'special', 'shopping', 'meal', 'optional', 'hotel',
  'restaurant', 'golf', 'activity', 'onsen',
]);

function normalized(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('ko-KR').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizedV3SourcePhrase(value: string): string {
  return value
    .replace(/^[\s▶●•·◆◇■□★☆+\-♣∎※]+/u, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(?:관광|산책|체험|방문|조망)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function verifiedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function evidenceComplete(candidate: Candidate): boolean {
  return Boolean(
    candidate.name?.trim()
    && candidate.short_desc?.trim()
    && candidate.long_desc?.trim()
    && candidate.country?.trim()
    && candidate.region?.trim()
    && candidate.evidence_summary?.trim()
    && candidate.verification_method?.trim()
    && candidate.source_phrases?.length
    && verifiedUrl(candidate.official_source_url),
  );
}

async function main() {
  const fileArg = process.argv.find(value => value.startsWith('--pack='))?.slice('--pack='.length);
  if (!fileArg) throw new Error('--pack=<path> is required');
  const apply = process.argv.includes('--apply');
  const authorization = process.argv.find(value => value.startsWith('--authorization='))?.slice('--authorization='.length);
  if (apply && authorization !== AUTHORIZATION) {
    throw new Error(`--authorization=${AUTHORIZATION} is required for apply mode`);
  }

  const pack = JSON.parse(String(await readFile(resolve(fileArg), { encoding: 'utf8' }))) as Pack;
  if (!Array.isArray(pack.candidateMasters) || pack.candidateMasters.length === 0) {
    throw new Error('candidateMasters is empty');
  }
  const invalid = pack.candidateMasters.filter(candidate => !evidenceComplete(candidate));
  if (invalid.length > 0) throw new Error(`incomplete evidence: ${invalid.map(row => row.name).join(', ')}`);
  const sourcePhraseOwners = new Map<string, Set<string>>();
  for (const candidate of pack.candidateMasters) {
    for (const phrase of candidate.source_phrases ?? []) {
      for (const value of [phrase, normalizedV3SourcePhrase(phrase)]) {
        const key = normalized(value);
        if (!key) continue;
        const owners = sourcePhraseOwners.get(key) ?? new Set<string>();
        owners.add(candidate.name);
        sourcePhraseOwners.set(key, owners);
      }
    }
  }
  const uniqueSourceAliases = (candidate: Candidate): string[] => [...new Set(
    (candidate.source_phrases ?? [])
      .flatMap(phrase => [phrase, normalizedV3SourcePhrase(phrase)])
      .filter(value => sourcePhraseOwners.get(normalized(value))?.size === 1),
  )];

  const [{ supabaseAdmin, isSupabaseConfigured }, { resweepUnmatchedActivities }, { reEnrichAffectedPackages }] = await Promise.all([
    import('../src/lib/supabase'),
    import('../src/lib/unmatched-resweep'),
    import('../src/lib/package-reenrich-on-attraction-change'),
  ]);
  if (!isSupabaseConfigured || !supabaseAdmin) throw new Error('Supabase is not configured');

  const catalog: Array<{
    id: string;
    name: string;
    aliases: string[] | null;
    source_ids: unknown;
    verification_sources: unknown;
  }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error: catalogError } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, source_ids, verification_sources')
      .eq('is_active', true)
      .order('id')
      .range(offset, offset + 999);
    if (catalogError) throw catalogError;
    catalog.push(...((page ?? []) as typeof catalog));
    if ((page ?? []).length < 1000) break;
  }

  const existingNames = new Map(catalog.map(row => [normalized(String(row.name)), row]));
  const catalogTerms = new Map<string, { id: string; name: string }>();
  for (const row of catalog) {
    for (const value of [row.name, ...(Array.isArray(row.aliases) ? row.aliases : [])]) {
      const key = normalized(String(value ?? ''));
      if (key) catalogTerms.set(key, { id: String(row.id), name: String(row.name) });
    }
  }

  const collisions: Array<Record<string, string>> = [];
  for (const candidate of pack.candidateMasters) {
    const candidateTerms = [
      candidate.name,
      ...(candidate.aliases ?? []),
      ...uniqueSourceAliases(candidate),
    ];
    for (const value of candidateTerms) {
      const match = catalogTerms.get(normalized(value));
      if (match && normalized(match.name) !== normalized(candidate.name)) {
        collisions.push({ candidate: candidate.name, value, existing: match.name });
      }
    }
  }
  if (collisions.length > 0) {
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', collisions }, null, 2));
    throw new Error('catalog alias collision detected');
  }

  const now = new Date().toISOString();
  const rows = pack.candidateMasters.map(candidate => {
    const existing = existingNames.get(normalized(candidate.name));
    const existingSourceIds = existing?.source_ids && typeof existing.source_ids === 'object'
      ? existing.source_ids as Record<string, unknown>
      : {};
    const existingSources = Array.isArray(existing?.verification_sources) ? existing.verification_sources : [];
    const evidenceUrls = [candidate.official_source_url, ...(candidate.supporting_source_urls ?? [])]
      .map(verifiedUrl)
      .filter((url): url is string => Boolean(url));
    return {
      name: candidate.name.normalize('NFC').trim(),
      short_desc: candidate.short_desc.trim(),
      long_desc: candidate.long_desc.trim(),
      country: candidate.country.trim(),
      region: candidate.region.trim(),
      badge_type: ALLOWED_BADGES.has(candidate.badge_type) ? candidate.badge_type : 'tour',
      emoji: candidate.emoji || '📍',
      aliases: [...new Set([
        ...(candidate.aliases ?? []),
        ...uniqueSourceAliases(candidate),
      ].map(value => value.normalize('NFC').trim()).filter(Boolean))],
      is_active: true,
      customer_publishable: true,
      verification_status: 'published',
      auto_created: false,
      is_manual_override: false,
      source: 'user_delegated_official_evidence_pack',
      external_url: candidate.official_source_url,
      confidence_score: 1,
      source_ids: {
        ...existingSourceIds,
        delegated_evidence_review: {
          authorization: AUTHORIZATION,
          authorized_at: now,
          pack_path: resolve(fileArg),
          source_phrases: candidate.source_phrases,
          verification_method: candidate.verification_method,
          evidence_summary: candidate.evidence_summary,
        },
      },
      verification_sources: [
        ...existingSources,
        ...evidenceUrls.map((url, index) => ({
          source: index === 0 ? 'official_site' : 'supporting_official_site',
          url,
          name: candidate.name,
          confidence: 1,
          verified_at: now,
        })),
      ],
      review_required_reason: null,
    };
  });

  if (!apply) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      candidates: rows.length,
      newMasters: rows.filter(row => !existingNames.has(normalized(row.name))).length,
      heldPhrases: pack.holds?.length ?? 0,
      catalogConflictsInSourcePack: pack.activeCatalogConflicts?.length ?? 0,
    }, null, 2));
    return;
  }

  const { error: upsertError } = await supabaseAdmin
    .from('attractions')
    .upsert(rows as never[], { onConflict: 'name' });
  if (upsertError) throw upsertError;

  const { data: saved, error: savedError } = await supabaseAdmin
    .from('attractions')
    .select('id, name')
    .in('name', rows.map(row => row.name));
  if (savedError) throw savedError;
  const attractionIds = (saved ?? []).map(row => String(row.id));
  const sweep = await resweepUnmatchedActivities(attractionIds);
  const reenrich = await reEnrichAffectedPackages(attractionIds, { maxPackages: 100, forceRevalidate: true });

  console.log(JSON.stringify({
    mode: 'apply',
    upserted: rows.length,
    attractionIds: attractionIds.length,
    heldPhrases: pack.holds?.length ?? 0,
    sweep,
    reenrich,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error
    ? error.message
    : JSON.stringify(error, null, 2));
  process.exitCode = 1;
});
