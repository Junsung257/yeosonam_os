#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  auditRagIndexRows,
  getRagIndexIssueSeverity,
  type RagIndexAuditRow,
} from '../src/lib/jarvis/eval/rag-index-audit';

dotenv.config({ path: '.env.local' });
dotenv.config();

type CliOptions = {
  json: boolean;
  strict: boolean;
  requireDb: boolean;
  exactCount: boolean;
  limit: number;
  minScore: number;
  staleDays: number;
  sourceType: string | null;
  timeoutMs: number;
};

function readNumberArg(args: string[], name: string, fallback: number): number {
  const prefix = `${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readStringArg(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function parseCliOptions(args: string[]): CliOptions {
  return {
    json: args.includes('--json'),
    strict: args.includes('--strict'),
    requireDb: args.includes('--require-db'),
    exactCount: args.includes('--exact-count') || args.includes('--exact-counts'),
    limit: Math.max(1, Math.floor(readNumberArg(args, '--limit', 250))),
    minScore: readNumberArg(args, '--min-score', args.includes('--strict') ? 90 : 80),
    staleDays: Math.max(1, Math.floor(readNumberArg(args, '--stale-days', 30))),
    sourceType: readStringArg(args, '--source'),
    timeoutMs: Math.max(1000, Math.floor(readNumberArg(args, '--timeout-ms', 30000))),
  };
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function withQueryTimeout<T>(
  label: string,
  query: { abortSignal: (signal: AbortSignal) => PromiseLike<T> },
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([query.abortSignal(controller.signal), timeout]);
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof Error)) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    const payload = {
      skipped: true,
      reason: 'Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
    };
    if (options.json) printJson(payload);
    else console.log(`Jarvis RAG audit skipped: ${payload.reason}`);
    if (options.requireDb) process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let totalQuery = supabase
    .from('jarvis_knowledge_chunks')
    .select('id', { count: options.exactCount ? 'exact' : 'estimated', head: true });
  let sampleQuery = supabase
    .from('jarvis_knowledge_chunks')
    .select([
      'id',
      'tenant_id',
      'source_type',
      'source_id',
      'source_url',
      'source_title',
      'chunk_index',
      'chunk_text',
      'contextual_text',
      'content_hash',
      'updated_at',
    ].join(', '))
    .order('updated_at', { ascending: false })
    .limit(options.limit);

  if (options.sourceType) {
    totalQuery = totalQuery.eq('source_type', options.sourceType);
    sampleQuery = sampleQuery.eq('source_type', options.sourceType);
  }

  let totalRes;
  let sampleRes;
  try {
    totalRes = await withQueryTimeout('jarvis_knowledge_chunks count', totalQuery, options.timeoutMs);
    if (totalRes.error) {
      const payload = {
        ok: false,
        error: `jarvis_knowledge_chunks count: ${totalRes.error.message ?? 'Unknown Supabase error'}`,
        timeoutMs: options.timeoutMs,
      };
      if (options.json) printJson(payload);
      else console.error(`Jarvis RAG audit failed: ${payload.error}`);
      process.exitCode = 1;
      return;
    }
    sampleRes = await withQueryTimeout('jarvis_knowledge_chunks sample', sampleQuery, options.timeoutMs);
  } catch (error) {
    const payload = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      timeoutMs: options.timeoutMs,
    };
    if (options.json) printJson(payload);
    else console.error(`Jarvis RAG audit failed: ${payload.error}`);
    process.exitCode = 1;
    return;
  }
  if (sampleRes.error) {
    const error = sampleRes.error;
    const payload = {
      ok: false,
      error: error?.message ?? 'Unknown Supabase error',
    };
    if (options.json) printJson(payload);
    else console.error(`Jarvis RAG audit failed: ${payload.error}`);
    process.exitCode = 1;
    return;
  }

  const summary = auditRagIndexRows((sampleRes.data ?? []) as unknown as RagIndexAuditRow[], {
    staleAfterDays: options.staleDays,
  });
  const ok = summary.qualityScore >= options.minScore && summary.readinessLevel !== 'blocked';
  const payload = {
    ok,
    totalRows: totalRes.count ?? 0,
    countStrategy: options.exactCount ? 'exact' : 'estimated',
    sampledRows: summary.sampledRows,
    minScore: options.minScore,
    sourceFilter: options.sourceType,
    audit: summary,
  };

  if (options.json) {
    printJson(payload);
  } else {
    console.log(
      `Jarvis RAG live audit: score=${summary.qualityScore}/100, ` +
      `level=${summary.readinessLevel}, sampled=${summary.sampledRows}, total=${payload.totalRows}`,
    );
    console.log(
      `Coverage: present=${summary.coverage.presentSourceTypes.join(', ') || 'none'}, ` +
      `missing=${summary.coverage.missingSourceTypes.join(', ') || 'none'}`,
    );
    for (const [code, count] of Object.entries(summary.issueCounts)) {
      if (count === 0) continue;
      console.log(`- ${getRagIndexIssueSeverity(code as keyof typeof summary.issueCounts)} ${code}: ${count}`);
    }
    if (summary.samples.length > 0) {
      console.log('Samples:');
      for (const sample of summary.samples.slice(0, 5)) {
        console.log(`- ${sample.sourceType}#${sample.chunkIndex ?? 'n/a'} ${sample.sourceTitle ?? sample.id}: ${sample.issues.join(', ')}`);
      }
    }
    if (summary.remediationActions.length > 0) {
      console.log('Next actions:');
      for (const action of summary.remediationActions.slice(0, 5)) {
        console.log(`- P${action.priority} ${action.title}: ${action.description}`);
        for (const command of action.commands.slice(0, 3)) {
          console.log(`  $ ${command}`);
        }
      }
    }
  }

  if (!ok || (options.strict && summary.readinessLevel !== 'ready')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  process.exit(process.exitCode ?? 0);
});
