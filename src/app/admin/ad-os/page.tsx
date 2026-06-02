'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarX,
  Check,
  CheckCircle2,
  Download,
  Gauge,
  KeyRound,
  Layers,
  MousePointerClick,
  PauseCircle,
  PlayCircle,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { KpiCard, PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';

type Summary = {
  ok: boolean;
  generated_at: string;
  kpis: Record<string, number>;
  counts: Record<string, Record<string, number>>;
  channel_budgets: Array<{
    platform: string;
    configured: boolean;
    monthly_budget_krw: number;
    daily_budget_cap_krw: number;
    max_cpc_krw: number;
    max_test_loss_krw: number;
    automation_level: number;
    status: string;
    external_account_id?: string | null;
    external_campaign_id?: string | null;
    external_ad_group_id?: string | null;
    external_config_note?: string | null;
  }>;
  integration_status: Record<string, boolean>;
  integration_details: Record<string, {
    label: string;
    configured: boolean;
    required: Record<string, boolean>;
    note: string;
  }>;
  external_launch_status: Record<string, {
    ready: boolean;
    pass: number;
    total: number;
    next_action: string;
    checks: Array<{ id: string; label: string; done: boolean; next: string }>;
  }> & { approved_or_testing_keywords?: number };
  channel_execution_states?: Record<string, {
    state: 'missing_credentials' | 'integration_ready' | 'permission_denied' | 'no_campaign' | 'executable';
    label: string;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
    canSpend: boolean;
    summary: string;
    nextAction: string;
  }>;
  automation_modes?: Array<{
    id: 'recommendation' | 'approval' | 'limited_auto' | 'full_auto';
    label: string;
    levelMin: number;
    levelMax: number;
    description: string;
    allowedActions: string[];
  }>;
  active_automation_modes?: Array<{
    platform: string;
    level: number;
    mode: 'recommendation' | 'approval' | 'limited_auto' | 'full_auto';
    status: string;
  }>;
  tenant_guardrails?: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
  tenant_ad_readiness?: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
  tenant_policy?: {
    configured: boolean;
    error?: string | null;
    allowed_platforms: string[];
    monthly_budget_cap_krw: number;
    daily_budget_cap_krw: number;
    max_cpc_krw: number;
    max_test_loss_krw: number;
    max_automation_level: number;
    require_human_approval: boolean;
    full_auto_enabled: boolean;
    risk_status: string;
  };
  learning_loop?: {
    scope: string[];
    metrics: {
      clicks: number;
      cta_clicks: number;
      conversions: number;
      spend_krw: number;
      conversion_value_krw: number;
      cpa_krw: number;
      roas_pct: number;
      cta_rate_pct: number;
      conversion_rate_pct: number;
      bounce_rate_pct: number | null;
      engagement_sessions_30d: number;
      avg_time_on_page_seconds: number;
      avg_scroll_depth_pct: number;
    };
    status: Record<string, boolean>;
    next_action: string;
  };
  launch_action_queue: Array<{
    id: string;
    priority: number;
    label: string;
    description: string;
    button_label: string;
    ui_action: string;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
  }>;
  recent_decisions: Array<Record<string, unknown>>;
  readiness_audit: {
    score: number;
    maxScore: number;
    grade: string;
    summary: string;
    items: Array<{
      id: string;
      label: string;
      benchmark: string;
      status: 'pass' | 'partial' | 'fail';
      score: number;
      maxScore: number;
      evidence: string;
      nextAction: string;
    }>;
  };
  expiring_packages: Array<Record<string, unknown>>;
  samples: {
    mappings: Array<Record<string, unknown>>;
    keyword_plans: Array<Record<string, unknown>>;
    learning_events: Array<Record<string, unknown>>;
    search_term_candidates: Array<Record<string, unknown>>;
    product_scenarios: Array<Record<string, unknown>>;
    landing_evolution_queue: Array<Record<string, unknown>>;
    budget_pacing: Array<Record<string, unknown>>;
    tenant_ad_accounts: Array<Record<string, unknown>>;
    change_requests: Array<Record<string, unknown>>;
  };
  automation_ladder: Array<{ level: number; label: string; description: string }>;
};

type BudgetDraft = Summary['channel_budgets'][number];
type TenantPolicyDraft = NonNullable<Summary['tenant_policy']>;
type LaunchAudit = {
  readiness: {
    pass: number;
    warn: number;
    fail: number;
    total: number;
    today_launch_ready: boolean;
    next_action: string;
  };
  items: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    evidence: string;
    next_action: string;
  }>;
};

type NaverSetupPacket = {
  existing_assets: {
    campaigns: number;
    adgroups: number;
    channels: number;
    stored_adgroup_id: string | null;
  };
  required_external: Array<{ item: string; status: string; suggested_value: string | null }>;
  packet: {
    campaign_name: string;
    ad_group_name: string;
    daily_budget_krw: number;
    monthly_budget_krw: number;
    max_cpc_krw: number;
    landing_url: string | null;
    final_url: string | null;
    keyword_count: number;
    keyword_csv: string;
    keyword_samples: Array<{ keyword: string | null; match_type: string | null; bid_krw: number; final_url: string | null }>;
  };
  next_action: string;
};

const PLATFORM_LABEL: Record<string, string> = {
  naver: '네이버',
  google: '구글',
  meta: 'Meta',
  kakao: '카카오',
};

const STATUS_LABEL: Record<string, string> = {
  candidate: '후보',
  approved: '승인',
  testing: '테스트',
  active: '집행',
  winning: '승자',
  scaled: '확대',
  paused: '중지',
  negative: '제외',
  rejected: '폐기',
  expired: '만료',
};

function fmtWon(value: number | undefined): string {
  const v = Number(value || 0);
  if (v >= 10000) return `${Math.round(v / 10000).toLocaleString('ko-KR')}만원`;
  return `${v.toLocaleString('ko-KR')}원`;
}

