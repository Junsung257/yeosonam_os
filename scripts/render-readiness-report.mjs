#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return argv.includes(name);
}

const kind = argValue('--kind', 'open');
const reportPath = argValue('--report', '');
const summaryOut = argValue('--summary-out', '');
const issueBodyOut = argValue('--issue-body-out', '');
const metaOut = argValue('--meta-out', '');
const operationalTemplatePath = argValue('--operational-template', '');
const operationalPlanPath = argValue('--operational-plan', '');
const operationalApplyScriptPath = argValue('--operational-apply-script', '');
const operationalVercelScriptPath = argValue('--operational-vercel-script', '');
const operationalNodeApplyScriptPath = argValue('--operational-node-apply-script', '');
const operationalNodeVercelScriptPath = argValue('--operational-node-vercel-script', '');
const operationalEnvFilePath = argValue('--operational-env-file', '');
const selfTest = hasFlag('--self-test');

const KIND_CONFIG = {
  open: {
    title: 'Open Readiness',
    issueTitle: '[readiness] Open readiness attention items',
    legacyIssueTitles: ['[readiness] Open readiness blockers'],
    issueHeading: 'Open Readiness Attention Items',
    marker: '<!-- readiness-open-blockers -->',
    recoveryText: 'Open readiness is passing again.',
    countSuffix: '',
    checkColumns: ['Check', 'Status', 'Duration ms', 'Notes'],
    blockerColumns: ['Name', 'Status', 'Notes'],
  },
  'local-release': {
    title: 'Local Release Readiness',
    issueTitle: '[readiness] Local release readiness attention items',
    legacyIssueTitles: ['[readiness] Local release readiness blockers'],
    issueHeading: 'Local Release Readiness Attention Items',
    marker: '<!-- readiness-local-release-blockers -->',
    recoveryText: 'Local release readiness is passing again.',
    countSuffix: ' / Total: ${total}',
    checkColumns: ['Check', 'Status', 'Duration ms', 'Failed', 'Blocked'],
    blockerColumns: ['Source', 'Name', 'Status', 'Notes'],
  },
  'marketing-release': {
    title: 'Marketing Release Readiness',
    issueTitle: '[readiness] Marketing release readiness attention items',
    legacyIssueTitles: ['[readiness] Marketing release readiness blockers'],
    issueHeading: 'Marketing Release Readiness Attention Items',
    marker: '<!-- readiness-marketing-release-blockers -->',
    recoveryText: 'Marketing release readiness is passing again.',
    countSuffix: ' / Total: ${total}',
    checkColumns: ['Check', 'Status', 'Duration ms', 'Failed', 'Blocked'],
    blockerColumns: ['Source', 'Name', 'Status', 'Notes'],
  },
};

function configFor(value) {
  const config = KIND_CONFIG[value];
  if (!config) {
    throw new Error(`Unknown --kind "${value}". Use one of: ${Object.keys(KIND_CONFIG).join(', ')}`);
  }
  return config;
}

function isReleaseKind(value) {
  return value === 'local-release' || value === 'marketing-release';
}

