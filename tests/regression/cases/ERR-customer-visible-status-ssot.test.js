const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SCAN_DIRS = ['src/app', 'src/lib', 'scripts'];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const forbidden = [
  {
    name: 'supabase active/approved status tuple',
    pattern: /\.in\(\s*['"]status['"]\s*,\s*\[\s*(?:['"]active['"]\s*,\s*['"]approved['"]|['"]approved['"]\s*,\s*['"]active['"])\s*\]\s*\)/,
  },
  {
    name: 'public eligibility script active/approved default',
    pattern: /argValue\(\s*['"]status['"]\s*,\s*['"]active,approved['"]\s*\)/,
  },
  {
    name: 'mobile quality engine active/approved public-only status',
    pattern: /publicOnly\s*\?\s*['"]active,approved['"]/,
  },
];

const offenders = [];
for (const relativeDir of SCAN_DIRS) {
  const dir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) {
        offenders.push(`${path.relative(ROOT, file)}: ${rule.name}`);
      }
    }
  }
}

assert.deepStrictEqual(
  offenders,
  [],
  `Customer-visible package status must use CUSTOMER_VISIBLE_STATUSES SSOT:\n${offenders.join('\n')}`,
);

const auditSource = fs.readFileSync(path.join(ROOT, 'scripts/audit-package-public-eligibility.ts'), 'utf8');
assert.match(auditSource, /CUSTOMER_VISIBLE_STATUSES/);
assert.match(auditSource, /CUSTOMER_VISIBLE_STATUSES\.join\(','\)/);
