#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { evaluateAllScenarioReadiness } from '../src/lib/jarvis/eval/all-scenarios-readiness';
import type { AllScenarioReadinessStatus } from '../src/lib/jarvis/eval/all-scenarios-readiness';
import type { JarvisReadinessStatus } from '../src/lib/jarvis/eval/readiness-gate';

dotenv.config({ path: '.env.local' });
dotenv.config();

type CliOptions = {
  json: boolean;
};

type CommandResult = {
  id: string;
  ok: boolean;
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
  parseError?: string;
  parsed?: unknown;
};

function parseCliOptions(args: string[]): CliOptions {
  return {
    json: args.includes('--json'),
  };
}

function commandName(name: 'npm' | 'npx'): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runCommand(id: string, command: string, args: string[]): CommandResult {
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
    id,
    ok: result.status === 0,
    command: printableCommand,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function extractJsonObject(output: string): unknown {
  for (let start = 0; start < output.length; start += 1) {
    if (output[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < output.length; end += 1) {
      const char = output[end];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(output.slice(start, end + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error('JSON object not found in command output');
}

function parseJsonResult(result: CommandResult): CommandResult {
  try {
    return { ...result, parsed: extractJsonObject(result.stdout) };
  } catch (error) {
    return {
      ...result,
      parseError: error instanceof Error ? error.message : 'unknown parse error',
    };
  }
}

function numberField(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function statusField<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = record[key];
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function arrayLength(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return Array.isArray(value) ? value.length : 0;
}

function buildPayload() {
  const jarvis = parseJsonResult(runCommand('jarvis-readiness', commandName('npm'), [
    'run',
    'verify:jarvis-readiness',
    '--',
    '--json',
  ]));
  const customer = parseJsonResult(runCommand('customer-inquiry', commandName('npm'), [
    'run',
    'verify:customer-inquiry',
    '--',
    '--json',
  ]));
  const autopilot = runCommand('autopilot-hitl', commandName('npx'), [
    'vitest',
    'run',
    'src/lib/agent-action-registry.test.ts',
    'src/lib/jarvis/hitl.test.ts',
  ]);
  const freeTravel = parseJsonResult(runCommand('free-travel-100', commandName('npm'), [
    'run',
    'verify:free-travel-100-scenarios',
    '--',
    '--json',
  ]));
  const rag = parseJsonResult(runCommand('live-rag-audit', commandName('npm'), [
    'run',
    'audit:jarvis-rag',
    '--',
    '--json',
  ]));

  const jarvisPayload = asRecord(jarvis.parsed);
  const jarvisSummary = asRecord(jarvisPayload.summary);
  const customerPayload = asRecord(customer.parsed);
  const customerScenarios = asRecord(customerPayload.scenarios);
  const freeTravelPayload = asRecord(freeTravel.parsed);
  const ragPayload = asRecord(rag.parsed);
  const ragAudit = asRecord(ragPayload.audit);
  const jarvisLiveRag = asRecord(asRecord(jarvisPayload.liveRag).audit);

  const liveRagScore = ragAudit.qualityScore ?? jarvisLiveRag.qualityScore;
  const liveRagReadiness = ragAudit.readinessLevel ?? jarvisLiveRag.readinessLevel;
  const summary = evaluateAllScenarioReadiness({
    jarvisReadinessScore: jarvis.ok ? numberField(jarvisSummary, 'score', 0) : 0,
    jarvisReadinessMaxScore: numberField(jarvisSummary, 'maxScore', 100),
    jarvisReadinessStatus: jarvis.ok
      ? statusField(jarvisSummary, 'status', ['pass', 'warn', 'fail'] as const, 'fail' as JarvisReadinessStatus)
      : 'fail',
    customerInquiryScore: customer.ok ? numberField(customerScenarios, 'score', 0) : 0,
    customerInquiryStatus: customer.ok && statusField(customerScenarios, 'status', ['pass', 'warn', 'fail'] as const, 'fail') === 'pass'
      ? 'pass'
      : 'fail',
    autopilotHitlPassed: autopilot.ok,
    freeTravelScore: freeTravel.ok ? numberField(freeTravelPayload, 'score', 0) : 0,
    freeTravelStatus: freeTravel.ok
      ? statusField(freeTravelPayload, 'status', ['pass', 'warn', 'fail'] as const, 'fail' as AllScenarioReadinessStatus)
      : 'fail',
    freeTravelP0Failures: arrayLength(freeTravelPayload, 'p0Failures'),
    liveRagScore: typeof liveRagScore === 'number' ? liveRagScore : null,
    liveRagReadiness: statusField(
      { readinessLevel: liveRagReadiness },
      'readinessLevel',
      ['ready', 'watch', 'blocked', 'skipped'] as const,
      'skipped',
    ),
  });

  return {
    ok: summary.ok,
    generated_at: new Date().toISOString(),
    summary,
    evidence: {
      jarvis: jarvis.parsed ?? null,
      customer: customer.parsed ?? null,
      freeTravel: freeTravel.parsed ?? null,
      rag: rag.parsed ?? null,
    },
    commands: [jarvis, customer, autopilot, freeTravel, rag],
  };
}

function printText(payload: ReturnType<typeof buildPayload>): void {
  console.log(`Jarvis all-scenarios readiness: ${payload.summary.status.toUpperCase()} ${payload.summary.score}/100`);
  for (const section of payload.summary.sections) {
    console.log(`- ${section.status.toUpperCase()} ${section.id}: ${section.score}/${section.maxScore} ${section.message}`);
  }

  for (const command of payload.commands) {
    console.log(`- ${command.ok ? 'PASS' : 'FAIL'} ${command.command}`);
    if (command.parseError) console.log(`  parse: ${command.parseError}`);
  }
}

const options = parseCliOptions(process.argv.slice(2));
const payload = buildPayload();

if (options.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  printText(payload);
}

if (!payload.ok) {
  process.exitCode = 1;
}
