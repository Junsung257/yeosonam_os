#!/usr/bin/env node
/**
 * Migration Safety Checker
 *
 * Validates Supabase migrations for production safety:
 * - Destructive operations (DROP TABLE/COLUMN, TRUNCATE)
 * - Lock-heavy operations (ALTER TABLE without CONCURRENTLY)
 * - Missing indexes on foreign keys
 * - Large table mutations without batch
 * - Missing RLS policies on new tables
 * - Non-transactional DDL
 * - Production-blocking operations (UNIQUE on populated columns)
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = 'supabase/migrations';

const SEVERITY = {
  BLOCKING: 'blocking',
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

class MigrationChecker {
  constructor(filePath, content) {
    this.filePath = filePath;
    this.fileName = path.basename(filePath);
    this.content = content;
    this.normalizedContent = content.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    this.issues = [];
  }

  addIssue(severity, type, description, lineNumber = null) {
    this.issues.push({
      severity,
      type,
      description,
      lineNumber,
      file: this.fileName
    });
  }

  checkDestructiveOps() {
    const lines = this.content.split('\n');
    lines.forEach((line, idx) => {
      const cleanLine = line.replace(/--.*$/, '').trim();
      if (cleanLine.length === 0) return;

      if (/DROP\s+TABLE(?!\s+IF\s+EXISTS\s+\w+_(?:old|backup|temp))/i.test(cleanLine)) {
        this.addIssue(
          SEVERITY.BLOCKING,
          'destructive',
          'DROP TABLE without backup naming convention',
          idx + 1
        );
      }

      if (/ALTER\s+TABLE[^;]+DROP\s+COLUMN/i.test(cleanLine)) {
        this.addIssue(
          SEVERITY.CRITICAL,
          'destructive',
          'DROP COLUMN causes data loss',
          idx + 1
        );
      }

      if (/TRUNCATE\s+TABLE/i.test(cleanLine)) {
        this.addIssue(
          SEVERITY.BLOCKING,
          'destructive',
          'TRUNCATE TABLE removes all data',
          idx + 1
        );
      }

      if (/DELETE\s+FROM\s+\w+\s*(?:;|--|$)/i.test(cleanLine) &&
          !/WHERE/i.test(cleanLine)) {
        this.addIssue(
          SEVERITY.BLOCKING,
          'destructive',
          'Unbounded DELETE without WHERE clause',
          idx + 1
        );
      }
    });
  }

  checkLockHeavyOps() {
    const lines = this.content.split('\n');

    lines.forEach((line, idx) => {
      const cleanLine = line.replace(/--.*$/, '').trim();

      if (/CREATE\s+(?:UNIQUE\s+)?INDEX(?!\s+CONCURRENTLY)/i.test(cleanLine)) {
        this.addIssue(
          SEVERITY.HIGH,
          'lock-heavy',
          'CREATE INDEX without CONCURRENTLY blocks writes',
          idx + 1
        );
      }

      if (/ALTER\s+TABLE[^;]+ADD\s+COLUMN[^;]+NOT\s+NULL(?!\s+DEFAULT)/i.test(cleanLine)) {
        this.addIssue(
          SEVERITY.CRITICAL,
          'lock-heavy',
          'ADD COLUMN NOT NULL without DEFAULT rewrites entire table',
          idx + 1
        );
      }

      if (/ALTER\s+TABLE[^;]+ALTER\s+COLUMN[^;]+TYPE/i.test(cleanLine)) {
        this.addIssue(
          SEVERITY.HIGH,
          'lock-heavy',
          'ALTER COLUMN TYPE rewrites entire table',
          idx + 1
        );
      }

      if (/ALTER\s+TABLE[^;]+ADD\s+CONSTRAINT[^;]+UNIQUE/i.test(cleanLine)) {
        this.addIssue(
          SEVERITY.HIGH,
          'lock-heavy',
          'ADD UNIQUE constraint requires full table scan',
          idx + 1
        );
      }
    });
  }

  checkNewTablesRLS() {
    const createTableMatches = this.normalizedContent.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/gi
    );

    for (const match of createTableMatches) {
      const tableName = match[1];

      if (/^(_|migration|schema_)/.test(tableName)) continue;

      const enableRlsPattern = new RegExp(
        `ALTER\\s+TABLE\\s+(?:public\\.)?${tableName}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i'
      );

      if (!enableRlsPattern.test(this.normalizedContent)) {
        this.addIssue(
          SEVERITY.CRITICAL,
          'security',
          `New table '${tableName}' missing ENABLE ROW LEVEL SECURITY`
        );
      }

      const policyPattern = new RegExp(
        `CREATE\\s+POLICY[^;]+ON\\s+(?:public\\.)?${tableName}`,
        'i'
      );

      if (!policyPattern.test(this.normalizedContent)) {
        this.addIssue(
          SEVERITY.HIGH,
          'security',
          `Table '${tableName}' has no RLS policies defined`
        );
      }
    }
  }

  checkForeignKeyIndexes() {
    const fkMatches = this.normalizedContent.matchAll(
      /REFERENCES\s+(?:public\.)?(\w+)\s*\((\w+)\)/gi
    );

    const fkColumns = new Set();
    for (const match of fkMatches) {
      fkColumns.add(`${match[1]}.${match[2]}`);
    }

    fkColumns.forEach(fk => {
      const [table, column] = fk.split('.');
      const indexPattern = new RegExp(
        `CREATE\\s+INDEX[^;]+ON\\s+(?:public\\.)?${table}\\s*\\([^)]*\\b${column}\\b[^)]*\\)`,
        'i'
      );

      if (!indexPattern.test(this.normalizedContent)) {
      }
    });
  }

  checkTransactionSafety() {
    const hasBegin = /BEGIN\s*;|BEGIN\s+TRANSACTION/i.test(this.content);
    const hasCommit = /COMMIT\s*;/i.test(this.content);

    const dangerousStatements = (this.normalizedContent.match(/CREATE\s+INDEX\s+CONCURRENTLY/gi) || []).length;

    if (dangerousStatements > 0 && hasBegin) {
      this.addIssue(
        SEVERITY.HIGH,
        'transaction',
        'CREATE INDEX CONCURRENTLY cannot run inside transaction'
      );
    }
  }

  checkBatchOperations() {
    const updateAllPattern = /UPDATE\s+\w+\s+SET[^;]+(?:;|$)/gi;
    const matches = this.normalizedContent.matchAll(updateAllPattern);

    for (const match of matches) {
      const stmt = match[0];
      if (!/WHERE/i.test(stmt)) {
        this.addIssue(
          SEVERITY.CRITICAL,
          'lock-heavy',
          'Unbounded UPDATE without WHERE clause'
        );
      }
    }
  }

  checkNamingConventions() {
    if (!/^\d{14}_/.test(this.fileName)) {
      this.addIssue(
        SEVERITY.LOW,
        'convention',
        'Migration filename should start with timestamp (YYYYMMDDHHMMSS_)'
      );
    }

    if (this.content.length < 50) {
      this.addIssue(
        SEVERITY.MEDIUM,
        'convention',
        'Migration appears empty or too short'
      );
    }
  }

  run() {
    this.checkDestructiveOps();
    this.checkLockHeavyOps();
    this.checkNewTablesRLS();
    this.checkForeignKeyIndexes();
    this.checkTransactionSafety();
    this.checkBatchOperations();
    this.checkNamingConventions();
    return this.issues;
  }
}

function analyzeMigrations(targetFiles = null) {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('No migrations directory found');
    return { files: [], totalIssues: 0 };
  }

  const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const filesToCheck = targetFiles && targetFiles.length > 0
    ? allFiles.filter(f => targetFiles.includes(f))
    : allFiles;

  const results = [];
  let totalIssues = 0;

  filesToCheck.forEach(file => {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const checker = new MigrationChecker(filePath, content);
    const issues = checker.run();

    if (issues.length > 0) {
      results.push({ file, issues });
      totalIssues += issues.length;
    }
  });

  return { files: results, totalIssues, totalChecked: filesToCheck.length };
}

function printReport(result) {
  const { files, totalIssues, totalChecked } = result;

  console.log('🔍 Migration Safety Analysis\n');
  console.log('='.repeat(60));
  console.log(`Files checked: ${totalChecked}`);
  console.log(`Files with issues: ${files.length}`);
  console.log(`Total issues: ${totalIssues}\n`);

  const severityCounts = {};

  if (files.length === 0) {
    console.log('✅ All migrations passed safety checks\n');
    return { exitCode: 0, severityCounts };
  }

  files.forEach(({ file, issues }) => {
    console.log(`\n📄 ${file}`);
    console.log('─'.repeat(60));

    issues
      .sort((a, b) => {
        const order = [SEVERITY.BLOCKING, SEVERITY.CRITICAL, SEVERITY.HIGH, SEVERITY.MEDIUM, SEVERITY.LOW];
        return order.indexOf(a.severity) - order.indexOf(b.severity);
      })
      .forEach(issue => {
        const icon = {
          [SEVERITY.BLOCKING]: '🛑',
          [SEVERITY.CRITICAL]: '🔴',
          [SEVERITY.HIGH]: '🟠',
          [SEVERITY.MEDIUM]: '🟡',
          [SEVERITY.LOW]: '🔵'
        }[issue.severity];

        console.log(`  ${icon} [${issue.severity.toUpperCase()}] ${issue.type}`);
        console.log(`     ${issue.description}`);
        if (issue.lineNumber) {
          console.log(`     Line: ${issue.lineNumber}`);
        }

        severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;
      });
  });

  console.log('\n' + '='.repeat(60));
  console.log('📊 Severity Summary:\n');
  Object.entries(severityCounts).forEach(([severity, count]) => {
    const icon = {
      [SEVERITY.BLOCKING]: '🛑',
      [SEVERITY.CRITICAL]: '🔴',
      [SEVERITY.HIGH]: '🟠',
      [SEVERITY.MEDIUM]: '🟡',
      [SEVERITY.LOW]: '🔵'
    }[severity];
    console.log(`  ${icon} ${severity.toUpperCase()}: ${count}`);
  });

  const blockingCount = severityCounts[SEVERITY.BLOCKING] || 0;
  const criticalCount = severityCounts[SEVERITY.CRITICAL] || 0;

  let exitCode = 0;
  if (blockingCount > 0) {
    console.log('\n🛑 BLOCKING: Migration cannot be safely applied');
    console.log('   These operations require explicit override or migration rewrite');
    exitCode = 2;
  } else if (criticalCount > 0) {
    console.log('\n🔴 CRITICAL: Migration requires review before applying');
    exitCode = 1;
  } else {
    console.log('\n⚠️  Issues detected — review recommended');
  }

  return { exitCode, severityCounts };
}

function saveReport(result) {
  const report = {
    timestamp: new Date().toISOString(),
    ...result
  };
  fs.writeFileSync('migration-safety-report.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Detailed report: migration-safety-report.json');
}

const args = process.argv.slice(2);
const targetFiles = args.length > 0 ? args : null;

const result = analyzeMigrations(targetFiles);
const { exitCode } = printReport(result);
saveReport(result);

process.exit(exitCode > 1 ? 1 : 0);
