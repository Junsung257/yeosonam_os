import { type NextRequest } from 'next/server';

import { apiResponse } from '@/lib/api-response';
import { requirePlatformAdminRequest } from '@/lib/admin-guard';
import {
  buildAgentOfficeKpiSnapshot,
  buildUnavailableKpiSnapshot,
  parseAgentOfficeKpiWindow,
  windowToDurationMs,
  type AgentOfficeKpiWindow,
} from '@/lib/agent-office-kpi';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getWindow(request: NextRequest): AgentOfficeKpiWindow {
  return parseAgentOfficeKpiWindow(request.nextUrl.searchParams.get('window'));
}

function getWindowBounds(window: AgentOfficeKpiWindow, now = Date.now()) {
  const to = new Date(now).toISOString();
  const from = new Date(now - windowToDurationMs(window)).toISOString();
  return { from, to };
}

function unavailableResponse(
  window: AgentOfficeKpiWindow,
  bounds: { from: string; to: string },
  reason: 'SUPABASE_NOT_CONFIGURED' | 'KPI_RPC_NOT_APPLIED' | 'KPI_RPC_FAILED',
  status = 200,
) {
  const response = apiResponse(buildUnavailableKpiSnapshot({ window, ...bounds, reason }), { status });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/**
 * Returns exact period KPIs from the versioned database RPC. The bounded
 * snapshot endpoint remains the detail/read-model source; it is never used to
 * manufacture a period KPI when the aggregate contract is unavailable.
 */
export async function GET(request: NextRequest) {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;

  const window = getWindow(request);
  const bounds = getWindowBounds(window);
  if (!isSupabaseConfigured) return unavailableResponse(window, bounds, 'SUPABASE_NOT_CONFIGURED');

  try {
    const { data, error } = await supabaseAdmin.rpc('get_agent_office_kpi_v1', {
      p_window_start: bounds.from,
      p_window_end: bounds.to,
    });
    if (error) {
      const code = typeof error.code === 'string' ? error.code : '';
      const missing = code === '42883' || code === 'PGRST202' || code === '42P01';
      return unavailableResponse(window, bounds, missing ? 'KPI_RPC_NOT_APPLIED' : 'KPI_RPC_FAILED');
    }
    if (!Array.isArray(data)) return unavailableResponse(window, bounds, 'KPI_RPC_FAILED');

    const snapshot = buildAgentOfficeKpiSnapshot({
      window,
      ...bounds,
      rows: data as Array<{
        metric_key: string;
        value: number | string | null;
        source_updated_at: string | null;
      }>,
    });
    const response = apiResponse(snapshot);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('[agent-office-kpi] aggregate failed', error);
    return unavailableResponse(window, bounds, 'KPI_RPC_FAILED');
  }
}
