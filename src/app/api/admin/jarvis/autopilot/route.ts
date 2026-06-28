import type { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard, resolveAdminActorLabel } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  buildDecisionPacketForAction,
  getLatestDecisionPackets,
  persistDecisionPacketForAction,
  type AgentActionForDecision,
} from '@/lib/agent-action-decision-packets';

type AgentActionRow = AgentActionForDecision & {
  status: string;
  priority: string;
  created_at: string;
  requested_by?: string | null;
  reviewed_by?: string | null;
  result_log?: unknown;
  reject_reason?: string | null;
  expires_at?: string | null;
  resolved_at?: string | null;
};

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function parseLimit(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get('limit') ?? 20);
  if (!Number.isFinite(raw)) return 20;
  return Math.min(50, Math.max(1, Math.floor(raw)));
}

async function loadAction(actionId: string): Promise<AgentActionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('agent_actions')
    .select('*')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AgentActionRow | null;
}

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ actions: [], total: 0 });
  }

  try {
    const status = request.nextUrl.searchParams.get('status') ?? 'pending';
    const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10));
    const limit = parseLimit(request);
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('agent_actions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status !== 'all') {
      query = query.in('status', status.split(',').map((item) => item.trim()).filter(Boolean));
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const actions = (data ?? []) as AgentActionRow[];
    const latestPackets = await getLatestDecisionPackets(actions.map((action) => action.id));
    const withPackets = actions.map((action) => ({
      ...action,
      decision_packet: latestPackets[action.id] ?? buildDecisionPacketForAction(action),
    }));

    return apiResponse({
      actions: withPackets,
      total: count ?? 0,
      page,
      limit,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }
};

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  try {
    const actor = await resolveAdminActorLabel(request);
    const body = await request.json();
    const actionId = typeof body?.action_id === 'string' ? body.action_id : null;
    if (!actionId) {
      return apiResponse({ error: 'action_id is required.' }, { status: 400 });
    }

    const action = await loadAction(actionId);
    if (!action) {
      return apiResponse({ error: 'Action not found.' }, { status: 404 });
    }

    const persisted = await persistDecisionPacketForAction(action, {
      source: 'admin_simulate',
      createdBy: actor,
    });

    return apiResponse({
      action_id: actionId,
      decision_packet: persisted.packet,
      persisted: persisted.persisted,
      persist_error: persisted.persistError,
    });
  } catch (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
