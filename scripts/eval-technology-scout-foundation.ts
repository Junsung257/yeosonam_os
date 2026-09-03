import { buildTechnologyScoutFoundationPreflightReport } from '../src/lib/agent/pilot';

const report = buildTechnologyScoutFoundationPreflightReport();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.evidence.contractFixturesPassed !== 30) process.exitCode = 1;
