#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import './load-script-env';

import { supabaseAdmin } from '@/lib/supabase';
import {
  getCustomerAttractionRenderBlockers,
  type AttractionData,
  type CustomerAttractionRenderBlocker,
} from '@/lib/attraction-matcher';

type AttractionRow = AttractionData & {
  id: string;
  verification_status?: string | null;
  mention_count?: number | null;
};

type Options = {
  apply: boolean;
  json: boolean;
  limit: number;
  outputDir: string;
};

type Finding = {
  id: string;
  name: string;
  region: string | null;
  country: string | null;
  category: string | null;
  badge_type: string | null;
  verification_status: string | null;
  mention_count: number | null;
  blockers: CustomerAttractionRenderBlocker[];
  applied: boolean;
  error?: string;
};

const DEFAULT_LIMIT = 10_000;
const PAGE_SIZE = 1000;

function parseOptions(args: string[]): Options {
  const limitArg = args.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const outputDirArg = args.find((arg) => arg.startsWith('--output-dir='))?.split('=')[1];
  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    limit: limitArg ? Math.max(1, Number(limitArg) || DEFAULT_LIMIT) : DEFAULT_LIMIT,
    outputDir: outputDirArg?.trim() || path.join('data', 'attractions', 'publishable-pollution-audit'),
  };
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

async function fetchPublishableAttractions(limit: number): Promise<AttractionRow[]> {
  const rows: AttractionRow[] = [];
  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, limit - 1);
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .select('id,name,region,country,category,badge_type,is_active,customer_publishable,verification_status,mention_count')
      .eq('is_active', true)
      .eq('customer_publishable', true)
      .order('mention_count', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as AttractionRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function demoteFinding(finding: Finding): Promise<Finding> {
  const reason = `customer_attraction_publishable_pollution:${finding.blockers.join(',')}`;
  const { error } = await supabaseAdmin
    .from('attractions')
    .update({
      customer_publishable: false,
      verification_status: 'candidate',
      review_required_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', finding.id)
    .eq('customer_publishable', true);

  if (error) return { ...finding, applied: false, error: error.message };
  return { ...finding, applied: true };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const rows = await fetchPublishableAttractions(options.limit);
  const findings: Finding[] = [];
  const byBlocker: Record<string, number> = {};

  for (const row of rows) {
    const blockers = getCustomerAttractionRenderBlockers(row)
      .filter((blocker) => blocker !== 'not_customer_publishable' && blocker !== 'inactive');
    if (blockers.length === 0) continue;
    for (const blocker of blockers) increment(byBlocker, blocker);
    findings.push({
      id: row.id,
      name: row.name,
      region: row.region ?? null,
      country: row.country ?? null,
      category: row.category ?? null,
      badge_type: row.badge_type ?? null,
      verification_status: row.verification_status ?? null,
      mention_count: row.mention_count ?? null,
      blockers,
      applied: false,
    });
  }

  const applied: Finding[] = [];
  if (options.apply) {
    for (const finding of findings) {
      applied.push(await demoteFinding(finding));
    }
  }

  const appliedCount = applied.filter((finding) => finding.applied).length;
  const errorCount = applied.filter((finding) => finding.error).length;
  const report = {
    generated_at: new Date().toISOString(),
    dry_run: !options.apply,
    scanned_active_customer_publishable: rows.length,
    polluted_publishable: findings.length,
    clean_publishable: rows.length - findings.length,
    applied_demotions: appliedCount,
    errors: errorCount,
    by_blocker: byBlocker,
    samples: findings.slice(0, 50),
    applied: applied.slice(0, 50),
  };

  fs.mkdirSync(options.outputDir, { recursive: true });
  const reportPath = path.join(
    options.outputDir,
    `publishable-attraction-pollution-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  if (options.json) {
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
    return;
  }

  console.log(`Scanned active/customer-publishable attractions: ${rows.length}`);
  console.log(`Polluted publishable attractions: ${findings.length}`);
  console.log(`Applied demotions: ${appliedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
