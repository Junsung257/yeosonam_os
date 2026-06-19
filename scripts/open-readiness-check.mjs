#!/usr/bin/env node

import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = argv.filter((arg) => arg.startsWith(prefix)).pop();
  if (inline) return inline.slice(prefix.length);
  const index = argv.lastIndexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return argv.includes(name);
}

const BASE_URL = (argValue('--base', process.env.OPEN_CHECK_BASE_URL || 'https://www.yeosonam.com')).replace(/\/$/, '');
const DEFAULT_PACKAGE_ID = '17945abe-026e-4696-96d0-2d8b14393fe6';
const DEFAULT_REF = 'YSINF202606051602318291';
const PACKAGE_ID_ARG = argValue('--package-id', '');
const REF_CODE_ARG = argValue('--ref-code', '');
const PACKAGE_ID = PACKAGE_ID_ARG || process.env.OPEN_CHECK_PACKAGE_ID || DEFAULT_PACKAGE_ID;
const REF_CODE = REF_CODE_ARG || process.env.OPEN_CHECK_REF_CODE || DEFAULT_REF;
const HAS_EXPLICIT_PACKAGE_ID = Boolean(PACKAGE_ID_ARG || process.env.OPEN_CHECK_PACKAGE_ID);
const HAS_EXPLICIT_REF_CODE = Boolean(REF_CODE_ARG || process.env.OPEN_CHECK_REF_CODE);
const VERCEL_SCOPE = argValue('--vercel-scope', process.env.VERCEL_SCOPE || 'zzbaa0317-4596s-projects');
const VERCEL_LOG_TARGET = argValue('--vercel-log-target', process.env.VERCEL_LOG_TARGET || BASE_URL);
const OPEN_CHECK_AUTH_COOKIE = argValue('--auth-cookie', process.env.OPEN_CHECK_AUTH_COOKIE || '');
const TIMEOUT_MS = Number(argValue('--timeout-ms', process.env.OPEN_CHECK_TIMEOUT_MS || '30000'));
const BLOG_AUDIT_LIMIT = Number(argValue('--blog-audit-limit', process.env.OPEN_CHECK_BLOG_AUDIT_LIMIT || '10'));
const BLOG_AUDIT_SITE_LIMIT = Number(argValue('--blog-audit-site-limit', process.env.OPEN_CHECK_BLOG_AUDIT_SITE_LIMIT || '50'));
const BLOG_AUDIT_TIMEOUT_MS = Number(argValue('--blog-audit-timeout-ms', process.env.OPEN_CHECK_BLOG_AUDIT_TIMEOUT_MS || '15000'));
const BLOG_AUDIT_HARD_TIMEOUT_MS = Number(argValue('--blog-audit-hard-timeout-ms', process.env.OPEN_CHECK_BLOG_AUDIT_HARD_TIMEOUT_MS || '180000'));
const MARKETING_AUTOMATION_TIMEOUT_MS = Number(
  argValue('--marketing-automation-timeout-ms', process.env.MARKETING_AUTOMATION_TIMEOUT_MS || '120000'),
);
const IS_LOCAL_BASE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE_URL);
const LOCAL_MODE = hasFlag('--local') || process.env.OPEN_CHECK_LOCAL === '1' || IS_LOCAL_BASE;
const SKIP_EXTERNAL = hasFlag('--skip-external') || process.env.OPEN_CHECK_SKIP_EXTERNAL === '1' || LOCAL_MODE;
const ALLOW_LOCAL_MISSING_DATA = hasFlag('--allow-local-missing-data') || process.env.OPEN_CHECK_ALLOW_LOCAL_MISSING_DATA === '1' || LOCAL_MODE;
const LOCAL_DATA_UNAVAILABLE_PATTERN = /no_posts_found|no blog links found|collectionError|Blog database is not configured|local blog data unavailable|production\/staging data is required|db_unavailable_page|silent_zero_posts|blog_api_db_timeout|db_timeout|surface_timeout|operation was aborted|abort|fetch failed|ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET|terminated|command_failed|runtime_errors/i;
const INCLUDE_MARKETING_RUNTIME = hasFlag('--include-marketing-runtime') || process.env.OPEN_CHECK_INCLUDE_MARKETING_RUNTIME === '1';
const MARKETING_RUNTIME_ISOLATED = hasFlag('--marketing-runtime-isolated') || process.env.OPEN_CHECK_MARKETING_RUNTIME_ISOLATED === '1';
const MARKETING_RUNTIME_PORT = Number(argValue('--marketing-runtime-port', process.env.MARKETING_RUNTIME_PORT || '3036'));
const MARKETING_RUNTIME_MODE = argValue('--marketing-runtime-mode', process.env.MARKETING_RUNTIME_MODE || 'dev');
const MARKETING_RUNTIME_TIMEOUT_MS = Number(argValue('--marketing-runtime-timeout-ms', process.env.MARKETING_RUNTIME_TIMEOUT_MS || '60000'));
const MARKETING_RUNTIME_READY_TIMEOUT_MS = Number(argValue('--marketing-runtime-ready-timeout-ms', process.env.MARKETING_RUNTIME_READY_TIMEOUT_MS || '120000'));
const MARKETING_RUNTIME_HARD_TIMEOUT_MS = Number(
  argValue('--marketing-runtime-hard-timeout-ms', process.env.MARKETING_RUNTIME_HARD_TIMEOUT_MS || '0'),
);
const REPORT_PATH = argValue('--report', process.env.OPEN_READINESS_REPORT_PATH || '');
const RUNTIME_ENV_CONTRACT = JSON.parse(
  readFileSync(new URL('../src/config/runtime-env-readiness.json', import.meta.url), 'utf8'),
);
const IMPORTANT_ENV = Array.isArray(RUNTIME_ENV_CONTRACT.critical) ? RUNTIME_ENV_CONTRACT.critical : [];
const DEFAULTED_ENV = Array.isArray(RUNTIME_ENV_CONTRACT.warnDefaults) ? RUNTIME_ENV_CONTRACT.warnDefaults : [];

