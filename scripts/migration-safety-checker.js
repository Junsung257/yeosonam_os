#!/usr/bin/env node
/* eslint-disable no-console */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MIGRATIONS_PREFIX = 'supabase/migrations/';
const SEVERITY = Object.freeze({
  BLOCKING: 'blocking',
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});
const BLOCKING_SEVERITIES = new Set([SEVERITY.BLOCKING, SEVERITY.CRITICAL, SEVERITY.HIGH]);

function normalizeSql(content) {
  return content
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function stripDollarQuotedBodies(content) {
  const delimiterPattern = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let cursor = 0;
  let result = '';
  let match;

  while ((match = delimiterPattern.exec(content)) !== null) {
    const delimiter = match[0];
    const bodyEnd = content.indexOf(delimiter, delimiterPattern.lastIndex);
    if (bodyEnd === -1) break;

    result += content.slice(cursor, match.index);
    const quoted = content.slice(match.index, bodyEnd + delimiter.length);
    result += quoted.replace(/[^\n]/g, ' ');
    cursor = bodyEnd + delimiter.length;
    delimiterPattern.lastIndex = cursor;
  }

  return result + content.slice(cursor);
}

function parseNameStatusZ(output) {
  const tokens = output.split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const statusToken = tokens[index++];
    const status = statusToken[0];
    if (status === 'R' || status === 'C') {
      changes.push({ status, score: statusToken.slice(1), oldPath: tokens[index++], path: tokens[index++] });
    } else {
      changes.push({ status, path: tokens[index++] });
    }
  }
  return changes.filter((change) => change.path?.startsWith(MIGRATIONS_PREFIX)
    || change.oldPath?.startsWith(MIGRATIONS_PREFIX));
}

function git(args, cwd, encoding = 'utf8') {
  return execFileSync('git', args, { cwd, encoding, stdio: ['ignore', 'pipe', 'pipe'] });
}

function readGitFile(revision, filePath, cwd) {
  try {
    return git(['show', `${revision}:${filePath}`], cwd);
  } catch {
    return null;
  }
}

function collectMigrationChanges({ base, head, cwd = process.cwd() }) {
  const output = git([
    'diff', '--name-status', '-z', '--find-renames', base, head, '--', 'supabase/migrations/*.sql',
  ], cwd);
  return parseNameStatusZ(output).map((change) => ({
    ...change,
    oldContent: change.oldPath
      ? readGitFile(base, change.oldPath, cwd)
      : change.status === 'M' || change.status === 'D'
        ? readGitFile(base, change.path, cwd)
        : null,
    content: change.status === 'D' ? null : readGitFile(head, change.path, cwd),
  }));
}

class MigrationChecker {
  constructor(filePath, content, options = {}) {
    this.filePath = filePath;
    this.fileName = path.basename(filePath);
    this.content = content;
    this.normalizedContent = normalizeSql(content);
    this.indexCorpus = normalizeSql(options.indexCorpus || content);
    this.issues = [];
  }

  addIssue(severity, type, description, lineNumber = null) {
    this.issues.push({ severity, type, description, lineNumber, file: this.fileName });
  }

  checkDestructiveOps() {
    // Statements inside a function body are defined, not executed, by the
    // migration. Runtime DML is reviewed by function/RPC security tests.
    stripDollarQuotedBodies(this.content).split('\n').forEach((line, index) => {
      const cleanLine = line.replace(/--.*$/, '').trim();
      if (!cleanLine) return;
      if (/DROP\s+TABLE/i.test(cleanLine)) this.addIssue(SEVERITY.BLOCKING, 'destructive', 'DROP TABLE can remove production data', index + 1);
      if (/ALTER\s+TABLE[^;]+DROP\s+COLUMN/i.test(cleanLine)) this.addIssue(SEVERITY.CRITICAL, 'destructive', 'DROP COLUMN causes data loss', index + 1);
      if (/TRUNCATE\s+(?:TABLE\s+)?/i.test(cleanLine)) this.addIssue(SEVERITY.BLOCKING, 'destructive', 'TRUNCATE removes all rows', index + 1);
      if (/DELETE\s+FROM\s+[\w.]+\s*(?:;|$)/i.test(cleanLine) && !/\bWHERE\b/i.test(cleanLine)) {
        this.addIssue(SEVERITY.BLOCKING, 'destructive', 'Unbounded DELETE without WHERE', index + 1);
      }
    });
  }

