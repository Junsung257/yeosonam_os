#!/usr/bin/env tsx

import './load-script-env';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { AttractionData } from '@/lib/attraction-matcher';
import { supabaseAdmin } from '@/lib/supabase';

const PAGE_SIZE = 1000;
const MAX_ROWS = 20_000;
const SELECT_COLUMNS = [
  'id',
  'name',
  'short_desc',
  'long_desc',
  'badge_type',
  'emoji',
  'country',
  'region',
  'category',
  'aliases',
  'photos',
  'mrt_gid',
  'is_active',
  'customer_publishable',
].join(',');

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function loadActiveAttractions(): Promise<AttractionData[]> {
  const rows: AttractionData[] = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .select(SELECT_COLUMNS)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`active attractions export failed at row ${from}: ${error.message}`);
    }

    // SELECT_COLUMNS is built dynamically, so Supabase cannot infer the row
    // shape even though the query is read-only and the selected columns match
    // AttractionData. Keep the assertion explicit at this boundary.
    const page = (data ?? []) as unknown as AttractionData[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }

  throw new Error(`active attractions export exceeded the safety limit (${MAX_ROWS} rows)`);
}

async function main(): Promise<void> {
  const output = argValue('output');
  if (!output) {
    throw new Error(
      'Usage: npx tsx scripts/export-active-attractions-cache.ts --output=scratch/attractions/active-attractions-latest.json',
    );
  }

  const outputPath = resolve(output);
  const attractions = await loadActiveAttractions();
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'supabase-active-attractions-read-only-export',
    count: attractions.length,
    attractionsHash: stableHash(attractions),
    attractions,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[active-attractions-cache] rows=${attractions.length}`);
  console.log(`[active-attractions-cache] hash=${payload.attractionsHash}`);
  console.log(`[active-attractions-cache] output=${outputPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
