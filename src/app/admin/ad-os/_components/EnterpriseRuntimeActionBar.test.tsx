import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EnterpriseRuntimeActionBar,
  type EnterpriseRuntimeActionHandlers,
  type EnterpriseRuntimeActionLoading,
} from './EnterpriseRuntimeActionBar';

const noop = () => {};

const actions: EnterpriseRuntimeActionHandlers = {
  runRuntimeReadiness: noop,
  checkChannelAdapters: noop,
  checkCredentialPreflight: noop,
  createNaverPausedKeywordPacket: noop,
  createGoogleDraftPacket: noop,
  createGoogleRsaDrafts: noop,
  createGoogleDraftFromRsa: noop,
  createGoogleDraftJobs: noop,
  runGoogleSafePipeline: noop,
  createMetaCapiTestPacket: noop,
  runMetaCreativeSafePipeline: noop,
  checkExecutionGate: noop,
  checkGoogleDraftGate: noop,
  checkNaverLivePreflight: noop,
  runRollbackDrill: noop,
  runNaverLimitedPilot: noop,
  runPlatformJobs: noop,
  executePlatformJobsDryRun: noop,
  runConversionUploadJobs: noop,
  executeConversionUploadsDryRun: noop,
  runConversionSafePipeline: noop,
  loadDataQuality: noop,
  runPortfolioPlan: noop,
  applyApprovedPortfolio: noop,
  createAssetGroup: noop,
  saveTenantWorkspaceDefaults: noop,
  standardizeExperimentTemplates: noop,
  createTenantAuditExport: noop,
};

const loading: EnterpriseRuntimeActionLoading = Object.fromEntries(
  Object.keys(actions).map((key) => [key, false]),
) as EnterpriseRuntimeActionLoading;

describe('Ad OS EnterpriseRuntimeActionBar', () => {
  it('renders the controlled runtime action group', () => {
    const html = renderToStaticMarkup(
      <EnterpriseRuntimeActionBar
        actions={actions}
        loading={loading}
      />,
    );

    expect(html).toContain('실행 준비 점검');
    expect(html).toContain('네이버 정지 키워드 패킷');
    expect(html).toContain('계정 연결 사전 점검');
    expect(html).toContain('구글 검색광고 문안');
    expect(html).toContain('구글 문안 패킷');
    expect(html).toContain('구글 초안 작업');
    expect(html).toContain('구글 안전 파이프라인');
    expect(html).toContain('메타 소재 파이프라인');
    expect(html).toContain('네이버 실행 조건');
    expect(html).toContain('구글 초안 조건');
    expect(html).toContain('네이버 실집행 사전 점검');
    expect(html).toContain('플랫폼 사전 점검');
    expect(html).toContain('전환 업로드 점검');
    expect(html).toContain('전환 안전 파이프라인');
    expect(html).toContain('감사 파일 생성');
  });
});
