#!/usr/bin/env node

import { execFileSync, execSync } from 'node:child_process';

const BASE_URL = (process.env.OPEN_CHECK_BASE_URL || 'https://www.yeosonam.com').replace(/\/$/, '');
const DEFAULT_PACKAGE_ID = '17945abe-026e-4696-96d0-2d8b14393fe6';
const DEFAULT_REF = 'YSINF202606051602318291';
const PACKAGE_ID = process.env.OPEN_CHECK_PACKAGE_ID || DEFAULT_PACKAGE_ID;
const REF_CODE = process.env.OPEN_CHECK_REF_CODE || DEFAULT_REF;
const VERCEL_SCOPE = process.env.VERCEL_SCOPE || 'zzbaa0317-4596s-projects';
const VERCEL_LOG_TARGET = process.env.VERCEL_LOG_TARGET || BASE_URL;
const TIMEOUT_MS = Number(process.env.OPEN_CHECK_TIMEOUT_MS || 30000);
const BLOG_AUDIT_LIMIT = Number(process.env.OPEN_CHECK_BLOG_AUDIT_LIMIT || 10);
const BLOG_AUDIT_SITE_LIMIT = Number(process.env.OPEN_CHECK_BLOG_AUDIT_SITE_LIMIT || 50);
const BLOG_AUDIT_TIMEOUT_MS = Number(process.env.OPEN_CHECK_BLOG_AUDIT_TIMEOUT_MS || 15000);
const BLOG_AUDIT_HARD_TIMEOUT_MS = Number(process.env.OPEN_CHECK_BLOG_AUDIT_HARD_TIMEOUT_MS || 180000);

const strict = process.argv.includes('--strict');
const json = process.argv.includes('--json');

const checks = [];

function addCheck(name, status, detail = {}) {
  checks.push({ name, status, ...detail });
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

async function fetchUrl(name, path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      redirect: options.redirect || 'manual',
      signal: controller.signal,
      headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...(options.headers || {}) },
    });
    const body = options.readBody === false ? '' : await res.text();
    const setCookie = res.headers.get('set-cookie') || '';
    const ok = options.ok ? options.ok(res, body, setCookie) : res.status >= 200 && res.status < 400;
    addCheck(name, ok ? 'pass' : 'fail', {
      statusCode: res.status,
      ms: Date.now() - started,
      url,
      location: res.headers.get('location') || '',
      notes: options.notes?.(res, body, setCookie) || '',
    });
  } catch (err) {
    addCheck(name, 'fail', {
      statusCode: null,
      ms: Date.now() - started,
      url,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
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

async function checkPublicUrls() {
  await fetchUrl('public:home', '/', { readBody: false });
  await fetchUrl('public:package-detail', `/packages/${PACKAGE_ID}`, { readBody: false });
  await fetchUrl('public:blog-runtime', '/blog/nagasaki-best', { readBody: false });
  await fetchUrl('public:referral-link', `/r/${REF_CODE}/${PACKAGE_ID}`, {
    readBody: false,
    ok: (res, _body, setCookie) => res.status === 200 && /ys_session_id=/.test(setCookie),
    notes: (_res, _body, setCookie) => (setCookie.includes('ys_session_id=') ? 'session cookie issued' : 'missing session cookie'),
  });
}

function checkPublicCriticalAudit() {
  const result = run(
    'npm',
    ['run', '--silent', 'audit:public-critical', '--', `--base=${BASE_URL}`, `--package-id=${PACKAGE_ID}`, '--json', '--timeout-ms=15000'],
    { timeout: 120000 },
  );

  try {
    const audit = parseJsonFromOutput(result.stdout);
    const failedRows = Array.isArray(audit?.results)
      ? audit.results.filter((row) => Array.isArray(row.missing) && row.missing.length > 0)
      : [];
    const auditPassed = result.ok && Number(audit?.summary?.failed ?? failedRows.length) === 0;
    addCheck('public:critical-pages', auditPassed ? 'pass' : 'fail', {
      ms: result.ms,
      passed: audit?.summary?.passed ?? null,
      failed: audit?.summary?.failed ?? failedRows.length,
      score: audit?.summary?.score ?? null,
      notes: `score=${audit?.summary?.score ?? 'n/a'}, failed=${audit?.summary?.failed ?? failedRows.length}`,
      error: auditPassed
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
  if (!result.ok && /login|auth|token|unauthorized|forbidden|No existing credentials/i.test(output || result.message)) {
    addCheck(`vercel:${level}-logs`, 'blocked', {
      ms: result.ms,
      target: VERCEL_LOG_TARGET,
      exitStatus: result.status ?? null,
      signal: result.signal ?? '',
      notes: 'Vercel token unavailable; skipping recent log verification',
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
  const result = run('npm', ['run', '--silent', 'verify:marketing-automation', '--', '--json', '--strict'], { timeout: 120000 });
  if (!result.ok) {
    addCheck('local:marketing-automation', 'fail', {
      ms: result.ms,
      command: 'npm run --silent verify:marketing-automation -- --json --strict',
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

function checkBlogSearchQualityReadiness() {
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

    addCheck('public:blog-search-quality', passed ? 'pass' : 'fail', {
      ms: result.ms,
      strictScore: summary.strictScore ?? null,
      fleetScore: summary.fleetScore ?? null,
      failedRequiredChecks,
      issueCounts,
      reportPath: report?.reportPath || '',
      notes: passed
        ? `strict=${summary.strictScore ?? 'n/a'}, fleet=${summary.fleetScore ?? 'n/a'}`
        : `failed=${failedRequiredChecks.join(', ') || 'unknown'}, strict=${summary.strictScore ?? 'n/a'}`,
      error: passed
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
  const summary = {
    status: failed.length > 0 ? 'fail' : blocked.length > 0 ? 'blocked' : 'pass',
    passed: passed.length,
    blocked: blocked.length,
    failed: failed.length,
    checks,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const check of checks) {
      const suffix = check.notes ? ` - ${check.notes}` : check.error ? ` - ${check.error}` : '';
      console.log(`${check.status.toUpperCase().padEnd(7)} ${check.name}${suffix}`);
    }
    console.log(`\n[open-readiness] ${summary.status}: ${passed.length} passed, ${blocked.length} blocked, ${failed.length} failed`);
  }

  if (failed.length > 0) process.exit(1);
  if (strict && blocked.length > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
