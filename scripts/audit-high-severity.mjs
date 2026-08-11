import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const audit = npmCli
  ? spawnSync(process.execPath, [npmCli, 'audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  : spawnSync('npm audit --json', {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

if (audit.error) {
  console.error(`[audit:high] npm audit could not start: ${audit.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout || '{}');
} catch (error) {
  console.error('[audit:high] npm audit returned invalid JSON.');
  console.error(audit.stderr || (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const blocking = vulnerabilities.filter(entry => ['high', 'critical'].includes(entry.severity));

if (blocking.length > 0) {
  for (const entry of blocking) {
    console.error(`[audit:high] ${entry.name}: ${entry.severity}`);
  }
  process.exit(1);
}

console.log('[audit:high] No high or critical vulnerabilities.');
