import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { getMarketingAssetGroups, type MarketingAssetGroup, type MarketingNextAction } from '@/lib/marketing/asset-groups';

export interface RecommendationLedgerEntry {
  id: string;
  action_id: string;
  status: 'open' | 'applied' | 'dismissed' | 'expired';
  applied_at: string | null;
  dismissed_at: string | null;
}

export type ActionWithLedger = MarketingNextAction & {
  ledger?: RecommendationLedgerEntry;
};

type RecommendationRow = RecommendationLedgerEntry;

function isMissingLedgerTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === '42P01'
    || maybeError.message?.includes('marketing_recommendations') === true
    || (
      maybeError.message?.includes('relation') === true
      && maybeError.message?.includes('does not exist') === true
    )
  );
}

function evidenceForAction(action: MarketingNextAction, group: MarketingAssetGroup | null) {
  return {
    product_id: action.product_id,
    category: action.category,
    severity: action.severity,
    automation_level: action.automation_level,
    readiness_score: group?.readiness_score ?? null,
    stages: group?.stages ?? null,
    flags: group?.flags ?? [],
  };
}

export async function syncMarketingRecommendations(
  groups: MarketingAssetGroup[],
  actions: MarketingNextAction[],
): Promise<Map<string, RecommendationLedgerEntry>> {
  const map = new Map<string, RecommendationLedgerEntry>();
  if (!isSupabaseConfigured || actions.length === 0) return map;

  const groupByProduct = new Map(groups.map((group) => [group.product.id, group]));
  const now = new Date().toISOString();
  const rows = actions.map((action) => ({
    action_id: action.id,
    product_id: action.product_id,
    category: action.category,
    severity: action.severity,
    title: action.title,
    reason: action.reason,
    action_url: action.action_url,
    action_label: action.action_label,
    automation_level: action.automation_level,
    evidence: evidenceForAction(action, action.product_id ? groupByProduct.get(action.product_id) ?? null : null),
    last_seen_at: now,
    updated_at: now,
  }));

  const { error: upsertError } = await supabaseAdmin
    .from('marketing_recommendations')
    .upsert(rows, {
      onConflict: 'action_id',
      ignoreDuplicates: false,
    });
  if (isMissingLedgerTableError(upsertError)) return map;
  if (upsertError) throw upsertError;

  const activeActionIds = actions.map((action) => action.id);
  const { error: reopenError } = await supabaseAdmin
    .from('marketing_recommendations')
    .update({ status: 'open', expires_at: null, updated_at: now })
    .eq('status', 'expired')
    .in('action_id', activeActionIds);
  if (isMissingLedgerTableError(reopenError)) return map;
  if (reopenError) throw reopenError;

  const { data, error } = await supabaseAdmin
    .from('marketing_recommendations')
    .select('id, action_id, status, applied_at, dismissed_at')
    .in('action_id', activeActionIds);
  if (isMissingLedgerTableError(error)) return map;
  if (error) throw error;

  for (const row of (data ?? []) as RecommendationRow[]) {
    map.set(row.action_id, row);
  }

  const { error: expireError } = await supabaseAdmin
    .from('marketing_recommendations')
    .update({ status: 'expired', expires_at: now, updated_at: now })
    .eq('status', 'open')
    .lt('last_seen_at', now)
    .not('action_id', 'in', `(${activeActionIds.map((id) => `"${id.replace(/"/g, '""')}"`).join(',')})`);
  if (isMissingLedgerTableError(expireError)) return map;
  if (expireError) throw expireError;

  return map;
}

export function attachLedgerToActions(
  actions: MarketingNextAction[],
  ledger: Map<string, RecommendationLedgerEntry>,
): ActionWithLedger[] {
  return actions
    .map((action) => ({ ...action, ledger: ledger.get(action.id) }))
    .filter((action) => action.ledger?.status !== 'dismissed');
}

export async function markMarketingRecommendationApplied(args: {
  actionId: string;
  targetTable?: string | null;
  targetId?: string | null;
  appliedBy?: string;
}) {
  if (!isSupabaseConfigured) return;
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('marketing_recommendations')
    .update({
      status: 'applied',
      applied_target_table: args.targetTable ?? null,
      applied_target_id: args.targetId ?? null,
      applied_by: args.appliedBy ?? 'command_center',
      applied_at: now,
      updated_at: now,
    })
    .eq('action_id', args.actionId);
  if (isMissingLedgerTableError(error)) return;
  if (error) throw error;
}

export async function dismissMarketingRecommendation(actionId: string, reason?: string) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.');
  }

  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('marketing_recommendations')
    .select('id')
    .eq('action_id', actionId)
    .limit(1);
  if (isMissingLedgerTableError(lookupError)) {
    throw new Error('Recommendation ledger migration is not applied yet.');
  }
  if (lookupError) throw lookupError;

  if (!existing?.[0]) {
    const { actions, groups } = await getMarketingAssetGroups(100);
    const action = actions.find((item) => item.id === actionId);
    if (!action) {
      throw new Error('Recommendation is no longer available.');
    }
    await syncMarketingRecommendations(groups, actions);
  }

  const { error } = await supabaseAdmin
    .from('marketing_recommendations')
    .update({
      status: 'dismissed',
      dismissed_by: 'command_center',
      dismissed_at: now,
      dismissed_reason: reason ?? null,
      updated_at: now,
    })
    .eq('action_id', actionId);
  if (isMissingLedgerTableError(error)) {
    throw new Error('Recommendation ledger migration is not applied yet.');
  }
  if (error) throw error;
}
