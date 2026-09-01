import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(resolve(root, 'config/forecast-lab-policy.json'), 'utf8'));
const predictive = readFileSync(resolve(root, 'src/lib/predictive-marketing.ts'), 'utf8');
const cron = readFileSync(resolve(root, 'src/app/api/cron/demand-forecast/route.ts'), 'utf8');
const legacyPipeline = readFileSync(resolve(root, 'scripts/demand-forecast-pipeline.py'), 'utf8');
const lab = readFileSync(resolve(root, 'src/lib/forecast-lab.ts'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(policy.tables.shadowAuthority === 'demand_forecast_v2', 'demand_forecast_v2 must be the shadow authority');
requireValue(policy.tables.newTableAllowed === false, 'A fourth forecast table is forbidden');
requireValue(policy.tables.legacyReadOnly.includes('demand_forecast') && policy.tables.legacyReadOnly.includes('demand_forecasts'), 'Both legacy tables must be read-only');
requireValue(policy.data.minimumDays === 180 && policy.data.rollingCutoffs === 8 && policy.data.segmentMinimumObservedDays === 60, 'Evidence thresholds differ from policy');
requireValue(policy.candidateGate.minimumWapeImprovementPercent === 10 && policy.candidateGate.productionMutationAllowed === false, 'Candidate gate is unsafe');
requireValue(policy.blockedModels.some((model) => model.name === 'TimesFM-3' && model.status === 'license_blocked' && model.downloadAllowed === false), 'TimesFM-3 must stay license-blocked');
requireValue(!predictive.includes('Math.random'), 'Predictive marketing must not synthesize time series with Math.random');
requireValue(!predictive.includes('confidence: 0.95'), 'Predictive marketing must not emit fabricated confidence');
requireValue(predictive.includes("status: 'automation_disabled'") && predictive.includes('FORECAST_DOWNSTREAM_MUTATION_FORBIDDEN'), 'Predictive auto-queue must be disabled');
requireValue(!cron.includes(".from('demand_forecast_v2')") && cron.includes('forecasts_written: 0'), 'Legacy cron must not write shadow forecasts');
requireValue(!/table\(["']demand_forecasts["']\)\.upsert/u.test(legacyPipeline), 'Legacy Python pipeline must not write demand_forecasts');
requireValue(lab.includes('downstreamMutationsAllowed: false') && lab.includes("referenceTable: 'demand_forecast_v2'"), 'Forecast Lab must remain advisory shadow output');
requireValue(!/supabase|\.insert\(|\.upsert\(|\.update\(/iu.test(lab), 'Forecast Lab core must have no database mutation surface');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log('Forecast Lab contract passed.');
