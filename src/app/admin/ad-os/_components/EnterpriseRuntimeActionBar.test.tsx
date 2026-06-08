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

    expect(html).toContain('Runtime readiness');
    expect(html).toContain('Naver paused packet');
    expect(html).toContain('Google RSA drafts');
    expect(html).toContain('Google RSA packets');
    expect(html).toContain('Google draft jobs');
    expect(html).toContain('Google safe pipeline');
    expect(html).toContain('Meta creative pipeline');
    expect(html).toContain('Naver gate');
    expect(html).toContain('Google draft gate');
    expect(html).toContain('Platform dry-run');
    expect(html).toContain('Conversion dry-run');
    expect(html).toContain('Conversion safe pipeline');
    expect(html).toContain('Audit export');
  });
});
