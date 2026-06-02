import { evaluateExecutionGate, type BudgetGuardInput, type ExecutionGateInput } from '@/lib/ad-os-v86-v100';
import { supabaseAdmin } from '@/lib/supabase';
import { loadAdapterCapabilities } from './_shared';

type PacketRow = {
  id: string;
  tenant_id: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  packet_type: 'naver_paused_keyword' | 'google_campaign_draft' | 'google_conversion_action_check' | 'meta_capi_test_event' | 'meta_creative_seed' | 'kakao_draft';
  lifecycle_status: 'planned' | 'ready' | 'blocked' | 'queued' | 'succeeded' | 'failed' | 'archived';
  idempotency_key: string;
  dry_run: true;
  external_api_write: false;
  request_payload: Record<string, unknown>;
  guardrail_snapshot: Record<string, unknown>;
  response_payload: Record<string, unknown>;
  blocked_reason: string | null;
  rollback_payload: Record<string, unknown>;
};

type BudgetRow = {
  platform: string | null;
  monthly_budget_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  max_cpc_krw?: number | null;
  max_test_loss_krw?: number | null;
  automation_level?: number | null;
  status?: string | null;
};

type WorkspaceRow = {
  tenant_id?: string | null;
  monthly_budget_cap_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  max_cpc_krw?: number | null;
  max_test_loss_krw?: number | null;
  automation_level?: number | null;
  require_human_approval?: boolean | null;
  full_auto_enabled?: boolean | null;
};

export async function loadExecutionGateInputs(input: {
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  limit: number;
  humanApproved: boolean;
  requestedMode: ExecutionGateInput['requestedMode'];
  runId?: string | null;
}) {
  const [capabilities, packetRes, budgetRes, workspaceRes] = await Promise.all([
    loadAdapterCapabilities(),
    supabaseAdmin
      .from('ad_os_platform_write_packets')
      .select('*')
      .eq('platform', input.platform)
      .order('created_at', { ascending: false })
      .limit(input.limit),
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('*')
      .eq('platform', input.platform)
      .maybeSingle(),
    supabaseAdmin
      .from('tenant_ad_workspaces')
      .select('tenant_id, monthly_budget_cap_krw, daily_budget_cap_krw, max_cpc_krw, max_test_loss_krw, automation_level, require_human_approval, full_auto_enabled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const firstError = packetRes.error || budgetRes.error || workspaceRes.error;
  if (firstError) throw new Error(firstError.message);

  const budget = (budgetRes.data || {}) as BudgetRow;
  const workspace = (workspaceRes.data || {}) as WorkspaceRow;
  const budgetGuard: BudgetGuardInput = {
    monthlyBudgetKrw: budget.monthly_budget_krw || workspace.monthly_budget_cap_krw || 0,
    dailyBudgetCapKrw: budget.daily_budget_cap_krw || workspace.daily_budget_cap_krw || 0,
    maxCpcKrw: budget.max_cpc_krw || workspace.max_cpc_krw || 0,
    maxTestLossKrw: budget.max_test_loss_krw || workspace.max_test_loss_krw || 0,
    automationLevel: Math.max(Number(budget.automation_level || 0), Number(workspace.automation_level || 0)),
    requireHumanApproval: workspace.require_human_approval !== false,
    humanApproved: input.humanApproved,
    killSwitchClear: !['paused', 'blocked'].includes(String(budget.status || '')),
    fullAutoEnabled: Boolean(workspace.full_auto_enabled),
  };

  const adapter = capabilities.find((capability) => capability.platform === input.platform) || null;
  const packets = (packetRes.data || []) as PacketRow[];
  const gates = packets.length > 0
    ? packets.map((packet) => evaluateExecutionGate({
      platform: input.platform,
      tenantId: packet.tenant_id || workspace.tenant_id || null,
      packet,
      adapter,
      budget: budgetGuard,
      requestedMode: input.requestedMode,
      runId: input.runId,
    }))
    : [evaluateExecutionGate({
      platform: input.platform,
      tenantId: workspace.tenant_id || null,
      packet: null,
      adapter,
      budget: budgetGuard,
      requestedMode: input.requestedMode,
      runId: input.runId,
    })];

  return { adapter, packets, gates, budget: budgetGuard };
}
