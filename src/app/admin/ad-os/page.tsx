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
  };
  automation_ladder: Array<{ level: number; label: string; description: string }>;
};

type BudgetDraft = Summary['channel_budgets'][number];
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
  const [runningAutomation, setRunningAutomation] = useState(false);
  const [runningGuardedApply, setRunningGuardedApply] = useState(false);
  const [runningPilotSetup, setRunningPilotSetup] = useState(false);
  const [publishingDrafts, setPublishingDrafts] = useState(false);
  const [publishingNaverKeywords, setPublishingNaverKeywords] = useState(false);
  const [harvestingLearning, setHarvestingLearning] = useState(false);
  const [optimizingPerformance, setOptimizingPerformance] = useState(false);
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
  const [keywordActionId, setKeywordActionId] = useState<string | null>(null);
  const [automationMessage, setAutomationMessage] = useState<string | null>(null);
  const [launchAudit, setLaunchAudit] = useState<LaunchAudit | null>(null);
  const [naverSetupPacket, setNaverSetupPacket] = useState<NaverSetupPacket | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchSummary()
      .then((json) => {
        if (alive) {
          setSummary(json);
          setBudgetDrafts(json.channel_budgets);
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
  };
  const topQueuedAction = summary?.launch_action_queue?.[0] || null;

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
                <Button size="sm" variant="secondary" onClick={optimizePerformance} loading={optimizingPerformance}>
                  <ShieldCheck size={14} />
                  성과 최적화 드라이런
                </Button>
                <Button size="sm" variant="secondary" onClick={runExpiryCleanup} loading={runningExpiryCleanup}>
                  <CalendarX size={14} />
                  만료 정리 점검
                </Button>
              </div>
                <Button size="sm" variant="secondary" onClick={runKillSwitchDryRun} loading={runningKillSwitch}>
                  <PauseCircle size={14} />
                  전체 정지 점검
                </Button>
              <p className="mt-2 text-admin-2xs text-admin-muted">
                예산 행이 없으면 외부 자동 집행은 막혀야 합니다. 후보 생성과 분석은 계속 가능합니다.
              </p>
              {automationMessage && (
                <p className="mt-2 rounded-admin-sm bg-emerald-50 px-3 py-2 text-admin-xs text-emerald-700">
                  {automationMessage}
                </p>
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
