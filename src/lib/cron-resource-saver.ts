import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';

const OFF_VALUES = new Set(['0', 'false', 'off', 'disabled', 'no']);
const ON_VALUES = new Set(['1', 'true', 'on', 'enabled', 'yes']);

export function isDbResourceSaverEnabled(): boolean {
  const raw =
    process.env.DB_RESOURCE_SAVER_MODE ??
    process.env.SUPABASE_RESOURCE_SAVER_MODE ??
    '';
  const mode = raw.trim().toLowerCase();

  if (OFF_VALUES.has(mode)) return false;
  if (ON_VALUES.has(mode)) return true;

  return process.env.NODE_ENV === 'production';
}

export function isCronForceRun(request: NextRequest | Request): boolean {
  const url = request instanceof NextRequest ? request.nextUrl : new URL(request.url);
  return url.searchParams.get('force') === 'true' || url.searchParams.get('forceRun') === 'true';
}

export function maybeSkipNonCriticalCron(request: NextRequest, cronName: string): Response | null {
  if (!isDbResourceSaverEnabled() || isCronForceRun(request)) return null;

  const res = apiResponse({
    ok: true,
    skipped: true,
    cron: cronName,
    reason: 'db_resource_saver_mode',
    message:
      'Skipped non-critical cron while Supabase is under pressure. Set DB_RESOURCE_SAVER_MODE=0 after recovery or call with force=true for a one-off run.',
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

const RESOURCE_SAVER_ALLOWED_CRONS = new Set([
  'refresh-registration-mv',
  'auto-archive',
  'resweep-unmatched',
  'unmatched-auto-resolve',
  'entity-resolution',
  'legacy-sections-backfill',
  'fill-attraction-photos',
  'upload-review-auto-replay',
  'learning-flywheel',
  'product-registration-learning-report',
]);

export function maybeSkipCronForResourceSaver(request: NextRequest, cronName: string): Response | null {
  if (RESOURCE_SAVER_ALLOWED_CRONS.has(cronName)) return null;
  return maybeSkipNonCriticalCron(request, cronName);
}

export function shouldSkipCronDbLogging(): boolean {
  return isDbResourceSaverEnabled();
}
