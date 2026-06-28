import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { resolveAdminActorLabel, withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isValidTransition } from '@/lib/agent-action-machine';
import { executeAction } from '@/lib/agent-action-executor';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import {
  persistDecisionPacketForAction,
  recordDecisionPacketOutcome,
} from '@/lib/agent-action-decision-packets';

const VALID_AGENT_TYPES = ['operations', 'sales', 'marketing', 'finance', 'products', 'system'] as const;
const VALID_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ actions: [], total: 0 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') || 'pending';
    const agentType = searchParams.get('agent_type');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;
    const countMode = searchParams.get('count') === 'none' ? null : 'exact';
    const compact = searchParams.get('fields') === 'compact';
    const selectColumns = compact
      ? 'id, agent_type, action_type, summary, priority, status, created_at'
      : '*';

    if (compact && status === 'pending' && !agentType && page === 1 && countMode === null) {
      const { data, error } = await supabaseAdmin.rpc('get_pending_agent_actions_compact', { p_limit: limit });
      if (!error && data) {
        return apiResponse(data, { headers: NO_STORE_HEADERS });
      }
    }

    let query = supabaseAdmin
      .from('agent_actions')
      .select(selectColumns, countMode ? { count: countMode } : undefined);

    if (status !== 'all') {
      query = query.in('status', status.split(',').map((item) => item.trim()).filter(Boolean));
    }
    if (agentType) {
      query = query.eq('agent_type', agentType);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return apiResponse({
      actions: data ?? [],
      total: count ?? 0,
      page,
      limit,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get('sb-access-token')?.value;
  if (!token) {
    return apiResponse({ error: 'Authentication required.' }, { status: 401 });
  }
  const verified = await verifySupabaseAccessToken(token);
  if (!verified.ok) {
    return apiResponse({ error: 'Session is not valid.' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { agent_type, action_type, summary, payload, requested_by, priority, expires_at } = body;

    if (!agent_type || !action_type || !summary) {
      return apiResponse({ error: 'agent_type, action_type, summary are required.' }, { status: 400 });
    }
    if (!VALID_AGENT_TYPES.includes(agent_type)) {
      return apiResponse({ error: `Invalid agent_type: ${agent_type}` }, { status: 400 });
    }
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return apiResponse({ error: `Invalid priority: ${priority}` }, { status: 400 });
    }

    const insertData: Record<string, unknown> = {
      agent_type,
      action_type,
      summary,
      payload: payload ?? {},
      requested_by: requested_by || 'jarvis',
      priority: priority || 'normal',
    };
    if (expires_at) insertData.expires_at = expires_at;

    const { data, error } = await supabaseAdmin
      .from('agent_actions')
      .insert(insertData)
      .select();

    if (error) throw error;

    return apiResponse({ action: data?.[0], success: true });
  } catch (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }
}

const patchHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { action_id, action, reject_reason, reviewed_by } = body;

    if (!action_id || !action) {
      return apiResponse({ error: 'action_id and action(approve|reject) are required.' }, { status: 400 });
    }
    if (action !== 'approve' && action !== 'reject') {
      return apiResponse({ error: 'action must be approve or reject.' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('agent_actions')
      .select('id, status, agent_type, action_type, summary, payload, requested_by, tenant_id')
      .eq('id', action_id)
      .limit(1);
    if (existingError) throw existingError;

    const current = existing?.[0];
    if (!current) {
      return apiResponse({ error: 'Action not found.' }, { status: 404 });
    }

    const targetStatus = action === 'approve' ? 'approved' : 'rejected';
    if (!isValidTransition(current.status, targetStatus)) {
      return apiResponse({ error: `${current.status} -> ${targetStatus} is not allowed.` }, { status: 400 });
    }

    const actor = reviewed_by || await resolveAdminActorLabel(request);
    const updateData: Record<string, unknown> = {
      resolved_at: new Date().toISOString(),
      reviewed_by: actor,
    };

    if (action === 'approve') {
      const decision = await persistDecisionPacketForAction(current, {
        source: 'approval_preflight',
        createdBy: actor,
      });

      if (decision.packet.recommendation !== 'approve') {
        await recordDecisionPacketOutcome({
          actionId: action_id,
          decision: 'reject',
          reviewedBy: actor,
          reason: decision.packet.recommendationReason,
        });
        return apiResponse({
          error: 'Autopilot did not recommend approval.',
          decision_packet: decision.packet,
          persisted: decision.persisted,
          persist_error: decision.persistError,
        }, { status: 409 });
      }

      const execResult = await executeAction(current.action_type, current.payload || {});
      if (execResult.success) {
        updateData.status = 'executed';
        updateData.result_log = JSON.stringify({ success: true, data: execResult.data });
        await recordDecisionPacketOutcome({
          actionId: action_id,
          decision: 'approve',
          reviewedBy: actor,
          reason: 'executed',
        });
      } else {
        updateData.status = 'failed';
        updateData.reject_reason = execResult.error;
        updateData.result_log = JSON.stringify({ success: false, error: execResult.error });
      }
    } else {
      updateData.status = 'rejected';
      if (reject_reason) updateData.reject_reason = reject_reason;
      await recordDecisionPacketOutcome({
        actionId: action_id,
        decision: 'reject',
        reviewedBy: actor,
        reason: reject_reason ?? 'rejected_by_admin',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('agent_actions')
      .update(updateData)
      .eq('id', action_id)
      .select();

    if (error) throw error;

    return apiResponse({ action: data?.[0], success: true });
  } catch (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }
};

export const PATCH = withAdminGuard(patchHandler);
