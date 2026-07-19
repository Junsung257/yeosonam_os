#!/usr/bin/env tsx

import './load-script-env';
import { supabaseAdmin } from '@/lib/supabase';

type Options = {
  apply: boolean;
  json: boolean;
  activeStatuses: string[];
  limit: number;
};

type ChunkRow = {
  id: string;
  source_id: string | null;
  source_title: string | null;
};

function readStringArg(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function readNumberArg(args: string[], name: string, fallback: number): number {
  const raw = readStringArg(args, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseOptions(args: string[]): Options {
  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    activeStatuses: (readStringArg(args, '--active-status') ?? 'active,approved,published')
      .split(',')
      .map((status) => status.trim())
      .filter(Boolean),
    limit: Math.min(readNumberArg(args, '--limit', 5000), 10000),
  };
}

async function loadActivePackageIds(statuses: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id')
      .in('status', statuses)
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) ids.add(String((row as { id: string }).id));
    if (!data || data.length < 1000) break;
  }
  return ids;
}

async function loadPackageChunks(limit: number): Promise<ChunkRow[]> {
  const rows: ChunkRow[] = [];
  for (let offset = 0; rows.length < limit; offset += 1000) {
    const { data, error } = await supabaseAdmin
      .from('jarvis_knowledge_chunks')
      .select('id,source_id,source_title')
      .eq('source_type', 'package')
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as ChunkRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows.slice(0, limit);
}

async function deleteChunks(ids: string[]): Promise<number> {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const { error } = await supabaseAdmin
      .from('jarvis_knowledge_chunks')
      .delete()
      .in('id', batch);
    if (error) throw new Error(error.message);
    deleted += batch.length;
  }
  return deleted;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const [activePackageIds, chunks] = await Promise.all([
    loadActivePackageIds(options.activeStatuses),
    loadPackageChunks(options.limit),
  ]);

  const stale = chunks.filter((chunk) => !chunk.source_id || !activePackageIds.has(chunk.source_id));
  const deleted = options.apply ? await deleteChunks(stale.map((chunk) => chunk.id)) : 0;
  const payload = {
    ok: true,
    mode: options.apply ? 'apply' : 'dry-run',
    activeStatuses: options.activeStatuses,
    activePackageCount: activePackageIds.size,
    scannedPackageChunks: chunks.length,
    stalePackageChunks: stale.length,
    deleted,
    sample: stale.slice(0, 20),
    nextCommand: 'npm run prune:jarvis-package-rag -- --apply',
  };

  console.log(options.json ? JSON.stringify(payload, null, 2) : JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
