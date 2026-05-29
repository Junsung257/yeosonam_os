import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { getMarketingAssetGroups, type MarketingNextAction } from '@/lib/marketing/asset-groups';

type ActionKind =
  | 'deadline-no-active-ads'
  | 'missing-blog'
  | 'missing-card-news'
  | 'confirmed-card-news-not-scheduled'
  | 'missing-campaign'
  | 'campaign-no-deployed-creative'
  | 'failed-distribution';

export interface MarketingActionPlan {
  action_id: string;
  product_id: string | null;
  kind: ActionKind | 'unknown';
  executable: boolean;
  dry_run: boolean;
  summary: string;
  operations: Array<{
    table: string;
    operation: 'insert' | 'update' | 'manual';
    description: string;
  }>;
  result?: {
    table: string;
    id: string | null;
  };
}

function parseKind(actionId: string): ActionKind | 'unknown' {
  const suffix = actionId.split(':').pop();
  switch (suffix) {
    case 'deadline-no-active-ads':
    case 'missing-blog':
    case 'missing-card-news':
    case 'confirmed-card-news-not-scheduled':
    case 'missing-campaign':
    case 'campaign-no-deployed-creative':
    case 'failed-distribution':
      return suffix;
    default:
      return 'unknown';
  }
}

function findAction(actionId: string, actions: MarketingNextAction[]) {
  return actions.find((action) => action.id === actionId) ?? null;
}

function buildManualPlan(action: MarketingNextAction, kind: MarketingActionPlan['kind'], dryRun: boolean): MarketingActionPlan {
  return {
    action_id: action.id,
    product_id: action.product_id,
    kind,
    executable: false,
    dry_run: dryRun,
    summary: 'This action needs an existing publish/deploy workflow and is left as a guarded manual step.',
    operations: [
      {
        table: 'manual_review',
        operation: 'manual',
        description: `${action.action_label}: ${action.reason}`,
      },
    ],
  };
}

function buildExistingPlan(
  action: MarketingNextAction,
  kind: MarketingActionPlan['kind'],
  table: string,
  id: string | null,
  dryRun: boolean,
): MarketingActionPlan {
  return {
    action_id: action.id,
    product_id: action.product_id,
    kind,
    executable: false,
    dry_run: dryRun,
    summary: `A matching ${table} row already exists. No duplicate draft was created.`,
    operations: [
      {
        table,
        operation: 'manual',
        description: 'Reuse the existing row instead of creating a duplicate.',
      },
    ],
    result: { table, id },
  };
}

export async function applyMarketingAction(actionId: string, dryRun = true): Promise<MarketingActionPlan> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.');
  }

  const { actions, groups } = await getMarketingAssetGroups(100);
  const action = findAction(actionId, actions);
  if (!action) {
    throw new Error('Action is no longer available. Refresh the command center.');
  }

  const kind = parseKind(action.id);
  const group = groups.find((item) => item.product.id === action.product_id) ?? null;
  const product = group?.product;
  if (!product || !action.product_id) {
    return buildManualPlan(action, kind, dryRun);
  }

  if (kind === 'missing-blog') {
    const topic = `${product.destination ?? ''} ${product.title}`.trim();
    const { data: existing } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('id')
      .eq('product_id', product.id)
      .in('status', ['queued', 'generating', 'draft', 'pending'])
      .limit(1);
    if (existing?.[0]) {
      return buildExistingPlan(action, kind, 'blog_topic_queue', existing[0].id, dryRun);
    }

    const plan: MarketingActionPlan = {
      action_id: action.id,
      product_id: action.product_id,
      kind,
      executable: true,
      dry_run: dryRun,
      summary: 'Queue one product blog topic for the existing blog scheduler/publisher pipeline.',
      operations: [
        {
          table: 'blog_topic_queue',
          operation: 'insert',
          description: `Create queued product blog topic: ${topic}`,
        },
      ],
    };
    if (dryRun) return plan;

    const { data, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .insert({
        topic,
        source: 'marketing_command_center',
        status: 'queued',
        priority: 88,
        destination: product.destination,
        product_id: product.id,
        category: 'product_intro',
        primary_keyword: topic,
        keyword_tier: 'longtail',
        competition_level: 'medium',
        meta: {
          action_id: action.id,
          command_center: true,
          queued_at: new Date().toISOString(),
        },
      })
      .select('id')
      .single();
    if (error) throw error;
    return { ...plan, dry_run: false, result: { table: 'blog_topic_queue', id: data?.id ?? null } };
  }

  if (kind === 'missing-card-news') {
    const topic = `${product.destination ?? ''} ${product.title}`.trim();
    const { data: existing } = await supabaseAdmin
      .from('card_news')
      .select('id')
      .eq('package_id', product.id)
      .in('status', ['PENDING', 'DRAFT', 'pending', 'draft'])
      .limit(1);
    if (existing?.[0]) {
      return buildExistingPlan(action, kind, 'card_news', existing[0].id, dryRun);
    }

    const plan: MarketingActionPlan = {
      action_id: action.id,
      product_id: action.product_id,
      kind,
      executable: true,
      dry_run: dryRun,
      summary: 'Create a product card-news seed row for the existing generation/refinement pipeline.',
      operations: [
        {
          table: 'card_news',
          operation: 'insert',
          description: `Create pending card-news seed: ${topic}`,
        },
      ],
    };
    if (dryRun) return plan;

    const { data, error } = await supabaseAdmin
      .from('card_news')
      .insert({
        package_id: product.id,
        title: topic,
        topic,
        status: 'PENDING',
        card_news_type: 'product',
        slides: [],
        generation_config: {
          action_id: action.id,
          command_center: true,
          seeded_at: new Date().toISOString(),
        },
      })
      .select('id')
      .single();
    if (error) throw error;
    return { ...plan, dry_run: false, result: { table: 'card_news', id: data?.id ?? null } };
  }

  if (kind === 'missing-campaign' || kind === 'deadline-no-active-ads') {
    const name = `[Draft] ${product.title}`;
    const { data: existing } = await supabaseAdmin
      .from('ad_campaigns')
      .select('id')
      .eq('package_id', product.id)
      .in('status', ['DRAFT', 'draft', 'approved', 'ACTIVE', 'active'])
      .limit(1);
    if (existing?.[0]) {
      return buildExistingPlan(action, kind, 'ad_campaigns', existing[0].id, dryRun);
    }

    const plan: MarketingActionPlan = {
      action_id: action.id,
      product_id: action.product_id,
      kind,
      executable: true,
      dry_run: dryRun,
      summary: 'Create an internal campaign draft only. External ad deployment still requires the existing deploy flow.',
      operations: [
        {
          table: 'ad_campaigns',
          operation: 'insert',
          description: `Create Meta lead campaign draft: ${name}`,
        },
      ],
    };
    if (dryRun) return plan;

    const { data, error } = await supabaseAdmin
      .from('ad_campaigns')
      .insert({
        package_id: product.id,
        name,
        channel: 'meta',
        objective: 'LEADS',
        status: 'DRAFT',
        daily_budget_krw: kind === 'deadline-no-active-ads' ? 30000 : 15000,
        total_spend_krw: 0,
        auto_pause_reason: 'draft_created_by_marketing_command_center',
      })
      .select('id')
      .single();
    if (error) throw error;
    return { ...plan, dry_run: false, result: { table: 'ad_campaigns', id: data?.id ?? null } };
  }

  return buildManualPlan(action, kind, dryRun);
}