function pct(value: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

async function fetchSummary(): Promise<Summary> {
  const res = await fetch('/api/admin/ad-os/summary');
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const cls =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-700'
        : tone === 'bad'
          ? 'bg-rose-50 text-rose-700'
          : 'bg-admin-surface-2 text-admin-muted';
  return <span className={`inline-flex items-center rounded-admin-xs px-2 py-0.5 text-admin-2xs font-semibold ${cls}`}>{children}</span>;
}

function readinessTone(status: 'pass' | 'partial' | 'fail'): 'good' | 'warn' | 'bad' {
  if (status === 'pass') return 'good';
  if (status === 'partial') return 'warn';
  return 'bad';
}

function auditTone(status: 'pass' | 'warn' | 'fail'): 'good' | 'warn' | 'bad' {
  if (status === 'pass') return 'good';
  if (status === 'warn') return 'warn';
  return 'bad';
}

function actionTone(tone: 'good' | 'warn' | 'bad' | 'neutral'): 'good' | 'warn' | 'bad' | 'neutral' {
  return tone;
}

export default function AdOsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [budgetDrafts, setBudgetDrafts] = useState<BudgetDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);
  const [savingTenantPolicy, setSavingTenantPolicy] = useState(false);
  const [tenantPolicyDraft, setTenantPolicyDraft] = useState<TenantPolicyDraft | null>(null);
  const [runningAutomation, setRunningAutomation] = useState(false);
  const [runningGuardedApply, setRunningGuardedApply] = useState(false);
  const [runningPilotSetup, setRunningPilotSetup] = useState(false);
  const [publishingDrafts, setPublishingDrafts] = useState(false);
  const [publishingNaverKeywords, setPublishingNaverKeywords] = useState(false);
  const [harvestingLearning, setHarvestingLearning] = useState(false);
  const [optimizingPerformance, setOptimizingPerformance] = useState(false);
  const [runningBudgetPacing, setRunningBudgetPacing] = useState(false);
  const [probingPublisher, setProbingPublisher] = useState(false);
  const [runningLaunchAudit, setRunningLaunchAudit] = useState(false);
  const [probingNaverAdgroups, setProbingNaverAdgroups] = useState(false);
  const [probingNaverAssets, setProbingNaverAssets] = useState(false);
  const [syncingNaverAssets, setSyncingNaverAssets] = useState(false);
  const [generatingNaverPacket, setGeneratingNaverPacket] = useState(false);
  const [approvingNaverCandidates, setApprovingNaverCandidates] = useState(false);
  const [runningExpiryCleanup, setRunningExpiryCleanup] = useState(false);
  const [runningKillSwitch, setRunningKillSwitch] = useState(false);
  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [syncingPerformance, setSyncingPerformance] = useState(false);
  const [applyingLearning, setApplyingLearning] = useState(false);
  const [publishingExternal, setPublishingExternal] = useState(false);
  const [harvestingSearchTerms, setHarvestingSearchTerms] = useState(false);
  const [planningExperiments, setPlanningExperiments] = useState(false);
  const [probingGooglePublisher, setProbingGooglePublisher] = useState(false);
  const [loadingTenantReport, setLoadingTenantReport] = useState(false);
  const [keywordActionId, setKeywordActionId] = useState<string | null>(null);
  const [changeRequestActionId, setChangeRequestActionId] = useState<string | null>(null);
  const [automationMessage, setAutomationMessage] = useState<string | null>(null);
  const [launchAudit, setLaunchAudit] = useState<LaunchAudit | null>(null);
  const [naverSetupPacket, setNaverSetupPacket] = useState<NaverSetupPacket | null>(null);
  const [tenantReport, setTenantReport] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchSummary()
      .then((json) => {
        if (alive) {
          setSummary(json);
          setBudgetDrafts(json.channel_budgets);
          setTenantPolicyDraft(json.tenant_policy || null);
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : '조회 실패');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = async () => {
    const next = await fetchSummary();
    setSummary(next);
    setBudgetDrafts(next.channel_budgets);
    setTenantPolicyDraft(next.tenant_policy || null);
  };

  const updateBudgetDraft = (platform: string, key: keyof BudgetDraft, value: string | number) => {
    setBudgetDrafts((prev) =>
      prev.map((budget) => {
        if (budget.platform !== platform) return budget;
        const numericKeys: Array<keyof BudgetDraft> = [
          'monthly_budget_krw',
          'daily_budget_cap_krw',
          'max_cpc_krw',
          'max_test_loss_krw',
          'automation_level',
        ];
        return {
          ...budget,
          [key]: numericKeys.includes(key) ? Number(value || 0) : value,
        };
      }),
    );
  };

  const updateTenantPolicyDraft = (key: keyof TenantPolicyDraft, value: unknown) => {
    setTenantPolicyDraft((prev) => {
      if (!prev) return prev;
      const numericKeys: Array<keyof TenantPolicyDraft> = [
        'monthly_budget_cap_krw',
        'daily_budget_cap_krw',
        'max_cpc_krw',
        'max_test_loss_krw',
        'max_automation_level',
      ];
      return {
        ...prev,
        [key]: numericKeys.includes(key) ? Number(value || 0) : value,
      };
    });
  };

  const toggleTenantPlatform = (platform: string) => {
    setTenantPolicyDraft((prev) => {
      if (!prev) return prev;
      const current = new Set(prev.allowed_platforms || []);
      if (current.has(platform)) current.delete(platform);
      else current.add(platform);
      return {
        ...prev,
        allowed_platforms: current.size > 0 ? Array.from(current) : ['naver'],
      };
    });
  };

  const saveTenantPolicy = async () => {
    if (!tenantPolicyDraft) return;
    setSavingTenantPolicy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ad-os/tenant-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tenantPolicyDraft),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '테넌트 정책 저장 실패');
      await refresh();
      setAutomationMessage('테넌트 광고 정책을 저장했습니다. 이 정책 밖에서는 자동 집행하지 않습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '테넌트 정책 저장 실패');
    } finally {
      setSavingTenantPolicy(false);
    }
  };

  const saveBudgets = async () => {
    setSavingBudget(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ad-os/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgets: budgetDrafts }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '예산 저장 실패');
      await refresh();
      setAutomationMessage('예산 가드레일을 저장했습니다. 이 한도 밖에서는 자동 집행하지 않습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '예산 저장 실패');
    } finally {
      setSavingBudget(false);
    }
  };

  const runDryRun = async () => {
    setRunningAutomation(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry_run' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '드라이런 실패');
      await refresh();
      setAutomationMessage(
        `드라이런 완료: 판단 ${json.summary.decisions.toLocaleString('ko-KR')}건, 테스트 가능 ${json.summary.start_test_candidates.toLocaleString('ko-KR')}건, 가드레일 보류 ${json.summary.blocked_by_guardrail.toLocaleString('ko-KR')}건`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '드라이런 실패');
    } finally {
      setRunningAutomation(false);
    }
  };

  const runGuardedApply = async () => {
    setRunningGuardedApply(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'guarded', apply: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '승인 후보 적용 실패');
      await refresh();
      setAutomationMessage(
        `승인 후보 적용 완료: 실제 전환 ${Number(json.summary.applied_count || 0).toLocaleString('ko-KR')}건, 테스트 가능 ${json.summary.start_test_candidates.toLocaleString('ko-KR')}건, 가드레일 보류 ${json.summary.blocked_by_guardrail.toLocaleString('ko-KR')}건`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '승인 후보 적용 실패');
    } finally {
      setRunningGuardedApply(false);
    }
  };

  const runPilotSetup = async () => {
    setRunningPilotSetup(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/pilot-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'guarded',
          apply: true,
          monthlyBudgetKrw: 100000,
          dailyBudgetKrw: 10000,
          maxCpcKrw: 500,
          keywordLimit: 20,
          draftLimit: 80,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '1단계 시범 세팅 실패');
      await refresh();
      setAutomationMessage(
        `1단계 시범 세팅 완료: 예산 채널 ${json.summary.budget_channels_configured.toLocaleString('ko-KR')}개, 네이버 승인 ${json.summary.naver_keywords_approved.toLocaleString('ko-KR')}개, 내부 캠페인 ${json.summary.internal_campaigns_created.toLocaleString('ko-KR')}개, 소재 ${json.summary.internal_creatives_created.toLocaleString('ko-KR')}개. 외부 광고비 0원.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '1단계 시범 세팅 실패');
    } finally {
      setRunningPilotSetup(false);
    }
  };

  const publishDrafts = async () => {
    setPublishingDrafts(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/publish-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'guarded', apply: true, limit: 80 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '캠페인 드래프트 생성 실패');
      await refresh();
      setAutomationMessage(
        `캠페인 드래프트 생성 완료: 생성 캠페인 ${json.summary.created_campaigns.toLocaleString('ko-KR')}개, 소재 ${json.summary.created_creatives.toLocaleString('ko-KR')}개, 연결 키워드 ${json.summary.linked_keywords.toLocaleString('ko-KR')}개, 보류 그룹 ${json.summary.blocked_groups.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '캠페인 드래프트 생성 실패');
    } finally {
      setPublishingDrafts(false);
    }
  };

  const publishNaverPausedKeywords = async () => {
    setPublishingNaverKeywords(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/publish-naver-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry_run', limit: 20 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '네이버 정지 키워드 배포 점검 실패');
      await refresh();
      setAutomationMessage(
        `네이버 정지 키워드 점검: 후보 ${json.summary.checked_keywords.toLocaleString('ko-KR')}개, 업로드 가능 ${json.summary.eligible_keywords.toLocaleString('ko-KR')}개, 보류 ${json.summary.blocked_keywords.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '네이버 정지 키워드 배포 점검 실패');
    } finally {
      setPublishingNaverKeywords(false);
    }
  };

  const probeNaverAdgroups = async () => {
    setProbingNaverAdgroups(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const savedAdgroupId = budgetDrafts.find((budget) => budget.platform === 'naver')?.external_ad_group_id || '';
      const res = await fetch('/api/admin/ad-os/naver-adgroups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nccAdgroupId: savedAdgroupId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '네이버 광고그룹 조회 실패');
      const first = json.adgroups?.[0];
      const verified = json.verified_adgroup;
      let message = '네이버 계정은 연결됐지만 조회 가능한 광고그룹이 없습니다. 네이버 광고센터에서 광고그룹을 먼저 만들어주세요.';
      if (verified?.ok) {
        message = `저장된 네이버 광고그룹 ID 검증 성공: ${verified.adgroup.nccAdgroupId} (${verified.adgroup.name || '이름 없음'}). 네이버 정지 키워드 점검을 실행할 수 있습니다.`;
      } else if (savedAdgroupId) {
        message = `저장된 네이버 광고그룹 ID 검증 실패: ${verified?.error || savedAdgroupId}. 네이버 광고그룹 조회 결과를 확인하거나 ID를 다시 저장하세요.`;
      } else if (first) {
        message = `네이버 광고그룹 ${json.count.toLocaleString('ko-KR')}개 조회. 추천 env: NAVER_ADS_ADGROUP_ID=${first.nccAdgroupId} (${first.name})`;
      }
      setAutomationMessage(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '네이버 광고그룹 조회 실패');
    } finally {
      setProbingNaverAdgroups(false);
    }
  };

  const probeNaverAssets = async () => {
    setProbingNaverAssets(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/naver-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '네이버 계정 자산 조회 실패');
      setAutomationMessage(
        `네이버 계정 자산: 캠페인 ${json.counts.campaigns.toLocaleString('ko-KR')}개, 광고그룹 ${json.counts.adgroups.toLocaleString('ko-KR')}개, 비즈채널 ${json.counts.channels.toLocaleString('ko-KR')}개. 다음 액션: ${json.next_action}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '네이버 계정 자산 조회 실패');
    } finally {
      setProbingNaverAssets(false);
    }
  };

  const syncNaverAssets = async () => {
    setSyncingNaverAssets(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/sync-naver-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '네이버 자산 자동저장 실패');
      await refresh();
      if (json.saved) {
        setAutomationMessage(
          `네이버 자산 자동저장 완료: 캠페인 ${json.summary.campaigns.toLocaleString('ko-KR')}개, 광고그룹 ${json.summary.adgroups.toLocaleString('ko-KR')}개, 비즈채널 ${json.summary.channels.toLocaleString('ko-KR')}개. 저장된 광고그룹 ID: ${json.summary.external_ad_group_id}`,
        );
      } else {
        setAutomationMessage(
          `네이버 자산 자동저장 대기: 캠페인 ${json.summary.campaigns.toLocaleString('ko-KR')}개, 광고그룹 ${json.summary.adgroups.toLocaleString('ko-KR')}개, 비즈채널 ${json.summary.channels.toLocaleString('ko-KR')}개. 다음 액션: ${json.next_action}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '네이버 자산 자동저장 실패');
    } finally {
      setSyncingNaverAssets(false);
    }
  };

  const generateNaverSetupPacket = async () => {
    setGeneratingNaverPacket(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/naver-setup-packet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '네이버 세팅 패킷 생성 실패');
      setNaverSetupPacket(json);
      setAutomationMessage(
        `네이버 세팅 패킷 생성 완료: 캠페인 "${json.packet.campaign_name}", 광고그룹 "${json.packet.ad_group_name}", 키워드 ${json.packet.keyword_count.toLocaleString('ko-KR')}개. 다음 액션: ${json.next_action}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '네이버 세팅 패킷 생성 실패');
    } finally {
      setGeneratingNaverPacket(false);
    }
  };

  const copyNaverKeywordCsv = async () => {
    if (!naverSetupPacket?.packet.keyword_csv) return;
    try {
      await navigator.clipboard.writeText(naverSetupPacket.packet.keyword_csv);
      setAutomationMessage('네이버 키워드 CSV를 클립보드에 복사했습니다.');
    } catch {
      setAutomationMessage('클립보드 복사가 제한되었습니다. 아래 CSV 내용을 직접 선택해서 복사하세요.');
    }
  };

  const downloadNaverKeywordCsv = () => {
    if (!naverSetupPacket?.packet.keyword_csv) return;
    const csvBlob = new Blob([naverSetupPacket.packet.keyword_csv], { type: 'text/csv;charset=utf-8' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const anchor = document.createElement('a');
    anchor.href = csvUrl;
    anchor.download = `${naverSetupPacket.packet.campaign_name || 'naver-keywords'}-keywords.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(csvUrl);
    setAutomationMessage('네이버 키워드 CSV 다운로드를 시작했습니다.');
  };

  const harvestLearning = async () => {
    setHarvestingLearning(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/learning-harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'guarded', apply: true, days: 30 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '성과 학습 수확 실패');
      await refresh();
      setAutomationMessage(
        `성과 학습 완료: 학습 신호 ${json.summary.learning_events.toLocaleString('ko-KR')}개, 검색어 후보 ${json.summary.search_term_candidates.toLocaleString('ko-KR')}개, 확장 후보 ${json.summary.add_keyword_candidates.toLocaleString('ko-KR')}개, 제외 후보 ${json.summary.add_negative_candidates.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '성과 학습 수확 실패');
    } finally {
      setHarvestingLearning(false);
    }
  };

  const generateCandidates = async () => {
    setGeneratingCandidates(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/generate-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '후보 생성 실패');
      await refresh();
      setAutomationMessage(
        `상품 후보 생성 완료: 상품 ${json.summary.targeted.toLocaleString('ko-KR')}개, 키워드 ${json.summary.keywords.toLocaleString('ko-KR')}개, 저장 ${json.summary.saved.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '후보 생성 실패');
    } finally {
      setGeneratingCandidates(false);
    }
  };

  const optimizePerformance = async () => {
    setOptimizingPerformance(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/optimize-performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry_run', limit: 100 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '성과 최적화 실패');
      await refresh();
      setAutomationMessage(
        `성과 최적화 완료: 점검 ${json.summary.checked_mappings.toLocaleString('ko-KR')}개, 정지 후보 ${json.summary.pause_candidates.toLocaleString('ko-KR')}개, 확장 후보 ${json.summary.scale_candidates.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '성과 최적화 실패');
    } finally {
      setOptimizingPerformance(false);
    }
  };

  const syncPerformanceFacts = async () => {
    setSyncingPerformance(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/performance-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 30, apply: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '성과 팩트 동기화 실패');
      await refresh();
      setAutomationMessage(
        `성과 팩트 동기화 완료: 팩트 ${json.summary.facts_prepared.toLocaleString('ko-KR')}개, 클릭 ${json.summary.total_clicks.toLocaleString('ko-KR')}개, CTA ${json.summary.total_cta_clicks.toLocaleString('ko-KR')}개, 전환 ${json.summary.total_conversions.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '성과 팩트 동기화 실패');
    } finally {
      setSyncingPerformance(false);
    }
  };

  const applyLearningRules = async () => {
    setApplyingLearning(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/learning-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true, limit: 100 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '학습 적용 후보 생성 실패');
      await refresh();
      setAutomationMessage(
        `학습 적용 완료: 변경요청 ${json.summary.change_requests_inserted.toLocaleString('ko-KR')}개, 정지 ${json.summary.pause_candidates.toLocaleString('ko-KR')}개, 랜딩 ${json.summary.landing_candidates.toLocaleString('ko-KR')}개, 확장 ${json.summary.expansion_candidates.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '학습 적용 후보 생성 실패');
    } finally {
      setApplyingLearning(false);
    }
  };

  const dryRunExternalPublish = async () => {
    setPublishingExternal(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/external-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'naver', mode: 'dry_run', apply: false }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '외부 발행 드라이런 실패');
      await refresh();
      setAutomationMessage(
        `외부 발행 드라이런: ${json.summary.channel_state.label}, 승인요청 ${json.summary.approved_requests.toLocaleString('ko-KR')}개, 실제 외부 API 쓰기 ${json.summary.external_api_write ? '있음' : '없음'}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '외부 발행 드라이런 실패');
    } finally {
      setPublishingExternal(false);
    }
  };

  const runBudgetPacing = async () => {
    setRunningBudgetPacing(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/budget-pacing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry_run' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '예산 페이싱 실패');
      await refresh();
      setAutomationMessage(
        `예산 페이싱 완료: 채널 ${json.summary.checked_channels.toLocaleString('ko-KR')}개, 과속 ${Number(json.summary.over_pacing || 0).toLocaleString('ko-KR')}개, 저속 ${Number(json.summary.under_pacing || 0).toLocaleString('ko-KR')}개, 손실한도 근접 ${Number(json.summary.loss_limit_near || 0).toLocaleString('ko-KR')}개, 차단 ${Number(json.summary.blocked || 0).toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '예산 페이싱 실패');
    } finally {
      setRunningBudgetPacing(false);
    }
  };

  const probePublisher = async () => {
    setProbingPublisher(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/publisher-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hint: '다낭 패키지' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '외부 광고 계정 테스트 실패');
      const naver = json.probes?.naver;
      const google = json.probes?.google;
      setAutomationMessage(
        `외부 계정 테스트: Naver ${naver?.status || '-'} (${naver?.message || '-'}), Google ${google?.status || '-'} (${google?.message || '-'})`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '외부 광고 계정 테스트 실패');
    } finally {
      setProbingPublisher(false);
    }
  };

  const runLaunchAudit = async () => {
    setRunningLaunchAudit(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/launch-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '오늘 집행 감사 실패');
      setLaunchAudit({ readiness: json.readiness, items: json.items });
      setAutomationMessage(
        `오늘 집행 감사: 통과 ${json.readiness.pass}/${json.readiness.total}, 주의 ${json.readiness.warn}, 실패 ${json.readiness.fail}. 다음 액션: ${json.readiness.next_action}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '오늘 집행 감사 실패');
    } finally {
      setRunningLaunchAudit(false);
    }
  };

  const approveNaverCandidates = async () => {
    setApprovingNaverCandidates(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/approve-naver-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'guarded', apply: true, limit: 20 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '네이버 후보 승인 실패');
      await refresh();
      setAutomationMessage(
        `네이버 후보 승인 완료: 점검 ${json.summary.checked_keywords.toLocaleString('ko-KR')}개, 승인 가능 ${json.summary.eligible_keywords.toLocaleString('ko-KR')}개, 실제 승인 ${json.summary.approved_keywords.toLocaleString('ko-KR')}개. 외부 광고비 0원.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '네이버 후보 승인 실패');
    } finally {
      setApprovingNaverCandidates(false);
    }
  };

  const runExpiryCleanup = async () => {
    setRunningExpiryCleanup(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/expiry-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry_run', limit: 50 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '만료 정리 점검 실패');
      await refresh();
      setAutomationMessage(
        `만료 정리 점검 완료: 만료 상품 ${json.summary.expired_packages.toLocaleString('ko-KR')}개, 키워드 중지 후보 ${json.summary.keyword_targets.toLocaleString('ko-KR')}개, 매핑 중지 후보 ${json.summary.mapping_targets.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '만료 정리 점검 실패');
    } finally {
      setRunningExpiryCleanup(false);
    }
  };

  const runKillSwitchDryRun = async () => {
    setRunningKillSwitch(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'dry_run',
          apply: false,
          reason: 'Operator reviewed Ad OS emergency pause scope.',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '전체 정지 점검 실패');
      await refresh();
      setAutomationMessage(
        `전체 정지 점검 완료: 예산 채널 ${json.summary.active_budget_channels.toLocaleString('ko-KR')}개, 키워드 ${json.summary.keyword_targets.toLocaleString('ko-KR')}개, 랜딩 매핑 ${json.summary.mapping_targets.toLocaleString('ko-KR')}개가 정지 대상입니다. 드라이런이라 실제 변경과 외부 광고비는 0원입니다.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '전체 정지 점검 실패');
    } finally {
      setRunningKillSwitch(false);
    }
  };

  const updateKeywordPlan = async (id: string, action: 'approve' | 'archive') => {
    setKeywordActionId(id);
    setError(null);
    try {
      const res = await fetch('/api/admin/search-ads/auto-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids: [id] }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '키워드 상태 변경 실패');
      await refresh();
      setAutomationMessage(action === 'approve' ? '키워드 후보를 승인했습니다. 예산/드라이런에서 테스트 가능 여부를 다시 판단합니다.' : '키워드 후보를 보류했습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '키워드 상태 변경 실패');
    } finally {
      setKeywordActionId(null);
    }
  };

  const harvestSearchTerms = async () => {
    setHarvestingSearchTerms(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/search-term-harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry_run' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '검색어 수확 실패');
      await refresh();
      setAutomationMessage(
        `검색어 수확 완료: 검색어 ${json.summary.fetched_terms.toLocaleString('ko-KR')}개, 키워드 추가 ${json.summary.add_keyword.toLocaleString('ko-KR')}개, 제외어 ${json.summary.add_negative.toLocaleString('ko-KR')}개, 검토 ${json.summary.review.toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '검색어 수확 실패');
    } finally {
      setHarvestingSearchTerms(false);
    }
  };

  const planExperiments = async () => {
    setPlanningExperiments(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/experiment-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '실험 후보 생성 실패');
      await refresh();
      setAutomationMessage(
        `실험 후보 생성 완료: 성과팩트 ${json.summary.facts_checked.toLocaleString('ko-KR')}개 기준, 실험 후보 ${json.summary.experiments_created.toLocaleString('ko-KR')}개. Bandit은 기본 비활성입니다.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '실험 후보 생성 실패');
    } finally {
      setPlanningExperiments(false);
    }
  };

  const probeGooglePublisher = async () => {
    setProbingGooglePublisher(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/publisher/google/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hint: '다낭 패키지' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Google 권한 진단 실패');
      await refresh();
      setAutomationMessage(
        `Google 권한 진단: ${json.probe.status} — ${json.probe.message} 다음 조치: ${json.probe.next_action}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google 권한 진단 실패');
    } finally {
      setProbingGooglePublisher(false);
    }
  };

  const loadTenantReport = async () => {
    setLoadingTenantReport(true);
    setError(null);
    setAutomationMessage(null);
    try {
      const res = await fetch('/api/admin/ad-os/tenant-report');
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '테넌트 리포트 생성 실패');
      setTenantReport(json);
      const report = json.report || {};
      setAutomationMessage(
        `테넌트 리포트: 예산 사용률 ${Number(report.budget_usage_pct || 0)}%, 매출 ROAS ${Number(report.revenue_roas_pct || 0)}%, 마진 ROAS ${Number(report.margin_roas_pct || 0)}%, 신규 저가 키워드 ${Number(report.discovered_cheap_keywords || 0).toLocaleString('ko-KR')}개`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '테넌트 리포트 생성 실패');
    } finally {
      setLoadingTenantReport(false);
    }
  };

  const updateChangeRequest = async (id: string, status: 'approved' | 'rejected' | 'applied' | 'rolled_back') => {
    setChangeRequestActionId(id);
    setError(null);
    try {
      const res = await fetch('/api/admin/ad-os/change-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '변경 요청 처리 실패');
      await refresh();
      setAutomationMessage(
        status === 'approved'
          ? 'AI 변경 요청을 승인했습니다. 제한 자동집행 단계에서 예산/권한 조건을 다시 확인한 뒤 적용됩니다.'
          : status === 'applied'
            ? '승인된 AI 변경 요청을 내부 운영 테이블에 적용했습니다. 외부 광고 계정 반영은 채널 권한 게이트를 다시 통과해야 합니다.'
            : status === 'rolled_back'
              ? 'AI 변경 요청을 롤백했습니다. 이전 상태로 되돌린 내용을 감사 로그에서 확인할 수 있습니다.'
          : 'AI 변경 요청을 거절했습니다. 같은 조건은 이후 학습 로그에 반영되어 추천 우선순위가 낮아집니다.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '변경 요청 처리 실패');
    } finally {
      setChangeRequestActionId(null);
    }
  };

  const readyScore = useMemo(() => {
    if (!summary) return 0;
    let score = 0;
    if (summary.kpis.mapping_candidates > 0) score += 15;
    if (summary.kpis.landing_blogs > 0) score += 15;
    if (summary.kpis.keyword_candidates > 0) score += 15;
    if (summary.channel_budgets.some((b) => b.configured && b.status === 'active' && b.monthly_budget_krw > 0)) score += 20;
    if (Object.values(summary.integration_status).some(Boolean)) score += 20;
    if (summary.recent_decisions.length > 0) score += 15;
    return Math.min(100, score);
  }, [summary]);

  const totalMappingStatus = summary
    ? Object.values(summary.counts.mappings_by_status || {}).reduce((a, b) => a + b, 0)
    : 0;
  const launchSteps = summary
    ? [
        {
          label: '검색광고 API',
          done: Boolean(summary.integration_status.naver || summary.integration_status.google),
          value: ['naver', 'google'].filter((platform) => summary.integration_status[platform]).map((platform) => PLATFORM_LABEL[platform] || platform).join(', ') || '키 필요',
          next: '네이버/구글 키가 있어야 실제 계정까지 연결됩니다.',
        },
        {
          label: '예산 캡',
          done: summary.channel_budgets.some((budget) => ['naver', 'google'].includes(budget.platform) && budget.status === 'active' && budget.monthly_budget_krw > 0 && budget.daily_budget_cap_krw > 0),
          value: summary.channel_budgets.filter((budget) => ['naver', 'google'].includes(budget.platform) && budget.status === 'active').length > 0 ? '활성' : '정지',
          next: '채널별 월예산/일상한/Max CPC를 넣고 active로 바꿉니다.',
        },
        {
          label: '초세부 키워드',
          done: summary.kpis.keyword_candidates > 0,
          value: `${summary.kpis.keyword_candidates.toLocaleString('ko-KR')}개`,
          next: '상품 후보 생성을 눌러 상품별 longtail 후보를 만듭니다.',
        },
        {
          label: '승인 후보',
          done: Number(summary.counts.keyword_plans_by_status?.approved || 0) > 0 || Number(summary.counts.keyword_plans_by_status?.testing || 0) > 0,
          value: `${Number(summary.counts.keyword_plans_by_status?.approved || 0).toLocaleString('ko-KR')}개`,
          next: '최근 키워드 후보에서 좋은 후보를 승인합니다.',
        },
        {
          label: '캠페인 드래프트',
          done: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0,
          value: `${Number(summary.kpis.draft_campaigns || 0).toLocaleString('ko-KR')}개`,
          next: '캠페인 드래프트 생성으로 내부 캠페인/소재를 묶습니다.',
        },
      ]
    : [];
  const launchReadyCount = launchSteps.filter((step) => step.done).length;
  const nextLaunchStep = launchSteps.find((step) => !step.done);
  const searchBudgets = summary?.channel_budgets.filter((budget) => ['naver', 'google'].includes(budget.platform)) || [];
  const hasActiveSearchBudget = searchBudgets.some((budget) => budget.status === 'active' && budget.monthly_budget_krw > 0 && budget.daily_budget_cap_krw > 0);
  const hasStoredNaverAdgroup = Boolean(searchBudgets.find((budget) => budget.platform === 'naver')?.external_ad_group_id);
  const approvedOrTestingKeywords =
    Number(summary?.counts.keyword_plans_by_status?.approved || 0) +
    Number(summary?.counts.keyword_plans_by_status?.testing || 0);
  const launchWizardSteps = summary
    ? [
        {
          label: '1. 시범 예산',
          status: hasActiveSearchBudget ? '완료' : '필요',
          done: hasActiveSearchBudget,
          body: '네이버/구글 월 10만원, 일 1만원, Max CPC 500원으로 L1만 엽니다.',
        },
        {
          label: '2. 후보 승인',
          status: approvedOrTestingKeywords > 0 ? '완료' : '필요',
          done: approvedOrTestingKeywords > 0,
          body: '초세부 키워드 중 Max CPC 안에 드는 후보만 승인합니다.',
        },
        {
          label: '3. 내부 드래프트',
          status: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0 ? '완료' : '필요',
          done: summary.kpis.draft_campaigns > 0 || summary.kpis.active_campaigns > 0,
          body: '광고 캠페인과 소재를 내부 검토 상태로 묶습니다.',
        },
        {
          label: '4. 외부 계정',
          status: hasStoredNaverAdgroup ? 'ID 저장됨' : '대기',
          done: hasStoredNaverAdgroup,
          body: '네이버 광고그룹 ID 또는 계정 자산이 있어야 외부 업로드가 열립니다.',
        },
      ]
    : [];
  const actionHandlers: Record<string, () => void> = {
    runPilotSetup,
    generateNaverSetupPacket,
    syncNaverAssets,
    probePublisher,
    generateCandidates,
    harvestLearning,
    runLaunchAudit,
    runKillSwitchDryRun,
    harvestSearchTerms,
    planExperiments,
    probeGooglePublisher,
    loadTenantReport,
  };
  const actionLoading: Record<string, boolean> = {
    runPilotSetup: runningPilotSetup,
    generateNaverSetupPacket: generatingNaverPacket,
    syncNaverAssets: syncingNaverAssets,
    probePublisher: probingPublisher,
    generateCandidates: generatingCandidates,
    harvestLearning: harvestingLearning,
    runLaunchAudit: runningLaunchAudit,
    runKillSwitchDryRun: runningKillSwitch,
    harvestSearchTerms: harvestingSearchTerms,
    planExperiments: planningExperiments,
    probeGooglePublisher: probingGooglePublisher,
    loadTenantReport: loadingTenantReport,
  };
  const topQueuedAction = summary?.launch_action_queue?.[0] || null;
  const executionStateEntries = Object.entries(summary?.channel_execution_states || {}).filter(([platform]) =>
    ['naver', 'google'].includes(platform),
  );
  const activeModeByPlatform = new Map((summary?.active_automation_modes || []).map((mode) => [mode.platform, mode]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ad OS"
        subtitle="상품 등록부터 키워드·블로그·소재·예산·자동화까지 묶는 여행 광고 운영 허브"
        actions={
          <>
            <Link href="/admin/search-ads">
              <Button variant="secondary" size="sm">
                <Search size={14} />
                검색광고
              </Button>
            </Link>
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

      {loading && <div className="admin-card p-5 text-admin-sm text-admin-muted">Ad OS 상태를 읽는 중입니다.</div>}
      {error && (
        <div className="rounded-admin-md border border-rose-200 bg-rose-50 p-4 text-admin-sm text-rose-700">
          {error}
        </div>
      )}

      {summary && (
        <>
          <section className="admin-card p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-admin-base font-semibold text-admin-text-2">채널 집행 상태</h2>
                <p className="mt-1 text-admin-xs text-admin-muted">
                  네이버와 구글을 각각 연동 준비됨, 권한 없음, 캠페인 없음, 집행 가능 상태로 분리해서 표시합니다.
                </p>
              </div>
              <StatusPill tone={executionStateEntries.some(([, state]) => state.canSpend) ? 'good' : 'warn'}>
                외부 집행은 가드레일 통과 시에만 가능
              </StatusPill>
            </div>
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
              {executionStateEntries.map(([platform, state]) => {
                const activeMode = activeModeByPlatform.get(platform);
                return (
                  <div key={platform} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-admin-sm font-semibold text-admin-text">
                          {platform === 'naver' ? '네이버 검색광고' : '구글 광고'}
                        </p>
                        <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{state.summary}</p>
                      </div>
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
                    </div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                        <p className="text-admin-2xs text-admin-muted">현재 모드</p>
                        <p className="mt-1 text-admin-xs font-semibold text-admin-text">
                          {activeMode?.mode === 'full_auto'
                            ? '완전자동'
                            : activeMode?.mode === 'limited_auto'
                              ? '제한 예산 자동집행'
                              : activeMode?.mode === 'approval'
                                ? '승인'
                                : '추천'}
                        </p>
                      </div>
                      <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                        <p className="text-admin-2xs text-admin-muted">레벨</p>
                        <p className="mt-1 text-admin-xs font-semibold text-admin-text">L{activeMode?.level ?? 1}</p>
                      </div>
                      <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                        <p className="text-admin-2xs text-admin-muted">예산 집행</p>
                        <p className="mt-1 text-admin-xs font-semibold text-admin-text">{state.canSpend ? '가능' : '차단'}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-admin-2xs leading-5 text-admin-muted">다음 조치: {state.nextAction}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="admin-card p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-admin-base font-semibold text-admin-text-2">자동화 모드 고정</h2>
                <p className="mt-1 text-admin-xs text-admin-muted">
                  완전자동은 바로 켜지 않고 추천 → 승인 → 제한 예산 자동집행 → 완전자동 4단계로만 승급합니다.
                </p>
              </div>
              <StatusPill tone="warn">기본 운영 권장: 추천/승인</StatusPill>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
              {(summary.automation_modes || []).map((mode, index) => (
                <div key={mode.id} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="admin-num text-admin-2xs font-bold text-admin-muted">{index + 1}단계</span>
                    <StatusPill tone={index < 2 ? 'good' : index === 2 ? 'warn' : 'neutral'}>{mode.label}</StatusPill>
                  </div>
                  <p className="mt-2 text-admin-xs leading-5 text-admin-muted">{mode.description}</p>
                  <p className="mt-2 text-admin-2xs text-admin-muted">
                    L{mode.levelMin}{mode.levelMin !== mode.levelMax ? `-L${mode.levelMax}` : ''}
                  </p>
                </div>
              ))}
            </div>
            {summary.tenant_guardrails && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                {summary.tenant_guardrails.map((guardrail) => (
                  <div key={guardrail.id} className="rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-admin-xs font-semibold text-admin-text">{guardrail.label}</p>
                      <StatusPill tone={guardrail.status === 'pass' ? 'good' : guardrail.status === 'warn' ? 'warn' : 'bad'}>
                        {guardrail.status === 'pass' ? '통과' : guardrail.status === 'warn' ? '주의' : '차단'}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-admin-2xs leading-5 text-admin-muted">{guardrail.detail}</p>
                  </div>
                ))}
              </div>
            )}
            {summary.tenant_ad_readiness && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                {summary.tenant_ad_readiness.map((item) => (
                  <div key={item.id} className="rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-admin-xs font-semibold text-admin-text">{item.label}</p>
                      <StatusPill tone={item.status === 'pass' ? 'good' : item.status === 'warn' ? 'warn' : 'bad'}>
                        {item.status === 'pass' ? '통과' : item.status === 'warn' ? '주의' : '차단'}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-admin-2xs leading-5 text-admin-muted">{item.detail}</p>
                  </div>
                ))}
              </div>
            )}
            {summary.tenant_policy && (
              <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-admin-sm font-semibold text-admin-text">테넌트 광고 정책</p>
                    <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">
                      허용 채널, 월/일 예산, CPC, 테스트 손실, 최대 자동화 레벨을 테넌트별로 제한합니다.
                      {summary.tenant_policy.error ? ` 정책 테이블 확인 필요: ${summary.tenant_policy.error}` : ''}
                    </p>
                  </div>
                  <StatusPill tone={summary.tenant_policy.configured ? 'good' : 'warn'}>
                    {summary.tenant_policy.configured ? '정책 설정됨' : '기본 정책'}
                  </StatusPill>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                  {[
                    ['허용채널', summary.tenant_policy.allowed_platforms.join(', ')],
                    ['월한도', fmtWon(summary.tenant_policy.monthly_budget_cap_krw)],
                    ['일한도', fmtWon(summary.tenant_policy.daily_budget_cap_krw)],
                    ['Max CPC', fmtWon(summary.tenant_policy.max_cpc_krw)],
                    ['손실한도', fmtWon(summary.tenant_policy.max_test_loss_krw)],
                    ['최대레벨', `L${summary.tenant_policy.max_automation_level}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                      <p className="text-admin-2xs text-admin-muted">{label}</p>
                      <p className="mt-1 text-admin-xs font-semibold text-admin-text">{value}</p>
                    </div>
                  ))}
                </div>
                {tenantPolicyDraft && (
                  <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-admin-sm font-semibold text-admin-text">정책 편집</p>
                        <p className="mt-1 text-admin-2xs text-admin-muted">저장 후 Ad OS 자동화와 채널 집행 판단에 즉시 반영됩니다.</p>
                      </div>
                      <Button size="sm" onClick={saveTenantPolicy} loading={savingTenantPolicy}>
                        <ShieldCheck size={14} />
                        정책 저장
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-6">
                      <label className="text-admin-2xs font-semibold text-admin-muted">
                        월한도
                        <input
                          type="number"
                          min={0}
                          value={tenantPolicyDraft.monthly_budget_cap_krw}
                          onChange={(e) => updateTenantPolicyDraft('monthly_budget_cap_krw', e.target.value)}
                          className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                        />
                      </label>
                      <label className="text-admin-2xs font-semibold text-admin-muted">
                        일한도
                        <input
                          type="number"
                          min={0}
                          value={tenantPolicyDraft.daily_budget_cap_krw}
                          onChange={(e) => updateTenantPolicyDraft('daily_budget_cap_krw', e.target.value)}
                          className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                        />
                      </label>
                      <label className="text-admin-2xs font-semibold text-admin-muted">
                        Max CPC
                        <input
                          type="number"
                          min={0}
                          value={tenantPolicyDraft.max_cpc_krw}
                          onChange={(e) => updateTenantPolicyDraft('max_cpc_krw', e.target.value)}
                          className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                        />
                      </label>
                      <label className="text-admin-2xs font-semibold text-admin-muted">
                        손실한도
                        <input
                          type="number"
                          min={0}
                          value={tenantPolicyDraft.max_test_loss_krw}
                          onChange={(e) => updateTenantPolicyDraft('max_test_loss_krw', e.target.value)}
                          className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                        />
                      </label>
                      <label className="text-admin-2xs font-semibold text-admin-muted">
                        최대레벨
                        <input
                          type="number"
                          min={0}
                          max={5}
                          value={tenantPolicyDraft.max_automation_level}
                          onChange={(e) => updateTenantPolicyDraft('max_automation_level', e.target.value)}
                          className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                        />
                      </label>
                      <label className="text-admin-2xs font-semibold text-admin-muted">
                        리스크
                        <select
                          value={tenantPolicyDraft.risk_status}
                          onChange={(e) => updateTenantPolicyDraft('risk_status', e.target.value)}
                          className="mt-1 h-9 w-full rounded-admin-xs border border-admin-border bg-admin-surface px-2 text-admin-xs text-admin-text"
                        >
                          <option value="normal">normal</option>
                          <option value="watch">watch</option>
                          <option value="restricted">restricted</option>
                          <option value="blocked">blocked</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {(['naver', 'google', 'meta', 'kakao'] as const).map((platform) => (
                        <label key={platform} className="inline-flex items-center gap-1.5 text-admin-xs font-semibold text-admin-text">
                          <input
                            type="checkbox"
                            checked={(tenantPolicyDraft.allowed_platforms || []).includes(platform)}
                            onChange={() => toggleTenantPlatform(platform)}
                          />
                          {PLATFORM_LABEL[platform] || platform}
                        </label>
                      ))}
                      <label className="inline-flex items-center gap-1.5 text-admin-xs font-semibold text-admin-text">
                        <input
                          type="checkbox"
                          checked={tenantPolicyDraft.require_human_approval}
                          onChange={(e) => updateTenantPolicyDraft('require_human_approval', e.target.checked)}
                        />
                        승인 필수
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-admin-xs font-semibold text-admin-text">
                        <input
                          type="checkbox"
                          checked={tenantPolicyDraft.full_auto_enabled}
                          onChange={(e) => updateTenantPolicyDraft('full_auto_enabled', e.target.checked)}
                        />
                        완전자동 허용
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {summary.learning_loop && (
            <section className="admin-card p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-admin-base font-semibold text-admin-text-2">성과 학습 루프</h2>
                  <p className="mt-1 text-admin-xs text-admin-muted">
                    클릭, CTA, 예약, CPA, ROAS를 블로그 랜딩, 키워드, 상품, 테넌트 단위로 묶어서 다음 광고 추천에 반영합니다.
                  </p>
                </div>
                <StatusPill tone={summary.learning_loop.status.has_booking_signal ? 'good' : summary.learning_loop.status.has_click_signal ? 'warn' : 'neutral'}>
                  {summary.learning_loop.status.has_booking_signal ? '예약 학습 가능' : summary.learning_loop.status.has_click_signal ? '클릭 학습 중' : '데이터 대기'}
                </StatusPill>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-9">
                {[
                  ['클릭', summary.learning_loop.metrics.clicks.toLocaleString('ko-KR')],
                  ['CTA율', `${summary.learning_loop.metrics.cta_rate_pct}%`],
                  ['예약전환율', `${summary.learning_loop.metrics.conversion_rate_pct}%`],
                  ['CPA', summary.learning_loop.metrics.cpa_krw ? fmtWon(summary.learning_loop.metrics.cpa_krw) : '-'],
                  ['ROAS', summary.learning_loop.metrics.roas_pct ? `${summary.learning_loop.metrics.roas_pct}%` : '-'],
                  ['30일 행동', summary.learning_loop.metrics.engagement_sessions_30d.toLocaleString('ko-KR')],
                  ['이탈률', summary.learning_loop.metrics.bounce_rate_pct === null ? '-' : `${summary.learning_loop.metrics.bounce_rate_pct}%`],
                  ['체류', `${summary.learning_loop.metrics.avg_time_on_page_seconds}s`],
                  ['스크롤', `${summary.learning_loop.metrics.avg_scroll_depth_pct}%`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-admin-sm bg-admin-surface-2 p-3">
                    <p className="text-admin-2xs font-semibold text-admin-muted">{label}</p>
                    <p className="mt-1 text-admin-lg font-bold text-admin-text-2">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3 text-admin-xs leading-5 text-admin-muted">
                {summary.learning_loop.next_action} 최근 30일 페이지 체류, 스크롤, CTA 신호까지 함께 묶어 이탈이 높은 랜딩과 확장할 키워드를 분리합니다.
              </div>
            </section>
          )}

          <div className="grid grid-cols-2 xl:grid-cols-10 gap-3">
            <KpiCard label="자동화 준비도" value={`${readyScore}`} unit="/100" icon={Gauge} tone={readyScore >= 70 ? 'positive' : 'neutral'} />
            <KpiCard label="매핑 후보" value={summary.kpis.mapping_candidates.toLocaleString('ko-KR')} icon={Layers} />
            <KpiCard label="키워드 후보" value={summary.kpis.keyword_candidates.toLocaleString('ko-KR')} icon={Search} />
            <KpiCard label="랜딩 클릭" value={summary.kpis.tracked_clicks.toLocaleString('ko-KR')} icon={MousePointerClick} />
            <KpiCard label="CTA 클릭" value={summary.kpis.tracked_cta_clicks.toLocaleString('ko-KR')} icon={MousePointerClick} tone={summary.kpis.tracked_cta_clicks > 0 ? 'positive' : 'neutral'} />
            <KpiCard label="예약 전환" value={summary.kpis.tracked_conversions.toLocaleString('ko-KR')} icon={CheckCircle2} tone={summary.kpis.tracked_conversions > 0 ? 'positive' : 'neutral'} />
            <KpiCard label="7일 내 발권기한" value={summary.kpis.expiring_packages_7d.toLocaleString('ko-KR')} icon={AlertTriangle} tone={summary.kpis.expiring_packages_7d > 0 ? 'negative' : 'neutral'} />
            <KpiCard label="캠페인 드래프트" value={(summary.kpis.draft_campaigns || 0).toLocaleString('ko-KR')} icon={Rocket} />
            <KpiCard label="학습 신호" value={(summary.kpis.learning_events || 0).toLocaleString('ko-KR')} icon={Gauge} />
            <KpiCard label="상품 시나리오" value={(summary.kpis.product_scenarios || 0).toLocaleString('ko-KR')} icon={Bot} />
            <KpiCard label="랜딩 진화 후보" value={(summary.kpis.landing_evolution_candidates || 0).toLocaleString('ko-KR')} icon={Layers} />
            <KpiCard label="예산 페이싱 경고" value={(summary.kpis.budget_pacing_alerts || 0).toLocaleString('ko-KR')} icon={AlertTriangle} tone={(summary.kpis.budget_pacing_alerts || 0) > 0 ? 'negative' : 'neutral'} />
            <KpiCard label="테넌트 광고계정" value={(summary.kpis.tenant_ad_accounts_ready || 0).toLocaleString('ko-KR')} icon={KeyRound} tone={(summary.kpis.tenant_ad_accounts_ready || 0) > 0 ? 'positive' : 'neutral'} />
            <KpiCard label="승인 대기 변경" value={(summary.kpis.change_requests_proposed || 0).toLocaleString('ko-KR')} icon={ShieldCheck} tone={(summary.kpis.change_requests_high_risk || 0) > 0 ? 'negative' : 'neutral'} />
            <KpiCard label="월 예산 설정" value={fmtWon(summary.kpis.configured_monthly_budget_krw)} icon={Wallet} />
          </div>

          <section className="admin-card p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-admin-base font-semibold text-admin-text-2">오늘 할 일</h2>
                <p className="mt-1 text-admin-xs text-admin-muted">현재 계정/예산/키워드 상태를 기준으로 Ad OS가 실행 순서를 정합니다.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="neutral">{summary.launch_action_queue.length}개 액션</StatusPill>
                {topQueuedAction && (
                  <Button
                    size="sm"
                    onClick={actionHandlers[topQueuedAction.ui_action]}
                    loading={actionLoading[topQueuedAction.ui_action]}
                  >
                    <ArrowRight size={14} />
                    1순위 실행
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
              {summary.launch_action_queue.map((action) => (
                <div key={action.id} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-admin-2xs font-bold text-admin-muted admin-num">#{action.priority}</p>
                      <p className="mt-1 text-admin-xs font-semibold text-admin-text">{action.label}</p>
                    </div>
                    <StatusPill tone={actionTone(action.tone)}>{action.tone === 'good' ? '추천' : action.tone === 'warn' ? '병목' : action.tone === 'bad' ? '안전' : '점검'}</StatusPill>
                  </div>
                  <p className="mt-2 min-h-10 text-admin-2xs leading-5 text-admin-muted">{action.description}</p>
                  <Button
                    className="mt-3 w-full"
                    size="sm"
                    variant={action.tone === 'good' ? 'primary' : 'secondary'}
                    onClick={actionHandlers[action.ui_action]}
                    loading={actionLoading[action.ui_action]}
                  >
                    <ArrowRight size={14} />
                    {action.button_label}
                  </Button>
                </div>
              ))}
            </div>
            {naverSetupPacket && (
              <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-admin-sm font-semibold text-admin-text">네이버 세팅 패킷</h3>
                    <p className="mt-1 text-admin-2xs text-admin-muted">{naverSetupPacket.next_action}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={naverSetupPacket.existing_assets.campaigns > 0 ? 'good' : 'warn'}>
                      캠페인 {naverSetupPacket.existing_assets.campaigns}
                    </StatusPill>
                    <StatusPill tone={naverSetupPacket.existing_assets.adgroups > 0 ? 'good' : 'warn'}>
                      광고그룹 {naverSetupPacket.existing_assets.adgroups}
                    </StatusPill>
                    <StatusPill tone={naverSetupPacket.existing_assets.channels > 0 ? 'good' : 'warn'}>
                      비즈채널 {naverSetupPacket.existing_assets.channels}
                    </StatusPill>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                    <p className="text-admin-2xs text-admin-muted">캠페인명</p>
                    <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.campaign_name}</p>
                  </div>
                  <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                    <p className="text-admin-2xs text-admin-muted">광고그룹명</p>
                    <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.ad_group_name}</p>
                  </div>
                  <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                    <p className="text-admin-2xs text-admin-muted">일예산 / Max CPC</p>
                    <p className="mt-1 text-admin-xs font-semibold text-admin-text">
                      {naverSetupPacket.packet.daily_budget_krw.toLocaleString('ko-KR')}원 / {naverSetupPacket.packet.max_cpc_krw.toLocaleString('ko-KR')}원
                    </p>
                  </div>
                  <div className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                    <p className="text-admin-2xs text-admin-muted">키워드 후보</p>
                    <p className="mt-1 text-admin-xs font-semibold text-admin-text">{naverSetupPacket.packet.keyword_count.toLocaleString('ko-KR')}개</p>
                  </div>
                </div>
                <div className="mt-3 overflow-hidden rounded-admin-sm border border-admin-border">
                  <table className="admin-data-table">
                    <thead>
                      <tr>
                        <th>키워드</th>
                        <th>매치</th>
                        <th>입찰가</th>
                        <th>랜딩</th>
                      </tr>
                    </thead>
                    <tbody>
                      {naverSetupPacket.packet.keyword_samples.slice(0, 6).map((keyword, index) => (
                        <tr key={`${keyword.keyword}-${index}`}>
                          <td className="font-semibold text-admin-text">{keyword.keyword || '-'}</td>
                          <td>{keyword.match_type || '-'}</td>
                          <td className="admin-num">{keyword.bid_krw.toLocaleString('ko-KR')}원</td>
                          <td className="max-w-xs truncate">{keyword.final_url || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-admin-sm font-semibold text-admin-text">네이버 키워드 CSV</p>
                      <p className="mt-1 text-admin-2xs text-admin-muted">광고센터/업로드 시트에 붙여넣기 위한 키워드, 매치타입, 입찰가, 랜딩 URL입니다.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={downloadNaverKeywordCsv}>
                        <Download size={14} />
                        CSV 다운로드
                      </Button>
                      <Button size="sm" variant="secondary" onClick={copyNaverKeywordCsv}>
                        <Save size={14} />
                        CSV 복사
                      </Button>
                    </div>
                  </div>
                  <textarea
                    className="mt-3 h-32 w-full resize-y rounded-admin-xs border border-admin-border bg-admin-surface px-3 py-2 font-mono text-admin-2xs text-admin-text"
                    readOnly
                    value={naverSetupPacket.packet.keyword_csv}
                  />
                </div>
              </div>
            )}
          </section>

          <section className="admin-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-admin-base font-semibold text-admin-text-2">오늘 광고 시작 런치패드</h2>
                  <StatusPill tone={launchReadyCount >= launchSteps.length ? 'good' : launchReadyCount >= 3 ? 'warn' : 'bad'}>
                    {launchReadyCount}/{launchSteps.length} 준비
                  </StatusPill>
                </div>
                <p className="mt-1 text-admin-xs text-admin-muted">
                  완전자동화 엔진은 L5까지 설계하되, 실제 지출은 API·예산·승인·드래프트가 모두 통과한 채널만 열립니다.
                </p>
              </div>
              <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2 text-admin-xs text-admin-muted">
                다음 액션: <span className="font-semibold text-admin-text">{nextLaunchStep ? nextLaunchStep.next : '시범 예산 안에서 L2 실행 준비 완료'}</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2">
              {launchSteps.map((step) => (
                <div key={step.label} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-admin-xs font-semibold text-admin-text">{step.label}</p>
                    <StatusPill tone={step.done ? 'good' : 'warn'}>{step.done ? 'OK' : '대기'}</StatusPill>
                  </div>
                  <p className="mt-2 admin-num text-admin-lg font-semibold text-admin-text">{step.value}</p>
                  <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{step.next}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h3 className="text-admin-sm font-semibold text-admin-text">오늘 시작 4단계</h3>
                  <p className="mt-1 text-admin-2xs text-admin-muted">
                    이 흐름은 외부 광고를 바로 켜지 않습니다. 내부 준비와 정지 키워드 업로드 전 점검까지 안전하게 진행합니다.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={runPilotSetup} loading={runningPilotSetup}>
                    <Rocket size={14} />
                    1단계 시범 세팅
                  </Button>
                  <Button size="sm" variant="secondary" onClick={runLaunchAudit} loading={runningLaunchAudit}>
                    <CheckCircle2 size={14} />
                    오늘 집행 감사
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                {launchWizardSteps.map((step) => (
                  <div key={step.label} className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-admin-xs font-semibold text-admin-text">{step.label}</p>
                      <StatusPill tone={step.done ? 'good' : 'warn'}>{step.status}</StatusPill>
                    </div>
                    <p className="mt-1 text-admin-2xs text-admin-muted">{step.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                {(['naver', 'google'] as const).map((platform) => {
                  const status = summary.external_launch_status?.[platform];
                  if (!status) return null;
                  return (
                    <div key={platform} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-admin-sm font-semibold text-admin-text">{PLATFORM_LABEL[platform]} 외부 집행 준비</p>
                          <p className="mt-1 text-admin-2xs text-admin-muted">{status.next_action}</p>
                        </div>
                        <StatusPill tone={status.ready ? 'good' : status.pass >= status.total - 1 ? 'warn' : 'bad'}>
                          {status.pass}/{status.total}
                        </StatusPill>
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {status.checks.map((check) => (
                          <div key={check.id} className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-admin-xs font-semibold text-admin-text">{check.label}</span>
                              <StatusPill tone={check.done ? 'good' : 'warn'}>{check.done ? 'OK' : '대기'}</StatusPill>
                            </div>
                            {!check.done && <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{check.next}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <section className="admin-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-admin-base font-semibold text-admin-text-2">완전자동화 운영 단계</h2>
                  <p className="mt-1 text-admin-xs text-admin-muted">
                    구조는 L5까지 열어두고, 실제 외부 광고 집행은 채널별 예산과 자동화 레벨 안에서만 작동합니다.
                  </p>
                </div>
                <StatusPill tone="warn">현재 권장: L1-L2</StatusPill>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                {summary.automation_ladder.map((step) => (
                  <div key={step.level} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-admin-2xs font-bold text-admin-muted admin-num">L{step.level}</span>
                      <StatusPill tone={step.level <= 2 ? 'good' : step.level === 3 ? 'warn' : 'neutral'}>{step.label}</StatusPill>
                    </div>
                    <p className="mt-2 text-admin-xs font-semibold text-admin-text">{step.label}</p>
                    <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{step.description}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="admin-card p-4 xl:col-span-2">
              <h2 className="text-admin-base font-semibold text-admin-text-2">외부 연동 상태</h2>
              <div className="mt-3 space-y-2">
                {Object.entries(summary.integration_details).map(([platform, detail]) => (
                  <div key={platform} className="flex items-center justify-between rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                    <div>
                      <span className="text-admin-sm font-medium text-admin-text">{detail.label || PLATFORM_LABEL[platform] || platform}</span>
                      <p className="mt-0.5 text-admin-2xs text-admin-muted">{detail.note}</p>
                    </div>
                    <StatusPill tone={detail.configured ? 'good' : 'warn'}>
                      {detail.configured ? (
                        <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> 키 있음</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><KeyRound size={12} /> 키 필요</span>
                      )}
                    </StatusPill>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="admin-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-admin-base font-semibold text-admin-text-2">100점 기준 Ad OS 설계 점검</h2>
                <p className="mt-1 text-admin-xs text-admin-muted">
                  {summary.readiness_audit.items.length.toLocaleString('ko-KR')}개 항목으로 상품 feed, 키워드, 예산, API, 학습, 보안, 테넌트 확장성을 함께 점검합니다. {summary.readiness_audit.summary}
                </p>
              </div>
              <div className="text-left md:text-right">
                <p className="text-admin-2xs font-semibold text-admin-muted">현재 점수</p>
                <p className="admin-num text-admin-2xl font-bold text-admin-text">
                  {summary.readiness_audit.score}/{summary.readiness_audit.maxScore}
                  <span className="ml-2 text-admin-sm text-brand">{summary.readiness_audit.grade}</span>
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {summary.readiness_audit.items.map((check) => (
                <div key={check.id} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-admin-xs font-semibold text-admin-text">{check.label}</p>
                    <StatusPill tone={readinessTone(check.status)}>
                      {check.score}/{check.maxScore}
                    </StatusPill>
                  </div>
                  <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{check.evidence}</p>
                  <p className="mt-2 text-admin-2xs leading-5 text-admin-muted">{check.nextAction}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="admin-card p-4 xl:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-admin-base font-semibold text-admin-text-2">채널별 예산 가드레일</h2>
                <StatusPill tone={summary.channel_budgets.some((b) => b.configured) ? 'good' : 'warn'}>예산 캡</StatusPill>
              </div>
              <div className="mt-3 overflow-hidden rounded-admin-sm border border-admin-border">
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th>채널</th>
                      <th>월예산</th>
                      <th>일상한</th>
                      <th>Max CPC</th>
                      <th>외부 그룹 ID</th>
                      <th>레벨</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgetDrafts.map((budget) => (
                      <tr key={budget.platform}>
                        <td className="font-semibold text-admin-text">{PLATFORM_LABEL[budget.platform]}</td>
                        <td>
                          <input
                            className="w-24 rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-right text-admin-xs admin-num"
                            type="number"
                            min={0}
                            value={budget.monthly_budget_krw}
                            onChange={(event) => updateBudgetDraft(budget.platform, 'monthly_budget_krw', event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="w-24 rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-right text-admin-xs admin-num"
                            type="number"
                            min={0}
                            value={budget.daily_budget_cap_krw}
                            onChange={(event) => updateBudgetDraft(budget.platform, 'daily_budget_cap_krw', event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="w-20 rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-right text-admin-xs admin-num"
                            type="number"
                            min={0}
                            value={budget.max_cpc_krw}
                            onChange={(event) => updateBudgetDraft(budget.platform, 'max_cpc_krw', event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="w-44 rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-admin-xs"
                            type="text"
                            placeholder={budget.platform === 'naver' ? 'nccAdgroupId' : '선택'}
                            value={budget.external_ad_group_id || ''}
                            onChange={(event) => updateBudgetDraft(budget.platform, 'external_ad_group_id', event.target.value)}
                          />
                        </td>
                        <td>
                          <select
                            className="rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-admin-xs admin-num"
                            value={budget.automation_level}
                            onChange={(event) => updateBudgetDraft(budget.platform, 'automation_level', event.target.value)}
                          >
                            {[1, 2, 3, 4, 5].map((level) => (
                              <option key={level} value={level}>L{level}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="rounded-admin-xs border border-admin-border bg-admin-surface px-2 py-1 text-admin-xs"
                            value={budget.status}
                            onChange={(event) => updateBudgetDraft(budget.platform, 'status', event.target.value)}
                          >
                            <option value="paused">정지</option>
                            <option value="active">사용</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={saveBudgets} loading={savingBudget}>
                  <Save size={14} />
                  예산 저장
                </Button>
                <Button size="sm" variant="secondary" onClick={generateCandidates} loading={generatingCandidates}>
                  <Bot size={14} />
                  상품 후보 생성
                </Button>
                <Button size="sm" variant="secondary" onClick={runDryRun} loading={runningAutomation}>
                  <PlayCircle size={14} />
                  자동화 드라이런
                </Button>
                <Button size="sm" variant="secondary" onClick={runLaunchAudit} loading={runningLaunchAudit}>
                  <CheckCircle2 size={14} />
                  오늘 집행 감사
                </Button>
                <Button size="sm" variant="secondary" onClick={probePublisher} loading={probingPublisher}>
                  <KeyRound size={14} />
                  외부 계정 테스트
                </Button>
                <Button size="sm" variant="secondary" onClick={runGuardedApply} loading={runningGuardedApply}>
                  <ShieldCheck size={14} />
                  승인 후보 테스트 적용
                </Button>
                <Button size="sm" variant="secondary" onClick={runPilotSetup} loading={runningPilotSetup}>
                  <Rocket size={14} />
                  1단계 시범 세팅
                </Button>
                <Button size="sm" variant="secondary" onClick={publishDrafts} loading={publishingDrafts}>
                  <Rocket size={14} />
                  캠페인 드래프트 생성
                </Button>
                <Button size="sm" variant="secondary" onClick={publishNaverPausedKeywords} loading={publishingNaverKeywords}>
                  <PauseCircle size={14} />
                  네이버 정지 키워드 점검
                </Button>
                <Button size="sm" variant="secondary" onClick={approveNaverCandidates} loading={approvingNaverCandidates}>
                  <Check size={14} />
                  네이버 후보 승인
                </Button>
                <Button size="sm" variant="secondary" onClick={probeNaverAdgroups} loading={probingNaverAdgroups}>
                  <Search size={14} />
                  네이버 광고그룹 조회
                </Button>
                <Button size="sm" variant="secondary" onClick={probeNaverAssets} loading={probingNaverAssets}>
                  <Layers size={14} />
                  네이버 계정 자산 조회
                </Button>
                <Button size="sm" variant="secondary" onClick={syncNaverAssets} loading={syncingNaverAssets}>
                  <Save size={14} />
                  네이버 자산 자동저장
                </Button>
                <Button size="sm" variant="secondary" onClick={harvestLearning} loading={harvestingLearning}>
                  <Gauge size={14} />
                  성과 학습 수확
                </Button>
                <Button size="sm" variant="secondary" onClick={harvestSearchTerms} loading={harvestingSearchTerms}>
                  <Search size={14} />
                  검색어 수확 V11
                </Button>
                <Button size="sm" variant="secondary" onClick={syncPerformanceFacts} loading={syncingPerformance}>
                  <MousePointerClick size={14} />
                  성과 팩트 동기화
                </Button>
                <Button size="sm" variant="secondary" onClick={applyLearningRules} loading={applyingLearning}>
                  <ShieldCheck size={14} />
                  학습 적용 후보
                </Button>
                <Button size="sm" variant="secondary" onClick={planExperiments} loading={planningExperiments}>
                  <Bot size={14} />
                  실험 후보 생성
                </Button>
                <Button size="sm" variant="secondary" onClick={optimizePerformance} loading={optimizingPerformance}>
                  <ShieldCheck size={14} />
                  성과 최적화 드라이런
                </Button>
                <Button size="sm" variant="secondary" onClick={dryRunExternalPublish} loading={publishingExternal}>
                  <Rocket size={14} />
                  외부 발행 드라이런
                </Button>
                <Button size="sm" variant="secondary" onClick={probeGooglePublisher} loading={probingGooglePublisher}>
                  <KeyRound size={14} />
                  Google 권한 진단
                </Button>
                <Button size="sm" variant="secondary" onClick={runBudgetPacing} loading={runningBudgetPacing}>
                  <Wallet size={14} />
                  예산 페이싱 점검
                </Button>
                <Button size="sm" variant="secondary" onClick={loadTenantReport} loading={loadingTenantReport}>
                  <Download size={14} />
                  테넌트 리포트
                </Button>
                <Button size="sm" variant="secondary" onClick={runExpiryCleanup} loading={runningExpiryCleanup}>
                  <CalendarX size={14} />
                  만료 정리 점검
                </Button>
                <Button size="sm" variant="secondary" onClick={runKillSwitchDryRun} loading={runningKillSwitch}>
                  <PauseCircle size={14} />
                  전체 정지 점검
                </Button>
              </div>
              <p className="mt-2 text-admin-2xs text-admin-muted">
                예산 행이 없으면 외부 자동 집행은 막혀야 합니다. 후보 생성과 분석은 계속 가능합니다.
              </p>
              {automationMessage && (
                <p className="mt-2 rounded-admin-sm bg-emerald-50 px-3 py-2 text-admin-xs text-emerald-700">
                  {automationMessage}
                </p>
              )}
              {tenantReport?.report && (
                <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-admin-sm font-semibold text-admin-text">광고대행 월간 리포트 미리보기</p>
                      <p className="mt-1 text-admin-2xs text-admin-muted">매출 ROAS와 마진 ROAS를 분리해 테넌트 판매용 리포트로 보여줍니다.</p>
                    </div>
                    <StatusPill tone="neutral">
                      {String((tenantReport.period as { from?: string; to?: string } | undefined)?.from || '')}
                      {' ~ '}
                      {String((tenantReport.period as { from?: string; to?: string } | undefined)?.to || '')}
                    </StatusPill>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                    {[
                      ['예산 사용률', `${Number((tenantReport.report as Record<string, number>).budget_usage_pct || 0)}%`],
                      ['매출 ROAS', `${Number((tenantReport.report as Record<string, number>).revenue_roas_pct || 0)}%`],
                      ['마진 ROAS', `${Number((tenantReport.report as Record<string, number>).margin_roas_pct || 0)}%`],
                      ['CPA', fmtWon(Number((tenantReport.report as Record<string, number>).cpa_krw || 0))],
                      ['낭비 키워드', Number((tenantReport.report as Record<string, number>).paused_waste_keywords || 0).toLocaleString('ko-KR')],
                      ['저가 키워드', Number((tenantReport.report as Record<string, number>).discovered_cheap_keywords || 0).toLocaleString('ko-KR')],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-admin-xs bg-admin-surface px-3 py-2">
                        <p className="text-admin-2xs text-admin-muted">{label}</p>
                        <p className="mt-1 text-admin-xs font-semibold text-admin-text">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                    {(((tenantReport.report as { next_actions?: string[] }).next_actions || []) as string[]).map((action) => (
                      <div key={action} className="rounded-admin-xs border border-admin-border bg-admin-surface px-3 py-2 text-admin-2xs leading-5 text-admin-muted">
                        {action}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {launchAudit && (
                <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-admin-sm font-semibold text-admin-text">오늘 집행 감사 결과</p>
                      <p className="mt-1 text-admin-2xs text-admin-muted">{launchAudit.readiness.next_action}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone="good">통과 {launchAudit.readiness.pass}</StatusPill>
                      <StatusPill tone="warn">주의 {launchAudit.readiness.warn}</StatusPill>
                      <StatusPill tone="bad">실패 {launchAudit.readiness.fail}</StatusPill>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                    {launchAudit.items.map((check) => (
                      <div key={check.id} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-admin-xs font-semibold text-admin-text">{check.label}</p>
                          <StatusPill tone={auditTone(check.status)}>{check.status}</StatusPill>
                        </div>
                        <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{check.evidence}</p>
                        <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{check.next_action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="admin-card p-4">
              <h2 className="text-admin-base font-semibold text-admin-text-2">블로그 광고 매핑 상태</h2>
              <div className="mt-3 space-y-2">
                {Object.entries(summary.counts.mappings_by_status || {}).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="w-20 text-admin-xs font-semibold text-admin-text">{STATUS_LABEL[status] || status}</span>
                    <div className="h-2 flex-1 rounded-full bg-admin-surface-2 overflow-hidden">
                      <div className="h-full bg-brand" style={{ width: pct(count, totalMappingStatus) }} />
                    </div>
                    <span className="w-12 text-right text-admin-xs admin-num text-admin-muted">{count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="admin-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-admin-base font-semibold text-admin-text-2">성과 학습 큐</h2>
                <StatusPill tone={(summary.kpis.learning_events || 0) > 0 ? 'good' : 'neutral'}>{summary.kpis.learning_events || 0}개</StatusPill>
              </div>
              <div className="mt-3 space-y-2">
                {summary.samples.learning_events.length === 0 ? (
                  <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
                    아직 학습 신호가 없습니다. 광고 클릭, CTA, 예약 전환이 쌓이면 다음 키워드와 랜딩 개선 후보로 저장됩니다.
                  </div>
                ) : (
                  summary.samples.learning_events.slice(0, 6).map((row, idx) => (
                    <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-admin-xs font-semibold text-admin-text">{String(row.signal_type || '-')}</p>
                        <StatusPill tone={row.status === 'candidate' ? 'warn' : 'good'}>{String(row.status || '-')}</StatusPill>
                      </div>
                      <p className="mt-1 text-admin-2xs text-admin-muted">{String(row.recommendation || '').slice(0, 90)}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="admin-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-admin-base font-semibold text-admin-text-2">상품별 광고 시나리오</h2>
                <StatusPill tone={(summary.kpis.product_scenarios || 0) > 0 ? 'good' : 'neutral'}>{summary.kpis.product_scenarios || 0}개</StatusPill>
              </div>
              <div className="mt-3 space-y-2">
                {(summary.samples.product_scenarios || []).length === 0 ? (
                  <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
                    상품 승인 또는 후보 생성을 실행하면 출발지, 부모님/가족, 가격 비교, 마감 임박 같은 시나리오가 쌓입니다.
                  </div>
                ) : (
                  summary.samples.product_scenarios.slice(0, 6).map((row, idx) => (
                    <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-admin-xs font-semibold text-admin-text">{String(row.scenario_type || '-')}</p>
                        <StatusPill>{String(row.status || 'candidate')}</StatusPill>
                      </div>
                      <p className="mt-1 text-admin-2xs text-admin-muted">
                        {String(row.funnel_stage || '-')} · {String(row.landing_strategy || '-')} · {String(row.recommended_channel || '-')}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="admin-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-admin-base font-semibold text-admin-text-2">블로그 진화 큐</h2>
                <StatusPill tone={(summary.kpis.landing_evolution_candidates || 0) > 0 ? 'warn' : 'neutral'}>{summary.kpis.landing_evolution_candidates || 0}개</StatusPill>
              </div>
              <div className="mt-3 space-y-2">
                {(summary.samples.landing_evolution_queue || []).length === 0 ? (
                  <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
                    아직 CTA 교체, 기존 글 업데이트, 신규 글 생성 후보가 없습니다. 성과 학습 또는 상품 승인 후 자동 생성됩니다.
                  </div>
                ) : (
                  summary.samples.landing_evolution_queue.slice(0, 6).map((row, idx) => (
                    <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-admin-xs font-semibold text-admin-text">{String(row.action || '-')}</p>
                        <StatusPill tone={row.status === 'candidate' ? 'warn' : 'good'}>{String(row.status || '-')}</StatusPill>
                      </div>
                      <p className="mt-1 text-admin-2xs text-admin-muted">{String(row.reason || '').slice(0, 90)}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="admin-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-admin-base font-semibold text-admin-text-2">AI 변경 승인 큐</h2>
                <StatusPill tone={(summary.kpis.change_requests_proposed || 0) > 0 ? 'warn' : 'neutral'}>{summary.kpis.change_requests_proposed || 0}개</StatusPill>
              </div>
              <div className="mt-3 space-y-2">
                {(summary.samples.change_requests || []).length === 0 ? (
                  <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
                    아직 승인 대기 변경이 없습니다. 성과 최적화나 예산 페이싱이 정지/증액/교체 후보를 만들면 여기에 쌓입니다.
                  </div>
                ) : (
                  summary.samples.change_requests.slice(0, 6).map((row, idx) => (
                    <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-admin-xs font-semibold text-admin-text">{String(row.title || row.request_type || '-')}</p>
                        <StatusPill tone={['high', 'critical'].includes(String(row.risk_level || '')) ? 'bad' : row.status === 'proposed' ? 'warn' : 'good'}>
                          {String(row.status || '-')}
                        </StatusPill>
                      </div>
                      <p className="mt-1 text-admin-2xs text-admin-muted">
                        {String(row.platform || 'internal')} · {String(row.risk_level || 'medium')} · {String(row.reason || '').slice(0, 70)}
                      </p>
                      {String(row.status || '') === 'proposed' && String(row.id || '') && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updateChangeRequest(String(row.id), 'approved')}
                            loading={changeRequestActionId === String(row.id)}
                          >
                            <Check size={13} />
                            승인
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateChangeRequest(String(row.id), 'rejected')}
                            loading={changeRequestActionId === String(row.id)}
                          >
                            <X size={13} />
                            거절
                          </Button>
                        </div>
                      )}
                      {String(row.status || '') === 'approved' && String(row.id || '') && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updateChangeRequest(String(row.id), 'applied')}
                            loading={changeRequestActionId === String(row.id)}
                          >
                            <PlayCircle size={13} />
                            적용
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateChangeRequest(String(row.id), 'rolled_back')}
                            loading={changeRequestActionId === String(row.id)}
                          >
                            <X size={13} />
                            롤백
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="admin-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-admin-base font-semibold text-admin-text-2">최근 매핑 후보</h2>
                <Link href="/admin/blog/ads" className="inline-flex items-center gap-1 text-admin-xs font-semibold text-brand hover:underline">
                  전체 보기 <ArrowRight size={12} />
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {summary.samples.mappings.slice(0, 8).map((row, idx) => (
                  <div key={String(row.id || idx)} className="flex items-center justify-between gap-3 rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-admin-sm font-semibold text-admin-text">{String(row.keyword || '-')}</p>
                      <p className="text-admin-2xs text-admin-muted">{PLATFORM_LABEL[String(row.platform)] || String(row.platform || '')}</p>
                    </div>
                    <StatusPill>{STATUS_LABEL[String(row.operational_status)] || String(row.operational_status || 'candidate')}</StatusPill>
                  </div>
                ))}
              </div>
            </section>

            <section className="admin-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-admin-base font-semibold text-admin-text-2">최근 키워드 후보</h2>
                <Link href="/admin/search-ads" className="inline-flex items-center gap-1 text-admin-xs font-semibold text-brand hover:underline">
                  전체 보기 <ArrowRight size={12} />
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {summary.samples.keyword_plans.length === 0 ? (
                  <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
                    키워드 후보가 없습니다. 상품 후보 생성을 누르면 활성 상품에서 네이버/구글 검색광고 후보를 만듭니다.
                  </div>
                ) : (
                  summary.samples.keyword_plans.slice(0, 8).map((row, idx) => {
                    const id = String(row.id || idx);
                    const status = String(row.autopilot_status || row.plan_status || 'candidate');
                    return (
                      <div key={id} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-admin-sm font-semibold text-admin-text">{String(row.keyword_text || '-')}</p>
                            <p className="text-admin-2xs text-admin-muted">
                              {PLATFORM_LABEL[String(row.platform)] || String(row.platform || '')} · {String(row.tier || '-')} · {fmtWon(Number(row.suggested_bid_krw || 0))}
                            </p>
                          </div>
                          <StatusPill>{STATUS_LABEL[status] || status}</StatusPill>
                        </div>
                        {status === 'candidate' && (
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => updateKeywordPlan(id, 'approve')} loading={keywordActionId === id}>
                              <Check size={13} />
                              승인
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => updateKeywordPlan(id, 'archive')} loading={keywordActionId === id}>
                              <X size={13} />
                              보류
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="admin-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-admin-base font-semibold text-admin-text-2">최근 자동화 판단</h2>
                <StatusPill tone={summary.recent_decisions.length > 0 ? 'good' : 'neutral'}>{summary.recent_decisions.length}건</StatusPill>
              </div>
              <div className="mt-3 space-y-2">
                {summary.recent_decisions.length === 0 ? (
                  <div className="rounded-admin-sm bg-admin-surface-2 p-4 text-admin-xs text-admin-muted">
                    아직 자동화 판단 로그가 없습니다. 다음 단계에서 추천/집행 엔진이 여기에 근거와 결과를 남깁니다.
                  </div>
                ) : (
                  summary.recent_decisions.slice(0, 8).map((row, idx) => (
                    <div key={String(row.id || idx)} className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-admin-xs font-semibold text-admin-text">{String(row.decision_type || '-')}</p>
                        <StatusPill tone={row.applied ? 'good' : 'neutral'}>{row.applied ? '적용' : '기록'}</StatusPill>
                      </div>
                      <p className="mt-1 line-clamp-2 text-admin-2xs text-admin-muted">{String(row.reason || '')}</p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <section className="admin-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-admin-base font-semibold text-admin-text-2">오늘 시작 가능한 운영 방식</h2>
                <p className="mt-1 text-admin-xs text-admin-muted">
                  API 키가 없는 채널은 후보 생성/분석까지만, 키가 있는 채널은 예산 캡 설정 후 승인형 집행까지 확장합니다.
                </p>
              </div>
              <ShieldCheck className="text-brand" size={20} />
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                <Bot size={16} className="text-brand" />
                <p className="mt-2 text-admin-sm font-semibold text-admin-text">AI 추천</p>
                <p className="mt-1 text-admin-2xs text-admin-muted">상품별 시나리오, 초세부 키워드, 블로그/상품 랜딩 후보를 생성합니다.</p>
              </div>
              <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                <PauseCircle size={16} className="text-amber-600" />
                <p className="mt-2 text-admin-sm font-semibold text-admin-text">가드레일</p>
                <p className="mt-1 text-admin-2xs text-admin-muted">예산 미설정/만료 상품/키 미설정 상태에서는 외부 집행을 차단합니다.</p>
              </div>
              <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                <Rocket size={16} className="text-emerald-600" />
                <p className="mt-2 text-admin-sm font-semibold text-admin-text">자동화 확장</p>
                <p className="mt-1 text-admin-2xs text-admin-muted">성과가 쌓이면 L3 소액 테스트, L4 입찰/중지 자동화로 올립니다.</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
