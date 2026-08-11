#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const NO_LEGACY = process.argv.includes('--no-legacy-writers');
const JSON_OUTPUT = process.argv.includes('--json');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'product-registration-authority-legacy-writers.json');
const SOURCE_ROOTS = ['src', 'scripts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const AUTHORITY_TABLES = new Set([
  'products',
  'product_prices',
  'travel_packages',
  'public_package_snapshots',
  'product_registration_v5_revisions',
  'product_registration_v5_claims',
  'product_registration_v5_claim_evidence',
  'product_registration_v5_price_rules',
  'product_registration_v5_itinerary_items',
  'product_registration_v5_publication_pointers',
]);
const MUTATIONS = ['insert', 'upsert', 'update', 'delete'];
const AUTHORIZED_WRITER_FILES = new Set([
  'src/lib/product-registration-authority/repository.ts',
]);
const GENERATED_SOURCE_PREFIXES = [
  // Emitted by the Workflow build from checked source. Scanning it duplicates
  // the original findings and makes the authority result depend on build order.
  'src/app/.well-known/workflow/',
];
const RETIRED_PUBLICATION_RPCS = new Set([
  'publish_package_snapshot_atomic',
  'publish_product_registration_v5_snapshot_atomic',
  'publish_product_registration_v6_snapshot_atomic',
  'publish_product_snapshot_atomic',
]);
const ARCHITECTURE_CONTRACTS = [
  {
    file: 'src/workflows/product-registration-v6.ts',
    required: [
      ['immutable revision compatibility projection', /projectCompatibilityFromRevisionAtomic/],
      ['revision aggregate projection', /buildPackageProjectionFromRevision/],
    ],
    forbidden: [
      ['legacy compatibility step', /legacyCompatibilityStep/],
      ['legacy upload pipeline import or execution', /runUploadRegistrationPipeline/],
      ['source re-download after canonical normalization', /storage\.from\([^\n]+\)\.download/],
      ['authority barrel import cycle', /from ['"]@\/lib\/product-registration-authority['"]/],
    ],
  },
  {
    file: 'src/lib/product-registration-v6/snapshot-publication.ts',
    required: [
      ['revision aggregate snapshot source', /loadProductRegistrationRevisionAggregate/],
    ],
    forbidden: [
      ['legacy mobile QA mutation path', /runAutoMobileQA/],
      ['authority barrel import cycle', /from ['"]@\/lib\/product-registration-authority['"]/],
    ],
  },
  {
    file: 'src/lib/product-registration-v4/canonical-worker.ts',
    required: [
      ['single revision authority repository', /product-registration-authority\/repository/],
    ],
    forbidden: [
      ['authority barrel import cycle', /from ['"]@\/lib\/product-registration-authority['"]/],
    ],
  },
  {
    file: 'src/lib/package-publication/repository.ts',
    required: [
      ['kernel legacy-writer runtime blocker', /productRegistrationLegacyWriterBlocker\(\)/],
    ],
    forbidden: [],
  },
  {
    file: 'src/lib/product-registration/upload-to-open-autopilot.ts',
    required: [
      ['autopilot kernel authority blocker', /productRegistrationLegacyWriterBlocker\(\)/],
    ],
    forbidden: [],
  },
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(fullPath));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) result.push(fullPath);
  }
  return result;
}

function lineNumber(content, offset) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function scanFile(filePath) {
  const relativePath = normalizePath(path.relative(ROOT, filePath));
  if (relativePath === 'scripts/check-product-registration-authority.mjs') return [];
  if (GENERATED_SOURCE_PREFIXES.some(prefix => relativePath.startsWith(prefix))) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const findings = [];
  const fromPattern = /\.from\(\s*(['"])([a-zA-Z0-9_]+)\1\s*\)/g;
  let match;
  while ((match = fromPattern.exec(content)) !== null) {
    const table = match[2];
    if (!AUTHORITY_TABLES.has(table)) continue;
    const tail = content.slice(match.index + match[0].length, match.index + match[0].length + 900);
    const mutationMatch = tail.match(/\.\s*(insert|upsert|update|delete)\s*\(/);
    if (!mutationMatch) continue;
    const beforeMutation = tail.slice(0, mutationMatch.index ?? 0);
    if (/;\s*(?:\r?\n|$)/.test(beforeMutation)) continue;
    const operation = mutationMatch[1];
    findings.push({
      kind: 'table_mutation',
      file: relativePath,
      line: lineNumber(content, match.index),
      table,
      operation,
      signature: `${relativePath}|${table}|${operation}`,
    });
  }

  const rpcPattern = /\.rpc\(\s*(['"])([a-zA-Z0-9_]+)\1/g;
  while ((match = rpcPattern.exec(content)) !== null) {
    const rpc = match[2];
    if (!RETIRED_PUBLICATION_RPCS.has(rpc)) continue;
    findings.push({
      kind: 'retired_publication_rpc',
      file: relativePath,
      line: lineNumber(content, match.index),
      rpc,
      signature: `${relativePath}|rpc|${rpc}`,
    });
  }
  return findings;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { legacyWriters: [] };
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  if (!Array.isArray(parsed.legacyWriters)) throw new Error('legacyWriters must be an array');
  return parsed;
}

const findings = SOURCE_ROOTS.flatMap(root => walk(path.join(ROOT, root))).flatMap(scanFile);
const baseline = loadBaseline();
const baselineSignatures = new Set(baseline.legacyWriters.map(item => typeof item === 'string' ? item : item.signature));
const authorized = findings.filter(item => AUTHORIZED_WRITER_FILES.has(item.file));
const legacy = findings.filter(item => !AUTHORIZED_WRITER_FILES.has(item.file) && baselineSignatures.has(item.signature));
const unapproved = findings.filter(item => !AUTHORIZED_WRITER_FILES.has(item.file) && !baselineSignatures.has(item.signature));
const staleBaseline = baseline.legacyWriters.filter(item => {
  const signature = typeof item === 'string' ? item : item.signature;
  return !findings.some(finding => finding.signature === signature);
});
const architectureFailures = ARCHITECTURE_CONTRACTS.flatMap(contract => {
  const filePath = path.join(ROOT, contract.file);
  if (!fs.existsSync(filePath)) return [`authority architecture contract missing file: ${contract.file}`];
  const content = fs.readFileSync(filePath, 'utf8');
  return [
    ...contract.required
      .filter(([, pattern]) => !pattern.test(content))
      .map(([label]) => `authority architecture contract missing ${label}: ${contract.file}`),
    ...contract.forbidden
      .filter(([, pattern]) => pattern.test(content))
      .map(([label]) => `authority architecture contract forbids ${label}: ${contract.file}`),
  ];
});
const failures = [
  ...unapproved.map(item => `new unauthorized writer: ${item.signature}:${item.line}`),
  ...staleBaseline.map(item => `stale legacy writer baseline (remove it): ${typeof item === 'string' ? item : item.signature}`),
  ...architectureFailures,
];
if (NO_LEGACY) {
  failures.push(...legacy.map(item => `legacy writer still active: ${item.signature}:${item.line}`));
}

const report = {
  ok: failures.length === 0,
  mode: NO_LEGACY ? 'kernel-only' : 'migration-baseline',
  authorized,
  legacy,
  unapproved,
  staleBaseline,
  failures,
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[product-registration-authority] mode=${report.mode}`);
  console.log(`[product-registration-authority] authorized=${authorized.length} legacy=${legacy.length} unapproved=${unapproved.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
}

if (STRICT && failures.length > 0) process.exit(1);
