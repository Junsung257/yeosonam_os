import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const RELEASE_LABEL = 'product-registration-v61-20260820';
const REQUIRED_ARTIFACTS = [
  'supabase/migrations/20260819235142_product_registration_v61_authority.sql',
  'supabase/migrations/20260819235152_product_registration_v61_workflow.sql',
  'supabase/migrations/20260819235155_product_registration_v61_surface_lineage.sql',
  'supabase/migrations/20260820100000_product_registration_v61_knowledge_ledger.sql',
  'docs/product-registration-current-ssot.md',
  'docs/specs/20260820-product-registration-v61/verification.md',
];

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function commandProbe(command, args = ['--version']) {
  try {
    const output = execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return output.split(/\r?\n/u)[0] || null;
  } catch {
    return null;
  }
}

function sha256File(relativePath) {
  const absolute = resolve(ROOT, relativePath);
  if (!existsSync(absolute)) return null;
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

function walk(directory) {
  const absolute = resolve(ROOT, directory);
  if (!existsSync(absolute)) return [];
  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap(entry => {
    const full = join(absolute, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'coverage', 'dist'].includes(entry.name)) return [];
      return walk(relative(ROOT, full));
    }
    return [relative(ROOT, full).replaceAll('\\', '/')];
  });
}

function testFiles() {
  return [...walk('src'), ...walk('tests/unit')]
    .filter(file => /(?:\.test|\.spec)\.[cm]?[jt]sx?$/u.test(file))
    .sort();
}

function skipInventory(files) {
  const patterns = [
    { kind: 'skip', pattern: /\b(?:it|test|describe)\.(?:skip|todo)\s*\(/gu },
    { kind: 'conditional', pattern: /\b(?:it|test|describe)\.(?:skipIf|runIf)\s*\(/gu },
  ];
  return files.flatMap(file => {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    const matches = { skips: [], conditional: [] };
    for (const { kind, pattern } of patterns) {
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index ?? 0).split(/\r?\n/u).length;
        matches[kind === 'skip' ? 'skips' : 'conditional'].push({ file, line, pattern: pattern.source });
      }
    }
    return matches;
  }).reduce((inventory, current) => {
    inventory.skips.push(...current.skips);
    inventory.conditional.push(...current.conditional);
    return inventory;
  }, { skips: [], conditional: [] });
}

function changedFiles(base) {
  if (!base) return [];
  return git(['diff', '--name-status', `${base}..HEAD`])
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [status, ...paths] = line.split(/\s+/u);
      return { status, paths };
    });
}

function buildEvidence() {
  let gitError = null;
  let head = null;
  let branch = null;
  let status = null;
  let originMain = null;
  try {
    head = git(['rev-parse', 'HEAD']);
    branch = git(['branch', '--show-current']);
    status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    originMain = git(['rev-parse', 'origin/main']);
  } catch (error) {
    gitError = error instanceof Error ? error.message : String(error);
  }

  const files = testFiles();
  const skipInventoryResult = skipInventory(files);
  const artifacts = Object.fromEntries(REQUIRED_ARTIFACTS.map(file => [file, sha256File(file)]));
  const missingArtifacts = REQUIRED_ARTIFACTS.filter(file => !artifacts[file]);
  const clean = typeof status === 'string' && status.length === 0;
  const exactCommit = Boolean(head && /^[0-9a-f]{40}$/u.test(head));
  const dbConfigured = Boolean(
    process.env.SUPABASE_URL
      && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
  );
  const tooling = {
    supabaseCli: commandProbe('supabase'),
    psqlCli: commandProbe('psql'),
    dockerCli: commandProbe('docker'),
    dockerDaemon: commandProbe('docker', ['info']),
  };
  const buildEvidence = {
    status: 'NOT_PROVEN',
    reason: 'Run npm run build on the exact clean commit and attach an exit-code-0 log.',
  };
  return {
    schemaVersion: 'product-registration-v61-release-evidence-1',
    releaseLabel: RELEASE_LABEL,
    capturedAt: new Date().toISOString(),
    workspace: ROOT,
    git: { head, branch, originMain, clean, status, gitError },
    exactCommit,
    artifacts,
    missingArtifacts,
    tests: {
      fileCount: files.length,
      files,
      skipCount: skipInventoryResult.skips.length,
      skips: skipInventoryResult.skips,
      conditionalCount: skipInventoryResult.conditional.length,
      conditional: skipInventoryResult.conditional,
    },
    build: buildEvidence,
    database: {
      configured: dbConfigured,
      migrationRehearsal: 'NOT_RUN',
      reason: dbConfigured
        ? 'Configured only; run the staging rehearsal harness before any production migration.'
        : 'No Supabase URL and service/secret key are configured in this process.',
    },
    tooling,
    gates: {
      cleanExactCommit: clean && exactCommit,
      requiredArtifactHashes: missingArtifacts.length === 0,
      migrationRehearsal: false,
      atomicityFailureInjection: false,
      publicationCasConcurrency: false,
      staleFencingWorker: false,
      productionBuild: false,
      browserCanary: false,
      cacheTransition: false,
      rollback: false,
      goldSet: false,
    },
  };
}

const evidence = buildEvidence();
const json = JSON.stringify(evidence, null, 2);
if (arg('out')) {
  const outputPath = resolve(ROOT, arg('out'));
  writeFileSync(outputPath, `${json}\n`, 'utf8');
}
if (flag('json') || !arg('out')) console.log(json);

const strict = flag('strict');
if (strict && (!evidence.gates.cleanExactCommit || !evidence.gates.requiredArtifactHashes)) {
  process.exitCode = 2;
}
