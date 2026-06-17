#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function argValue(name, fallback = null) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const baseUrl = (argValue('--base', process.env.BLOG_AUDIT_BASE_URL || 'https://www.yeosonam.com') || '').replace(/\/$/, '');
const preferredOrigin = (argValue('--preferred-origin', process.env.BLOG_CANONICAL_ORIGIN || 'https://www.yeosonam.com') || '').replace(/\/$/, '');
const full = hasFlag('--full');
const strict = hasFlag('--strict');
const outputJson = hasFlag('--json');
const limit = Number(argValue('--limit', full ? '0' : '30')) || 0;
const siteLimit = Number(argValue('--site-limit', full ? '0' : '200')) || 0;
const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', process.env.BLOG_AUDIT_TIMEOUT_MS || '15000')) || 15000);
const hardTimeoutMs = Math.max(timeoutMs + 1000, Number(argValue('--hard-timeout-ms', process.env.BLOG_AUDIT_HARD_TIMEOUT_MS || String(Math.max(30000, timeoutMs * 4)))) || 0);
const outDir = argValue('--out-dir', '.tmp') || '.tmp';
const hasSupabaseAdminEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const editorialSource = argValue('--editorial-source', hasSupabaseAdminEnv ? 'db' : 'web') || (hasSupabaseAdminEnv ? 'db' : 'web');
const timeoutArg = `--timeout-ms=${timeoutMs}`;
const hardTimeoutArg = `--hard-timeout-ms=${hardTimeoutMs}`;

if (!baseUrl) {
  console.error('--base is required');
  process.exit(1);
}

function withLimit(extraArgs, value) {
  if (!value || value <= 0) return extraArgs;
  return [...extraArgs, `--limit=${value}`];
}

const checks = [
  {
    id: 'render_integrity',
    label: 'Blog render integrity',
    owner: 'content',
    required: true,
    script: 'audit:blog-render:browser',
    args: withLimit([`--base=${baseUrl}`, '--json', timeoutArg, hardTimeoutArg], limit),
  },
  {
    id: 'image_quality',
    label: 'Blog image quality',
    owner: 'content',
    required: true,
    script: 'audit:blog-images',
    args: withLimit([`--base=${baseUrl}`, '--json', timeoutArg, hardTimeoutArg], limit),
  },
  {
    id: 'seo_quality',
    label: 'Naver-first blog SEO quality',
    owner: 'naver',
    required: true,
    script: 'audit:blog-seo',
    args: withLimit([`--base=${baseUrl}`, '--json'], limit),
  },
  {
    id: 'editorial_intent',
    label: 'Editorial intent quality',
    owner: 'naver',
    required: true,
    script: 'audit:blog-editorial',
    args: withLimit([`--base=${baseUrl}`, `--source=${editorialSource}`, '--strict', '--json'], limit),
  },
  {
    id: 'revenue_funnel',
    label: 'Blog revenue funnel readiness',
    owner: 'business',
    required: true,
    script: 'audit:blog-revenue-funnel',
    args: ['--json'],
  },
  {
    id: 'google_domain',
    label: 'Google canonical/GSC domain alignment',
    owner: 'google',
    required: true,
    script: 'audit:blog-gsc-domain',
    args: [`--preferred-origin=${preferredOrigin}`, '--strict', '--json'],
  },
  {
    id: 'site_indexability',
    label: 'Google/Naver crawl and indexability gate',
    owner: 'google',
    required: true,
    script: 'audit:site-indexability',
    args: withLimit([`--base=${baseUrl}`, '--strict', '--json'], siteLimit),
  },
];

const PROCESS_PATTERNS_BY_CHECK_ID = {
  render_integrity: 'audit-blog-render-integrity',
  image_quality: 'audit-blog-image-quality',
  seo_quality: 'audit-blog-seo-quality',
  editorial_intent: 'audit-blog-editorial-quality',
  google_domain: 'audit-blog-gsc-domain',
  site_indexability: 'audit-site-indexability',
};

function parseJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function scoreFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.score === 'number') return payload.score;
  if (typeof payload.summary?.score === 'number') return payload.summary.score;
  if (typeof payload.summary?.averageScore === 'number') return payload.summary.averageScore;
  if (typeof payload.result?.score === 'number') return payload.result.score;
  return null;
}

function failedFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.failed === 'number') return payload.failed;
  if (typeof payload.summary?.failed === 'number') return payload.summary.failed;
  if (Array.isArray(payload.failedExamples)) return payload.failedExamples.length;
  if (Array.isArray(payload.checks)) return payload.checks.filter((check) => check && check.passed === false).length;
  return null;
}

function errorsFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  if (typeof payload.errors === 'number') return payload.errors;
  if (typeof payload.summary?.errors === 'number') return payload.summary.errors;
  return 0;
}

function strictIssues(row) {
  const issues = [];
  const failed = typeof row.failed === 'number' ? row.failed : 0;
  const errors = errorsFromPayload(row.payload);

  if (!row.ok) {
    issues.push({
      code: `${row.id}.command_failed`,
      severity: 'major',
      message: `${row.id} command exited with ${row.exitCode ?? 'unknown status'}`,
    });
  }
  if (errors > 0) {
    issues.push({
      code: `${row.id}.runtime_errors`,
      severity: 'critical',
      message: `${row.id} reported ${errors} runtime errors`,
    });
  }
  if (failed > 0) {
    issues.push({
      code: `${row.id}.failed_items`,
      severity: 'major',
      message: `${row.id} reported ${failed} failed items`,
    });
  }
  if (typeof row.score === 'number' && row.score < 100) {
    issues.push({
      code: `${row.id}.score_below_100`,
      severity: failed > 0 || !row.ok ? 'major' : 'minor',
      message: `${row.id} score is ${row.score}/100`,
    });
  }

  return issues;
}

function strictScoreFromIssues(issues) {
  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === 'critical') return sum + 25;
    if (issue.severity === 'major') return sum + 15;
    return sum + 5;
  }, 0);
  return Math.max(0, 100 - penalty);
}

function isStrictScore100(row) {
  return row.ok && strictIssues(row).length === 0;
}

