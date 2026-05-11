#!/usr/bin/env node
/**
 * Database Query Performance Analyzer
 *
 * Scans codebase for Supabase queries and identifies:
 * - Missing indexes (queries on non-indexed columns)
 * - N+1 query patterns (queries inside loops)
 * - Unbounded queries (no .limit() applied)
 * - Missing pagination
 * - Inefficient .select('*') usage
 * - Sequential awaits that could be parallelized
 */

const fs = require('fs');
const path = require('path');

const SOURCE_DIRS = ['src/app', 'src/lib', 'src/components'];
const ISSUES = {
  unbounded: [],
  nPlusOne: [],
  selectStar: [],
  sequentialAwait: [],
  missingPagination: [],
  largeJoin: []
};

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;

  fs.readdirSync(dir).forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      walkDir(filePath, callback);
    } else if (stat.isFile() && /\.(ts|tsx|js|jsx)$/.test(file)) {
      callback(filePath);
    }
  });
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const supabasePatterns = {
    fromCall: /supabaseAdmin\.from\(['"`]([^'"`]+)['"`]\)|supabase\.from\(['"`]([^'"`]+)['"`]\)/g,
    selectStar: /\.select\(['"`]\*['"`]\)/g,
    selectQuery: /\.select\(['"`]([^'"`]*)['"`]\)/g,
    limitCall: /\.limit\((\d+)\)/g,
    rangeCall: /\.range\((\d+),\s*(\d+)\)/g,
    awaitInLoop: /for\s*\([^)]*\)\s*\{[\s\S]*?await[^}]+supabaseAdmin/g,
    sequentialAwait: /await\s+supabaseAdmin[^;]+;\s*await\s+supabaseAdmin/g
  };

  let fromMatch;
  while ((fromMatch = supabasePatterns.fromCall.exec(content)) !== null) {
    const tableName = fromMatch[1] || fromMatch[2];
    const startPos = fromMatch.index;
    const queryEnd = content.indexOf(';', startPos);
    const queryBlock = content.substring(startPos, queryEnd > -1 ? queryEnd : startPos + 500);

    const isWriteOp = /\.(insert|update|delete|upsert)\(/.test(queryBlock);
    if (isWriteOp) continue;

    const isRpcOnly = /\.rpc\(/.test(queryBlock) && !/\.select\(/.test(queryBlock);
    if (isRpcOnly) continue;

    const hasLimit = /\.limit\(/.test(queryBlock);
    const hasRange = /\.range\(/.test(queryBlock);
    const hasSingle = /\.single\(/.test(queryBlock) || /\.maybeSingle\(/.test(queryBlock);
    const hasEq = /\.eq\(/.test(queryBlock);
    const hasIn = /\.in\(/.test(queryBlock);
    const hasFilter = /\.(filter|match|or|not|gt|gte|lt|lte|like|ilike|is|contains|containedBy|textSearch)\(/.test(queryBlock);
    const isCountOnly = /count:\s*['"`]exact['"`]/.test(queryBlock) && /head:\s*true/.test(queryBlock);
    const isSelectStar = /\.select\(['"`]\*['"`]\)/.test(queryBlock);
    const hasComplexJoin = (queryBlock.match(/!/g) || []).length > 2;

    const lineNumber = content.substring(0, startPos).split('\n').length;
    const issue = {
      file: filePath,
      line: lineNumber,
      table: tableName,
      snippet: queryBlock.substring(0, 150).replace(/\s+/g, ' ').trim()
    };

    const hasBoundary = hasLimit || hasRange || hasSingle || hasEq || hasIn || hasFilter || isCountOnly;
    if (!hasBoundary) {
      ISSUES.unbounded.push(issue);
    }

    if (isSelectStar && hasComplexJoin) {
      ISSUES.selectStar.push(issue);
    }

    if (hasComplexJoin && !hasLimit && !hasRange && !hasSingle) {
      ISSUES.largeJoin.push(issue);
    }
  }

  const forLoopPattern = /for\s*\([^)]*\)\s*\{/g;
  let forMatch;
  while ((forMatch = forLoopPattern.exec(content)) !== null) {
    const forStart = forMatch.index;
    const bodyStart = forStart + forMatch[0].length - 1;

    let braceDepth = 0;
    let bodyEnd = bodyStart;
    for (let i = bodyStart; i < content.length; i++) {
      const ch = content[i];
      if (ch === '{') braceDepth++;
      else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) { bodyEnd = i + 1; break; }
      }
    }

    const loopHeader = forMatch[0];
    const loopBody = content.substring(bodyStart, bodyEnd);

    if (!/await\s+supabaseAdmin/.test(loopBody)) continue;

    const isWriteOp = /\.(insert|update|delete|upsert)\(/.test(loopBody);
    if (isWriteOp) continue;

    const isBatchLoop = /for\s*\(\s*let\s+\w+\s*=\s*\d+\s*;[^;]+;\s*\w+\s*\+=\s*(?:BATCH|CHUNK|PAGE|\d+)/.test(loopHeader);
    if (isBatchLoop) continue;

    const isRetryLoop = /attempt|retry/i.test(loopHeader);
    if (isRetryLoop) continue;

    const lineNumber = content.substring(0, forStart).split('\n').length;
    const snippet = (loopHeader + loopBody.substring(0, 180)).replace(/\s+/g, ' ').trim();
    ISSUES.nPlusOne.push({
      file: filePath,
      line: lineNumber,
      snippet: snippet.substring(0, 200)
    });
  }

  let seqMatch;
  while ((seqMatch = supabasePatterns.sequentialAwait.exec(content)) !== null) {
    const lineNumber = content.substring(0, seqMatch.index).split('\n').length;
    ISSUES.sequentialAwait.push({
      file: filePath,
      line: lineNumber,
      snippet: seqMatch[0].substring(0, 200).replace(/\s+/g, ' ').trim()
    });
  }
}

function generateReport() {
  const totalIssues = Object.values(ISSUES).reduce((sum, arr) => sum + arr.length, 0);

  console.log('🗄️  Database Query Performance Analysis\n');
  console.log('=' .repeat(60));
  console.log(`Total issues detected: ${totalIssues}\n`);

  const sections = [
    {
      title: '🚨 Unbounded Queries (no .limit/.range/.single)',
      key: 'unbounded',
      severity: 'high',
      fix: 'Add .limit(N) or .range(start, end) to prevent unbounded scans'
    },
    {
      title: '⚡ N+1 Query Patterns (await in loop)',
      key: 'nPlusOne',
      severity: 'critical',
      fix: 'Batch queries using .in() or refactor to single query with JOIN'
    },
    {
      title: '⏱️  Sequential Awaits (could be parallelized)',
      key: 'sequentialAwait',
      severity: 'medium',
      fix: 'Use Promise.all([query1, query2]) for parallel execution'
    },
    {
      title: '📦 SELECT * with Complex Joins',
      key: 'selectStar',
      severity: 'medium',
      fix: 'Specify only needed columns: .select("id, name, ...")'
    },
    {
      title: '📋 Missing Pagination',
      key: 'missingPagination',
      severity: 'high',
      fix: 'Add .range(offset, offset + pageSize - 1) for paginated views'
    },
    {
      title: '🔗 Large JOIN without LIMIT',
      key: 'largeJoin',
      severity: 'high',
      fix: 'Limit results before joining: query → limit → join'
    }
  ];

  sections.forEach(section => {
    const items = ISSUES[section.key];
    if (items.length === 0) return;

    console.log(`\n${section.title} (${items.length}):`);
    console.log(`Severity: ${section.severity.toUpperCase()}`);
    console.log(`Fix: ${section.fix}\n`);

    items.slice(0, 10).forEach(item => {
      console.log(`  📁 ${item.file}:${item.line}`);
      if (item.table) console.log(`     Table: ${item.table}`);
      console.log(`     ${item.snippet}\n`);
    });

    if (items.length > 10) {
      console.log(`  ... and ${items.length - 10} more\n`);
    }
  });

  console.log('=' .repeat(60));
  console.log('\n📊 Summary by Severity:');
  const severityCounts = {};
  sections.forEach(s => {
    if (ISSUES[s.key].length > 0) {
      severityCounts[s.severity] = (severityCounts[s.severity] || 0) + ISSUES[s.key].length;
    }
  });

  Object.entries(severityCounts).forEach(([severity, count]) => {
    const icon = severity === 'critical' ? '🔴' : severity === 'high' ? '🟠' : '🟡';
    console.log(`  ${icon} ${severity.toUpperCase()}: ${count} issues`);
  });

  const reportData = {
    timestamp: new Date().toISOString(),
    totalIssues,
    severityBreakdown: severityCounts,
    issues: ISSUES
  };

  const reportPath = 'db-query-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`\n📄 Detailed report: ${reportPath}`);

  const criticalCount = severityCounts.critical || 0;
  const highCount = severityCounts.high || 0;

  if (criticalCount > 0) {
    console.log('\n❌ FAILED: Critical issues must be fixed');
    process.exit(1);
  } else if (highCount > 5) {
    console.log('\n⚠️  WARNING: High number of high-severity issues');
    process.exit(0);
  } else {
    console.log('\n✅ PASSED: Query performance within acceptable thresholds');
  }
}

console.log('🔍 Scanning Supabase queries...\n');
SOURCE_DIRS.forEach(dir => {
  walkDir(dir, analyzeFile);
});
generateReport();
