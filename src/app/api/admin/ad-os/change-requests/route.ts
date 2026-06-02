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
  'update_blog_cta',
  'create_card_news',
]);

const STATUS_UPDATES = new Set(['approved', 'rejected', 'applied', 'rolled_back', 'expired']);
const MUTABLE_TARGET_TABLES = new Set([
  'ad_os_channel_budgets',
  'ad_landing_mappings',
  'search_ad_keyword_plans',
  'ad_os_landing_evolution_queue',
  'blog_content_versions',
]);
const BLOCKED_PATCH_FIELDS = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'approved_at', 'applied_at']);

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function asPatch(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const patch: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!BLOCKED_PATCH_FIELDS.has(key)) patch[key] = val;
  }
  patch.updated_at = new Date().toISOString();
  return patch;
}

async function updateMutableTarget(targetTable: string, targetId: string, patch: Record<string, unknown>) {
  switch (targetTable) {
    case 'ad_os_channel_budgets':
      return supabaseAdmin.from('ad_os_channel_budgets').update(patch as never).eq('id', targetId);
    case 'ad_landing_mappings':
      return supabaseAdmin.from('ad_landing_mappings').update(patch as never).eq('id', targetId);
    case 'search_ad_keyword_plans':
      return supabaseAdmin.from('search_ad_keyword_plans').update(patch as never).eq('id', targetId);
    case 'ad_os_landing_evolution_queue':
      return supabaseAdmin.from('ad_os_landing_evolution_queue').update(patch as never).eq('id', targetId);
    case 'blog_content_versions':
      return supabaseAdmin.from('blog_content_versions').update(patch as never).eq('id', targetId);
    default:
      return { error: new Error('이 대상 테이블은 자동 적용 대상이 아닙니다.') };
  }
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

  const requests = data || [];
  return NextResponse.json({
    ok: true,
    requests,
    summary: {
      total: requests.length,
      proposed: requests.filter((row: { status?: string }) => row.status === 'proposed').length,
      approved: requests.filter((row: { status?: string }) => row.status === 'approved').length,
      high_risk: requests.filter((row: { risk_level?: string }) => ['high', 'critical'].includes(row.risk_level || '')).length,
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

  const { data: current, error: currentError } = await supabaseAdmin
    .from('ad_os_change_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (currentError || !current) {
    return NextResponse.json({ ok: false, error: currentError?.message || '변경 요청을 찾을 수 없습니다.' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === 'approved') patch.approved_at = new Date().toISOString();
  if (status === 'applied') {
    if (current.approval_required && current.status !== 'approved') {
      return NextResponse.json({ ok: false, error: '승인된 변경 요청만 적용할 수 있습니다.' }, { status: 409 });
    }
    if (!MUTABLE_TARGET_TABLES.has(String(current.target_table))) {
      return NextResponse.json({ ok: false, error: '이 대상 테이블은 자동 적용 대상이 아닙니다.' }, { status: 400 });
    }
    const targetPatch = asPatch(current.proposed_change);
    if (Object.keys(targetPatch).length <= 1) {
      return NextResponse.json({ ok: false, error: '적용할 proposed_change가 없습니다.' }, { status: 400 });
    }
    const { error: targetError } = await updateMutableTarget(String(current.target_table), String(current.target_id), targetPatch);
    if (targetError) return NextResponse.json({ ok: false, error: targetError.message }, { status: 500 });
    patch.applied_at = new Date().toISOString();
  }
  if (status === 'rolled_back') {
    if (!MUTABLE_TARGET_TABLES.has(String(current.target_table))) {
      return NextResponse.json({ ok: false, error: '이 대상 테이블은 자동 롤백 대상이 아닙니다.' }, { status: 400 });
    }
    const rollbackPatch = asPatch(current.rollback_payload);
    if (Object.keys(rollbackPatch).length <= 1) {
      return NextResponse.json({ ok: false, error: '적용할 rollback_payload가 없습니다.' }, { status: 400 });
    }
    const { error: rollbackError } = await updateMutableTarget(String(current.target_table), String(current.target_id), rollbackPatch);
    if (rollbackError) return NextResponse.json({ ok: false, error: rollbackError.message }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('ad_os_change_requests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, request: data });
});
