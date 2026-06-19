#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has('--json');
const strict = args.has('--strict');
const selfTest = args.has('--self-test');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

const templateOut = argValue('--template-out', '');
const planOut = argValue('--plan-out', '');
const applyScriptOut = argValue('--apply-script-out', '');
const vercelScriptOut = argValue('--vercel-script-out', '');
const nodeApplyScriptOut = argValue('--node-apply-script-out', '');
const nodeVercelScriptOut = argValue('--node-vercel-script-out', '');
const envFile = argValue('--env-file', process.env.OPERATIONAL_INPUTS_ENV_FILE || '');
const inspectLocalEnvFiles = !args.has('--no-inspect-local-env-files')
  && process.env.OPERATIONAL_INPUTS_INSPECT_LOCAL_ENV_FILES !== '0';
const inspectVercel = args.has('--inspect-vercel')
  || process.env.OPERATIONAL_INPUTS_INSPECT_VERCEL === '1';
const inspectGitHub = args.has('--inspect-github')
  || process.env.OPERATIONAL_INPUTS_INSPECT_GITHUB === '1';
const inspectManagementAuth = args.has('--inspect-management-auth')
  || process.env.OPERATIONAL_INPUTS_INSPECT_MANAGEMENT_AUTH === '1';
const inspectSupabaseSystemSecrets = args.has('--inspect-supabase-system-secrets')
  || process.env.OPERATIONAL_INPUTS_INSPECT_SUPABASE_SYSTEM_SECRETS === '1';
const vercelEnvListFile = argValue(
  '--vercel-env-list-file',
  process.env.OPERATIONAL_INPUTS_VERCEL_ENV_LIST_FILE || '',
);
const githubSecretListFile = argValue(
  '--github-secret-list-file',
  process.env.OPERATIONAL_INPUTS_GITHUB_SECRET_LIST_FILE || '',
);
const githubVariableListFile = argValue(
  '--github-variable-list-file',
  process.env.OPERATIONAL_INPUTS_GITHUB_VARIABLE_LIST_FILE || '',
);
const vercelInspectTimeoutMs = Number(argValue(
  '--vercel-inspect-timeout-ms',
  process.env.OPERATIONAL_INPUTS_VERCEL_INSPECT_TIMEOUT_MS || '15000',
));
const vercelInspectEnvironment = argValue(
  '--vercel-inspect-environment',
  process.env.OPERATIONAL_INPUTS_VERCEL_INSPECT_ENVIRONMENT || 'production',
);
const githubInspectTimeoutMs = Number(argValue(
  '--github-inspect-timeout-ms',
  process.env.OPERATIONAL_INPUTS_GITHUB_INSPECT_TIMEOUT_MS || '15000',
));
const managementAuthInspectTimeoutMs = Number(argValue(
  '--management-auth-inspect-timeout-ms',
  process.env.OPERATIONAL_INPUTS_MANAGEMENT_AUTH_INSPECT_TIMEOUT_MS || '15000',
));
const supabaseSystemSecretsInspectTimeoutMs = Number(argValue(
  '--supabase-system-secrets-inspect-timeout-ms',
  process.env.OPERATIONAL_INPUTS_SUPABASE_SYSTEM_SECRETS_INSPECT_TIMEOUT_MS || '30000',
));
const supabaseSystemSecretsVercelEnv = argValue(
  '--supabase-system-secrets-vercel-env',
  process.env.OPERATIONAL_INPUTS_SUPABASE_SYSTEM_SECRETS_VERCEL_ENV || 'production',
);
const contract = JSON.parse(readFileSync('src/config/runtime-env-readiness.json', 'utf8'));
const keyAliases = contract.aliases && typeof contract.aliases === 'object' ? contract.aliases : {};

const groups = [
  {
    id: 'public-data-probes',
    label: 'Public data probe identifiers',
    severity: 'blocked',
    externalInventorySatisfies: true,
    keys: ['OPEN_CHECK_PACKAGE_ID', 'OPEN_CHECK_REF_CODE'],
    notes: 'Required to verify package detail and referral-link flows against real data.',
  },
  {
    id: 'marketing-dynamic-probes',
    label: 'Marketing dynamic page probe identifiers',
    severity: 'blocked',
    externalInventorySatisfies: true,
    keys: ['MARKETING_CHECK_CARD_NEWS_ID', 'MARKETING_CHECK_VARIANT_GROUP_ID'],
    notes: 'Required to verify card-news editor, V2 studio, content hub, and variant comparison pages against real marketing data.',
  },
  {
    id: 'external-management',
    label: 'External management APIs',
    severity: 'blocked',
    externalInventorySatisfies: true,
    keys: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'VERCEL_TOKEN'],
    notes: 'Required for Supabase auth-open-gate and Vercel error/fatal log verification.',
  },
  {
    id: 'runtime-integrations',
    label: 'Runtime integrations',
    severity: 'blocked',
    externalInventorySatisfies: true,
    keys: contract.critical || [],
    notes: 'Required for search, social, ads, Slack, and cron integrations to leave degraded mode.',
  },
  {
    id: 'optional-channel-integrations',
    label: 'Optional channel integrations',
    severity: 'warn',
    keys: contract.channelOptional || [],
    notes: 'Required only for the corresponding optional publishing, ad-channel, or Slack notification feature to run live.',
  },
  {
    id: 'runtime-defaults',
    label: 'Runtime tunable defaults',
    severity: 'warn',
    keys: contract.warnDefaults || [],
    notes: 'Defaults are safe locally but should be explicit in staging/production.',
  },
  {
    id: 'blog-quality-data',
    label: 'Blog quality data source',
    severity: 'blocked',
    externalInventorySatisfies: true,
    keys: ['BLOG_QUALITY_SOURCE_READY'],
    alternatives: ['SUPABASE_SERVICE_ROLE_KEY'],
    notes: 'Production/staging blog data is required for full render/image/SEO/editorial/GSC quality verification.',
  },
];

const selfTestValues = new Set(
  groups
    .flatMap((group) => [...group.keys, ...(group.alternatives || [])])
    .concat(Object.values(keyAliases).flatMap((value) => (Array.isArray(value) ? value : []))),
);
const allowedEnvFileKeys = new Set(selfTestValues);

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
  const equalIndex = normalized.indexOf('=');
  if (equalIndex <= 0) return null;
  const key = normalized.slice(0, equalIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = normalized.slice(equalIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  value = value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"');
  return [key, value];
}

function isIgnorableEnvLine(line) {
  const trimmed = String(line || '').trim();
  return !trimmed || trimmed.startsWith('#');
}

function envIssueText(values, limit = 8) {
  const visible = values.slice(0, limit);
  const remaining = values.length - visible.length;
  return remaining > 0 ? `${visible.join(', ')} (+${remaining} more)` : visible.join(', ');
}

function inspectAndLoadEnvFile(path) {
  const diagnostics = {
    path: path || '',
    loadedKeys: [],
    unknownKeys: [],
    duplicateKeys: [],
    emptyKeys: [],
    invalidLines: [],
  };
  if (!path) return diagnostics;
  const text = readFileSync(path, 'utf8');
  const seen = new Set();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (isIgnorableEnvLine(line)) continue;
    const entry = parseEnvLine(line);
    if (!entry) {
      diagnostics.invalidLines.push(index + 1);
      continue;
    }
    const [key, value] = entry;
    if (seen.has(key)) diagnostics.duplicateKeys.push(key);
    seen.add(key);
    if (!allowedEnvFileKeys.has(key)) diagnostics.unknownKeys.push(key);
    if (!String(value || '').trim()) diagnostics.emptyKeys.push(key);
    diagnostics.loadedKeys.push(key);
    if (!String(process.env[key] || '').trim()) process.env[key] = value;
  }
  diagnostics.loadedKeys = [...new Set(diagnostics.loadedKeys)].sort();
  diagnostics.unknownKeys = [...new Set(diagnostics.unknownKeys)].sort();
  diagnostics.duplicateKeys = [...new Set(diagnostics.duplicateKeys)].sort();
  diagnostics.emptyKeys = [...new Set(diagnostics.emptyKeys)].sort();
  return diagnostics;
}

const envFileDiagnostics = inspectAndLoadEnvFile(envFile);

function readEnvFileMap(path) {
  if (!path || !existsSync(path)) return {};
  const env = {};
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) continue;
    const [key, value] = entry;
    if (String(value || '').trim()) env[key] = value;
  }
  return env;
}