function sampleReportFor(value) {
  if (value === 'local-release') {
    return {
      status: 'blocked',
      passed: 2,
      blocked: 1,
      failed: 0,
      total: 3,
      operationalEnvFile: {
        path: '.tmp/local-release-operational-inputs-discovered.env',
        loadedKeys: ['OPEN_CHECK_PACKAGE_ID', 'MARKETING_CHECK_CARD_NEWS_ID'],
      },
      releaseBlockers: [{
        source: 'open-readiness-local-full',
        name: 'runtime:env-readiness',
        status: 'blocked',
        notes: 'sample missing env',
        missing: ['SERPAPI_KEY'],
      }, {
        source: 'open-readiness-local-full',
        name: 'public:blog-search-quality',
        status: 'blocked',
        notes: 'sample blog quality blocker',
        failedRequiredChecks: ['render_integrity', 'seo_quality'],
        strictScore: 0,
        fleetScore: 28,
        issueCounts: {
          'render_integrity.blocked_items': 1,
          'seo_quality.failed_items': 2,
        },
      }, {
        source: 'open-readiness-local-full',
        name: 'public:blog-surface-monitor',
        status: 'blocked',
        notes: 'sample public surface blocker',
        authMode: 'dev-admin-cookie',
        checked: 11,
        surfaceFailures: 2,
        surfaceWarnings: 1,
        failedIssues: ['blog-list:db_unavailable_page', 'api-blog:blog_api_db_timeout'],
      }, {
        source: 'open-readiness-local-full',
        name: 'local:marketing-runtime',
        status: 'blocked',
        notes: 'sample runtime blocker',
        attentionChecks: [
          'live:dev-admin-cookie(blocked)',
          'live:api:/api/meta/campaigns(blocked)',
        ],
        attentionCheckCount: 3,
      }],
      releaseWarnings: [{
        source: 'operational-inputs',
        name: 'runtime-defaults',
        status: 'warn',
        notes: 'sample default env',
        missing: ['AD_FLAG_UP_BID_FACTOR'],
        alternatives: ['AD_OFFPEAK_BID_FACTOR'],
      }],
      checks: [
        { id: 'type-check', status: 'pass', durationMs: 111 },
        {
          id: 'operational-input-discovery',
          status: 'blocked',
          durationMs: 33,
          blocked: 1,
          failed: 0,
          envFilePath: '.tmp/local-release-operational-inputs-discovered.env',
        },
        {
          id: 'operational-inputs',
          status: 'blocked',
          durationMs: 111,
          blocked: 1,
          failed: 0,
          templatePath: '.tmp/local-release-operational-inputs.env.example',
          actionPlanPath: '.tmp/local-release-operational-inputs-action-plan.md',
          applyScriptPath: '.tmp/local-release-operational-inputs-apply.sh',
          vercelScriptPath: '.tmp/local-release-operational-inputs-vercel-env.sh',
          nodeApplyScriptPath: '.tmp/local-release-operational-inputs-apply.mjs',
          nodeVercelScriptPath: '.tmp/local-release-operational-inputs-vercel-env.mjs',
          envFilePath: '.tmp/local-release-operational-inputs-discovered.env',
        },
        { id: 'open-readiness-local-full', status: 'blocked', durationMs: 222, blocked: 1, failed: 0 },
      ],
    };
  }

  if (value === 'marketing-release') {
    return {
      kind: 'marketing-release',
      status: 'blocked',
      strict: false,
      passed: 3,
      blocked: 2,
      warnings: 1,
      failed: 0,
      total: 5,
      artifacts: {
        operationalEnvFile: '.tmp/marketing-release-operational-inputs-discovered.env',
        operationalTemplate: '.tmp/marketing-release-operational-inputs.env.example',
        operationalPlan: '.tmp/marketing-release-operational-inputs-action-plan.md',
        operationalApplyScript: '.tmp/marketing-release-operational-inputs-apply.sh',
        operationalVercelScript: '.tmp/marketing-release-operational-inputs-vercel-env.sh',
        operationalNodeApplyScript: '.tmp/marketing-release-operational-inputs-apply.mjs',
        operationalNodeVercelScript: '.tmp/marketing-release-operational-inputs-vercel-env.mjs',
      },
      releaseBlockers: [{
        source: 'operational-input-discovery',
        name: 'operational-input-discovery',
        status: 'blocked',
        notes: 'sample missing probe ids',
        missing: ['OPEN_CHECK_PACKAGE_ID', 'MARKETING_CHECK_CARD_NEWS_ID'],
      }, {
        source: 'operational-inputs',
        name: 'runtime:env-readiness',
        status: 'blocked',
        notes: 'sample missing env',
        missing: ['SERPAPI_KEY'],
      }, {
        source: 'marketing-runtime-local',
        name: 'local:marketing-runtime',
        status: 'blocked',
        notes: 'sample runtime blocker',
        attentionChecks: [
          'live:dev-admin-cookie(blocked)',
          'live:api:/api/meta/campaigns(blocked)',
        ],
        attentionCheckCount: 3,
      }],
      releaseWarnings: [{
        source: 'operational-inputs',
        name: 'runtime-defaults',
        status: 'warn',
        notes: 'sample default env',
        missing: ['AD_FLAG_UP_BID_FACTOR'],
        alternatives: ['AD_OFFPEAK_BID_FACTOR'],
      }],
      checks: [
        { id: 'type-check', status: 'pass', durationMs: 111 },
        { id: 'lint', status: 'pass', durationMs: 222 },
        { id: 'marketing-automation', status: 'pass', durationMs: 333, passed: 54, blocked: 0, failed: 0 },
        {
          id: 'operational-input-discovery',
          status: 'blocked',
          durationMs: 44,
          blocked: 1,
          failed: 0,
          missing: ['OPEN_CHECK_PACKAGE_ID', 'MARKETING_CHECK_CARD_NEWS_ID'],
          envFilePath: '.tmp/marketing-release-operational-inputs-discovered.env',
        },
        {
          id: 'operational-inputs',
          status: 'blocked',
          durationMs: 555,
          blocked: 1,
          failed: 0,
          missing: ['SERPAPI_KEY'],
          templatePath: '.tmp/marketing-release-operational-inputs.env.example',
          actionPlanPath: '.tmp/marketing-release-operational-inputs-action-plan.md',
          applyScriptPath: '.tmp/marketing-release-operational-inputs-apply.sh',
          vercelScriptPath: '.tmp/marketing-release-operational-inputs-vercel-env.sh',
          nodeApplyScriptPath: '.tmp/marketing-release-operational-inputs-apply.mjs',
          nodeVercelScriptPath: '.tmp/marketing-release-operational-inputs-vercel-env.mjs',
          envFilePath: '.tmp/marketing-release-operational-inputs-discovered.env',
        },
        {
          id: 'marketing-runtime-local',
          status: 'blocked',
          durationMs: 666,
          blocked: 1,
          failed: 0,
          attentionChecks: [
            'live:dev-admin-cookie(blocked)',
            'live:api:/api/meta/campaigns(blocked)',
          ],
          attentionCheckCount: 3,
        },
      ],
    };
  }

  return {
    status: 'blocked',
    passed: 2,
    blocked: 2,
    failed: 0,
    releaseBlockers: [{
      name: 'runtime:env-readiness',
      status: 'blocked',
      notes: 'sample missing env',
      missing: ['SERPAPI_KEY'],
    }, {
      name: 'public:blog-search-quality',
      status: 'blocked',
      notes: 'sample blog quality blocker',
      failedRequiredChecks: ['render_integrity', 'seo_quality'],
      strictScore: 0,
      fleetScore: 28,
      issueCounts: {
        'render_integrity.blocked_items': 1,
        'seo_quality.failed_items': 2,
      },
    }, {
      name: 'public:blog-surface-monitor',
      status: 'blocked',
      notes: 'sample public surface blocker',
      authMode: 'dev-admin-cookie',
      checked: 11,
      surfaceFailures: 2,
      surfaceWarnings: 1,
      failedIssues: ['blog-list:db_unavailable_page', 'api-blog:blog_api_db_timeout'],
    }, {
      name: 'local:marketing-runtime',
      status: 'blocked',
      notes: 'sample runtime blocker',
      attentionChecks: [
        'live:dev-admin-cookie(blocked)',
        'live:api:/api/meta/campaigns(blocked)',
      ],
      attentionCheckCount: 3,
    }],
    releaseWarnings: [{
      source: 'operational-inputs',
      name: 'runtime-defaults',
      status: 'warn',
      notes: 'sample default env',
      missing: ['AD_FLAG_UP_BID_FACTOR'],
      alternatives: ['AD_OFFPEAK_BID_FACTOR'],
    }],
    checks: [
      { name: 'public:home', status: 'pass', ms: 99, notes: 'ok' },
      {
        name: 'operational-inputs',
        status: 'blocked',
        ms: 1,
        notes: 'sample missing env',
        templatePath: '.tmp/operational-readiness-inputs.env.example',
        actionPlanPath: '.tmp/operational-readiness-action-plan.md',
        applyScriptPath: '.tmp/operational-readiness-apply-inputs.sh',
        vercelScriptPath: '.tmp/operational-readiness-vercel-env.sh',
        nodeApplyScriptPath: '.tmp/operational-readiness-apply-inputs.mjs',
        nodeVercelScriptPath: '.tmp/operational-readiness-vercel-env.mjs',
        envFilePath: '.tmp/operational-readiness-discovered.env',
      },
      { name: 'runtime:env-readiness', status: 'blocked', ms: 1, notes: 'sample missing env' },
    ],
  };
}

