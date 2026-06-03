import { NextRequest } from 'next/server';
import { apiResponse } from './api-response';
import { sanitizeDbError } from './error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { sendSlackAlert } from './slack-alert';

export interface CronSummary {
  errors?: string[] | readonly string[];
  [key: string]: unknown;
}

type CronHandler = (request: NextRequest) => Promise<CronSummary | Response>;

export function withCronLogging(cronName: string, handler: CronHandler) {
  return async (request: NextRequest): Promise<Response> => {
    const startedAt = new Date();
    let status: 'success' | 'partial_failure' | 'error' = 'success';
    let summary: CronSummary = {};
    let errorMessages: string[] = [];
    let shouldAlert = false;
    let alertMessage = '';
    let responseBody: unknown = null;

    try {
      const result = await handler(request);
      if (result instanceof Response) {
        return result;
      }
      summary = result;

      const errs = Array.isArray(result.errors) ? (result.errors as string[]) : [];
      errorMessages = errs.slice(0, 5).map((err) => sanitizeDbError(err));
      const errorCount = errs.length;

      if (errorCount === 0) {
        status = 'success';
      } else if (errorCount <= 3) {
        status = 'partial_failure';
      } else {
        status = 'error';
        shouldAlert = true;
        alertMessage = `Cron ${cronName}: ${errorCount} errors exceeded threshold`;
      }
      responseBody = { ...result, errors: errorMessages.length ? errorMessages : result.errors };
    } catch (err) {
      status = 'error';
      const msg = sanitizeDbError(err, `${cronName} failed`);
      errorMessages = [msg];
      summary = { fatal: msg };
      shouldAlert = true;
      alertMessage = `Cron ${cronName}: exception - ${msg}`;
      responseBody = { error: msg };
      console.error(`[${cronName}] fatal:`, msg);
    }

    const finishedAt = new Date();
    const elapsedMs = finishedAt.getTime() - startedAt.getTime();

    let alerted = false;
    if (isSupabaseConfigured) {
      try {
        if (!shouldAlert && status === 'partial_failure') {
          const { data: prev } = await supabaseAdmin
            .from('cron_run_logs')
            .select('status')
            .eq('cron_name', cronName)
            .order('started_at', { ascending: false })
            .limit(1);
          const prevStatus = (prev?.[0] as { status?: string } | undefined)?.status;
          if (prevStatus === 'partial_failure' || prevStatus === 'error') {
            shouldAlert = true;
            alertMessage = `Cron ${cronName}: repeated failure detected (previous=${prevStatus})`;
          }
        }

        if (shouldAlert) {
          await sendSlackAlert(alertMessage, {
            cron: cronName,
            elapsed_ms: elapsedMs,
            first_errors: errorMessages,
          });
          alerted = true;
        }

        await supabaseAdmin.from('cron_run_logs').insert({
          cron_name: cronName,
          status,
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString(),
          elapsed_ms: elapsedMs,
          summary: summary as never,
          error_count: errorMessages.length,
          error_messages: errorMessages,
          alerted,
        } as never);
      } catch (dbErr) {
        console.warn(`[${cronName}] cron_run_logs insert failed (ignored):`, sanitizeDbError(dbErr));
      }
    }

    return apiResponse(responseBody ?? { ok: true, elapsed_ms: elapsedMs });
  };
}
