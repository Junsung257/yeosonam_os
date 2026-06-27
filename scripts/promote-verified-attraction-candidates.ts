import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildSourceBackedAttractionDescriptions } from '../src/lib/attraction-source-backed-description';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.croncheck.local' });
loadEnv();

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const json = args.has('--json');
const limit = Number(argValue('--limit', '50'));
const destination = argValue('--destination', '');
const minScore = Number(argValue('--min-score', '0.44'));
const packageIdFilter = argValue('--package-ids', '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function argValue(name: string, fallback: string): string {
  const found = process.argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const supabase = createClient(url, key, { auth: { persistSession: false } });

type CandidateRow = {
  id: string;
  candidate_key: string;
  raw_label: string | null;
  normalized_label: string | null;
  canonical_name: string | null;
  destination_scope: string | null;
  country_scope: string | null;
  region_scope: string | null;
  source_context: Record<string, unknown> | null;
  suggested_master: Record<string, unknown> | null;
  external_sources: Array<{ name?: string | null; id?: string | null; source?: string | null }> | null;
  source_unmatched_ids: string[] | null;
  verification_score: number | null;
  package_count: number | null;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function packageIdsFrom(row: CandidateRow): string[] {
  const ids = row.source_context?.package_ids;
  return Array.isArray(ids)
    ? ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
}

function sourceExamplesFrom(row: CandidateRow): string[] {
  const examples = row.source_context?.examples;
  if (Array.isArray(examples)) return examples.filter((value): value is string => typeof value === 'string');
  const rawExamples = row.source_context?.raw_examples;
  if (Array.isArray(rawExamples)) return rawExamples.filter((value): value is string => typeof value === 'string');
  return [];
}

function isBadMasterName(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const compact = normalized.replace(/\s+/g, '');
  if (!normalized || compact.length < 2) return true;
  if (/^\d+\s*\uD638\s*\uACBD\uACC4\uBE44$/.test(value)) return false;
  if (/^#?\d+/.test(normalized)) return true;
  if (/[+]/.test(normalized)) return true;
  if (/[.!?。]$/.test(normalized)) return true;
  if (/(?:이동|출항|탑승장|이용가능|감상|전경|드러냅니다|곳입니다|관광$|추천|메뉴|무제한|전용|프리미엄|노노)$/.test(compact)) return true;
  if (/(?:조식|중식|석식|한상차림|세트메뉴|모듬구이|삼겹구이|백숙|짜조|쌀국수|씨푸드|스테이크|연어|초밥|빵|옥수수|과일|열대과일|음료|맥주|고량주)/.test(compact)) return true;
  if (/(?:공항|항출항|버스|전동카트|전동카|케이블카왕복|왕복이용)$/.test(compact)) return true;
  if (/(?:하노이|파타야|동경|석가장|임주|샤오관|아타미|도야|치토세|난칸|죠잔케이|이도백화|나리타공항|부산항출항)$/.test(compact)) return true;
  if (normalized.length > 24 && !/(?:대협곡|폭포|사원|성당|공원|박물관|호수|전망대|해변|비치|온천|신사|사찰|궁|광장|거리|야시장|케이블카)/.test(normalized)) return true;
  if (normalized.length > 34) return true;
  if (/[,\u3001/]/.test(value)) return true;
  if (/(맛집|날씨|주변|합성데크|차광막|WPC|돈까스|돈카츠|재래시장|옵션|마사지|선택관광)/i.test(value)) return true;
  if (/^\d+호\s*경계비$/.test(value)) return true;
  if (value === '강변공원') return true;
  if (value === '케이블카' || value === '전망대') return true;
  return false;
}

function chooseMasterName(row: CandidateRow): string {
  const raw = clean(row.raw_label);
  const canonical = clean(row.canonical_name);
  const normalized = clean(row.normalized_label);
  if (raw && canonical && raw.includes(canonical) && raw.length > canonical.length + 2) return raw;
  if (canonical && !isBadMasterName(canonical)) return canonical;
  if (raw && !isBadMasterName(raw)) return raw;
  if (normalized && !isBadMasterName(normalized)) return normalized;
  return '';
}

async function fetchCandidates(): Promise<CandidateRow[]> {
  const queryLimit = packageIdFilter.length > 0 ? Math.max(limit, 5000) : limit;
  let query = supabase
    .from('entity_master_candidates')
    .select('id, candidate_key, raw_label, normalized_label, canonical_name, destination_scope, country_scope, region_scope, source_context, suggested_master, external_sources, source_unmatched_ids, verification_score, package_count')
    .eq('category', 'attraction')
    .eq('auto_action', 'create_internal_master')
    .eq('auto_verification_status', 'verified_internal')
    .eq('promotion_status', 'auto_internal')
    .gte('verification_score', minScore)
    .contains('source_context', { mobile_landing_impact: true })
    .order('package_count', { ascending: false })
    .limit(queryLimit);
  if (destination) query = query.eq('destination_scope', destination);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as CandidateRow[];
  if (packageIdFilter.length === 0) return rows;
  const wanted = new Set(packageIdFilter);
  return rows
    .filter(row => packageIdsFrom(row).some(packageId => wanted.has(packageId)))
    .slice(0, limit);
}

async function findExisting(name: string, aliases: string[]) {
  const terms = unique([name, ...aliases]);
  for (const term of terms) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id, name, aliases, photos')
      .or(`name.eq.${term},aliases.cs.{${term}}`)
      .limit(1);
    if (error) continue;
    if (data && data.length > 0) return data[0] as { id: string; name: string; aliases?: string[] | null; photos?: unknown[] | null };
  }
  return null;
}

async function promote(row: CandidateRow) {
  const masterName = chooseMasterName(row);
  const aliases = unique([
    row.raw_label ?? '',
    row.normalized_label ?? '',
    row.canonical_name ?? '',
    ...(row.external_sources ?? []).flatMap(source => [source.name ?? '', source.id ?? '']),
  ]).filter(value => value !== masterName && !isBadMasterName(value));

  if (!masterName || isBadMasterName(masterName)) {
    return { status: 'skipped', reason: 'unsafe_master_name', candidate_key: row.candidate_key, masterName };
  }

  const existing = await findExisting(masterName, aliases);
  let attractionId = existing?.id ?? null;
  let created = false;

  if (!attractionId && apply) {
    const descriptions = buildSourceBackedAttractionDescriptions({
      name: masterName,
      aliases,
      examples: sourceExamplesFrom(row),
      region: row.region_scope ?? row.destination_scope,
    });
    const { data, error } = await supabase
      .from('attractions')
      .insert({
        name: masterName,
        short_desc: descriptions.shortDesc,
        long_desc: descriptions.longDesc,
        country: row.country_scope,
        region: row.region_scope ?? row.destination_scope,
        badge_type: 'tour',
        emoji: '📍',
        aliases,
        photos: [],
        source: 'entity-master-candidate-auto',
        is_manual_override: false,
        auto_created: true,
        verification_status: 'auto_internal',
        customer_publishable: false,
        review_required_reason: 'verified internal candidate; customer publishable requires stronger source or admin review',
        auto_created_at: new Date().toISOString(),
        source_ids: {
          entity_master_candidate_key: row.candidate_key,
          source_context: row.source_context ?? {},
        },
        verification_sources: row.external_sources ?? [],
      })
      .select('id')
      .single();
    if (error) throw error;
    attractionId = data.id;
    created = true;
  }

  if (!attractionId) {
    return { status: 'dry_run', candidate_key: row.candidate_key, masterName, aliases };
  }

  if (apply) {
    const { runAttractionPhotoMatch } = await import('../src/lib/attraction-photo-match');
    await runAttractionPhotoMatch(attractionId, {
      keywords: [masterName, ...aliases],
      country: row.country_scope,
      region: row.region_scope ?? row.destination_scope,
      destination: row.destination_scope,
      maxPhotos: 5,
      replaceExisting: 'if_low_quality',
    });
    await supabase
      .from('entity_master_candidates')
      .update({
        promotion_status: 'promoted',
        promoted_attraction_id: attractionId,
        promoted_at: new Date().toISOString(),
      })
      .eq('candidate_key', row.candidate_key);

    const sourceUnmatchedIds = (row.source_unmatched_ids ?? []).filter(Boolean);
    if (sourceUnmatchedIds.length > 0) {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('unmatched_activities')
        .update({
          status: 'added',
          resolved_at: now,
          resolved_kind: 'auto_internal_candidate_promoted',
          resolved_attraction_id: attractionId,
          resolved_by: 'promote_verified_attraction_candidates',
          updated_at: now,
        })
        .in('id', sourceUnmatchedIds)
        .eq('status', 'pending')
        .is('resolved_at', null);
      if (error) throw error;
    }
  }

  return { status: created ? 'created' : 'linked_existing', candidate_key: row.candidate_key, attractionId, masterName, aliases };
}

async function main() {
  const rows = await fetchCandidates();
  const results = [];
  const attractionIds: string[] = [];
  const packageIds = new Set<string>();
  for (const row of rows) {
    try {
      const result = await promote(row);
      results.push(result);
      if ('attractionId' in result && result.attractionId) attractionIds.push(result.attractionId);
      if ('attractionId' in result && result.attractionId) {
        for (const packageId of packageIdsFrom(row)) packageIds.add(packageId);
      }
    } catch (error) {
      results.push({
        status: 'error',
        candidate_key: row.candidate_key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const reEnrich = apply && attractionIds.length > 0
    ? await (async () => {
        const { reEnrichAffectedPackages } = await import('../src/lib/package-reenrich-on-attraction-change');
        return reEnrichAffectedPackages(attractionIds, {
          maxPackages: 200,
          forceRevalidate: true,
          packageIds: [...packageIds],
        });
      })()
    : null;

  const output = {
    apply,
    scanned: rows.length,
    promoted_or_existing: results.filter(row => row.status === 'created' || row.status === 'linked_existing').length,
    skipped: results.filter(row => row.status === 'skipped').length,
    errors: results.filter(row => row.status === 'error').length,
    reEnrich,
    results,
  };
  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