function allOperationalKeys() {
  const aliasKeys = Object.values(keyAliases)
    .flatMap((value) => (Array.isArray(value) ? value : []));
  return [...new Set(groups.flatMap((group) => [...group.keys, ...(group.alternatives || [])]).concat(aliasKeys))]
    .filter(Boolean)
    .sort();
}

function candidateKeysFor(key) {
  const aliases = Array.isArray(keyAliases[key]) ? keyAliases[key] : [];
  return [...new Set([key, ...aliases])];
}

function candidateLocalEnvFiles() {
  const preferred = [
    '.env.local',
    '.env.development.local',
    '.env.production.local',
    '.env.test.local',
    '.env.prod',
    '.env.croncheck.local',
  ];
  const discovered = readdirSync('.', { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('.env'))
    .map((entry) => entry.name)
    .filter((name) => !/(\.example|\.template)$/i.test(name));
  return [...new Set([...preferred, ...discovered])].filter((path) => existsSync(path));
}

function inspectLocalEnvFileInventory() {
  const keys = allOperationalKeys();
  const keySet = new Set(keys);
  const files = [];
  const keySources = Object.fromEntries(keys.map((key) => [key, []]));
  if (!inspectLocalEnvFiles) {
    return {
      enabled: false,
      files,
      keySources,
      presentKeys: [],
      notes: 'Local env file inspection disabled.',
    };
  }

  for (const path of candidateLocalEnvFiles()) {
    const presentKeys = [];
    const emptyKeys = [];
    const text = readFileSync(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const entry = parseEnvLine(line);
      if (!entry) continue;
      const [key, value] = entry;
      if (!keySet.has(key)) continue;
      if (String(value || '').trim()) {
        presentKeys.push(key);
        keySources[key].push(path);
      } else {
        emptyKeys.push(key);
      }
    }
    if (presentKeys.length > 0 || emptyKeys.length > 0) {
      files.push({
        path,
        presentKeys: [...new Set(presentKeys)].sort(),
        emptyKeys: [...new Set(emptyKeys)].sort(),
      });
    }
  }

  for (const key of keys) keySources[key] = [...new Set(keySources[key])].sort();
  return {
    enabled: true,
    files,
    keySources,
    presentKeys: keys.filter((key) => keySources[key]?.length > 0),
    notes: files.length > 0
      ? 'Local env files were inspected for key names only; secret values are not reported.'
      : 'No local env files with operational keys were found.',
  };
}

function jsonPayloadFromText(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return null;
  const candidates = [
    raw,
    raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1),
    raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1),
  ].filter((candidate) => candidate && candidate.length > 1);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Fall back to the next plausible JSON boundary.
    }
  }
  return null;
}

function parseVercelEnvListDetailed(text) {
  const keys = new Set();
  const sensitiveKeys = new Set();
  const encryptedKeys = new Set();
  const plainKeys = new Set();
  const parsed = jsonPayloadFromText(text);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.envs)
      ? parsed.envs
      : Array.isArray(parsed?.environmentVariables)
        ? parsed.environmentVariables
        : [];
  if (rows.length > 0) {
    for (const row of rows) {
      const key = row?.key || row?.name;
      if (!/^[A-Z][A-Z0-9_]+$/.test(String(key || ''))) continue;
      keys.add(key);
      const type = String(row?.type || row?.value || '').toLowerCase();
      if (type === 'sensitive') sensitiveKeys.add(key);
      else if (type === 'encrypted') encryptedKeys.add(key);
      else if (type) plainKeys.add(key);
    }
    return {
      presentKeys: [...keys].sort(),
      sensitiveKeys: [...sensitiveKeys].sort(),
      encryptedKeys: [...encryptedKeys].sort(),
      plainKeys: [...plainKeys].sort(),
    };
  }

  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^name\s+value\s+environments/i.test(line)) continue;
    if (/^(Retrieving project|Common next commands|> Environment Variables found)/i.test(line)) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]+)\s+(?:Encrypted|Plain|Sensitive|\S+)/);
    if (match) {
      keys.add(match[1]);
      if (/\sSensitive\s/i.test(line)) sensitiveKeys.add(match[1]);
      else if (/\sEncrypted\s/i.test(line)) encryptedKeys.add(match[1]);
      else if (/\sPlain\s/i.test(line)) plainKeys.add(match[1]);
    }
  }
  return {
    presentKeys: [...keys].sort(),
    sensitiveKeys: [...sensitiveKeys].sort(),
    encryptedKeys: [...encryptedKeys].sort(),
    plainKeys: [...plainKeys].sort(),
  };
}

function parseVercelEnvList(text) {
  return parseVercelEnvListDetailed(text).presentKeys;
}

function runVercelEnvList() {
  const commandArgs = ['vercel', 'env', 'ls', vercelInspectEnvironment, '--format', 'json'];
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', ['npx', ...commandArgs].join(' ')], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: vercelInspectTimeoutMs,
      windowsHide: true,
    });
  }
  return spawnSync('npx', commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: vercelInspectTimeoutMs,
    windowsHide: true,
  });
}

function inspectVercelEnvInventory() {
  if (vercelEnvListFile) {
    const text = readFileSync(vercelEnvListFile, 'utf8');
    const parsed = parseVercelEnvListDetailed(text);
    return {
      enabled: true,
      source: vercelEnvListFile,
      status: 'pass',
      presentKeys: parsed.presentKeys,
      sensitiveKeys: parsed.sensitiveKeys,
      encryptedKeys: parsed.encryptedKeys,
      plainKeys: parsed.plainKeys,
      notes: 'Vercel env list file inspected for key names only; secret values are not reported.',
    };
  }
  if (!inspectVercel) {
    return {
      enabled: false,
      source: '',
      status: 'skipped',
      presentKeys: [],
      notes: 'Vercel inspection skipped. Pass --inspect-vercel to distinguish Vercel-present values from truly missing values.',
    };
  }
  if (!Number.isFinite(vercelInspectTimeoutMs) || vercelInspectTimeoutMs <= 0) {
    return {
      enabled: true,
      source: 'vercel env ls',
      status: 'warn',
      presentKeys: [],
      notes: 'OPERATIONAL_INPUTS_VERCEL_INSPECT_TIMEOUT_MS must be a positive number of milliseconds.',
    };
  }

  const result = runVercelEnvList();
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const parsed = parseVercelEnvListDetailed(result.stdout || text);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (result.status !== 0 || result.error) {
    return {
      enabled: true,
      source: 'vercel env ls',
      status: 'warn',
      presentKeys: [],
      timedOut,
      notes: timedOut
        ? `Vercel inspection timed out after ${vercelInspectTimeoutMs}ms.`
        : `Vercel inspection unavailable (${String(result.error?.message || text || 'unknown error').trim().slice(0, 300)}).`,
    };
  }

  return {
    enabled: true,
    source: `vercel env ls ${vercelInspectEnvironment} --format json`,
    status: 'pass',
    presentKeys: parsed.presentKeys,
    sensitiveKeys: parsed.sensitiveKeys,
    encryptedKeys: parsed.encryptedKeys,
    plainKeys: parsed.plainKeys,
    timedOut: false,
    notes: 'Vercel environment variable names, environment scope, and value types were inspected; secret values are not reported. Sensitive values are runtime-available on Vercel but not readable for local CLI sync.',
  };
}

function parseGitHubNameList(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => item?.name)
        .filter((name) => /^[A-Z][A-Z0-9_]+$/.test(String(name || '')))
        .sort();
    }
  } catch {
    // Fall back to the tabular gh output format.
  }
  const keys = new Set();
  for (const rawLine of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^name\s+/i.test(line)) continue;
    const key = line.split(/\s+/)[0];
    if (/^[A-Z][A-Z0-9_]+$/.test(key)) keys.add(key);
  }
  return [...keys].sort();
}

function runGitHubList(kind) {
  return spawnSync('gh', [kind, 'list', '--json', 'name'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: githubInspectTimeoutMs,
    windowsHide: true,
  });
}