const strict = hasFlag('--strict');
const json = hasFlag('--json');

const checks = [];
let protectedDeploymentDetected = false;

function missingImportantEnvVars() {
  return IMPORTANT_ENV.filter((key) => !process.env[key]);
}

function shouldBlockLocalRuntimeForMissingEnv(missing = missingImportantEnvVars()) {
  return LOCAL_MODE && ALLOW_LOCAL_MISSING_DATA && missing.length > 0;
}

function addCheck(name, status, detail = {}) {
  checks.push({ name, status, ...detail });
}

function addBlockedCheck(name, detail = {}) {
  addCheck(name, 'blocked', detail);
}

function writeReport(path, report) {
  if (!path) return;
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}

function releaseBlockers() {
  return checks
    .filter((check) => check.status === 'blocked' || check.status === 'fail')
    .map((check) => ({
      name: check.name,
      status: check.status,
      notes: check.notes || check.error || '',
      url: check.url || undefined,
      target: check.target || undefined,
      missing: Array.isArray(check.missing) ? check.missing : undefined,
      usingDefaults: Array.isArray(check.usingDefaults) ? check.usingDefaults : undefined,
      failedRequiredChecks: Array.isArray(check.failedRequiredChecks)
        ? check.failedRequiredChecks
        : undefined,
      issueCounts: check.issueCounts && typeof check.issueCounts === 'object' ? check.issueCounts : undefined,
      strictScore: Number.isFinite(Number(check.strictScore)) ? Number(check.strictScore) : undefined,
      fleetScore: Number.isFinite(Number(check.fleetScore)) ? Number(check.fleetScore) : undefined,
      failedIssues: Array.isArray(check.failedIssues) ? check.failedIssues : undefined,
      authMode: check.authMode || undefined,
      attentionChecks: Array.isArray(check.attentionChecks) ? check.attentionChecks : undefined,
      attentionCheckCount: Number.isFinite(Number(check.attentionCheckCount))
        ? Number(check.attentionCheckCount)
        : undefined,
      checked: Number.isFinite(Number(check.checked)) ? Number(check.checked) : undefined,
      surfaceFailures: Number.isFinite(Number(check.failed)) ? Number(check.failed) : undefined,
      surfaceWarnings: Number.isFinite(Number(check.warn)) ? Number(check.warn) : undefined,
      reportPath: check.reportPath || undefined,
    }));
}

function releaseWarnings() {
  return checks.flatMap((check) => {
    const warnings = [];
    if (check.status === 'warn') {
      warnings.push({
        source: 'open-readiness',
        name: check.name,
        status: 'warn',
        notes: check.notes || check.error || '',
        missing: Array.isArray(check.missing) ? check.missing : undefined,
        usingDefaults: Array.isArray(check.usingDefaults) ? check.usingDefaults : undefined,
        reportPath: check.reportPath || undefined,
      });
    }

    if (Array.isArray(check.usingDefaults) && check.usingDefaults.length > 0) {
      warnings.push({
        source: 'open-readiness',
        name: `${check.name}:defaults`,
        status: 'warn',
        notes: 'Defaults are safe locally but should be explicit in staging/production.',
        usingDefaults: check.usingDefaults,
      });
    }

    return warnings;
  });
}

