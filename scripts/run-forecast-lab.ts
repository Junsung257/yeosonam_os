import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runForecastLab, type DailyDemandAggregateV1, type ForecastMetric } from '../src/lib/forecast-lab';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputPath = argument('--input');
const metric = argument('--metric') as ForecastMetric | undefined;
if (!inputPath || (metric !== 'inquiries' && metric !== 'bookings')) {
  console.error('Usage: npm run forecast:lab -- --input <pii-free-daily.json> --metric inquiries|bookings');
  process.exit(2);
}
const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as { rows?: DailyDemandAggregateV1[] } | DailyDemandAggregateV1[];
const rows = Array.isArray(input) ? input : input.rows;
if (!Array.isArray(rows)) throw new Error('FORECAST_LAB_ROWS_REQUIRED');
console.log(JSON.stringify(runForecastLab(rows, metric), null, 2));
