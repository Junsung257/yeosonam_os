import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const path = resolve(root, 'config', 'agent-skill-sources.json');
const allowedStatuses = new Set(['reference_only', 'evaluating', 'approved', 'rejected', 'blocked']);
const secret = /(?:sk-|ghp_|github_pat_|sbp_|sb_secret_)[A-Za-z0-9._-]{16,}/u;

export function validateExternalSkillSources(registry) {
  const failures = [];
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return ['registry must be an object'];
  if (registry.schemaVersion !== 1) failures.push('schemaVersion must be 1');
  if (!Array.isArray(registry.sources)) return [...failures, 'sources must be an array'];
  const ids = new Set();
  for (const [index, source] of registry.sources.entries()) {
    const label = `sources[${index}]`;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    if (!source.sourceId || ids.has(source.sourceId)) failures.push(`${label}.sourceId must be unique`);
    else ids.add(source.sourceId);
    try {
      const url = new URL(source.sourceUrl);
      if (url.protocol !== 'https:') failures.push(`${label}.sourceUrl must use HTTPS`);
    } catch { failures.push(`${label}.sourceUrl is invalid`); }
    if (!/^[a-f0-9]{40}$/u.test(source.immutableRevision ?? '')) failures.push(`${label}.immutableRevision must be a full commit SHA`);
    if (typeof source.sourcePath !== 'string' || !source.sourcePath) failures.push(`${label}.sourcePath is required`);
    if (source.contentSha256 !== null && !/^[a-f0-9]{64}$/u.test(source.contentSha256 ?? '')) failures.push(`${label}.contentSha256 must be null or SHA-256`);
    if (typeof source.license !== 'string' || !source.license) failures.push(`${label}.license is required`);
    if (!allowedStatuses.has(source.status)) failures.push(`${label}.status is invalid`);
    if (source.allowBulkInstall !== false) failures.push(`${label}.allowBulkInstall must be false`);
    const capabilities = source.reviewedCapabilities;
    for (const key of ['commands', 'hooks', 'secretNames', 'networkHosts']) {
      if (!Array.isArray(capabilities?.[key])) failures.push(`${label}.reviewedCapabilities.${key} must be an array`);
    }
    if (!Array.isArray(source.evalSuite)) failures.push(`${label}.evalSuite must be an array`);
    if (source.status === 'approved' && (!source.contentSha256 || source.evalSuite.length === 0)) {
      failures.push(`${label} approved sources require a content hash and eval suite`);
    }
  }
  if (secret.test(JSON.stringify(registry))) failures.push('registry contains a token-shaped secret');
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let registry;
  try { registry = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    console.error(`FAIL external skill registry is unreadable: ${error.message}`);
    process.exit(1);
  }
  const failures = validateExternalSkillSources(registry);
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }
  console.log(`External skill source registry passed (${registry.sources.length} source(s)).`);
}
