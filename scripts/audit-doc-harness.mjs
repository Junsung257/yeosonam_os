import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

import { checkExternalUrl, mapWithConcurrency } from './lib/harness/external-links.mjs';

const root = resolve(import.meta.dirname, '..');
const strict = process.argv.includes('--strict');
const external = process.argv.includes('--external');
const jsonIndex = process.argv.indexOf('--json-out');
const jsonOut = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : null;
const requestedAuditDate = process.env.HARNESS_AUDIT_DATE || new Date().toISOString().slice(0, 10);
const today = new Date(`${requestedAuditDate}T00:00:00Z`);
const registryPath = resolve(root, 'docs/document-registry.yml');
const baselinePath = resolve(root, 'config/harness-baseline.json');
const findings = [];

function rel(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function trackedFiles() {
  return git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => path.replaceAll('\\', '/'));
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    add('P1', 'registry', rel(path), 1, `${label} is not valid JSON-compatible YAML.`, String(error.message), 'Fix the file syntax.');
    return null;
  }
}

function add(severity, category, path, line, message, evidence, remediation, status = 'open') {
  const seed = `${severity}|${category}|${path}|${line}|${message}`;
  findings.push({
    id: `HARNESS-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`,
    severity,
    category,
    path,
    line,
    message,
    evidence,
    remediation,
    status,
  });
}

function lineOf(text, needle) {
  const index = text.indexOf(needle);
  return index < 0 ? 1 : text.slice(0, index).split(/\r?\n/).length;
}

function daysSince(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? Math.floor((today - date) / 86400000) : Number.POSITIVE_INFINITY;
}

function commitExists(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${value}^{commit}`], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function classify(path, registry) {
  const explicit = registry.documents.find((doc) => doc.path === path);
  if (explicit) return explicit;
  const collection = registry.collections.find((item) => new RegExp(item.pattern, 'i').test(path));
  return collection || null;
}

function anchorSet(text) {
  const anchors = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const value = match[1]
      .replace(/[*_`~]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-');
    if (value) anchors.add(value);
  }
  return anchors;
}

