import type { Summary } from '@/app/admin/ad-os/_lib/types';
import type { AdOsAgentOperatingModel } from '@/app/admin/ad-os/_lib/agent-operating-model';

type CampaignMemoryPersistInput = {
  tenantId?: string | null;
  workspaceId?: string | null;
  memoryKey?: string;
  model: AdOsAgentOperatingModel;
  summary: Summary;
  diagnostic?: Record<string, unknown>;
  pipelineResults?: Array<Record<string, unknown>>;
};

type CampaignMemoryRecord = {
  tenant_id: string | null;
  workspace_id: string | null;
  memory_key: string;
  status: 'ready' | 'needs_attention' | 'blocked';
  score: number;
  purpose: string;
  guardrails: Record<string, unknown>;
  approval_rules: Record<string, unknown>;
  facts: Array<Record<string, unknown>>;
  failed_experiments: Array<Record<string, unknown>>;
  next_tests: string[];
  source_summary: Record<string, unknown>;
  last_diagnostic: Record<string, unknown>;
  generated_at: string;
  updated_at: string;
};

type SupabaseLike = {
  from: (table: string) => any;
};

function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function firstWorkspace(summary: Summary, tenantId?: string | null): Record<string, unknown> | null {
  const rows = summary.samples.tenant_workspaces || [];
  const matched = rows.find((row) => {
    if (!tenantId) return row.tenant_id == null;
    return row.tenant_id === tenantId;
  });
  return matched || rows[0] || null;
}

function failedExperimentRows(summary: Summary): Array<Record<string, unknown>> {
  return (summary.samples.experiments || [])
    .filter((row) => ['failed', 'blocked', 'paused'].includes(String(row.status || '')))
    .slice(0, 8);
}

export function buildAdOsCampaignMemoryRecord(input: CampaignMemoryPersistInput): CampaignMemoryRecord {
  const now = new Date().toISOString();
  const workspace = firstWorkspace(input.summary, input.tenantId);
  const approvalRequired = input.summary.tenant_policy?.require_human_approval !== false;
  const budgetGuardrails = {
    allowed_platforms: input.summary.tenant_policy?.allowed_platforms || [],
    monthly_budget_cap_krw: input.summary.tenant_policy?.monthly_budget_cap_krw || 0,
    daily_budget_cap_krw: input.summary.tenant_policy?.daily_budget_cap_krw || 0,
    max_cpc_krw: input.summary.tenant_policy?.max_cpc_krw || 0,
    max_test_loss_krw: input.summary.tenant_policy?.max_test_loss_krw || 0,
    active_channel_budgets: input.summary.channel_budgets.filter((row) => row.status === 'active').length,
  };

  return {
    tenant_id: input.tenantId || null,
    workspace_id: input.workspaceId || String(workspace?.id || '') || null,
    memory_key: input.memoryKey || 'default',
    status: input.model.campaignMemory.status === 'attention' ? 'needs_attention' : input.model.campaignMemory.status,
    score: input.model.campaignMemory.score,
    purpose: input.model.campaignMemory.facts.find((fact) => fact.label === 'Campaign purpose')?.value || '',
    guardrails: json({
      budget: budgetGuardrails,
      tenant_guardrails: input.summary.tenant_guardrails || [],
      tenant_ad_readiness: input.summary.tenant_ad_readiness || [],
    }),
    approval_rules: json({
      require_human_approval: approvalRequired,
      role_approvals: input.model.roles.map((role) => ({
        role: role.id,
        needs_human_approval: role.needsHumanApproval,
        decision: role.decision,
      })),
    }),
    facts: json(input.model.campaignMemory.facts),
    failed_experiments: json(failedExperimentRows(input.summary)),
    next_tests: json(input.model.campaignMemory.nextTests),
    source_summary: json({
      kpis: input.summary.kpis,
      learning_loop: input.summary.learning_loop || null,
      agency_reporting: input.summary.enterprise_layer?.agency_reporting || null,
      completion_audit: input.summary.enterprise_layer?.completion_audit || null,
    }),
    last_diagnostic: json({
      roas_diagnostic: input.model.roasDiagnostic,
      ai_ad_team: {
        score: input.model.teamScore,
        status: input.model.overallStatus,
        roles: input.model.roles,
      },
      diagnostic: input.diagnostic || null,
      pipeline_results: input.pipelineResults || [],
    }),
    generated_at: now,
    updated_at: now,
  };
}

export async function persistAdOsCampaignMemory(
  supabase: SupabaseLike,
  input: CampaignMemoryPersistInput,
): Promise<{ id: string; created: boolean; record: CampaignMemoryRecord }> {
  const record = buildAdOsCampaignMemoryRecord(input);
  let query = supabase
    .from('ad_os_campaign_memories')
    .select('id')
    .eq('memory_key', record.memory_key)
    .limit(1);
  query = record.tenant_id ? query.eq('tenant_id', record.tenant_id) : query.is('tenant_id', null);
  const { data: existing, error: selectError } = await query.maybeSingle();
  if (selectError) throw selectError;

  if (existing?.id) {
    const { data, error } = await supabase
      .from('ad_os_campaign_memories')
      .update(record as never)
      .eq('id', existing.id)
      .select('id')
      .single();
    if (error) throw error;
    return { id: data.id, created: false, record };
  }

  const { data, error } = await supabase
    .from('ad_os_campaign_memories')
    .insert(record as never)
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id, created: true, record };
}
