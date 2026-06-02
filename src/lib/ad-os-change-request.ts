export type AdOsChangeRequestType =
  | 'create_keyword'
  | 'pause_keyword'
  | 'increase_bid'
  | 'decrease_bid'
  | 'budget_change'
  | 'pause_channel'
  | 'replace_landing'
  | 'create_landing'
  | 'create_campaign'
  | 'sync_external_asset'
  | 'update_blog_cta'
  | 'create_card_news'
  | 'create_negative_keyword'
  | 'create_experiment'
  | 'publish_paused_keyword'
  | 'upload_conversion_signal'
  | 'activate_paused_keyword'
  | 'sync_performance'
  | 'create_creative_draft'
  | 'update_tenant_policy';

export type AdOsChangeRisk = 'low' | 'medium' | 'high' | 'critical';

const HIGH_RISK_TYPES = new Set<AdOsChangeRequestType>([
  'create_keyword',
  'increase_bid',
  'budget_change',
  'create_campaign',
  'publish_paused_keyword',
  'activate_paused_keyword',
]);

const MEDIUM_RISK_TYPES = new Set<AdOsChangeRequestType>([
  'pause_keyword',
  'decrease_bid',
  'replace_landing',
  'update_blog_cta',
  'create_negative_keyword',
  'sync_performance',
  'upload_conversion_signal',
]);

export function riskForChangeRequest(input: {
  requestType: AdOsChangeRequestType;
  automationLevel: number;
  externalSpendKrw?: number;
  changesExternalAccount?: boolean;
}): AdOsChangeRisk {
  if (input.changesExternalAccount && input.automationLevel >= 4) return 'critical';
  if (input.requestType === 'pause_channel') return 'high';
  if (input.requestType === 'budget_change' && Number(input.externalSpendKrw || 0) > 0) return 'high';
  if (HIGH_RISK_TYPES.has(input.requestType)) return 'high';
  if (MEDIUM_RISK_TYPES.has(input.requestType)) return 'medium';
  return 'low';
}

export function approvalRequiredForChange(input: {
  requestType: AdOsChangeRequestType;
  automationLevel: number;
  fullAutoEnabled?: boolean;
  requireHumanApproval?: boolean;
  riskLevel?: AdOsChangeRisk;
}): boolean {
  if (input.requireHumanApproval !== false) return true;
  if (!input.fullAutoEnabled) return true;
  if (input.automationLevel < 3) return true;
  if (input.riskLevel === 'critical' || input.riskLevel === 'high') return true;
  return false;
}

export function titleForChangeRequest(type: AdOsChangeRequestType): string {
  const labels: Record<AdOsChangeRequestType, string> = {
    create_keyword: 'Create keyword',
    pause_keyword: 'Pause keyword',
    increase_bid: 'Increase bid',
    decrease_bid: 'Decrease bid',
    budget_change: 'Budget change',
    pause_channel: 'Pause channel',
    replace_landing: 'Replace landing',
    create_landing: 'Create landing',
    create_campaign: 'Create campaign',
    sync_external_asset: 'Sync external asset',
    update_blog_cta: 'Update blog CTA',
    create_card_news: 'Create card news',
    create_negative_keyword: 'Create negative keyword',
    create_experiment: 'Create experiment',
    publish_paused_keyword: 'Publish paused keyword',
    upload_conversion_signal: 'Upload conversion signal',
    activate_paused_keyword: 'Activate paused keyword',
    sync_performance: 'Sync performance',
    create_creative_draft: 'Create creative draft',
    update_tenant_policy: 'Update tenant policy',
  };
  return labels[type];
}
