#!/usr/bin/env node
/**
 * Report coverage between documented ERR incidents and executable regression
 * fixtures in tests/regression/cases.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ERR_REGISTRY_FILES = [
  path.join(ROOT, 'db', 'error-registry.md'),
  path.join(ROOT, 'docs', 'errors', 'product-registration.md'),
  path.join(ROOT, 'docs', 'errors', 'blog.md'),
  path.join(ROOT, 'docs', 'errors', 'affiliate.md'),
  path.join(ROOT, 'docs', 'errors', 'settlement.md'),
  path.join(ROOT, 'docs', 'errors', 'ai-ops.md'),
  path.join(ROOT, 'docs', 'errors', 'common.md'),
];
const CASES_DIR = path.join(ROOT, 'tests', 'regression', 'cases');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    uncovered: args.includes('--uncovered'),
    json: args.includes('--json'),
    allUncovered: args.includes('--all-uncovered'),
  };
}

function normalizeCode(code) {
  return code.split('@')[0].replace(/[):\].;,\s]+$/, '');
}

function cleanBody(body) {
  return String(body || '').trim().replace(/\s+/g, ' ');
}

function pushErr(out, seen, code, category, body, source) {
  if (!code || code === 'ERR-YYYYMMDD-NN') return;
  const fullCode = code.replace(/[):\].;,\s]+$/, '');
  const normalized = normalizeCode(fullCode);
  if (seen.has(normalized)) return;
  seen.add(normalized);

  const cleaned = cleanBody(body);
  out.push({
    code: normalized,
    fullCode,
    date: fullCode.includes('@') ? fullCode.split('@')[1] : null,
    category: cleanBody(category),
    body: cleaned.slice(0, 180) + (cleaned.length > 180 ? '...' : ''),
    source,
  });
}

function parseRegistryFile(file) {
  const out = [];
  const seen = new Set();
  const text = fs.readFileSync(file, 'utf-8');
  const lines = text.split(/\r?\n/);
  const source = path.relative(ROOT, file);

  const headingRe = /^#{2,3}\s+(ERR-[A-Za-z0-9_-]+(?:@[\d-]+)?)(?:[:\s\-–—]+)?(.*)$/;
  const checklistRe = /^-\s*\[\s*[ xX]?\s*\]\s*\*\*(ERR-[A-Za-z0-9_-]+(?:@[\d-]+)?)\*\*\s*(?:\(([^)]+)\))?\s*[:\-–—]?\s*(.*)$/;
  const numberedBoldRe = /^\d+\.\s+\*\*(ERR-[A-Za-z0-9_-]+(?:@[\d-]+)?)\*\*\s*(?:\(([^)]+)\))?\s*[\-–—:]?\s*(.*)$/;
  const bulletBoldRe = /^-\s+\*\*(ERR-[A-Za-z0-9_-]+(?:@[\d-]+)?)\*\*\s*(?:\(([^)]+)\))?\s*[:\-–—]?\s*(.*)$/;

  for (const line of lines) {
    const heading = line.match(headingRe);
    if (heading) {
      pushErr(out, seen, heading[1], '', heading[2] || '', source);
      continue;
    }
    const checklist = line.match(checklistRe);
    if (checklist) {
      pushErr(out, seen, checklist[1], checklist[2] || '', checklist[3] || '', source);
      continue;
    }
    const numbered = line.match(numberedBoldRe);
    if (numbered) {
      pushErr(out, seen, numbered[1], numbered[2] || '', numbered[3] || '', source);
      continue;
    }
    const bullet = line.match(bulletBoldRe);
    if (bullet) {
      pushErr(out, seen, bullet[1], bullet[2] || '', bullet[3] || '', source);
    }
  }
  return out;
}

function parseRegistry() {
  const all = [];
  const seen = new Set();
  for (const file of ERR_REGISTRY_FILES) {
    if (!fs.existsSync(file)) continue;
    for (const err of parseRegistryFile(file)) {
      if (seen.has(err.code)) continue;
      seen.add(err.code);
      all.push(err);
    }
  }
  return all;
}

function parseFixtures(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.test.js'))
    .map((file) => {
      const text = fs.readFileSync(path.join(dir, file), 'utf-8');
      const match = text.match(/@case\s+([A-Z][A-Za-z0-9_-]+(?:@[\d-]+)?)/);
      return {
        file,
        caseCode: match ? normalizeCode(match[1]) : file.replace(/\.test\.js$/, ''),
        tests: (text.match(/^test\(/gm) || []).length,
      };
    });
}

function categorize(err) {
  const text = `${err.category || ''} ${err.body || ''}`.toLowerCase();
  if (/security|pii|secret|auth|token|passport|leak|보안|누출/.test(text)) return 'security';
  if (/ux|visual|render|mobile|a4|ui|viewport|card|화면|노출|렌더|모바일/.test(text)) return 'ux-render';
  if (/parse|parser|verbatim|raw|itinerary|schedule|price|catalog|split|flight|hotel|일정|가격|원문|파싱|데이터/.test(text)) return 'data-parse';
  if (/struct|schema|column|field|migration|db|cron|infra|workflow|구조|컬럼|인프라/.test(text)) return 'structure';
  if (/blog|seo|gsc|index|publish|editorial/.test(text)) return 'blog';
  return 'other';
}

function isFixtureCandidate(err) {
  const category = categorize(err);
  if (category === 'other') return false;
  if (/manual|사장님 명시 승인|rotation|운영 URL|production log/i.test(err.body)) return false;
  return true;
}

function main() {
  const args = parseArgs();
  const errs = parseRegistry();
  const fixtures = parseFixtures(CASES_DIR);
  const fixtureCodes = new Set(fixtures.map((fixture) => fixture.caseCode));

  const covered = errs.filter((err) => fixtureCodes.has(err.code));
  const uncovered = errs.filter((err) => !fixtureCodes.has(err.code));
  const candidates = uncovered.filter(isFixtureCandidate);
  const summary = {
    total_errs: errs.length,
    total_fixtures: fixtures.length,
    total_tests: fixtures.reduce((sum, fixture) => sum + fixture.tests, 0),
    covered: covered.length,
    uncovered: uncovered.length,
    candidates_for_next: candidates.length,
    coverage_pct: errs.length > 0 ? Math.round((covered.length / errs.length) * 100) : 0,
  };

  if (args.json) {
    console.log(JSON.stringify({
      summary,
      covered: covered.map((err) => ({ code: err.code, category: err.category, inferred_category: categorize(err), source: err.source })),
      uncovered: uncovered.map((err) => ({ code: err.code, category: err.category, inferred_category: categorize(err), body: err.body, source: err.source })),
      candidates,
    }, null, 2));
    return;
  }

  if (args.uncovered || args.allUncovered) {
    const rows = args.allUncovered ? uncovered : candidates;
    console.log(`Uncovered ERR ${args.allUncovered ? 'items' : 'fixture candidates'}: ${rows.length}\n`);
    for (const err of rows.slice(0, 80)) {
      console.log(`  - ${err.code} [${categorize(err)}] ${err.source}`);
      if (err.body) console.log(`    ${err.body}`);
    }
    if (rows.length > 80) console.log(`  ... ${rows.length - 80} more`);
    return;
  }

  console.log('='.repeat(72));
  console.log('Regression Fixture Coverage - docs/errors vs tests/regression/cases');
  console.log('='.repeat(72));
  console.log(`ERR items:           ${summary.total_errs}`);
  console.log(`Fixture files/tests: ${summary.total_fixtures} files / ${summary.total_tests} tests`);
  console.log(`Covered ERR:         ${summary.covered}`);
  console.log(`Uncovered ERR:       ${summary.uncovered}`);
  console.log(`Next candidates:     ${summary.candidates_for_next}`);
  console.log(`Coverage:            ${summary.coverage_pct}%`);
  console.log();

  if (covered.length > 0) {
    console.log('Covered ERR:');
    for (const err of covered) console.log(`   - ${err.code} [${categorize(err)}]`);
    console.log();
  }

  if (candidates.length > 0) {
    console.log('Next fixture candidates:');
    for (const err of candidates.slice(0, 12)) {
      console.log(`   - ${err.code} [${categorize(err)}] ${err.source}`);
    }
    if (candidates.length > 12) console.log(`   ... +${candidates.length - 12} more`);
    console.log();
  }

  console.log('Commands:');
  console.log('   node tests/regression/err-coverage.js --uncovered');
  console.log('   node tests/regression/err-coverage.js --all-uncovered');
  console.log('   node tests/regression/err-coverage.js --json');
  console.log('   npm run test:regression');
}

main();
