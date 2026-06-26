import { spawnSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv();

const argv = process.argv.slice(2);
const args = new Set(argv);

const apply = args.has('--apply');
const status = argValue('--status', 'active');
const limit = Number(argValue('--limit', '500'));
const verifyLimit = Number(argValue('--verify-limit', '50'));
const promoteLimit = Number(argValue('--promote-limit', '50'));
const photoLimit = Number(argValue('--photo-limit', '50'));
const minScore = Number(argValue('--min-score', '0.3'));
const destination = argValue('--destination', '');
const publicOnly = !args.has('--all-products');
const skipVerify = args.has('--skip-verify');
const skipPromote = args.has('--skip-promote');
const skipPhotoFill = args.has('--skip-photo-fill');
const skipCandidateRepair = args.has('--skip-candidate-repair');

type Step = {
  label: string;
  command: string;
  args: string[];
  optional?: boolean;
};

function argValue(name: string, fallback: string): string {
  const found = argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function bin(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(step: Step): void {
  console.log(`\n[quality-engine] ${step.label}`);
  console.log(`$ ${step.command} ${step.args.join(' ')}`);
  const command = process.platform === 'win32' ? 'cmd.exe' : step.command;
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', commandLine(step.command, step.args)]
    : step.args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !step.optional) {
    throw new Error(`${step.label} failed with exit code ${result.status ?? 'unknown'}`);
  }
  if (result.status !== 0 && step.optional) {
    console.warn(`[quality-engine] optional step failed: ${step.label}`);
  }
}

function commandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteCmdArg).join(' ');
}

function quoteCmdArg(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

const steps: Step[] = [
  ...(!skipCandidateRepair ? [{
    label: 'Repair source-backed price, itinerary, optional tour, and V3 readiness candidates',
    command: bin('npx'),
    args: [
      'tsx',
      'scripts/repair-product-mobile-readiness-candidates.ts',
      `--status=${publicOnly ? 'active,approved' : status}`,
      `--limit=${limit}`,
      '--days=365',
      ...(apply ? ['--apply'] : []),
      ...(publicOnly ? ['--include-public'] : []),
    ],
  }] : []),
  {
    label: 'Collect customer-visible unmatched attraction/media candidates',
    command: bin('npx'),
    args: [
      'tsx',
      'scripts/backfill-attraction-media-candidates.ts',
      `--status=${status}`,
      `--limit=${limit}`,
      '--json',
      ...(apply ? ['--apply'] : []),
    ],
  },
];

if (!skipVerify) {
  steps.push({
    label: 'Verify attraction master candidates with cached/live evidence',
    command: bin('npx'),
    args: [
      'tsx',
      'scripts/verify-entity-master-candidates.ts',
      '--category=attraction',
      '--promotion-status=needs_review,candidate,auto_internal,publishable_ready',
      `--limit=${verifyLimit}`,
      ...(destination ? [`--destination=${destination}`] : []),
      '--summary-only',
      '--json',
      ...(apply ? ['--apply'] : []),
    ],
  });
}

if (!skipPromote) {
  steps.push({
    label: 'Promote verified internal attraction candidates and re-enrich affected packages',
    command: bin('npx'),
    args: [
      'tsx',
      'scripts/promote-verified-attraction-candidates.ts',
      `--limit=${promoteLimit}`,
      `--min-score=${minScore}`,
      ...(destination ? [`--destination=${destination}`] : []),
      '--json',
      ...(apply ? ['--apply'] : []),
    ],
  });
}

if (!skipPhotoFill) {
  steps.push({
    label: 'Fill missing attraction photos with strict source/name scoring',
    command: bin('npx'),
    args: [
      'tsx',
      'scripts/fill-attraction-photos.ts',
      `--limit=${photoLimit}`,
      `--status=${status}`,
      '--referenced',
      '--json',
    ],
  });
}

steps.push(
  {
    label: 'Fill source-backed attraction descriptions for text-only attraction cards',
    command: bin('npx'),
    args: [
      'tsx',
      'scripts/fill-attraction-descriptions.ts',
      `--status=${status}`,
      `--limit=${limit}`,
      '--json',
      ...(apply ? ['--apply'] : []),
    ],
  },
  {
    label: 'Re-scan unmatched attraction/media candidates after repairs',
    command: bin('npx'),
    args: [
      'tsx',
      'scripts/backfill-attraction-media-candidates.ts',
      `--status=${status}`,
      `--limit=${limit}`,
      '--json',
    ],
  },
  {
    label: 'Audit mobile landing and A4 customer readiness',
    command: 'node',
    args: [
      'scripts/audit-product-mobile-landing-readiness.mjs',
      '--strict',
      `--limit=${Math.max(limit, 2000)}`,
      ...(publicOnly ? ['--public-only'] : []),
      ...(publicOnly ? ['--verify-public-html'] : []),
      '--json',
    ],
  },
  {
    label: 'Audit attraction photo coverage separately from publish blockers',
    command: bin('npx'),
    args: [
      'tsx',
      'scripts/audit-mobile-attraction-photo-coverage.ts',
      `--status=${status}`,
      `--limit=${limit}`,
      '--json',
    ],
  },
);

try {
  console.log('[quality-engine] mode:', apply ? 'apply' : 'dry-run');
  console.log('[quality-engine] policy: attraction text match is blocking; missing photos are quality warnings unless a wrong photo is attached.');
  for (const step of steps) run(step);
  console.log('\n[quality-engine] complete');
} catch (error) {
  console.error('\n[quality-engine] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
