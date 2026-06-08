#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length > 0) {
      process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('Supabase env is missing.');
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey);

const regionRules = [
  { region: '\uC911\uAD6D', keywords: ['\uC911\uAD6D', '\uC11C\uC548', '\uD654\uC0B0', '\uBCD1\uB9C8\uC6A9', '\uC5F0\uAE38', '\uBC31\uB450\uC0B0', '\uC7A5\uAC00\uACC4', '\uCCAD\uB3C4'] },
  { region: '\uD544\uB9AC\uD540', keywords: ['\uD544\uB9AC\uD540', '\uC138\uBD80', '\uD074\uB77D', '\uBCF4\uD640', '\uB9C8\uB2D0\uB77C'] },
  { region: '\uBCA0\uD2B8\uB0A8', keywords: ['\uBCA0\uD2B8\uB0A8', '\uD478\uAFB8\uC625', '\uB2E4\uB0AD', '\uB098\uD2B8\uB791', '\uD558\uB178\uC774', '\uB2EC\uB78F'] },
  { region: '\uC77C\uBCF8', keywords: ['\uC77C\uBCF8', '\uD6C4\uCFE0\uC624\uCE74', '\uC624\uC0AC\uCE74', '\uB098\uB9AC\uD0C0', '\uCE58\uBC14', '\uD1A0\uCFC4'] },
  { region: '\uB9D0\uB808\uC774\uC2DC\uC544', keywords: ['\uB9D0\uB808\uC774\uC2DC\uC544', '\uCFE0\uC54C\uB77C', '\uB9D0\uB77C\uCE74', '\uAC90\uD305'] },
  { region: '\uC2F1\uAC00\uD3EC\uB974', keywords: ['\uC2F1\uAC00\uD3EC\uB974'] },
  { region: '\uD0DC\uAD6D', keywords: ['\uD0DC\uAD6D', '\uBC29\uCF55', '\uD30C\uD0C0\uC57C', '\uD478\uCF13'] },
  { region: '\uB77C\uC624\uC2A4', keywords: ['\uB77C\uC624\uC2A4'] },
  { region: '\uBABD\uACE8', keywords: ['\uBABD\uACE8'] },
  { region: '\uC778\uB3C4\uB124\uC2DC\uC544', keywords: ['\uC778\uB3C4\uB124\uC2DC\uC544', '\uBC1C\uB9AC'] },
];

const ambiguousTourKeywords = [
  '\uB9C8\uC0AC\uC9C0',
  '\uBC1C\uB9C8\uC0AC\uC9C0',
  '\uC804\uC2E0\uB9C8\uC0AC\uC9C0',
  '\uC2A4\uD1A4\uB9C8\uC0AC\uC9C0',
  '2\uCE35\uBC84\uC2A4',
  '\uB9AC\uBC84\uBCF4\uD2B8',
  '\uC2DC\uD2F0\uD22C\uC5B4',
  '\uD06C\uB8E8\uC988',
  '\uC2A4\uCE74\uC774\uD30C\uD06C',
  '\uC2A4\uCE74\uC774\uD2B8\uB809',
];

function inferRegionFromPackage(pkg) {
  const text = [pkg.destination, pkg.title].filter(Boolean).join(' ');
  for (const rule of regionRules) {
    if (rule.keywords.some(keyword => text.includes(keyword))) return rule.region;
  }
  return null;
}

function isAmbiguousTourName(name) {
  return ambiguousTourKeywords.some(keyword => name.includes(keyword));
}

async function fetchPackages() {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('travel_packages')
      .select('id, title, destination, optional_tours')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

const packages = await fetchPackages();
const changes = [];

for (const pkg of packages) {
  if (!Array.isArray(pkg.optional_tours) || pkg.optional_tours.length === 0) continue;
  const inferredRegion = inferRegionFromPackage(pkg);
  if (!inferredRegion) continue;

  let changed = false;
  const nextTours = pkg.optional_tours.map(tour => {
    if (!tour || typeof tour !== 'object') return tour;
    const name = typeof tour.name === 'string' ? tour.name : '';
    const hasRegion = typeof tour.region === 'string' && tour.region.trim().length > 0;
    if (!name || hasRegion || !isAmbiguousTourName(name)) return tour;
    changed = true;
    return { ...tour, region: inferredRegion };
  });

  if (changed) {
    changes.push({
      id: pkg.id,
      title: pkg.title,
      destination: pkg.destination,
      optional_tours: nextTours,
    });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ apply: APPLY, scanned: packages.length, changes }, null, 2));
} else {
  console.log(`Scanned packages: ${packages.length}`);
  console.log(`Packages to update: ${changes.length}`);
  for (const change of changes.slice(0, 10)) {
    console.log(`- ${change.title} -> ${change.optional_tours.filter(t => t?.region).map(t => `${t.name}:${t.region}`).join(', ')}`);
  }
}

if (!APPLY) {
  if (!JSON_OUT) console.log('Dry-run only. Re-run with --apply to update Supabase.');
} else {
  let updated = 0;
  for (const change of changes) {
    const { error } = await supabase
      .from('travel_packages')
      .update({ optional_tours: change.optional_tours })
      .eq('id', change.id);
    if (error) {
      console.error(`Failed ${change.id}: ${error.message}`);
      process.exitCode = 1;
    } else {
      updated++;
    }
  }

  console.log(`Updated packages: ${updated}/${changes.length}`);
}

await supabase.removeAllChannels();
