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

const waiver = {
  package: 'image-size',
  expiresAt: '2026-09-30T00:00:00Z',
  advisories: new Set([
    'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
    'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
  ]),
};

const waiverExpired = Date.now() >= Date.parse(waiver.expiresAt);
const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const blocking = [];
const waived = [];

function isAllowedUnpatchedImageSize(entry) {
  if (waiverExpired || entry.name !== waiver.package) return false;
  const advisories = (entry.via ?? []).filter(item => item && typeof item === 'object');
  return advisories.length === waiver.advisories.size
    && advisories.every(item => waiver.advisories.has(item.url));
}

function isPptxgenjsPropagation(entry) {
  return !waiverExpired
    && entry.name === 'pptxgenjs'
    && Array.isArray(entry.via)
    && entry.via.length === 1
    && entry.via[0] === waiver.package;
}

for (const entry of vulnerabilities) {
  if (!['high', 'critical'].includes(entry.severity)) continue;
  if (isAllowedUnpatchedImageSize(entry) || isPptxgenjsPropagation(entry)) {
    waived.push(entry);
  } else {
    blocking.push(entry);
  }
}

if (waived.length > 0) {
  console.warn(
    `[audit:high] Temporary waiver until ${waiver.expiresAt.slice(0, 10)}: `
      + `${waived.map(entry => entry.name).join(', ')}. `
      + 'PPT image ingestion is restricted to verified JPEG/PNG/GIF/WebP bytes.',
  );
}

if (blocking.length > 0) {
  for (const entry of blocking) {
    console.error(`[audit:high] ${entry.name}: ${entry.severity}`);
  }
  process.exit(1);
}

if (waiverExpired && vulnerabilities.some(entry => entry.name === waiver.package || entry.name === 'pptxgenjs')) {
  console.error(`[audit:high] The ${waiver.package} waiver expired on ${waiver.expiresAt.slice(0, 10)}.`);
  process.exit(1);
}

console.log('[audit:high] No unwaived high or critical vulnerabilities.');
