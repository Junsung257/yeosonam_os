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
  | 'create_card_news';

export type AdOsChangeRisk = 'low' | 'medium' | 'high' | 'critical';

export function riskForChangeRequest(input: {
  requestType: AdOsChangeRequestType;
  automationLevel: number;
  externalSpendKrw?: number;
  changesExternalAccount?: boolean;
}): AdOsChangeRisk {
  if (input.changesExternalAccount && input.automationLevel >= 4) return 'critical';
  if (input.requestType === 'pause_channel') return 'high';
  if (input.requestType === 'budget_change' && Number(input.externalSpendKrw || 0) > 0) return 'high';
  if (['increase_bid', 'create_campaign', 'create_keyword'].includes(input.requestType)) return 'high';
  if (['pause_keyword', 'decrease_bid', 'replace_landing', 'update_blog_cta'].includes(input.requestType)) return 'medium';
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
    create_keyword: '키워드 생성',
    pause_keyword: '키워드 정지',
    increase_bid: '입찰 증액',
    decrease_bid: '입찰 감액',
    budget_change: '예산 변경',
    pause_channel: '채널 정지',
    replace_landing: '랜딩 교체',
    create_landing: '랜딩 생성',
    create_campaign: '캠페인 생성',
    sync_external_asset: '외부 자산 연결',
    update_blog_cta: '블로그 CTA 개선',
    create_card_news: '카드뉴스 생성',
  };
  return labels[type];
}