function checkLinks(path, text, classification) {
  if (path.startsWith('.claude/skills/')) return;
  const blocking = classification?.class === 'current' || ['AGENTS.md', 'CURRENT_STATUS.md', 'docs/ai-agent-doc-automation.md'].includes(path);
  const severity = blocking ? 'P1' : 'P2';
  const scannable = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\r\n]/g, ' '));
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of scannable.matchAll(pattern)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (!target || /^(?:https?:|mailto:|tel:|data:)/i.test(target)) continue;
    target = target.split(/\s+["']/)[0];
    if (['url', '...', 'seed|temp'].includes(target)) continue;
    const [rawPath, rawAnchor] = target.split('#', 2);
    let decoded;
    try { decoded = decodeURIComponent(rawPath || ''); } catch { decoded = rawPath || ''; }
    const rootPrefixes = /^(?:src|docs|db|scripts|supabase|tests|public|config|evals|\.agents|\.claude|\.cursor|\.github)\//;
    const targetPath = decoded
      ? rootPrefixes.test(decoded.replace(/^\.\//, ''))
        ? resolve(root, decoded.replace(/^\.\//, ''))
        : resolve(root, dirname(path), decoded)
      : resolve(root, path);
    if (!existsSync(targetPath)) {
      add(severity, 'link', path, lineOf(text, match[0]), `Broken local link: ${target}`, rel(targetPath), 'Update the link or restore the intended target.');
      continue;
    }
    if (rawAnchor && !/^L\d+(?:-L\d+)?$/i.test(rawAnchor) && statSync(targetPath).isFile() && extname(targetPath).toLowerCase() === '.md') {
      const anchors = anchorSet(readFileSync(targetPath, 'utf8'));
      const expected = rawAnchor.toLowerCase();
      if (!anchors.has(expected)) add(severity, 'anchor', path, lineOf(text, match[0]), `Missing Markdown anchor: #${rawAnchor}`, rel(targetPath), 'Point to an existing heading anchor.');
    }
  }
}

function parseMeta(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const registry = readJson(registryPath, 'Document registry');
const baseline = readJson(baselinePath, 'Harness baseline') || { riskFindingIds: [] };
const files = trackedFiles();

if (registry) {
  if (!Number.isFinite(today.getTime())) {
    add('P1', 'freshness', 'docs/document-registry.yml', 1, 'HARNESS_AUDIT_DATE is invalid.', requestedAuditDate, 'Use YYYY-MM-DD or omit the variable.');
  }
  const ids = new Set();
  const authorities = new Map();
  for (const doc of registry.documents || []) {
    for (const field of ['id', 'path', 'class', 'authority_domain', 'owner', 'status', 'last_verified', 'review_days', 'supersedes']) {
      if (doc[field] === undefined || doc[field] === null || doc[field] === '') add('P1', 'registry', 'docs/document-registry.yml', 1, `Document metadata is missing ${field}.`, doc.path || doc.id || 'unknown', `Set ${field}.`);
    }
    if (!Array.isArray(doc.supersedes)) add('P1', 'registry', 'docs/document-registry.yml', 1, 'supersedes must be an array.', doc.path || doc.id, 'Use an empty array when nothing is superseded.');
    if (!(registry.classes || []).includes(doc.class)) add('P1', 'registry', 'docs/document-registry.yml', 1, `Unknown document class: ${doc.class}`, doc.path || doc.id, 'Use a declared registry class.');
    if (ids.has(doc.id)) add('P1', 'registry', 'docs/document-registry.yml', 1, `Duplicate document id: ${doc.id}`, doc.path, 'Assign a unique id.');
    ids.add(doc.id);
    if (!existsSync(resolve(root, doc.path))) add('P1', 'registry', 'docs/document-registry.yml', 1, `Registered document is missing: ${doc.path}`, doc.id, 'Restore or remove the registry entry.');
    if (doc.class === 'current' && doc.status === 'active') {
      if (authorities.has(doc.authority_domain)) add('P1', 'authority', doc.path, 1, `Duplicate current authority domain: ${doc.authority_domain}`, authorities.get(doc.authority_domain), 'Merge the current SSOT or give it a distinct authority domain.');
      authorities.set(doc.authority_domain, doc.path);
      const age = daysSince(doc.last_verified);
      if (age > Number(doc.review_days)) add('P1', 'freshness', doc.path, 1, `Current document verification is ${age} days old.`, `review_days=${doc.review_days}`, 'Re-verify against code and update last_verified.');
    }
  }

  for (const collection of registry.collections || []) {
    for (const field of ['pattern', 'class', 'authority_domain', 'owner', 'status', 'last_verified', 'review_days', 'supersedes']) {
      if (collection[field] === undefined || collection[field] === null || collection[field] === '') add('P1', 'registry', 'docs/document-registry.yml', 1, `Collection metadata is missing ${field}.`, collection.pattern || 'unknown', `Set ${field}.`);
    }
  }

  const explicitPaths = new Set((registry.documents || []).map((doc) => doc.path));
  for (const path of files.filter((item) => /^docs\/[^/]+\/(?:[^/]+)?$/.test(item) === false && /^docs\/[^/]+(?:current-ssot|contract)\.md$/i.test(item))) {
    if (!explicitPaths.has(path)) add('P1', 'registry', path, 1, 'Current/contract document must be explicitly registered.', path, 'Add a documents entry with a unique authority_domain.');
  }

  for (const path of files.filter((item) => /(?:^|\/)(?:[^/]+\.(?:md|mdc)|document-registry\.yml)$/.test(item))) {
    const classification = classify(path, registry);
    if (!classification) add('P1', 'registry', path, 1, 'Document is not classified by the registry.', path, 'Add an explicit document or collection rule.');
    if (/\.(?:md|mdc)$/.test(path)) checkLinks(path, readFileSync(resolve(root, path), 'utf8'), classification);
  }

  for (const source of registry.externalSources || []) {
    const age = daysSince(source.checked_at);
    if (age > Number(source.review_days)) add('P2', 'source-freshness', 'docs/document-registry.yml', 1, `External source is stale: ${source.id}`, source.url, 'Recheck the official source and update checked_at.');
  }
}

const auditIndexPath = resolve(root, 'docs/audits/README.md');
if (existsSync(auditIndexPath)) {
  const index = readFileSync(auditIndexPath, 'utf8');
  const auditFiles = files.filter((path) => /^docs\/audits\/[^/]+\.md$/.test(path) && !path.endsWith('/README.md'));
  for (const path of auditFiles) {
    const name = path.split('/').at(-1);
    if (!index.includes(name)) add('P2', 'audit-index', path, 1, 'Audit record is missing from docs/audits/README.md.', name, 'Add one index entry.');
  }
}

const specRoot = resolve(root, 'docs/specs');
if (existsSync(specRoot)) {
  for (const entry of readdirSync(specRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const dir = resolve(specRoot, entry.name);
    const metaPath = resolve(dir, 'meta.yml');
    if (!existsSync(metaPath)) {
      add('P1', 'spec', rel(dir), 1, 'Spec packet has no meta.yml.', entry.name, 'Add lifecycle metadata.');
      continue;
    }
    const meta = parseMeta(metaPath);
    if (!meta) {
      add('P1', 'spec', rel(metaPath), 1, 'Spec meta.yml is not JSON-compatible YAML.', entry.name, 'Fix the lifecycle metadata syntax.');
      continue;
    }
    if (![0, 1, 2, 3].includes(meta.tier) || !['active', 'blocked', 'completed', 'template'].includes(meta.status) || !meta.owner) {
      add('P1', 'spec', rel(metaPath), 1, 'Spec lifecycle metadata is incomplete.', JSON.stringify(meta), 'Set tier, status, and owner.');
    }
    if (['active', 'blocked'].includes(meta.status) && meta.tier >= 2) {
      const reviewFile = typeof meta.review_file === 'string' && meta.review_file ? meta.review_file : 'review.md';
      for (const required of ['spec.md', 'plan.md', 'tasks.md', reviewFile]) {
        if (!existsSync(resolve(dir, required))) add('P1', 'spec', rel(dir), 1, `Active Tier ${meta.tier} packet is missing ${required}.`, entry.name, `Add ${required} or correct the lifecycle status.`);
      }
    }
    if (meta.status === 'completed') {
      if (!commitExists(meta.verified_commit)) {
        add('P1', 'spec', rel(metaPath), 1, 'Completed Spec verified_commit does not resolve to a Git commit.', String(meta.verified_commit), 'Record the commit that was actually verified.');
      }
      if (!Array.isArray(meta.verification) || meta.verification.length === 0) {
        add('P1', 'spec', rel(metaPath), 1, 'Completed Spec has no structured verification result.', entry.name, 'Record at least one completed check.');
      }
      const evidencePaths = Array.isArray(meta.evidence_paths) ? meta.evidence_paths : [];
      if (evidencePaths.length === 0) {
        add('P1', 'spec', rel(metaPath), 1, 'Completed Spec has no evidence_paths.', entry.name, 'Point to a tracked verification or review artifact.');
      }
      for (const evidencePath of evidencePaths) {
        if (typeof evidencePath !== 'string' || !existsSync(resolve(dir, evidencePath))) add('P1', 'spec', rel(metaPath), 1, `Completed Spec evidence does not exist: ${evidencePath}`, entry.name, 'Restore the evidence or correct evidence_paths.');
      }
      const packetFiles = ['spec.md', 'plan.md', 'tasks.md', meta.review_file || 'review.md', 'verification.md', 'record.md'];
      for (const packetFile of new Set(packetFiles)) {
        const packetPath = resolve(dir, packetFile);
        if (!existsSync(packetPath)) continue;
        const packetText = readFileSync(packetPath, 'utf8');
        if (/^- \[ \]/m.test(packetText)) add('P1', 'spec', rel(packetPath), 1, 'Completed Spec still has an unchecked required item.', entry.name, 'Complete the item or return the Spec to active/blocked.');
      }
    }
  }
}

function directorySnapshot(dir) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) map.set(relative(dir, full).replaceAll('\\', '/'), createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  }
  walk(dir);
  return map;
}

const canonicalSkills = directorySnapshot(resolve(root, '.agents/skills'));
const claudeSkills = directorySnapshot(resolve(root, '.claude/skills'));
for (const name of [...new Set([...canonicalSkills.keys(), ...claudeSkills.keys()])].sort()) {
  if (canonicalSkills.get(name) !== claudeSkills.get(name)) add('P1', 'skill-sync', `.claude/skills/${name}`, 1, 'Claude skill mirror differs from canonical .agents source.', name, 'Run npm run sync:agent-skills and edit only .agents/skills.');
}

const instructionPaths = ['AGENTS.md', '.claude/CLAUDE.md', '.github/copilot-instructions.md'];
for (const path of files.filter((item) => /^\.cursor\/rules\/.*\.mdc$/.test(item))) {
  if (/alwaysApply:\s*true/.test(readFileSync(resolve(root, path), 'utf8'))) instructionPaths.push(path);
}
const instructionBytes = instructionPaths.reduce((sum, path) => sum + (existsSync(resolve(root, path)) ? readFileSync(resolve(root, path)).byteLength : 0), 0);
if (baseline.instructionTargetBytes && instructionBytes > baseline.instructionTargetBytes) {
  add('P1', 'instruction-budget', 'AGENTS.md', 1, 'Always-loaded instruction budget exceeds the 30% reduction target.', `${instructionBytes} > ${baseline.instructionTargetBytes}`, 'Remove duplication while preserving safety rules.');
}

const secretPatterns = [
  ['supabase-pat', /sbp_[A-Za-z0-9_-]{20,}/g],
  ['supabase-secret', /sb_secret_[A-Za-z0-9._-]{20,}/g],
  ['github-token', /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/g],
  ['openai-key', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g],
];
const textExtensions = new Set(['.md', '.mdc', '.json', '.yml', '.yaml', '.toml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.ps1']);
for (const path of files) {
  const full = resolve(root, path);
  if (!existsSync(full) || !statSync(full).isFile() || !textExtensions.has(extname(path).toLowerCase())) continue;
  const text = readFileSync(full, 'utf8');
  for (const [name, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)].map((match) => match[0]);
    const suspicious = matches.filter((value) => !/(?:example|dummy|fixture|redacted|test)/i.test(value));
    if (suspicious.length > 0) add('P0', 'secret', path, 1, `Potential ${name} found in a tracked file.`, 'value redacted', 'Remove the credential, rotate it, and use OAuth or an environment secret store.');
  }
}

for (const path of ['.claude/settings.json', '.cursor/hooks.json']) {
  const full = resolve(root, path);
  if (!existsSync(full)) continue;
  const raw = readFileSync(full, 'utf8');
  let text = raw;
  if (path === '.claude/settings.json') {
    try {
      const settings = JSON.parse(raw);
      text = JSON.stringify({ allow: settings.permissions?.allow || [], hooks: settings.hooks || {} });
    } catch {
      add('P1', 'dangerous-automation', path, 1, 'Claude settings JSON is invalid.', 'parse failure', 'Fix JSON syntax.');
    }
  }
  const risks = [
    [/node\s+-e/i, 'broad node -e execution'],
    [/(?:apply_migration|reindex|repair:.*:apply|vercel\s+--prod)/i, 'automatic production or database mutation'],
    [/(?:sessionStart|stop)[\s\S]{0,500}os:inbox/i, 'automatic repository-writing lifecycle hook'],
  ];
  for (const [pattern, message] of risks) if (pattern.test(text)) add('P1', 'dangerous-automation', path, lineOf(text, text.match(pattern)?.[0] || ''), `Risky host automation: ${message}.`, 'command redacted', 'Remove the auto-run or move it behind an explicit approval command.');
}

for (const generated of ['docs/generated/system-inventory.md', 'docs/generated/system-inventory.json']) {
  if (!existsSync(resolve(root, generated))) add('P1', 'inventory', generated, 1, 'Generated system inventory is missing.', generated, 'Run npm run generate:system-inventory.');
}

if (existsSync(resolve(root, 'scripts/generate-system-inventory.mjs'))) {
  try {
    execFileSync(process.execPath, ['scripts/generate-system-inventory.mjs', '--check'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    add('P1', 'inventory', 'docs/generated/system-inventory.md', 1, 'Generated system inventory is stale.', 'generator --check failed', 'Run npm run generate:system-inventory and commit both outputs.');
  }
}

if (external && registry) {
  const targets = new Map();
  for (const source of registry.externalSources || []) {
    targets.set(source.url, { path: 'docs/document-registry.yml', line: 1, evidence: source.id });
  }
  for (const doc of (registry.documents || []).filter((item) => item.class === 'current' && existsSync(resolve(root, item.path)))) {
    const text = readFileSync(resolve(root, doc.path), 'utf8');
    for (const match of text.matchAll(/https?:\/\/[^\s)<>"`]+/g)) {
      const url = match[0].replace(/[.,;:]$/u, '');
      if (/[{}]/u.test(url)) continue;
      if (!targets.has(url)) targets.set(url, { path: doc.path, line: lineOf(text, match[0]), evidence: 'current document link' });
    }
  }
  const entries = [...targets.entries()];
  const checks = await mapWithConcurrency(entries, 5, async ([url, context]) => ({ url, context, result: await checkExternalUrl(url) }));
  for (const { url, context, result } of checks) {
    if (result.ok) continue;
    const temporary = ['temporary', 'network'].includes(result.kind);
    add(
      temporary ? 'P3' : 'P2',
      'external-links',
      context.path,
      context.line,
      `${temporary ? 'External link could not be confirmed' : 'External link is unavailable'}: ${url}`,
      `${context.evidence}; ${result.message}; status=${result.status ?? 'none'}`,
      temporary ? 'Retry in the weekly audit before changing the source.' : 'Update or replace the source URL.',
      temporary ? 'advisory' : 'open',
    );
  }
}

const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path) || a.line - b.line);
const counts = Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((level) => [level, findings.filter((item) => item.severity === level).length]));
const result = {
  schemaVersion: 1,
  commit: git(['rev-parse', 'HEAD'], 'unknown'),
  baseline: baseline.snapshotCommit || null,
  generatedAt: new Date().toISOString(),
  summary: { total: findings.length, ...counts, instructionBytes, instructionBaselineBytes: baseline.instructionBytes || null },
  findings,
};

if (jsonOut) {
  const outputPath = resolve(root, jsonOut);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(`Harness audit: ${findings.length} finding(s) — P0 ${counts.P0}, P1 ${counts.P1}, P2 ${counts.P2}, P3 ${counts.P3}.`);
for (const finding of findings.slice(0, 80)) console.log(`${finding.severity} ${finding.category} ${finding.path}:${finding.line} ${finding.message}`);
if (findings.length > 80) console.log(`... ${findings.length - 80} additional finding(s) are available in JSON output.`);

if (strict && (counts.P0 > 0 || counts.P1 > 0)) process.exit(1);
