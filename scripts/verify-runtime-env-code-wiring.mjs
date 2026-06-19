#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

const contractPath = 'src/config/runtime-env-readiness.json';
const secretRegistryPath = 'src/lib/secret-registry.ts';
const envCheckPath = 'src/lib/env-check.ts';
const systemHealthPath = 'src/app/api/admin/marketing/system-health/route.ts';

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function addCheck(checks, name, status, detail = {}) {
  checks.push({ name, status, ...detail });
}

function unique(values) {
  return [...new Set(values)];
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function collectFiles(dir, result = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (['.next', 'node_modules'].includes(entry)) continue;
      collectFiles(path, result);
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) result.push(path);
  }
  return result;
}

function sourceTextForRuntimeRefs() {
  const ignored = new Set([
    resolve(contractPath),
    resolve(secretRegistryPath),
  ]);
  const files = collectFiles('src');
  const scanned = files.filter((path) => !ignored.has(resolve(path)));
  return {
    fileCount: scanned.length,
    text: scanned.map((path) => readText(path)).join('\n'),
  };
}

const contract = JSON.parse(readText(contractPath));
const critical = Array.isArray(contract.critical) ? contract.critical : [];
const channelOptional = Array.isArray(contract.channelOptional) ? contract.channelOptional : [];
const warnDefaults = Array.isArray(contract.warnDefaults) ? contract.warnDefaults : [];
const aliases = contract.aliases && typeof contract.aliases === 'object' ? contract.aliases : {};
const aliasKeys = Object.values(aliases).flatMap((value) => (Array.isArray(value) ? value : []));
const allKeys = unique([...critical, ...channelOptional, ...warnDefaults, ...aliasKeys]);
const checks = [];

addCheck(checks, 'runtime-env-contract:shape', critical.length > 0 && channelOptional.length > 0 && warnDefaults.length > 0 ? 'pass' : 'fail', {
  contractPath,
  criticalCount: critical.length,
  channelOptionalCount: channelOptional.length,
  warnDefaultsCount: warnDefaults.length,
});

const duplicates = duplicateValues([...critical, ...channelOptional, ...warnDefaults]);
addCheck(checks, 'runtime-env-contract:no-duplicates', duplicates.length === 0 ? 'pass' : 'fail', {
  duplicates,
});

const secretRegistry = readText(secretRegistryPath);
const missingRegistry = critical.filter((key) => !secretRegistry.includes(`'${key}'`));
addCheck(checks, 'runtime-env-contract:critical-secret-registry', missingRegistry.length === 0 ? 'pass' : 'fail', {
  file: secretRegistryPath,
  missing: missingRegistry,
});

const missingOptionalRegistry = channelOptional
  .concat(aliasKeys)
  .filter((key) => !secretRegistry.includes(`'${key}'`));
addCheck(checks, 'runtime-env-contract:optional-secret-registry', missingOptionalRegistry.length === 0 ? 'pass' : 'fail', {
  file: secretRegistryPath,
  missing: missingOptionalRegistry,
});

const sourceScan = sourceTextForRuntimeRefs();
const missingSourceRefs = allKeys.filter((key) => !sourceScan.text.includes(key));
addCheck(checks, 'runtime-env-contract:source-references', missingSourceRefs.length === 0 ? 'pass' : 'fail', {
  missing: missingSourceRefs,
  scannedFiles: sourceScan.fileCount,
});

const envCheck = readText(envCheckPath);
addCheck(checks, 'runtime-env-contract:env-check-loader', envCheck.includes("runtime-env-readiness.json") && envCheck.includes('WARN_ENV') ? 'pass' : 'fail', {
  file: envCheckPath,
});

const systemHealth = readText(systemHealthPath);
addCheck(checks, 'runtime-env-contract:system-health-surface', systemHealth.includes('checkMissingEnvVars') && systemHealth.includes('env.runtime_readiness') ? 'pass' : 'fail', {
  file: systemHealthPath,
});

const failed = checks.filter((check) => check.status === 'fail');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: checks.length - failed.length,
  failed: failed.length,
  contractPath,
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const detail = Array.isArray(check.missing) && check.missing.length > 0
      ? ` missing=${check.missing.join(', ')}`
      : '';
    console.log(`${check.status.toUpperCase()} ${check.name}${detail}`);
  }
}

if (failed.length > 0) process.exit(1);
