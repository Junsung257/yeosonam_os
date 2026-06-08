'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Layers,
  Rocket,
  Search,
} from 'lucide-react';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import {
  fetchAdminSurfaceQa,
  fetchOperatingInventory,
  fetchStagingSmoke,
  fetchStagingValidation,
  fetchSummary,
} from './_lib/fetchers';
import { useActiveActionIds } from './_lib/active-action-ids';
import { useActionFlags } from './_lib/action-flags';
import {
  buildGuardedApplyMessage,
  buildPilotSetupMessage,
  buildPublishDraftsMessage,
  formatAdOsBlockers,
  formatAdOsNumber,
  getAdOsRecord,
} from './_lib/action-messages';
import {
  buildNaverKeywordCsvFilename,
  getNaverKeywordCsv,
} from './_lib/naver-keyword-csv';
import { loadInitialReadinessPanels } from './_lib/initial-readiness-loader';
import {
  parseAdOsJsonResponse,
  useAdOsJsonActionRunner,
  useAdOsJsonBatchActionRunner,
  useAdOsJsonIdActionRunner,
} from './_lib/action-runner';
import { useAdOsPageState } from './_lib/page-state';
import { useAdOsResultState } from './_lib/result-state';
import { useAdOsReadinessRunner } from './_lib/readiness-runner';
import {
  buildLaunchSteps,
  buildLaunchWizardSteps,
  getActiveModeByPlatform,
  getCompletionDrilldown,
  getExecutionStateEntries,
  getTenantReportView,
  getTotalMappingStatus,
} from './_lib/view-model';
import { AdminSurfaceQaPanel } from './_components/AdminSurfaceQaPanel';
import { AutomationPolicyPanel } from './_components/AutomationPolicyPanel';
import { BudgetOperationsPanel } from './_components/BudgetOperationsPanel';
import {
  type BudgetOperationActionHandlers,
  type BudgetOperationActionLoading,
} from './_components/BudgetOperationActionBar';
import { ChangeRequestsPanel } from './_components/ChangeRequestsPanel';
import { ChannelExecutionStatePanel } from './_components/ChannelExecutionStatePanel';
import { CompletionAuditPanel } from './_components/CompletionAuditPanel';
import { EnterpriseRuntimePanel } from './_components/EnterpriseRuntimePanel';
import {
  type EnterpriseRuntimeActionHandlers,
  type EnterpriseRuntimeActionLoading,
} from './_components/EnterpriseRuntimeActionBar';
import { LandingEvolutionPanel } from './_components/LandingEvolutionPanel';
import { LearningLoopPanel } from './_components/LearningLoopPanel';
import { LearningSignalsPanel } from './_components/LearningSignalsPanel';
import { KeywordPlansPanel } from './_components/KeywordPlansPanel';
import {
  LaunchActionQueuePanel,
  type LaunchActionHandlers,
  type LaunchActionLoading,
} from './_components/LaunchActionQueuePanel';
import { LaunchWizardPanel } from './_components/LaunchWizardPanel';
import { MappingStatusDistributionPanel } from './_components/MappingStatusDistributionPanel';
import { MappingSamplesPanel } from './_components/MappingSamplesPanel';
import { OperatingModesPanel } from './_components/OperatingModesPanel';
import { OperatingInventoryPanel } from './_components/OperatingInventoryPanel';
import { ProductScenariosPanel } from './_components/ProductScenariosPanel';
import { RecentDecisionsPanel } from './_components/RecentDecisionsPanel';
import { StagingValidationPanel } from './_components/StagingValidationPanel';
import { TenantSafetyPolicyPanel } from './_components/TenantSafetyPolicyPanel';

