import Button from '@/components/ui/Button';

export type EnterpriseRuntimeActionKey =
  | 'runRuntimeReadiness'
  | 'checkChannelAdapters'
  | 'checkCredentialPreflight'
  | 'createNaverPausedKeywordPacket'
  | 'createGoogleDraftPacket'
  | 'createGoogleRsaDrafts'
  | 'createGoogleDraftFromRsa'
  | 'createGoogleDraftJobs'
  | 'runGoogleSafePipeline'
  | 'createMetaCapiTestPacket'
  | 'runMetaCreativeSafePipeline'
  | 'checkExecutionGate'
  | 'checkGoogleDraftGate'
  | 'checkNaverLivePreflight'
  | 'runRollbackDrill'
  | 'runNaverLimitedPilot'
  | 'runPlatformJobs'
  | 'executePlatformJobsDryRun'
  | 'runConversionUploadJobs'
  | 'executeConversionUploadsDryRun'
  | 'runConversionSafePipeline'
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
  { key: 'runRuntimeReadiness', label: '실행 준비 점검' },
  { key: 'checkChannelAdapters', label: '채널 연결 점검' },
  { key: 'checkCredentialPreflight', label: '계정 연결 사전 점검' },
  { key: 'createNaverPausedKeywordPacket', label: '네이버 정지 키워드 패킷' },
  { key: 'createGoogleDraftPacket', label: '구글 광고 초안 패킷' },
  { key: 'createGoogleRsaDrafts', label: '구글 검색광고 문안' },
  { key: 'createGoogleDraftFromRsa', label: '구글 문안 패킷' },
  { key: 'createGoogleDraftJobs', label: '구글 초안 작업' },
  { key: 'runGoogleSafePipeline', label: '구글 안전 파이프라인' },
  { key: 'createMetaCapiTestPacket', label: '메타 전환 패킷' },
  { key: 'runMetaCreativeSafePipeline', label: '메타 소재 파이프라인' },
  { key: 'checkExecutionGate', label: '네이버 실행 조건' },
  { key: 'checkGoogleDraftGate', label: '구글 초안 조건' },
  { key: 'checkNaverLivePreflight', label: '네이버 실집행 사전 점검' },
  { key: 'runRollbackDrill', label: '되돌리기 점검' },
  { key: 'runNaverLimitedPilot', label: '네이버 제한 시범' },
  { key: 'runPlatformJobs', label: '플랫폼 작업 준비' },
  { key: 'executePlatformJobsDryRun', label: '플랫폼 사전 점검' },
  { key: 'runConversionUploadJobs', label: '전환 업로드 작업' },
  { key: 'executeConversionUploadsDryRun', label: '전환 업로드 점검' },
  { key: 'runConversionSafePipeline', label: '전환 안전 파이프라인' },
  { key: 'loadDataQuality', label: '데이터 품질' },
  { key: 'runPortfolioPlan', label: '포트폴리오 계획' },
  { key: 'applyApprovedPortfolio', label: '포트폴리오 승인 반영' },
  { key: 'createAssetGroup', label: '소재 묶음 생성' },
  { key: 'saveTenantWorkspaceDefaults', label: '광고주 기본값 저장' },
  { key: 'standardizeExperimentTemplates', label: '실험 템플릿 정리' },
  { key: 'createTenantAuditExport', label: '감사 파일 생성' },
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
