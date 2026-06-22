'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
  getAdOsAgentOperatingModel,
  getActiveModeByPlatform,
  getBeginnerAdOpsModel,
  getCompletionDrilldown,
  getExecutionStateEntries,
  getTenantReportView,
  getTotalMappingStatus,
} from './_lib/view-model';
import { AiAdTeamPanel } from './_components/AiAdTeamPanel';
import {
  AdOsWorkspaceTabs,
  parseAdOsWorkspaceTab,
  type AdOsWorkspaceTab,
} from './_components/AdOsWorkspaceTabs';
import { AdminSurfaceQaPanel } from './_components/AdminSurfaceQaPanel';
import { AutomationPolicyPanel } from './_components/AutomationPolicyPanel';
import { BudgetOperationsPanel } from './_components/BudgetOperationsPanel';
import {
  type BudgetOperationActionHandlers,
  type BudgetOperationActionLoading,
} from './_components/BudgetOperationActionBar';
import { BeginnerAdOpsPanel } from './_components/BeginnerAdOpsPanel';
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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdOsWorkspaceTab>(() => parseAdOsWorkspaceTab(searchParams.get('tab')));
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
    standardizingExperiments, creatingTenantAuditExport, checkingChannelAdapters, checkingCredentialPreflight, creatingNaverAdapterPacket, creatingGoogleDraftPacket,
    creatingGoogleRsaDrafts, creatingGoogleDraftFromRsa, creatingGoogleDraftJobs, runningGoogleSafePipeline, creatingMetaCapiPacket, runningMetaCreativeSafePipeline, checkingExecutionGate, checkingGoogleDraftGate, checkingNaverLivePreflight, runningRollbackDrill, runningLimitedPilot, checkingStagingSmoke,
    checkingOperatingInventory, checkingStagingValidation, checkingAdminSurfaceQa, runningAgentDiagnosis, savingCampaignMemory,
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
  const [opsFailureTarget, setOpsFailureTarget] = useState<Record<string, unknown> | null>(null);
  const opsFailureCancelRef = useRef<HTMLButtonElement | null>(null);

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
      onNonBlockingError: (err) => {
        console.warn('[ad-os] initial readiness panel load failed', err);
      },
    })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Ad OS readiness panels load failed.');
      })
    return () => {
      alive = false;
    };
  }, [setAdminSurfaceQa, setError, setOperatingInventory, setStagingSmoke, setStagingValidation]);

  useEffect(() => {
    if (!opsFailureTarget) return;
    requestAnimationFrame(() => opsFailureCancelRef.current?.focus());
  }, [opsFailureTarget]);

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

  const createPipelineAuditExportDraft = async () => {
    const audit = await postAdOsJson(
      '/api/admin/ad-os/tenant-audit-export',
      { apply: true },
      'Tenant audit export failed.',
    );
    return getAdOsRecord(audit.summary);
  };

  const runStagingSmoke = async () => {
    await runReadinessCheck({
      flag: 'checkingStagingSmoke',
      fetchResult: fetchStagingSmoke,
      onSuccess: setStagingSmoke,
      errorMessage: 'Staging smoke check failed.',
      successMessage: (json) => (
        json.ok
          ? `사전 안전 점검 완료: 통과 ${formatAdOsNumber(json.smoke.passed_assertions)}개, 실패 ${formatAdOsNumber(json.smoke.failed_assertions)}개, 외부 반영 ${json.safety.external_api_write ? '있음' : '없음'}.`
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
      errorMessage: '관리자 화면 QA에 실패했습니다.',
      successMessage: (json) => (
        json.qa.status === 'pass'
          ? `관리자 화면 QA 통과: 통과 ${formatAdOsNumber(json.qa.passed)}개, 주의 ${formatAdOsNumber(json.qa.warnings)}개, 실패 ${formatAdOsNumber(json.qa.failed)}개.`
          : `관리자 화면 QA 확인 필요: ${json.qa.top_gap || '검토 필요'}. 다음 조치: ${json.qa.next_action}`
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
        return `네이버 정지 키워드 사전 점검 완료: 확인 ${formatAdOsNumber(summary.checked_keywords)}개, 가능 ${formatAdOsNumber(summary.eligible_keywords)}개, 막힘 ${formatAdOsNumber(summary.blocked_keywords)}개. 실제 광고비 사용 없음.`;
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
      setAutomationMessage('네이버 키워드 CSV를 클립보드에 복사했습니다.');
    } catch {
      setAutomationMessage('클립보드 복사가 차단되었습니다. CSV 내용을 직접 선택해 복사하세요.');
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
    setAutomationMessage('네이버 키워드 CSV 다운로드를 시작했습니다.');
  };

  const harvestLearning = async () => {
    await runJsonAction({
      flag: 'harvestingLearning',
      url: '/api/admin/ad-os/learning-harvest',
      body: { mode: 'guarded', apply: true, days: 30 },
      errorMessage: '학습 데이터 수집에 실패했습니다.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `학습 데이터 수집 완료: 학습 이벤트 ${formatAdOsNumber(summary.learning_events)}개, 검색어 후보 ${formatAdOsNumber(summary.search_term_candidates)}개, 추가 키워드 후보 ${formatAdOsNumber(summary.add_keyword_candidates)}개, 제외 키워드 후보 ${formatAdOsNumber(summary.add_negative_candidates)}개.`;
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
        return `네이버 정지 키워드 활성화 점검 완료: 확인 ${formatAdOsNumber(summary.checked_keywords)}개, 승인 요청 ${formatAdOsNumber(summary.approved_activation_requests)}개, 활성 준비 ${formatAdOsNumber(summary.activated_keywords)}개. 실제 반영은 안전장치로 막혀 있습니다.`;
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
      errorMessage: '학습 규칙 적용에 실패했습니다.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `학습 규칙 적용 완료: 변경 요청 ${formatAdOsNumber(summary.change_requests_inserted)}개, 중지 후보 ${formatAdOsNumber(summary.pause_candidates)}개, 랜딩 개선 후보 ${formatAdOsNumber(summary.landing_candidates)}개, 확장 후보 ${formatAdOsNumber(summary.expansion_candidates)}개.`;
      },
    });
  };

  const dryRunExternalPublish = async () => {
    await runJsonAction({
      flag: 'publishingExternal',
      url: '/api/admin/ad-os/external-publish',
      body: { platform: 'naver', mode: 'dry_run', apply: false },
      errorMessage: '외부 반영 사전 점검에 실패했습니다.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        const channelState = getAdOsRecord(summary.channel_state);
        return `외부 반영 사전 점검 완료: ${String(channelState.label || '채널 점검')}, 승인 요청 ${formatAdOsNumber(summary.approved_requests)}개, 외부 API 쓰기 ${summary.external_api_write ? '있음' : '없음'}.`;
      },
    });
  };

  const runBudgetPacing = async () => {
    await runJsonAction({
      flag: 'runningBudgetPacing',
      url: '/api/admin/ad-os/budget-pacing',
      body: { mode: 'dry_run' },
      errorMessage: '예산 속도 점검에 실패했습니다.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `예산 속도 사전 점검 완료: 채널 ${formatAdOsNumber(summary.checked_channels)}개, 초과 속도 ${formatAdOsNumber(summary.over_pacing)}개, 부족 속도 ${formatAdOsNumber(summary.under_pacing)}개, 손실 한도 근접 ${formatAdOsNumber(summary.loss_limit_near)}개, 차단 ${formatAdOsNumber(summary.blocked)}개.`;
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
        '예산 속도 점검에 실패했습니다.',
      );
      const audit = await createPipelineAuditExportDraft();

      await refresh();
      const performanceSummary = getAdOsRecord(performance.summary);
      const attributionSummary = getAdOsRecord(attribution.summary);
      const bidSummary = getAdOsRecord(bidOptimizer.summary);
      const portfolioSummary = getAdOsRecord(portfolio.summary);
      const pacingSummary = getAdOsRecord(pacing.summary);
      setAutomationMessage(
        `최적화 안전 점검 완료: 성과 근거 ${formatAdOsNumber(performanceSummary.facts_prepared)}개, 전환 귀속 ${formatAdOsNumber(attributionSummary.conversions)}개, 입찰 후보 ${formatAdOsNumber(bidSummary.candidates)}개, 포트폴리오 계획 ${formatAdOsNumber(portfolioSummary.inserted)}개, 예산 페이싱 ${formatAdOsNumber(pacingSummary.checked_channels)}개 채널 확인. 실제 광고비 사용 없음.`,
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
        return `긴급 중지 사전 점검 완료: 활성 예산 채널 ${formatAdOsNumber(summary.active_budget_channels)}개, 키워드 대상 ${formatAdOsNumber(summary.keyword_targets)}개, 매핑 대상 ${formatAdOsNumber(summary.mapping_targets)}개. 실제 광고비 사용 없음.`;
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
      errorMessage: '키워드 브레인 실행에 실패했습니다.',
      onSuccess: setKeywordBrainResult,
      successMessage: (json) => {
        const summary = json.summary as {
          candidates?: unknown;
          inserted_clusters?: unknown;
          inserted_keyword_plans?: unknown;
        } | undefined;
        return `키워드 브레인 완료: 후보 ${formatAdOsNumber(summary?.candidates)}개, 묶음 ${formatAdOsNumber(summary?.inserted_clusters)}개, 키워드 초안 ${formatAdOsNumber(summary?.inserted_keyword_plans)}개. 실제 광고비 0원.`;
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
      errorMessage: 'SEO 기반 광고 키워드 생성에 실패했습니다.',
      onSuccess: setKeywordBrainResult,
      successMessage: (json) => {
        const summary = json.summary as {
          candidate_keyword_plans?: unknown;
          inserted_keyword_plans?: unknown;
          inserted_negative_candidates?: unknown;
        } | undefined;
        return `SEO 기반 광고 키워드 생성 완료: 후보 ${formatAdOsNumber(summary?.candidate_keyword_plans)}개, 키워드 초안 ${formatAdOsNumber(summary?.inserted_keyword_plans)}개, 제외 후보 ${formatAdOsNumber(summary?.inserted_negative_candidates)}개. 실제 광고비 사용 0원.`;
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
      errorMessage: '검색어 기반 광고 초안 생성에 실패했습니다.',
      onSuccess: setKeywordBrainResult,
      successMessage: (json) => {
        const summary = json.summary as {
          keyword_drafts?: unknown;
          negative_drafts?: unknown;
          inserted_keyword_plans?: unknown;
          inserted_change_requests?: unknown;
        } | undefined;
        return `검색어 기반 광고 초안 생성 완료: 키워드 초안 ${formatAdOsNumber(summary?.keyword_drafts)}개, 제외 초안 ${formatAdOsNumber(summary?.negative_drafts)}개, 저장 ${formatAdOsNumber(summary?.inserted_keyword_plans)}개, 승인 요청 ${formatAdOsNumber(summary?.inserted_change_requests)}개. 실제 광고비 사용 0원.`;
      },
    });
  };

  const runAgentDiagnosis = async () => {
    await runJsonAction<{
      summary?: {
        pipeline_steps?: unknown;
        failed_steps?: unknown;
        roas_score?: unknown;
        team_score?: unknown;
      };
      memory_id?: unknown;
    } & Record<string, unknown>>({
      flag: 'runningAgentDiagnosis',
      url: '/api/admin/ad-os/agent-diagnostics',
      body: { run_pipeline: true, persist_memory: true },
      errorMessage: 'AI 광고팀 진단에 실패했습니다.',
      successMessage: (json) => {
        const summary = json.summary || {};
        return `AI 광고팀 진단 완료: 확인 ${formatAdOsNumber(summary.pipeline_steps)}개, 실패 ${formatAdOsNumber(summary.failed_steps)}개, ROAS 점수 ${formatAdOsNumber(summary.roas_score)}%, 팀 점수 ${formatAdOsNumber(summary.team_score)}%. 실제 광고비 사용 없음.`;
      },
    });
  };

  const saveCampaignMemory = async () => {
    await runJsonAction<{
      summary?: {
        roas_score?: unknown;
        team_score?: unknown;
      };
      memory_id?: unknown;
      memory_created?: unknown;
    } & Record<string, unknown>>({
      flag: 'savingCampaignMemory',
      url: '/api/admin/ad-os/agent-diagnostics',
      body: { run_pipeline: false, persist_memory: true },
      errorMessage: '캠페인 메모리 저장에 실패했습니다.',
      successMessage: (json) => {
        const summary = json.summary || {};
        return `캠페인 메모리 ${json.memory_created ? '생성' : '갱신'} 완료: ROAS 점수 ${formatAdOsNumber(summary.roas_score)}%, 팀 점수 ${formatAdOsNumber(summary.team_score)}%.`;
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
        return `네이버 실행 조건 점검 완료: 요청 ${formatAdOsNumber(summary?.requested)}개, 계획 ${formatAdOsNumber(summary?.planned)}개, 막힘 ${formatAdOsNumber(summary?.blocked)}개. 실제 광고비 사용 없음.`;
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
        return `플랫폼 작업 준비 완료: 작업 ${formatAdOsNumber(summary?.jobs)}개, 막힘 ${formatAdOsNumber(summary?.blocked)}개, 승인/준비 ${formatAdOsNumber(summary?.approved)}개. 실제 광고비 사용 없음.`;
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
      const audit = await createPipelineAuditExportDraft();

      await refresh();
      const googleJobSummary = getAdOsRecord(googleJobs.summary);
      const metaJobSummary = getAdOsRecord(metaJobs.summary);
      const googleDryRunSummary = getAdOsRecord(googleDryRun.summary);
      const metaDryRunSummary = getAdOsRecord(metaDryRun.summary);
      const dataQualitySummary = getAdOsRecord(dataQuality.summary);
      setAutomationMessage(
        `Conversion safe pipeline complete: Google jobs ${formatAdOsNumber(googleJobSummary.jobs_written)}, Meta jobs ${formatAdOsNumber(metaJobSummary.jobs_written)}, dry-run ready ${formatAdOsNumber(Number(googleDryRunSummary.upload_ready_dry_run || 0) + Number(metaDryRunSummary.upload_ready_dry_run || 0))}, blocked ${formatAdOsNumber(Number(googleJobSummary.blocked || 0) + Number(metaJobSummary.blocked || 0) + Number(googleDryRunSummary.blocked || 0) + Number(metaDryRunSummary.blocked || 0))}, quality ${String(dataQualitySummary.status || 'unknown')}, audit ${String(audit.export_status || 'blocked')} ${formatAdOsNumber(audit.written)}. External upload 0.`,
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
        return `승인된 포트폴리오 반영 요청 완료: 승인 계획 ${formatAdOsNumber(summary?.approved_plans)}개, 변경 요청 ${formatAdOsNumber(summary?.inserted)}개. 실제 광고비 사용 없음.`;
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
          errorMessage: '실행 준비 점검에 실패했습니다.',
      successMessage: (json) => {
        const summary = json.summary;
        return `실행 준비 점검 완료: 준비 테이블 ${formatAdOsNumber(summary?.tables_ready)}/${formatAdOsNumber(summary?.tables_total)}, 완전 자동 ${formatAdOsNumber(summary?.full_auto_enabled)}개, 외부 반영 ${formatAdOsNumber(summary?.external_api_write_count)}건.`;
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
        return `플랫폼 실행 사전 점검 완료: 성공 ${formatAdOsNumber(summary?.succeeded)}개, 막힘 ${formatAdOsNumber(summary?.blocked)}개. 실제 광고비 사용 없음.`;
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
    options: { skipConfirm?: boolean } = {},
  ) => {
    const source = String(row.source || '');
    const id = String(row.id || '');
    if (!source || !id) return;
    if (action === 'confirm_failed' && !options.skipConfirm) {
      setOpsFailureTarget(row);
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
      errorMessage: '운영 대기열 작업에 실패했습니다.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        const blockedReason = summary.blocked_reason ? ` / 차단 사유: ${String(summary.blocked_reason)}` : '';
        const label =
          action === 'executor_dry_run'
            ? '행 사전 점검'
            : action === 'confirm_failed'
              ? '외부 실패 확정'
              : '차단 사유 확인';
        return `운영 대기열 ${label} 완료: ${source} ${id.slice(0, 8)}. 외부 API 쓰기 0건${blockedReason}.`;
      },
    });
  };

  const submitOpsFailureConfirmation = async () => {
    if (!opsFailureTarget) return;
    await runOpsQueueAction(opsFailureTarget, 'confirm_failed', { skipConfirm: true });
    setOpsFailureTarget(null);
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
        return `채널 연결 점검 완료: 정지 키워드 준비 ${formatAdOsNumber(summary?.paused_write_ready)}개, 초안 준비 ${formatAdOsNumber(summary?.draft_ready)}개, 막힘 ${formatAdOsNumber(summary?.blocked)}개. 실제 광고비 사용 없음.`;
      },
    });
  };

  const checkCredentialPreflight = async () => {
    await runJsonAction({
      flag: 'checkingCredentialPreflight',
      url: '/api/admin/ad-os/credential-preflight',
      body: { apply: true },
      errorMessage: 'Credential preflight failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        return `Credential preflight complete: ready ${formatAdOsNumber(summary.ready)}, partial ${formatAdOsNumber(summary.partial)}, missing ${formatAdOsNumber(summary.missing)}, live-write safe ${summary.live_write_safe ? 'yes' : 'no'}. Secret values exposed 0.`;
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
        return `네이버 정지 키워드 패킷 완료: 상태 ${String(summary.lifecycle_status || '미확인')}, 막힌 이유 ${String(summary.blocked_reason || '없음')}. 실제 광고비 사용 없음.`;
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
        return `구글 검색광고 문안 완료: 세트 ${formatAdOsNumber(summary.rsa_sets_generated)}개, 변형 ${formatAdOsNumber(summary.variants_inserted)}개, 승인 요청 ${formatAdOsNumber(summary.change_requests_created)}개. 실제 광고비 사용 없음.`;
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
        return `구글 문안 패킷 완료: 준비 ${formatAdOsNumber(summary.packets_prepared)}개, 저장 ${formatAdOsNumber(summary.packets_written)}개, 막힘 ${formatAdOsNumber(summary.blocked_packets)}개. 실제 광고비 사용 없음.`;
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
        return `구글 초안 작업 완료: 준비 ${formatAdOsNumber(summary.jobs_prepared)}개, 저장 ${formatAdOsNumber(summary.jobs_written)}개, 승인 ${formatAdOsNumber(summary.approved_jobs)}개, 막힘 ${formatAdOsNumber(summary.blocked_jobs)}개. 실제 광고비 사용 없음.`;
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
      const audit = await createPipelineAuditExportDraft();

      await refresh();
      const draftSummary = getAdOsRecord(drafts.summary);
      const packetSummary = getAdOsRecord(packets.summary);
      const gateSummary = getAdOsRecord(gate.summary);
      const jobSummary = getAdOsRecord(jobs.summary);
      const attemptSummary = getAdOsRecord(attempts.summary);
      setAutomationMessage(
        `구글 안전 파이프라인 완료: 문안 세트 ${formatAdOsNumber(draftSummary.rsa_sets_generated)}개, 패킷 ${formatAdOsNumber(packetSummary.packets_written)}개, 모니터 ${formatAdOsNumber(gateSummary.monitor_only)}개, 초안 작업 ${formatAdOsNumber(jobSummary.jobs_written)}개, 사전 점검 ${formatAdOsNumber(attemptSummary.attempts_written)}개, 막힘 ${formatAdOsNumber(Number(gateSummary.blocked || 0) + Number(jobSummary.blocked_jobs || 0) + Number(attemptSummary.blocked || 0))}개. 실제 광고비 사용 없음.`,
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
      const audit = await createPipelineAuditExportDraft();

      await refresh();
      const assetSummary = getAdOsRecord(assetGroup.summary);
      const packetSummary = getAdOsRecord(seedPacket.summary);
      const gateSummary = getAdOsRecord(gate.summary);
      setAutomationMessage(
        `메타 소재 파이프라인 완료: 의도 신호 ${formatAdOsNumber(assetSummary.generated_signals)}개, 소재 변형 ${formatAdOsNumber(assetSummary.generated_variants)}개, 모니터 ${formatAdOsNumber(gateSummary.monitor_only)}개, 막힘 ${formatAdOsNumber(gateSummary.blocked)}개. 실제 광고비 사용 없음.`,
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
        return `실행 조건 점검 완료: 가능 ${formatAdOsNumber(summary.eligible)}개, 막힘 ${formatAdOsNumber(summary.blocked)}개, 고위험 ${formatAdOsNumber(summary.high_or_critical_risk)}개. 실제 광고비 사용 없음.`;
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

  const checkNaverLivePreflight = async () => {
    await runJsonAction({
      flag: 'checkingNaverLivePreflight',
      url: '/api/admin/ad-os/channel-adapters/naver/live-preflight',
      body: { apply: true, limit: 20 },
      errorMessage: 'Naver live preflight failed.',
      successMessage: (json) => {
        const summary = getAdOsRecord(json.summary);
        const blockers = Array.isArray(summary.blockers) ? summary.blockers : [];
        return `네이버 실집행 사전 점검 완료: 상태 ${String(summary.preflight_status || '미확인')}, 준비 작업 ${formatAdOsNumber(summary.ready_jobs)}개, 막힌 작업 ${formatAdOsNumber(summary.blocked_jobs)}개, 첫 막힘 ${String(blockers[0] || '없음')}. 실제 광고비 사용 없음.`;
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
        return `네이버 제한 시범 완료: 사전 점검 성공 ${formatAdOsNumber(summary.dry_run_succeeded)}개, 막힘 ${formatAdOsNumber(summary.blocked)}개, 실집행 차단 ${formatAdOsNumber(summary.live_write_blocked)}개. 실제 광고비 사용 없음.`;
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

  useEffect(() => {
    setActiveTab(parseAdOsWorkspaceTab(searchParams.get('tab')));
  }, [searchParams]);

  const selectWorkspaceTab = (tab: AdOsWorkspaceTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'run') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    const query = params.toString();
    router.replace(query ? `/admin/ad-os?${query}` : '/admin/ad-os', { scroll: false });
  };

  const totalMappingStatus = getTotalMappingStatus(summary);
  const completionDrilldown = getCompletionDrilldown(summary);
  const adOsAgentOperatingModel = getAdOsAgentOperatingModel(summary);
  const beginnerAdOpsModel = getBeginnerAdOpsModel(summary);
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
    checkCredentialPreflight,
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
    checkNaverLivePreflight,
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
    checkCredentialPreflight: checkingCredentialPreflight,
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
    checkNaverLivePreflight: checkingNaverLivePreflight,
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
        title="광고 운영센터"
        subtitle="상품, 키워드, 콘텐츠, 예산, 승인, 자동화를 한곳에서 점검하고 실행합니다."
        actions={
          <>
            <Link href="/admin/search-ads">
              <Button variant="secondary" size="sm">
                <Search size={14} />
                검색광고
              </Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={runSeoKeywordBridge} disabled={runningSeoKeywordBridge}>
              <Search size={14} />
              {runningSeoKeywordBridge ? 'SEO 연결 중...' : 'SEO 기반 초안'}
            </Button>
            <Button variant="secondary" size="sm" onClick={runSearchTermGrowth} disabled={runningSearchTermGrowth}>
              <Search size={14} />
              {runningSearchTermGrowth ? '검색어 처리 중...' : '검색어 기반 초안'}
            </Button>
            <Link href="/admin/blog/ads">
              <Button variant="secondary" size="sm">
                <Layers size={14} />
                블로그 매핑
              </Button>
            </Link>
            <Link href="/admin/marketing/card-news">
              <Button variant="secondary" size="sm">
                <Rocket size={14} />
                카드뉴스
              </Button>
            </Link>
          </>
        }
      />

      {loading && <div className="admin-card p-5 text-admin-sm text-admin-muted">광고 운영 상태를 불러오는 중입니다.</div>}
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
          {beginnerAdOpsModel && (
            <BeginnerAdOpsPanel
              model={beginnerAdOpsModel}
              actionHandlers={actionHandlers}
              actionLoading={actionLoading}
              onOpenSettings={() => selectWorkspaceTab('settings')}
              onOpenAdvanced={() => selectWorkspaceTab('advanced')}
            />
          )}

          <AdOsWorkspaceTabs activeTab={activeTab} onTabChange={selectWorkspaceTab}>
            {activeTab === 'run' && (
              <div className="space-y-4">
                <LaunchWizardPanel
                  launchSteps={launchSteps}
                  launchWizardSteps={launchWizardSteps}
                  externalLaunchStatus={summary.external_launch_status}
                  onRunPilotSetup={runPilotSetup}
                  runningPilotSetup={runningPilotSetup}
                  onRunLaunchAudit={runLaunchAudit}
                  runningLaunchAudit={runningLaunchAudit}
                />

                {adOsAgentOperatingModel && (
                  <AiAdTeamPanel
                    model={adOsAgentOperatingModel}
                    onRunDiagnosis={runAgentDiagnosis}
                    onSaveMemory={saveCampaignMemory}
                    runningDiagnosis={runningAgentDiagnosis}
                    savingMemory={savingCampaignMemory}
                  />
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-4">
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
              </div>
            )}

            {activeTab === 'report' && (
              <div className="space-y-4">
                {summary.learning_loop && <LearningLoopPanel learningLoop={summary.learning_loop} />}

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
              </div>
            )}

            {activeTab === 'advanced' && (
              <div className="space-y-4">
                <LaunchActionQueuePanel
                  actions={summary.launch_action_queue || []}
                  actionHandlers={actionHandlers}
                  actionLoading={actionLoading}
                  naverSetupPacket={naverSetupPacket}
                  onDownloadNaverKeywordCsv={downloadNaverKeywordCsv}
                  onCopyNaverKeywordCsv={copyNaverKeywordCsv}
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

                <EnterpriseRuntimePanel
                  summary={summary}
                  actions={enterpriseRuntimeActions}
                  loading={enterpriseRuntimeLoading}
                  opsQueueActionId={opsQueueActionId}
                  onOpsQueueAction={runOpsQueueAction}
                />

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <MappingSamplesPanel rows={summary.samples.mappings} />
                  <KeywordPlansPanel rows={summary.samples.keyword_plans} loadingId={keywordActionId} onUpdate={updateKeywordPlan} />
                  <RecentDecisionsPanel rows={summary.recent_decisions} />
                </div>

                <OperatingModesPanel />
              </div>
            )}
          </AdOsWorkspaceTabs>
        </>
      )}

      {opsFailureTarget && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="외부 작업 실패 확정 닫기"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setOpsFailureTarget(null)}
          />
          <div
            id="ad-os-ops-failure-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ad-os-ops-failure-confirm-title"
            aria-describedby="ad-os-ops-failure-confirm-description ad-os-ops-failure-confirm-summary"
            className="relative w-full max-w-md rounded-admin-md border border-red-100 bg-white p-5 shadow-admin-lg"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">외부 작업</p>
              <h2 id="ad-os-ops-failure-confirm-title" className="text-lg font-bold text-admin-text">
                외부 작업 실패로 확정할까요?
              </h2>
              <p id="ad-os-ops-failure-confirm-description" className="text-sm leading-6 text-admin-muted">
                외부 광고 계정의 실제 처리 결과를 확인한 뒤에만 실패로 기록하세요. 이 작업은 큐 상태와 운영 판단에 반영됩니다.
              </p>
            </div>

            <dl
              id="ad-os-ops-failure-confirm-summary"
              className="mt-4 grid grid-cols-1 gap-2 rounded-admin-sm bg-red-50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">출처</dt>
                <dd className="font-semibold text-admin-text">{String(opsFailureTarget.source || '-')}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">id</dt>
                <dd className="font-mono text-xs font-semibold text-admin-text">
                  {String(opsFailureTarget.id || '-').slice(0, 12)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">상태</dt>
                <dd className="font-semibold text-admin-text">{String(opsFailureTarget.status || '-')}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">blocked</dt>
                <dd className="max-w-[13rem] truncate font-semibold text-admin-text">
                  {String(opsFailureTarget.blocked_reason || opsFailureTarget.blocker || '-')}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={opsFailureCancelRef}
                type="button"
                onClick={() => setOpsFailureTarget(null)}
                className="rounded-admin-sm border border-admin-border bg-white px-4 py-2 text-sm font-medium text-admin-text hover:bg-admin-surface-2"
              >
                다시 확인
              </button>
              <button
                type="button"
                onClick={submitOpsFailureConfirmation}
                disabled={opsQueueActionId === `${String(opsFailureTarget.source || '')}:${String(opsFailureTarget.id || '')}:confirm_failed`}
                className="rounded-admin-sm bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {opsQueueActionId === `${String(opsFailureTarget.source || '')}:${String(opsFailureTarget.id || '')}:confirm_failed`
                  ? '처리 중...'
                  : '실패로 확정'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
