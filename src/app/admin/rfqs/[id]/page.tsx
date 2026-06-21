'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import DOMPurify from 'dompurify';
import { ArrowRight } from 'lucide-react';

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

// ── 타입 정의 ────────────────────────────────────────────────────────────────
interface GroupRfq {
  id: string;
  rfq_code: string;
  status: string;
  destination: string;
  adult_count: number;
  child_count: number;
  budget_per_person: number;
  hotel_grade: string;
  meal_plan: string;
  transport: string;
  special_requests: string;
  customer_name?: string;
  bid_deadline: string | null;
  created_at: string;
  custom_requirements?: Record<string, unknown> | null;
}

interface ChecklistItem {
  included: boolean;
  amount?: number;
  memo?: string;
}

interface RfqBid {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tier?: string;
  status: string;
  trust_score?: number;
  claim_deadline?: string;
  submit_deadline?: string;
  claimed_at?: string;
  submitted_at?: string;
}

interface RfqProposal {
  id: string;
  rfq_id: string;
  tenant_name?: string;
  rank: number | null;
  proposal_title: string;
  total_cost: number;
  total_selling_price: number;
  real_total_price: number;
  hidden_cost_estimate: number;
  checklist: Record<string, ChecklistItem>;
  ai_review: {
    score: number;
    issues: string[];
    key_insights?: string[];
    fact_check?: string;
  };
  status: string;
}

interface RfqMessage {
  id: string;
  sender_type: string;
  raw_content: string;
  processed_content: string;
  pii_blocked: boolean;
  is_visible_to_customer: boolean;
  created_at: string;
}

type Tab = 'info' | 'bids' | 'proposals' | 'messages';

type RfqNotice = {
  tone: 'success' | 'error';
  message: string;
};

type RfqNextAction = {
  tab: Tab;
  label: string;
  reason: string;
  detail: string;
};

// ── 상수 ─────────────────────────────────────────────────────────────────────
const TIER_COLORS: Record<string, string> = {
  GOLD: 'bg-yellow-100 text-yellow-800',
  SILVER: 'bg-admin-surface-2 text-admin-text-2',
  BRONZE: 'bg-orange-100 text-orange-700',
};

const BID_STATUS_LABELS: Record<string, string> = {
  invited: '대기중',
  locked: '참여확정',
  submitted: '제출완료',
  timeout: '타임아웃',
  rejected: '탈락',
};

const STATUS_TRANSITIONS = [
  { action: 'published', label: '공고 등록', status: 'published' },
  { action: 'bidding', label: '입찰 시작', status: 'bidding' },
  { action: 'analyzing', label: 'AI 분석 트리거', status: 'analyzing' },
  { action: 'awaiting_selection', label: '선택 대기', status: 'awaiting_selection' },
];

const fmt = (n: number) => n.toLocaleString('ko-KR');

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return s.slice(0, 16).replace('T', ' ');
}

