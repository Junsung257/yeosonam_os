#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';

type BlogMetadataRow = {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
};

function numericArg(name: string, fallback: number, max: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), max) : fallback;
}

async function loadRows(limit: number): Promise<BlogMetadataRow[]> {
  const rows: BlogMetadataRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; rows.length < limit; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .select('id,slug,title,description,seo_title,seo_description')
      .eq('channel', 'naver_blog')
      .order('created_at', { ascending: false })
      .range(offset, Math.min(offset + pageSize - 1, limit - 1));
    if (error) throw new Error(error.message);
    const page = (data ?? []) as BlogMetadataRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.slice(0, limit);
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const limit = numericArg('--limit', 5000, 10000);
  const rows = await loadRows(limit);
  const planned: Array<{ id: string; slug: string | null; patch: Record<string, string> }> = [];

  for (const row of rows) {
    const canonicalTitle = (row.seo_title || row.slug || '').trim();
    const canonicalDescription = (row.seo_description || row.seo_title || row.slug || '').trim();
    const patch: Record<string, string> = {};
    if (!row.title?.trim() && canonicalTitle) patch.title = canonicalTitle;
    if (!row.description?.trim() && canonicalDescription) patch.description = canonicalDescription;
    if (Object.keys(patch).length > 0) planned.push({ id: row.id, slug: row.slug, patch });
  }

  const updated: Array<{ id: string; slug: string | null; patch: Record<string, string> }> = [];
  const errors: Array<{ id: string; slug: string | null; error: string }> = [];
  if (write) {
    for (const item of planned) {
      const { error } = await supabaseAdmin
        .from('content_creatives')
        .update(item.patch)
        .eq('id', item.id);
      if (error) errors.push({ id: item.id, slug: item.slug, error: error.message });
      else updated.push(item);
    }
  }

  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run',
    scanned: rows.length,
    planned: planned.length,
    updated: updated.length,
    failed: errors.length,
    errors: errors.slice(0, 20),
  }, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
