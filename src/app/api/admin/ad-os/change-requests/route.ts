import { NextRequest, NextResponse } from 'next/server';
import {
  approvalRequiredForChange,
  riskForChangeRequest,
  titleForChangeRequest,
  type AdOsChangeRequestType,
} from '@/lib/ad-os-change-request';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const REQUEST_TYPES = new Set([
  'create_keyword',
  'pause_keyword',
  'increase_bid',
  'decrease_bid',
  'budget_change',
  'pause_channel',
  'replace_landing',
  'create_landing',
  'create_campaign',
  'sync_external_asset',
]);

const STATUS_UPDATES = new Set(['approved', 'rejected', 'applied', 'rolled_back', 'expired']);

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const status = request.nextUrl.searchParams.get('status');
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 80), 1), 200);
  let query = supabaseAdmin
    .from('ad_os_change_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    requests: data || [],
    summary: {
      total: data?.length ?? 0,
      proposed: (data || []).filter((row: { status?: string }) => row.status === 'proposed').length,
      high_risk: (data || []).filter((row: { risk_level?: string }) => ['high', 'critical'].includes(row.risk_level || '')).length,
    },
  });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const requestType = String(body.request_type || '') as AdOsChangeRequestType;
  if (!REQUEST_TYPES.has(requestType)) {
    return NextResponse.json({ ok: false, error: '지원하지 않는 request_type' }, { status: 400 });
  }
  if (!body.target_table || !body.target_id) {
    return NextResponse.json({ ok: false, error: 'target_table, target_id가 필요합니다.' }, { status: 400 });
  }

  const automationLevel = Math.max(0, Math.min(5, Math.round(Number(body.automation_level || 2))));
  const riskLevel = riskForChangeRequest({
    requestType,
    automationLevel,
    externalSpendKrw: Number(body.external_spend_krw || 0),
    changesExternalAccount: Boolean(body.changes_external_account),
  });
  const approvalRequired = approvalRequiredForChange({
    requestType,
    automationLevel,
    fullAutoEnabled: Boolean(body.full_auto_enabled),
    requireHumanApproval: body.require_human_approval !== false,
    riskLevel,
  });

  const row = {
    tenant_id: body.tenant_id || null,
    decision_log_id: body.decision_log_id || null,
    run_id: body.run_id || null,
    platform: body.platform || null,
    automation_level: automationLevel,
    request_type: requestType,
    target_table: String(body.target_table),
    target_id: String(body.target_id),
    status: approvalRequired ? 'proposed' : 'approved',
    title: body.title ? String(body.title).slice(0, 200) : titleForChangeRequest(requestType),
    reason: String(body.reason || 'Ad OS change request').slice(0, 2000),
    risk_level: riskLevel,
    expected_impact: json(body.expected_impact),
    proposed_change: json(body.proposed_change),
    rollback_payload: json(body.rollback_payload),
    approval_required: approvalRequired,
    approved_at: approvalRequired ? null : new Date().toISOString(),
    expires_at: body.expires_at || null,
  };

  const { data, error } = await supabaseAdmin
    .from('ad_os_change_requests')
    .insert(row)
    .select('*')
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, request: data });
});

export const PATCH = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const status = String(body.status || '');
  if (!id || !STATUS_UPDATES.has(status)) {
    return NextResponse.json({ ok: false, error: 'id와 유효한 status가 필요합니다.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === 'approved') patch.approved_at = new Date().toISOString();
  if (status === 'applied') patch.applied_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('ad_os_change_requests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, request: data });
});
