/**
 * Cron 관찰성 래퍼 — 10년 운영 기반.
 *
 * 모든 크론 라우트가 이걸로 감싸면:
 *   - cron_run_logs 에 자동 기록 (success/partial_failure/error)
 *   - 연속 실패 또는 error_count 임계 초과 시 Slack 알림
 *   - elapsed_ms, summary JSON 영구 보존 → 회귀 분석 가능
 *
 * 사용:
 *   export const GET = withCronLogging('publish-scheduled', async (req) => {
 *     // ... 기존 로직
 *     return { picked: 10, published: 8, errors: [...] };
 *   });
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { sendSlackAlert } from './slack-alert';

export interface CronSummary {
  errors?: string[] | readonly string[];
  [key: string]: unknown;
}

type CronHandler = (request: NextRequest) => Promise<CronSummary | Response>;

export function withCronLogging(cronName: string, handler: CronHandler) {
  return async (request: NextRequest): Promise<Response> => {
    // Authorization 체크는 각 핸들러가 담당. 여기선 실행만 감쌈.
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
        // 핸들러가 직접 Response 반환 — unauthorized 등
        return result;
      }
      summary = result;

      const errs = Array.isArray(result.errors) ? (result.errors as string[]) : [];
      errorMessages = errs.slice(0, 5);
      const errorCount = errs.length;

      if (errorCount === 0) {
        status = 'success';
      } else if (errorCount <= 3) {
        status = 'partial_failure';
      } else {
        status = 'error';
        shouldAlert = true;
        alertMessage = `🚨 크론 ${cronName}: 에러 ${errorCount}건 (임계 초과)`;
      }
      responseBody = result;
    } catch (err) {
      status = 'error';
      const msg = err instanceof Error ? err.message : String(err);
      errorMessages = [msg];
      summary = { fatal: msg };
      shouldAlert = true;
      alertMessage = `🚨 크론 ${cronName}: 예외 발생 — ${msg}`;
      responseBody = { error: msg };
      console.error(`[${cronName}] fatal:`, err);
    }

    const finishedAt = new Date();
    const elapsedMs = finishedAt.getTime() - startedAt.getTime();

    // DB 기록 (실패해도 응답엔 영향 없음)
    let alerted = false;
    if (isSupabaseConfigured) {
      try {
        // 연속 실패 판정: 직전 실행도 실패였으면 alert
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
            alertMessage = `⚠️ 크론 ${cronName}: 연속 실패 감지 (직전도 ${prevStatus})`;
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
        console.warn(`[${cronName}] cron_run_logs 기록 실패 (무시):`, dbErr);
      }
    }

    return NextResponse.json(responseBody ?? { ok: true, elapsed_ms: elapsedMs });
  };
}
