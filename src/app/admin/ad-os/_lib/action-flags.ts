'use client';

import { useCallback, useState } from 'react';

export const ACTION_FLAG_KEYS = [
  'savingBudget',
  'savingTenantPolicy',
  'runningAutomation',
  'runningGuardedApply',
  'runningPilotSetup',
  'publishingDrafts',
  'publishingNaverKeywords',
  'activatingNaverKeywords',
  'harvestingLearning',
  'optimizingPerformance',
  'runningBudgetPacing',
  'probingPublisher',
  'runningLaunchAudit',
  'probingNaverAdgroups',
  'probingNaverAssets',
  'syncingNaverAssets',
  'generatingNaverPacket',
  'approvingNaverCandidates',
  'runningExpiryCleanup',
  'runningKillSwitch',
  'generatingCandidates',
  'syncingPerformance',
  'applyingLearning',
  'publishingExternal',
  'harvestingSearchTerms',
  'planningExperiments',
  'probingGooglePublisher',
  'loadingTenantReport',
  'buildingOpsPlan',
  'creatingCreativeDrafts',
  'syncingBookingFunnel',
  'runningConversionAttribution',
  'runningKeywordBrain',
  'runningSeoKeywordBridge',
  'runningSearchTermGrowth',
  'creatingNaverAssets',
  'executingNaverGate',
  'exportingGoogleConversions',
  'exportingMetaConversions',
  'runningBidOptimizer',
  'runningExperiments',
  'applyingBlogEvolution',
  'runningPlatformJobs',
  'runningConversionUpload',
  'loadingDataQuality',
  'planningPortfolio',
  'applyingPortfolio',
  'creatingAssetGroup',
  'savingTenantWorkspace',
  'checkingRuntimeReadiness',
  'executingPlatformDryRun',
  'executingConversionDryRun',
  'standardizingExperiments',
  'creatingTenantAuditExport',
  'checkingChannelAdapters',
  'creatingNaverAdapterPacket',
  'creatingGoogleDraftPacket',
  'creatingMetaCapiPacket',
  'checkingExecutionGate',
  'runningRollbackDrill',
  'runningLimitedPilot',
  'checkingStagingSmoke',
  'checkingOperatingInventory',
  'checkingStagingValidation',
  'checkingAdminSurfaceQa',
] as const;

export type ActionFlagKey = (typeof ACTION_FLAG_KEYS)[number];
export type ActionFlags = Record<ActionFlagKey, boolean>;

export const INITIAL_ACTION_FLAGS = ACTION_FLAG_KEYS.reduce((flags, key) => {
  flags[key] = false;
  return flags;
}, {} as ActionFlags);

export function useActionFlags() {
  const [flags, setFlags] = useState<ActionFlags>(INITIAL_ACTION_FLAGS);

  const setActionFlag = useCallback((key: ActionFlagKey, value: boolean) => {
    setFlags((current) => {
      if (current[key] === value) return current;
      return { ...current, [key]: value };
    });
  }, []);

  return [flags, setActionFlag] as const;
}
