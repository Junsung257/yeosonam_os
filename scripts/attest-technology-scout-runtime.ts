import { attestTechnologyScoutRuntime } from '../src/lib/agent/pilot';

async function main() {
  const report = await attestTechnologyScoutRuntime();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.restrictedReadableRootsSupported) process.exitCode = 1;
}

void main();
