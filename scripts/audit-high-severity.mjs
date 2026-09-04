import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const auditArgs = ['audit', '--json'];
const networkMarkers = [
  'audit endpoint returned an error',
  'audit network timeout',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
];

function run(args, env = process.env) {
  return npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], {
      env,
      timeout: 45_000,
      killSignal: 'SIGTERM',
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
    : spawnSync('npm', args, {
      env,
      timeout: 45_000,
      killSignal: 'SIGTERM',
      shell: true,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
}

function parse(result) {
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return null;
  }
}

function networkFailure(result) {
  const diagnostic = `${result.stdout || ''}\n${result.stderr || ''}`;
  return result.error?.code === 'ETIMEDOUT'
    || networkMarkers.some(marker => diagnostic.includes(marker));
}

const audit = run(auditArgs, {
  ...process.env,
  npm_config_fetch_timeout: '30000',
  npm_config_fetch_retries: '1',
});

if (networkFailure(audit)) {
  console.warn('[audit:high] npm advisory endpoint unavailable; retrying against the local npm cache.');
  const offline = run(['audit', '--offline', '--json']);
  if (offline.error) {
    console.error(`[audit:high] offline npm audit could not start: ${offline.error.message}`);
    process.exit(1);
  }
  audit.stdout = offline.stdout;
  audit.stderr = offline.stderr;
} else if (audit.error) {
  console.error(`[audit:high] npm audit could not start: ${audit.error.message}`);
  process.exit(1);
}

let report = parse(audit);
if (!report) {
  console.error('[audit:high] npm audit returned invalid JSON.');
  console.error(audit.stderr || 'No JSON report was returned.');
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
