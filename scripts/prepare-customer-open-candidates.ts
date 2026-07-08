#!/usr/bin/env tsx

import './load-script-env';

import process from 'node:process';

import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { runUploadToOpenAutopilot } from '@/lib/product-registration/upload-to-open-autopilot';
import {
  selectCustomerOpenBatchCandidates,
  type CustomerOpenBatchCandidateRow,
} from '@/lib/product-registration/customer-open-batch-candidates';

type Options = {
  apply: boolean;
  json: boolean;
  limit: number;
  scanLimit: number;
  statusList: string[];
  includeReady: boolean;
  retryErrors: boolean;
  strict: boolean;
  baseUrl: string;
};

function argValue(name: string, fallback: string): string {
  const prefix = `${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function numberArg(name: string, fallback: number, max: number): number {
  const parsed = Number(argValue(name, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : fallback;
}

function options(): Options {
  const limit = numberArg('--limit', 10, 50);
  return {
    apply: hasFlag('--apply'),
    json: hasFlag('--json'),
    limit,
    scanLimit: numberArg('--scan-limit', Math.max(200, limit * 20), 5000),
    statusList: argValue('--status', 'pending_review')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    includeReady: hasFlag('--include-ready'),
    retryErrors: hasFlag('--retry-errors'),
    strict: hasFlag('--strict'),
    baseUrl: (argValue('--base', process.env.PRODUCTION_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')).replace(/\/+$/, ''),
  };
}

async function fetchRows(opts: Options): Promise<CustomerOpenBatchCandidateRow[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,internal_code,title,status,audit_report,updated_at')
    .in('status', opts.statusList)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(opts.scanLimit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerOpenBatchCandidateRow[];
}

async function main() {
  const opts = options();
  const rows = await fetchRows(opts);
  const candidates = selectCustomerOpenBatchCandidates(rows, {
    limit: opts.limit,
    includeReady: opts.includeReady,
    retryErrors: opts.retryErrors,
  });
  const autopilot = opts.apply && candidates.length > 0
    ? await runUploadToOpenAutopilot({
      supabase: supabaseAdmin,
      isSupabaseConfigured,
      options: {
        packageIds: candidates.map(candidate => candidate.id),
        limit: candidates.length,
        autoOpen: false,
        baseUrl: opts.baseUrl,
        attempts: 1,
      },
    })
    : null;
  const report = {
    checkedAt: new Date().toISOString(),
    mode: opts.apply ? 'apply' : 'dry-run',
    baseUrl: opts.baseUrl,
    statusFilter: opts.statusList,
    scanned: rows.length,
    selected: candidates.length,
    candidates,
    autopilot: autopilot ? {
      ok: autopilot.ok,
      scanned: autopilot.scanned,
      ready_not_opened: autopilot.ready_not_opened,
      blocked: autopilot.blocked,
      openable: autopilot.openable,
      auto_fixed_openable: autopilot.auto_fixed_openable,
      needs_human_source_review: autopilot.needs_human_source_review,
      errors: autopilot.errors,
      results: autopilot.results.map(result => ({
        id: result.id,
        title: result.title,
        code: result.code,
        status: result.status,
        openabilityState: result.openabilityState,
        stage: result.stage,
        reasons: result.reasons,
        repairs: result.repairs,
        reviewActions: result.reviewActions ?? [],
      })),
    } : null,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[prepare-customer-open] mode=${report.mode} scanned=${report.scanned} selected=${report.selected}`);
    console.log(`status=${opts.statusList.join(',')} base=${opts.baseUrl}`);
    for (const candidate of candidates.slice(0, 20)) {
      console.log(`- ${candidate.internalCode ?? candidate.id} ${candidate.reason}: ${candidate.title ?? '(untitled)'}`);
    }
    if (autopilot) {
      console.log(`ready_not_opened=${autopilot.ready_not_opened} blocked=${autopilot.blocked} errors=${autopilot.errors.length}`);
    }
  }

  if (autopilot && opts.strict && !autopilot.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
