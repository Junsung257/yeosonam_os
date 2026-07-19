#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';

import './load-script-env';
import { supabaseAdmin } from '@/lib/supabase';
import { buildProductAnswerIdentity } from '@/lib/product-answer-identity';

type PackageRow = {
  id: string;
  title: string | null;
  display_title: string | null;
  destination: string | null;
  country: string | null;
  internal_code: string | null;
  short_code: string | null;
  duration: number | null;
  nights: number | null;
  product_type: string | null;
  trip_style: string | null;
  airline: string | null;
  price: number | null;
  price_dates: unknown;
  product_highlights: unknown;
};

type ChunkRow = {
  source_id: string | null;
  metadata: Record<string, unknown> | null;
};

type Options = {
  json: boolean;
  limit: number;
  outputDir: string;
};

function parseOptions(args: string[]): Options {
  const rawLimit = Number(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? 2000);
  return {
    json: args.includes('--json'),
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 5000) : 2000,
    outputDir: args.find((arg) => arg.startsWith('--output-dir='))?.split('=')[1] ?? 'data/jarvis/product-answerability',
  };
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTitle(value: unknown): string {
  return asText(value)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function highlights(row: PackageRow): string[] {
  return Array.isArray(row.product_highlights)
    ? row.product_highlights.map(asText).filter(Boolean)
    : [];
}

function groupByNonEmpty(rows: PackageRow[], key: keyof Pick<PackageRow, 'internal_code' | 'short_code'>) {
  const groups = new Map<string, PackageRow[]>();
  for (const row of rows) {
    const value = asText(row[key]).toUpperCase();
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 1);
}

function groupByTitle(rows: PackageRow[]) {
  const groups = new Map<string, PackageRow[]>();
  for (const row of rows) {
    const value = normalizeTitle(row.display_title) || normalizeTitle(row.title);
    if (!value || value.length < 8) continue;
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 1);
}

function groupByAnswerIdentity(rows: PackageRow[]) {
  const groups = new Map<string, PackageRow[]>();
  for (const row of rows) {
    const value = buildProductAnswerIdentity(row).key;
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 1);
}

function isWeakHighlightSet(items: string[]): boolean {
  if (items.length === 0) return true;
  const unique = new Set(items.map((item) => normalizeTitle(item)));
  if (unique.size !== items.length) return true;
  if (items.some((item) => item.length < 3 || item.length > 120)) return true;
  const generic = items.filter((item) =>
    /가격\s*등록|포함사항\s*\d+|일정$|중심\s*일정$|상품\s*구성$/i.test(item),
  );
  return generic.length === items.length;
}

async function loadPackages(limit: number): Promise<PackageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,title,display_title,destination,country,internal_code,short_code,duration,nights,product_type,trip_style,airline,price,price_dates,product_highlights')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PackageRow[];
}

async function loadPackageChunks(packageIds: string[]): Promise<ChunkRow[]> {
  const rows: ChunkRow[] = [];
  for (let offset = 0; offset < packageIds.length; offset += 200) {
    const batch = packageIds.slice(offset, offset + 200);
    const { data, error } = await supabaseAdmin
      .from('jarvis_knowledge_chunks')
      .select('source_id,metadata')
      .eq('source_type', 'package')
      .in('source_id', batch);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as ChunkRow[]));
  }
  return rows;
}