function readReport(path) {
  if (selfTest) return sampleReportFor(kind);
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function missingReportFor(value, path) {
  const name = value === 'local-release'
    ? 'local-release:report'
    : value === 'marketing-release'
      ? 'marketing-release:report'
      : 'open-readiness:report';
  const notes = path
    ? `Readiness report was not created at ${path}; inspect workflow logs before trusting this run.`
    : 'Readiness report path was not provided; inspect workflow logs before trusting this run.';
  return {
    status: 'missing',
    passed: 0,
    blocked: 1,
    failed: 0,
    total: 1,
    releaseBlockers: [{
      source: name,
      name,
      status: 'blocked',
      notes,
      reportPath: path || undefined,
    }],
    checks: [{
      id: name,
      name,
      status: 'blocked',
      notes,
      reportPath: path || undefined,
    }],
  };
}

function ensureParent(path) {
  if (!path) return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

function writeText(path, value) {
  if (!path) return;
  ensureParent(path);
  writeFileSync(path, `${value.replace(/\s+$/, '')}\n`);
}

function writeJson(path, value) {
  if (!path) return;
  ensureParent(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function firstText(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') ?? '';
}

function issueCountSummary(issueCounts, limit = 8) {
  if (!issueCounts || typeof issueCounts !== 'object') return '';
  const entries = Object.entries(issueCounts)
    .filter(([, count]) => Number.isFinite(Number(count)))
    .map(([name, count]) => `${name}=${Number(count)}`);
  if (entries.length === 0) return '';
  const visible = entries.slice(0, limit);
  const remaining = entries.length - visible.length;
  return remaining > 0 ? `${visible.join(', ')} (+${remaining} more)` : visible.join(', ');
}

function statusOf(report) {
  return String(report?.status ?? report?.summary?.status ?? 'unknown').toLowerCase();
}

function countOf(report, key) {
  const direct = Number(report?.[key]);
  if (Number.isFinite(direct)) return direct;
  const nested = Number(report?.summary?.[key]);
  return Number.isFinite(nested) ? nested : 0;
}

function noteFor(item) {
  const notes = [firstText(item.notes, item.error)];
  if (Array.isArray(item.missing) && item.missing.length > 0) {
    notes.push(`missing: ${item.missing.join(', ')}`);
  }
  if (Array.isArray(item.usingDefaults) && item.usingDefaults.length > 0) {
    notes.push(`defaults: ${item.usingDefaults.join(', ')}`);
  }
  if (Array.isArray(item.alternatives) && item.alternatives.length > 0) {
    notes.push(`alternatives: ${item.alternatives.join(', ')}`);
  }
  if (Array.isArray(item.failedRequiredChecks) && item.failedRequiredChecks.length > 0) {
    notes.push(`failed required: ${item.failedRequiredChecks.join(', ')}`);
  }
  const strictScore = Number(item.strictScore);
  const fleetScore = Number(item.fleetScore);
  if (Number.isFinite(strictScore) || Number.isFinite(fleetScore)) {
    notes.push(`scores: strict=${Number.isFinite(strictScore) ? strictScore : 'n/a'}, fleet=${Number.isFinite(fleetScore) ? fleetScore : 'n/a'}`);
  }
  const issueSummary = issueCountSummary(item.issueCounts);
  if (issueSummary) {
    notes.push(`issue counts: ${issueSummary}`);
  }
  if (Array.isArray(item.failedIssues) && item.failedIssues.length > 0) {
    notes.push(`issues: ${item.failedIssues.join(', ')}`);
  }
  if (item.authMode) {
    notes.push(`auth: ${item.authMode}`);
  }
  if (Array.isArray(item.attentionChecks) && item.attentionChecks.length > 0) {
    const count = Number(item.attentionCheckCount);
    const suffix = Number.isFinite(count) && count > item.attentionChecks.length
      ? ` (+${count - item.attentionChecks.length} more)`
      : '';
    notes.push(`attention checks: ${item.attentionChecks.join(', ')}${suffix}`);
  }
  const checked = Number(item.checked);
  const surfaceFailures = Number(item.surfaceFailures ?? item.surfaceFailed ?? (Number.isFinite(checked) && checked > 0 ? item.failed : undefined));
  const surfaceWarnings = Number(item.surfaceWarnings ?? item.surfaceWarn ?? (Number.isFinite(checked) && checked > 0 ? item.warn : undefined));
  if (Number.isFinite(checked) && checked > 0) {
    const parts = [`checked=${checked}`];
    if (Number.isFinite(surfaceFailures)) parts.push(`failed=${surfaceFailures}`);
    if (Number.isFinite(surfaceWarnings)) parts.push(`warn=${surfaceWarnings}`);
    notes.push(`surfaces: ${parts.join(', ')}`);
  }
  if (item.reportPath) {
    notes.push(`report: ${item.reportPath}`);
  }
  return notes.filter(Boolean).join('; ');
}

function reportChecks(report) {
  return Array.isArray(report?.checks) ? report.checks : [];
}

function reportBlockers(report) {
  const direct = Array.isArray(report?.releaseBlockers) ? report.releaseBlockers : [];
  if (direct.length > 0) return direct;
  return reportChecks(report)
    .filter((check) => check?.status === 'blocked' || check?.status === 'fail')
    .map((check) => ({
      source: check.source || check.id || check.name,
      name: check.name || check.id || 'unknown',
      status: check.status || 'unknown',
      notes: noteFor(check),
      missing: check.missing,
      usingDefaults: check.usingDefaults,
      failedRequiredChecks: check.failedRequiredChecks,
      issueCounts: check.issueCounts,
      strictScore: check.strictScore,
      fleetScore: check.fleetScore,
      failedIssues: check.failedIssues,
      authMode: check.authMode,
      attentionChecks: check.attentionChecks,
      attentionCheckCount: check.attentionCheckCount,
      checked: check.checked,
      surfaceFailures: check.surfaceFailures ?? (Number.isFinite(Number(check.checked)) ? check.failed : undefined),
      surfaceWarnings: check.surfaceWarnings ?? (Number.isFinite(Number(check.checked)) ? check.warn : undefined),
      reportPath: check.reportPath,
    }));
}

function reportWarnings(report) {
  const direct = Array.isArray(report?.releaseWarnings) ? report.releaseWarnings : [];
  if (direct.length > 0) return direct;
  return reportChecks(report)
    .filter((check) => check?.status === 'warn')
    .map((check) => ({
      source: check.source || check.id || check.name,
      name: check.name || check.id || 'unknown',
      status: check.status || 'warn',
      notes: noteFor(check),
      missing: check.missing,
      alternatives: check.alternatives,
      reportPath: check.reportPath,
    }));
}

function runUrl() {
  if (process.env.READINESS_RUN_URL) return process.env.READINESS_RUN_URL;
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  return server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : '';
}

function countLine(report, config) {
  const passed = countOf(report, 'passed');
  const blocked = countOf(report, 'blocked');
  const failed = countOf(report, 'failed');
  const warnings = countOf(report, 'warnings')
    || (Array.isArray(report?.releaseWarnings) ? report.releaseWarnings.length : 0)
    || reportChecks(report).filter((check) => check?.status === 'warn').length;
  const total = countOf(report, 'total');
  const suffix = config.countSuffix.replace('${total}', String(total));
  return `Passed: ${passed} / Blocked: ${blocked} / Failed: ${failed} / Warnings: ${warnings}${suffix}`;
}

function table(columns, rows) {
  const alignment = columns.map((column) => (/(ms|failed|blocked|total)$/i.test(column) ? '---:' : '---'));
  return [
    `| ${columns.join(' | ')} |`,
    `| ${alignment.join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`),
  ].join('\n');
}

function checkRows(report, value) {
  return reportChecks(report).map((check) => {
    const name = firstText(check.name, check.id, 'unknown');
    const duration = firstText(check.ms, check.durationMs, '');
    if (isReleaseKind(value)) {
      return [name, check.status || '', duration, check.failed ?? '', check.blocked ?? ''];
    }
    return [name, check.status || '', duration, noteFor(check)];
  });
}

function blockerRows(blockers, value) {
  return blockers.map((blocker) => {
    if (isReleaseKind(value)) {
      return [
        blocker.source || '',
        blocker.name || '',
        blocker.status || '',
        noteFor(blocker),
      ];
    }
    return [blocker.name || '', blocker.status || '', noteFor(blocker)];
  });
}

function warningRows(warnings) {
  return warnings.map((warning) => [
    warning.source || '',
    warning.name || '',
    warning.status || 'warn',
    preferredLocationsForKeys(warning.missing),
    noteFor(warning),
  ]);
}

function preferredLocationForKey(key) {
  const value = String(key || '');
  if (
    /(_TOKEN|_SECRET|_KEY|WEBHOOK|CRON_SECRET|SERVICE_ROLE)/.test(value) ||
    value === 'VERCEL_TOKEN'
  ) {
    return 'GitHub Actions secret';
  }
  if (
    value.startsWith('OPEN_CHECK_') ||
    value.startsWith('AD_') ||
    value === 'BLOG_QUALITY_SOURCE_READY' ||
    value === 'SUPABASE_PROJECT_REF' ||
    value.endsWith('_ID') ||
    value.endsWith('_URL')
  ) {
    return 'GitHub Actions variable';
  }
  return 'GitHub Actions secret or variable';
}

function preferredLocationsForKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) return '';
  return [...new Set(keys.map(preferredLocationForKey))].sort().join(', ');
}

function operationalArtifactRows(report) {
  const rows = [];
  const seen = new Set();
  function addRow(source, type, path) {
    if (!path) return;
    const key = `${source}:${type}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([source, type, path]);
  }

  if (report?.operationalEnvFile?.path) {
    addRow('local-release', 'Operational env file', report.operationalEnvFile.path);
  }
  if (report?.artifacts && typeof report.artifacts === 'object') {
    const artifactSource = Object.values(report.artifacts).some((path) => String(path || '').includes('marketing-release'))
      ? 'marketing-release'
      : firstText(report.kind, 'release-readiness');
    for (const [type, path] of [
      ['Operational env file', report.artifacts.operationalEnvFile],
      ['Action plan', report.artifacts.operationalPlan],
      ['Fill-in template', report.artifacts.operationalTemplate],
      ['Apply script', report.artifacts.operationalApplyScript],
      ['Vercel env script', report.artifacts.operationalVercelScript],
      ['Node apply script', report.artifacts.operationalNodeApplyScript],
      ['Node Vercel env script', report.artifacts.operationalNodeVercelScript],
    ]) {
      addRow(artifactSource, type, path);
    }
  }
  for (const [type, path] of [
    ['Operational env file', operationalEnvFilePath],
    ['Action plan', operationalPlanPath],
    ['Fill-in template', operationalTemplatePath],
    ['Apply script', operationalApplyScriptPath],
    ['Vercel env script', operationalVercelScriptPath],
    ['Node apply script', operationalNodeApplyScriptPath],
    ['Node Vercel env script', operationalNodeVercelScriptPath],
  ]) {
    addRow('operational-inputs', type, path);
  }
  for (const check of reportChecks(report)) {
    const source = firstText(check.source, check.id, check.name, 'unknown');
    for (const [type, path] of [
      ['Action plan', check.actionPlanPath],
      ['Fill-in template', check.templatePath],
      ['Apply script', check.applyScriptPath],
      ['Vercel env script', check.vercelScriptPath],
      ['Node apply script', check.nodeApplyScriptPath],
      ['Node Vercel env script', check.nodeVercelScriptPath],
      ['Env file', check.envFilePath],
    ]) {
      addRow(source, type, path);
    }
  }
  return rows;
}

function renderOperationalArtifactsSection(report) {
  const rows = operationalArtifactRows(report);
  if (rows.length === 0) return '';
  return [
    '## Operational Artifacts',
    '',
    table(['Source', 'Artifact', 'Path'], rows),
  ].join('\n');
}

function missingInputRows(blockers) {
  const byKey = new Map();
  for (const blocker of blockers) {
    if (!Array.isArray(blocker.missing)) continue;
    for (const key of blocker.missing) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) continue;
      const current = byKey.get(normalizedKey) || {
        key: normalizedKey,
        sources: new Set(),
        alternatives: new Set(),
        notes: new Set(),
      };
      current.sources.add(firstText(blocker.source, blocker.name, 'unknown'));
      const note = firstText(blocker.notes, blocker.error);
      if (note) current.notes.add(note);
      if (Array.isArray(blocker.alternatives)) {
        for (const alternative of blocker.alternatives) {
          if (alternative) current.alternatives.add(String(alternative));
        }
      }
      byKey.set(normalizedKey, current);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((item) => [
      item.key,
      preferredLocationForKey(item.key),
      [...item.sources].sort().join(', '),
      [...item.alternatives].sort().join(', '),
      [...item.notes].sort().join(' / '),
    ]);
}

function renderMissingInputsSection(blockers) {
  const rows = missingInputRows(blockers);
  if (rows.length === 0) return '';
  return [
    '## Missing Inputs',
    '',
    table(['Key', 'Preferred Location', 'Sources', 'Alternatives', 'Notes'], rows),
  ].join('\n');
}

function renderWarningsSection(warnings) {
  if (warnings.length === 0) return '';
  return [
    '## Release Warnings',
    '',
    table(['Source', 'Name', 'Status', 'Preferred Location', 'Notes'], warningRows(warnings)),
  ].join('\n');
}

function renderBlockersSection(config, blockers, value) {
  if (blockers.length === 0) {
    return '## Release Blockers\n\nNo release blockers reported.';
  }
  return [
    '## Release Blockers',
    '',
    table(config.blockerColumns, blockerRows(blockers, value)),
  ].join('\n');
}

function renderSummary(report, config, blockers, warnings, value, url) {
  const rows = checkRows(report, value);
  const sections = [
    `# ${config.title}`,
    '',
    `Status: **${statusOf(report)}**`,
    '',
    countLine(report, config),
  ];
  if (url) sections.push('', `Run: ${url}`);
  sections.push(
    '',
    rows.length > 0 ? table(config.checkColumns, rows) : 'No checks reported.',
    '',
    renderOperationalArtifactsSection(report),
    '',
    renderMissingInputsSection(blockers),
    '',
    renderWarningsSection(warnings),
    '',
    renderBlockersSection(config, blockers, value),
    '',
  );
  return sections.join('\n');
}

function renderIssueBody(report, config, blockers, warnings, value, url) {
  const sections = [
    config.marker,
    `# ${config.issueHeading}`,
    '',
    `Status: **${statusOf(report)}**`,
    '',
    countLine(report, config),
  ];
  if (url) sections.push('', `Run: ${url}`);
  sections.push(
    '',
    renderOperationalArtifactsSection(report),
    '',
    renderMissingInputsSection(blockers),
    '',
    renderWarningsSection(warnings),
    '',
    renderBlockersSection(config, blockers, value),
    '',
  );
  return sections.join('\n');
}

function main() {
  const config = configFor(kind);
  const loadedReport = readReport(reportPath);
  const report = loadedReport || missingReportFor(kind, reportPath);
  const url = runUrl();
  const blockers = reportBlockers(report);
  const warnings = reportWarnings(report);
  const status = statusOf(report);
  const hasBlockers = blockers.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasAttentionItems = hasBlockers || hasWarnings;
  const shouldCloseIssue = Boolean(loadedReport) && status === 'pass' && !hasBlockers && !hasWarnings;

  writeText(summaryOut, renderSummary(report, config, blockers, warnings, kind, url));
  if (hasAttentionItems) {
    writeText(issueBodyOut, renderIssueBody(report, config, blockers, warnings, kind, url));
  }

  const meta = {
    kind,
    status,
    hasReport: Boolean(loadedReport),
    hasBlockers,
    hasWarnings,
    hasAttentionItems,
    shouldCloseIssue,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    issueTitle: config.issueTitle,
    legacyIssueTitles: config.legacyIssueTitles || [],
    marker: config.marker,
    issueBodyPath: issueBodyOut,
    summaryPath: summaryOut,
    recoveryComment: [config.marker, config.recoveryText, url ? `Run: ${url}` : ''].filter(Boolean).join('\n\n'),
  };
  writeJson(metaOut, meta);
  console.log(JSON.stringify(meta, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