export default function AdOsPage() {
  const searchParams = useSearchParams();
  const {
    summary,
    budgetDrafts,
    loading,
    error,
    tenantPolicyDraft,
    setLoading,
    setError,
    loadSummary,
    updateBudgetDraft,
    updateTenantPolicyDraft,
    toggleTenantPlatform,
  } = useAdOsPageState();
  const [actionFlags, setActionFlag] = useActionFlags();
  const {
    savingBudget, savingTenantPolicy, runningAutomation, runningGuardedApply, runningPilotSetup,
    publishingDrafts, publishingNaverKeywords, activatingNaverKeywords, harvestingLearning, optimizingPerformance,
    runningBudgetPacing, runningOptimizationSafePipeline, probingPublisher, runningLaunchAudit, probingNaverAdgroups, probingNaverAssets,
    syncingNaverAssets, generatingNaverPacket, approvingNaverCandidates, runningExpiryCleanup, runningKillSwitch,
    generatingCandidates, syncingPerformance, applyingLearning, publishingExternal, harvestingSearchTerms,
    planningExperiments, probingGooglePublisher, loadingTenantReport, buildingOpsPlan, creatingCreativeDrafts,
    syncingBookingFunnel, runningConversionAttribution, runningKeywordBrain, runningSeoKeywordBridge, runningSearchTermGrowth, creatingNaverAssets, executingNaverGate,
    exportingGoogleConversions, exportingMetaConversions, runningBidOptimizer, runningExperiments, applyingBlogEvolution,
    runningPlatformJobs, runningConversionUpload, runningConversionSafePipeline, loadingDataQuality, planningPortfolio, applyingPortfolio,
    creatingAssetGroup, savingTenantWorkspace, checkingRuntimeReadiness, executingPlatformDryRun, executingConversionDryRun,
    standardizingExperiments, creatingTenantAuditExport, checkingChannelAdapters, creatingNaverAdapterPacket, creatingGoogleDraftPacket,
    creatingGoogleRsaDrafts, creatingGoogleDraftFromRsa, creatingGoogleDraftJobs, runningGoogleSafePipeline, creatingMetaCapiPacket, runningMetaCreativeSafePipeline, checkingExecutionGate, checkingGoogleDraftGate, runningRollbackDrill, runningLimitedPilot, checkingStagingSmoke,
    checkingOperatingInventory, checkingStagingValidation, checkingAdminSurfaceQa,
  } = actionFlags;

  const {
    keywordActionId,
    changeRequestActionId,
    opsQueueActionId,
    setKeywordActionId,
    setChangeRequestActionId,
    setOpsQueueActionId,
  } = useActiveActionIds();
  const {
    automationMessage,
    launchAudit,
    naverSetupPacket,
    tenantReport,
    opsPlan,
    keywordBrainResult,
    naverAssetPlan,
    stagingSmoke,
    operatingInventory,
    stagingValidation,
    adminSurfaceQa,
    setAutomationMessage,
    setLaunchAudit,
    setNaverSetupPacket,
    setTenantReport,
    setOpsPlan,
    setKeywordBrainResult,
    setNaverAssetPlan,
    setStagingSmoke,
    setOperatingInventory,
    setStagingValidation,
    setAdminSurfaceQa,
  } = useAdOsResultState();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchSummary()
      .then((json) => {
        if (alive) {
          loadSummary(json);
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Ad OS summary load failed.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadSummary, setError, setLoading]);

  useEffect(() => {
    let alive = true;
    loadInitialReadinessPanels({
      fetchers: {
        fetchStagingSmoke,
        fetchOperatingInventory,
        fetchStagingValidation,
        fetchAdminSurfaceQa,
      },
      handlers: {
        setStagingSmoke,
        setOperatingInventory,
        setStagingValidation,
        setAdminSurfaceQa,
      },
      shouldApply: () => alive,
    })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Ad OS readiness panels load failed.');
      })
    return () => {
      alive = false;
    };
  }, [setAdminSurfaceQa, setError, setOperatingInventory, setStagingSmoke, setStagingValidation]);

  const refresh = async () => {
    const next = await fetchSummary();
    loadSummary(next);
  };

  const runJsonAction = useAdOsJsonActionRunner({
    setActionFlag,
    setError,
    setAutomationMessage,
    refresh,
  });
  const runJsonBatchAction = useAdOsJsonBatchActionRunner({
    setActionFlag,
    setError,
    setAutomationMessage,
    refresh,
  });
  const runKeywordPlanAction = useAdOsJsonIdActionRunner({
    setActionId: setKeywordActionId,
    setError,
    setAutomationMessage,
    refresh,
  });
  const runChangeRequestAction = useAdOsJsonIdActionRunner({
    setActionId: setChangeRequestActionId,
    setError,
    setAutomationMessage,
    refresh,
  });
  const runOpsQueueRowAction = useAdOsJsonIdActionRunner({
    setActionId: setOpsQueueActionId,
    setError,
    setAutomationMessage,
    refresh,
  });

  const runReadinessCheck = useAdOsReadinessRunner({
    setActionFlag,
    setError,
    setAutomationMessage,
  });

  const postAdOsJson = async (
    url: string,
    body: Record<string, unknown>,
    errorMessage: string,
  ) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseAdOsJsonResponse(response, errorMessage);
  };

  const runStagingSmoke = async () => {
    await runReadinessCheck({
      flag: 'checkingStagingSmoke',
      fetchResult: fetchStagingSmoke,
      onSuccess: setStagingSmoke,
      errorMessage: 'Staging smoke check failed.',
      successMessage: (json) => (
        json.ok
          ? `Staging smoke passed: assertions ${formatAdOsNumber(json.smoke.passed_assertions)}, failed ${formatAdOsNumber(json.smoke.failed_assertions)}, external API write ${json.safety.external_api_write ? 'yes' : 'no'}.`
          : `Staging smoke failed: assertions ${formatAdOsNumber(json.smoke.failed_assertions)} failed. Next: ${json.smoke.next_action}`
      ),
    });
  };

  const runOperatingInventory = async () => {
    await runReadinessCheck({
      flag: 'checkingOperatingInventory',
      fetchResult: fetchOperatingInventory,
      onSuccess: setOperatingInventory,
      errorMessage: 'Operating inventory check failed.',
      successMessage: (json) => (
        json.inventory.status === 'operational'
          ? `Operating inventory complete: readiness ${formatAdOsNumber(json.inventory.readiness_score)}%, operational ${formatAdOsNumber(json.inventory.operational)}, blocked ${formatAdOsNumber(json.inventory.blocked)}.`
          : `Operating inventory needs attention: ${json.inventory.top_gap}. Next: ${json.inventory.next_action}`
      ),
    });
  };

  const runStagingValidation = async () => {
    await runReadinessCheck({
      flag: 'checkingStagingValidation',
      fetchResult: fetchStagingValidation,
      onSuccess: setStagingValidation,
      errorMessage: 'Staging validation failed.',
      successMessage: (json) => (
        json.validation.status === 'pass'
          ? `Staging validation passed: ${formatAdOsNumber(json.validation.passed)} pass, ${formatAdOsNumber(json.validation.warnings)} warnings, ${formatAdOsNumber(json.validation.failed)} failed.`
          : `Staging validation needs attention: ${json.validation.next_action}`
      ),
    });
  };

  const runAdminSurfaceQa = async () => {
    await runReadinessCheck({
      flag: 'checkingAdminSurfaceQa',
      fetchResult: fetchAdminSurfaceQa,
      onSuccess: setAdminSurfaceQa,
      errorMessage: 'Admin surface QA failed.',
      successMessage: (json) => (
        json.qa.status === 'pass'
          ? `Admin surface QA passed: ${formatAdOsNumber(json.qa.passed)} pass, ${formatAdOsNumber(json.qa.warnings)} warnings, ${formatAdOsNumber(json.qa.failed)} failed.`
          : `Admin surface QA needs attention: ${json.qa.top_gap || 'review required'}. Next: ${json.qa.next_action}`
      ),
    });
  };

  const saveTenantPolicy = async () => {
    if (!tenantPolicyDraft) return;
    await runJsonAction({
      flag: 'savingTenantPolicy',
      url: '/api/admin/ad-os/tenant-policy',
      body: tenantPolicyDraft,
      errorMessage: 'Tenant safety policy save failed.',
      successMessage: 'Tenant safety policy saved.',
    });
  };

  const saveBudgets = async () => {
    await runJsonAction({
      flag: 'savingBudget',
      url: '/api/admin/ad-os/budgets',
      body: { budgets: budgetDrafts },
      errorMessage: 'Budget guardrail save failed.',
      successMessage: 'Budget guardrails saved.',
    });
  };

  const runDryRun = async () => {
    await runJsonAction({
      flag: 'runningAutomation',
      url: '/api/admin/ad-os/autopilot',
      body: { mode: 'dry_run' },
      errorMessage: 'Autopilot dry-run failed.',
      successMessage: 'Autopilot dry-run completed. No external spend was triggered.',
    });
  };

  const runGuardedApply = async () => {
    await runJsonAction({
      flag: 'runningGuardedApply',
      url: '/api/admin/ad-os/autopilot',
      body: { mode: 'guarded', apply: true },
      errorMessage: 'Guarded apply failed.',
      successMessage: buildGuardedApplyMessage,
    });
  };

  const runPilotSetup = async () => {
    await runJsonAction({
      flag: 'runningPilotSetup',
      url: '/api/admin/ad-os/pilot-setup',
      body: {
        mode: 'guarded',
        apply: true,
        monthlyBudgetKrw: 100000,
        dailyBudgetKrw: 10000,
        maxCpcKrw: 500,
        keywordLimit: 20,
        draftLimit: 80,
      },
      errorMessage: 'Pilot setup failed.',
      successMessage: buildPilotSetupMessage,
    });
  };

  const publishDrafts = async () => {
    await runJsonAction({
      flag: 'publishingDrafts',
      url: '/api/admin/ad-os/publish-drafts',
      body: { mode: 'guarded', apply: true, limit: 80 },
      errorMessage: 'Publish draft generation failed.',
      successMessage: buildPublishDraftsMessage,
    });
  };

  const publishNaverPausedKeywords = async () => {
    await runJsonAction({
      flag: 'publishingNaverKeywords',
      url: '/api/admin/ad-os/publish-naver-keywords',
      body: { mode: 'dry_run', limit: 20 },
      errorMessage: 'Naver paused keyword publisher dry-run failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Naver paused keyword publisher dry-run complete: checked ${formatAdOsNumber(summary.checked_keywords)}, eligible ${formatAdOsNumber(summary.eligible_keywords)}, blocked ${formatAdOsNumber(summary.blocked_keywords)}. Legacy publisher external API write 0.`;
      },
    });
  };

  const probeNaverAdgroups = async () => {
    const savedAdgroupId = summary?.channel_budgets.find((budget) => budget.platform === 'naver')?.external_ad_group_id || null;
    await runJsonAction({
      flag: 'probingNaverAdgroups',
      url: '/api/admin/ad-os/naver-adgroups',
      body: { nccAdgroupId: savedAdgroupId },
      errorMessage: 'Naver ad group lookup failed.',
      refresh: false,
      successMessage: (json) => {
        const adgroups = Array.isArray(json.adgroups) ? json.adgroups : [];
        const first = getAdOsRecord(adgroups[0]);
        const verified = getAdOsRecord(json.verified_adgroup);
        const verifiedAdgroup = getAdOsRecord(verified.adgroup);
        if (verified.ok) return `Saved Naver ad group verified: ${String(verifiedAdgroup.nccAdgroupId || savedAdgroupId)}.`;
        if (savedAdgroupId) return `Saved Naver ad group could not be verified: ${String(verified.error || savedAdgroupId)}.`;
        if (adgroups.length > 0) return `Naver ad groups found: ${formatAdOsNumber(json.count)}. Suggested ad group id: ${String(first.nccAdgroupId || '-')}.`;
        return 'No Naver ad groups were found.';
      },
    });
  };

  const probeNaverAssets = async () => {
    await runJsonAction({
      flag: 'probingNaverAssets',
      url: '/api/admin/ad-os/naver-assets',
      body: {},
      errorMessage: 'Naver account asset lookup failed.',
      refresh: false,
      successMessage: (json) => {
        const counts = getAdOsRecord(json.counts);
        return `Naver account assets: campaigns ${formatAdOsNumber(counts.campaigns)}, ad groups ${formatAdOsNumber(counts.adgroups)}, business channels ${formatAdOsNumber(counts.channels)}. Next: ${String(json.next_action || '-')}`;
      },
    });
  };

  const syncNaverAssets = async () => {
    await runJsonAction({
      flag: 'syncingNaverAssets',
      url: '/api/admin/ad-os/sync-naver-assets',
      body: {},
      errorMessage: 'Naver asset sync failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        if (json.saved) {
          return `Naver assets saved: campaigns ${formatAdOsNumber(summary.campaigns)}, ad groups ${formatAdOsNumber(summary.adgroups)}, business channels ${formatAdOsNumber(summary.channels)}. Stored ad group id: ${String(summary.external_ad_group_id || '-')}`;
        }
        return `Naver asset sync waiting: campaigns ${formatAdOsNumber(summary.campaigns)}, ad groups ${formatAdOsNumber(summary.adgroups)}, business channels ${formatAdOsNumber(summary.channels)}. Next: ${String(json.next_action || '-')}`;
      },
    });
  };

  const generateNaverSetupPacket = async () => {
    await runJsonAction<NonNullable<Parameters<typeof setNaverSetupPacket>[0]> & Record<string, unknown>>({
      flag: 'generatingNaverPacket',
      url: '/api/admin/ad-os/naver-setup-packet',
      body: {},
      errorMessage: 'Naver setup packet generation failed.',
      refresh: false,
      onSuccess: (json) => setNaverSetupPacket(json as Parameters<typeof setNaverSetupPacket>[0]),
      successMessage: (json) => {
        const packet = getAdOsRecord(json.packet);
        return `Naver setup packet ready: campaign "${String(packet.campaign_name || '-')}", ad group "${String(packet.ad_group_name || '-')}", keywords ${formatAdOsNumber(packet.keyword_count)}. Next: ${String(json.next_action || '-')}`;
      },
    });
  };

  const copyNaverKeywordCsv = async () => {
    const keywordCsv = getNaverKeywordCsv(naverSetupPacket);
    if (!keywordCsv) return;
    try {
      await navigator.clipboard.writeText(keywordCsv);
      setAutomationMessage('Naver keyword CSV copied to clipboard.');
    } catch {
      setAutomationMessage('Clipboard copy was blocked. Select the CSV content manually.');
    }
  };

  const downloadNaverKeywordCsv = () => {
    const keywordCsv = getNaverKeywordCsv(naverSetupPacket);
    if (!keywordCsv) return;
    const csvBlob = new Blob([keywordCsv], { type: 'text/csv;charset=utf-8' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const anchor = document.createElement('a');
    anchor.href = csvUrl;
    anchor.download = buildNaverKeywordCsvFilename(naverSetupPacket?.packet.campaign_name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(csvUrl);
    setAutomationMessage('Naver keyword CSV download started.');
  };

  const harvestLearning = async () => {
    await runJsonAction({
      flag: 'harvestingLearning',
      url: '/api/admin/ad-os/learning-harvest',
      body: { mode: 'guarded', apply: true, days: 30 },
      errorMessage: 'Learning harvest failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Learning harvest complete: learning events ${formatAdOsNumber(summary.learning_events)}, search terms ${formatAdOsNumber(summary.search_term_candidates)}, add candidates ${formatAdOsNumber(summary.add_keyword_candidates)}, negative candidates ${formatAdOsNumber(summary.add_negative_candidates)}.`;
      },
    });
  };

  const generateCandidates = async () => {
    await runJsonAction({
      flag: 'generatingCandidates',
      url: '/api/admin/ad-os/generate-candidates',
      body: { limit: 5 },
      errorMessage: 'Candidate generation failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Candidate generation complete: products ${formatAdOsNumber(summary.targeted)}, keywords ${formatAdOsNumber(summary.keywords)}, saved ${formatAdOsNumber(summary.saved)}.`;
      },
    });
  };

  const optimizePerformance = async () => {
    await runJsonAction({
      flag: 'optimizingPerformance',
      url: '/api/admin/ad-os/optimize-performance',
      body: { mode: 'dry_run', limit: 100 },
      errorMessage: 'Performance optimization failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Performance optimization dry-run complete: checked ${formatAdOsNumber(summary.checked_mappings)}, pause candidates ${formatAdOsNumber(summary.pause_candidates)}, scale candidates ${formatAdOsNumber(summary.scale_candidates)}.`;
      },
    });
  };

  const activateNaverPausedKeywords = async () => {
    await runJsonAction({
      flag: 'activatingNaverKeywords',
      url: '/api/admin/ad-os/publisher/naver/activate-paused',
      body: { mode: 'guarded', apply: true, limit: 20 },
      errorMessage: 'Naver paused keyword activation failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Naver paused keyword activation complete: checked ${formatAdOsNumber(summary.checked_keywords)}, approval requests ${formatAdOsNumber(summary.approved_activation_requests)}, activated ${formatAdOsNumber(summary.activated_keywords)}. External API write remains gated by active-spend interlock.`;
      },
    });
  };

  const createCreativeDrafts = async () => {
    await runJsonAction({
      flag: 'creatingCreativeDrafts',
      url: '/api/admin/ad-os/creative-factory',
      body: { apply: true, limit: 6 },
      errorMessage: 'Creative Factory draft generation failed.',
      successMessage: (json) =>
        `Creative Factory drafts complete: prepared ${formatAdOsNumber(json.prepared_drafts)}, saved ${formatAdOsNumber(json.inserted_drafts)}. Drafts were saved without automatic publishing.`,
    });
  };

  const syncBookingFunnel = async () => {
    await runJsonAction({
      flag: 'syncingBookingFunnel',
      url: '/api/admin/ad-os/booking-funnel-sync',
      body: { apply: true, days: 30, limit: 500 },
      errorMessage: 'Booking funnel sync failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Booking funnel sync complete: bookings ${formatAdOsNumber(summary.bookings_checked)}, events ${formatAdOsNumber(summary.events_prepared)}, cancellations ${formatAdOsNumber(summary.cancel_events)}, settlement events ${formatAdOsNumber(summary.settlement_events)}.`;
      },
    });
  };

  const syncPerformanceFacts = async () => {
    await runJsonAction({
      flag: 'syncingPerformance',
      url: '/api/admin/ad-os/performance-sync',
      body: { days: 30, apply: true },
      errorMessage: 'Performance fact sync failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Performance facts synced: facts ${formatAdOsNumber(summary.facts_prepared)}, clicks ${formatAdOsNumber(summary.total_clicks)}, CTA clicks ${formatAdOsNumber(summary.total_cta_clicks)}, conversions ${formatAdOsNumber(summary.total_conversions)}.`;
      },
    });
  };

  const runConversionAttribution = async () => {
    await runJsonAction({
      flag: 'runningConversionAttribution',
      url: '/api/admin/ad-os/conversion-attribution',
      body: { days: 30, apply: true, limit: 3000 },
      errorMessage: 'Conversion attribution failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Conversion attribution complete: events ${formatAdOsNumber(summary.events_checked)}, facts ${formatAdOsNumber(summary.facts_prepared)}, conversions ${formatAdOsNumber(summary.conversions)}, margin ROAS ${formatAdOsNumber(summary.margin_roas_pct)}%.`;
      },
    });
  };

  const applyLearningRules = async () => {
    await runJsonAction({
      flag: 'applyingLearning',
      url: '/api/admin/ad-os/learning-apply',
      body: { apply: true, limit: 100 },
      errorMessage: 'Learning apply failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Learning apply complete: change requests ${formatAdOsNumber(summary.change_requests_inserted)}, pause candidates ${formatAdOsNumber(summary.pause_candidates)}, landing candidates ${formatAdOsNumber(summary.landing_candidates)}, expansion candidates ${formatAdOsNumber(summary.expansion_candidates)}.`;
      },
    });
  };

  const dryRunExternalPublish = async () => {
    await runJsonAction({
      flag: 'publishingExternal',
      url: '/api/admin/ad-os/external-publish',
      body: { platform: 'naver', mode: 'dry_run', apply: false },
      errorMessage: 'External publish dry-run failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        const channelState = getAdOsRecord(summary.channel_state);
        return `External publish dry-run complete: ${String(channelState.label || 'channel checked')}, approval requests ${formatAdOsNumber(summary.approved_requests)}, external API write ${summary.external_api_write ? 'yes' : 'no'}.`;
      },
    });
  };

  const runBudgetPacing = async () => {
    await runJsonAction({
      flag: 'runningBudgetPacing',
      url: '/api/admin/ad-os/budget-pacing',
      body: { mode: 'dry_run' },
      errorMessage: 'Budget pacing failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Budget pacing dry-run complete: channels ${formatAdOsNumber(summary.checked_channels)}, over pacing ${formatAdOsNumber(summary.over_pacing)}, under pacing ${formatAdOsNumber(summary.under_pacing)}, near loss cap ${formatAdOsNumber(summary.loss_limit_near)}, blocked ${formatAdOsNumber(summary.blocked)}.`;
      },
    });
  };

  const runOptimizationSafePipeline = async () => {
    setActionFlag('runningOptimizationSafePipeline', true);
    setError(null);
    setAutomationMessage(null);
    try {
      const performance = await postAdOsJson(
        '/api/admin/ad-os/performance-sync',
        { days: 30, apply: true },
        'Performance fact sync failed.',
      );
      const attribution = await postAdOsJson(
        '/api/admin/ad-os/conversion-attribution',
        { days: 30, apply: true, limit: 3000 },
        'Conversion attribution failed.',
      );
      const bidOptimizer = await postAdOsJson(
        '/api/admin/ad-os/bid-optimizer/apply',
        { apply: true, limit: 200 },
        'Bid optimizer failed.',
      );
      const portfolio = await postAdOsJson(
        '/api/admin/ad-os/optimizer/portfolio-plan',
        { apply: true, days: 30 },
        'Portfolio optimizer planning failed.',
      );
      const pacing = await postAdOsJson(
        '/api/admin/ad-os/budget-pacing',
        { mode: 'dry_run' },
        'Budget pacing failed.',
      );

      await refresh();
      const performanceSummary = getAdOsRecord(performance.summary);
      const attributionSummary = getAdOsRecord(attribution.summary);
      const bidSummary = getAdOsRecord(bidOptimizer.summary);
      const portfolioSummary = getAdOsRecord(portfolio.summary);
      const pacingSummary = getAdOsRecord(pacing.summary);
      setAutomationMessage(
        `Optimization safe pipeline complete: facts ${formatAdOsNumber(performanceSummary.facts_prepared)}, attribution conversions ${formatAdOsNumber(attributionSummary.conversions)}, bid candidates ${formatAdOsNumber(bidSummary.candidates)}, portfolio plans ${formatAdOsNumber(portfolioSummary.inserted)}, pacing checked ${formatAdOsNumber(pacingSummary.checked_channels)}. External API write 0.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization safe pipeline failed.');
    } finally {
      setActionFlag('runningOptimizationSafePipeline', false);
    }
  };

  const probePublisher = async () => {
    await runJsonAction({
      flag: 'probingPublisher',
      url: '/api/admin/ad-os/publisher-probe',
      body: { hint: 'Danang package' },
      errorMessage: 'External account probe failed.',
      successMessage: (json) => {
        const probes = getAdOsRecord(json.probes);
        const naver = getAdOsRecord(probes.naver);
        const google = getAdOsRecord(probes.google);
        return `External account probe complete: Naver ${String(naver.status || '-')} (${String(naver.message || '-')}), Google ${String(google.status || '-')} (${String(google.message || '-')}).`;
      },
    });
  };

  const runLaunchAudit = async () => {
    await runJsonAction({
      flag: 'runningLaunchAudit',
      url: '/api/admin/ad-os/launch-audit',
      body: {},
      errorMessage: 'Launch audit failed.',
      onSuccess: (json) => setLaunchAudit({
        readiness: json.readiness as NonNullable<Parameters<typeof setLaunchAudit>[0]>['readiness'],
        items: json.items as NonNullable<Parameters<typeof setLaunchAudit>[0]>['items'],
      }),
      successMessage: (json) => {
        const readiness = getAdOsRecord(json.readiness);
        return `Launch audit complete: pass ${formatAdOsNumber(readiness.pass)}/${formatAdOsNumber(readiness.total)}, warnings ${formatAdOsNumber(readiness.warn)}, failures ${formatAdOsNumber(readiness.fail)}. Next: ${String(readiness.next_action || '-')}`;
      },
    });
  };

  const approveNaverCandidates = async () => {
    await runJsonAction({
      flag: 'approvingNaverCandidates',
      url: '/api/admin/ad-os/approve-naver-candidates',
      body: { mode: 'guarded', apply: true, limit: 20 },
      errorMessage: 'Naver candidate approval failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Naver candidate approval complete: checked ${formatAdOsNumber(summary.checked_keywords)}, eligible ${formatAdOsNumber(summary.eligible_keywords)}, approved ${formatAdOsNumber(summary.approved_keywords)}. External ad spend 0.`;
      },
    });
  };

  const runExpiryCleanup = async () => {
    await runJsonAction({
      flag: 'runningExpiryCleanup',
      url: '/api/admin/ad-os/expiry-cleanup',
      body: { mode: 'dry_run', limit: 50 },
      errorMessage: 'Expiry cleanup dry-run failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Expiry cleanup dry-run complete: expired packages ${formatAdOsNumber(summary.expired_packages)}, keyword pause targets ${formatAdOsNumber(summary.keyword_targets)}, mapping pause targets ${formatAdOsNumber(summary.mapping_targets)}.`;
      },
    });
  };

  const runKillSwitchDryRun = async () => {
    await runJsonAction({
      flag: 'runningKillSwitch',
      url: '/api/admin/ad-os/kill-switch',
      body: {
        mode: 'dry_run',
        apply: false,
        reason: 'Operator reviewed Ad OS emergency pause scope.',
      },
      errorMessage: 'Kill-switch dry-run failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Kill-switch dry-run complete: active budget channels ${formatAdOsNumber(summary.active_budget_channels)}, keyword targets ${formatAdOsNumber(summary.keyword_targets)}, mapping targets ${formatAdOsNumber(summary.mapping_targets)}. Dry-run only: no external spend.`;
      },
    });
  };

  const updateKeywordPlan = async (id: string, action: 'approve' | 'archive') => {
    await runKeywordPlanAction({
      activeId: id,
      url: '/api/admin/search-ads/auto-plan',
      body: { action, ids: [id] },
      errorMessage: 'Keyword status update failed.',
      successMessage: action === 'approve' ? 'Keyword candidate approved.' : 'Keyword candidate archived.',
    });
  };

  const harvestSearchTerms = async () => {
    await runJsonAction({
      flag: 'harvestingSearchTerms',
      url: '/api/admin/ad-os/search-term-harvest',
      body: { mode: 'dry_run' },
      errorMessage: 'Search term harvest failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Search term harvest complete: fetched ${formatAdOsNumber(summary.fetched_terms)}, add keywords ${formatAdOsNumber(summary.add_keyword)}, negatives ${formatAdOsNumber(summary.add_negative)}, review ${formatAdOsNumber(summary.review)}.`;
      },
    });
  };

  const planExperiments = async () => {
    await runJsonAction({
      flag: 'planningExperiments',
      url: '/api/admin/ad-os/experiment-plan',
      body: { apply: true },
      errorMessage: 'Experiment planning failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Experiment planning complete: facts ${formatAdOsNumber(summary.facts_checked)}, experiments ${formatAdOsNumber(summary.experiments_created)}. Bandit remains disabled by default.`;
      },
    });
  };

  const probeGooglePublisher = async () => {
    await runJsonAction({
      flag: 'probingGooglePublisher',
      url: '/api/admin/ad-os/publisher/google/probe',
      body: { hint: 'Danang package' },
      errorMessage: 'Google action failed.',
      successMessage: (json) => {
        const probe = getAdOsRecord(json.probe);
        return `Google permission probe complete: ${String(probe.status || '-')}. ${String(probe.message || '')} Next: ${String(probe.next_action || '-')}`;
      },
    });
  };

  const loadTenantReport = async () => {
    await runJsonAction({
      flag: 'loadingTenantReport',
      url: '/api/admin/ad-os/tenant-report',
      errorMessage: 'Tenant report generation failed.',
      refresh: false,
      onSuccess: setTenantReport,
      successMessage: (json) => {
        const report = getAdOsRecord(json.report);
        return `Tenant report loaded: budget usage ${formatAdOsNumber(report.budget_usage_pct)}%, revenue ROAS ${formatAdOsNumber(report.revenue_roas_pct)}%, margin ROAS ${formatAdOsNumber(report.margin_roas_pct)}%, cheap keywords ${formatAdOsNumber(report.discovered_cheap_keywords)}.`;
      },
    });
  };

  const buildOpsPlan = async () => {
    await runJsonAction({
      flag: 'buildingOpsPlan',
      url: '/api/admin/ad-os/ops-plan',
      body: { apply: true },
      errorMessage: 'Ops plan generation failed.',
      onSuccess: setOpsPlan,
      successMessage: (json) => {
        const keywordMining = getAdOsRecord(json.keyword_mining);
        const creativeFactory = getAdOsRecord(json.creative_factory);
        const candidates = Array.isArray(keywordMining.candidates) ? keywordMining.candidates.length : 0;
        const drafts = Array.isArray(creativeFactory.drafts) ? creativeFactory.drafts.length : 0;
        return `Ops plan generated: change requests ${formatAdOsNumber(json.inserted_change_requests)}, keyword candidates ${formatAdOsNumber(candidates)}, creative drafts ${formatAdOsNumber(drafts)}.`;
      },
    });
  };

  const runKeywordBrain = async () => {
    await runJsonAction<{
      summary?: {
        candidates?: unknown;
        inserted_clusters?: unknown;
        inserted_keyword_plans?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'runningKeywordBrain',
      url: '/api/admin/ad-os/keyword-brain',
      body: { apply: true, limit: 80 },
      errorMessage: 'Keyword Brain failed.',
      onSuccess: setKeywordBrainResult,
      successMessage: (json) => {
        const summary = json.summary as {
          candidates?: unknown;
          inserted_clusters?: unknown;
          inserted_keyword_plans?: unknown;
        } | undefined;
        return `Keyword Brain complete: candidates ${formatAdOsNumber(summary?.candidates)}, clusters ${formatAdOsNumber(summary?.inserted_clusters)}, keyword drafts ${formatAdOsNumber(summary?.inserted_keyword_plans)}. External ad spend 0.`;
      },
    });
  };

  const runSeoKeywordBridge = async () => {
    await runJsonAction<{
      summary?: {
        candidate_keyword_plans?: unknown;
        inserted_keyword_plans?: unknown;
        inserted_negative_candidates?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'runningSeoKeywordBridge',
      url: '/api/admin/ad-os/seo-keyword-bridge',
      body: { apply: true, days: 28, limit: 80, platforms: ['naver', 'google'] },
      errorMessage: 'SEO to Ads keyword bridge failed.',
      onSuccess: setKeywordBrainResult,
      successMessage: (json) => {
        const summary = json.summary as {
          candidate_keyword_plans?: unknown;
          inserted_keyword_plans?: unknown;
          inserted_negative_candidates?: unknown;
        } | undefined;
        return `SEO to Ads bridge complete: candidates ${formatAdOsNumber(summary?.candidate_keyword_plans)}, keyword drafts ${formatAdOsNumber(summary?.inserted_keyword_plans)}, negative candidates ${formatAdOsNumber(summary?.inserted_negative_candidates)}. External ad spend 0.`;
      },
    });
  };

  const runSearchTermGrowth = async () => {
    await runJsonAction<{
      summary?: {
        keyword_drafts?: unknown;
        negative_drafts?: unknown;
        inserted_keyword_plans?: unknown;
        inserted_change_requests?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'runningSearchTermGrowth',
      url: '/api/admin/ad-os/search-term-growth',
      body: { apply: true, limit: 100, platforms: ['naver', 'google'] },
      errorMessage: 'Search term growth failed.',
      onSuccess: setKeywordBrainResult,
      successMessage: (json) => {
        const summary = json.summary as {
          keyword_drafts?: unknown;
          negative_drafts?: unknown;
          inserted_keyword_plans?: unknown;
          inserted_change_requests?: unknown;
        } | undefined;
        return `Search term growth complete: keyword drafts ${formatAdOsNumber(summary?.keyword_drafts)}, negative drafts ${formatAdOsNumber(summary?.negative_drafts)}, saved ${formatAdOsNumber(summary?.inserted_keyword_plans)}, approval requests ${formatAdOsNumber(summary?.inserted_change_requests)}. External ad spend 0.`;
      },
    });
  };

  const createNaverAssets = async () => {
    await runJsonAction<{
      summary?: {
        inserted_change_requests?: unknown;
        inserted_mutation_rows?: unknown;
        blockers?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'creatingNaverAssets',
      url: '/api/admin/ad-os/publisher/naver/create-assets',
      body: { apply: true },
      errorMessage: 'Naver external asset request failed.',
      onSuccess: setNaverAssetPlan,
      successMessage: (json) => {
        const summary = json.summary as {
          inserted_change_requests?: unknown;
          inserted_mutation_rows?: unknown;
          blockers?: unknown;
        } | undefined;
        return `Naver external asset request complete: change requests ${formatAdOsNumber(summary?.inserted_change_requests)}, mutation audits ${formatAdOsNumber(summary?.inserted_mutation_rows)}, blockers ${formatAdOsBlockers(summary?.blockers)}. External ad spend 0.`;
      },
    });
  };

  const executeNaverGate = async () => {
    await runJsonAction<{
      summary?: {
          requested?: unknown;
          planned?: unknown;
          blocked?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'executingNaverGate',
      url: '/api/admin/ad-os/publisher/naver/execute',
      body: { mode: 'paused_only', apply: true, limit: 50 },
      errorMessage: 'Naver execution gate failed.',
      successMessage: (json) => {
        const summary = json.summary as {
          requested?: unknown;
          planned?: unknown;
          blocked?: unknown;
        } | undefined;
        return `Naver execution gate complete: requested ${formatAdOsNumber(summary?.requested)}, planned ${formatAdOsNumber(summary?.planned)}, blocked ${formatAdOsNumber(summary?.blocked)}. External API write 0.`;
      },
    });
  };

  const exportGoogleConversions = async () => {
    await runJsonAction<{
      summary?: {
          ready_for_upload?: unknown;
          blocked?: unknown;
          change_requests_created?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'exportingGoogleConversions',
      url: '/api/admin/ad-os/conversion-export/google',
      body: { apply: true, limit: 100 },
      errorMessage: 'Google conversion export failed.',
      successMessage: (json) => {
        const summary = json.summary as {
          ready_for_upload?: unknown;
          blocked?: unknown;
          change_requests_created?: unknown;
        } | undefined;
        return `Google conversion export candidates: upload-ready ${formatAdOsNumber(summary?.ready_for_upload)}, blocked ${formatAdOsNumber(summary?.blocked)}, change requests ${formatAdOsNumber(summary?.change_requests_created)}. External upload 0.`;
      },
    });
  };

  const exportMetaConversions = async () => {
    await runJsonAction<{
      summary?: {
          ready_for_upload?: unknown;
          blocked?: unknown;
          change_requests_created?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'exportingMetaConversions',
      url: '/api/admin/ad-os/conversion-export/meta',
      body: { apply: true, limit: 100 },
      errorMessage: 'Meta conversion export failed.',
      successMessage: (json) => {
        const summary = json.summary as {
          ready_for_upload?: unknown;
          blocked?: unknown;
          change_requests_created?: unknown;
        } | undefined;
        return `Meta conversion export candidates: upload-ready ${formatAdOsNumber(summary?.ready_for_upload)}, blocked ${formatAdOsNumber(summary?.blocked)}, change requests ${formatAdOsNumber(summary?.change_requests_created)}. External upload 0.`;
      },
    });
  };

  const runBidOptimizer = async () => {
    await runJsonAction<{
      summary?: {
          candidates?: unknown;
          pause_candidates?: unknown;
          scale_candidates?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'runningBidOptimizer',
      url: '/api/admin/ad-os/bid-optimizer/apply',
      body: { apply: true, limit: 200 },
      errorMessage: 'Bid optimizer failed.',
      successMessage: (json) => {
        const summary = json.summary as {
          candidates?: unknown;
          pause_candidates?: unknown;
          scale_candidates?: unknown;
        } | undefined;
        return `Bid optimizer candidates complete: candidates ${formatAdOsNumber(summary?.candidates)}, pause ${formatAdOsNumber(summary?.pause_candidates)}, scale ${formatAdOsNumber(summary?.scale_candidates)}.`;
      },
    });
  };

  const runExperimentRunner = async () => {
    await runJsonAction<{
      summary?: {
          started?: unknown;
          completed?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'runningExperiments',
      url: '/api/admin/ad-os/experiment-run',
      body: { apply: true, limit: 50 },
      errorMessage: 'Experiment runner failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Experiment runner complete: started or kept ${formatAdOsNumber(summary?.started)}, completed ${formatAdOsNumber(summary?.completed)}.`;
      },
    });
  };

  const applyBlogEvolution = async () => {
    await runJsonAction<{
      summary?: {
          versions_checked?: unknown;
          change_requests_created?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'applyingBlogEvolution',
      url: '/api/admin/ad-os/blog-evolution/apply',
      body: { apply: true, create_change_requests: true, limit: 50 },
      errorMessage: 'Blog evolution apply failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Blog evolution candidates complete: versions checked ${formatAdOsNumber(summary?.versions_checked)}, change requests ${formatAdOsNumber(summary?.change_requests_created)}.`;
      },
    });
  };

  const runPlatformJobs = async () => {
    await runJsonAction<{
      summary?: {
          jobs?: unknown;
          blocked?: unknown;
          approved?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'runningPlatformJobs',
      url: '/api/admin/ad-os/platform-jobs/run',
      body: { apply: true, execute: false, limit: 100 },
      errorMessage: 'Platform job preparation failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Platform jobs prepared: jobs ${formatAdOsNumber(summary?.jobs)}, blocked ${formatAdOsNumber(summary?.blocked)}, approved or ready ${formatAdOsNumber(summary?.approved)}. External API write 0.`;
      },
    });
  };

  const runConversionUploadJobs = async () => {
    await runJsonBatchAction<{
      google: { summary?: { clean?: unknown; blocked?: unknown } } & Record<string, unknown>;
      meta: { summary?: { clean?: unknown; blocked?: unknown } } & Record<string, unknown>;
    }>({
      flag: 'runningConversionUpload',
      requests: [
        {
          key: 'google',
          url: '/api/admin/ad-os/conversion-upload/run',
          body: { apply: true, platform: 'google', limit: 100 },
          errorMessage: 'Google conversion upload job failed.',
        },
        {
          key: 'meta',
          url: '/api/admin/ad-os/conversion-upload/run',
          body: { apply: true, platform: 'meta', limit: 100 },
          errorMessage: 'Meta conversion upload job failed.',
        },
      ],
      errorMessage: 'Conversion upload jobs failed.',
      successMessage: (json) =>
        `Conversion upload jobs prepared: Google clean ${formatAdOsNumber(json.google.summary?.clean)} / blocked ${formatAdOsNumber(json.google.summary?.blocked)}, Meta clean ${formatAdOsNumber(json.meta.summary?.clean)} / blocked ${formatAdOsNumber(json.meta.summary?.blocked)}. External upload 0.`,
    });
  };

  const loadDataQuality = async () => {
    await runJsonAction<{
      summary?: {
          status?: unknown;
          uploadable_conversions?: unknown;
          blocked_conversions?: unknown;
          attribution_coverage?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'loadingDataQuality',
      url: '/api/admin/ad-os/data-quality',
      body: { apply: true, days: 14 },
      errorMessage: 'Conversion data quality load failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Conversion data quality saved: ${String(summary?.status || 'unknown')}, uploadable ${formatAdOsNumber(summary?.uploadable_conversions)}, blocked ${formatAdOsNumber(summary?.blocked_conversions)}, attribution coverage ${Math.round(Number(summary?.attribution_coverage || 0) * 100)}%.`;
      },
    });
  };

  const runConversionSafePipeline = async () => {
    setActionFlag('runningConversionSafePipeline', true);
    setError(null);
    setAutomationMessage(null);
    try {
      const googleJobs = await postAdOsJson(
        '/api/admin/ad-os/conversion-upload/run',
        { apply: true, platform: 'google', limit: 100 },
        'Google conversion upload job failed.',
      );
      const metaJobs = await postAdOsJson(
        '/api/admin/ad-os/conversion-upload/run',
        { apply: true, platform: 'meta', limit: 100 },
        'Meta conversion upload job failed.',
      );
      const googleDryRun = await postAdOsJson(
        '/api/admin/ad-os/conversion-upload/execute',
        { apply: true, platform: 'google', limit: 50 },
        'Google conversion upload dry-run failed.',
      );
      const metaDryRun = await postAdOsJson(
        '/api/admin/ad-os/conversion-upload/execute',
        { apply: true, platform: 'meta', limit: 50 },
        'Meta conversion upload dry-run failed.',
      );
      const dataQuality = await postAdOsJson(
        '/api/admin/ad-os/data-quality',
        { apply: true, days: 14 },
        'Conversion data quality snapshot failed.',
      );

      await refresh();
      const googleJobSummary = getAdOsRecord(googleJobs.summary);
      const metaJobSummary = getAdOsRecord(metaJobs.summary);
      const googleDryRunSummary = getAdOsRecord(googleDryRun.summary);
      const metaDryRunSummary = getAdOsRecord(metaDryRun.summary);
      const dataQualitySummary = getAdOsRecord(dataQuality.summary);
      setAutomationMessage(
        `Conversion safe pipeline complete: Google jobs ${formatAdOsNumber(googleJobSummary.jobs_written)}, Meta jobs ${formatAdOsNumber(metaJobSummary.jobs_written)}, dry-run ready ${formatAdOsNumber(Number(googleDryRunSummary.upload_ready_dry_run || 0) + Number(metaDryRunSummary.upload_ready_dry_run || 0))}, blocked ${formatAdOsNumber(Number(googleJobSummary.blocked || 0) + Number(metaJobSummary.blocked || 0) + Number(googleDryRunSummary.blocked || 0) + Number(metaDryRunSummary.blocked || 0))}, quality ${String(dataQualitySummary.status || 'unknown')}. External upload 0.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion safe pipeline failed.');
    } finally {
      setActionFlag('runningConversionSafePipeline', false);
    }
  };

  const runPortfolioPlan = async () => {
    await runJsonAction<{
      summary?: {
          generated?: unknown;
          inserted?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'planningPortfolio',
      url: '/api/admin/ad-os/optimizer/portfolio-plan',
      body: { apply: true, days: 30 },
      errorMessage: 'Portfolio optimizer planning failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Portfolio optimizer plan complete: generated ${formatAdOsNumber(summary?.generated)}, saved ${formatAdOsNumber(summary?.inserted)}. External changes still require approval.`;
      },
    });
  };

  const applyApprovedPortfolio = async () => {
    await runJsonAction<{
      summary?: {
          approved_plans?: unknown;
          inserted?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'applyingPortfolio',
      url: '/api/admin/ad-os/optimizer/apply-approved',
      body: { apply: true, limit: 50 },
      errorMessage: 'Approved portfolio apply failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Approved portfolio apply requests complete: approved plans ${formatAdOsNumber(summary?.approved_plans)}, change requests ${formatAdOsNumber(summary?.inserted)}. External API write 0.`;
      },
    });
  };

  const runRuntimeReadiness = async () => {
    await runJsonAction<{
      summary?: {
          tables_ready?: unknown;
          tables_total?: unknown;
          full_auto_enabled?: unknown;
          external_api_write_count?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'checkingRuntimeReadiness',
      url: '/api/admin/ad-os/runtime-readiness',
      body: { apply: true },
      errorMessage: 'Runtime readiness check failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Runtime readiness complete: tables ${formatAdOsNumber(summary?.tables_ready)}/${formatAdOsNumber(summary?.tables_total)}, full auto ${formatAdOsNumber(summary?.full_auto_enabled)}, external writes ${formatAdOsNumber(summary?.external_api_write_count)}.`;
      },
    });
  };

  const executePlatformJobsDryRun = async () => {
    await runJsonAction<{
      summary?: {
          succeeded?: unknown;
          blocked?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'executingPlatformDryRun',
      url: '/api/admin/ad-os/platform-jobs/execute',
      body: { apply: true, mode: 'paused_only', limit: 50 },
      errorMessage: 'Platform executor dry-run failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Platform executor dry-run complete: succeeded ${formatAdOsNumber(summary?.succeeded)}, blocked ${formatAdOsNumber(summary?.blocked)}. External API write 0.`;
      },
    });
  };

  const executeConversionUploadsDryRun = async () => {
    await runJsonBatchAction<{
      google: { summary?: { upload_ready_dry_run?: unknown; blocked?: unknown } } & Record<string, unknown>;
      meta: { summary?: { upload_ready_dry_run?: unknown; blocked?: unknown } } & Record<string, unknown>;
    }>({
      flag: 'executingConversionDryRun',
      requests: [
        {
          key: 'google',
          url: '/api/admin/ad-os/conversion-upload/execute',
          body: { apply: true, platform: 'google', limit: 50 },
          errorMessage: 'Google conversion upload executor failed.',
        },
        {
          key: 'meta',
          url: '/api/admin/ad-os/conversion-upload/execute',
          body: { apply: true, platform: 'meta', limit: 50 },
          errorMessage: 'Meta conversion upload executor failed.',
        },
      ],
      errorMessage: 'Conversion upload dry-run failed.',
      successMessage: (json) =>
        `Conversion upload dry-run complete: Google ready ${formatAdOsNumber(json.google.summary?.upload_ready_dry_run)} / blocked ${formatAdOsNumber(json.google.summary?.blocked)}, Meta ready ${formatAdOsNumber(json.meta.summary?.upload_ready_dry_run)} / blocked ${formatAdOsNumber(json.meta.summary?.blocked)}. External upload 0, uploaded conversions 0.`,
    });
  };

  const runOpsQueueAction = async (
    row: Record<string, unknown>,
    action: 'executor_dry_run' | 'confirm_failed' | 'acknowledge_blocker',
  ) => {
    const source = String(row.source || '');
    const id = String(row.id || '');
    if (!source || !id) return;
    if (
      action === 'confirm_failed' &&
      !window.confirm('Mark this external operation as failed? Continue only after checking the external account result.')
    ) {
      return;
    }
    const actionKey = `${source}:${id}:${action}`;
    await runOpsQueueRowAction({
      activeId: actionKey,
      url: '/api/admin/ad-os/ops-queues/action',
      body: {
        source,
        id,
        action,
        apply: true,
      },
      errorMessage: 'Ops queue action failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        const blockedReason = summary.blocked_reason ? ` / blocked: ${String(summary.blocked_reason)}` : '';
        const label =
          action === 'executor_dry_run'
            ? 'row dry-run'
            : action === 'confirm_failed'
              ? 'external failure confirmation'
              : 'blocker acknowledged';
        return `Ops queue ${label} complete: ${source} ${id.slice(0, 8)}. External API write 0${blockedReason}.`;
      },
    });
  };

  const standardizeExperimentTemplates = async () => {
    await runJsonAction<{
      summary?: {
          templates_written?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'standardizingExperiments',
      url: '/api/admin/ad-os/experiments/standardize',
      body: { apply: true },
      errorMessage: 'Experiment template standardization failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Experiment templates standardized: templates written ${formatAdOsNumber(summary?.templates_written)}. Automation remains gated.`;
      },
    });
  };

  const createTenantAuditExport = async () => {
    await runJsonAction({
      flag: 'creatingTenantAuditExport',
      url: '/api/admin/ad-os/tenant-audit-export',
      body: { apply: true },
      errorMessage: 'Tenant audit export failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        if (summary.workspace_found === false) return String(summary.next_action || 'Create the tenant workspace first.');
        return `Tenant audit export created: status ${String(summary.export_status || 'draft')}, rows written ${formatAdOsNumber(summary.written)}.`;
      },
    });
  };

  const checkChannelAdapters = async () => {
    await runJsonAction<{
      summary?: {
          paused_write_ready?: unknown;
          draft_ready?: unknown;
          blocked?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'checkingChannelAdapters',
      url: '/api/admin/ad-os/channel-adapters/health',
      body: { apply: true },
      errorMessage: 'Channel adapter health check failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Channel adapter health complete: paused-write ready ${formatAdOsNumber(summary?.paused_write_ready)}, draft ready ${formatAdOsNumber(summary?.draft_ready)}, blocked ${formatAdOsNumber(summary?.blocked)}. External API write 0.`;
      },
    });
  };

  const createNaverPausedKeywordPacket = async () => {
    await runJsonAction({
      flag: 'creatingNaverAdapterPacket',
      url: '/api/admin/ad-os/channel-adapters/naver/paused-keyword',
      body: {
        apply: true,
        keyword: 'Danang parents package',
        landing_url: '/blog/danang-parents-package',
        max_cpc_krw: 250,
      },
      errorMessage: 'Paused keyword packet failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Naver paused keyword packet complete: ${String(summary.lifecycle_status || 'unknown')}, blocked ${String(summary.blocked_reason || 'none')}. External API write 0.`;
      },
    });
  };

  const createGoogleDraftPacket = async () => {
    await runJsonAction({
      flag: 'creatingGoogleDraftPacket',
      url: '/api/admin/ad-os/channel-adapters/google/draft',
      body: {
        apply: true,
        campaign_name: 'Danang longtail draft',
        ad_group_name: 'Busan parents Danang',
        keyword: 'Danang parents package',
        landing_url: '/blog/danang-parents-package',
        daily_budget_krw: 10000,
      },
      errorMessage: 'Google draft packet failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Google draft packet complete: ${String(summary.lifecycle_status || 'unknown')}, blocked ${String(summary.blocked_reason || 'none')}. Live publish disabled.`;
      },
    });
  };

  const createGoogleRsaDrafts = async () => {
    await runJsonAction({
      flag: 'creatingGoogleRsaDrafts',
      url: '/api/admin/ad-os/creative-factory/search-rsa',
      body: {
        apply: true,
        limit: 3,
      },
      errorMessage: 'Google RSA draft generation failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Google RSA drafts complete: sets ${formatAdOsNumber(summary.rsa_sets_generated)}, variants ${formatAdOsNumber(summary.variants_inserted)}, approval requests ${formatAdOsNumber(summary.change_requests_created)}. External API write 0.`;
      },
    });
  };

  const createGoogleDraftFromRsa = async () => {
    await runJsonAction({
      flag: 'creatingGoogleDraftFromRsa',
      url: '/api/admin/ad-os/channel-adapters/google/draft-from-rsa',
      body: {
        apply: true,
        include_drafts: false,
        limit: 20,
      },
      errorMessage: 'Google RSA draft packet generation failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Google RSA packets complete: prepared ${formatAdOsNumber(summary.packets_prepared)}, written ${formatAdOsNumber(summary.packets_written)}, blocked ${formatAdOsNumber(summary.blocked_packets)}. External API write 0.`;
      },
    });
  };

  const createGoogleDraftJobs = async () => {
    await runJsonAction({
      flag: 'creatingGoogleDraftJobs',
      url: '/api/admin/ad-os/channel-adapters/google/jobs-from-packets',
      body: {
        apply: true,
        limit: 50,
      },
      errorMessage: 'Google draft platform job preparation failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Google draft jobs complete: prepared ${formatAdOsNumber(summary.jobs_prepared)}, written ${formatAdOsNumber(summary.jobs_written)}, approved ${formatAdOsNumber(summary.approved_jobs)}, blocked ${formatAdOsNumber(summary.blocked_jobs)}. External API write 0.`;
      },
    });
  };

  const runGoogleSafePipeline = async () => {
    setActionFlag('runningGoogleSafePipeline', true);
    setError(null);
    setAutomationMessage(null);
    try {
      const drafts = await postAdOsJson(
        '/api/admin/ad-os/creative-factory/search-rsa',
        { apply: true, limit: 3 },
        'Google RSA draft generation failed.',
      );
      const packets = await postAdOsJson(
        '/api/admin/ad-os/channel-adapters/google/draft-from-rsa',
        { apply: true, include_drafts: false, limit: 20 },
        'Google RSA draft packet generation failed.',
      );
      const gate = await postAdOsJson(
        '/api/admin/ad-os/channel-adapters/execution-gate',
        { apply: true, platform: 'google', requested_mode: 'approve', human_approved: false, limit: 20 },
        'Google draft gate check failed.',
      );
      const jobs = await postAdOsJson(
        '/api/admin/ad-os/channel-adapters/google/jobs-from-packets',
        { apply: true, limit: 50 },
        'Google draft platform job preparation failed.',
      );
      const attempts = await postAdOsJson(
        '/api/admin/ad-os/platform-jobs/execute',
        { apply: true, mode: 'dry_run', platform: 'google', limit: 50 },
        'Google draft platform dry-run failed.',
      );

      await refresh();
      const draftSummary = getAdOsRecord(drafts.summary);
      const packetSummary = getAdOsRecord(packets.summary);
      const gateSummary = getAdOsRecord(gate.summary);
      const jobSummary = getAdOsRecord(jobs.summary);
      const attemptSummary = getAdOsRecord(attempts.summary);
      setAutomationMessage(
        `Google safe pipeline complete: RSA sets ${formatAdOsNumber(draftSummary.rsa_sets_generated)}, packets ${formatAdOsNumber(packetSummary.packets_written)}, monitor ${formatAdOsNumber(gateSummary.monitor_only)}, draft jobs ${formatAdOsNumber(jobSummary.jobs_written)}, dry-run attempts ${formatAdOsNumber(attemptSummary.attempts_written)}, blocked ${formatAdOsNumber(Number(gateSummary.blocked || 0) + Number(jobSummary.blocked_jobs || 0) + Number(attemptSummary.blocked || 0))}. External API write 0.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google safe pipeline failed.');
    } finally {
      setActionFlag('runningGoogleSafePipeline', false);
    }
  };

  const createMetaCapiTestPacket = async () => {
    await runJsonAction({
      flag: 'creatingMetaCapiPacket',
      url: '/api/admin/ad-os/channel-adapters/meta/capi-test',
      body: {
        apply: true,
        event_name: 'Lead',
        event_id: `ad-os-capi-${Date.now()}`,
        value_krw: 0,
      },
      errorMessage: 'Meta CAPI test packet failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Meta CAPI test packet complete: ${String(summary.lifecycle_status || 'unknown')}, blocked ${String(summary.blocked_reason || 'none')}. Campaign publish remains disabled.`;
      },
    });
  };

  const runMetaCreativeSafePipeline = async () => {
    setActionFlag('runningMetaCreativeSafePipeline', true);
    setError(null);
    setAutomationMessage(null);
    try {
      const assetGroup = await postAdOsJson(
        '/api/admin/ad-os/creative-factory/asset-group',
        { apply: true, limit: 20 },
        'Meta creative asset group generation failed.',
      );
      const product = getAdOsRecord(assetGroup.product);
      const seedPacket = await postAdOsJson(
        '/api/admin/ad-os/channel-adapters/meta/creative-seed',
        {
          apply: true,
          product_id: product.id,
          creative_name: product.title ? `Meta seed: ${String(product.title).slice(0, 80)}` : 'Meta creative seed',
          landing_url: '/blog/danang-family-package',
          headline: product.title ? String(product.title).slice(0, 40) : 'Family travel comparison',
          primary_text: 'Compare itinerary, inclusions, and booking fit before inquiry.',
          call_to_action: 'LEARN_MORE',
        },
        'Meta creative seed packet failed.',
      );
      const gate = await postAdOsJson(
        '/api/admin/ad-os/channel-adapters/execution-gate',
        {
          apply: true,
          platform: 'meta',
          requested_mode: 'approve',
          human_approved: false,
          limit: 20,
        },
        'Meta creative execution gate failed.',
      );

      await refresh();
      const assetSummary = getAdOsRecord(assetGroup.summary);
      const packetSummary = getAdOsRecord(seedPacket.summary);
      const gateSummary = getAdOsRecord(gate.summary);
      setAutomationMessage(
        `Meta creative pipeline complete: intent signals ${formatAdOsNumber(assetSummary.generated_signals)}, variants ${formatAdOsNumber(assetSummary.generated_variants)}, seed ${String(packetSummary.lifecycle_status || 'unknown')}, monitor ${formatAdOsNumber(gateSummary.monitor_only)}, blocked ${formatAdOsNumber(gateSummary.blocked)}. External API write 0.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Meta creative pipeline failed.');
    } finally {
      setActionFlag('runningMetaCreativeSafePipeline', false);
    }
  };

  const checkExecutionGate = async () => {
    await runJsonAction({
      flag: 'checkingExecutionGate',
      url: '/api/admin/ad-os/channel-adapters/execution-gate',
      body: {
        apply: true,
        platform: 'naver',
        requested_mode: 'limited_autopilot',
        human_approved: false,
        limit: 20,
      },
      errorMessage: 'Execution gate check failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Execution gate check complete: eligible ${formatAdOsNumber(summary.eligible)}, blocked ${formatAdOsNumber(summary.blocked)}, high risk ${formatAdOsNumber(summary.high_or_critical_risk)}. External API write 0.`;
      },
    });
  };

  const checkGoogleDraftGate = async () => {
    await runJsonAction({
      flag: 'checkingGoogleDraftGate',
      url: '/api/admin/ad-os/channel-adapters/execution-gate',
      body: {
        apply: true,
        platform: 'google',
        requested_mode: 'approve',
        human_approved: false,
        limit: 20,
      },
      errorMessage: 'Google draft gate check failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Google draft gate complete: monitor ${formatAdOsNumber(summary.monitor_only)}, blocked ${formatAdOsNumber(summary.blocked)}, high risk ${formatAdOsNumber(summary.high_or_critical_risk)}. Live publish disabled.`;
      },
    });
  };

  const runRollbackDrill = async () => {
    await runJsonAction<{
      summary?: {
          rollback_ready?: unknown;
          blocked?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'runningRollbackDrill',
      url: '/api/admin/ad-os/channel-adapters/rollback-drill',
      body: { apply: true },
      errorMessage: 'Rollback drill failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Rollback drill complete: ready ${formatAdOsNumber(summary?.rollback_ready)}, blocked ${formatAdOsNumber(summary?.blocked)}. Rollback and recovery writes remain gated.`;
      },
    });
  };

  const runNaverLimitedPilot = async () => {
    await runJsonAction({
      flag: 'runningLimitedPilot',
      url: '/api/admin/ad-os/channel-adapters/naver/limited-pilot',
      body: {
        apply: true,
        ensure_policy: true,
        requested_mode: 'dry_run',
        limit: 20,
      },
      errorMessage: 'Naver limited pilot failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Naver limited pilot complete: dry-run succeeded ${formatAdOsNumber(summary.dry_run_succeeded)}, blocked ${formatAdOsNumber(summary.blocked)}, live blocked ${formatAdOsNumber(summary.live_write_blocked)}. External API write 0.`;
      },
    });
  };

  const createAssetGroup = async () => {
    await runJsonAction<{
      summary?: {
          generated_signals?: unknown;
          generated_variants?: unknown;
      };
    } & Record<string, unknown>>({
      flag: 'creatingAssetGroup',
      url: '/api/admin/ad-os/creative-factory/asset-group',
      body: { apply: true, limit: 20 },
      errorMessage: 'Creative asset group generation failed.',
      successMessage: (json) => {
        const summary = json.summary;
        return `Creative asset group generated: intent signals ${formatAdOsNumber(summary?.generated_signals)}, variants ${formatAdOsNumber(summary?.generated_variants)}. Draft-only creative assets.`;
      },
    });
  };

  const saveTenantWorkspaceDefaults = async () => {
    await runJsonAction({
      flag: 'savingTenantWorkspace',
      url: '/api/admin/ad-os/tenant-workspaces',
      body: {
        billing_plan: 'agency',
        monthly_budget_cap_krw: summary?.tenant_policy?.monthly_budget_cap_krw || 3000000,
        daily_budget_cap_krw: summary?.tenant_policy?.daily_budget_cap_krw || 100000,
        max_cpc_krw: summary?.tenant_policy?.max_cpc_krw || 800,
        automation_level: Math.min(Number(summary?.tenant_policy?.max_automation_level || 2), 3),
      },
      errorMessage: 'Tenant workspace defaults failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Tenant workspace defaults saved: plan ${String(summary.billing_plan || 'agency')}, automation L${String(summary.automation_level || '2')}, human approval ${summary.require_human_approval ? 'on' : 'off'}, full auto ${summary.full_auto_enabled ? 'on' : 'off'}.`;
      },
    });
  };

  const updateChangeRequest = async (id: string, status: 'approved' | 'rejected' | 'applied' | 'rolled_back') => {
    await runChangeRequestAction({
      activeId: id,
      url: '/api/admin/ad-os/change-requests',
      method: 'PATCH',
      body: { id, status },
      errorMessage: 'Change request update failed.',
      successMessage:
        status === 'approved'
          ? 'Change request approved.'
          : status === 'applied'
            ? 'Change request applied.'
            : status === 'rolled_back'
              ? 'Change request rolled back.'
              : 'Change request rejected.',
    });
  };

  const completionPanelRequested = searchParams.get('panel') === 'completion-audit';

  useEffect(() => {
    if (!completionPanelRequested || !summary) return;
    const target = document.getElementById('completion-audit');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [completionPanelRequested, summary]);

  const totalMappingStatus = getTotalMappingStatus(summary);
  const completionDrilldown = getCompletionDrilldown(summary);
  const launchSteps = buildLaunchSteps(summary);
  const launchWizardSteps = buildLaunchWizardSteps(summary);
  const executionStateEntries = getExecutionStateEntries(summary);
  const activeModeByPlatform = getActiveModeByPlatform(summary);
  const { tenantReportBody, tenantReportPeriod } = getTenantReportView(tenantReport);
  const actionHandlers: LaunchActionHandlers = {
    refresh,
    runPilotSetup,
    createNaverAssets,
    generateNaverSetupPacket,
    syncNaverAssets,
    probePublisher,
    generateCandidates,
    runKeywordBrain,
    harvestLearning,
    runConversionAttribution,
    runLaunchAudit,
    runKillSwitchDryRun,
  };
  const actionLoading: LaunchActionLoading = {
    refresh: loading,
    runPilotSetup: runningPilotSetup,
    createNaverAssets: creatingNaverAssets,
    generateNaverSetupPacket: generatingNaverPacket,
    syncNaverAssets: syncingNaverAssets,
    probePublisher: probingPublisher,
    generateCandidates: generatingCandidates,
    runKeywordBrain: runningKeywordBrain,
    harvestLearning: harvestingLearning,
    runConversionAttribution: runningConversionAttribution,
    runLaunchAudit: runningLaunchAudit,
    runKillSwitchDryRun: runningKillSwitch,
  };
  const budgetOperationActions: BudgetOperationActionHandlers = {
    saveBudgets,
    generateCandidates,
    runDryRun,
    runLaunchAudit,
    probePublisher,
    runGuardedApply,
    runPilotSetup,
    publishDrafts,
    publishNaverPausedKeywords,
    activateNaverPausedKeywords,
    approveNaverCandidates,
    probeNaverAdgroups,
    probeNaverAssets,
    syncNaverAssets,
    harvestLearning,
    harvestSearchTerms,
    syncPerformanceFacts,
    runConversionAttribution,
    applyLearningRules,
    planExperiments,
    optimizePerformance,
    dryRunExternalPublish,
    probeGooglePublisher,
    runBudgetPacing,
    runOptimizationSafePipeline,
    loadTenantReport,
    buildOpsPlan,
    runKeywordBrain,
    createNaverAssets,
    executeNaverGate,
    exportGoogleConversions,
    exportMetaConversions,
    runBidOptimizer,
    runExperimentRunner,
    applyBlogEvolution,
    createCreativeDrafts,
    syncBookingFunnel,
    runExpiryCleanup,
    runKillSwitchDryRun,
  };
  const budgetOperationLoading: BudgetOperationActionLoading = {
    saveBudgets: savingBudget,
    generateCandidates: generatingCandidates,
    runDryRun: runningAutomation,
    runLaunchAudit: runningLaunchAudit,
    probePublisher: probingPublisher,
    runGuardedApply: runningGuardedApply,
    runPilotSetup: runningPilotSetup,
    publishDrafts: publishingDrafts,
    publishNaverPausedKeywords: publishingNaverKeywords,
    activateNaverPausedKeywords: activatingNaverKeywords,
    approveNaverCandidates: approvingNaverCandidates,
    probeNaverAdgroups: probingNaverAdgroups,
    probeNaverAssets: probingNaverAssets,
    syncNaverAssets: syncingNaverAssets,
    harvestLearning: harvestingLearning,
    harvestSearchTerms: harvestingSearchTerms,
    syncPerformanceFacts: syncingPerformance,
    runConversionAttribution: runningConversionAttribution,
    applyLearningRules: applyingLearning,
    planExperiments: planningExperiments,
    optimizePerformance: optimizingPerformance,
    dryRunExternalPublish: publishingExternal,
    probeGooglePublisher: probingGooglePublisher,
    runBudgetPacing: runningBudgetPacing,
    runOptimizationSafePipeline: runningOptimizationSafePipeline,
    loadTenantReport: loadingTenantReport,
    buildOpsPlan: buildingOpsPlan,
    runKeywordBrain: runningKeywordBrain,
    createNaverAssets: creatingNaverAssets,
    executeNaverGate: executingNaverGate,
    exportGoogleConversions: exportingGoogleConversions,
    exportMetaConversions: exportingMetaConversions,
    runBidOptimizer: runningBidOptimizer,
    runExperimentRunner: runningExperiments,
    applyBlogEvolution: applyingBlogEvolution,
    createCreativeDrafts: creatingCreativeDrafts,
    syncBookingFunnel: syncingBookingFunnel,
    runExpiryCleanup: runningExpiryCleanup,
    runKillSwitchDryRun: runningKillSwitch,
  };
  const enterpriseRuntimeActions: EnterpriseRuntimeActionHandlers = {
    runRuntimeReadiness,
    checkChannelAdapters,
    createNaverPausedKeywordPacket,
    createGoogleDraftPacket,
    createGoogleRsaDrafts,
    createGoogleDraftFromRsa,
    createGoogleDraftJobs,
    runGoogleSafePipeline,
    createMetaCapiTestPacket,
    runMetaCreativeSafePipeline,
    checkExecutionGate,
    checkGoogleDraftGate,
    runRollbackDrill,
    runNaverLimitedPilot,
    runPlatformJobs,
    executePlatformJobsDryRun,
    runConversionUploadJobs,
    executeConversionUploadsDryRun,
    runConversionSafePipeline,
    loadDataQuality,
    runPortfolioPlan,
    applyApprovedPortfolio,
    createAssetGroup,
    saveTenantWorkspaceDefaults,
    standardizeExperimentTemplates,
    createTenantAuditExport,
  };
  const enterpriseRuntimeLoading: EnterpriseRuntimeActionLoading = {
    runRuntimeReadiness: checkingRuntimeReadiness,
    checkChannelAdapters: checkingChannelAdapters,
    createNaverPausedKeywordPacket: creatingNaverAdapterPacket,
    createGoogleDraftPacket: creatingGoogleDraftPacket,
    createGoogleRsaDrafts: creatingGoogleRsaDrafts,
    createGoogleDraftFromRsa: creatingGoogleDraftFromRsa,
    createGoogleDraftJobs: creatingGoogleDraftJobs,
    runGoogleSafePipeline: runningGoogleSafePipeline,
    createMetaCapiTestPacket: creatingMetaCapiPacket,
    runMetaCreativeSafePipeline: runningMetaCreativeSafePipeline,
    checkExecutionGate: checkingExecutionGate,
    checkGoogleDraftGate: checkingGoogleDraftGate,
    runRollbackDrill: runningRollbackDrill,
    runNaverLimitedPilot: runningLimitedPilot,
    runPlatformJobs: runningPlatformJobs,
    executePlatformJobsDryRun: executingPlatformDryRun,
    runConversionUploadJobs: runningConversionUpload,
    executeConversionUploadsDryRun: executingConversionDryRun,
    runConversionSafePipeline: runningConversionSafePipeline,
    loadDataQuality: loadingDataQuality,
    runPortfolioPlan: planningPortfolio,
    applyApprovedPortfolio: applyingPortfolio,
    createAssetGroup: creatingAssetGroup,
    saveTenantWorkspaceDefaults: savingTenantWorkspace,
    standardizeExperimentTemplates: standardizingExperiments,
    createTenantAuditExport: creatingTenantAuditExport,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ad OS"
        subtitle="Travel ad operations hub for products, keywords, content, budgets, approvals, and automation."
        actions={
          <>
            <Link href="/admin/search-ads">
              <Button variant="secondary" size="sm">
                <Search size={14} />
                Search ads
              </Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={runSeoKeywordBridge} disabled={runningSeoKeywordBridge}>
              <Search size={14} />
              {runningSeoKeywordBridge ? 'SEO bridge...' : 'SEO→Ads drafts'}
            </Button>
            <Button variant="secondary" size="sm" onClick={runSearchTermGrowth} disabled={runningSearchTermGrowth}>
              <Search size={14} />
              {runningSearchTermGrowth ? 'Search terms...' : 'Terms->Ads drafts'}
            </Button>
            <Link href="/admin/blog/ads">
              <Button variant="secondary" size="sm">
                <Layers size={14} />
                Blog mapping
              </Button>
            </Link>
            <Link href="/admin/marketing/card-news">
              <Button variant="secondary" size="sm">
                <Rocket size={14} />
                Card news
              </Button>
            </Link>
          </>
        }
      />

      {loading && <div className="admin-card p-5 text-admin-sm text-admin-muted">Loading Ad OS status.</div>}
      {error && (
        <div className="rounded-admin-md border border-rose-200 bg-rose-50 p-4 text-admin-sm text-rose-700">
          {error}
        </div>
      )}
      {automationMessage && (
        <div className="rounded-admin-md border border-emerald-200 bg-emerald-50 p-4 text-admin-sm text-emerald-700">
          {automationMessage}
        </div>
      )}

      {summary && (
        <>
          <LaunchActionQueuePanel
            actions={summary.launch_action_queue || []}
            actionHandlers={actionHandlers}
            actionLoading={actionLoading}
            naverSetupPacket={naverSetupPacket}
            onDownloadNaverKeywordCsv={downloadNaverKeywordCsv}
            onCopyNaverKeywordCsv={copyNaverKeywordCsv}
          />

          <LaunchWizardPanel
            launchSteps={launchSteps}
            launchWizardSteps={launchWizardSteps}
            externalLaunchStatus={summary.external_launch_status}
            onRunPilotSetup={runPilotSetup}
            runningPilotSetup={runningPilotSetup}
            onRunLaunchAudit={runLaunchAudit}
            runningLaunchAudit={runningLaunchAudit}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <CompletionAuditPanel
              completionAudit={summary.enterprise_layer?.completion_audit}
              completionDrilldown={completionDrilldown}
              highlighted={completionPanelRequested}
              stagingSmoke={stagingSmoke}
              checkingStagingSmoke={checkingStagingSmoke}
              onRunStagingSmoke={runStagingSmoke}
            />
            <AdminSurfaceQaPanel
              adminSurfaceQa={adminSurfaceQa}
              checking={checkingAdminSurfaceQa}
              onRefresh={runAdminSurfaceQa}
            />
            <StagingValidationPanel
              stagingValidation={stagingValidation}
              checking={checkingStagingValidation}
              onRefresh={runStagingValidation}
            />
            <OperatingInventoryPanel
              operatingInventory={operatingInventory}
              checking={checkingOperatingInventory}
              onRefresh={runOperatingInventory}
            />
          </div>

          <BudgetOperationsPanel
            budgets={budgetDrafts}
            onBudgetChange={updateBudgetDraft}
            actions={budgetOperationActions}
            loading={budgetOperationLoading}
            tenantReportBody={tenantReportBody}
            tenantReportPeriod={tenantReportPeriod}
            launchAudit={launchAudit}
            opsPlan={opsPlan}
            keywordBrainResult={keywordBrainResult}
            naverAssetPlan={naverAssetPlan}
          />

          <EnterpriseRuntimePanel
            summary={summary}
            actions={enterpriseRuntimeActions}
            loading={enterpriseRuntimeLoading}
            opsQueueActionId={opsQueueActionId}
            onOpsQueueAction={runOpsQueueAction}
          />

          <ChannelExecutionStatePanel
            entries={executionStateEntries}
            activeModeByPlatform={activeModeByPlatform}
          />

          <AutomationPolicyPanel
            automationModes={summary.automation_modes}
            tenantGuardrails={summary.tenant_guardrails}
            tenantAdReadiness={summary.tenant_ad_readiness}
          />

          <TenantSafetyPolicyPanel
            policy={summary.tenant_policy}
            draft={tenantPolicyDraft}
            saving={savingTenantPolicy}
            onSave={saveTenantPolicy}
            onUpdate={updateTenantPolicyDraft}
            onTogglePlatform={toggleTenantPlatform}
          />

          {summary.learning_loop && <LearningLoopPanel learningLoop={summary.learning_loop} />}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <MappingStatusDistributionPanel mappingsByStatus={summary.counts.mappings_by_status} total={totalMappingStatus} />
            <LearningSignalsPanel count={summary.kpis.learning_events || 0} rows={summary.samples.learning_events} />
            <ProductScenariosPanel count={summary.kpis.product_scenarios || 0} rows={summary.samples.product_scenarios || []} />
            <LandingEvolutionPanel count={summary.kpis.landing_evolution_candidates || 0} rows={summary.samples.landing_evolution_queue || []} />
            <ChangeRequestsPanel
              count={summary.kpis.change_requests_proposed || 0}
              rows={summary.samples.change_requests || []}
              loadingId={changeRequestActionId}
              onUpdate={updateChangeRequest}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <MappingSamplesPanel rows={summary.samples.mappings} />
            <KeywordPlansPanel rows={summary.samples.keyword_plans} loadingId={keywordActionId} onUpdate={updateKeywordPlan} />
            <RecentDecisionsPanel rows={summary.recent_decisions} />
          </div>

          <OperatingModesPanel />
        </>
      )}
    </div>
  );
}
