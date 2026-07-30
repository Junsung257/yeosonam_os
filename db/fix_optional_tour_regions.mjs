import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!match) continue;
    process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes('--apply');
const ALLOW_REVIEWED_SOURCE_REPAIR = process.argv.includes('--allow-reviewed-source-repair');

if (!supabaseUrl || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceKey);

const AMBIGUOUS_TOUR_KEYWORDS = ['2층버스', '리버보트', '야시장투어', '크루즈', '마사지', '스카이파크', '스카이 파크'];
const REGION_KEYWORDS = [
  ['홍콩', '홍콩'],
  ['마카오', '마카오'],
  ['몽골', '몽골'],
  ['울란바토르', '몽골'],
  ['테를지', '몽골'],
  ['라오스', '라오스'],
  ['비엔티안', '라오스'],
  ['비엔티엔', '라오스'],
  ['루앙프라방', '라오스'],
  ['방비엥', '라오스'],
  ['하롱', '베트남'],
  ['하노이', '베트남'],
  ['베트남', '베트남'],
  ['청도', '중국'],
  ['칭다오', '중국'],
  ['계림', '중국'],
  ['양삭', '중국'],
  ['구채구', '중국'],
  ['황룡', '중국'],
  ['화산', '중국'],
  ['서안', '중국'],
  ['백두산', '중국'],
  ['연길', '중국'],
  ['중국', '중국'],
  ['China', '중국'],
  ['Tianjin', '중국'],
  ['말레이시아', '말레이시아'],
  ['쿠알라', '말레이시아'],
  ['말라카', '말레이시아'],
  ['싱가포르', '싱가포르'],
  ['태국', '태국'],
  ['방콕', '태국'],
  ['파타야', '태국'],
  ['푸켓', '태국'],
  ['필리핀', '필리핀'],
  ['보홀', '필리핀'],
  ['세부', '필리핀'],
  ['베트남', '베트남'],
  ['다낭', '베트남'],
  ['나트랑', '베트남'],
  ['인도네시아', '인도네시아'],
  ['발리', '인도네시아'],
  ['일본', '일본'],
  ['오사카', '일본'],
  ['후쿠오카', '일본'],
  ['대만', '대만'],
  ['타이베이', '대만'],
];

function hasExplicitRegion(text) {
  return REGION_KEYWORDS.some(([keyword]) => text.includes(keyword));
}

function inferRegionFromRawText(pkg, tour) {
  const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  const name = String(tour.name || '');
  const index = rawText && name ? rawText.indexOf(name) : -1;
  if (index < 0) return { region: null, evidence: { raw_text_present: Boolean(rawText), name_found: false, context_excerpt: null, context_regions: [] } };
  const context = rawText.slice(Math.max(0, index - 180), Math.min(rawText.length, index + name.length + 180)).replace(/\s+/g, ' ').trim();
  const contextRegions = [...new Set(REGION_KEYWORDS.filter(([keyword]) => context.includes(keyword)).map(([, region]) => region))];
  return {
    region: contextRegions.length === 1 ? contextRegions[0] : null,
    evidence: {
      raw_text_present: true,
      raw_text_hash_present: Boolean(pkg.raw_text_hash),
      name_found: true,
      context_excerpt: context,
      context_regions: contextRegions,
    },
  };
}

function needsRegion(tour) {
  if (!tour || typeof tour !== 'object' || !tour.name || tour.region) return false;
  const name = String(tour.name);
  return AMBIGUOUS_TOUR_KEYWORDS.some((keyword) => name.includes(keyword));
}

async function fetchPackages() {
  const out = [];
  let offset = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb
      .from('travel_packages')
      .select('id,title,destination,status,publication_state,raw_text,raw_text_hash,itinerary_data,optional_tours')
      .not('optional_tours', 'is', null)
      .range(offset, offset + page - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < page) break;
    offset += page;
  }
  return out;
}

const rows = await fetchPackages();
const updates = [];
const unresolved = [];
let sourceBackedCandidates = 0;
let rawTextPresent = 0;
let rawNameMatches = 0;

for (const pkg of rows) {
  if (!Array.isArray(pkg.optional_tours)) continue;
  let changed = false;
  const optionalTours = pkg.optional_tours.map((tour) => {
    if (!needsRegion(tour)) return tour;
    const inferred = inferRegionFromRawText(pkg, tour);
    if (inferred.evidence.raw_text_present) rawTextPresent++;
    if (inferred.evidence.name_found) rawNameMatches++;
    if (!inferred.region) {
      unresolved.push({ id: pkg.id, title: pkg.title, destination: pkg.destination, name: tour.name, evidence: inferred.evidence });
      return tour;
    }
    sourceBackedCandidates++;
    changed = true;
    return { ...tour, region: inferred.region };
  });
  if (changed) {
    updates.push({ id: pkg.id, title: pkg.title, optional_tours: optionalTours });
  }
}

if (!APPLY) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    packagesToUpdate: updates.length,
    sourceBackedCandidates,
    rawTextPresent,
    rawNameMatches,
    unresolved: unresolved.length,
    sampleUpdates: updates.slice(0, 10).map((u) => ({ id: u.id, title: u.title })),
    unresolvedSamples: unresolved.slice(0, 20),
  }, null, 2));
  if (unresolved.length > 0) process.exitCode = 2;
  process.exitCode ||= 0;
}
else if (!ALLOW_REVIEWED_SOURCE_REPAIR) {
  console.error('Refusing to apply: add --allow-reviewed-source-repair after reviewing the source evidence dry-run.');
  process.exit(2);
}
else if (unresolved.length > 0) {
  console.error(JSON.stringify({ error: 'Unresolved optional tour regions remain', unresolved }, null, 2));
  process.exit(2);
}
else {
  let applied = 0;
  for (const update of updates) {
    const { error } = await sb
      .from('travel_packages')
      .update({ optional_tours: update.optional_tours })
      .eq('id', update.id);
    if (error) throw error;
    applied += 1;
  }

  console.log(JSON.stringify({ mode: 'apply', applied }, null, 2));
}