function getRequirementText(rfq: GroupRfq, key: string): string | null {
  const value = rfq.custom_requirements?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getRequirementList(rfq: GroupRfq, key: string): string[] {
  const value = rfq.custom_requirements?.[key];
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function getRfqNextAction(
  rfq: GroupRfq,
  bids: RfqBid[],
  proposals: RfqProposal[],
  hasHandoffContext: boolean,
): RfqNextAction {
  const bidCount = bids.length;
  const proposalCount = proposals.length;

  switch (rfq.status) {
    case 'draft':
      return {
        tab: 'info',
        label: '요건 검수',
        reason: hasHandoffContext
          ? '상담 원문과 관심 상품을 먼저 확인하고 누락 조건을 정리하세요.'
          : '목적지, 인원, 예산, 특별요청을 확정해 공고 품질을 맞추세요.',
        detail: '고객 요구를 정리한 뒤 공고 등록으로 넘기면 됩니다.',
      };
    case 'published':
      return {
        tab: 'bids',
        label: '입찰 초대',
        reason: bidCount > 0
          ? `현재 참여 후보 ${bidCount}건이 있습니다. 응답 상태를 확인하세요.`
          : '아직 참여 후보가 없어 파트너 초대가 필요합니다.',
        detail: '파트너 반응을 확인하고 입찰 시작 준비 상태를 맞추세요.',
      };
    case 'bidding':
      return {
        tab: 'bids',
        label: '마감 확인',
        reason: bidCount > 0
          ? `입찰 ${bidCount}건이 진행 중입니다. 마감 임박 건과 미제출 건을 보세요.`
          : '입찰 대기 중입니다. 파트너 참여 상태를 먼저 확인하세요.',
        detail: '마감 전 제출 상태를 정리해 분석 단계 지연을 줄입니다.',
      };
    case 'analyzing':
      return {
        tab: 'proposals',
        label: 'AI 분석 확인',
        reason: proposalCount > 0
          ? `제안서 ${proposalCount}건의 가격, 리스크, 포함 조건을 비교하세요.`
          : '제안서가 아직 없습니다. 제출 여부를 먼저 확인하세요.',
        detail: '고객에게 보여줄 후보와 제외 사유를 함께 정리하세요.',
      };
    case 'awaiting_selection':
      return {
        tab: 'proposals',
        label: '고객 선택',
        reason: proposalCount > 0
          ? `고객에게 안내할 제안서 ${proposalCount}건과 추천 순서를 확정하세요.`
          : '선택 대기 전 제안서 상태가 비어 있습니다. 후보를 다시 확인하세요.',
        detail: '추천/비추천 근거를 남기면 상담 후속 처리 속도가 빨라집니다.',
      };
    case 'contracted':
      return {
        tab: 'messages',
        label: '계약 확인',
        reason: '계약 이후 고객/파트너 후속 메시지와 누락 요청을 확인하세요.',
        detail: '후속 안내와 결제/예약 처리 상태를 맞추면 됩니다.',
      };
    default:
      return {
        tab: 'info',
        label: '상세 확인',
        reason: 'RFQ 요건과 진행 상태를 확인하세요.',
        detail: '상태에 맞는 탭에서 다음 업무를 이어가면 됩니다.',
      };
  }
}

// ── 타이머 컴포넌트 ──────────────────────────────────────────────────────────
function Countdown({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function update() {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('만료됨');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}시간 ${m}분 ${s}초`);
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadline]);

  return <span className="font-mono text-red-600 text-xs">{remaining}</span>;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function AdminRfqDetailPage() {
  const params = useParams();
  const id = getRouteParam(params?.id);
  const encodedId = encodeURIComponent(id);

  const [rfq, setRfq] = useState<GroupRfq | null>(null);
  const [bids, setBids] = useState<RfqBid[]>([]);
  const [proposals, setProposals] = useState<RfqProposal[]>([]);
  const [messages, setMessages] = useState<RfqMessage[]>([]);
  const [report, setReport] = useState<{ report_html: string; key_insights: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('info');
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState<RfqNotice | null>(null);

  useEffect(() => {
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  }, [id]);

  async function fetchAll() {
    if (!id) {
      setError('RFQ ID가 올바르지 않습니다');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [rfqRes, bidsRes, propsRes, msgsRes] = await Promise.all([
        fetch(`/api/rfq/${encodedId}`),
        fetch(`/api/rfq/${encodedId}/bid`),
        fetch(`/api/rfq/${encodedId}/proposals`),
        fetch(`/api/rfq/${encodedId}/messages?viewAs=admin`),
      ]);
      if (!rfqRes.ok) throw new Error('RFQ 데이터를 불러올 수 없습니다');
      const rfqData = await rfqRes.json();
      setRfq(rfqData.rfq ?? rfqData);
      if (bidsRes.ok) {
        const bidsData = await bidsRes.json();
        setBids(Array.isArray(bidsData) ? bidsData : (bidsData.bids ?? []));
      }
      if (propsRes.ok) {
        const propsData = await propsRes.json();
        setProposals(Array.isArray(propsData) ? propsData : (propsData.proposals ?? []));
      }
      if (msgsRes.ok) {
        const msgsData = await msgsRes.json();
        setMessages(Array.isArray(msgsData) ? msgsData : (msgsData.messages ?? []));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function transition(status: string) {
    if (!id) return;
    setTransitioning(status);
    try {
      const res = await fetch(`/api/rfq/${encodedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'transition', status }),
      });
      if (!res.ok) throw new Error('상태 변경 실패');
      await fetchAll();
      setNotice({ tone: 'success', message: 'RFQ 상태가 변경되었습니다.' });
    } catch {
      setNotice({ tone: 'error', message: '상태 변경 중 오류가 발생했습니다.' });
    } finally {
      setTransitioning(null);
    }
  }

  async function runAnalysis() {
    if (!id) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/rfq/${encodedId}/analyze`, { method: 'POST' });
      if (!res.ok) throw new Error('분석 실패');
      const data = await res.json();
      setReport(data);
      setNotice({ tone: 'success', message: 'AI 분석이 완료되었습니다.' });
    } catch {
      setNotice({ tone: 'error', message: 'AI 분석 중 오류가 발생했습니다.' });
    } finally {
      setAnalyzing(false);
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'info', label: '요건정보' },
    { key: 'bids', label: `입찰현황 (${bids.length})` },
    { key: 'proposals', label: `제안서 비교 (${proposals.length})` },
    { key: 'messages', label: `메시지 (${messages.length})` },
  ];

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-3xl">
        <div className="h-6 bg-admin-surface-2 rounded animate-pulse w-48" />
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-28 shrink-0" />
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (error || !rfq) {
    return (
      <div className="p-6 max-w-3xl">
        <div className="rounded-admin-md border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error || 'RFQ를 찾을 수 없습니다'}
        </div>
        <Link href="/admin/rfqs" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          RFQ 목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const handoffQuery = getRequirementText(rfq, 'handoff_query');
  const handoffSource = getRequirementText(rfq, 'handoff_source') ?? getRequirementText(rfq, 'source');
  const selectedProducts = getRequirementList(rfq, 'selected_products');
  const hasHandoffContext = Boolean(handoffQuery || handoffSource || selectedProducts.length > 0);
  const nextAction = getRfqNextAction(rfq, bids, proposals, hasHandoffContext);
  const requirementReadinessItems = [
    { label: '목적지', value: rfq.destination || '미입력', complete: Boolean(rfq.destination) },
    { label: '인원', value: `${rfq.adult_count + rfq.child_count}명`, complete: rfq.adult_count + rfq.child_count > 0 },
    { label: '예산', value: rfq.budget_per_person > 0 ? `₩${fmt(rfq.budget_per_person)}` : '미입력', complete: rfq.budget_per_person > 0 },
  ];
  const requirementReadyCount = requirementReadinessItems.filter((item) => item.complete).length;
  const requirementMissingLabels = requirementReadinessItems.filter((item) => !item.complete).map((item) => item.label);
  const requirementReadinessText = requirementMissingLabels.length > 0
    ? `요건 준비 ${requirementReadyCount}/${requirementReadinessItems.length}. 남은 항목은 ${requirementMissingLabels.join(', ')}입니다.`
    : `요건 준비 ${requirementReadyCount}/${requirementReadinessItems.length}. 공고 전환에 필요한 핵심 요건이 준비되었습니다.`;
  const transitionDecisionText = requirementMissingLabels.length > 0
    ? `전환 전 ${requirementMissingLabels.join(', ')} 항목을 보완하면 공고 품질 리스크가 낮아집니다.`
    : '핵심 요건이 준비되어 다음 상태로 전환할 수 있습니다.';
  const sortedProposals = [...proposals].sort((a, b) => {
    const rankA = a.rank ?? Number.POSITIVE_INFINITY;
    const rankB = b.rank ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;
    return (b.ai_review?.score ?? 0) - (a.ai_review?.score ?? 0);
  });
  const recommendedProposal = sortedProposals[0] ?? null;
  const lowestRealPrice = proposals
    .map((proposal) => proposal.real_total_price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .reduce<number | null>((lowest, price) => (lowest == null || price < lowest ? price : lowest), null);
  const proposalIssueCount = proposals.reduce((sum, proposal) => sum + (proposal.ai_review?.issues?.length ?? 0), 0);
  const submittedBidCount = bids.filter((bid) => Boolean(bid.submitted_at) || bid.status === 'submitted').length;
  const timeoutBidCount = bids.filter((bid) => bid.status === 'timeout').length;
  const lockedBidCount = bids.filter((bid) => bid.status === 'locked').length;
  const pendingBidCount = Math.max(bids.length - submittedBidCount - timeoutBidCount, 0);
  const topTrustBid = [...bids]
    .filter((bid) => bid.trust_score != null)
    .sort((a, b) => (b.trust_score ?? -1) - (a.trust_score ?? -1))[0] ?? null;
  const bidSummaryText = bids.length > 0
    ? `입찰 ${bids.length}건 중 제출 ${submittedBidCount}건, 진행/대기 ${pendingBidCount}건, 마감 초과 ${timeoutBidCount}건입니다. ${topTrustBid ? `신뢰도 최고 후보는 ${topTrustBid.tenant_name || topTrustBid.tenant_id.slice(0, 8)} ${topTrustBid.trust_score}점입니다.` : '신뢰도 점수는 아직 없습니다.'}`
    : '입찰 내역이 없습니다.';
  const customerMessageCount = messages.filter((message) => message.sender_type === 'customer').length;
  const tenantMessageCount = messages.filter((message) => message.sender_type === 'tenant').length;
  const blockedMessageCount = messages.filter((message) => message.pii_blocked).length;
  const hiddenMessageCount = messages.filter((message) => !message.is_visible_to_customer).length;
  const latestMessage = [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const messageSummaryText = messages.length > 0
    ? `메시지 ${messages.length}건 중 고객 ${customerMessageCount}건, 랜드사 ${tenantMessageCount}건입니다. PII 차단 ${blockedMessageCount}건, 고객 비공개 ${hiddenMessageCount}건이 있고, 최근 메시지는 ${latestMessage ? fmtDate(latestMessage.created_at) : '없음'}입니다.`
    : '메시지 내역이 없습니다.';
  const proposalSummaryText = recommendedProposal
    ? `추천 후보는 ${recommendedProposal.tenant_name || '랜드사'} ${recommendedProposal.ai_review?.score ?? '점수 없음'}점입니다. 최저 실질 총액은 ${lowestRealPrice ? `₩${fmt(lowestRealPrice)}` : '미정'}이고, AI 검토 리스크는 ${proposalIssueCount}건입니다.`
    : '제출된 제안서가 없어 비교 요약을 만들 수 없습니다.';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin/rfqs" className="text-sm text-indigo-600 hover:underline">
            ← RFQ 목록
          </Link>
          <h1 className="text-2xl font-bold text-admin-text mt-1">
            {rfq.rfq_code}
          </h1>
          <p className="text-sm text-admin-muted">{rfq.destination} · {rfq.customer_name || '고객'}</p>
        </div>
        <span className="text-sm bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full font-semibold">
          {rfq.status}
        </span>
      </div>

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          className={`rounded-admin-md border px-4 py-3 text-admin-sm ${
            notice.tone === 'error'
              ? 'border-status-dangerBorder bg-status-dangerBg text-status-dangerFg'
              : 'border-status-successBorder bg-status-successBg text-status-successFg'
          }`}
        >
          {notice.message}
        </div>
      )}

      <section
        aria-labelledby="admin-rfq-next-action-title"
        aria-describedby="admin-rfq-next-action-reason admin-rfq-requirement-readiness admin-rfq-next-action-status"
        className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4 shadow-admin-xs"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-admin-xs font-semibold uppercase text-admin-muted">Next action</p>
            <h2 id="admin-rfq-next-action-title" className="mt-1 text-admin-lg font-bold text-admin-text">
              {nextAction.label}
            </h2>
            <p id="admin-rfq-next-action-reason" className="mt-1 max-w-3xl text-admin-sm text-admin-muted">
              {nextAction.reason}
            </p>
            <p className="mt-1 text-admin-xs text-admin-text-2">{nextAction.detail}</p>
            <p id="admin-rfq-next-action-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {`현재 다음 단계는 ${nextAction.label}입니다. ${nextAction.reason} ${requirementReadinessText}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab(nextAction.tab)}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-admin-xs border border-admin-border-mid bg-admin-surface px-3 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            해당 탭 보기
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div
          id="admin-rfq-requirement-readiness"
          data-testid="admin-rfq-requirement-readiness"
          aria-label={requirementReadinessText}
          className="mt-4 rounded-admin-sm border border-admin-border-mid bg-admin-surface-2 px-3 py-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-admin-xs font-bold text-admin-text">
              요건 준비 {requirementReadyCount}/{requirementReadinessItems.length}
            </p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              requirementMissingLabels.length > 0 ? 'bg-white text-admin-muted ring-1 ring-admin-border-mid' : 'bg-status-successBg text-status-successFg'
            }`}
            >
              {requirementMissingLabels.length > 0 ? '보완 필요' : '공고 전환 가능'}
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {requirementReadinessItems.map((item) => (
              <div key={item.label} className="rounded-admin-xs bg-admin-surface px-2.5 py-2">
                <p className="text-[11px] font-semibold text-admin-muted">{item.label}</p>
                <p className={`mt-0.5 truncate text-admin-xs font-bold ${item.complete ? 'text-admin-text-2' : 'text-status-dangerFg'}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
        <dl className="mt-4 grid gap-2 text-admin-xs sm:grid-cols-3">
          {[
            ['입찰', `${bids.length}건`],
            ['제안서', `${proposals.length}건`],
            ['상담 유입', hasHandoffContext ? '있음' : '없음'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-admin-xs bg-admin-surface-2 px-3 py-2">
              <dt className="font-semibold text-admin-muted">{label}</dt>
              <dd className="mt-0.5 font-bold text-admin-text">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 탭 */}
      <div
        role="tablist"
        aria-label="RFQ 상세 정보"
        className="flex w-full gap-1 overflow-x-auto rounded-admin-md bg-admin-surface-2 p-1 sm:w-fit"
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`admin-rfq-${tab.key}-tab`}
            aria-selected={activeTab === tab.key}
            aria-controls={`admin-rfq-${tab.key}-panel`}
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              activeTab === tab.key
                ? 'bg-white shadow-admin-xs text-indigo-700 font-semibold'
                : 'text-admin-muted hover:text-admin-text-2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab 1: 요건정보 ─────────────────────────────────────────────────── */}
      {activeTab === 'info' && (
        <div id="admin-rfq-info-panel" role="tabpanel" aria-labelledby="admin-rfq-info-tab" className="space-y-4">
          <div className="bg-white border shadow-admin-xs rounded-admin-md p-5">
            <h2 className="font-semibold text-admin-text mb-4">RFQ 요건</h2>
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ['RFQ 코드', rfq.rfq_code],
                ['고객명', rfq.customer_name || '—'],
                ['목적지', rfq.destination],
                ['인원', `성인 ${rfq.adult_count}명 / 아동 ${rfq.child_count}명`],
                ['예산 (1인)', `₩${fmt(rfq.budget_per_person)}`],
                ['호텔등급', rfq.hotel_grade || '—'],
                ['식사', rfq.meal_plan || '—'],
                ['교통', rfq.transport || '—'],
                ['입찰 마감', fmtDate(rfq.bid_deadline)],
                ['등록일', fmtDate(rfq.created_at)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span className="text-admin-muted">{label}: </span>
                  <span className="font-medium text-admin-text-2">{value}</span>
                </div>
              ))}
              {rfq.special_requests && (
                <div className="sm:col-span-2">
                  <span className="text-admin-muted">특별요청: </span>
                  <span className="font-medium text-admin-text-2">{rfq.special_requests}</span>
                </div>
              )}
            </div>
          </div>

          {hasHandoffContext && (
            <section
              data-testid="admin-rfq-handoff-context"
              aria-labelledby="admin-rfq-handoff-title"
              className="bg-white border border-admin-border-mid shadow-admin-xs rounded-admin-md p-5"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 id="admin-rfq-handoff-title" className="font-semibold text-admin-text">
                    고객 유입 문맥
                  </h2>
                  <p className="mt-1 text-admin-xs text-admin-muted">
                    접수 전에 고객이 남긴 원문 조건과 관심 상품입니다.
                  </p>
                </div>
                {handoffSource && (
                  <span className="w-fit rounded-full bg-admin-surface-2 px-2.5 py-1 text-admin-xs font-semibold text-admin-text-2">
                    {handoffSource}
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 text-admin-sm sm:grid-cols-2">
                {handoffQuery && (
                  <div data-testid="admin-rfq-handoff-query" className="rounded-admin-sm bg-admin-surface-2 px-3 py-2 sm:col-span-2">
                    <p className="text-admin-xs font-semibold text-admin-muted">원문 요청</p>
                    <p className="mt-1 font-medium text-admin-text-2">{handoffQuery}</p>
                  </div>
                )}

                {selectedProducts.length > 0 && (
                  <div data-testid="admin-rfq-handoff-products" className="rounded-admin-sm bg-admin-surface-2 px-3 py-2 sm:col-span-2">
                    <p className="text-admin-xs font-semibold text-admin-muted">관심 상품 {selectedProducts.length}개</p>
                    <p className="mt-1 font-medium text-admin-text-2">
                      {selectedProducts.join(', ')}
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 상태 전환 (테스트) */}
          <div className="bg-white border shadow-admin-xs rounded-admin-md p-5">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold text-admin-text">
                상태 전환
                <span className="ml-2 text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded">테스트용</span>
              </h2>
              <p
                id="admin-rfq-transition-decision"
                data-testid="admin-rfq-transition-decision"
                className={`rounded-admin-xs px-2.5 py-1 text-admin-xs font-semibold ${
                  requirementMissingLabels.length > 0
                    ? 'bg-status-warningBg text-status-warningFg'
                    : 'bg-status-successBg text-status-successFg'
                }`}
              >
                {transitionDecisionText}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-describedby="admin-rfq-transition-decision">
              {STATUS_TRANSITIONS.map((t) => (
                <button
                  key={t.action}
                  type="button"
                  onClick={() => transition(t.status)}
                  disabled={transitioning === t.status}
                  className="rounded-lg border border-indigo-300 px-3 py-2 text-left text-sm text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-50"
                  aria-describedby="admin-rfq-transition-decision"
                >
                  <span className="block font-semibold">테스트: {t.label}</span>
                  <span className="mt-1 block text-xs text-indigo-700/70">
                    {t.status === rfq.status ? '현재 상태입니다.' : transitionDecisionText}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 2: 입찰현황 ─────────────────────────────────────────────────── */}
      {activeTab === 'bids' && (
        <div id="admin-rfq-bids-panel" role="tabpanel" aria-labelledby="admin-rfq-bids-tab" className="space-y-3">
          <div className="flex flex-col gap-3 rounded-admin-md border border-admin-border-mid bg-white p-4 shadow-admin-xs lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-admin-xs font-semibold uppercase text-admin-muted">Bid summary</p>
              <p
                data-testid="admin-rfq-bid-summary"
                aria-label={bidSummaryText}
                className="mt-1 text-admin-sm font-semibold text-admin-text"
              >
                제출 {submittedBidCount}/{bids.length} · 진행/대기 {pendingBidCount} · 마감초과 {timeoutBidCount}
              </p>
              <p className="mt-1 text-admin-xs text-admin-muted">{bidSummaryText}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-admin-xs text-admin-muted sm:grid-cols-4">
              <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                <span className="block font-semibold text-admin-text">{bids.length}</span>
                전체 입찰
              </div>
              <div className="rounded-admin-sm bg-status-successBg px-3 py-2 text-status-successFg">
                <span className="block font-semibold">{submittedBidCount}</span>
                제출 완료
              </div>
              <div className="rounded-admin-sm bg-status-warningBg px-3 py-2 text-status-warningFg">
                <span className="block font-semibold">{lockedBidCount}</span>
                작성 중
              </div>
              <div className="rounded-admin-sm bg-status-dangerBg px-3 py-2 text-status-dangerFg">
                <span className="block font-semibold">{timeoutBidCount}</span>
                마감 초과
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-admin-md border bg-white shadow-admin-xs">
          {bids.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <svg className="w-9 h-9 text-admin-border-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" /></svg>
              <p className="text-admin-sm font-medium text-admin-muted">입찰 내역이 없습니다</p>
            </div>
          ) : (
            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-admin-bg border-b">
                <tr>
                  {['랜드사명', '티어', '입찰시각', '제출마감', '제출여부', '신뢰도', '상태'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-admin-muted uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bids.map((bid) => (
                  <tr key={bid.id} className="hover:bg-admin-bg">
                    <td className="px-4 py-3 font-medium text-admin-text">
                      {bid.tenant_name || bid.tenant_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      {bid.tier && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TIER_COLORS[bid.tier] || 'bg-admin-surface-2 text-admin-muted'}`}>
                          {bid.tier}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-admin-muted text-xs">{fmtDate(bid.claimed_at)}</td>
                    <td className="px-4 py-3 text-xs">
                      {bid.status === 'locked' && bid.submit_deadline ? (
                        <Countdown deadline={bid.submit_deadline} />
                      ) : (
                        <span className="text-admin-muted">{fmtDate(bid.submit_deadline)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={bid.submitted_at ? 'text-green-600' : 'text-admin-muted-2'}>
                        {bid.submitted_at ? '제출완료' : '미제출'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-admin-text-2">
                      {bid.trust_score != null ? `${bid.trust_score}점` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 bg-admin-surface-2 text-admin-muted rounded-full">
                        {BID_STATUS_LABELS[bid.status] || bid.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      )}

      {/* ── Tab 3: 제안서 비교 ───────────────────────────────────────────────── */}
      {activeTab === 'proposals' && (
        <div id="admin-rfq-proposals-panel" role="tabpanel" aria-labelledby="admin-rfq-proposals-tab" className="space-y-4">
          <div className="flex flex-col gap-3 rounded-admin-md border border-admin-border-mid bg-white p-4 shadow-admin-xs lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-admin-xs font-semibold uppercase text-admin-muted">Proposal summary</p>
              <p
                data-testid="admin-rfq-proposal-summary"
                aria-label={proposalSummaryText}
                className="mt-1 text-admin-sm font-semibold text-admin-text"
              >
                {recommendedProposal
                  ? `추천 ${recommendedProposal.tenant_name || '랜드사'} · 최저 실질가 ${lowestRealPrice ? `₩${fmt(lowestRealPrice)}` : '미정'} · 리스크 ${proposalIssueCount}건`
                  : '제출된 제안서 없음'}
              </p>
              <p className="mt-1 text-admin-xs text-admin-muted">{proposalSummaryText}</p>
            </div>
            <button
              type="button"
              onClick={runAnalysis}
              disabled={analyzing}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-admin-md text-sm font-medium transition-colors"
              aria-describedby="admin-rfq-proposals-tab"
            >
              {analyzing ? '분석 중...' : '🤖 AI 분석 실행'}
            </button>
          </div>

          {proposals.length === 0 ? (
            <div className="text-center py-12 text-admin-muted-2 text-sm bg-white border shadow-admin-xs rounded-admin-md">
              제출된 제안서가 없습니다
            </div>
          ) : (
            proposals.map((p) => (
              <div key={p.id} className="bg-white border shadow-admin-xs rounded-admin-md p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-admin-text">{p.tenant_name || '랜드사'}</h3>
                    <p className="text-sm text-admin-muted">{p.proposal_title}</p>
                  </div>
                  <div className="text-right">
                    {p.rank && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full mr-2">
                        {p.rank}위
                      </span>
                    )}
                    <span className="text-lg font-bold text-indigo-600">
                      {p.ai_review?.score ?? '—'}점
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 text-sm mb-4 sm:grid-cols-3">
                  <div className="bg-admin-bg rounded-lg p-3">
                    <p className="text-xs text-admin-muted mb-0.5">원가 (내부)</p>
                    <p className="font-semibold text-admin-text-2">₩{fmt(p.total_cost)}</p>
                  </div>
                  <div className="bg-admin-bg rounded-lg p-3">
                    <p className="text-xs text-admin-muted mb-0.5">판매가</p>
                    <p className="font-semibold text-admin-text-2">₩{fmt(p.total_selling_price)}</p>
                  </div>
                  <div className="bg-admin-bg rounded-lg p-3">
                    <p className="text-xs text-admin-muted mb-0.5">실질 총액</p>
                    <p className="font-semibold text-admin-text-2">₩{fmt(p.real_total_price)}</p>
                  </div>
                </div>

                {/* 체크리스트 */}
                <div className="mb-3">
                  <p className="text-xs text-admin-muted mb-1.5">원가 체크리스트</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(p.checklist || {}).map(([key, item]) => (
                      <span
                        key={key}
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          item.included ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                        }`}
                      >
                        {item.included ? '✓' : '✗'} {key}
                        {!item.included && item.amount ? ` (₩${fmt(item.amount)})` : ''}
                      </span>
                    ))}
                  </div>
                </div>

                {/* AI 리뷰 */}
                {p.ai_review?.issues && p.ai_review.issues.length > 0 && (
                  <div>
                    <p className="text-xs text-admin-muted mb-1">AI 검토 사항</p>
                    <ul className="space-y-0.5">
                      {p.ai_review.issues.map((issue, i) => (
                        <li key={i} className="text-xs text-red-600 flex gap-1">
                          <span>⚠</span>{issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))
          )}

          {/* 분석 리포트 */}
          {report && (
            <div className="bg-white border border-purple-200 shadow-admin-xs rounded-admin-md p-5">
              <h3 className="font-semibold text-admin-text mb-3">🤖 AI 분석 리포트</h3>
              {report.key_insights?.length > 0 && (
                <ul className="mb-4 space-y-1">
                  {report.key_insights.map((i, idx) => (
                    <li key={idx} className="text-sm text-admin-text-2 flex gap-2">
                      <span className="text-purple-500">•</span>{i}
                    </li>
                  ))}
                </ul>
              )}
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(report.report_html) }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Tab 4: 메시지 ───────────────────────────────────────────────────── */}
      {activeTab === 'messages' && (
        <div id="admin-rfq-messages-panel" role="tabpanel" aria-labelledby="admin-rfq-messages-tab" className="space-y-3">
          <div className="flex flex-col gap-3 rounded-admin-md border border-admin-border-mid bg-white p-4 shadow-admin-xs lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-admin-xs font-semibold uppercase text-admin-muted">Message summary</p>
              <p
                data-testid="admin-rfq-message-summary"
                aria-label={messageSummaryText}
                className="mt-1 text-admin-sm font-semibold text-admin-text"
              >
                고객 {customerMessageCount}건 · 랜드사 {tenantMessageCount}건 · PII 차단 {blockedMessageCount}건
              </p>
              <p className="mt-1 text-admin-xs text-admin-muted">{messageSummaryText}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-admin-xs text-admin-muted sm:grid-cols-4">
              <div className="rounded-admin-sm bg-admin-surface-2 px-3 py-2">
                <span className="block font-semibold text-admin-text">{messages.length}</span>
                전체 메시지
              </div>
              <div className="rounded-admin-sm bg-indigo-50 px-3 py-2 text-indigo-700">
                <span className="block font-semibold">{customerMessageCount}</span>
                고객
              </div>
              <div className="rounded-admin-sm bg-blue-50 px-3 py-2 text-blue-700">
                <span className="block font-semibold">{tenantMessageCount}</span>
                랜드사
              </div>
              <div className="rounded-admin-sm bg-status-warningBg px-3 py-2 text-status-warningFg">
                <span className="block font-semibold">{hiddenMessageCount}</span>
                비공개
              </div>
            </div>
          </div>

          {messages.length === 0 ? (
            <div className="text-center py-12 text-admin-muted-2 text-sm bg-white border shadow-admin-xs rounded-admin-md">
              메시지가 없습니다
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="bg-white border shadow-admin-xs rounded-admin-md p-4 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        msg.sender_type === 'customer'
                          ? 'bg-indigo-100 text-indigo-700'
                          : msg.sender_type === 'tenant'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-admin-surface-2 text-admin-muted'
                      }`}
                    >
                      {msg.sender_type === 'customer' ? '고객' : msg.sender_type === 'tenant' ? '랜드사' : 'AI/시스템'}
                    </span>
                    {msg.pii_blocked && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                        ⚠️ PII 차단
                      </span>
                    )}
                    {!msg.is_visible_to_customer && (
                      <span className="text-xs bg-admin-surface-2 text-admin-muted px-2 py-0.5 rounded-full">
                        고객 비공개
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-admin-muted-2">{fmtDate(msg.created_at)}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs text-admin-muted-2 mb-1">원본 (raw)</p>
                    <p className="text-admin-text-2 whitespace-pre-wrap bg-admin-bg rounded p-2 text-xs">
                      {msg.raw_content}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-admin-muted-2 mb-1">AI 정제본</p>
                    <p className="text-admin-text-2 whitespace-pre-wrap bg-blue-50 rounded p-2 text-xs">
                      {msg.processed_content}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