function warningLabel(warning) {
  const name = warning.name || warning.source || 'warning';
  const details = [];
  if (Array.isArray(warning.usingDefaults) && warning.usingDefaults.length > 0) {
    details.push(`defaults: ${warning.usingDefaults.join(', ')}`);
  }
  if (Array.isArray(warning.missing) && warning.missing.length > 0) {
    details.push(`missing: ${warning.missing.join(', ')}`);
  }
  return details.length > 0 ? `${name} (${details.join('; ')})` : name;
}

function warningPreview(warnings, limit = 5) {
  const visible = warnings.slice(0, limit).map(warningLabel);
  const remaining = warnings.length - visible.length;
  return remaining > 0 ? `${visible.join(' | ')} | +${remaining} more` : visible.join(' | ');
}

function isProtectedDeploymentResponse(statusCode, body = '') {
  if (statusCode !== 401) return false;
  return /Protected deployment|Authentication Required|requires Vercel authentication|vercel_auth_enabled|vercel_auth_callback|auto_vercel_auth_redirect|vercel curl|x-vercel-trusted-oidc-idp-token/i.test(String(body));
}

function markProtectedDeployment() {
  protectedDeploymentDetected = true;
}

function quoteCmdArg(value) {
  const s = String(value);
  if (!/[()\s^&|<>"]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function run(command, args, options = {}) {
  const useCmdShim = process.platform === 'win32' && /^(npm|npx)$/.test(command);
  const started = Date.now();
  try {
    const commonOptions = {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: options.timeout ?? 120000,
      env: { ...process.env, ...options.env },
    };
    const stdout = useCmdShim
      ? execSync([command, ...args.map(quoteCmdArg)].join(' '), commonOptions)
      : execFileSync(command, args, commonOptions);
    return { ok: true, stdout, ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout?.toString?.() || '',
      stderr: err.stderr?.toString?.() || '',
      message: err.message || '',
      status: err.status,
      signal: err.signal,
      ms: Date.now() - started,
    };
  }
}

async function sleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchUrl(name, path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const started = Date.now();
  const attempts = Number(options.attempts ?? (LOCAL_MODE ? 2 : 1));
  const retryDelayMs = Number(options.retryDelayMs ?? 1000);
  let lastError = '';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        redirect: options.redirect || 'manual',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...(options.headers || {}) },
      });
      const shouldReadBody = options.readBody !== false || res.status === 401;
      const body = shouldReadBody ? await res.text() : '';
      const setCookie = res.headers.get('set-cookie') || '';
      const ok = options.ok ? options.ok(res, body, setCookie) : res.status >= 200 && res.status < 400;
      const protectedDeployment = isProtectedDeploymentResponse(res.status, body);
      if (protectedDeployment) markProtectedDeployment();
      addCheck(name, ok ? 'pass' : protectedDeployment ? 'blocked' : 'fail', {
        statusCode: res.status,
        ms: Date.now() - started,
        url,
        location: res.headers.get('location') || '',
        attempts: attempt,
        notes: protectedDeployment
          ? 'Vercel protected deployment requires an authenticated preview bypass'
          : options.notes?.(res, body, setCookie) || '',
        error: ok || protectedDeployment ? '' : body.slice(0, 1200),
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === attempts) {
        addCheck(name, 'fail', {
          statusCode: null,
          ms: Date.now() - started,
          url,
          attempts: attempt,
          error: lastError,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function checkCommand(name, command, args, options = {}) {
  const result = run(command, args, options);
  addCheck(name, result.ok ? 'pass' : 'fail', {
    ms: result.ms,
    command: [command, ...args].join(' '),
    error: result.ok ? '' : (result.stderr || result.stdout || result.message || '').trim().slice(0, 1000),
  });
  return result;
}

function parseJsonFromOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.lastIndexOf('\n{');
    if (start >= 0) return JSON.parse(trimmed.slice(start + 1));
    throw new Error('JSON output not found');
  }
}

function attentionChecksFromReport(report, limit = 40) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  return checks
    .filter((check) => check?.status === 'blocked' || check?.status === 'fail')
    .slice(0, limit)
    .map((check) => {
      const name = String(check.name || check.id || 'unknown');
      const status = String(check.status || 'unknown');
      const missing = Array.isArray(check.missing) && check.missing.length > 0
        ? ` missing=${check.missing.join('|')}`
        : '';
      return `${name}(${status}${missing})`;
    });
}

function attentionCheckCount(report) {
  return Array.isArray(report?.checks)
    ? report.checks.filter((check) => check?.status === 'blocked' || check?.status === 'fail').length
    : 0;
}

function isProtectedPreviewRuntimeBlock(runtime, attentionChecks) {
  const failed = Number(runtime?.failed);
  return (protectedDeploymentDetected || LOCAL_MODE)
    && Number.isFinite(failed)
    && failed <= 1
    && attentionChecks.some((check) => check.startsWith('live:auth-refresh-no-token(fail)'));
}

async function checkPublicUrls() {
  await fetchUrl('public:home', '/', { readBody: false });
  if (LOCAL_MODE && !HAS_EXPLICIT_PACKAGE_ID) {
    addBlockedCheck('public:package-detail', {
      url: `${BASE_URL}/packages/${PACKAGE_ID}`,
      missing: ['OPEN_CHECK_PACKAGE_ID'],
      notes: 'OPEN_CHECK_PACKAGE_ID not provided; local target may not have production package data',
    });
  } else {
    await fetchUrl('public:package-detail', `/packages/${PACKAGE_ID}`, { readBody: false });
  }
  await fetchUrl('public:blog-runtime', '/blog/nagasaki-best', { readBody: false });
  if (LOCAL_MODE && (!HAS_EXPLICIT_REF_CODE || !HAS_EXPLICIT_PACKAGE_ID)) {
    addBlockedCheck('public:referral-link', {
      url: `${BASE_URL}/r/${REF_CODE}/${PACKAGE_ID}`,
      missing: [
        ...(!HAS_EXPLICIT_REF_CODE ? ['OPEN_CHECK_REF_CODE'] : []),
        ...(!HAS_EXPLICIT_PACKAGE_ID ? ['OPEN_CHECK_PACKAGE_ID'] : []),
      ],
      notes: 'OPEN_CHECK_REF_CODE and OPEN_CHECK_PACKAGE_ID are required for local referral-link verification',
    });
  } else {
    await fetchUrl('public:referral-link', `/r/${REF_CODE}/${PACKAGE_ID}`, {
      readBody: false,
      ok: (res, _body, setCookie) => res.status === 200 && /ys_session_id=/.test(setCookie),
      notes: (_res, _body, setCookie) => (setCookie.includes('ys_session_id=') ? 'session cookie issued' : 'missing session cookie'),
    });
  }
}

function checkPublicCriticalAudit() {
  if (protectedDeploymentDetected) {
    addBlockedCheck('public:critical-pages', {
      notes: 'Vercel protected deployment blocks unauthenticated public critical-page audit',
    });
    return;
  }

  const args = [
    'run',
    '--silent',
    'audit:public-critical',
    '--',
    `--base=${BASE_URL}`,
    '--json',
    '--timeout-ms=15000',
  ];
  if (!LOCAL_MODE || HAS_EXPLICIT_PACKAGE_ID) {
    args.splice(7, 0, `--package-id=${PACKAGE_ID}`);
  }

  const result = run(
    'npm',
    args,
    { timeout: 120000 },
  );

  try {
    const audit = parseJsonFromOutput(result.stdout);
    const failedRows = Array.isArray(audit?.results)
      ? audit.results.filter((row) => Array.isArray(row.missing) && row.missing.length > 0)
      : [];
    const auditPassed = result.ok && Number(audit?.summary?.failed ?? failedRows.length) === 0;
    const onlyLocalPackageDetailUnavailable = LOCAL_MODE
      && ALLOW_LOCAL_MISSING_DATA
      && HAS_EXPLICIT_PACKAGE_ID
      && failedRows.length > 0
      && failedRows.every((row) => row.name === 'package-detail');
    const onlyLocalDevLatencyBudgetExceeded = LOCAL_MODE
      && ALLOW_LOCAL_MISSING_DATA
      && failedRows.length > 0
      && failedRows.every((row) => row.missing.every((item) => item === 'over-budget'));
    const localAuditUnavailable = ALLOW_LOCAL_MISSING_DATA && !auditPassed && LOCAL_DATA_UNAVAILABLE_PATTERN.test(
      JSON.stringify({ audit, stderr: result.stderr, stdout: result.stdout }),
    );
    const blockedByLocalCondition = localAuditUnavailable
      || onlyLocalPackageDetailUnavailable
      || onlyLocalDevLatencyBudgetExceeded;
    addCheck('public:critical-pages', auditPassed ? 'pass' : blockedByLocalCondition ? 'blocked' : 'fail', {
      ms: result.ms,
      passed: audit?.summary?.passed ?? null,
      failed: audit?.summary?.failed ?? failedRows.length,
      score: audit?.summary?.score ?? null,
      notes: blockedByLocalCondition
        ? onlyLocalDevLatencyBudgetExceeded
          ? 'local dev server exceeded critical-page latency budget; production/staging performance verification is required'
          : 'local critical-page data unavailable; production/staging data is required for full verification'
        : `score=${audit?.summary?.score ?? 'n/a'}, failed=${audit?.summary?.failed ?? failedRows.length}`,
      error: auditPassed
        ? ''
        : blockedByLocalCondition
          ? ''
        : failedRows
          .slice(0, 4)
          .map((row) => `${row.name}:${row.missing.join('|')}`)
          .join(', ') || (result.stderr || result.message || '').trim().slice(0, 1000),
    });
  } catch (err) {
    addCheck('public:critical-pages', 'fail', {
      ms: result.ms,
      error: (result.stderr || result.stdout || result.message || (err instanceof Error ? err.message : String(err))).trim().slice(0, 1000),
    });
  }
}

function checkSupabaseAuthGate() {
  if (SKIP_EXTERNAL) {
    addBlockedCheck('supabase:auth-open-gate', {
      notes: 'external Supabase management check skipped for local/open-check isolated mode',
    });
    return null;
  }

  const result = run('node', ['scripts/supabase-auth-open-gate.mjs', '--json'], { timeout: 120000 });
  if (!result.ok) {
    const output = (result.stderr || result.stdout || result.message || '').trim();
    const authUnavailable = /Missing Supabase Management API token|SUPABASE_ACCESS_TOKEN|supabase login/i.test(output);
    addCheck('supabase:auth-open-gate', authUnavailable ? 'blocked' : 'fail', {
      ms: result.ms,
      error: authUnavailable ? '' : output.slice(0, 1000),
      notes: authUnavailable ? 'Supabase management token unavailable; skipping Auth open-gate verification' : '',
    });
    return null;
  }

  try {
    const gate = parseJsonFromOutput(result.stdout);
    const status = gate.open_gate_passed ? 'pass' : 'blocked';
    addCheck('supabase:auth-open-gate', status, {
      ms: result.ms,
      password_hibp_enabled: gate.password_hibp_enabled,
      password_policy_hardened: gate.password_policy_hardened,
      site_url: gate.site_url,
      notes: gate.open_gate_passed ? '' : 'HIBP disabled; Supabase Pro or higher required',
    });
    return gate;
  } catch (err) {
    addCheck('supabase:auth-open-gate', 'fail', {
      ms: result.ms,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function checkVercelLogs(level) {
  if (SKIP_EXTERNAL) {
    addBlockedCheck(`vercel:${level}-logs`, {
      target: VERCEL_LOG_TARGET,
      notes: 'Vercel log verification skipped for local/open-check isolated mode',
    });
    return;
  }

  const args = ['--yes', 'vercel', 'logs', VERCEL_LOG_TARGET, '--scope', VERCEL_SCOPE, '--since', '30m', '--no-follow', '--level', level, '--limit', '50', '--json'];
  if (process.env.VERCEL_TOKEN) {
    args.push('--token', process.env.VERCEL_TOKEN);
  }
  const result = run(
    'npx',
    args,
    { timeout: 120000 },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (
    !result.ok &&
    /login|auth|token|unauthorized|forbidden|No existing credentials|do not have access|specified account|scope-not-accessible/i.test(
      output || result.message,
    )
  ) {
    addCheck(`vercel:${level}-logs`, 'blocked', {
      ms: result.ms,
      target: VERCEL_LOG_TARGET,
      exitStatus: result.status ?? null,
      signal: result.signal ?? '',
      notes: 'Vercel token or scope unavailable; skipping recent log verification',
    });
    return;
  }
  const noLogs = result.ok && (output.trim() === '' || /No logs found/i.test(output));
  addCheck(`vercel:${level}-logs`, result.ok && noLogs ? 'pass' : 'fail', {
    ms: result.ms,
    target: VERCEL_LOG_TARGET,
    exitStatus: result.status ?? null,
    signal: result.signal ?? '',
    notes: noLogs ? 'No logs found' : (output.trim() || result.message || '').slice(0, 1200),
  });
}

function checkMarketingAutomationReadiness() {
  const args = ['scripts/verify-marketing-automation-readiness.mjs', '--json', '--strict'];
  const result = run(process.execPath, args, {
    timeout: MARKETING_AUTOMATION_TIMEOUT_MS,
  });
  if (!result.ok) {
    addCheck('local:marketing-automation', 'fail', {
      ms: result.ms,
      command: `${process.execPath} ${args.join(' ')}`,
      error: (result.stderr || result.stdout || result.message || '').trim().slice(0, 1200),
    });
    return;
  }

  try {
    const marketing = parseJsonFromOutput(result.stdout);
    addCheck('local:marketing-automation', marketing.status === 'pass' ? 'pass' : marketing.status === 'blocked' ? 'blocked' : 'fail', {
      ms: result.ms,
      passed: marketing.passed,
      blocked: marketing.blocked,
      failed: marketing.failed,
      notes: `${marketing.passed} passed, ${marketing.blocked} blocked, ${marketing.failed} failed`,
    });
  } catch (err) {
    addCheck('local:marketing-automation', 'fail', {
      ms: result.ms,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function checkMarketingRuntimeLocal() {
  if (!INCLUDE_MARKETING_RUNTIME) return;

  const missingRuntimeEnv = missingImportantEnvVars();
  if (shouldBlockLocalRuntimeForMissingEnv(missingRuntimeEnv)) {
    addCheck('local:marketing-runtime', 'blocked', {
      missing: missingRuntimeEnv,
      notes: 'local marketing runtime probe skipped because runtime integration env is missing in isolated local mode',
    });
    return;
  }

  const args = [
    'scripts/verify-marketing-runtime-local.mjs',
    `--timeout-ms=${MARKETING_RUNTIME_TIMEOUT_MS}`,
    `--ready-timeout-ms=${MARKETING_RUNTIME_READY_TIMEOUT_MS}`,
    '--strict',
  ];
  if (IS_LOCAL_BASE && !MARKETING_RUNTIME_ISOLATED) {
    args.push(`--base=${BASE_URL}`);
  } else if (!LOCAL_MODE) {
    args.push(`--base=${BASE_URL}`);
  } else {
    args.push(`--port=${MARKETING_RUNTIME_PORT}`, `--mode=${MARKETING_RUNTIME_MODE}`);
  }

  const timeout = Number.isFinite(MARKETING_RUNTIME_HARD_TIMEOUT_MS) && MARKETING_RUNTIME_HARD_TIMEOUT_MS > 0
    ? MARKETING_RUNTIME_HARD_TIMEOUT_MS
    : Math.max(MARKETING_RUNTIME_READY_TIMEOUT_MS + MARKETING_RUNTIME_TIMEOUT_MS + 60000, 240000);
  const result = run(process.execPath, args, { timeout });

  try {
    const runtime = parseJsonFromOutput(result.stdout);
    const attentionChecks = attentionChecksFromReport(runtime);
    const attentionCount = attentionCheckCount(runtime);
    const protectedPreviewBlocked = isProtectedPreviewRuntimeBlock(runtime, attentionChecks);
    addCheck('local:marketing-runtime', result.ok && runtime.status === 'pass' ? 'pass' : runtime.status === 'blocked' || protectedPreviewBlocked ? 'blocked' : 'fail', {
      ms: result.ms,
      passed: runtime.passed,
      blocked: runtime.blocked,
      failed: runtime.failed,
      attentionChecks,
      attentionCheckCount: attentionCount,
      notes: protectedPreviewBlocked
        ? `${runtime.passed} passed, ${runtime.blocked} blocked, ${runtime.failed} failed; protected preview requires authenticated runtime probes`
        : `${runtime.passed} passed, ${runtime.blocked} blocked, ${runtime.failed} failed`,
      error: result.ok ? '' : (result.stderr || result.message || '').trim().slice(0, 1200),
    });
  } catch (err) {
    const error = (
      result.message
      || result.stderr
      || result.stdout
      || (err instanceof Error ? err.message : String(err))
    ).trim().slice(0, 1200);
    const localTimeoutUnavailable = LOCAL_MODE
      && ALLOW_LOCAL_MISSING_DATA
      && /ETIMEDOUT|timed out|timeout/i.test(error);
    addCheck('local:marketing-runtime', localTimeoutUnavailable ? 'blocked' : 'fail', {
      ms: result.ms,
      command: `${process.execPath} ${args.join(' ')}`,
      notes: localTimeoutUnavailable
        ? 'local marketing runtime probe timed out in isolated mode; production/staging runtime verification is required'
        : '',
      error: localTimeoutUnavailable ? '' : error,
    });
  }
}

function checkRuntimeEnvReadiness() {
  const missing = missingImportantEnvVars();
  const usingDefaults = DEFAULTED_ENV.filter((key) => !process.env[key]);
  addCheck('runtime:env-readiness', missing.length === 0 ? 'pass' : 'blocked', {
    missing,
    usingDefaults,
    notes: missing.length === 0
      ? usingDefaults.length > 0
        ? `ready; defaults in use for ${usingDefaults.join(', ')}`
        : 'all important env vars present'
      : `${missing.length} important env var(s) missing; affected integrations will stay degraded/skipped`,
  });
}

function opsRequestHeaders() {
  const headers = { Accept: 'application/json' };
  if (process.env.CRON_SECRET) {
    headers.Authorization = `Bearer ${process.env.CRON_SECRET}`;
    return { headers, authMode: 'cron-secret' };
  }
  if (OPEN_CHECK_AUTH_COOKIE) {
    headers.Cookie = OPEN_CHECK_AUTH_COOKIE;
    return { headers, authMode: 'auth-cookie' };
  }
  if (LOCAL_MODE) {
    headers.Cookie = 'ys-dev-admin=1';
    return { headers, authMode: 'dev-admin-cookie' };
  }
  return { headers, authMode: 'none' };
}

async function checkBlogPublicSurfaceMonitor() {
  if (protectedDeploymentDetected) {
    addBlockedCheck('public:blog-surface-monitor', {
      url: `${BASE_URL}/api/ops/blog-system`,
      notes: 'Vercel protected deployment blocks unauthenticated blog surface monitor',
    });
    return;
  }

  const url = `${BASE_URL}/api/ops/blog-system`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  const { headers, authMode } = opsRequestHeaders();

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers,
    });
    const body = await res.text();
    let report = null;
    try {
      report = JSON.parse(body);
    } catch {
      report = null;
    }

    const publicSurfaces = report?.public_surfaces;
    const failed = Number(publicSurfaces?.failed ?? 0);
    const checked = Number(publicSurfaces?.checked ?? 0);
    const warn = Number(publicSurfaces?.warn ?? 0);
    const ok = res.status === 200 && checked > 0 && publicSurfaces?.ok === true;
    const failedIssues = Array.isArray(publicSurfaces?.results)
      ? publicSurfaces.results
        .filter((row) => row && row.ok === false)
        .flatMap((row) => Array.isArray(row.issues) ? row.issues.map((issue) => `${row.id}:${issue}`) : [`${row.id}:unknown`])
      : [];
    const missingOpsAuth = authMode === 'none' && !publicSurfaces;
    const localSurfaceUnavailable = ALLOW_LOCAL_MISSING_DATA && !ok && /db_unavailable_page|silent_zero_posts|blog_api_db_timeout|db_timeout|Blog database is not configured|no blog links found|surface_timeout|operation was aborted|abort/i.test(
      JSON.stringify({ publicSurfaces, body }),
    );
    const status = ok ? 'pass' : localSurfaceUnavailable || missingOpsAuth ? 'blocked' : 'fail';

    addCheck('public:blog-surface-monitor', status, {
      statusCode: res.status,
      ms: Date.now() - started,
      checked,
      failed,
      warn,
      url,
      authMode,
      missing: missingOpsAuth ? ['CRON_SECRET'] : undefined,
      failedIssues,
      notes: ok
        ? `${checked} public blog surface(s) healthy`
        : localSurfaceUnavailable
          ? 'local blog public surfaces require production/staging data or a warm local server for full verification'
          : missingOpsAuth
            ? 'protected ops probe requires CRON_SECRET or OPEN_CHECK_AUTH_COOKIE'
            : `failed=${failed}; ${failedIssues.slice(0, 4).join(', ') || 'inspect /api/ops/blog-system'}`,
      error: ok || localSurfaceUnavailable || missingOpsAuth
        ? ''
        : (failedIssues.join(', ') || body || `HTTP ${res.status}`).slice(0, 1200),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const localProbeUnavailable = ALLOW_LOCAL_MISSING_DATA
      && /fetch failed|ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET|terminated|operation was aborted|abort/i.test(error);
    addCheck('public:blog-surface-monitor', localProbeUnavailable ? 'blocked' : 'fail', {
      statusCode: null,
      ms: Date.now() - started,
      url,
      authMode,
      notes: localProbeUnavailable
        ? 'local blog surface monitor endpoint was unavailable; production/staging data or a warm local server is required for full verification'
        : '',
      error: localProbeUnavailable ? '' : error,
    });
  } finally {
    clearTimeout(timer);
  }
}

function checkBlogSearchQualityReadiness() {
  if (protectedDeploymentDetected) {
    addBlockedCheck('public:blog-search-quality', {
      notes: 'Vercel protected deployment blocks unauthenticated blog search quality audit',
    });
    return;
  }

  const args = [
    'run',
    '--silent',
    'audit:blog-search-daily',
    '--',
    `--base=${BASE_URL}`,
    '--strict',
    '--json',
    `--limit=${BLOG_AUDIT_LIMIT}`,
    `--site-limit=${BLOG_AUDIT_SITE_LIMIT}`,
    `--timeout-ms=${BLOG_AUDIT_TIMEOUT_MS}`,
    `--hard-timeout-ms=${BLOG_AUDIT_HARD_TIMEOUT_MS}`,
  ];
  const result = run('npm', args, { timeout: Math.max(BLOG_AUDIT_HARD_TIMEOUT_MS + 30000, 240000) });

  try {
    const report = parseJsonFromOutput(result.stdout);
    const summary = report?.summary || {};
    const failedRequiredChecks = Array.isArray(summary.failedRequiredChecks)
      ? summary.failedRequiredChecks
      : [];
    const issueCounts = summary.issueCounts && typeof summary.issueCounts === 'object'
      ? summary.issueCounts
      : {};
    const passed = result.ok && summary.ok === true;
    const missingLocalData = ALLOW_LOCAL_MISSING_DATA && !passed && LOCAL_DATA_UNAVAILABLE_PATTERN.test(
      JSON.stringify({ summary, checks: report?.checks || [], stderr: result.stderr, stdout: result.stdout }),
    );

    addCheck('public:blog-search-quality', passed ? 'pass' : missingLocalData ? 'blocked' : 'fail', {
      ms: result.ms,
      strictScore: summary.strictScore ?? null,
      fleetScore: summary.fleetScore ?? null,
      failedRequiredChecks,
      issueCounts,
      reportPath: report?.reportPath || '',
      notes: passed
        ? `strict=${summary.strictScore ?? 'n/a'}, fleet=${summary.fleetScore ?? 'n/a'}`
        : missingLocalData
          ? 'local blog data unavailable; production/staging data is required for full blog quality verification'
        : `failed=${failedRequiredChecks.join(', ') || 'unknown'}, strict=${summary.strictScore ?? 'n/a'}`,
      error: passed
        ? ''
        : missingLocalData
          ? ''
        : (
            failedRequiredChecks.join(', ') ||
            Object.keys(issueCounts).join(', ') ||
            result.stderr ||
            result.message ||
            ''
          ).trim().slice(0, 1200),
    });
  } catch (err) {
    addCheck('public:blog-search-quality', 'fail', {
      ms: result.ms,
      command: `npm ${args.join(' ')}`,
      error: (result.stderr || result.stdout || result.message || (err instanceof Error ? err.message : String(err))).trim().slice(0, 1200),
    });
  }
}

async function main() {
  await checkPublicUrls();
  checkPublicCriticalAudit();
  checkSupabaseAuthGate();
  checkMarketingAutomationReadiness();
  checkMarketingRuntimeLocal();
  checkRuntimeEnvReadiness();
  await checkBlogPublicSurfaceMonitor();
  checkBlogSearchQualityReadiness();
  checkVercelLogs('error');
  checkVercelLogs('fatal');

  if (strict) {
    checkCommand('local:type-check', 'npm', ['run', 'type-check'], { timeout: 180000 });
    checkCommand('local:lint-secrets', 'npm', ['run', 'lint:secrets', '--', '--all'], { timeout: 180000 });
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const blocked = checks.filter((check) => check.status === 'blocked');
  const passed = checks.filter((check) => check.status === 'pass');
  const warnings = releaseWarnings();
  const summary = {
    status: failed.length > 0 ? 'fail' : blocked.length > 0 ? 'blocked' : 'pass',
    passed: passed.length,
    blocked: blocked.length,
    failed: failed.length,
    warnings: warnings.length,
    releaseBlockers: releaseBlockers(),
    releaseWarnings: warnings,
    checks,
  };

  writeReport(REPORT_PATH, summary);

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const check of checks) {
      const suffix = check.notes ? ` - ${check.notes}` : check.error ? ` - ${check.error}` : '';
      console.log(`${check.status.toUpperCase().padEnd(7)} ${check.name}${suffix}`);
    }
    console.log(
      `\n[open-readiness] ${summary.status}: ${passed.length} passed, ${blocked.length} blocked, ${failed.length} failed, ${warnings.length} warnings`,
    );
    if (warnings.length > 0) {
      console.log(`[open-readiness] warnings: ${warningPreview(warnings)}`);
    }
  }

  if (failed.length > 0) process.exit(1);
  if (strict && blocked.length > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
