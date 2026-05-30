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
];

function hasExplicitRegion(text) {
  return REGION_KEYWORDS.some(([keyword]) => text.includes(keyword));
}

function inferRegion(pkg, tour) {
  const haystack = [tour.name, pkg.destination, pkg.title].filter(Boolean).join(' ');
  for (const [keyword, region] of REGION_KEYWORDS) {
    if (haystack.includes(keyword)) return region;
  }
  return null;
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
      .select('id,title,destination,optional_tours')
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

for (const pkg of rows) {
  if (!Array.isArray(pkg.optional_tours)) continue;
  let changed = false;
  const optionalTours = pkg.optional_tours.map((tour) => {
    if (!needsRegion(tour)) return tour;
    const region = inferRegion(pkg, tour);
    if (!region) {
      unresolved.push({ id: pkg.id, title: pkg.title, destination: pkg.destination, name: tour.name });
      return tour;
    }
    changed = true;
    return { ...tour, region };
  });
  if (changed) {
    updates.push({ id: pkg.id, title: pkg.title, optional_tours: optionalTours });
  }
}

if (!APPLY) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    packagesToUpdate: updates.length,
    unresolved: unresolved.length,
    sampleUpdates: updates.slice(0, 10).map((u) => ({ id: u.id, title: u.title })),
    unresolvedSamples: unresolved.slice(0, 20),
  }, null, 2));
  if (unresolved.length > 0) process.exitCode = 2;
  process.exitCode ||= 0;
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