  checkLockHeavyOps() {
    const createdTables = new Set([...this.normalizedContent.matchAll(
      /create table (?:if not exists )?(?:\w+\.)?(\w+)\s*\(/g,
    )].map((match) => match[1]));
    this.content.split('\n').forEach((line, index, lines) => {
      const cleanLine = line.replace(/--.*$/, '').trim();
      if (/CREATE\s+(?:UNIQUE\s+)?INDEX(?!\s+CONCURRENTLY)/i.test(cleanLine)) {
        const statement = lines.slice(index, index + 8).join(' ').split(';')[0];
        const table = statement.match(/\bON\s+(?:\w+\.)?(\w+)\s*\(/i)?.[1]?.toLowerCase();
        if (!table || !createdTables.has(table)) this.addIssue(SEVERITY.HIGH, 'lock-heavy', 'CREATE INDEX on an existing table must use CONCURRENTLY', index + 1);
      }
      if (/ALTER\s+TABLE[^;]+ADD\s+COLUMN[^;]+NOT\s+NULL(?![^;]*\bDEFAULT\b)/i.test(cleanLine)) {
        this.addIssue(SEVERITY.CRITICAL, 'lock-heavy', 'ADD COLUMN NOT NULL without a staged backfill', index + 1);
      }
      if (/ALTER\s+TABLE[^;]+ALTER\s+COLUMN[^;]+TYPE/i.test(cleanLine)) this.addIssue(SEVERITY.HIGH, 'lock-heavy', 'ALTER COLUMN TYPE may rewrite the table', index + 1);
      if (/ALTER\s+TABLE[^;]+ADD\s+CONSTRAINT[^;]+UNIQUE/i.test(cleanLine)) this.addIssue(SEVERITY.HIGH, 'lock-heavy', 'ADD UNIQUE scans and locks the table', index + 1);
    });
  }

  checkNewTablesRls() {
    for (const match of this.normalizedContent.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(/g)) {
      const table = match[1];
      if (/^(_|migration|schema_)/.test(table)) continue;
      if (!new RegExp(`alter table (?:public\\.)?${table} enable row level security`).test(this.normalizedContent)) {
        this.addIssue(SEVERITY.CRITICAL, 'security', `New table '${table}' is missing ENABLE ROW LEVEL SECURITY`);
      }
      if (!new RegExp(`create policy [^;]+ on (?:public\\.)?${table}`).test(this.normalizedContent)) {
        this.addIssue(SEVERITY.HIGH, 'security', `New table '${table}' has no RLS policy`);
      }
    }
  }

  checkForeignKeyIndexes() {
    const foreignKeys = [];
    for (const match of this.normalizedContent.matchAll(
      /alter table (?:public\.)?(\w+)[\s\S]*?foreign key\s*\((\w+)\)\s*references\s+(?:public\.)?(\w+)\s*\((\w+)\)/g,
    )) foreignKeys.push({ table: match[1], column: match[2] });

    for (const tableMatch of this.normalizedContent.matchAll(
      /create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*;/g,
    )) {
      const table = tableMatch[1];
      const body = tableMatch[2];
      for (const match of body.matchAll(/(?:^|,)\s*(\w+)\s+[^,]*?references\s+(?:public\.)?\w+\s*\(\w+\)/g)) {
        foreignKeys.push({ table, column: match[1] });
      }
      for (const match of body.matchAll(/foreign key\s*\((\w+)\)\s*references/g)) {
        foreignKeys.push({ table, column: match[1] });
      }
    }

    for (const { table, column } of foreignKeys) {
      const index = new RegExp(`create (?:unique )?index[^;]* on (?:public\\.)?${table}\\s*\\([^)]*\\b${column}\\b`);
      const uniqueOrPrimary = new RegExp(`(?:primary key|unique)\\s*\\([^)]*\\b${column}\\b`);
      const inlineUnique = new RegExp(`(?:^|,)\\s*${column}\\s+[^,]*\\bunique\\b`);
      if (!index.test(this.indexCorpus)
        && !uniqueOrPrimary.test(this.normalizedContent)
        && !inlineUnique.test(this.normalizedContent)) {
        this.addIssue(SEVERITY.HIGH, 'foreign-key-index', `Foreign key '${table}.${column}' has no supporting index in the change set`);
      }
    }
  }

  checkTransactionSafety() {
    if (/create index concurrently/.test(this.normalizedContent) && /\bbegin\s*;/.test(this.normalizedContent)) {
      this.addIssue(SEVERITY.HIGH, 'transaction', 'CREATE INDEX CONCURRENTLY cannot run inside a transaction');
    }
  }

  checkBatchOperations() {
    for (const match of this.normalizedContent.matchAll(/update\s+[\w.]+\s+set[^;]+(?:;|$)/g)) {
      if (!/\bwhere\b/.test(match[0])) this.addIssue(SEVERITY.CRITICAL, 'lock-heavy', 'Unbounded UPDATE without WHERE');
    }
  }

  checkNamingConventions() {
    if (!/^\d{14}_/.test(this.fileName)) this.addIssue(SEVERITY.LOW, 'convention', 'Migration filename must start with YYYYMMDDHHMMSS_');
    if (this.content.length < 50) this.addIssue(SEVERITY.MEDIUM, 'convention', 'Migration appears empty or too short');
  }

  run() {
    this.checkDestructiveOps();
    this.checkLockHeavyOps();
    this.checkNewTablesRls();
    this.checkForeignKeyIndexes();
    this.checkTransactionSafety();
    this.checkBatchOperations();
    this.checkNamingConventions();
    return this.issues;
  }
}

function issueKey(issue) {
  return `${issue.severity}:${issue.type}:${issue.description}`;
}

function issueCounts(issues) {
  return issues.reduce((counts, issue) => {
    const key = typeof issue === 'string' ? issue : issueKey(issue);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function stableIssueCounts(counts) {
  return Object.fromEntries(Object.entries(counts || {})
    .filter(([, count]) => Number.isInteger(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function applyExactApprovals(result, approvals = {}) {
  const approved = [];
  const remainingFiles = [];

  for (const fileResult of result.files) {
    const approval = approvals[fileResult.file];
    const change = result.changes.find((candidate) => path.basename(candidate.path || candidate.oldPath) === fileResult.file);
    const currentHash = change?.content ? sha256(change.content) : null;
    const actualIssues = fileResult.issues.map(issueKey).sort();
    const approvedIssues = Array.isArray(approval?.approvedIssues)
      ? approval.approvedIssues.map(issueKey).sort()
      : [];
    const exactIssueSet = Array.isArray(approval?.approvedIssues)
      ? JSON.stringify(actualIssues) === JSON.stringify(approvedIssues)
      : approval?.approvedIssueCounts && typeof approval.approvedIssueCounts === 'object'
        ? JSON.stringify(stableIssueCounts(issueCounts(actualIssues)))
          === JSON.stringify(stableIssueCounts(approval.approvedIssueCounts))
        : false;
    const exactMatch = approval
      && approval.status === fileResult.status
      && approval.sha256 === currentHash
      && typeof approval.rationale === 'string'
      && approval.rationale.trim().length > 0
      && typeof approval.evidence === 'string'
      && approval.evidence.trim().length > 0
      && exactIssueSet;

    if (exactMatch) {
      approved.push({
        file: fileResult.file,
        status: fileResult.status,
        sha256: currentHash,
        rationale: approval.rationale,
        evidence: approval.evidence,
        issues: fileResult.issues,
      });
    } else {
      remainingFiles.push(fileResult);
    }
  }

  return {
    ...result,
    files: remainingFiles,
    totalIssues: remainingFiles.reduce((sum, file) => sum + file.issues.length, 0),
    approved,
    approvedIssues: approved.reduce((sum, file) => sum + file.issues.length, 0),
  };
}

function analyzeChangeSet(changes, options = {}) {
  const indexCorpus = changes.filter((change) => change.content).map((change) => change.content).join('\n');
  const files = [];
  let totalIssues = 0;
  for (const change of changes) {
    const issues = [];
    const file = path.basename(change.path || change.oldPath);
    if (change.status === 'D') {
      issues.push({ severity: SEVERITY.CRITICAL, type: 'migration-history', description: 'Applied migration file was deleted', file });
    } else {
      if (change.status === 'R') {
        issues.push({ severity: SEVERITY.CRITICAL, type: 'migration-history', description: `Applied migration was renamed from ${path.basename(change.oldPath)}`, file });
      }
      if (change.status === 'M') {
        const semanticChanged = normalizeSql(change.oldContent || '') !== normalizeSql(change.content || '');
        issues.push({
          severity: SEVERITY.CRITICAL,
          type: 'migration-history',
          description: semanticChanged
            ? `Applied migration SQL changed (old ${sha256(change.oldContent || '').slice(0, 12)}, new ${sha256(change.content || '').slice(0, 12)})`
            : 'Applied migration checksum changed even though normalized SQL is equivalent',
          file,
        });
      }
      if (change.content) issues.push(...new MigrationChecker(change.path, change.content, { indexCorpus }).run());
    }
    if (issues.length) {
      files.push({ file, status: change.status, oldPath: change.oldPath || null, issues });
      totalIssues += issues.length;
    }
  }
  return applyExactApprovals(
    { files, totalIssues, totalChecked: changes.length, changes },
    options.approvals,
  );
}

function determineExitCode(result) {
  return result.files.some(({ issues }) => issues.some(({ severity }) => BLOCKING_SEVERITIES.has(severity))) ? 1 : 0;
}

function printReport(result) {
  console.log('Migration Safety Analysis');
  console.log(`Files checked: ${result.totalChecked}`);
  console.log(`Files with issues: ${result.files.length}`);
  console.log(`Total issues: ${result.totalIssues}`);
  console.log(`Exactly approved issues: ${result.approvedIssues || 0}`);
  for (const { file, status, issues } of result.files) {
    console.log(`\n${status} ${file}`);
    for (const issue of issues) console.log(`  [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}`);
  }
}

function parseArgs(args) {
  const options = { files: [] };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--base') options.base = args[++index];
    else if (args[index] === '--head') options.head = args[++index];
    else if (args[index] === '--report') options.report = args[++index];
    else options.files.push(args[index]);
  }
  return options;
}

function runCli(args = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseArgs(args);
  const approvalsPath = path.join(cwd, '.github', 'migration-safety-approvals.json');
  const approvalConfig = fs.existsSync(approvalsPath)
    ? JSON.parse(fs.readFileSync(approvalsPath, 'utf8'))
    : { approvals: {} };
  let changes;
  if (options.base && options.head) {
    changes = collectMigrationChanges({ base: options.base, head: options.head, cwd });
  } else {
    changes = options.files.map((file) => {
      const relativePath = file.startsWith(MIGRATIONS_PREFIX) ? file : `${MIGRATIONS_PREFIX}${path.basename(file)}`;
      const absolutePath = path.join(cwd, relativePath);
      return { status: 'A', path: relativePath, content: fs.readFileSync(absolutePath, 'utf8'), oldContent: null };
    });
  }
  const result = analyzeChangeSet(changes, { approvals: approvalConfig.approvals || {} });
  printReport(result);
  const reportPath = path.resolve(cwd, options.report || 'migration-safety-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), ...result }, null, 2));
  return determineExitCode(result);
}

module.exports = {
  SEVERITY,
  MigrationChecker,
  analyzeChangeSet,
  applyExactApprovals,
  collectMigrationChanges,
  determineExitCode,
  normalizeSql,
  parseNameStatusZ,
  stripDollarQuotedBodies,
  runCli,
};

if (require.main === module) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(`Migration safety checker failed closed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
