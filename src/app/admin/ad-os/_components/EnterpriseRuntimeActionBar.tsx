import Button from '@/components/ui/Button';

export type EnterpriseRuntimeActionKey =
  | 'runRuntimeReadiness'
  | 'checkChannelAdapters'
  | 'createNaverPausedKeywordPacket'
  | 'createGoogleDraftPacket'
  | 'createGoogleRsaDrafts'
  | 'createGoogleDraftFromRsa'
  | 'createGoogleDraftJobs'
  | 'runGoogleSafePipeline'
  | 'createMetaCapiTestPacket'
  | 'checkExecutionGate'
  | 'checkGoogleDraftGate'
  | 'runRollbackDrill'
  | 'runNaverLimitedPilot'
  | 'runPlatformJobs'
  | 'executePlatformJobsDryRun'
  | 'runConversionUploadJobs'
  | 'executeConversionUploadsDryRun'
  | 'loadDataQuality'
  | 'runPortfolioPlan'
  | 'applyApprovedPortfolio'
  | 'createAssetGroup'
  | 'saveTenantWorkspaceDefaults'
  | 'standardizeExperimentTemplates'
  | 'createTenantAuditExport';

export type EnterpriseRuntimeActionHandlers = Record<EnterpriseRuntimeActionKey, () => void>;
export type EnterpriseRuntimeActionLoading = Record<EnterpriseRuntimeActionKey, boolean>;

const ENTERPRISE_RUNTIME_ACTIONS: Array<{ key: EnterpriseRuntimeActionKey; label: string }> = [
  { key: 'runRuntimeReadiness', label: 'Runtime readiness' },
  { key: 'checkChannelAdapters', label: 'Channel adapters' },
  { key: 'createNaverPausedKeywordPacket', label: 'Naver paused packet' },
  { key: 'createGoogleDraftPacket', label: 'Google draft packet' },
  { key: 'createGoogleRsaDrafts', label: 'Google RSA drafts' },
  { key: 'createGoogleDraftFromRsa', label: 'Google RSA packets' },
  { key: 'createGoogleDraftJobs', label: 'Google draft jobs' },
  { key: 'runGoogleSafePipeline', label: 'Google safe pipeline' },
  { key: 'createMetaCapiTestPacket', label: 'Meta CAPI packet' },
  { key: 'checkExecutionGate', label: 'Naver gate' },
  { key: 'checkGoogleDraftGate', label: 'Google draft gate' },
  { key: 'runRollbackDrill', label: 'Rollback drill' },
  { key: 'runNaverLimitedPilot', label: 'Naver limited pilot' },
  { key: 'runPlatformJobs', label: 'Run platform jobs' },
  { key: 'executePlatformJobsDryRun', label: 'Platform dry-run' },
  { key: 'runConversionUploadJobs', label: 'Conversion upload jobs' },
  { key: 'executeConversionUploadsDryRun', label: 'Conversion dry-run' },
  { key: 'loadDataQuality', label: 'Data quality' },
  { key: 'runPortfolioPlan', label: 'Portfolio plan' },
  { key: 'applyApprovedPortfolio', label: 'Apply portfolio' },
  { key: 'createAssetGroup', label: 'Creative factory' },
  { key: 'saveTenantWorkspaceDefaults', label: 'Tenant defaults' },
  { key: 'standardizeExperimentTemplates', label: 'Experiment standards' },
  { key: 'createTenantAuditExport', label: 'Audit export' },
];

export function EnterpriseRuntimeActionBar({
  actions,
  loading,
}: {
  actions: EnterpriseRuntimeActionHandlers;
  loading: EnterpriseRuntimeActionLoading;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {ENTERPRISE_RUNTIME_ACTIONS.map((action) => (
        <Button
          key={action.key}
          size="sm"
          variant="secondary"
          onClick={actions[action.key]}
          loading={loading[action.key]}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
