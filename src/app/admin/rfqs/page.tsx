'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fmtNum as fmt } from '@/lib/admin-utils';
import { PageHeader, KpiCard as PatternKpiCard } from '@/components/admin/patterns';
import { FileQuestion, AlertCircle, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';

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
  bid_count?: number;
  customer_name?: string;
  created_at: string;
  custom_requirements?: Record<string, unknown> | null;
}

// ── 상수 ─────────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  draft: '초안',
  published: '공고등록',
  bidding: '입찰중',
  analyzing: 'AI분석중',
  awaiting_selection: '선택대기',
  contracted: '계약완료',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-admin-surface-2 text-admin-muted',
  published: 'bg-blue-50 text-blue-700',
  bidding: 'bg-amber-50 text-amber-700',
  analyzing: 'bg-purple-50 text-purple-700',
  awaiting_selection: 'bg-orange-50 text-orange-700',
  contracted: 'bg-green-50 text-green-700',
};

const STATUS_TABS = [
  { value: '', label: '전체' },
  { value: 'draft', label: '접수됨' },
  { value: 'published', label: '공고등록' },
  { value: 'bidding', label: '입찰중' },
  { value: 'analyzing', label: 'AI분석중' },
  { value: 'awaiting_selection', label: '선택대기' },
  { value: 'contracted', label: '계약완료' },
];

const NEXT_ACTION_LABELS: Record<string, string> = {
  draft: '요건 검수',
  published: '입찰 초대',
  bidding: '마감 확인',
  analyzing: 'AI 분석 확인',
  awaiting_selection: '고객 선택',
  contracted: '계약 확인',
};

const ACTION_QUEUE_STATUSES = [
  {
    status: 'draft',
    label: '요건 검수',
    description: '목적지, 인원, 예산 조건 확인',
  },
  {
    status: 'published',
    label: '입찰 초대',
    description: '공고 등록 후 파트너 참여 유도',
  },
  {
    status: 'bidding',
    label: '마감 확인',
    description: '입찰 수와 마감 임박 건 점검',
  },
  {
    status: 'analyzing',
    label: 'AI 분석 확인',
    description: '제안 비교와 리스크 검토',
  },
  {
    status: 'awaiting_selection',
    label: '고객 선택',
    description: '선택 대기 고객 후속 안내',
  },
];

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

function getHandoffBadgeText(rfq: GroupRfq): string | null {
  const source = getRequirementText(rfq, 'handoff_source') ?? getRequirementText(rfq, 'source');
  const hasQuery = Boolean(getRequirementText(rfq, 'handoff_query'));
  const productCount = getRequirementList(rfq, 'selected_products').length;
  const parts = [
    source ?? '상담 유입',
    hasQuery ? '원문 있음' : null,
    productCount > 0 ? `상품 ${productCount}개` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' · ') : null;
}