function inspectGitHubList(kind, file) {
  if (file) {
    return {
      status: 'pass',
      source: file,
      presentKeys: parseGitHubNameList(readFileSync(file, 'utf8')),
      timedOut: false,
      notes: `GitHub Actions ${kind} list file inspected for key names only; values are not reported.`,
    };
  }

  const result = runGitHubList(kind);
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (result.status !== 0 || result.error) {
    return {
      status: 'warn',
      source: `gh ${kind} list --json name`,
      presentKeys: [],
      timedOut,
      notes: timedOut
        ? `GitHub Actions ${kind} inspection timed out after ${githubInspectTimeoutMs}ms.`
        : `GitHub Actions ${kind} inspection unavailable (${String(result.error?.message || text || 'unknown error').trim().slice(0, 300)}).`,
    };
  }

  return {
    status: 'pass',
    source: `gh ${kind} list --json name`,
    presentKeys: parseGitHubNameList(text),
    timedOut: false,
    notes: `GitHub Actions ${kind} names were inspected; values are not reported.`,
  };
}

function inspectGitHubActionsInventory() {
  if (!inspectGitHub && !githubSecretListFile && !githubVariableListFile) {
    return {
      enabled: false,
      status: 'skipped',
      secrets: {
        status: 'skipped',
        source: '',
        presentKeys: [],
        notes: 'GitHub Actions secret inspection skipped.',
      },
      variables: {
        status: 'skipped',
        source: '',
        presentKeys: [],
        notes: 'GitHub Actions variable inspection skipped.',
      },
      notes: 'GitHub inspection skipped. Pass --inspect-github to distinguish GitHub-present values from truly missing values.',
    };
  }
  if (!Number.isFinite(githubInspectTimeoutMs) || githubInspectTimeoutMs <= 0) {
    return {
      enabled: true,
      status: 'warn',
      secrets: {
        status: 'warn',
        source: 'gh secret list --json name',
        presentKeys: [],
        notes: 'OPERATIONAL_INPUTS_GITHUB_INSPECT_TIMEOUT_MS must be a positive number of milliseconds.',
      },
      variables: {
        status: 'warn',
        source: 'gh variable list --json name',
        presentKeys: [],
        notes: 'OPERATIONAL_INPUTS_GITHUB_INSPECT_TIMEOUT_MS must be a positive number of milliseconds.',
      },
      notes: 'OPERATIONAL_INPUTS_GITHUB_INSPECT_TIMEOUT_MS must be a positive number of milliseconds.',
    };
  }

  const secrets = inspectGitHubList('secret', githubSecretListFile);
  const variables = inspectGitHubList('variable', githubVariableListFile);
  return {
    enabled: true,
    status: secrets.status === 'pass' && variables.status === 'pass' ? 'pass' : 'warn',
    secrets,
    variables,
    notes: 'GitHub Actions secret and variable names were inspected; values are not reported.',
  };
}

function runNpx(commandArgs, timeoutMs) {
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', ['npx', ...commandArgs].join(' ')], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      windowsHide: true,
    });
  }
  return spawnSync('npx', commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  });
}

function inspectLocalManagementAuthInventory() {
  if (!inspectManagementAuth) {
    return {
      enabled: false,
      status: 'skipped',
      presentSources: [],
      checks: [],
      notes: 'Local management auth inspection skipped. Pass --inspect-management-auth to distinguish local CLI auth from missing management tokens.',
    };
  }
  if (!Number.isFinite(managementAuthInspectTimeoutMs) || managementAuthInspectTimeoutMs <= 0) {
    return {
      enabled: true,
      status: 'warn',
      presentSources: [],
      checks: [],
      notes: 'OPERATIONAL_INPUTS_MANAGEMENT_AUTH_INSPECT_TIMEOUT_MS must be a positive number of milliseconds.',
    };
  }

  const checks = [];
  const presentSources = [];

  const vercel = runNpx(['vercel', 'whoami'], managementAuthInspectTimeoutMs);
  const vercelTimedOut = vercel.error?.code === 'ETIMEDOUT';
  if (vercel.status === 0 && !vercel.error) {
    presentSources.push('local-vercel-cli-auth');
    checks.push({ name: 'vercel-cli-auth', status: 'pass', timedOut: false });
  } else {
    checks.push({
      name: 'vercel-cli-auth',
      status: 'warn',
      timedOut: vercelTimedOut,
      notes: vercelTimedOut
        ? `Vercel CLI auth inspection timed out after ${managementAuthInspectTimeoutMs}ms.`
        : 'Vercel CLI is not authenticated for local management checks.',
    });
  }

  const supabase = runNpx(['supabase', 'projects', 'list', '--output', 'json'], managementAuthInspectTimeoutMs);
  const supabaseTimedOut = supabase.error?.code === 'ETIMEDOUT';
  if (supabase.status === 0 && !supabase.error) {
    presentSources.push('local-supabase-cli-auth');
    checks.push({ name: 'supabase-cli-auth', status: 'pass', timedOut: false });
  } else {
    checks.push({
      name: 'supabase-cli-auth',
      status: 'warn',
      timedOut: supabaseTimedOut,
      notes: supabaseTimedOut
        ? `Supabase CLI auth inspection timed out after ${managementAuthInspectTimeoutMs}ms.`
        : 'Supabase CLI is not authenticated for local management checks.',
    });
  }

  return {
    enabled: true,
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'warn',
    presentSources,
    checks,
    notes: 'Local management CLI auth was inspected without reporting token values.',
  };
}

function nonEmptyEnvValue(env, ...keys) {
  for (const key of keys) {
    const value = env?.[key] ?? process.env[key];
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
}

function supabaseConnectionFromEnv(env) {
  const url = nonEmptyEnvValue(env, 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const serviceRoleKey = nonEmptyEnvValue(env, 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url, serviceRoleKey };
}

function hasSupabaseConnection(env) {
  const connection = supabaseConnectionFromEnv(env);
  return Boolean(connection.url && connection.serviceRoleKey);
}

function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), supabaseSystemSecretsInspectTimeoutMs);
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function pullVercelEnvForSupabaseSystemSecrets() {
  const tempPath = resolve('.tmp', `operational-supabase-system-secrets-${process.pid}.env`);
  mkdirSync(dirname(tempPath), { recursive: true });
  try {
    const result = runNpx([
      'vercel',
      'env',
      'pull',
      tempPath,
      '--environment',
      supabaseSystemSecretsVercelEnv,
      '--yes',
    ], supabaseSystemSecretsInspectTimeoutMs);
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const timedOut = result.error?.code === 'ETIMEDOUT';
    if (result.status !== 0 || result.error) {
      return {
        status: 'warn',
        env: {},
        timedOut,
        notes: timedOut
          ? `Vercel env pull timed out after ${supabaseSystemSecretsInspectTimeoutMs}ms.`
          : `Vercel env pull unavailable (${String(result.error?.message || text || 'unknown error').trim().slice(0, 300)}).`,
      };
    }
    return {
      status: 'pass',
      env: readEnvFileMap(tempPath),
      timedOut: false,
      notes: `Pulled Vercel ${supabaseSystemSecretsVercelEnv} env for Supabase system_secrets inspection.`,
    };
  } finally {
    rmSync(tempPath, { force: true });
  }
}