function sampleRows(rows: PackageRow[], limit = 10) {
  return rows.slice(0, limit).map((row) => {
    const identity = buildProductAnswerIdentity(row);
    return {
      id: row.id,
      title: row.display_title || row.title,
      answer_identity_label: identity.label,
      answer_identity_key: identity.key,
      internal_code: row.internal_code,
      short_code: row.short_code,
    };
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  ensureDir(options.outputDir);

  const rows = await loadPackages(options.limit);
  const packageIds = rows.map((row) => row.id);
  const chunks = await loadPackageChunks(packageIds);
  const chunksBySourceId = new Map<string, ChunkRow[]>();
  for (const chunk of chunks) {
    if (!chunk.source_id) continue;
    chunksBySourceId.set(chunk.source_id, [...(chunksBySourceId.get(chunk.source_id) ?? []), chunk]);
  }

  const duplicateShortCodes = groupByNonEmpty(rows, 'short_code');
  const duplicateInternalCodes = groupByNonEmpty(rows, 'internal_code');
  const duplicateTitles = groupByTitle(rows);
  const duplicateAnswerIdentities = groupByAnswerIdentity(rows);
  const weakHighlightRows = rows.filter((row) => isWeakHighlightSet(highlights(row)));
  const missingRagRows = rows.filter((row) => !chunksBySourceId.has(row.id));
  const mismatchedMetadata = rows.filter((row) => {
    const identity = buildProductAnswerIdentity(row);
    const rowChunks = chunksBySourceId.get(row.id) ?? [];
    if (rowChunks.length === 0) return false;
    return rowChunks.some((chunk) => {
      const metadata = chunk.metadata ?? {};
      const shortCode = asText(metadata.short_code);
      const internalCode = asText(metadata.internal_code);
      const answerIdentityKey = asText(metadata.answer_identity_key);
      const answerIdentityLabel = asText(metadata.answer_identity_label);
      return (
        (row.short_code && shortCode !== row.short_code)
        || (row.internal_code && internalCode !== row.internal_code)
        || answerIdentityKey !== identity.key
        || answerIdentityLabel !== identity.label
      );
    });
  });

  const blockingIssueCount = duplicateShortCodes.length + duplicateAnswerIdentities.length + missingRagRows.length + mismatchedMetadata.length;
  const warningIssueCount = duplicateInternalCodes.length + weakHighlightRows.length;
  const report = {
    generated_at: new Date().toISOString(),
    active_total: rows.length,
    coverage: {
      with_country: rows.filter((row) => asText(row.country)).length,
      with_short_code: rows.filter((row) => asText(row.short_code)).length,
      with_product_highlights: rows.filter((row) => highlights(row).length > 0).length,
      with_package_rag_chunks: rows.filter((row) => chunksBySourceId.has(row.id)).length,
      package_chunk_rows: chunks.length,
    },
    issue_counts: {
      duplicate_short_code_groups: duplicateShortCodes.length,
      duplicate_internal_code_groups: duplicateInternalCodes.length,
      duplicate_exact_title_groups: duplicateTitles.length,
      duplicate_answer_identity_groups: duplicateAnswerIdentities.length,
      weak_highlight_rows: weakHighlightRows.length,
      missing_rag_rows: missingRagRows.length,
      mismatched_rag_metadata_rows: mismatchedMetadata.length,
    },
    status: blockingIssueCount === 0 ? (warningIssueCount === 0 ? 'pass' : 'warn') : 'fail',
    samples: {
      duplicate_short_code_groups: duplicateShortCodes.slice(0, 10).map(([value, group]) => ({ value, rows: sampleRows(group) })),
      duplicate_internal_code_groups: duplicateInternalCodes.slice(0, 10).map(([value, group]) => ({ value, rows: sampleRows(group) })),
      duplicate_exact_title_groups: duplicateTitles.slice(0, 10).map(([value, group]) => ({ value, rows: sampleRows(group) })),
      duplicate_answer_identity_groups: duplicateAnswerIdentities.slice(0, 10).map(([value, group]) => ({ value, rows: sampleRows(group) })),
      weak_highlight_rows: sampleRows(weakHighlightRows),
      missing_rag_rows: sampleRows(missingRagRows),
      mismatched_rag_metadata_rows: sampleRows(mismatchedMetadata),
    },
  };

  const reportPath = path.join(options.outputDir, `active-product-answerability-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const summary = { ...report, reportPath };
  console.log(options.json ? JSON.stringify(summary, null, 2) : JSON.stringify({
    reportPath,
    active_total: report.active_total,
    coverage: report.coverage,
    issue_counts: report.issue_counts,
    status: report.status,
  }, null, 2));

  if (report.status === 'fail') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
