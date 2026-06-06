import type { BudgetDraft, LaunchAudit } from '../_lib/types';
import {
  BudgetOperationActionBar,
  type BudgetOperationActionHandlers,
  type BudgetOperationActionLoading,
} from './BudgetOperationActionBar';
import { BudgetGuardrailTable } from './BudgetGuardrailTable';
import { KeywordBrainResultPanel } from './KeywordBrainResultPanel';
import { LaunchAuditResultPanel } from './LaunchAuditResultPanel';
import { NaverAssetPlanPanel } from './NaverAssetPlanPanel';
import { OpsPlanResultPanel } from './OpsPlanResultPanel';
import {
  TenantReportSummaryPanel,
  type TenantReportBody,
  type TenantReportPeriod,
} from './TenantReportSummaryPanel';

export function BudgetOperationsPanel({
  budgets,
  onBudgetChange,
  actions,
  loading,
  tenantReportBody,
  tenantReportPeriod,
  launchAudit,
  opsPlan,
  keywordBrainResult,
  naverAssetPlan,
}: {
  budgets: BudgetDraft[];
  onBudgetChange: (platform: string, key: keyof BudgetDraft, value: string | number) => void;
  actions: BudgetOperationActionHandlers;
  loading: BudgetOperationActionLoading;
  tenantReportBody: TenantReportBody | undefined;
  tenantReportPeriod: TenantReportPeriod | undefined;
  launchAudit: LaunchAudit | null;
  opsPlan: Record<string, unknown> | null;
  keywordBrainResult: Record<string, unknown> | null;
  naverAssetPlan: Record<string, unknown> | null;
}) {
  return (
    <section className="admin-card p-4">
      <BudgetGuardrailTable budgets={budgets} onChange={onBudgetChange} />
      <BudgetOperationActionBar actions={actions} loading={loading} />
      <TenantReportSummaryPanel report={tenantReportBody} period={tenantReportPeriod} />
      <LaunchAuditResultPanel launchAudit={launchAudit} />
      <OpsPlanResultPanel opsPlan={opsPlan} />
      <KeywordBrainResultPanel result={keywordBrainResult} />
      <NaverAssetPlanPanel plan={naverAssetPlan} />
    </section>
  );
}
