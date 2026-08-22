import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function csv(name: string): string[] {
  return (argument(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function numberValue(name: string, fallback: number): number {
  const value = argument(name);
  return value != null && /^\d+$/.test(value) ? Number(value) : fallback;
}

function main(): void {
  const outputDir = resolve(argument('output-dir') ?? '.tmp/blog-v4-longrun');
  const executionId = argument('execution-id') ?? process.env.BLOG_V4_LONGRUN_EXECUTION_ID;
  const currentState = argument('current-state');
  const nextState = argument('next-state');
  if (!executionId || !currentState || !nextState) throw new Error('longrun_checkpoint_arguments_required');
  mkdirSync(outputDir, { recursive: true });
  const state = {
    schemaVersion: 1,
    executionId,
    currentState,
    completed: csv('completed'),
    next: nextState,
    blocker: argument('blocker'),
    productionWrites: numberValue('production-writes', 0),
    productionReads: numberValue('production-reads', 0),
    aiCalls: numberValue('ai-calls', 0),
    publications: numberValue('publications', 0),
    indexingSideEffects: numberValue('indexing-side-effects', 0),
    updatedAt: new Date().toISOString(),
  };
  const target = resolve(outputDir, 'state.json');
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
  process.stdout.write(`${JSON.stringify({ output: target, ...state }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Blog V4 long-run checkpoint failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
