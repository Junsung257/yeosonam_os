#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has('--json');
const selfTest = args.has('--self-test');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

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
  return [key, value];
}

function loadEnvFile(path, targetEnv = process.env) {
  const diagnostics = {
    path: path || '',
    loadedKeys: [],
    invalidLines: [],
  };
  if (!path) return diagnostics;
  const text = readFileSync(path, 'utf8');
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      const trimmed = String(line || '').trim();
      if (trimmed && !trimmed.startsWith('#')) diagnostics.invalidLines.push(index + 1);
      continue;
    }
    const [key, value] = parsed;
    if (!Object.prototype.hasOwnProperty.call(targetEnv, key)) targetEnv[key] = value;
    diagnostics.loadedKeys.push(key);
  }
  diagnostics.loadedKeys = [...new Set(diagnostics.loadedKeys)].sort();
  return diagnostics;
}

function hostFromUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text).host.toLowerCase();
  } catch {
    return '';
  }
}

function hostFromConnectionString(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    const match = text.match(/@([^:/?\s]+)/);
    return match?.[1]?.toLowerCase() || '';
  }
}

function refFromSupabaseUrl(value) {
  const host = hostFromUrl(value);
  const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  return match?.[1] || '';
}

function listFromEnv(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function boolEnv(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function pick(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function safeProjectRef(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSha(value) {
  return String(value || '').trim().toLowerCase();
}

function shortSha(value) {
  const sha = normalizeSha(value);
  return sha ? sha.slice(0, 12) : null;
}

function fingerprint(value) {
  const text = String(value || '').trim();
  return text ? createHash('sha256').update(text).digest('hex').slice(0, 16) : null;
}

function hashHost(value) {
  const text = String(value || '').trim().toLowerCase();
  return text ? createHash('sha256').update(text).digest('hex').slice(0, 12) : null;
}

function hostSuffix(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const parts = text.split('.').filter(Boolean);
  return parts.length <= 2 ? text : parts.slice(-3).join('.');
}

function looksLikePlaceholder(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.length < 24) return true;
  return /^(placeholder|changeme|dummy|example|test|todo|your_|xxx|replace_me|service_role_key)/i.test(text) ||
    /placeholder|changeme|dummy|example|replace[_-]?me/i.test(text);
}

function protectedEnvironmentName(env) {
  return String(pick(
    env.GITHUB_DEPLOYMENT_ENVIRONMENT,
    env.PROTECTED_ENVIRONMENT_NAME,
    env.GITHUB_ENVIRONMENT,
    env.ENVIRONMENT_NAME,
  )).trim().toLowerCase();
}

function evaluate(inputEnv = process.env, options = {}) {
  const env = { ...inputEnv };
  const envFileDiagnostics = loadEnvFile(options.envFile || '', env);

  const stagingApiUrl = pick(
    env.STAGING_SUPABASE_URL,
    env.STAGING_NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_URL,
  );
  const productionApiUrl = pick(
    env.PRODUCTION_SUPABASE_URL,
    env.PRODUCTION_NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_PRODUCTION_SUPABASE_URL,
  );

  const stagingDbUrl = pick(env.STAGING_DATABASE_URL, env.DATABASE_URL, env.SUPABASE_DB_URL);
  const productionDbUrl = pick(env.PRODUCTION_DATABASE_URL, env.PRODUCTION_SUPABASE_DB_URL);

  const stagingProjectRef = safeProjectRef(pick(
    env.EXPECTED_STAGING_PROJECT_REF,
    env.STAGING_PROJECT_REF,
    env.SUPABASE_STAGING_PROJECT_REF,
    refFromSupabaseUrl(stagingApiUrl),
  ));
  const productionProjectRef = safeProjectRef(pick(
    env.PRODUCTION_PROJECT_REF,
    env.SUPABASE_PRODUCTION_PROJECT_REF,
    refFromSupabaseUrl(productionApiUrl),
  ));

  const stagingApiHost = hostFromUrl(stagingApiUrl);
  const productionApiHost = hostFromUrl(productionApiUrl);
  const stagingDbHost = pick(
    env.EXPECTED_STAGING_DB_HOST,
    env.STAGING_DB_HOST,
    hostFromConnectionString(stagingDbUrl),
  ).toLowerCase();
  const productionDbHost = pick(
    env.PRODUCTION_DB_HOST,
    hostFromConnectionString(productionDbUrl),
  ).toLowerCase();

  const projectAllowlist = listFromEnv(pick(
    env.STAGING_PROJECT_REF_ALLOWLIST,
    env.NON_PROD_PROJECT_REF_ALLOWLIST,
    env.WRITE_ALLOWED_STAGING_PROJECT_REFS,
    env.EXPECTED_STAGING_PROJECT_REF,
  ));
  const projectDenylist = listFromEnv(pick(
    env.PRODUCTION_PROJECT_REF_DENYLIST,
    env.PRODUCTION_PROJECT_REF,
    env.SUPABASE_PRODUCTION_PROJECT_REF,
  ));
  const dbHostDenylist = listFromEnv(pick(
    env.PRODUCTION_DB_HOST_DENYLIST,
    env.PRODUCTION_DB_HOST,
    hostFromConnectionString(productionDbUrl),
  ));

  const environmentLabel = String(pick(
    env.ENVIRONMENT_LABEL,
    env.STAGING_ENVIRONMENT_LABEL,
    env.VERCEL_ENV,
    env.NODE_ENV,
  )).trim().toLowerCase();
  const expectedPrNumber = String(pick(env.EXPECTED_PR_NUMBER, env.INPUT_EXPECTED_PR_NUMBER)).trim();
  const runtimePrNumber = String(pick(
    env.PR_NUMBER,
    env.GITHUB_PR_NUMBER,
    env.GITHUB_EVENT_PULL_REQUEST_NUMBER,
    env.INPUT_PR_NUMBER,
  )).trim();
  const expectedHeadSha = normalizeSha(pick(env.EXPECTED_HEAD_SHA, env.INPUT_EXPECTED_HEAD_SHA));
  const runtimeHeadSha = normalizeSha(pick(env.HEAD_SHA, env.GITHUB_SHA, env.VERCEL_GIT_COMMIT_SHA));
  const requireProtectedEnvironment = boolEnv(env.REQUIRE_PROTECTED_STAGING_ENVIRONMENT);
  const protectedEnvName = protectedEnvironmentName(env);
  const requireProtectionAck = boolEnv(env.REQUIRE_STAGING_PROTECTION_ACK);
  const protectionAck = String(env.STAGING_ENVIRONMENT_PROTECTION_ACK || '').trim();
  const requireCredential = boolEnv(env.REQUIRE_STAGING_SERVICE_ROLE);
  const stagingCredential = pick(env.STAGING_SUPABASE_SERVICE_ROLE_KEY, env.STAGING_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_ROLE_KEY);
  const stagingCredentialFingerprint = fingerprint(stagingCredential);
  const credentialFingerprintDenylist = listFromEnv(pick(
    env.PRODUCTION_SERVICE_ROLE_KEY_FINGERPRINT_DENYLIST,
    env.PRODUCTION_CREDENTIAL_FINGERPRINT_DENYLIST,
  ));

  const checks = [];
  const add = (id, pass, message, details = {}) => {
    checks.push({ id, status: pass ? 'pass' : 'blocked', message, ...details });
  };

  add(
    'explicit-non-prod-opt-in',
    boolEnv(env.ALLOW_NON_PROD_DB_MUTATION),
    'ALLOW_NON_PROD_DB_MUTATION must be exactly true before any staging write.',
  );
  add(
    'staging-project-ref-present',
    Boolean(stagingProjectRef),
    'Expected staging project ref is required.',
  );
  add(
    'staging-api-host-present',
    Boolean(stagingApiHost),
    'Expected staging API host is required.',
  );
  add(
    'staging-db-host-present',
    Boolean(stagingDbHost),
    'Expected staging DB host is required.',
  );
  add(
    'environment-label-non-production',
    Boolean(environmentLabel) && !['production', 'prod'].includes(environmentLabel),
    'Environment label must be explicit and non-production.',
    { environmentLabel: environmentLabel || null },
  );
  add(
    'project-ref-allowlisted',
    Boolean(stagingProjectRef) && projectAllowlist.includes(stagingProjectRef),
    'Staging project ref must be explicitly allowlisted for writes.',
  );
  add(
    'production-project-ref-denylisted',
    Boolean(projectDenylist.length),
    'Production project ref denylist is required.',
  );
  add(
    'production-db-host-denylisted',
    Boolean(dbHostDenylist.length),
    'Production DB host denylist is required.',
  );
  add(
    'project-ref-separated-from-production',
    Boolean(stagingProjectRef) &&
      (!productionProjectRef || stagingProjectRef !== productionProjectRef) &&
      !projectDenylist.includes(stagingProjectRef),
    'Staging project ref must differ from production and must not be denylisted.',
  );
  add(
    'api-host-separated-from-production',
    Boolean(stagingApiHost) &&
      (!productionApiHost || stagingApiHost !== productionApiHost),
    'Staging API host must differ from production API host.',
  );
  add(
    'db-host-separated-from-production',
    Boolean(stagingDbHost) &&
      (!productionDbHost || stagingDbHost !== productionDbHost) &&
      !dbHostDenylist.includes(stagingDbHost),
    'Staging DB host must differ from production DB host and must not be denylisted.',
  );
  add(
    'expected-pr-number',
    !expectedPrNumber || (expectedPrNumber === '749' && (!runtimePrNumber || runtimePrNumber === expectedPrNumber)),
    'Expected PR number must be 749 and must match the workflow PR number when provided.',
    { expectedPrNumber: expectedPrNumber || null, runtimePrNumber: runtimePrNumber || null },
  );
  add(
    'expected-head-sha',
    !expectedHeadSha || (!runtimeHeadSha || runtimeHeadSha === expectedHeadSha),
    'Expected HEAD SHA must match the workflow/runtime HEAD SHA when provided.',
    { expectedHeadSha: shortSha(expectedHeadSha), runtimeHeadSha: shortSha(runtimeHeadSha) },
  );
  add(
    'protected-github-environment',
    !requireProtectedEnvironment || protectedEnvName === 'staging',
    'Protected GitHub environment must be staging when protected-environment enforcement is enabled.',
    { protectedEnvironment: protectedEnvName || null },
  );
  add(
    'protected-environment-ack',
    !requireProtectionAck || protectionAck === 'protected-staging-reviewed',
    'Protected staging environment must provide STAGING_ENVIRONMENT_PROTECTION_ACK=protected-staging-reviewed.',
  );
  add(
    'staging-credential-not-placeholder',
    !requireCredential || (!looksLikePlaceholder(stagingCredential) && Boolean(stagingCredentialFingerprint)),
    'Staging service credential must be present and must not be a placeholder when credential enforcement is enabled.',
    { credentialFingerprint: stagingCredentialFingerprint },
  );
  add(
    'staging-credential-not-production',
    !requireCredential ||
      !stagingCredentialFingerprint ||
      !credentialFingerprintDenylist.includes(stagingCredentialFingerprint),
    'Staging credential fingerprint must not match the production credential denylist.',
    { credentialFingerprint: stagingCredentialFingerprint },
  );

  const blocked = checks.filter((check) => check.status !== 'pass');
  const summary = {
    status: blocked.length === 0 ? 'pass' : 'blocked',
    verdict: blocked.length === 0 ? 'STAGING_IDENTITY_VERIFIED' : 'STAGING_IDENTITY_NOT_VERIFIED',
    writeAllowed: blocked.length === 0,
    envFile: envFileDiagnostics.path || null,
    envFileDiagnostics: {
      path: envFileDiagnostics.path,
      loadedKeyCount: envFileDiagnostics.loadedKeys.length,
      invalidLines: envFileDiagnostics.invalidLines,
    },
    identity: {
      organization: env.SUPABASE_ORGANIZATION || env.STAGING_SUPABASE_ORGANIZATION || null,
      projectName: env.STAGING_PROJECT_NAME || env.SUPABASE_STAGING_PROJECT_NAME || null,
      projectRef: stagingProjectRef || null,
      apiHost: stagingApiHost || null,
      dbHost: stagingDbHost || null,
      dbHostHash: hashHost(stagingDbHost),
      dbHostSuffix: hostSuffix(stagingDbHost),
      databaseName: env.STAGING_DATABASE_NAME || env.PGDATABASE || null,
      environmentLabel: environmentLabel || null,
      branchOrLink: env.STAGING_BRANCH || env.SUPABASE_BRANCH || env.VERCEL_GIT_COMMIT_REF || null,
    },
    protectedRuntime: {
      expectedPrNumber: expectedPrNumber || null,
      runtimePrNumber: runtimePrNumber || null,
      expectedHeadSha: shortSha(expectedHeadSha),
      runtimeHeadSha: shortSha(runtimeHeadSha),
      protectedEnvironment: protectedEnvName || null,
      protectionAckPresent: protectionAck ? true : false,
      credentialFingerprint: stagingCredentialFingerprint,
      credentialFingerprintDenylistCount: credentialFingerprintDenylist.length,
    },
    productionDenyEvidence: {
      productionProjectRef: productionProjectRef || null,
      productionApiHost: productionApiHost || null,
      productionDbHost: productionDbHost || null,
      projectDenylist,
      dbHostDenylist,
    },
    checks,
    blockedChecks: blocked.map((check) => check.id),
  };

  return summary;
}

function printHuman(report) {
  console.log(`verdict=${report.verdict}`);
  console.log(`writeAllowed=${report.writeAllowed}`);
  console.log(`projectRef=${report.identity.projectRef || '(missing)'}`);
  console.log(`apiHost=${report.identity.apiHost || '(missing)'}`);
  console.log(`dbHost=${report.identity.dbHost || '(missing)'}`);
  if (report.blockedChecks.length) {
    console.log(`blockedChecks=${report.blockedChecks.join(',')}`);
  }
}

function runSelfTest() {
  const fakeStagingCredential = 'staging-service-role-key-for-pr749-self-test';
  const fakeProductionCredential = 'production-service-role-key-for-pr749-self-test';
  const fakeProductionFingerprint = fingerprint(fakeProductionCredential);

  const prodLike = evaluate({
    VERCEL_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://prodref.supabase.co',
    SUPABASE_URL: 'https://prodref.supabase.co',
    EXPECTED_STAGING_PROJECT_REF: 'prodref',
    EXPECTED_STAGING_DB_HOST: 'db.prodref.supabase.co',
    PRODUCTION_PROJECT_REF_DENYLIST: 'prodref',
    PRODUCTION_DB_HOST_DENYLIST: 'db.prodref.supabase.co',
    ALLOW_NON_PROD_DB_MUTATION: 'true',
  });
  if (prodLike.status !== 'blocked') throw new Error('prod-like env must be blocked');

  const missingOptIn = evaluate({
    ENVIRONMENT_LABEL: 'staging',
    STAGING_SUPABASE_URL: 'https://stageref.supabase.co',
    EXPECTED_STAGING_PROJECT_REF: 'stageref',
    EXPECTED_STAGING_DB_HOST: 'db.stageref.supabase.co',
    PRODUCTION_PROJECT_REF_DENYLIST: 'prodref',
    PRODUCTION_DB_HOST_DENYLIST: 'db.prodref.supabase.co',
    PRODUCTION_SUPABASE_URL: 'https://prodref.supabase.co',
  });
  if (missingOptIn.status !== 'blocked') throw new Error('missing opt-in must be blocked');

  const valid = evaluate({
    ENVIRONMENT_LABEL: 'staging',
    STAGING_SUPABASE_URL: 'https://stageref.supabase.co',
    PRODUCTION_SUPABASE_URL: 'https://prodref.supabase.co',
    EXPECTED_STAGING_PROJECT_REF: 'stageref',
    EXPECTED_STAGING_DB_HOST: 'db.stageref.supabase.co',
    PRODUCTION_PROJECT_REF_DENYLIST: 'prodref',
    PRODUCTION_DB_HOST_DENYLIST: 'db.prodref.supabase.co',
    STAGING_PROJECT_REF_ALLOWLIST: 'stageref',
    ALLOW_NON_PROD_DB_MUTATION: 'true',
    EXPECTED_PR_NUMBER: '749',
    PR_NUMBER: '749',
    EXPECTED_HEAD_SHA: '475975d10d624f98f100b6bccd9979d8bb4a40e9',
    HEAD_SHA: '475975d10d624f98f100b6bccd9979d8bb4a40e9',
    REQUIRE_PROTECTED_STAGING_ENVIRONMENT: 'true',
    PROTECTED_ENVIRONMENT_NAME: 'staging',
    REQUIRE_STAGING_PROTECTION_ACK: 'true',
    STAGING_ENVIRONMENT_PROTECTION_ACK: 'protected-staging-reviewed',
    REQUIRE_STAGING_SERVICE_ROLE: 'true',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: fakeStagingCredential,
    PRODUCTION_SERVICE_ROLE_KEY_FINGERPRINT_DENYLIST: fakeProductionFingerprint,
  });
  if (valid.status !== 'pass') {
    throw new Error(`valid staging env should pass: ${valid.blockedChecks.join(',')}`);
  }

  const wrongHead = evaluate({
    ENVIRONMENT_LABEL: 'staging',
    STAGING_SUPABASE_URL: 'https://stageref.supabase.co',
    PRODUCTION_SUPABASE_URL: 'https://prodref.supabase.co',
    EXPECTED_STAGING_PROJECT_REF: 'stageref',
    EXPECTED_STAGING_DB_HOST: 'db.stageref.supabase.co',
    PRODUCTION_PROJECT_REF_DENYLIST: 'prodref',
    PRODUCTION_DB_HOST_DENYLIST: 'db.prodref.supabase.co',
    STAGING_PROJECT_REF_ALLOWLIST: 'stageref',
    ALLOW_NON_PROD_DB_MUTATION: 'true',
    EXPECTED_PR_NUMBER: '749',
    PR_NUMBER: '749',
    EXPECTED_HEAD_SHA: '475975d10d624f98f100b6bccd9979d8bb4a40e9',
    HEAD_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    REQUIRE_PROTECTED_STAGING_ENVIRONMENT: 'true',
    PROTECTED_ENVIRONMENT_NAME: 'staging',
    REQUIRE_STAGING_PROTECTION_ACK: 'true',
    STAGING_ENVIRONMENT_PROTECTION_ACK: 'protected-staging-reviewed',
    REQUIRE_STAGING_SERVICE_ROLE: 'true',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: fakeStagingCredential,
    PRODUCTION_SERVICE_ROLE_KEY_FINGERPRINT_DENYLIST: fakeProductionFingerprint,
  });
  if (wrongHead.status !== 'blocked' || !wrongHead.blockedChecks.includes('expected-head-sha')) {
    throw new Error('wrong HEAD SHA must be blocked');
  }

  const unprotected = evaluate({
    ENVIRONMENT_LABEL: 'staging',
    STAGING_SUPABASE_URL: 'https://stageref.supabase.co',
    PRODUCTION_SUPABASE_URL: 'https://prodref.supabase.co',
    EXPECTED_STAGING_PROJECT_REF: 'stageref',
    EXPECTED_STAGING_DB_HOST: 'db.stageref.supabase.co',
    PRODUCTION_PROJECT_REF_DENYLIST: 'prodref',
    PRODUCTION_DB_HOST_DENYLIST: 'db.prodref.supabase.co',
    STAGING_PROJECT_REF_ALLOWLIST: 'stageref',
    ALLOW_NON_PROD_DB_MUTATION: 'true',
    REQUIRE_PROTECTED_STAGING_ENVIRONMENT: 'true',
    PROTECTED_ENVIRONMENT_NAME: 'production',
    REQUIRE_STAGING_PROTECTION_ACK: 'true',
    STAGING_ENVIRONMENT_PROTECTION_ACK: 'protected-staging-reviewed',
    REQUIRE_STAGING_SERVICE_ROLE: 'true',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: fakeStagingCredential,
  });
  if (unprotected.status !== 'blocked' || !unprotected.blockedChecks.includes('protected-github-environment')) {
    throw new Error('non-staging protected environment must be blocked');
  }

  const missingProtectionAck = evaluate({
    ENVIRONMENT_LABEL: 'staging',
    STAGING_SUPABASE_URL: 'https://stageref.supabase.co',
    PRODUCTION_SUPABASE_URL: 'https://prodref.supabase.co',
    EXPECTED_STAGING_PROJECT_REF: 'stageref',
    EXPECTED_STAGING_DB_HOST: 'db.stageref.supabase.co',
    PRODUCTION_PROJECT_REF_DENYLIST: 'prodref',
    PRODUCTION_DB_HOST_DENYLIST: 'db.prodref.supabase.co',
    STAGING_PROJECT_REF_ALLOWLIST: 'stageref',
    ALLOW_NON_PROD_DB_MUTATION: 'true',
    REQUIRE_PROTECTED_STAGING_ENVIRONMENT: 'true',
    PROTECTED_ENVIRONMENT_NAME: 'staging',
    REQUIRE_STAGING_PROTECTION_ACK: 'true',
    REQUIRE_STAGING_SERVICE_ROLE: 'true',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: fakeStagingCredential,
  });
  if (
    missingProtectionAck.status !== 'blocked' ||
    !missingProtectionAck.blockedChecks.includes('protected-environment-ack')
  ) {
    throw new Error('missing protected environment ack must be blocked');
  }

  const placeholderCredential = evaluate({
    ENVIRONMENT_LABEL: 'staging',
    STAGING_SUPABASE_URL: 'https://stageref.supabase.co',
    PRODUCTION_SUPABASE_URL: 'https://prodref.supabase.co',
    EXPECTED_STAGING_PROJECT_REF: 'stageref',
    EXPECTED_STAGING_DB_HOST: 'db.stageref.supabase.co',
    PRODUCTION_PROJECT_REF_DENYLIST: 'prodref',
    PRODUCTION_DB_HOST_DENYLIST: 'db.prodref.supabase.co',
    STAGING_PROJECT_REF_ALLOWLIST: 'stageref',
    ALLOW_NON_PROD_DB_MUTATION: 'true',
    REQUIRE_STAGING_SERVICE_ROLE: 'true',
    REQUIRE_STAGING_PROTECTION_ACK: 'true',
    STAGING_ENVIRONMENT_PROTECTION_ACK: 'protected-staging-reviewed',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
  });
  if (
    placeholderCredential.status !== 'blocked' ||
    !placeholderCredential.blockedChecks.includes('staging-credential-not-placeholder')
  ) {
    throw new Error('placeholder staging credential must be blocked');
  }

  const serialized = JSON.stringify(valid);
  if (serialized.includes(fakeStagingCredential) || serialized.includes(fakeProductionCredential)) {
    throw new Error('self-test report should not expose credential values');
  }
}

function main() {
  if (selfTest) {
    runSelfTest();
    const result = { status: 'pass', selfTest: true };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log('self-test passed');
    return;
  }

  const report = evaluate(process.env, { envFile: argValue('--env-file', '') });
  if (json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (report.status !== 'pass') process.exitCode = 1;
}

main();
