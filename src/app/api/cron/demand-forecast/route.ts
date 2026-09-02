/**
 * GET /api/cron/demand-forecast
 *
 * Compatibility endpoint. The old 90-day booking-pace baseline cannot satisfy
 * the Forecast Lab's 180-day/8-cutoff evidence contract, so it performs no
 * forecast-table write and no charter decision.
 */
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function run() {
  return {
    ok: true,
    status: 'data_insufficient' as const,
    reason: 'PII_FREE_DAILY_AGGREGATE_180D_REQUIRED',
    reference_table: 'demand_forecast_v2' as const,
    forecasts_written: 0,
    downstream_mutations_allowed: false,
    charter_decision_allowed: false,
  };
}

export const GET = withCronLogging('demand-forecast', async (request) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return run();
});