async function inspectSupabaseSystemSecretsInventory() {
  if (!inspectSupabaseSystemSecrets) {
    return {
      enabled: false,
      source: '',
      status: 'skipped',
      presentKeys: [],
      notes: 'Supabase system_secrets inspection skipped. Pass --inspect-supabase-system-secrets to include DB-stored runtime tokens in source inventory.',
    };
  }
  if (!Number.isFinite(supabaseSystemSecretsInspectTimeoutMs) || supabaseSystemSecretsInspectTimeoutMs <= 0) {
    return {
      enabled: true,
      source: 'system_secrets',
      status: 'warn',
      presentKeys: [],
      notes: 'OPERATIONAL_INPUTS_SUPABASE_SYSTEM_SECRETS_INSPECT_TIMEOUT_MS must be a positive number of milliseconds.',
    };
  }

  let env = {
    ...readEnvFileMap(envFile),
  };
  let source = envFile ? `${envFile} + process.env` : 'process.env';
  let pullNotes = '';
  if (!hasSupabaseConnection(env) && inspectVercel) {
    const pull = pullVercelEnvForSupabaseSystemSecrets();
    pullNotes = pull.status === 'pass' ? '' : pull.notes;
    if (pull.status === 'pass') {
      env = { ...env, ...pull.env };
      source = `Vercel ${supabaseSystemSecretsVercelEnv} env`;
    }
  }

  const connection = supabaseConnectionFromEnv(env);
  const missingConnection = [
    !connection.url ? 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL' : '',
    !connection.serviceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY' : '',
  ].filter(Boolean);
  if (missingConnection.length > 0) {
    return {
      enabled: true,
      source,
      status: 'warn',
      presentKeys: [],
      missingConnection,
      notes: [
        `Supabase system_secrets inspection unavailable until ${missingConnection.join(', ')} is available.`,
        pullNotes,
      ].filter(Boolean).join(' '),
    };
  }

  try {
    const supabase = createClient(connection.url, connection.serviceRoleKey, {
      auth: { persistSession: false },
      global: {
        fetch: fetchWithTimeout,
        headers: { 'x-application-name': 'operational-readiness-inputs' },
      },
    });
    const { data, error } = await supabase
      .from('system_secrets')
      .select('key')
      .in('key', allOperationalKeys());
    if (error) {
      return {
        enabled: true,
        source,
        status: 'warn',
        presentKeys: [],
        notes: `Supabase system_secrets inspection failed (${String(error.message || 'unknown error').slice(0, 300)}).`,
      };
    }
    return {
      enabled: true,
      source: `system_secrets via ${source}`,
      status: 'pass',
      presentKeys: [...new Set((data || [])
        .map((row) => row?.key)
        .filter((key) => /^[A-Z][A-Z0-9_]+$/.test(String(key || ''))))]
        .sort(),
      notes: 'Supabase system_secrets key names were inspected; secret values are not reported.',
    };
  } catch (err) {
    return {
      enabled: true,
      source,
      status: 'warn',
      presentKeys: [],
      notes: `Supabase system_secrets inspection unavailable (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

const localEnvInventory = inspectLocalEnvFileInventory();
const vercelEnvInventory = inspectVercelEnvInventory();
const githubActionsInventory = inspectGitHubActionsInventory();
const localManagementAuthInventory = inspectLocalManagementAuthInventory();
const supabaseSystemSecretsInventory = await inspectSupabaseSystemSecretsInventory();
const vercelEnvKeySet = new Set(vercelEnvInventory.presentKeys || []);
const githubSecretKeySet = new Set(githubActionsInventory.secrets?.presentKeys || []);
const githubVariableKeySet = new Set(githubActionsInventory.variables?.presentKeys || []);
const githubActionsKeySet = new Set([...githubSecretKeySet, ...githubVariableKeySet]);
const localManagementAuthSourceSet = new Set(localManagementAuthInventory.presentSources || []);
const supabaseSystemSecretsKeySet = new Set(supabaseSystemSecretsInventory.presentKeys || []);

function hasValue(key) {
  if (selfTest && selfTestValues.has(key)) return true;
  return candidateKeysFor(key).some((candidate) => (
    typeof process.env[candidate] === 'string' && process.env[candidate].trim() !== ''
  ));
}

function localEnvFilesFor(key) {
  return localEnvInventory.keySources?.[key] || [];
}

function githubActionsStoresFor(key) {
  const stores = [];
  if (githubSecretKeySet.has(key)) stores.push('secret');
  if (githubVariableKeySet.has(key)) stores.push('variable');
  return stores;
}

function directKnownExternalSourcesFor(key) {
  const sources = [];
  if (localEnvFilesFor(key).length > 0) sources.push('local-env-file');
  if (vercelEnvKeySet.has(key)) sources.push('vercel');
  if (githubSecretKeySet.has(key)) sources.push('github-actions-secret');
  if (githubVariableKeySet.has(key)) sources.push('github-actions-variable');
  if (supabaseSystemSecretsKeySet.has(key)) sources.push('supabase-system-secrets');
  if (key === 'SUPABASE_ACCESS_TOKEN' && localManagementAuthSourceSet.has('local-supabase-cli-auth')) {
    sources.push('local-supabase-cli-auth');
  }
  if (key === 'VERCEL_TOKEN' && localManagementAuthSourceSet.has('local-vercel-cli-auth')) {
    sources.push('local-vercel-cli-auth');
  }
  if (
    key === 'SUPABASE_PROJECT_REF' &&
    (vercelEnvKeySet.has('SUPABASE_URL') || vercelEnvKeySet.has('NEXT_PUBLIC_SUPABASE_URL'))
  ) {
    sources.push('vercel-derived-supabase-url');
  }
  return sources;
}

function knownExternalSourcesFor(key) {
  const sources = [];
  for (const candidate of candidateKeysFor(key)) {
    for (const source of directKnownExternalSourcesFor(candidate)) {
      sources.push(candidate === key ? source : `${source}:${candidate}`);
    }
  }
  return [...new Set(sources)];
}

function configuredSourcesFor(key) {
  return knownExternalSourcesFor(key).filter((source) => !source.startsWith('local-env-file'));
}

function externallyAvailableKeys(keys) {
  return keys.filter((key) => configuredSourcesFor(key).length > 0);
}

function summarizeGroup(group) {
  const missingInCurrentProcess = group.keys.filter((key) => !hasValue(key));
  const alternativeSatisfied = Array.isArray(group.alternatives)
    && group.alternatives.some((key) => hasValue(key));
  const effectiveMissing = alternativeSatisfied ? [] : missingInCurrentProcess;
  const externallySatisfiedAlternatives = externallyAvailableKeys(group.alternatives || []);
  const externalAlternativeSatisfied = externallySatisfiedAlternatives.length > 0 && effectiveMissing.length > 0;
  const availableInLocalEnvFiles = effectiveMissing
    .filter((key) => candidateKeysFor(key).some((candidate) => localEnvFilesFor(candidate).length > 0))
    .map((key) => ({
      key,
      files: [...new Set(candidateKeysFor(key).flatMap((candidate) => localEnvFilesFor(candidate)))].sort(),
    }));
  const availableInVercel = effectiveMissing.filter((key) => candidateKeysFor(key).some((candidate) => vercelEnvKeySet.has(candidate)));
  const availableInGitHubActions = effectiveMissing
    .filter((key) => candidateKeysFor(key).some((candidate) => githubActionsKeySet.has(candidate)))
    .map((key) => ({
      key,
      stores: [...new Set(candidateKeysFor(key).flatMap((candidate) => githubActionsStoresFor(candidate)))],
    }));
  const availableInSupabaseSystemSecrets = effectiveMissing.filter((key) => candidateKeysFor(key).some((candidate) => supabaseSystemSecretsKeySet.has(candidate)));
  const availableByInference = effectiveMissing
    .map((key) => ({
      key,
      sources: knownExternalSourcesFor(key).filter((source) => ![
        'local-env-file',
        'vercel',
        'github-actions-secret',
        'github-actions-variable',
        'supabase-system-secrets',
      ].includes(source)),
    }))
    .filter((item) => item.sources.length > 0);
  const rawMissingEverywhereKnown = effectiveMissing
    .filter((key) => knownExternalSourcesFor(key).length === 0);
  const missingEverywhereKnown = externalAlternativeSatisfied ? [] : rawMissingEverywhereKnown;
  const missingAfterInspectedSources = effectiveMissing
    .filter((key) => configuredSourcesFor(key).length === 0);
  const actionRequiredMissing = externalAlternativeSatisfied
    ? []
    : missingAfterInspectedSources;
  const sourceSatisfiedMissing = effectiveMissing
    .filter((key) => !actionRequiredMissing.includes(key));
  const sourceInventoryCoversMissing = effectiveMissing.length > 0
    && actionRequiredMissing.length === 0;
  const status = effectiveMissing.length === 0
    ? 'pass'
    : sourceInventoryCoversMissing
      ? 'pass'
      : group.severity;
  const sourceNote = effectiveMissing.length > 0 && (
    availableInLocalEnvFiles.length > 0 ||
    availableInVercel.length > 0 ||
    availableInGitHubActions.length > 0 ||
    availableInSupabaseSystemSecrets.length > 0 ||
    availableByInference.length > 0 ||
    externallySatisfiedAlternatives.length > 0 ||
    vercelEnvInventory.status === 'warn' ||
    githubActionsInventory.status === 'warn' ||
    localManagementAuthInventory.status === 'warn'
  )
    ? ` Source inventory: ${[
      availableInVercel.length > 0
        ? `present in Vercel (${availableInVercel.join(', ')})`
        : '',
      availableInGitHubActions.length > 0
        ? `present in GitHub Actions (${availableInGitHubActions.map((item) => `${item.key}: ${item.stores.join('+')}`).join('; ')})`
        : '',
      availableInSupabaseSystemSecrets.length > 0
        ? `present in Supabase system_secrets (${availableInSupabaseSystemSecrets.join(', ')})`
        : '',
      availableInLocalEnvFiles.length > 0
        ? `present in local env files (${availableInLocalEnvFiles.map((item) => `${item.key}: ${item.files.join(', ')}`).join('; ')})`
        : '',
      availableByInference.length > 0
        ? `available by inference (${availableByInference.map((item) => `${item.key}: ${item.sources.join(', ')}`).join('; ')})`
        : '',
      externallySatisfiedAlternatives.length > 0
        ? `accepted alternative present in inspected sources (${externallySatisfiedAlternatives.join(', ')})`
        : '',
      missingEverywhereKnown.length > 0
        ? `not found in inspected sources (${missingEverywhereKnown.join(', ')})`
        : '',
      vercelEnvInventory.status === 'warn' ? vercelEnvInventory.notes : '',
      githubActionsInventory.status === 'warn' ? githubActionsInventory.notes : '',
      localManagementAuthInventory.status === 'warn' ? localManagementAuthInventory.notes : '',
      supabaseSystemSecretsInventory.status === 'warn' ? supabaseSystemSecretsInventory.notes : '',
    ].filter(Boolean).join(' ')}`
    : '';
  return {
    id: group.id,
    label: group.label,
    status,
    severity: group.severity,
    missing: actionRequiredMissing,
    missingInCurrentProcess,
    runtimeInjectionNeeded: effectiveMissing,
    sourceSatisfiedMissing,
    missingEverywhereKnown,
    present: group.keys.filter(hasValue),
    availableInLocalEnvFiles,
    availableInVercel,
    availableInGitHubActions,
    availableInSupabaseSystemSecrets,
    availableByInference,
    externallySatisfiedAlternatives,
    alternatives: group.alternatives || [],
    notes: `${group.notes}${sourceNote}`,
  };
}

function summarizeEnvFileQuality(diagnostics) {
  if (!diagnostics.path) return null;
  const issueParts = [];
  if (diagnostics.unknownKeys.length > 0) {
    issueParts.push(`unknown keys: ${envIssueText(diagnostics.unknownKeys)}`);
  }
  if (diagnostics.duplicateKeys.length > 0) {
    issueParts.push(`duplicate keys: ${envIssueText(diagnostics.duplicateKeys)}`);
  }
  if (diagnostics.emptyKeys.length > 0) {
    issueParts.push(`empty values: ${envIssueText(diagnostics.emptyKeys)}`);
  }
  if (diagnostics.invalidLines.length > 0) {
    issueParts.push(`invalid lines: ${envIssueText(diagnostics.invalidLines.map(String))}`);
  }
  return {
    id: 'env-file-quality',
    label: 'Operational env file quality',
    status: issueParts.length > 0 ? 'warn' : 'pass',
    severity: 'warn',
    missing: [],
    present: diagnostics.loadedKeys,
    alternatives: [],
    notes: issueParts.length > 0
      ? `Env file parsed with warnings (${issueParts.join('; ')}).`
      : 'Env file parsed cleanly.',
    envFilePath: diagnostics.path,
    unknownKeys: diagnostics.unknownKeys,
    duplicateKeys: diagnostics.duplicateKeys,
    emptyKeys: diagnostics.emptyKeys,
    invalidLines: diagnostics.invalidLines,
  };
}

function ensureParent(path) {
  if (!path) return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

function writeTemplate(path, checks) {
  if (!path) return;
  const keys = [...new Set(checks.flatMap((check) => (
    check.missing.length > 0 ? [...check.missing, ...check.alternatives] : []
  )))]
    .filter(Boolean)
    .sort();
  const lines = [
    '# Operational readiness inputs generated by verify-operational-readiness-inputs.mjs',
    '# Fill these in staging/production secrets or GitHub Actions variables as appropriate.',
    '',
    ...keys.map((key) => `${key}=`),
    '',
  ];
  ensureParent(path);
  writeFileSync(path, lines.join('\n'));
}

function preferredTarget(key) {
  if (
    /(_TOKEN|_SECRET|_KEY|WEBHOOK|CRON_SECRET|SERVICE_ROLE)/.test(key) ||
    key === 'VERCEL_TOKEN'
  ) {
    return 'GitHub Actions secret';
  }
  if (
    key.startsWith('OPEN_CHECK_') ||
    key.startsWith('AD_') ||
    key === 'BLOG_QUALITY_SOURCE_READY' ||
    key === 'SUPABASE_PROJECT_REF' ||
    key.endsWith('_ID') ||
    key.endsWith('_URL')
  ) {
    return 'GitHub Actions variable';
  }
  return 'GitHub Actions secret or variable';
}

function targetKind(key) {
  const target = preferredTarget(key);
  if (target === 'GitHub Actions secret') return 'secret';
  if (target === 'GitHub Actions variable') return 'variable';
  return 'manual';
}

function tableCell(value) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function renderKeyRows(keys) {
  return keys.map((key) => `| \`${key}\` | ${preferredTarget(key)} |`).join('\n');
}

function renderLocalEnvSourceRows(items) {
  return items
    .map((item) => `| \`${item.key}\` | ${item.files.map((file) => `\`${file}\``).join(', ')} |`)
    .join('\n');
}

function renderGitHubActionsRows(items) {
  return items
    .map((item) => `| \`${item.key}\` | ${item.stores.map((store) => `GitHub Actions ${store}`).join(', ')} |`)
    .join('\n');
}

