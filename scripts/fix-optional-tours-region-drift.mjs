#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');
const ALLOW_REVIEWED_SOURCE_REPAIR = process.argv.includes('--allow-reviewed-source-repair');
const ALLOW_PARTIAL_REVIEWED_SOURCE_REPAIR = process.argv.includes('--allow-partial-reviewed-source-repair');

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

function normalizedSource(value) {
  const normalized = [];
  const originalIndexes = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value.slice(index, index + 6).toLowerCase() === '&nbsp;') {
      normalized.push(' ');
      originalIndexes.push(index);
      index += 5;
      continue;
    }
    const entity = value.slice(index).match(/^&#(?:x[0-9a-f]+|\d+);/i)?.[0];
    if (entity) {
      normalized.push(' ');
      originalIndexes.push(index);
      index += entity.length - 1;
      continue;
    }
    for (const character of value[index].normalize('NFKC').toLowerCase()) {
      if (/^[\p{Letter}\p{Number}]$/u.test(character)) {
        normalized.push(character);
        originalIndexes.push(index);
      }
    }
  }
  return { value: normalized.join(''), originalIndexes };
}

function sourceHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function findSourceMatch(rawText, name) {
  const exactIndex = rawText.indexOf(name);
  if (exactIndex >= 0) return { index: exactIndex, end: exactIndex + name.length, normalized: false };
  const normalizedName = normalizedSource(name).value;
  if (!normalizedName) return { index: -1, end: -1, normalized: false };
  const normalizedRaw = normalizedSource(rawText);
  const matchIndex = normalizedRaw.value.indexOf(normalizedName);
  if (matchIndex < 0) return { index: -1, end: -1, normalized: false };
  const originalStart = normalizedRaw.originalIndexes[matchIndex];
  const originalEnd = normalizedRaw.originalIndexes[matchIndex + normalizedName.length - 1];
  return { index: originalStart, end: originalEnd + 1, normalized: true };
}

function inferRegionFromSource(pkg, tour) {
  const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  const suppliedHash = typeof pkg.raw_text_hash === 'string' ? pkg.raw_text_hash.trim() : '';
  const hashValid = Boolean(rawText && suppliedHash && sourceHash(rawText) === suppliedHash);
  const name = typeof tour?.name === 'string' ? tour.name : '';
  const match = rawText && name ? findSourceMatch(rawText, name) : { index: -1, end: -1, normalized: false };
  if (match.index < 0) {
    return {
      region: null,
      evidence: { raw_text_present: Boolean(rawText), raw_text_hash_present: Boolean(pkg.raw_text_hash), hash_valid: hashValid, name_found: false, context_regions: [] },
    };
  }
  const context = rawText.slice(Math.max(0, match.index - 180), Math.min(rawText.length, match.end + 180)).replace(/\s+/g, ' ').trim();
  const regions = [...new Set(regionRules.filter(rule => rule.keywords.some(keyword => context.includes(keyword))).map(rule => rule.region))];
  return {
    region: regions.length === 1 ? regions[0] : null,
    evidence: {
      raw_text_present: true,
      raw_text_hash_present: Boolean(pkg.raw_text_hash),
      hash_valid: hashValid,
      name_found: true,
      normalized_name_match: match.normalized,
      context_excerpt: context,
      context_regions: regions,
    },
  };
}

function isAmbiguousTourName(name) {
  return ambiguousTourKeywords.some(keyword => name.includes(keyword));
}

function isPublicPackage(pkg) {
  const status = String(pkg.status ?? '').toLowerCase();
  const publicationState = String(pkg.publication_state ?? '').toLowerCase();
  return ['active', 'approved', 'available', 'published'].includes(status) || publicationState === 'published';
}

async function fetchPackages() {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('travel_packages')
      .select('id, title, destination, status, publication_state, raw_text, raw_text_hash, optional_tours')
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
const unresolved = [];
let hashMismatches = 0;
let sourceBackedCandidates = 0;
let rawTextPresent = 0;
let rawNameMatches = 0;

for (const pkg of packages) {
  if (!Array.isArray(pkg.optional_tours) || pkg.optional_tours.length === 0) continue;
  let changed = false;
  const nextTours = pkg.optional_tours.map(tour => {
    if (!tour || typeof tour !== 'object') return tour;
    const name = typeof tour.name === 'string' ? tour.name : '';
    const hasRegion = typeof tour.region === 'string' && tour.region.trim().length > 0;
    if (!name || hasRegion || !isAmbiguousTourName(name)) return tour;
    if (isPublicPackage(pkg)) {
      unresolved.push({ id: pkg.id, title: pkg.title, destination: pkg.destination, name, evidence: { blocked_reason: 'public_package', status: pkg.status, publication_state: pkg.publication_state } });
      return tour;
    }
    const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
    const suppliedHash = typeof pkg.raw_text_hash === 'string' ? pkg.raw_text_hash.trim() : '';
    if (!rawText || !suppliedHash || sourceHash(rawText) !== suppliedHash) {
      hashMismatches++;
      unresolved.push({ id: pkg.id, title: pkg.title, destination: pkg.destination, name, evidence: { raw_text_present: Boolean(rawText), raw_text_hash_present: Boolean(suppliedHash), hash_valid: false, name_found: false, context_regions: [] } });
      return tour;
    }
    const inferred = inferRegionFromSource(pkg, tour);
    if (inferred.evidence.raw_text_present) rawTextPresent++;
    if (inferred.evidence.name_found) rawNameMatches++;
    if (!inferred.region) {
      unresolved.push({ id: pkg.id, title: pkg.title, destination: pkg.destination, name, evidence: inferred.evidence });
      return tour;
    }
    sourceBackedCandidates++;
    changed = true;
    return { ...tour, region: inferred.region };
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
  console.log(JSON.stringify({ apply: APPLY, scanned: packages.length, sourceBackedCandidates, rawTextPresent, rawNameMatches, hashMismatches, unresolved: unresolved.length, changes, unresolvedSamples: unresolved.slice(0, 20) }, null, 2));
} else {
  console.log(`Scanned packages: ${packages.length}`);
  console.log(`Packages to update: ${changes.length}`);
  console.log(`Source-backed tour candidates: ${sourceBackedCandidates}`);
  console.log(`Unresolved tour entries: ${unresolved.length}`);
  for (const change of changes.slice(0, 10)) {
    console.log(`- ${change.title} -> ${change.optional_tours.filter(t => t?.region).map(t => `${t.name}:${t.region}`).join(', ')}`);
  }
}

if (!APPLY) {
  if (!JSON_OUT) console.log('Dry-run only. Re-run with --apply to update Supabase.');
} else if (!ALLOW_REVIEWED_SOURCE_REPAIR) {
  console.error('Refusing to apply: add --allow-reviewed-source-repair after reviewing source evidence.');
  process.exitCode = 2;
} else if (unresolved.length > 0 && !ALLOW_PARTIAL_REVIEWED_SOURCE_REPAIR) {
  console.error(`Refusing to apply while ${unresolved.length} unresolved source-evidence entries remain.`);
  process.exitCode = 2;
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

  console.log(`Updated packages: ${updated}/${changes.length}; unresolved retained: ${unresolved.length}`);
}

await supabase.removeAllChannels();
