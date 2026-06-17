#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { evaluateJarvisGoldenSet } from '../src/lib/jarvis/eval/offline-evaluator';
import { evaluateRagGoldenSet } from '../src/lib/jarvis/eval/rag-evaluator';
import { TRACE_GOLDEN_CASES } from '../src/lib/jarvis/eval/trace-golden-cases';
import { gradeJarvisTraceSet } from '../src/lib/jarvis/eval/trace-grader';
import { auditRagIndexRows, type RagIndexAuditRow } from '../src/lib/jarvis/eval/rag-index-audit';
import { evaluateJarvisReadiness } from '../src/lib/jarvis/eval/readiness-gate';

dotenv.config({ path: '.env.local' });
dotenv.config();

type CliOptions = {
  json: boolean;
  strict: boolean;
  requireDb: boolean;
  skipHeavy: boolean;
  limit: number;
};

type CommandResult = {
  ok: boolean;
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
};

function readNumberArg(args: string[], name: string, fallback: number): number {
  const prefix = `${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseCliOptions(args: string[]): CliOptions {
  return {
    json: args.includes('--json'),
    strict: args.includes('--strict'),
    requireDb: args.includes('--require-db'),
    skipHeavy: args.includes('--skip-heavy'),
    limit: Math.max(1, Math.floor(readNumberArg(args, '--limit', 250))),
  };
}

function commandName(name: 'npm' | 'npx'): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runCommand(command: string, args: string[]): CommandResult {
  const printableCommand = [command, ...args].join(' ');
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArg).join(' ')], {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: false,
    })
    : spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
      shell: false,
    });
  return {
    ok: result.status === 0,
    command: printableCommand,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function loadLiveRagAudit(limit: number): Promise<{
  skipped: boolean;
  error: string | null;
  totalRows: number | null;
  audit: ReturnType<typeof auditRagIndexRows> | null;
}> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return {
      skipped: true,
      error: 'Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
      totalRows: null,
      audit: null,
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [totalRes, sampleRes] = await Promise.all([
    supabase.from('jarvis_knowledge_chunks').select('id', { count: 'exact', head: true }),
    supabase
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
      .limit(limit),
  ]);

  const error = totalRes.error ?? sampleRes.error;
  if (error) {
    return {
      skipped: false,
      error: error.message,
      totalRows: null,
      audit: null,
    };
  }

  return {
    skipped: false,
    error: null,
    totalRows: totalRes.count ?? 0,
    audit: auditRagIndexRows((sampleRes.data ?? []) as unknown as RagIndexAuditRow[]),
  };
}

function printText(payload: Awaited<ReturnType<typeof buildReadinessPayload>>): void {
  console.log(`Jarvis readiness: ${payload.summary.status.toUpperCase()} ${payload.summary.score}/${payload.summary.maxScore}`);
  for (const check of payload.summary.checks) {
    console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.score}/${check.maxScore} ${check.message}`);
  }
  if (payload.liveRag.audit?.remediationActions.length) {
    console.log('Next RAG actions:');
    for (const action of payload.liveRag.audit.remediationActions.slice(0, 3)) {
      console.log(`- P${action.priority} ${action.title}`);
      for (const command of action.commands.slice(0, 2)) {
        console.log(`  $ ${command}`);
      }
    }
  }
  for (const command of payload.commands) {
    console.log(`- ${command.ok ? 'PASS' : 'FAIL'} ${command.command}`);
  }
}

async function buildReadinessPayload(options: CliOptions) {
  const deterministic = evaluateJarvisGoldenSet();
  const rag = evaluateRagGoldenSet();
  const trace = gradeJarvisTraceSet(TRACE_GOLDEN_CASES);
  const liveRag = await loadLiveRagAudit(options.limit);

  const commands: CommandResult[] = [];
  if (!options.skipHeavy) {
    commands.push(runCommand(commandName('npx'), ['tsc', '--noEmit', '-p', 'tsconfig.jarvis-readiness.json']));
    commands.push(runCommand(commandName('npx'), [
      'vitest',
      'run',
      'src/lib/jarvis/eval/rag-index-audit.test.ts',
      'src/lib/jarvis/eval/readiness-gate.test.ts',
      'src/components/admin/JarvisReadinessCard.test.tsx',
      'src/components/admin/JarvisRagStatusCard.test.tsx',
    ]));
    commands.push(runCommand('node', ['--test', 'db/smoke_jarvis_v2.js']));
    if (options.requireDb) {
      commands.push(runCommand(commandName('npx'), [
        'tsx',
        'scripts/eval-jarvis-rag-live.ts',
        '--require-db',
        '--strict',
        '--json',
      ]));
    }
  }

  const typecheck = commands.find((command) => command.command.includes('tsc --noEmit'));
  const componentTests = commands.find((command) => command.command.includes('vitest run'));
  const smoke = commands.find((command) => command.command.includes('smoke_jarvis_v2.js'));
  const liveRagSearch = commands.find((command) => command.command.includes('eval-jarvis-rag-live.ts'));
  const summary = evaluateJarvisReadiness({
    deterministicPassRate: deterministic.passRate,
    ragPassRate: rag.passRate,
    tracePassRate: trace.passRate,
    traceAverageScore: trace.averageScore,
    liveRagScore: liveRag.audit?.qualityScore ?? null,
    liveRagReadiness: liveRag.audit?.readinessLevel ?? 'skipped',
    liveRagSearchPassed: options.skipHeavy || !options.requireDb ? 'skipped' : liveRagSearch?.ok === true,
    typecheckPassed: options.skipHeavy ? 'skipped' : typecheck?.ok === true,
    componentTestsPassed: options.skipHeavy ? 'skipped' : componentTests?.ok === true,
    smokePassed: options.skipHeavy ? 'skipped' : smoke?.ok === true,
  });

  return {
    ok: summary.status === 'pass' || (!options.strict && summary.status === 'warn'),
    strict: options.strict,
    requireDb: options.requireDb,
    deterministic,
    rag,
    trace,
    liveRag,
    commands,
    summary,
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const payload = await buildReadinessPayload(options);

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printText(payload);
  }

  if (options.requireDb && payload.liveRag.skipped) {
    process.exitCode = 1;
    return;
  }
  if (!payload.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