function writeActionPlan(path, report) {
  if (!path) return;
  const attentionChecks = report.checks.filter((check) => check.status === 'blocked' || check.status === 'warn');
  const envFileSuffix = templateOut ? ` --env-file=${templateOut}` : '';
  const lines = [
    '# Operational Readiness Action Plan',
    '',
    `Status: **${report.status}**`,
    '',
    `Passed: ${report.passed} / Blocked: ${report.blocked} / Warnings: ${report.warnings}`,
    '',
  ];

  if (attentionChecks.length === 0) {
    lines.push('No missing operational inputs were detected.', '');
  } else {
    lines.push('## Required Follow-Up', '');
    for (const check of attentionChecks) {
      lines.push(`### ${check.label} (${check.id})`, '');
      lines.push(`Status: **${check.status}**`, '');
      lines.push(`Why: ${tableCell(check.notes)}`, '');
      if (check.alternatives.length > 0) {
        lines.push(`Accepted alternative(s): ${check.alternatives.map((key) => `\`${key}\``).join(', ')}`, '');
      }
      if (check.missing.length > 0) {
        lines.push('| Input | Preferred location |', '| --- | --- |', renderKeyRows(check.missing), '');
      }
      if (check.availableInVercel?.length > 0) {
        lines.push(
          'Already present in Vercel, but not loaded into this verification run:',
          '',
          check.availableInVercel.map((key) => `- \`${key}\``).join('\n'),
          '',
        );
      }
      if (check.availableInGitHubActions?.length > 0) {
        lines.push(
          'Already present in GitHub Actions, but not loaded into this verification run:',
          '',
          '| Input | GitHub store |',
          '| --- | --- |',
          renderGitHubActionsRows(check.availableInGitHubActions),
          '',
        );
      }
      if (check.availableInSupabaseSystemSecrets?.length > 0) {
        lines.push(
          'Already present in Supabase system_secrets, but not loaded into this verification run:',
          '',
          check.availableInSupabaseSystemSecrets.map((key) => `- \`${key}\``).join('\n'),
          '',
        );
      }
      if (check.availableInLocalEnvFiles?.length > 0) {
        lines.push(
          'Already present in local env files, but not loaded into this verification run:',
          '',
          '| Input | Local file(s) |',
          '| --- | --- |',
          renderLocalEnvSourceRows(check.availableInLocalEnvFiles),
          '',
        );
      }
      if (check.availableByInference?.length > 0) {
        lines.push(
          'Available by inspected-source inference:',
          '',
          check.availableByInference
            .map((item) => `- \`${item.key}\` via ${item.sources.join(', ')}`)
            .join('\n'),
          '',
        );
      }
      if (check.missingEverywhereKnown?.length > 0) {
        lines.push(
          'Not found in inspected sources:',
          '',
          check.missingEverywhereKnown.map((key) => `- \`${key}\``).join('\n'),
          '',
        );
      }
    }
  }

  lines.push(
    '## Apply Order',
    '',
    '1. If Supabase service-role credentials are available, run `npm run discover:operational-inputs -- --json --out=.tmp/operational-readiness-discovered.env` to auto-fill non-secret probe identifiers.',
    '2. Add secrets under the target GitHub/Vercel environment secrets.',
    '3. Add remaining non-secret identifiers and tunables under GitHub Actions variables or Vercel environment variables.',
    nodeApplyScriptOut
      ? `4. Fill the generated template and run \`node ${nodeApplyScriptOut}${envFileSuffix}\`, or export the missing values locally.`
      : applyScriptOut
        ? `4. Run \`bash ${applyScriptOut}\` after exporting the missing values locally.`
        : '4. Apply the generated fill-in template values.',
    nodeVercelScriptOut
      ? `5. Run \`node ${nodeVercelScriptOut}${envFileSuffix}\` to apply missing runtime values to Vercel production/preview environments.`
      : vercelScriptOut
        ? `5. Run \`bash ${vercelScriptOut}\` to apply missing runtime values to Vercel production/preview environments.`
      : '5. Apply missing runtime values to Vercel production/preview environments.',
    '6. Re-run `npm run verify:operational-inputs -- --json`.',
    '7. Re-run `npm run verify:local-release -- --json` before promotion.',
    '',
  );

  ensureParent(path);
  writeFileSync(path, lines.join('\n'));
}

function scriptSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function bashEnvFileLoaderLines() {
  return [
    'env_file="${OPERATIONAL_INPUTS_ENV_FILE:-}"',
    'while [[ "$#" -gt 0 ]]; do',
    '  case "$1" in',
    '    --env-file=*) env_file="${1#*=}" ;;',
    '    --env-file) shift; env_file="${1:-}" ;;',
    '    *) ;;',
    '  esac',
    '  shift || true',
    'done',
    '',
    'load_env_file() {',
    '  local file="$1"',
    '  [[ -z "$file" ]] && return 0',
    '  if [[ ! -f "$file" ]]; then',
    '    echo "Env file not found: $file" >&2',
    '    exit 3',
    '  fi',
    '  local line key value',
    '  while IFS= read -r line || [[ -n "$line" ]]; do',
    '    line="${line#"${line%%[![:space:]]*}"}"',
    '    line="${line%"${line##*[![:space:]]}"}"',
    '    [[ -z "$line" || "$line" == \\#* ]] && continue',
    '    [[ "$line" == export\\ * ]] && line="${line#export }"',
    '    [[ "$line" != *=* ]] && continue',
    '    key="${line%%=*}"',
    '    value="${line#*=}"',
    '    key="${key//[[:space:]]/}"',
    '    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue',
    '    value="${value#"${value%%[![:space:]]*}"}"',
    '    value="${value%"${value##*[![:space:]]}"}"',
    '    if [[ "$value" == \\"*\\" && "$value" == *\\" ]]; then',
    '      value="${value:1:${#value}-2}"',
    "    elif [[ \"$value\" == \\'*\\' && \"$value\" == *\\' ]]; then",
    '      value="${value:1:${#value}-2}"',
    '    fi',
    '    if [[ -z "${!key:-}" ]]; then',
    '      printf -v "$key" "%s" "$value"',
    '      export "$key"',
    '    fi',
    '  done < "$file"',
    '}',
    '',
    'load_env_file "$env_file"',
    '',
  ];
}

function requiredKeysForApply(checks) {
  return [...new Set(checks.flatMap((check) => check.missing))]
    .filter(Boolean)
    .sort();
}

function writeApplyScript(path, checks) {
  if (!path) return;
  const keys = requiredKeysForApply(checks);
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    '# Generated by verify-operational-readiness-inputs.mjs.',
    '# Export each missing value in your shell first, then run this script from the repo root.',
    '# Or pass --env-file=<filled-template> / OPERATIONAL_INPUTS_ENV_FILE=<filled-template>.',
    '# Set OPERATIONAL_APPLY_DRY_RUN=1 to print the commands without applying changes.',
    '# Example: OPEN_CHECK_PACKAGE_ID=... OPEN_CHECK_REF_CODE=... bash .tmp/operational-readiness-apply-inputs.sh',
    '',
    'dry_run="${OPERATIONAL_APPLY_DRY_RUN:-${DRY_RUN:-}}"',
    ...bashEnvFileLoaderLines(),
    'missing=0',
  ];

  for (const key of keys) {
    lines.push(
      `if [[ -z "\${${key}:-}" ]]; then`,
      `  echo "Missing environment value: ${key}" >&2`,
      '  missing=1',
      'fi',
    );
  }

  lines.push(
    'if [[ "$missing" -ne 0 ]]; then',
    '  exit 2',
    'fi',
    '',
    'if [[ "$dry_run" =~ ^(1|true|TRUE|yes|YES)$ ]]; then',
    '  echo "Dry-run enabled; commands will be printed without applying changes."',
    'elif ! command -v gh >/dev/null 2>&1; then',
    '  echo "GitHub CLI (gh) is required to apply GitHub Actions secrets and variables." >&2',
    '  exit 1',
    'fi',
    '',
  );

  for (const key of keys) {
    const kind = targetKind(key);
    if (kind === 'secret') {
      lines.push(
        'if [[ "$dry_run" =~ ^(1|true|TRUE|yes|YES)$ ]]; then',
        `  echo "DRY-RUN gh secret set ${key} --body <redacted>"`,
        'else',
        `  gh secret set ${scriptSingleQuote(key)} --body "\${${key}}"`,
        'fi',
      );
    } else if (kind === 'variable') {
      lines.push(
        'if [[ "$dry_run" =~ ^(1|true|TRUE|yes|YES)$ ]]; then',
        `  echo "DRY-RUN gh variable set ${key} --body <redacted>"`,
        'else',
        `  gh variable set ${scriptSingleQuote(key)} --body "\${${key}}"`,
        'fi',
      );
    } else {
      lines.push(`# ${key}: review manually; preferred location is ${preferredTarget(key)}.`);
    }
  }

  lines.push(
    '',
    'echo "Operational readiness inputs applied to GitHub Actions configuration."',
    'echo "Re-run: npm run verify:operational-inputs -- --json"',
    '',
  );

  ensureParent(path);
  writeFileSync(path, lines.join('\n'));
  try {
    chmodSync(path, 0o755);
  } catch {
    // The script can still be executed with `bash <path>` on filesystems that ignore chmod.
  }
}