function cleanupTimedOutCheck(check) {
  const pattern = PROCESS_PATTERNS_BY_CHECK_ID[check.id];
  if (!pattern) return;

  if (process.platform === 'win32') {
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `$targets = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*${pattern}*' }; foreach ($p in $targets) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { encoding: 'utf8', timeout: 5000 });
    return;
  }

  spawnSync('pkill', ['-f', pattern], { encoding: 'utf8', timeout: 5000 });
}

function runCheck(check) {
  const startedAt = Date.now();
  const command = process.platform === 'win32' ? 'cmd.exe' : npmBin;
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', npmBin, 'run', check.script, '--', ...check.args]
    : ['run', check.script, '--', ...check.args];
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    shell: false,
    timeout: Math.max(10000, hardTimeoutMs + 5000),
  });
  const payload = parseJson(result.stdout);
  if (result.error && result.error.code === 'ETIMEDOUT') {
    cleanupTimedOutCheck(check);
  }
  const score = scoreFromPayload(payload);
  const failed = failedFromPayload(payload);
  const ok = result.status === 0;
  return {
    id: check.id,
    label: check.label,
    owner: check.owner,
    required: check.required,
    ok,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    score,
    failed,
    errors: errorsFromPayload(payload),
    command: `npm run ${check.script} -- ${check.args.join(' ')}`,
    stdout: outputJson ? undefined : String(result.stdout || '').trim().slice(-4000),
    stderr: [
      result.error ? result.error.message : '',
      String(result.stderr || '').trim(),
    ].filter(Boolean).join('\n').slice(-4000),
    payload,
  };
}

function summarize(results) {
  const required = results.filter((row) => row.required);
  const requiredIssues = required.flatMap((row) => strictIssues(row).map((issue) => ({ ...issue, component: row.id })));
  const non100Required = required.filter((row) => !isStrictScore100(row));
  const scoreRows = results.filter((row) => typeof row.score === 'number');
  const averageScore = scoreRows.length > 0
    ? Math.round(scoreRows.reduce((sum, row) => sum + row.score, 0) / scoreRows.length)
    : null;
  const issueCounts = {};
  for (const issue of requiredIssues) {
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
  }
  const ownerStatus = {};
  for (const owner of ['naver', 'google', 'content', 'business']) {
    const rows = results.filter((row) => row.owner === owner);
    const ownerIssues = rows.flatMap((row) => strictIssues(row));
    const score100Checks = rows.filter(isStrictScore100).length;
    ownerStatus[owner] = {
      ok: rows.every(isStrictScore100),
      checks: rows.length,
      score100Checks,
      failed: rows.length - score100Checks,
      issues: ownerIssues.length,
      averageScore: rows.some((row) => typeof row.score === 'number')
        ? Math.round(rows.filter((row) => typeof row.score === 'number').reduce((sum, row) => sum + row.score, 0) / rows.filter((row) => typeof row.score === 'number').length)
        : null,
    };
  }
  const score100Checks = required.filter(isStrictScore100).length;
  const strictScore = requiredIssues.length === 0 ? 100 : strictScoreFromIssues(requiredIssues);
  return {
    ok: non100Required.length === 0,
    baseUrl,
    preferredOrigin,
    mode: full ? 'full' : 'daily-sample',
    limit: limit || null,
    siteLimit: siteLimit || null,
    averageScore,
    strictScore,
    fleetScore: required.length === 0 ? 0 : Math.floor((score100Checks / required.length) * 100),
    requiredChecks: required.length,
    score100Checks,
    failedRequiredChecks: non100Required.map((row) => row.id),
    issueCounts,
    strictPolicy: {
      score100Definition: 'Every required check must exit successfully with zero failed items, zero runtime errors, and no reported score below 100.',
      diagnosticPenalty: 'critical -25, major -15, minor -5; PASS requires zero issues, not just a high average.',
      repairScope: 'all public blog posts',
    },
    ownerStatus,
    policy: {
      publishingSource: 'yeosonam.com /blog',
      naverRole: 'primary Korean SERP, longtail intent, IndexNow notification',
      googleRole: 'GSC metrics, URL inspection, sitemap/canonical/indexability health',
      naverBlogDirectPublish: 'not enabled; naver-blog-export adapter is still a stub',
    },
  };
}

const startedAt = new Date().toISOString();
const results = checks.map(runCheck);
const summary = summarize(results);
const report = {
  summary,
  checks: results,
  startedAt,
  finishedAt: new Date().toISOString(),
};

fs.mkdirSync(outDir, { recursive: true });
const reportPath = path.join(outDir, `blog-search-quality-daily-${startedAt.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (outputJson) {
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} else {
  console.log(`Blog search quality daily: ${summary.ok ? 'PASS' : 'FAIL'} strict=${summary.strictScore}/100 fleet=${summary.fleetScore}/100${summary.averageScore === null ? '' : ` avg=${summary.averageScore}/100`}`);
  console.log(`Base=${baseUrl} mode=${summary.mode} report=${reportPath}`);
  console.log(`Policy: source=/blog, Naver=primary SERP/IndexNow, Google=GSC/sitemap/indexability`);
  for (const row of results) {
    const status = isStrictScore100(row) ? 'PASS' : 'FAIL';
    const score = typeof row.score === 'number' ? ` score=${row.score}` : '';
    const failed = typeof row.failed === 'number' ? ` failed=${row.failed}` : '';
    const errors = row.errors > 0 ? ` errors=${row.errors}` : '';
    console.log(`- ${status} ${row.id}${score}${failed}${errors} (${Math.round(row.durationMs / 1000)}s)`);
    if (!row.ok && row.stderr) console.log(`  ${row.stderr.split('\n').slice(-2).join(' ')}`);
  }
}

if (strict && !summary.ok) process.exitCode = 1;
