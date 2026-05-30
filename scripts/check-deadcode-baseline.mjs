#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const baselinePath = new URL('./knip-baseline.json', import.meta.url);

function issueKeys(report) {
  const keys = [];
  for (const issue of report.issues ?? []) {
    for (const type of [
      'files',
      'dependencies',
      'devDependencies',
      'optionalPeerDependencies',
      'unlisted',
      'unresolved',
      'binaries',
      'exports',
      'types',
      'duplicates',
      'enumMembers',
      'namespaceMembers',
      'catalog',
    ]) {
      for (const item of issue[type] ?? []) {
        const name = Array.isArray(item)
          ? item.map((entry) => entry.name).join(',')
          : item.name;
        keys.push(`${type}:${issue.file}:${name}`);
      }
    }
  }
  return keys.sort();
}

if (!fs.existsSync(baselinePath)) {
  console.error(`[deadcode] Missing baseline: ${baselinePath.pathname}`);
  process.exit(1);
}

const result = process.platform === 'win32'
  ? spawnSync(
      'cmd.exe',
      ['/c', '.\\node_modules\\.bin\\knip.cmd', '--reporter', 'json', '--no-exit-code'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
  : spawnSync(
      './node_modules/.bin/knip',
      ['--reporter', 'json', '--no-exit-code'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const current = issueKeys(JSON.parse(result.stdout || '{"issues":[]}'));
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).issues ?? [];
const baselineSet = new Set(baseline);
const currentSet = new Set(current);

const added = current.filter((key) => !baselineSet.has(key));
const removed = baseline.filter((key) => !currentSet.has(key));

console.log(`[deadcode] current=${current.length} baseline=${baseline.length} new=${added.length} resolved=${removed.length}`);

if (added.length > 0) {
  console.error('[deadcode] New unbaselined issues:');
  for (const key of added.slice(0, 50)) console.error(`- ${key}`);
  if (added.length > 50) console.error(`... ${added.length - 50} more`);
  process.exit(1);
}

if (removed.length > 0) {
  console.log('[deadcode] Existing baseline issues resolved; update scripts/knip-baseline.json when ready.');
}