function nodeScriptComment(value) {
  return String(value).replace(/\*\//g, '* /');
}

function nodeEnvFileLoaderLines() {
  return [
    'function argValue(name) {',
    '  const argv = process.argv.slice(2);',
    '  const prefix = `${name}=`;',
    '  const inline = argv.find((arg) => arg.startsWith(prefix));',
    '  if (inline) return inline.slice(prefix.length);',
    '  const index = argv.indexOf(name);',
    '  return index >= 0 ? argv[index + 1] || "" : "";',
    '}',
    '',
    'function parseEnvLine(line) {',
    '  const trimmed = String(line || "").trim();',
    '  if (!trimmed || trimmed.startsWith("#")) return null;',
    '  const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trimStart() : trimmed;',
    '  const equalIndex = normalized.indexOf("=");',
    '  if (equalIndex <= 0) return null;',
    '  const key = normalized.slice(0, equalIndex).trim();',
    '  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;',
    '  let value = normalized.slice(equalIndex + 1).trim();',
    '  if ((value.startsWith("\\"") && value.endsWith("\\"")) || (value.startsWith("\'") && value.endsWith("\'"))) {',
    '    value = value.slice(1, -1);',
    '  }',
    '  value = value.replace(/\\\\n/g, "\\n").replace(/\\\\r/g, "\\r").replace(/\\\\"/g, "\\"");',
    '  return [key, value];',
    '}',
    '',
    'function loadEnvFile(path) {',
    '  if (!path) return;',
    '  const text = readFileSync(path, "utf8");',
    '  for (const line of text.split(/\\r?\\n/)) {',
    '    const entry = parseEnvLine(line);',
    '    if (!entry) continue;',
    '    const [key, value] = entry;',
    '    if (!String(process.env[key] || "").trim()) process.env[key] = value;',
    '  }',
    '}',
    '',
    'loadEnvFile(argValue("--env-file") || process.env.OPERATIONAL_INPUTS_ENV_FILE || "");',
    '',
  ];
}

function writeNodeApplyScript(path, checks) {
  if (!path) return;
  const keys = requiredKeysForApply(checks);
  const actions = keys.map((key) => ({
    key,
    kind: targetKind(key),
    preferredTarget: preferredTarget(key),
  }));
  const lines = [
    '#!/usr/bin/env node',
    '',
    "import { spawnSync } from 'node:child_process';",
    "import { readFileSync } from 'node:fs';",
    '',
    '/*',
    ' * Generated by verify-operational-readiness-inputs.mjs.',
    ' * Export each missing value in your shell first, then run this script from the repo root.',
    ' * Or pass --env-file=<filled-template> / OPERATIONAL_INPUTS_ENV_FILE=<filled-template>.',
    ' * Set OPERATIONAL_APPLY_DRY_RUN=1 to print the commands without applying changes.',
    ` * Example: OPEN_CHECK_PACKAGE_ID=... OPEN_CHECK_REF_CODE=... node ${nodeScriptComment(path)}`,
    ' */',
    '',
    `const actions = ${JSON.stringify(actions, null, 2)};`,
    'const dryRun = /^(1|true|yes)$/i.test(process.env.OPERATIONAL_APPLY_DRY_RUN || process.env.DRY_RUN || "");',
    'const commandTimeoutMs = Number(process.env.OPERATIONAL_APPLY_COMMAND_TIMEOUT_MS || "120000");',
    'if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {',
    '  console.error("OPERATIONAL_APPLY_COMMAND_TIMEOUT_MS must be a positive number of milliseconds.");',
    '  process.exit(2);',
    '}',
    '',
    ...nodeEnvFileLoaderLines(),
    'function run(command, args) {',
    '  const attempts = process.platform === "win32" && !/\\.(cmd|exe|bat)$/i.test(command)',
    '    ? [command, `${command}.cmd`, `${command}.exe`]',
    '    : [command];',
    '  let last;',
    '  for (const candidate of attempts) {',
    '    const result = spawnSync(candidate, args, { stdio: "inherit", windowsHide: true, timeout: commandTimeoutMs });',
    '    last = result;',
    '    if (!result.error || result.error.code !== "ENOENT") {',
    '      if (result.error?.code === "ETIMEDOUT") {',
    '        console.error(`Command timed out after ${commandTimeoutMs}ms: ${command}`);',
    '        process.exit(124);',
    '      }',
    '      if (result.status !== 0) process.exit(result.status ?? 1);',
    '      return;',
    '    }',
    '  }',
    '  console.error(`Command not found: ${command}`);',
    '  if (last?.error) console.error(last.error.message);',
    '  process.exit(1);',
    '}',
    '',
    'const missing = actions.filter((action) => !String(process.env[action.key] || "").trim());',
    'if (missing.length > 0) {',
    '  for (const action of missing) console.error(`Missing environment value: ${action.key}`);',
    '  process.exit(2);',
    '}',
    '',
    'for (const action of actions) {',
    '  const value = process.env[action.key];',
    '  if (action.kind === "secret") {',
    '    if (dryRun) console.log(`DRY-RUN gh secret set ${action.key} --body <redacted>`);',
    '    else run("gh", ["secret", "set", action.key, "--body", value]);',
    '  } else if (action.kind === "variable") {',
    '    if (dryRun) console.log(`DRY-RUN gh variable set ${action.key} --body <redacted>`);',
    '    else run("gh", ["variable", "set", action.key, "--body", value]);',
    '  } else {',
    '    console.warn(`Manual review required for ${action.key}: ${action.preferredTarget}`);',
    '  }',
    '}',
    '',
    'console.log("Operational readiness inputs applied to GitHub Actions configuration.");',
    'console.log("Re-run: npm run verify:operational-inputs -- --json");',
    '',
  ];

  ensureParent(path);
  writeFileSync(path, lines.join('\n'));
  try {
    chmodSync(path, 0o755);
  } catch {
    // The script can still be executed with `node <path>` on filesystems that ignore chmod.
  }
}

function runtimeVercelKeysForApply(checks) {
  const runtimeCheckIds = new Set(['runtime-integrations', 'runtime-defaults']);
  return [...new Set(checks
    .filter((check) => runtimeCheckIds.has(check.id))
    .flatMap((check) => check.missing))]
    .filter(Boolean)
    .sort();
}

function writeVercelScript(path, checks) {
  if (!path) return;
  const keys = runtimeVercelKeysForApply(checks);
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    '# Generated by verify-operational-readiness-inputs.mjs.',
    '# Export each missing runtime value in your shell first, then run this script from the repo root.',
    '# Applies values with: vercel env add <name> <environment> --value <value> --yes --force.',
    '# Or pass --env-file=<filled-template> / OPERATIONAL_INPUTS_ENV_FILE=<filled-template>.',
    '# Set OPERATIONAL_APPLY_DRY_RUN=1 to print the commands without applying changes.',
    '# Optional: set VERCEL_ENV_TARGETS="production preview", VERCEL_TOKEN, VERCEL_SCOPE, or VERCEL_PROJECT_CWD.',
    '',
    'dry_run="${OPERATIONAL_APPLY_DRY_RUN:-${DRY_RUN:-}}"',
    ...bashEnvFileLoaderLines(),
    'if [[ "$dry_run" =~ ^(1|true|TRUE|yes|YES)$ ]]; then',
    '  vercel_cmd=(vercel)',
    'elif command -v vercel >/dev/null 2>&1; then',
    '  vercel_cmd=(vercel)',
    'elif command -v npx >/dev/null 2>&1; then',
    '  vercel_cmd=(npx --yes vercel)',
    'else',
    '  echo "Vercel CLI is required. Install it or ensure npx is available." >&2',
    '  exit 1',
    'fi',
    '',
    'vercel_args=()',
    'if [[ -n "${VERCEL_TOKEN:-}" ]]; then',
    '  vercel_args+=(--token "$VERCEL_TOKEN")',
    'fi',
    'if [[ -n "${VERCEL_SCOPE:-}" ]]; then',
    '  vercel_args+=(--scope "$VERCEL_SCOPE")',
    'fi',
    'if [[ -n "${VERCEL_PROJECT_CWD:-}" ]]; then',
    '  vercel_args+=(--cwd "$VERCEL_PROJECT_CWD")',
    'fi',
    '',
    'read -r -a vercel_targets <<< "${VERCEL_ENV_TARGETS:-production preview}"',
    'keys=(',
    ...keys.map((key) => `  ${scriptSingleQuote(key)}`),
    ')',
    '',
    'if [[ "${#keys[@]}" -eq 0 ]]; then',
    '  echo "No missing Vercel runtime inputs were detected."',
    '  exit 0',
    'fi',
    '',
    'missing=0',
    'for key in "${keys[@]}"; do',
    '  if [[ -z "${!key:-}" ]]; then',
    '    echo "Missing environment value: ${key}" >&2',
    '    missing=1',
    '  fi',
    'done',
    'if [[ "$missing" -ne 0 ]]; then',
    '  exit 2',
    'fi',
    'if [[ "$dry_run" =~ ^(1|true|TRUE|yes|YES)$ ]]; then',
    '  echo "Dry-run enabled; commands will be printed without applying changes."',
    'fi',
    '',
    'for target in "${vercel_targets[@]}"; do',
    '  if [[ -z "$target" ]]; then',
    '    continue',
    '  fi',
    '  for key in "${keys[@]}"; do',
    '    value="${!key}"',
    '    if [[ "$dry_run" =~ ^(1|true|TRUE|yes|YES)$ ]]; then',
    '      echo "DRY-RUN vercel env add $key $target --value <redacted> --yes --force ${vercel_args[*]}"',
    '    else',
    '      "${vercel_cmd[@]}" env add "$key" "$target" --value "$value" --yes --force "${vercel_args[@]}"',
    '    fi',
    '  done',
    'done',
    '',
    'echo "Runtime environment values applied to Vercel."',
    'echo "Re-run: vercel env pull .env.local --yes"',
    'echo "Then re-run: npm run verify:operational-inputs -- --json"',
    '',
  ];

  ensureParent(path);
  writeFileSync(path, lines.join('\n'));
  try {
    chmodSync(path, 0o755);
  } catch {
    // The script can still be executed with `bash <path>` on filesystems that ignore chmod.
  }
}

