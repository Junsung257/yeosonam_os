import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const maxDuration = 20;

const HITL_REMINDER_QUERY_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.HITL_REMINDER_QUERY_TIMEOUT_MS || '8000') || 8000,
);

type StaleTask = {
  id: string;
  risk_level: string | null;
  task_context: unknown;
  created_at: string;
};

type AbortableQuery<T> = {
  abortSignal: (signal: AbortSignal) => PromiseLike<T>;
};

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    return error.name === 'AbortError' || /abort|timeout|timed out|connection timeout/i.test(error.message);
  }
  const message = typeof error === 'object' ? JSON.stringify(error) : String(error);
  return /abort|timeout|timed out|connection timeout/i.test(message);
}

async function runHitlQuery<T>(query: AbortableQuery<T>, timeoutMs = HITL_REMINDER_QUERY_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await query.abortSignal(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function minutesWaiting(createdAt: string): number {
  const started = new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 60_000));
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    return apiResponse({ skipped: true, reason: 'Supabase not configured' });
  }

  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: staleTasks, error } = await runHitlQuery(
      supabaseAdmin
        .from('agent_tasks')
        .select('id, risk_level, task_context, created_at')
        .eq('status', 'frozen')
        .lt('created_at', thirtyMinAgo)
        .order('created_at', { ascending: true })
        .limit(10),
    );

    if (error) throw error;
    const tasks = (staleTasks ?? []) as StaleTask[];
    if (tasks.length === 0) return apiResponse({ stale: 0 });

    const lines = tasks.map((task) => {
      const risk = (task.risk_level || 'unknown').toUpperCase();
      return `[${risk}] task ${task.id.slice(0, 8)} waiting ${minutesWaiting(task.created_at)}m`;
    });

    await sendSlackAlert(
      `[hitl-reminder] Stale HITL tasks: ${tasks.length}`,
      { items: lines, action: '/admin/escalations' },
    );

    return apiResponse({ stale: tasks.length });
  } catch (err) {
    const message = sanitizeDbError(err, 'HITL reminder failed');
    if (isAbortLikeError(err)) {
      await sendSlackAlert(`[hitl-reminder] Query timed out after ${HITL_REMINDER_QUERY_TIMEOUT_MS}ms`);
      return apiResponse({ stale: 0, degraded: true, reason: 'query_timeout' });
    }
    await sendSlackAlert(`[hitl-reminder] Cron error: ${message}`);
    return apiResponse({ error: message }, { status: 500 });
  }
}
