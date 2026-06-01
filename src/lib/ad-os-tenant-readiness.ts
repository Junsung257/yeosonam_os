export type TenantAdAccountState = {
  platform: string;
  accountMode: string;
  connectionStatus: string;
  monthlyBudgetCapKrw: number;
  dailyBudgetCapKrw: number;
  canPublishKeywords: boolean;
  canChangeBids: boolean;
  canPauseAssets: boolean;
  riskStatus: string;
};

export type TenantAdReadinessItem = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
};

export function buildTenantAdReadiness(accounts: TenantAdAccountState[]): TenantAdReadinessItem[] {
  const readySearchAccounts = accounts.filter((account) =>
    ['naver', 'google'].includes(account.platform) && account.connectionStatus === 'ready',
  );
  const publishableAccounts = accounts.filter((account) => account.canPublishKeywords);
  const riskyAccounts = accounts.filter((account) => ['restricted', 'blocked', 'suspended'].includes(account.riskStatus) || account.connectionStatus === 'suspended');
  const budgetedAccounts = accounts.filter((account) => account.monthlyBudgetCapKrw > 0 && account.dailyBudgetCapKrw > 0);

  return [
    {
      id: 'search_accounts',
      label: '검색광고 계정 연결',
      status: readySearchAccounts.length > 0 ? 'pass' : accounts.length > 0 ? 'warn' : 'fail',
      detail: readySearchAccounts.length > 0
        ? `집행 가능한 검색광고 계정 ${readySearchAccounts.length}개가 연결됐습니다.`
        : '테넌트 또는 대행 광고계정의 권한/캠페인 연결이 아직 완료되지 않았습니다.',
    },
    {
      id: 'publish_scope',
      label: '외부 변경 권한',
      status: publishableAccounts.length > 0 ? 'pass' : 'warn',
      detail: publishableAccounts.length > 0
        ? `키워드 발행 권한이 있는 계정 ${publishableAccounts.length}개가 있습니다.`
        : '현재는 추천/드래프트 중심입니다. 실제 발행 권한은 별도 승인 후 열어야 합니다.',
    },
    {
      id: 'account_budget_caps',
      label: '계정별 예산 상한',
      status: budgetedAccounts.length > 0 ? 'pass' : 'fail',
      detail: budgetedAccounts.length > 0
        ? `월/일 예산 상한이 있는 계정 ${budgetedAccounts.length}개가 있습니다.`
        : 'SaaS 판매 전 계정 단위 월/일 예산 상한이 필요합니다.',
    },
    {
      id: 'risk_lock',
      label: '리스크 제한',
      status: riskyAccounts.length === 0 ? 'pass' : 'fail',
      detail: riskyAccounts.length === 0
        ? '차단 또는 제한 상태의 광고 계정이 없습니다.'
        : `제한/차단 상태 계정 ${riskyAccounts.length}개가 있어 자동집행을 막아야 합니다.`,
    },
  ];
}