function writeNodeVercelScript(path, checks) {
  if (!path) return;
  const keys = runtimeVercelKeysForApply(checks);
  const lines = [
    '#!/usr/bin/env node',
    '',
    "import { spawnSync } from 'node:child_process';",
    "import { readFileSync } from 'node:fs';",
    '',
    '/*',
    ' * Generated by verify-operational-readiness-inputs.mjs.',
    ' * Export each missing runtime value in your shell first, then run this script from the repo root.',
    ' * Or pass --env-file=<filled-template> / OPERATIONAL_INPUTS_ENV_FILE=<filled-template>.',
    ' * Applies values with: vercel env add <name> <environment> --value <value> --yes --force.',
    ' * Set OPERATIONAL_APPLY_DRY_RUN=1 to print the commands without applying changes.',
    ' * Optional: set VERCEL_ENV_TARGETS="production preview", VERCEL_TOKEN, VERCEL_SCOPE, or VERCEL_PROJECT_CWD.',
    ' */',
    '',
    `const keys = ${JSON.stringify(keys, null, 2)};`,
    'const dryRun = /^(1|true|yes)$/i.test(process.env.OPERATIONAL_APPLY_DRY_RUN || process.env.DRY_RUN || "");',
    'const commandTimeoutMs = Number(process.env.OPERATIONAL_APPLY_COMMAND_TIMEOUT_MS || "120000");',
    'if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {',
    '  console.error("OPERATIONAL_APPLY_COMMAND_TIMEOUT_MS must be a positive number of milliseconds.");',
    '  process.exit(2);',
    '}',
    '',
    ...nodeEnvFileLoaderLines(),
    'function splitTargets(value) {',
    '  return String(value || "production preview")',
    '    .split(/[\\s,]+/)',
    '    .map((item) => item.trim())',
    '    .filter(Boolean);',
    '}',
    '',
    'function run(command, args, options = {}) {',
    '  const attempts = process.platform === "win32" && !/\\.(cmd|exe|bat)$/i.test(command)',
    '    ? [command, `${command}.cmd`, `${command}.exe`]',
    '    : [command];',
    '  let last;',
    '  for (const candidate of attempts) {',
    '    const result = spawnSync(candidate, args, { stdio: options.stdio || "inherit", windowsHide: true, timeout: commandTimeoutMs });',
    '    last = result;',
    '    if (!result.error || result.error.code !== "ENOENT") {',
    '      if (result.error?.code === "ETIMEDOUT") {',
    '        console.error(`Command timed out after ${commandTimeoutMs}ms: ${command}`);',
    '        if (options.exitOnFailure !== false) process.exit(124);',
    '      }',
    '      if (result.status !== 0 && options.exitOnFailure !== false) process.exit(result.status ?? 1);',
    '      return result;',
    '    }',
    '  }',
    '  if (options.exitOnFailure === false) return last;',
    '  console.error(`Command not found: ${command}`);',
    '  if (last?.error) console.error(last.error.message);',
    '  process.exit(1);',
    '}',
    '',
    'function hasCommand(command, args = ["--version"]) {',
    '  const result = run(command, args, { stdio: "ignore", exitOnFailure: false });',
    '  return result && !result.error && result.status === 0;',
    '}',
    '',
    'function vercelInvocation() {',
    '  if (hasCommand("vercel")) return { command: "vercel", prefix: [] };',
    '  if (hasCommand("npx", ["--version"])) return { command: "npx", prefix: ["--yes", "vercel"] };',
    '  console.error("Vercel CLI is required. Install it or ensure npx is available.");',
    '  process.exit(1);',
    '}',
    '',
    'if (keys.length === 0) {',
    '  console.log("No missing Vercel runtime inputs were detected.");',
    '  process.exit(0);',
    '}',
    '',
    'const missing = keys.filter((key) => !String(process.env[key] || "").trim());',
    'if (missing.length > 0) {',
    '  for (const key of missing) console.error(`Missing environment value: ${key}`);',
    '  process.exit(2);',
    '}',
    '',
    'const targets = splitTargets(process.env.VERCEL_ENV_TARGETS);',
    'const globalArgs = [];',
    'if (process.env.VERCEL_TOKEN) globalArgs.push("--token", process.env.VERCEL_TOKEN);',
    'if (process.env.VERCEL_SCOPE) globalArgs.push("--scope", process.env.VERCEL_SCOPE);',
    'if (process.env.VERCEL_PROJECT_CWD) globalArgs.push("--cwd", process.env.VERCEL_PROJECT_CWD);',
    'const invocation = dryRun ? { command: "vercel", prefix: [] } : vercelInvocation();',
    'function displayArgs(args) {',
    '  const redacted = [...args];',
    '  const valueIndex = redacted.indexOf("--value");',
    '  if (valueIndex >= 0 && valueIndex + 1 < redacted.length) redacted[valueIndex + 1] = "<redacted>";',
    '  const tokenIndex = redacted.indexOf("--token");',
    '  if (tokenIndex >= 0 && tokenIndex + 1 < redacted.length) redacted[tokenIndex + 1] = "<redacted>";',
    '  return redacted.join(" ");',
    '}',
    '',
    'for (const target of targets) {',
    '  for (const key of keys) {',
    '    const args = [',
    '      ...invocation.prefix,',
    '      "env",',
    '      "add",',
    '      key,',
    '      target,',
    '      "--value",',
    '      process.env[key],',
    '      "--yes",',
    '      "--force",',
    '      ...globalArgs,',
    '    ];',
    '    if (dryRun) console.log(`DRY-RUN ${invocation.command} ${displayArgs(args)}`);',
    '    else run(invocation.command, args);',
    '  }',
    '}',
    '',
    'console.log("Runtime environment values applied to Vercel.");',
    'console.log("Re-run: vercel env pull .env.local --yes");',
    'console.log("Then re-run: npm run verify:operational-inputs -- --json");',
    '',
  ];

  ensureParent(path);
  writeFileSync(path, lines.join('\n'));
  try {
    chmodSync(path, 0o755);
  } catch {
    // The script can still be executed with `node <path>` on filesystems that ignore chmod.
  }
}

const checks = [
  ...groups.map(summarizeGroup),
  summarizeEnvFileQuality(envFileDiagnostics),
].filter(Boolean);
const blocked = checks.filter((check) => check.status === 'blocked');
const warnings = checks.filter((check) => check.status === 'warn');
const report = {
  status: blocked.length > 0 ? 'blocked' : warnings.length > 0 ? 'warn' : 'pass',
  selfTest,
  blocked: blocked.length,
  warnings: warnings.length,
  passed: checks.filter((check) => check.status === 'pass').length,
  templatePath: templateOut || undefined,
  actionPlanPath: planOut || undefined,
  applyScriptPath: applyScriptOut || undefined,
  vercelScriptPath: vercelScriptOut || undefined,
  nodeApplyScriptPath: nodeApplyScriptOut || undefined,
  nodeVercelScriptPath: nodeVercelScriptOut || undefined,
  envFilePath: envFile || undefined,
  envFileDiagnostics: envFile ? envFileDiagnostics : undefined,
  sourceInventory: {
    localEnvFiles: localEnvInventory,
    vercel: vercelEnvInventory,
    githubActions: githubActionsInventory,
    localManagementAuth: localManagementAuthInventory,
    supabaseSystemSecrets: supabaseSystemSecretsInventory,
  },
  checks,
};

writeTemplate(templateOut, checks);
writeActionPlan(planOut, report);
writeApplyScript(applyScriptOut, checks);
writeVercelScript(vercelScriptOut, checks);
writeNodeApplyScript(nodeApplyScriptOut, checks);
writeNodeVercelScript(nodeVercelScriptOut, checks);

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const suffix = check.missing.length ? ` missing=${check.missing.join(', ')}` : '';
    const vercelSuffix = check.availableInVercel?.length
      ? ` vercel=${check.availableInVercel.join(', ')}`
      : '';
    const localSuffix = check.availableInLocalEnvFiles?.length
      ? ` local=${check.availableInLocalEnvFiles.map((item) => `${item.key}@${item.files.join('+')}`).join(', ')}`
      : '';
    const githubSuffix = check.availableInGitHubActions?.length
      ? ` github=${check.availableInGitHubActions.map((item) => `${item.key}@${item.stores.join('+')}`).join(', ')}`
      : '';
    const supabaseSecretsSuffix = check.availableInSupabaseSystemSecrets?.length
      ? ` supabase_system_secrets=${check.availableInSupabaseSystemSecrets.join(', ')}`
      : '';
    console.log(`${check.status.toUpperCase()} ${check.id}${suffix}${vercelSuffix}${githubSuffix}${supabaseSecretsSuffix}${localSuffix}`);
  }
}

if (strict && blocked.length > 0) process.exit(2);