function getNextActionLabel(status: string): string {
  return NEXT_ACTION_LABELS[status] ?? '상세 확인';
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function AdminRfqsPage() {
  const [rfqs, setRfqs] = useState<GroupRfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRfqs();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only intentional
  }, []);

  async function fetchRfqs() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/rfq');
      if (!res.ok) throw new Error('데이터를 불러올 수 없습니다');
      const data = await res.json();
      setRfqs(Array.isArray(data) ? data : (data.rfqs ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  // 클라이언트 필터링
  const filteredRfqs = statusFilter ? rfqs.filter((r) => r.status === statusFilter) : rfqs;

  // KPI 집계
  const total = rfqs.length;
  const draftCount = rfqs.filter((r) => r.status === 'draft').length;
  const publishedCount = rfqs.filter((r) => r.status === 'published').length;
  const biddingCount = rfqs.filter((r) => r.status === 'bidding').length;
  const awaitingCount = rfqs.filter((r) => r.status === 'awaiting_selection').length;
  const analyzingCount = rfqs.filter((r) => r.status === 'analyzing').length;
  const pendingCount = draftCount + publishedCount + biddingCount + analyzingCount + awaitingCount;
  const contractedCount = rfqs.filter((r) => r.status === 'contracted').length;
  const actionQueue = ACTION_QUEUE_STATUSES.map((item) => ({
    ...item,
    count: rfqs.filter((r) => r.status === item.status).length,
  }));
  const nextQueueItem = actionQueue.find((item) => item.count > 0);
  const actionQueueSummary = nextQueueItem
    ? `RFQ 액션 큐에 처리할 건이 ${pendingCount}건 있습니다. 최우선은 ${nextQueueItem.label} ${nextQueueItem.count}건입니다.`
    : '현재 처리할 RFQ 액션 큐가 없습니다.';

  return (
    <div className="space-y-5">
      <PageHeader
        title="단체 RFQ 관리"
        subtitle="단체여행 견적 요청 및 입찰 현황을 관리합니다"
      />

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PatternKpiCard label="전체 RFQ" value={total.toLocaleString()} icon={FileQuestion} />
        <PatternKpiCard
          label="미처리"
          value={pendingCount.toLocaleString()}
          icon={AlertCircle}
          tone={pendingCount > 0 ? 'neutral' : 'positive'}
        />
        <PatternKpiCard label="AI 분석중" value={analyzingCount.toLocaleString()} icon={Sparkles} />
        <PatternKpiCard label="계약 완료" value={contractedCount.toLocaleString()} icon={CheckCircle2} tone="positive" />
      </div>

      <section
        aria-labelledby="rfq-action-queue-title"
        aria-describedby="rfq-action-queue-summary"
        className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 shadow-admin-xs"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p id="rfq-action-queue-title" className="text-admin-xs font-semibold uppercase text-admin-muted">
              Action queue
            </p>
            <p className="mt-1 text-admin-sm font-bold text-admin-text">
              {nextQueueItem
                ? `${nextQueueItem.label} ${nextQueueItem.count}건부터 처리`
                : '대기 중인 RFQ 작업 없음'}
            </p>
            <p id="rfq-action-queue-summary" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {actionQueueSummary}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {actionQueue.map((item) => {
              const isActive = statusFilter === item.status;

              return (
                <button
                  key={item.status}
                  type="button"
                  onClick={() => setStatusFilter(item.status)}
                  aria-pressed={isActive}
                  className={`rounded-admin-sm border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                    isActive
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-admin-border-mid bg-admin-surface hover:bg-admin-surface-2'
                  }`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-admin-xs font-semibold text-admin-muted">{item.label}</span>
                    <span className="font-mono text-admin-sm font-bold text-admin-text">{item.count}</span>
                  </span>
                  <span className="mt-1 block text-[11px] font-medium leading-4 text-admin-muted">
                    {item.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 탭 필터 */}
      <div className="flex gap-1 bg-admin-surface-2 rounded-admin-sm p-1 w-fit flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 h-8 rounded-admin-xs text-admin-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-admin-surface text-admin-text font-semibold shadow-admin-xs'
                : 'text-admin-muted hover:text-admin-text-2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        {loading ? (
          <div className="divide-y divide-admin-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-28" />
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
                <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-16" />
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-20" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center text-danger py-12 text-admin-base">{error}</div>
        ) : filteredRfqs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-admin-muted text-admin-base">해당하는 RFQ가 없습니다.</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-admin-border md:hidden">
              {filteredRfqs.map((rfq) => {
                const handoffBadgeText = getHandoffBadgeText(rfq);
                const detailHref = `/admin/rfqs/${rfq.id}`;
                const nextActionLabel = getNextActionLabel(rfq.status);

                return (
                  <article key={rfq.id} data-testid="admin-rfq-mobile-card" className="space-y-3 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={detailHref}
                          className="font-mono text-admin-xs font-semibold text-indigo-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                          aria-label={`${rfq.rfq_code} 상세 보기`}
                        >
                          {rfq.rfq_code}
                        </Link>
                        <p className="mt-1 truncate text-admin-base font-bold text-admin-text">
                          {rfq.destination}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex px-2 py-0.5 rounded-admin-xs text-admin-xs font-semibold ${
                          STATUS_COLORS[rfq.status] || 'bg-admin-surface-2 text-admin-muted'
                        }`}
                      >
                        {STATUS_LABELS[rfq.status] || rfq.status}
                      </span>
                    </div>

                    {handoffBadgeText && (
                      <span
                        data-testid="admin-rfq-handoff-badge"
                        className="inline-flex w-fit rounded-admin-xs bg-admin-surface-2 px-2 py-0.5 text-admin-xs font-semibold text-admin-muted"
                      >
                        {handoffBadgeText}
                      </span>
                    )}

                    <dl className="grid grid-cols-2 gap-2 text-admin-xs">
                      {[
                        ['고객', rfq.customer_name || '—'],
                        ['인원', `${rfq.adult_count + rfq.child_count}명`],
                        ['예산', `${fmt(rfq.budget_per_person)}원`],
                        ['입찰', `${rfq.bid_count ?? 0}건`],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-admin-xs bg-admin-surface-2 px-2.5 py-2">
                          <dt className="font-semibold text-admin-muted">{label}</dt>
                          <dd className="mt-0.5 truncate font-bold text-admin-text-2">{value}</dd>
                        </div>
                      ))}
                    </dl>

                    <Link
                      href={detailHref}
                      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-admin-xs border border-admin-border-mid bg-admin-surface px-3 text-admin-sm font-semibold text-admin-text-2 hover:bg-admin-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                      aria-label={`${rfq.rfq_code} ${nextActionLabel}`}
                    >
                      {nextActionLabel}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="admin-data-table min-w-[920px]">
                <thead>
                  <tr>
                    {['RFQ코드', '고객명', '목적지', '인원', '예산(1인)', '상태', '입찰수', '다음 액션', '등록일'].map(
                      (h) => (
                        <th key={h}>{h}</th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredRfqs.map((rfq) => {
                    const handoffBadgeText = getHandoffBadgeText(rfq);
                    const detailHref = `/admin/rfqs/${rfq.id}`;
                    const nextActionLabel = getNextActionLabel(rfq.status);

                    return (
                      <tr key={rfq.id}>
                        <td className="font-mono text-admin-xs text-admin-muted">
                          <Link
                            href={detailHref}
                            className="font-semibold text-indigo-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                            aria-label={`${rfq.rfq_code} 상세 보기`}
                          >
                            {rfq.rfq_code}
                          </Link>
                        </td>
                        <td className="text-admin-text">
                          {rfq.customer_name || '—'}
                        </td>
                        <td className="font-medium text-admin-text">
                          <div>{rfq.destination}</div>
                          {handoffBadgeText && (
                            <span
                              data-testid="admin-rfq-handoff-badge"
                              className="mt-1 inline-flex w-fit rounded-admin-xs bg-admin-surface-2 px-2 py-0.5 text-admin-xs font-semibold text-admin-muted"
                            >
                              {handoffBadgeText}
                            </span>
                          )}
                        </td>
                        <td className="text-admin-muted admin-num">
                          {rfq.adult_count + rfq.child_count}명
                        </td>
                        <td className="text-admin-text admin-num">
                          {fmt(rfq.budget_per_person)}원
                        </td>
                        <td>
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-admin-xs text-admin-xs font-semibold ${
                              STATUS_COLORS[rfq.status] || 'bg-admin-surface-2 text-admin-muted'
                            }`}
                          >
                            {STATUS_LABELS[rfq.status] || rfq.status}
                          </span>
                        </td>
                        <td className="text-admin-muted admin-num">
                          {rfq.bid_count ?? 0}
                        </td>
                        <td>
                          <Link
                            href={detailHref}
                            className="inline-flex h-8 items-center gap-1.5 rounded-admin-xs border border-admin-border-mid bg-admin-surface px-2.5 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                            aria-label={`${rfq.rfq_code} ${nextActionLabel}`}
                          >
                            {nextActionLabel}
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                        </td>
                        <td className="text-admin-muted text-admin-xs admin-num">
                          {rfq.created_at.slice(0, 10)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
