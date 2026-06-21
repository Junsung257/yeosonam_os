'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import nextDynamic from 'next/dynamic';
import { fmtNum as fmtComma } from '@/lib/admin-utils';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import {
  buildGroupInquiryHandoffHref,
  GROUP_INQUIRY_PRODUCT_LABEL,
} from '@/lib/group-inquiry-handoff';
import { trackEngagement } from '@/lib/tracker';
import { BookingOpsPanel } from '@/components/admin/booking-ops/BookingOpsPanel';
const ScoringKpiWidget = nextDynamic(() => import('@/components/admin/ScoringKpiWidget'), { ssr: false });
const AdKpiWidget = nextDynamic(() => import('@/components/admin/AdKpiWidget'), { ssr: false });

const ComposedChart = nextDynamic(() => import('recharts').then(m => ({ default: m.ComposedChart })), { ssr: false });
const Bar = nextDynamic(() => import('recharts').then(m => ({ default: m.Bar })), { ssr: false });
const Line = nextDynamic(() => import('recharts').then(m => ({ default: m.Line })), { ssr: false });
const LineChart = nextDynamic(() => import('recharts').then(m => ({ default: m.LineChart })), { ssr: false });
const XAxis = nextDynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = nextDynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = nextDynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });
const Cell = nextDynamic(() => import('recharts').then(m => ({ default: m.Cell })), { ssr: false });

const ADMIN_GROUP_INQUIRY_HREF = buildGroupInquiryHandoffHref({
  source: 'admin_dashboard',
  intent: 'operator_quote',
  partyType: 'admin',
  query: '관리자 단체 견적 AI 상담',
  selectedProducts: [GROUP_INQUIRY_PRODUCT_LABEL],
});

function trimSentenceEnd(value: string): string {
  return value.replace(/[.!?。]+$/u, '');
}

// ── 타입 ──────────────────────────────────────────────────

interface DashboardStats {
  totalSales: number; totalCost: number; totalPaid: number;
  totalOutstanding: number; margin: number; activeBookings: number;
  unpaidD7: number;       // D-7 이내 출발 & 잔금 미납 실제 건수
  totalMonthBookings: number; totalMileage: number; expiringPassports: number;
}

interface MonthlyChartData {
  month: string; direct_sales: number; affiliate_sales: number;
  direct_margin: number; affiliate_margin: number;
  total_commission: number; ad_spend_krw: number; net_margin: number;
}

// V4: 매출 인식 분리 (IFRS 15 / ASC 606) — 2026-04-28
interface RecognizedRevenueMonth {
  month: string; recognized_bookings: number; gmv: number; margin: number;
  paid: number; outstanding: number; commission: number;
}
interface NewBookingsMonth {
  month: string; total_bookings: number; live_bookings: number;
  cancelled_bookings: number; gmv_live: number; gmv_total: number;
  avg_lead_time: number | null; cancellation_rate: number;
}
interface BookingPaceBucket {
  bucket: 'D-7' | 'D-30' | 'D-90' | 'D-180' | 'D+';
  bookings: number; gmv: number;
}
interface Cancellation90d {
  total_in_window: number; cancelled_in_window: number; rate: number;
}
interface AIUsageStats {
  total_usd_7d: number; total_usd_30d: number; total_calls_30d: number;
  daily: { date: string; cost_usd: number; calls: number }[];
  by_model: { model: string; cost_usd: number; calls: number }[];
  by_provider: {
    provider: 'deepseek' | 'gemini' | 'anthropic' | 'unknown';
    cost_usd: number; calls: number; cache_hit_rate: number;
  }[];
}
interface AIProviderCredit {
  key_configured: boolean; balance_available: boolean;
  balance_raw?: number; balance_currency?: string; balance_usd?: number;
  month_cost_usd: number; month_calls: number; note?: string;
}
interface AICredits {
  credits: { deepseek: AIProviderCredit; gemini: AIProviderCredit; anthropic: AIProviderCredit };
  updated_at: string;
}
interface SettlementBalances {
  payable: { total: number; aging: { bucket: string; amount: number }[] };
  receivable: { total: number; aging: { bucket: string; amount: number }[] };
}
interface OperatorTakeRate {
  operator_id: string | null;
  operator_name: string;
  bookings: number;
  gmv: number;
  margin: number;
  take_rate: number | null;
}
interface RepeatBookingStats {
  total_customers: number; repeat_customers: number; repeat_rate: number;
  repeat_revenue_share: number; top_customer_ltv: number;
  one_time: number; two_time: number; three_plus: number;
}
interface DataQualityIssue {
  id: string; label: string; severity: 'critical' | 'warning' | 'info';
  affected: number; total: number; pct: number; hint: string; drilldown: string;
}
interface DataQualityReport {
  total_live: number; issues: DataQualityIssue[]; health_score: number;
}

export interface TravelPackage {
  id: string; title: string; destination?: string; duration?: number;
  price?: number; filename: string; file_type: string;
  confidence: number; status: string; created_at: string;
  itinerary?: string[]; inclusions?: string[]; special_notes?: string;
}

interface Booking {
  id: string; booking_no?: string; package_title?: string;
  total_price?: number; paid_amount?: number; departure_date?: string;
  status?: string; customers?: { name?: string };
}

// ── 유틸 ──────────────────────────────────────────────────

const fmt만 = (n: number) => `${(n / 10000).toFixed(0)}만`;

function buildDashboardPackageDecisionMetadata(pkg: TravelPackage | undefined, action: 'approve' | 'reject') {
  const actionLabel = action === 'approve' ? '상품 승인' : '상품 반려';
  if (!pkg) {
    return {
      operation_risk: '상품 식별 필요',
      next_action: actionLabel,
      next_action_reason: '대시보드 승인 대기 상품을 다시 조회해 처리 결과를 확인합니다.',
      decision_summary: `${actionLabel}: 상품 정보를 다시 확인합니다.`,
      missing_fields: ['상품'],
      ready_for_publish: false,
    };
  }

  const confidenceLabel = `${Math.round(pkg.confidence * 100)}%`;
  const missingFields = [
    !pkg.destination ? '목적지' : null,
    !pkg.price ? '가격' : null,
    !pkg.itinerary?.length ? '일정' : null,
  ].filter(Boolean) as string[];
  const operationRisk = pkg.confidence < 0.6 ? '낮은 추출 신뢰도'
    : missingFields.length > 0 ? '핵심 정보 누락'
      : '발행 전 최종 확인';
  const nextActionReason = action === 'approve'
    ? `신뢰도 ${confidenceLabel}, 누락 ${missingFields.length}개 기준으로 고객 노출 전 승인 판단을 완료합니다.`
    : `신뢰도 ${confidenceLabel}, 누락 ${missingFields.length}개 기준으로 반려 후 보완 큐로 돌립니다.`;

  return {
    package_id: pkg.id,
    package_title: pkg.title,
    destination: pkg.destination ?? null,
    confidence: pkg.confidence,
    confidence_label: confidenceLabel,
    operation_risk: operationRisk,
    next_action: actionLabel,
    next_action_reason: nextActionReason,
    decision_summary: `${actionLabel}: ${nextActionReason}`,
    missing_fields: missingFields,
    missing_field_count: missingFields.length,
    ready_for_publish: action === 'approve' && missingFields.length === 0 && pkg.confidence >= 0.8,
  };
}

function buildDashboardAgentActionDecisionMetadata(act: any, action: 'approve' | 'reject') {
  const agentTypeLabel = { operations: '운영', sales: '영업', marketing: '마케팅', finance: '재무', products: '상품', system: '시스템' }[act.agent_type as string] || act.agent_type || '미분류';
  const priorityLabel = { low: '낮음', normal: '보통', high: '높음', critical: '긴급' }[act.priority as string] || act.priority || '보통';
  const actionLabel = action === 'approve' ? '자비스 승인' : '자비스 반려';
  const operationRisk = act.priority === 'critical' ? '긴급 승인 대기'
    : act.priority === 'high' ? '높은 우선순위 대기'
      : '자동화 결정 대기';
  const nextActionReason = `${priorityLabel} 우선순위 ${agentTypeLabel} 제안을 ${action === 'approve' ? '실행 큐로 넘깁니다' : '보류하고 재검토합니다'}.`;

  return {
    action_id: act.id,
    action_type: act.action_type ?? null,
    agent_type: act.agent_type ?? null,
    agent_type_label: agentTypeLabel,
    priority: act.priority ?? null,
    priority_label: priorityLabel,
    operation_risk: operationRisk,
    next_action: actionLabel,
    next_action_reason: nextActionReason,
    decision_summary: `${actionLabel}: ${nextActionReason}`,
  };
}

// ── 서브 컴포넌트: TwoTrackKPI (V4 — IFRS 15 매출 인식 분리) ─────────────
//
// [확정매출] 출발일 기준 = 이미 확정된 우리 수익 (취소 불가)
// [신규예약] 생성일 기준 = 단순 등록 카운트 (취소 가능)
//
// 두 지표를 절대 섞지 않는다 (사장님 정책 2026-04-28).

function MiniSpark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - (v / max) * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-8 mt-1.5">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function TwoTrackKPI({
  recognized, newBookings, periodLabel,
}: {
  recognized: RecognizedRevenueMonth[];
  newBookings: NewBookingsMonth[];
  periodLabel: string;
}) {
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const thisRecognized = recognized.find(r => r.month === thisMonthKey);
  const thisBookings = newBookings.find(r => r.month === thisMonthKey);

  // 전월 대비 — 배열 인덱스가 아닌 월 키로 정확히 비교
  const prevRecognized = recognized.find(r => r.month === prevMonthKey) ?? null;
  const recognizedGrowth = prevRecognized && prevRecognized.gmv > 0
    ? Math.round(((thisRecognized?.gmv ?? 0) - prevRecognized.gmv) / prevRecognized.gmv * 100)
    : 0;
  const prevBookings = newBookings.find(r => r.month === prevMonthKey) ?? null;
  const bookingsGrowth = prevBookings && prevBookings.live_bookings > 0
    ? Math.round(((thisBookings?.live_bookings ?? 0) - prevBookings.live_bookings) / prevBookings.live_bookings * 100)
    : 0;

  const recognizedSpark = recognized.map(r => r.gmv);
  const bookingsSpark = newBookings.map(r => r.live_bookings);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {/* 카드 1: 출발일 기준 확정매출 (회계, IFRS 15) */}
      <Link href="/admin/bookings?mode=recognized" className="block bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">확정매출 · 출발일 기준 <span className="font-normal normal-case">({periodLabel})</span></span>
          {recognizedGrowth !== 0 && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${recognizedGrowth >= 0 ? 'bg-success-light text-success' : 'bg-danger-light text-danger'}`}>
              {recognizedGrowth >= 0 ? '+' : ''}{recognizedGrowth}%
            </span>
          )}
        </div>
        <p className="text-[28px] font-bold text-success tabular-nums leading-none">
          {thisRecognized ? `₩${fmt만(thisRecognized.gmv)}` : '—'}
        </p>
        <p className="text-[11px] text-admin-muted mt-1">
          {thisRecognized?.recognized_bookings ?? 0}건 출발 완료 · 마진 ₩{thisRecognized ? fmt만(thisRecognized.margin) : 0}
        </p>
        <MiniSpark data={recognizedSpark} color="#059669" />
      </Link>

      {/* 카드 2: 생성일 기준 신규예약 (영업, 취소 가능) */}
      <Link href="/admin/bookings?mode=new" className="block bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">신규예약 · 생성일 기준 <span className="font-normal normal-case">({periodLabel})</span></span>
          {bookingsGrowth !== 0 && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${bookingsGrowth >= 0 ? 'bg-success-light text-success' : 'bg-danger-light text-danger'}`}>
              {bookingsGrowth >= 0 ? '+' : ''}{bookingsGrowth}%
            </span>
          )}
        </div>
        <p className="text-[28px] font-bold text-text-primary tabular-nums leading-none">
          {thisBookings?.live_bookings ?? 0}<span className="text-[18px] text-admin-muted-2 ml-1">건</span>
        </p>
        <p className="text-[11px] text-admin-muted mt-1">
          ₩{thisBookings ? fmt만(thisBookings.gmv_live) : 0}
          {thisBookings && thisBookings.cancellation_rate > 0 && (
            <span className="text-red-500 ml-2">취소율 {Math.round(thisBookings.cancellation_rate * 100)}%</span>
          )}
          {thisBookings?.avg_lead_time != null && (
            <span className="text-admin-muted-2 ml-2">리드 D-{thisBookings.avg_lead_time}</span>
          )}
        </p>
        <MiniSpark data={bookingsSpark} color="#3b82f6" />
      </Link>
    </div>
  );
}

// ── 서브 컴포넌트: CashflowChart ──────────────────────────

function CashflowChart({ chartData, periodLabel }: { chartData: MonthlyChartData[]; periodLabel: string }) {
  if (chartData.length === 0) return null;
  return (
    <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-admin-base font-semibold text-text-primary">캐시플로우 ({periodLabel})</h2>
        <span className="text-[10px] text-admin-muted-2">출발일 기준 / 직접·제휴 합산</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5) + '월'} />
          <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={v => fmt만(Number(v))} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => fmt만(Number(v))} />
          <Tooltip
            formatter={(value: unknown, name: unknown) => [
              `₩${fmtComma(Number(value ?? 0))}`,
              name === 'direct_sales' ? '직접 매출' :
              name === 'affiliate_sales' ? '제휴 매출' :
              name === 'net_margin' ? '순마진 (광고·수수료 차감)' : String(name),
            ] as [string, string]}
          />
          <Bar yAxisId="left" dataKey="direct_sales" fill="#EBF3FE" radius={[4, 4, 0, 0]} name="direct_sales" />
          <Bar yAxisId="left" dataKey="affiliate_sales" fill="#3182F6" radius={[4, 4, 0, 0]} name="affiliate_sales" />
          <Line yAxisId="right" type="monotone" dataKey="net_margin" stroke="#059669" strokeWidth={2} dot={{ r: 2 }} name="net_margin" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 서브 컴포넌트: BookingPaceWidget ─────────────────────────
//
// 향후 출발 D-N 버킷 + 90일 취소율 (Booking.com Partner Extranet 표준).
// 영업 건강성 + 운영 위험 조기 감지.

function BookingPaceWidget({
  pace, cancellation90d,
}: {
  pace: BookingPaceBucket[];
  cancellation90d: Cancellation90d | null;
}) {
  const totalBookings = pace.reduce((s, p) => s + p.bookings, 0);
  const totalGmv = pace.reduce((s, p) => s + p.gmv, 0);
  const maxBucket = Math.max(1, ...pace.map(p => p.bookings));
  const cancelPct = cancellation90d ? Math.round(cancellation90d.rate * 1000) / 10 : 0;
  const cancelColor = cancelPct >= 10 ? 'text-red-600' : cancelPct >= 5 ? 'text-amber-600' : 'text-emerald-700';

  const bucketLabels: Record<BookingPaceBucket['bucket'], string> = {
    'D-7': '~7일', 'D-30': '~30일', 'D-90': '~90일', 'D-180': '~180일', 'D+': '180일+',
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Booking Pace — 향후 출발 분포 */}
      <Link href="/admin/bookings?mode=upcoming" className="md:col-span-2 bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160 block">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-admin-base font-semibold text-text-primary">Booking Pace · 향후 출발</h2>
          <span className="text-[11px] text-admin-muted tabular-nums">
            {totalBookings}건 · ₩{(totalGmv / 10000).toFixed(0)}만
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {pace.map(p => {
            const ratio = p.bookings / maxBucket;
            const heightPct = Math.max(8, ratio * 100);
            // 비율에 따라 막대 색상 강도 차별화
            const barColor = ratio >= 0.8 ? 'bg-brand' : ratio >= 0.5 ? 'bg-[#5B9EF8]' : ratio >= 0.2 ? 'bg-[#93BFF9]' : 'bg-brand-light';
            return (
              <div key={p.bucket} className="flex flex-col items-center" title={`GMV: \u20a9${(p.gmv / 10000).toFixed(0)}\ub9cc`}>
                <div className="h-12 w-full flex items-end mb-1">
                  <div
                    className={`w-full ${barColor} rounded-sm transition-all`}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <p className="text-[11px] font-bold text-admin-text-2 tabular-nums">{p.bookings}</p>
                <p className="text-[10px] text-admin-muted-2">{bucketLabels[p.bucket]}</p>
              </div>
            );
          })}
        </div>
      </Link>

      {/* 90일 Cancellation Rate */}
      <Link href="/admin/bookings?lifecycle=cancelled" className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160 block">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">취소율 (최근 90일)</h2>
          <span className="text-[10px] text-admin-muted-2">Booking.com 표준</span>
        </div>
        <p className={`text-[28px] font-bold tabular-nums leading-none ${cancelColor}`}>
          {cancelPct}<span className="text-admin-lg ml-0.5">%</span>
        </p>
        <p className="text-[11px] text-admin-muted mt-1">
          {cancellation90d
            ? `${cancellation90d.cancelled_in_window} / ${cancellation90d.total_in_window}건`
            : '데이터 없음'}
        </p>
        <p className="text-[10px] text-admin-muted-2 mt-1">
          ≥10% 위험 · 5~10% 주의 · &lt;5% 양호
        </p>
      </Link>
    </div>
  );
}

// ── 서브 컴포넌트: OperationsKPI (AI 비용 + 정산 잔여) ─────────────
//
// OS 유기적 통합 — 메인 대시보드에서 두 모듈로 직접 drilldown.
//   - AI 비용 → /admin/jarvis (자비스 V2 cost ledger)
//   - 정산 잔여 → /admin/payments + /admin/land-settlements

const fmt만KRW = (n: number) => `₩${(n / 10000).toFixed(0)}만`;
const fmt천원 = (n: number) => `₩${(n / 1000).toFixed(0)}천`;
// USD → KRW 환산 (대시보드 표시용 근사 — 정확한 회계용 아님)
const KRW_PER_USD = 1380;

const PROVIDER_LABEL: Record<string, { name: string; color: string }> = {
  deepseek:  { name: 'DeepSeek', color: '#3b82f6' },
  gemini:    { name: 'Gemini',   color: '#10b981' },
  anthropic: { name: 'Claude',   color: '#f59e0b' },
  unknown:   { name: '기타',     color: '#94a3b8' },
};

type FinanceTileTone = 'neutral' | 'good' | 'warn' | 'danger';

function FinanceTile({
  href,
  label,
  value,
  caption,
  tone = 'neutral',
  className = '',
}: {
  href: string;
  label: string;
  value: string;
  caption: string;
  tone?: FinanceTileTone;
  className?: string;
}) {
  const toneClass: Record<FinanceTileTone, string> = {
    neutral: 'border-admin-border-mid bg-admin-surface text-text-primary',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-red-200 bg-red-50 text-red-700',
  };

  return (
    <Link
      href={href}
      className={`block min-h-[108px] rounded-admin-md border p-4 shadow-admin-xs transition-all duration-160 hover:border-admin-border-strong hover:shadow-admin-sm ${toneClass[tone]} ${className}`}
    >
      <p className="text-[11px] font-semibold text-current/70">{label}</p>
      <p className="mt-2 text-[24px] font-black leading-none tabular-nums">{value}</p>
      <p className="mt-2 text-[11px] text-current/60">{caption}</p>
    </Link>
  );
}

function OwnerFinanceCommandCenter({
  stats,
  settlement,
  capitalTotal,
  unmatchedCount,
  pendingActionsCount,
  pendingPackagesCount,
}: {
  stats: DashboardStats | null;
  settlement: SettlementBalances | null;
  capitalTotal: number | null;
  unmatchedCount: number | null;
  pendingActionsCount: number;
  pendingPackagesCount: number;
}) {
  const customerPaid = stats?.totalPaid ?? 0;
  const receivable = settlement?.receivable.total ?? stats?.totalOutstanding ?? 0;
  const landPayable = settlement?.payable.total ?? 0;
  const preTaxMargin = stats?.margin ?? 0;
  const cashLeft = customerPaid - landPayable;
  const totalTodo = (stats?.unpaidD7 ?? 0) + (unmatchedCount ?? 0) + pendingActionsCount + pendingPackagesCount;
  const financeCommandTitleId = 'admin-owner-finance-title';
  const financeCommandSummaryId = 'admin-owner-finance-summary';
  const financeCommandPriorityId = 'admin-owner-finance-priority';
  const financeRiskItems = [
    cashLeft < 0
      ? { label: '현금 부족', value: fmt만KRW(Math.abs(cashLeft)), action: '랜드사 송금 전 수납 상태 확인', tone: 'danger' as const }
      : null,
    receivable > 0
      ? { label: '미수금', value: fmt만KRW(receivable), action: 'D-7 잔금 미수 예약부터 확인', tone: 'danger' as const }
      : null,
    landPayable > 0
      ? { label: '송금 대기', value: fmt만KRW(landPayable), action: '출발 완료 건 정산 여부 확인', tone: 'warn' as const }
      : null,
    (unmatchedCount ?? 0) > 0
      ? { label: '미매칭', value: `${unmatchedCount ?? 0}건`, action: '입금 자동매칭 후보 확인', tone: 'warn' as const }
      : null,
  ].filter((item): item is { label: string; value: string; action: string; tone: 'danger' | 'warn' } => Boolean(item));
  const financePriority = financeRiskItems[0] ?? {
    label: totalTodo > 0 ? '운영 대기' : '정상',
    value: totalTodo > 0 ? `${totalTodo}건` : '0건',
    action: totalTodo > 0 ? '오늘 처리할 일 순서대로 확인' : '수납과 정산 상태를 유지 점검',
    tone: 'neutral' as const,
  };
  const financeCommandSummaryText = financeRiskItems.length > 0
    ? `정산 우선순위는 ${financePriority.label} ${financePriority.value}입니다. 다음 액션은 ${financePriority.action}입니다. 확인 필요 항목은 ${financeRiskItems.map(item => `${item.label} ${item.value}`).join(', ')}입니다.`
    : `정산 우선순위는 ${financePriority.label} ${financePriority.value}입니다. ${financePriority.action}하면 됩니다.`;

  return (
    <section aria-labelledby={financeCommandTitleId} aria-describedby={`${financeCommandSummaryId} ${financeCommandPriorityId}`} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={financeCommandTitleId} className="text-admin-base font-bold text-text-primary">정산 대시보드</h2>
          <p className="mt-0.5 text-[11px] text-admin-muted-2">고객 수납, 랜드사 송금, 우리 수익을 한 화면에서 확인</p>
        </div>
        <Link href="/admin/payments" className="shrink-0 rounded-[8px] border border-admin-border-mid bg-white px-3 py-1.5 text-[11px] font-semibold text-admin-text-2 hover:bg-admin-bg">
          입금/정산
        </Link>
      </div>
      <p id={financeCommandSummaryId} className="sr-only">
        {financeCommandSummaryText}
      </p>

      <div
        id={financeCommandPriorityId}
        data-testid="admin-owner-finance-priority"
        aria-label={financeCommandSummaryText}
        className={`rounded-admin-md border px-3 py-2.5 text-admin-xs font-semibold shadow-admin-xs ${
          financePriority.tone === 'danger'
            ? 'border-red-200 bg-red-50 text-red-700'
            : financePriority.tone === 'warn'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-admin-border-mid bg-white text-admin-text-2'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-black" data-testid="admin-owner-finance-priority-label">
            우선 확인: {financePriority.label} {financePriority.value}
          </span>
          <span className="text-current/70" data-testid="admin-owner-finance-priority-action">
            {financePriority.action}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-12">
        <Link
          href="/admin/ledger"
          className={`col-span-2 block min-h-[186px] rounded-admin-md border p-5 shadow-admin-xs transition-all duration-160 hover:border-admin-border-strong hover:shadow-admin-sm xl:col-span-4 ${
            cashLeft < 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-950 text-white'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`text-[11px] font-semibold ${cashLeft < 0 ? 'text-red-600' : 'text-slate-300'}`}>현금 기준 남은 돈</p>
              <p className={`mt-3 text-[34px] font-black leading-none tabular-nums ${cashLeft < 0 ? 'text-red-700' : 'text-white'}`}>
                {fmt만KRW(cashLeft)}
              </p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${totalTodo > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              처리 {totalTodo}건
            </span>
          </div>

          <div className={`mt-5 grid grid-cols-3 gap-2 text-[11px] ${cashLeft < 0 ? 'text-red-700' : 'text-slate-300'}`}>
            <div>
              <p className="text-current/60">받은 돈</p>
              <p className="mt-1 font-bold tabular-nums">{fmt만KRW(customerPaid)}</p>
            </div>
            <div>
              <p className="text-current/60">보낼 돈</p>
              <p className="mt-1 font-bold tabular-nums">{fmt만KRW(landPayable)}</p>
            </div>
            <div>
              <p className="text-current/60">자본</p>
              <p className="mt-1 font-bold tabular-nums">{capitalTotal != null ? fmt만KRW(capitalTotal) : '-'}</p>
            </div>
          </div>
        </Link>

        <FinanceTile
          href="/admin/ledger"
          label="우리수익"
          value={fmt만KRW(preTaxMargin)}
          caption="출발일 기준 · 세전"
          tone={preTaxMargin < 0 ? 'danger' : 'good'}
          className="xl:col-span-2"
        />
        <FinanceTile
          href="/admin/payments?filter=outstanding"
          label="아직 받을 돈"
          value={fmt만KRW(receivable)}
          caption={`${stats?.unpaidD7 ?? 0}건은 D-7 이내`}
          tone={receivable > 0 ? 'danger' : 'good'}
          className="xl:col-span-2"
        />
        <FinanceTile
          href="/admin/land-settlements"
          label="랜드사 보낼 돈"
          value={fmt만KRW(landPayable)}
          caption="출발 완료 후 미송금"
          tone={landPayable > 0 ? 'warn' : 'good'}
          className="xl:col-span-2"
        />
        <FinanceTile
          href="/admin/payments?filter=unmatched"
          label="미매칭 입금"
          value={`${unmatchedCount ?? 0}건`}
          caption="통장·문자 자동매칭 확인"
          tone={(unmatchedCount ?? 0) > 0 ? 'warn' : 'good'}
          className="xl:col-span-2"
        />
        <FinanceTile
          href="/admin/jarvis?tab=actions"
          label="승인 대기"
          value={`${pendingActionsCount + pendingPackagesCount}건`}
          caption={`자비스 ${pendingActionsCount} · 상품 ${pendingPackagesCount}`}
          tone={pendingActionsCount + pendingPackagesCount > 0 ? 'warn' : 'neutral'}
          className="xl:col-span-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { href: '/admin/payments?filter=unmatched', label: '입금 자동매칭', value: `${unmatchedCount ?? 0}건` },
          { href: '/admin/payments?filter=outstanding', label: '잔금 미수', value: fmt만KRW(receivable) },
          { href: '/admin/land-settlements', label: '랜드사 정산', value: fmt만KRW(landPayable) },
          { href: '/admin/bookings?status=pending,confirmed', label: '진행 예약', value: `${stats?.activeBookings ?? 0}건` },
        ].map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-h-[54px] items-center justify-between gap-3 rounded-admin-md border border-admin-border-mid bg-white px-3 py-2 text-admin-xs shadow-admin-xs hover:border-admin-border-strong hover:bg-admin-bg"
          >
            <span className="font-semibold text-admin-text-2">{item.label}</span>
            <span className="font-black tabular-nums text-text-primary">{item.value}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TodayWorkQueue({
  stats,
  unmatchedCount,
  pendingActionsCount,
  pendingPackagesCount,
  dataIssueCount = 0,
}: {
  stats: DashboardStats | null;
  unmatchedCount: number | null;
  pendingActionsCount: number;
  pendingPackagesCount: number;
  dataIssueCount?: number;
}) {
  const rows = [
    {
      href: '/admin/bookings?mode=upcoming&filter=unpaid',
      label: 'D-7 미납 예약',
      detail: '출발 전 잔금 확인',
      count: stats?.unpaidD7 ?? 0,
      action: '알림 발송',
      reason: '출발 전 잔금 리스크',
      operationRisk: '수금 지연',
      target: '예약 관리의 출발 임박 미납 필터로 이동합니다.',
      tone: 'danger',
    },
    {
      href: '/admin/payments?filter=unmatched',
      label: '미매칭 입금',
      detail: '입금자명과 예약 연결',
      count: unmatchedCount ?? 0,
      action: '매칭하기',
      reason: '예약 상태 흔들림 방지',
      operationRisk: '상태 불일치',
      target: '결제 관리의 미매칭 입금 필터로 이동합니다.',
      tone: 'warn',
    },
    {
      href: '/admin/jarvis?tab=actions',
      label: '자비스 승인',
      detail: '자동화 제안 검수',
      count: pendingActionsCount,
      action: '검토하기',
      reason: '자동화 승인 지연 방지',
      operationRisk: '승인 대기',
      target: '자비스 승인 대기 액션 화면으로 이동합니다.',
      tone: 'neutral',
    },
    {
      href: '/admin/packages',
      label: '상품 검수',
      detail: '등록 대기 상품 발행',
      count: pendingPackagesCount,
      action: '검수하기',
      reason: '상담 가능한 상품 최신화',
      operationRisk: '상품 최신성',
      target: '상품 관리의 검수 대기 목록으로 이동합니다.',
      tone: 'neutral',
    },
  ] as const;
  const hasDataIssue = dataIssueCount > 0;
  const totalWork = rows.reduce((sum, row) => sum + row.count, 0);
  const total = totalWork + dataIssueCount;
  const activeRows = rows.filter(row => row.count > 0);
  const visibleRows = activeRows.length > 0 ? activeRows : rows;
  const priorityRow = activeRows[0];
  const urgentRows = activeRows.filter(row => row.tone === 'danger' || row.tone === 'warn');
  const clearRowsCount = rows.length - activeRows.length;
  const workQueueHealthItems = [
    { label: '활성 업무', value: `${activeRows.length}/${rows.length}`, tone: activeRows.length > 0 ? 'warn' : 'good' },
    { label: '위험/주의', value: `${urgentRows.length + (hasDataIssue ? 1 : 0)}개`, tone: urgentRows.length > 0 || hasDataIssue ? 'danger' : 'good' },
    { label: '정리됨', value: `${clearRowsCount}개`, tone: clearRowsCount === rows.length ? 'good' : 'neutral' },
  ] as const;
  const workQueueSummaryId = 'admin-today-work-summary';
  const workQueueLeadId = 'admin-today-work-lead';
  const activeWorkSummary = activeRows.length > 0
    ? activeRows.map(row => `${row.label} ${row.count}건, 운영 리스크 ${row.operationRisk}, 이유 ${row.reason}`).join(', ')
    : '새로고침으로 데이터 상태를 먼저 확인하세요.';
  const workQueueSummaryText = total > 0
    ? activeRows.length > 0
      ? `오늘 처리할 일이 ${total}건 있습니다. 활성 업무 ${activeRows.length}/${rows.length}, 위험 또는 주의 업무 ${urgentRows.length + (hasDataIssue ? 1 : 0)}개입니다. ${hasDataIssue ? `데이터 확인 필요 ${dataIssueCount}건이 있어 새로고침 후 확인이 필요합니다. ` : ''}${activeWorkSummary} 순서로 확인할 수 있습니다.`
      : `데이터 확인 필요 ${dataIssueCount}건이 있습니다. ${activeWorkSummary}`
    : '오늘 처리할 일이 없습니다. 각 업무 화면에서 최신 상태를 확인할 수 있습니다.';
  const workQueueLeadText = priorityRow
    ? `우선 처리: ${priorityRow.label} ${priorityRow.count}건. 운영 리스크: ${priorityRow.operationRisk}. 이유: ${priorityRow.reason}. 다음 액션은 ${priorityRow.action}입니다.`
    : hasDataIssue
      ? `데이터 일부 미확인 ${dataIssueCount}건. 새로고침 후 예약, 입금, 상품 큐를 다시 확인하세요.`
    : '대기 중인 운영 작업이 없습니다.';
  const toneClass = {
    danger: 'border-red-200 bg-red-50 text-red-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    neutral: 'border-admin-border-mid bg-admin-surface text-admin-text',
  };

  return (
    <section aria-labelledby="admin-today-work-title" aria-describedby={`${workQueueSummaryId} ${workQueueLeadId}`} className="rounded-admin-md border border-admin-border-mid bg-white p-4 shadow-admin-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="admin-today-work-title" className="text-admin-base font-bold text-text-primary">오늘 처리할 일</h2>
          <p className="mt-0.5 text-[11px] text-admin-muted-2">예약, 입금, 자동화, 상품 검수를 한 번에 훑습니다.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black tabular-nums ${total > 0 ? 'bg-slate-950 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
          {total > 0 ? `${total}건 대기` : '처리 완료'}
        </span>
      </div>
      <p id={workQueueSummaryId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {workQueueSummaryText}
      </p>
      <p
        id={workQueueLeadId}
        data-testid="admin-today-work-lead"
        className={`mt-3 rounded-admin-sm border px-3 py-2 text-admin-xs font-semibold ${
          priorityRow ? 'border-admin-border-mid bg-admin-bg text-admin-text-2' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}
      >
        {workQueueLeadText}
      </p>
      {priorityRow && (
        <Link
          href={priorityRow.href}
          data-testid="admin-today-work-first-action"
          aria-label={`${priorityRow.label} ${priorityRow.count}건 첫 업무 처리`}
          className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-admin-sm bg-slate-950 px-3 text-admin-xs font-black text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:w-auto"
          onClick={() => {
            trackEngagement({
              event_type: ANALYTICS_EVENTS.adminActionCompleted,
              page_url: '/admin',
              metadata: {
                surface: 'today_work_queue',
                action: 'first_action_opened',
                label: priorityRow.label,
                href: priorityRow.href,
                count: priorityRow.count,
                operation_risk: priorityRow.operationRisk,
                reason: priorityRow.reason,
                next_action: priorityRow.action,
                decision_summary: `${priorityRow.label}: ${priorityRow.count}건, ${priorityRow.operationRisk}, ${priorityRow.action}`,
                has_waiting_work: true,
              },
            });
          }}
        >
          첫 업무 처리
        </Link>
      )}
      {hasDataIssue && (
        <div
          className="mt-2 rounded-admin-sm border border-amber-200 bg-amber-50 px-3 py-2 text-admin-xs text-amber-800"
          data-testid="admin-today-work-data-issue"
        >
          <p className="font-bold">데이터 일부를 확인하지 못했습니다.</p>
          <p className="mt-0.5 text-amber-700">상단 새로고침으로 다시 불러온 뒤, 큐별 업무를 확인하세요.</p>
        </div>
      )}
      <div
        className="mt-3 grid grid-cols-3 gap-2"
        data-testid="admin-today-work-health"
        aria-label={`오늘 업무 상태: 활성 업무 ${activeRows.length}/${rows.length}, 위험 또는 주의 ${urgentRows.length}개, 정리됨 ${clearRowsCount}개`}
      >
        {workQueueHealthItems.map(item => (
          <div
            key={item.label}
            data-testid="admin-today-work-health-item"
            className={`rounded-admin-sm border px-2.5 py-2 ${
              item.tone === 'danger'
                ? 'border-red-200 bg-red-50 text-red-700'
                : item.tone === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : item.tone === 'good'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-admin-border-mid bg-admin-bg text-admin-text-2'
            }`}
          >
            <p className="text-[10px] font-semibold text-current/65">{item.label}</p>
            <p className="mt-0.5 text-[14px] font-black tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {visibleRows.map(row => {
          const rowDescriptionId = `admin-today-work-${row.label.replace(/\s+/g, '-')}-description`;
          return (
            <Link
              key={row.href}
              href={row.href}
              data-testid="admin-today-work-queue-link"
              aria-label={`${row.label} ${row.count}건 ${row.count > 0 ? row.action : '확인'}`}
              aria-describedby={`${workQueueSummaryId} ${rowDescriptionId}`}
              onClick={() => {
                trackEngagement({
                  event_type: ANALYTICS_EVENTS.adminActionCompleted,
                  page_url: '/admin',
                  metadata: {
                    surface: 'today_work_queue',
                    action: 'queue_opened',
                    label: row.label,
                    href: row.href,
                    count: row.count,
                    operation_risk: row.operationRisk,
                    reason: row.reason,
                    next_action: row.count > 0 ? row.action : '상태 확인',
                    next_action_reason: row.count > 0 ? row.reason : '대기 항목 없이 최신 상태만 확인합니다.',
                    decision_summary: `${row.label}: ${row.count}건, ${row.operationRisk}, ${row.count > 0 ? row.action : '상태 확인'}`,
                    has_waiting_work: row.count > 0,
                  },
                });
              }}
              className={`group rounded-admin-md border p-3 transition-all duration-160 hover:border-admin-border-strong hover:shadow-admin-sm ${row.count > 0 ? toneClass[row.tone] : 'border-admin-border-mid bg-admin-bg text-admin-muted'}`}
            >
              <p id={rowDescriptionId} className="sr-only">
                {trimSentenceEnd(row.target)}. 현재 {row.count}건이며 운영 리스크는 {row.operationRisk}. 처리 이유는 {row.reason}입니다. 다음 액션은 {row.count > 0 ? row.action : '상태 확인'}입니다.
              </p>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold">{row.label}</p>
                  <p className="mt-0.5 text-[11px] text-current/60">{row.detail}</p>
                </div>
                <span className="text-[22px] font-black leading-none tabular-nums">{row.count}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold">
                <span className="text-current/55">{row.count > 0 ? '다음 액션' : '대기 없음'}</span>
                <span className="text-current group-hover:underline">{row.count > 0 ? row.action : '확인'}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span
                  data-testid="admin-today-work-queue-risk"
                  className="inline-flex max-w-full rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-admin-text ring-1 ring-black/5"
                >
                  리스크: {row.operationRisk}
                </span>
                <span
                  data-testid="admin-today-work-queue-reason"
                  className="inline-flex max-w-full rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black text-admin-text-2 ring-1 ring-black/5"
                >
                  {row.reason}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function OperatorCommandBar({
  stats,
  unmatchedCount,
  pendingActionsCount,
  pendingPackagesCount,
}: {
  stats: DashboardStats | null;
  unmatchedCount: number | null;
  pendingActionsCount: number;
  pendingPackagesCount: number;
}) {
  const actions = [
    {
      href: '/admin/bookings?mode=upcoming&filter=unpaid',
      label: '잔금 알림',
      count: stats?.unpaidD7 ?? 0,
      helper: 'D-7 미납',
      target: '예약 관리의 출발 임박 미납 예약을 열어 잔금 알림을 처리합니다.',
      reason: '출발 전 잔금 리스크가 가장 커서 먼저 확인합니다.',
      operationRisk: '수금 지연',
      priority: 1,
    },
    {
      href: '/admin/payments?filter=unmatched',
      label: '입금 매칭',
      count: unmatchedCount ?? 0,
      helper: '미매칭',
      target: '결제 관리의 미매칭 입금을 열어 예약과 연결합니다.',
      reason: '입금 연결이 늦어지면 예약 상태와 잔금 판단이 흔들립니다.',
      operationRisk: '상태 불일치',
      priority: 2,
    },
    {
      href: '/admin/jarvis?tab=actions',
      label: '자동화 검토',
      count: pendingActionsCount,
      helper: '승인 대기',
      target: '자비스 승인 대기 액션을 열어 자동화 제안을 검토합니다.',
      reason: '자동화 제안은 승인 또는 보류 결정을 먼저 내려야 다음 작업이 줄어듭니다.',
      operationRisk: '승인 대기',
      priority: 3,
    },
    {
      href: '/admin/packages',
      label: '상품 검수',
      count: pendingPackagesCount,
      helper: '발행 대기',
      target: '상품 관리 화면을 열어 발행 대기 상품을 검수합니다.',
      reason: '발행 대기 상품을 정리하면 상담과 예약 연결 후보가 최신 상태가 됩니다.',
      operationRisk: '상품 최신성',
      priority: 4,
    },
  ].sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0) || a.priority - b.priority);
  const nextAction = actions.find(action => action.count > 0) ?? actions[0];
  const total = actions.reduce((sum, action) => sum + action.count, 0);
  const commandSummaryId = 'admin-operator-command-summary';
  const commandNextActionReasonId = 'admin-operator-command-next-reason';
  const commandNextActionReasonText = nextAction.count > 0
    ? `${nextAction.label} ${nextAction.count}건 우선. 운영 리스크는 ${nextAction.operationRisk}. ${nextAction.reason}`
    : '현재 대기 작업이 없어 각 업무 화면에서 최신 상태만 확인하면 됩니다.';
  const commandSummaryText = total > 0
    ? `운영 커맨드에 오늘 처리 후보 ${total}건이 있습니다. 다음 우선순위는 ${nextAction.label} ${nextAction.count}건입니다. ${commandNextActionReasonText}`
    : '운영 커맨드에 대기 중인 작업이 없습니다. 각 업무 화면에서 최신 상태를 확인할 수 있습니다.';

  return (
    <section aria-labelledby="admin-operator-command-title" aria-describedby={`${commandSummaryId} ${commandNextActionReasonId}`} className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 shadow-admin-xs">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 lg:w-[220px]">
          <p id="admin-operator-command-title" className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted-2">운영 큐</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-admin-lg font-black text-admin-text tabular-nums">{total}</span>
            <span className="text-admin-xs font-semibold text-admin-muted">오늘 처리 후보</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-admin-muted-2">
            다음: {nextAction.count > 0 ? nextAction.label : '대기 없음'}
          </p>
          <p
            id={commandNextActionReasonId}
            data-testid="admin-operator-command-next-reason"
            className="mt-1 line-clamp-2 text-[11px] font-medium text-admin-text-2"
          >
            {commandNextActionReasonText}
          </p>
          {nextAction.count > 0 && (
            <Link
              href={nextAction.href}
              data-testid="admin-operator-command-first-action"
              aria-label={`${nextAction.label} ${nextAction.count}건 첫 업무 처리`}
              className="mt-2 inline-flex h-8 items-center justify-center rounded-admin-xs bg-slate-950 px-3 text-[11px] font-black text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              onClick={() => {
                trackEngagement({
                  event_type: ANALYTICS_EVENTS.adminActionCompleted,
                  page_url: '/admin',
                  metadata: {
                    surface: 'operator_command_bar',
                    action: 'first_action_opened',
                    label: nextAction.label,
                    href: nextAction.href,
                    count: nextAction.count,
                    operation_risk: nextAction.operationRisk,
                    reason: nextAction.reason,
                    next_action: `${nextAction.label} 열기`,
                    decision_summary: `${nextAction.label}: ${nextAction.count}건, ${nextAction.operationRisk}`,
                    has_waiting_work: true,
                    priority: nextAction.priority,
                  },
                });
              }}
            >
              첫 업무 처리
            </Link>
          )}
        </div>
        <p id={commandSummaryId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {commandSummaryText}
        </p>
        <div className="grid w-full min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:max-w-full xl:overflow-x-auto xl:pb-1 no-scrollbar">
          {actions.map(action => {
            const isActive = action.count > 0;
            const actionDescriptionId = `admin-operator-command-${action.priority}-description`;
            return (
              <Link
                key={action.href}
                href={action.href}
                data-testid="admin-operator-command-link"
                aria-label={`${action.label} ${action.count}건 열기`}
                aria-describedby={`${commandSummaryId} ${actionDescriptionId}`}
                onClick={() => {
                  trackEngagement({
                    event_type: ANALYTICS_EVENTS.adminActionCompleted,
                    page_url: '/admin',
                    metadata: {
                      surface: 'operator_command_bar',
                      action: 'command_opened',
                      label: action.label,
                      href: action.href,
                      count: action.count,
                      operation_risk: action.operationRisk,
                      reason: action.reason,
                      next_action: action.count > 0 ? `${action.label} 열기` : '상태 확인',
                      next_action_reason: action.count > 0 ? action.reason : '대기 항목 없이 최신 상태만 확인합니다.',
                      decision_summary: `${action.label}: ${action.count}건, ${action.operationRisk}`,
                      has_waiting_work: action.count > 0,
                      priority: action.priority,
                    },
                  });
                }}
                className={`flex min-w-0 items-start justify-between gap-3 rounded-admin-md border px-3 py-2 transition-all duration-160 xl:min-w-[184px] ${
                  isActive
                    ? 'border-admin-border-strong bg-admin-bg text-admin-text hover:shadow-admin-sm'
                  : 'border-admin-border bg-white text-admin-muted hover:border-admin-border-mid'
                }`}
              >
                <p id={actionDescriptionId} className="sr-only">
                  {trimSentenceEnd(action.target)}. 현재 {action.count}건입니다. 운영 리스크는 {action.operationRisk}. 처리 이유는 {action.reason}입니다.
                </p>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="block truncate text-[12px] font-bold">{action.label}</span>
                    <span
                      data-testid="admin-operator-command-risk"
                      className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-black text-admin-text-2 ring-1 ring-black/5"
                    >
                      {action.operationRisk}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-current/60">{action.helper}</span>
                  <span data-testid="admin-operator-command-reason" className="mt-1 line-clamp-2 block text-[10px] font-semibold leading-4 text-current/65">
                    이유: {action.reason}
                  </span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums ${
                  isActive ? 'bg-slate-950 text-white' : 'bg-admin-surface-2 text-admin-muted'
                }`}>
                  {action.count}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function OperationsKPI({
  aiUsage, settlement, aiCredits,
}: {
  aiUsage: AIUsageStats | null;
  settlement: SettlementBalances | null;
  aiCredits: AICredits | null;
}) {
  const aiSpark = aiUsage?.daily.map(d => d.cost_usd) ?? [];
  const aiKrw30d = aiUsage ? Math.round(aiUsage.total_usd_30d * KRW_PER_USD) : 0;
  const aiKrw7d = aiUsage ? Math.round(aiUsage.total_usd_7d * KRW_PER_USD) : 0;

  // 프로바이더별 비용 비율 (by_provider 기반)
  const totalCost = aiUsage?.by_provider.reduce((s, p) => s + p.cost_usd, 0) ?? 0;

  // DeepSeek 캐시 히트율
  const dsProvider = aiUsage?.by_provider.find(p => p.provider === 'deepseek');
  const dsHitRate = dsProvider ? Math.round(dsProvider.cache_hit_rate * 100) : null;

  const payable = settlement?.payable.total ?? 0;
  const receivable = settlement?.receivable.total ?? 0;
  // 90d+ 비중 (위험 신호)
  const recvOverdue = settlement?.receivable.aging.find(a => a.bucket === '90d+')?.amount ?? 0;
  const payOverdue = settlement?.payable.aging.find(a => a.bucket === '90d+')?.amount ?? 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* 정산 잔여 — Payable (랜드사 미지급) */}
      <Link href="/admin/land-settlements" className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160 block">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">랜드사 미지급</span>
          <span className="text-[10px] text-admin-muted-2">payable</span>
        </div>
        <p className="text-[24px] font-bold text-amber-700 tabular-nums leading-none">
          {settlement ? fmt만KRW(payable) : '—'}
        </p>
        <div className="mt-2 flex gap-1 text-[10px]">
          {(settlement?.payable.aging ?? []).map(a => (
            <div key={a.bucket} className={`flex-1 px-1.5 py-1 rounded text-center ${
              a.bucket === '90d+' && a.amount > 0 ? 'bg-red-50 text-red-700' :
              a.bucket === '60-90d' && a.amount > 0 ? 'bg-amber-50 text-amber-700' :
              'bg-admin-bg text-admin-muted'
            }`}>
              <p className="font-medium">{a.bucket}</p>
              <p className="tabular-nums">{a.amount > 0 ? fmt만KRW(a.amount).replace('₩', '') : '—'}</p>
            </div>
          ))}
        </div>
        {payOverdue > 0 && (
          <p className="text-[10px] text-red-600 mt-1.5">⚠ 90일+ 미지급 {fmt만KRW(payOverdue)}</p>
        )}
      </Link>

      {/* 정산 잔여 — Receivable (고객 미입금) */}
      <Link href="/admin/payments?filter=outstanding" className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160 block">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">고객 미입금</span>
          <span className="text-[10px] text-admin-muted-2">receivable</span>
        </div>
        <p className="text-[24px] font-bold text-red-600 tabular-nums leading-none">
          {settlement ? fmt만KRW(receivable) : '—'}
        </p>
        <div className="mt-2 flex gap-1 text-[10px]">
          {(settlement?.receivable.aging ?? []).map(a => (
            <div key={a.bucket} className={`flex-1 px-1.5 py-1 rounded text-center ${
              a.bucket === '90d+' && a.amount > 0 ? 'bg-red-50 text-red-700' :
              a.bucket === '60-90d' && a.amount > 0 ? 'bg-amber-50 text-amber-700' :
              'bg-admin-bg text-admin-muted'
            }`}>
              <p className="font-medium">{a.bucket}</p>
              <p className="tabular-nums">{a.amount > 0 ? fmt만KRW(a.amount).replace('₩', '') : '—'}</p>
            </div>
          ))}
        </div>
        {recvOverdue > 0 && (
          <p className="text-[10px] text-red-600 mt-1.5">⚠ 90일+ 미입금 {fmt만KRW(recvOverdue)}</p>
        )}
      </Link>

      {/* AI 비용 추이 + 프로바이더 크레딧 */}
      <Link href="/admin/jarvis" className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160 block">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">AI 비용 (30일)</span>
          <span className="text-[10px] text-admin-muted-2">자비스 V2 ledger</span>
        </div>
        <p className="text-[24px] font-bold text-purple-700 tabular-nums leading-none">
          {aiUsage ? fmt천원(aiKrw30d) : '—'}
        </p>
        <p className="text-[11px] text-admin-muted mt-1">
          7일 {fmt천원(aiKrw7d)} · {aiUsage?.total_calls_30d ?? 0}회
          {aiUsage && (aiUsage.by_model?.length ?? 0) > 0 && (
            <span className="text-admin-muted-2 ml-2">top: {aiUsage.by_model[0].model.replace(/^claude-/, '').replace(/^gpt-/, '').slice(0, 18)}</span>
          )}
          {dsHitRate !== null && dsHitRate > 0 && (
            <span className="text-blue-400 ml-2">캐시 {dsHitRate}%</span>
          )}
        </p>
        <MiniSpark data={aiSpark} color="#a855f7" />

        {/* 프로바이더별 비용 비율 바 */}
        {aiUsage && (aiUsage.by_provider?.length ?? 0) > 0 && totalCost > 0 && (
          <div className="mt-2">
            <div className="flex h-1.5 rounded-full overflow-hidden gap-[1px]">
              {aiUsage.by_provider.map(p => (
                <div
                  key={p.provider}
                  style={{ width: `${(p.cost_usd / totalCost) * 100}%`, background: PROVIDER_LABEL[p.provider]?.color ?? '#94a3b8' }}
                  title={`${PROVIDER_LABEL[p.provider]?.name ?? p.provider}: $${p.cost_usd.toFixed(4)}`}
                />
              ))}
            </div>
            <div className="flex gap-2 mt-1">
              {aiUsage.by_provider.map(p => (
                <span key={p.provider} className="text-[10px] text-admin-muted-2 flex items-center gap-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: PROVIDER_LABEL[p.provider]?.color ?? '#94a3b8' }} />
                  {PROVIDER_LABEL[p.provider]?.name ?? p.provider} {Math.round((p.cost_usd / totalCost) * 100)}%
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 잔여 크레딧 */}
        {aiCredits && (
          <div className="mt-2 pt-2 border-t border-admin-border space-y-1">
            {/* DeepSeek */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1 text-admin-muted">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#3b82f6' }} />
                DeepSeek 잔액
              </span>
              {aiCredits.credits.deepseek.balance_available
                ? <span className="font-medium text-blue-700 tabular-nums">¥{aiCredits.credits.deepseek.balance_raw?.toFixed(2)} <span className="text-admin-muted-2">(≈${aiCredits.credits.deepseek.balance_usd?.toFixed(2)})</span></span>
                : <span className="text-admin-muted-2">{aiCredits.credits.deepseek.key_configured ? '조회 실패' : '키 미설정'}</span>
              }
            </div>
            {/* Gemini */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1 text-admin-muted">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#10b981' }} />
                Gemini 이번달
              </span>
              <span className="font-medium text-emerald-700 tabular-nums">
                {aiCredits.credits.gemini.month_calls > 0
                  ? `$${aiCredits.credits.gemini.month_cost_usd.toFixed(4)} · ${aiCredits.credits.gemini.month_calls}회`
                  : <span className="text-admin-muted-2">사용 없음</span>
                }
              </span>
            </div>
            {/* Claude */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1 text-admin-muted">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#f59e0b' }} />
                Claude 이번달
              </span>
              <span className="font-medium text-amber-700 tabular-nums">
                {aiCredits.credits.anthropic.month_calls > 0
                  ? `$${aiCredits.credits.anthropic.month_cost_usd.toFixed(4)} · ${aiCredits.credits.anthropic.month_calls}회`
                  : <span className="text-admin-muted-2">직접 호출 없음</span>
                }
              </span>
            </div>
          </div>
        )}
      </Link>
    </div>
  );
}

// ── 서브 컴포넌트: OperatorTakeRates (랜드사별 GMV/Take Rate) ─────────
//
// Tufte Small Multiples — 랜드사 단위 비교를 한 화면에. 정렬: GMV desc.
// Take Rate가 0인 행은 데이터 결측(margin 미계산) 표시.

function OperatorTakeRatesWidget({ rows }: { rows: OperatorTakeRate[] }) {
  if (rows.length === 0) return null;
  const maxGmv = Math.max(1, ...rows.map(r => r.gmv));
  return (
    <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-admin-base font-semibold text-text-primary">랜드사별 GMV · Take Rate</h2>
        <span className="text-[10px] text-admin-muted-2">최근 6개월 출발 완료 기준</span>
      </div>
      <div className="space-y-1.5">
        {rows.map(r => {
          const widthPct = Math.max(2, (r.gmv / maxGmv) * 100);
          const takePct = r.take_rate != null ? Math.round(r.take_rate * 1000) / 10 : null;
          const takeColor = takePct == null ? 'text-admin-muted-2' : takePct >= 30 ? 'text-emerald-700' : takePct >= 15 ? 'text-blue-700' : 'text-amber-700';
          return (
            <Link
              key={r.operator_id ?? 'unknown'}
              href={r.operator_id ? `/admin/land-operators?id=${r.operator_id}` : '/admin/land-operators'}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 group hover:bg-admin-bg px-1.5 py-1 rounded transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-admin-xs text-admin-text-2 font-medium truncate w-20 shrink-0">{r.operator_name}</span>
                <div className="flex-1 h-2.5 bg-admin-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 group-hover:bg-blue-500 transition-colors" style={{ width: `${widthPct}%` }} />
                </div>
              </div>
              <span className="text-[11px] text-admin-muted tabular-nums w-12 text-right">{r.bookings}건</span>
              <span className="text-[11px] text-admin-text-2 tabular-nums w-16 text-right">{fmt만KRW(r.gmv)}</span>
              <span className={`text-[11px] tabular-nums font-semibold w-14 text-right ${takeColor}`}>
                {takePct != null ? `${takePct}%` : '—'}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="text-[9px] text-admin-muted-2 mt-2">Take Rate ≥30% 우수 · 15~30% 표준 · &lt;15% 마진 점검 · — 데이터 결측</p>
    </div>
  );
}

// ── 서브 컴포넌트: RepeatBookingCard (Retention KPI) ─────────────────

function RepeatBookingCard({ stats }: { stats: RepeatBookingStats | null }) {
  if (!stats) return null;
  const repeatPct = Math.round(stats.repeat_rate * 1000) / 10;
  const repeatRevPct = Math.round(stats.repeat_revenue_share * 1000) / 10;
  const repeatColor = repeatPct >= 20 ? 'text-emerald-700' : repeatPct >= 10 ? 'text-blue-700' : 'text-admin-text-2';

  return (
    <Link href="/admin/customers?sort=mileage" className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160 block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">재방문 고객</span>
        <span className="text-[10px] text-admin-muted-2">retention</span>
      </div>
      <p className={`text-[24px] font-bold tabular-nums leading-none ${repeatColor}`}>
        {repeatPct}<span className="text-admin-lg ml-0.5">%</span>
      </p>
      <p className="text-[11px] text-admin-muted mt-1">
        {stats.repeat_customers} / {stats.total_customers}명 · 매출비중 {repeatRevPct}%
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
        <div className="bg-admin-bg px-1.5 py-1 rounded text-center">
          <p className="text-admin-muted-2">1회</p>
          <p className="text-admin-text-2 font-medium tabular-nums">{stats.one_time}</p>
        </div>
        <div className="bg-blue-50 px-1.5 py-1 rounded text-center">
          <p className="text-blue-500">2회</p>
          <p className="text-blue-700 font-medium tabular-nums">{stats.two_time}</p>
        </div>
        <div className="bg-emerald-50 px-1.5 py-1 rounded text-center">
          <p className="text-emerald-500">3회+</p>
          <p className="text-emerald-700 font-medium tabular-nums">{stats.three_plus}</p>
        </div>
      </div>
      {stats.top_customer_ltv > 0 && (
        <p className="text-[10px] text-admin-muted-2 mt-1.5">Top LTV {fmt만KRW(stats.top_customer_ltv)}</p>
      )}
    </Link>
  );
}

// ── 서브 컴포넌트: DataQualityMonitor ────────────────────────
//
// 다른 KPI 신뢰성의 전제. 결측·모순 데이터가 누적되면 모든 산식이 신호를 잃는다.
// 건강도 점수 + 항목별 drilldown URL 제공 — 클릭하면 해당 결측 예약만 필터링되어 표시.

function DataQualityMonitor({ report }: { report: DataQualityReport | null }) {
  // Supabase 미연결 = null → 숨김
  if (!report) return null;
  // 이슈 없음 = 건강 양호 배너 표시
  if (report.issues.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
        <span className="text-emerald-600 text-admin-base">✅</span>
        <span className="text-admin-xs text-emerald-700 font-medium">
          데이터 품질 양호 · live {report.total_live}건 모두 정상
        </span>
        <span className="ml-auto text-[11px] text-emerald-600 font-bold">건강도 {report.health_score}/100</span>
      </div>
    );
  }
  const score = report.health_score;
  const scoreColor = score >= 80 ? 'text-emerald-700' : score >= 60 ? 'text-amber-700' : 'text-red-600';
  const scoreBg    = score >= 80 ? 'bg-emerald-50 border-emerald-200' : score >= 60 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
  const sevColor: Record<DataQualityIssue['severity'], string> = {
    critical: 'text-red-600 bg-red-50 border-red-200',
    warning: 'text-amber-700 bg-amber-50 border-amber-200',
    info: 'text-admin-muted bg-admin-bg border-admin-border-mid',
  };
  const sevLabel: Record<DataQualityIssue['severity'], string> = {
    critical: '심각', warning: '주의', info: '참고',
  };

  return (
    <div className={`border rounded-lg p-4 ${scoreBg}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-admin-base font-semibold text-text-primary">데이터 품질 모니터</h2>
          <span className="text-[10px] text-admin-muted">live 예약 {report.total_live}건 기준</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-admin-muted">건강도</span>
          <span className={`text-[20px] font-bold tabular-nums ${scoreColor}`}>{score}</span>
          <span className="text-[11px] text-admin-muted-2">/ 100</span>
        </div>
      </div>
      <p className="text-[11px] text-admin-muted mb-2">
        모든 KPI 신뢰성의 전제. 클릭하면 해당 결측 예약만 필터링.
      </p>
      <div className="space-y-1.5">
        {report.issues.map(issue => (
          <Link
            key={issue.id}
            href={issue.drilldown}
            className={`flex items-center gap-2 p-2 rounded border transition hover:opacity-90 ${sevColor[issue.severity]}`}
          >
            <span className="text-[10px] font-bold uppercase w-10 shrink-0">
              {sevLabel[issue.severity]}
            </span>
            <span className="text-admin-xs flex-1 min-w-0 truncate">{issue.label}</span>
            <span className="text-admin-xs tabular-nums font-bold shrink-0">{issue.affected}건</span>
            <span className="text-[10px] tabular-nums opacity-70 w-12 text-right shrink-0">{issue.pct}%</span>
            <span className="text-[10px] opacity-60 truncate hidden md:block w-44 shrink-0">→ {issue.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── 서브 컴포넌트: ActionBoard ─────────────────────────────

function ActionBoard({ stats, unmatchedCount }: { stats: DashboardStats | null; unmatchedCount: number | null }) {
  const outstanding만 = stats ? Math.round(stats.totalOutstanding / 10000) : 0;
  const isHighOutstanding = stats ? stats.totalOutstanding > 1000000 : false;

  const cards = [
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      ),
      label: 'D-7 잔금 미납',
      desc: '7일 내 출발, 잔금 미납',
      count: stats?.unpaidD7 ?? 0,
      unit: '건',
      severity: 'red' as const,
      href: '/admin/bookings?mode=upcoming&filter=unpaid',
      btnLabel: '알림톡 발송',
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
        </svg>
      ),
      label: '미매칭 입금',
      desc: '수동 매칭 필요',
      count: unmatchedCount ?? 0,
      unit: '건',
      severity: 'blue' as const,
      href: '/admin/payments?filter=unmatched',
      btnLabel: '매칭하기',
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
      ),
      label: '여권 만료 임박',
      desc: '6개월 이내 만료',
      count: stats?.expiringPassports ?? 0,
      unit: '명',
      severity: 'amber' as const,
      href: '/admin/customers?filter=passport_expiry',
      btnLabel: '고객 확인',
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      ),
      label: '이번달 미수금',
      desc: '잔금 미납 합계',
      count: outstanding만,
      unit: '만원',
      severity: isHighOutstanding ? 'red' as const : 'amber' as const,
      href: '/admin/payments?filter=outstanding',
      btnLabel: '독촉 발송',
    },
  ];

  const severityStyles = {
    red:   { card: 'border-red-200 bg-red-50',    icon: 'text-red-500 bg-red-100',    count: 'text-red-600',   btn: 'bg-red-600 hover:bg-red-700 text-white',   pulse: 'bg-red-500' },
    amber: { card: 'border-amber-200 bg-amber-50', icon: 'text-amber-500 bg-amber-100', count: 'text-amber-600', btn: 'bg-amber-500 hover:bg-amber-600 text-white', pulse: 'bg-amber-500' },
    blue:  { card: 'border-blue-200 bg-blue-50',  icon: 'text-blue-500 bg-blue-100',  count: 'text-blue-600',  btn: 'bg-blue-600 hover:bg-blue-700 text-white',  pulse: 'bg-blue-500' },
  };

  return (
    <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-admin-base font-semibold text-text-primary">운영 리스크 보드</h2>
          <p className="mt-0.5 text-[11px] text-admin-muted-2">작업 큐 이후 놓치기 쉬운 미납·여권·미수금 리스크만 모아봅니다.</p>
        </div>
        {cards.some(c => c.count > 0) && (
          <span className="shrink-0 text-[11px] text-admin-muted-2">{cards.filter(c => c.count > 0).length}개 항목 처리 필요</span>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {cards.map((c, i) => {
          const s = severityStyles[c.severity];
          const isEmpty = c.count === 0;
          return (
            <div key={i} className={`rounded-admin-md border p-3.5 flex flex-col gap-2 transition-opacity ${isEmpty ? 'opacity-40 border-admin-border bg-admin-bg' : s.card}`}>
              <div className="flex items-start justify-between">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center relative ${isEmpty ? 'text-admin-muted-2 bg-admin-surface-2' : s.icon}`}>
                  {c.icon}
                  {!isEmpty && c.severity === 'red' && (
                    <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${s.pulse} animate-ping opacity-75`} />
                  )}
                </div>
                <span className={`text-[26px] font-black tabular-nums leading-none ${isEmpty ? 'text-admin-muted-2' : s.count}`}>
                  {c.count.toLocaleString()}
                  <span className="text-admin-xs font-medium ml-0.5">{c.unit}</span>
                </span>
              </div>
              <div>
                <p className={`text-admin-xs font-semibold ${isEmpty ? 'text-admin-muted-2' : 'text-admin-text-2'}`}>{c.label}</p>
                <p className="text-[10px] text-admin-muted-2 mt-0.5">{c.desc}</p>
              </div>
              <Link href={c.href}
                aria-disabled={isEmpty}
                tabIndex={isEmpty ? -1 : undefined}
                aria-label={`${c.label} ${c.count}${c.unit} ${isEmpty ? '처리할 항목 없음' : c.btnLabel}`}
                onClick={() => {
                  if (isEmpty) return;
                  trackEngagement({
                    event_type: ANALYTICS_EVENTS.adminActionCompleted,
                    page_url: '/admin',
                    metadata: {
                      surface: 'admin_risk_board',
                      action: 'risk_card_opened',
                      label: c.label,
                      href: c.href,
                      count: c.count,
                      unit: c.unit,
                      severity: c.severity,
                    },
                  });
                }}
                className={`mt-auto w-full text-center py-1.5 rounded-lg text-[11px] font-medium transition ${isEmpty ? 'bg-admin-surface-2 text-admin-muted-2 pointer-events-none' : s.btn}`}>
                {isEmpty ? '이상 없음' : c.btnLabel}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 서브 컴포넌트: SocialMetricsWidget ────────────────────

function SocialMetricsWidget() {
  const [channels, setChannels] = useState([
    { name: '카카오 A', current: 0, prev: 0 },
    { name: '카카오 B', current: 0, prev: 0 },
    { name: '스레드', current: 0, prev: 0 },
    { name: '유튜브', current: 0, prev: 0 },
  ]);
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState(['0', '0', '0', '0']);
  const [history, setHistory] = useState<{ date: string; values: number[] }[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('yeosonam_social_metrics');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.channels) setChannels(data.channels);
        if (data.history) {
          // 마이그레이션: 일 단위(2026-03-24) → 월 단위(2026-03) 변환 + 중복 제거
          const monthMap = new Map<string, number[]>();
          for (const h of data.history as { date: string; values: number[] }[]) {
            const monthKey = h.date.slice(0, 7);
            monthMap.set(monthKey, h.values); // 같은 달이면 마지막 값으로 덮어쓰기
          }
          const migrated = [...monthMap.entries()].map(([date, values]) => ({ date, values })).slice(-12);
          setHistory(migrated);
          // 마이그레이션된 데이터 저장
          localStorage.setItem('yeosonam_social_metrics', JSON.stringify({ channels: data.channels, history: migrated }));
        }
      }
    } catch { /* */ }
  }, []);

  const handleSave = () => {
    const values = formValues.map(v => parseInt(v) || 0);
    const newChannels = channels.map((ch, i) => ({
      ...ch,
      prev: ch.current,
      current: values[i],
    }));
    // 월 단위 키 (YYYY-MM) — 같은 달이면 덮어쓰기
    const monthKey = new Date().toISOString().slice(0, 7);
    const existingIdx = history.findIndex(h => h.date === monthKey);
    let newHistory;
    if (existingIdx >= 0) {
      newHistory = [...history];
      newHistory[existingIdx] = { date: monthKey, values };
    } else {
      newHistory = [...history, { date: monthKey, values }].slice(-12);
    }
    setChannels(newChannels);
    setHistory(newHistory);
    localStorage.setItem('yeosonam_social_metrics', JSON.stringify({ channels: newChannels, history: newHistory }));
    trackEngagement({
      event_type: ANALYTICS_EVENTS.adminActionCompleted,
      page_url: '/admin',
      metadata: {
        surface: 'social_channel_metrics',
        action: 'social_metrics_saved',
        channel_count: newChannels.length,
        month: monthKey,
      },
    });
    setShowForm(false);
  };

  const chartData = history.map(h => ({
    date: h.date.length === 7 ? h.date.slice(2) + '월' : h.date.slice(5),
    ...Object.fromEntries(channels.map((ch, i) => [ch.name, h.values[i] ?? 0])),
  }));

  const COLORS = ['#3b82f6', '#8b5cf6', '#0ea5e9', '#ef4444'];

  return (
    <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-admin-base font-semibold text-text-primary flex items-center gap-1.5">
          SNS 채널 현황
          <span className="text-[10px] text-admin-muted-2 font-normal" title="이 데이터는 이 브라우저에만 저장됩니다. 기기가 바뀌면 초기화됩니다.">⚠ 로컬</span>
        </h2>
        <button
          type="button"
          onClick={() => { setShowForm(!showForm); setFormValues(channels.map(c => String(c.current))); }}
          aria-expanded={showForm}
          aria-label={showForm ? 'SNS 채널 지표 편집 닫기' : 'SNS 채널 지표 편집 열기'}
          className="px-2 py-1 bg-white border border-admin-border-strong rounded text-[11px] text-admin-muted hover:bg-admin-bg transition">
          지표 업데이트
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {channels.map((ch, i) => {
          const diff = ch.current - ch.prev;
          const growth = ch.prev > 0 ? Math.round((diff / ch.prev) * 100) : 0;
          return (
            <div key={i} className="text-center">
              <p className="text-[10px] text-admin-muted-2">{ch.name}</p>
              <p className="text-admin-lg font-bold text-admin-text-2 tabular-nums">{ch.current.toLocaleString()}</p>
              {ch.prev > 0 && (
                <div className="mt-0.5">
                  <span className={`text-[11px] font-medium ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {diff >= 0 ? '+' : ''}{diff.toLocaleString()}명
                  </span>
                  <span className={`text-[10px] ml-1 ${growth >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                    ({growth >= 0 ? '+' : ''}{growth}%)
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {chartData.length > 1 && (
        <ResponsiveContainer width="100%" height={100}>
          <LineChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9 }} />
            {channels.map((ch, i) => (
              <Line key={ch.name} type="monotone" dataKey={ch.name} stroke={COLORS[i]} strokeWidth={1.5} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {showForm && (
        <div className="mt-3 pt-3 border-t border-admin-border space-y-2">
          {channels.map((ch, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={ch.name}
                aria-label={`${ch.name || `채널 ${i + 1}`} 채널명`}
                onChange={e => {
                  const next = [...channels];
                  next[i] = { ...next[i], name: e.target.value };
                  setChannels(next);
                }}
                className="w-20 border border-admin-border-mid rounded px-2 py-1 text-admin-xs text-admin-muted focus:ring-1 focus:ring-[#005d90]" />
              <input
                type="number"
                value={formValues[i]}
                aria-label={`${ch.name || `채널 ${i + 1}`} 현재 지표`}
                onChange={e => { const next = [...formValues]; next[i] = e.target.value; setFormValues(next); }}
                className="flex-1 border border-admin-border-mid rounded px-2 py-1 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
              {channels.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setChannels(channels.filter((_, idx) => idx !== i));
                    setFormValues(formValues.filter((_, idx) => idx !== i));
                  }}
                  aria-label={`${ch.name || `채널 ${i + 1}`} 삭제`}
                  className="text-admin-xs font-semibold text-admin-muted-2 hover:text-red-500"
                >
                  삭제
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setChannels([...channels, { name: `채널${channels.length + 1}`, current: 0, prev: 0 }]);
              setFormValues([...formValues, '0']);
            }}
            className="w-full py-1 border border-dashed border-admin-border-strong rounded text-[11px] text-admin-muted-2 hover:text-admin-muted hover:border-slate-400 transition">
            + 채널 추가
          </button>
          <button type="button" onClick={handleSave} className="w-full py-1.5 bg-brand text-white rounded text-admin-xs hover:bg-blue-700 transition">저장</button>
        </div>
      )}
    </div>
  );
}

// ── 서브 컴포넌트: AIInsights ──────────────────────────────

function AIInsights({ packages, chartData }: { packages: TravelPackage[]; chartData: MonthlyChartData[] }) {
  // 효자 상품: price 기준이 아닌 status 기반 판매중 상품 우선 표시
  // 실제 예약 건수 데이터가 없으므로 → active 상태 우선, 그다음 approved 순
  const top3 = useMemo(() => {
    const active = packages.filter(p => p.status === 'active');
    const approved = packages.filter(p => p.status === 'approved');
    const combined = [...active, ...approved].slice(0, 3);
    return combined.length > 0 ? combined : packages.slice(0, 3);
  }, [packages]);

  // BUG-2: ROAS = net_margin / ad_spend_krw (chartData에 이미 있음)
  // 가장 최근 달 중 광고비 > 0인 달 기준
  const roasData = useMemo(() => {
    const recent = [...chartData].reverse().find(d => d.ad_spend_krw > 0);
    if (!recent) return null;
    const roas = recent.net_margin / recent.ad_spend_krw;
    return { roas: Math.round(roas * 10) / 10, month: recent.month, spend: recent.ad_spend_krw };
  }, [chartData]);

  return (
    <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4">
      <h2 className="text-admin-base font-semibold text-text-primary mb-3">AI 인사이트</h2>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-admin-muted-2 uppercase font-semibold mb-2">판매중 상품 Top 3</p>
          {top3.length === 0 ? (
            <p className="text-admin-xs text-admin-muted-2">데이터 없음</p>
          ) : (
            <div className="space-y-1.5">
              {top3.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                    i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : 'bg-amber-700'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-admin-xs text-admin-text-2 truncate">{p.title}</p>
                    <p className="text-[10px] text-admin-muted-2">₩{(p.price ?? 0).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-[11px] text-admin-muted-2 uppercase font-semibold mb-2">승인 현황</p>
          <div className="space-y-1.5">
            {['approved', 'pending', 'active'].map(status => {
              const count = packages.filter(p => p.status === status).length;
              const label = status === 'approved' ? '승인 완료' : status === 'pending' ? '대기중' : '판매중';
              const color = status === 'approved' ? 'bg-emerald-50 text-emerald-700' : status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700';
              return (
                <div key={status} className="flex items-center justify-between">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>{label}</span>
                  <span className="text-admin-sm font-bold text-admin-text-2 tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-admin-muted-2 uppercase font-semibold mb-2">마케팅 ROAS</p>
          {roasData ? (
            <div className="text-center py-3">
              <p className={`text-[24px] font-bold tabular-nums ${roasData.roas >= 2 ? 'text-emerald-700' : roasData.roas >= 1 ? 'text-amber-700' : 'text-red-600'}`}>
                {roasData.roas.toFixed(1)}x
              </p>
              <p className="text-[10px] text-admin-muted-2 mt-1">
                광고비 {fmt만KRW(roasData.spend)} · {roasData.month.slice(5)}월
              </p>
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-[24px] font-bold text-admin-muted-2">—</p>
              <p className="text-[10px] text-admin-muted-2 mt-1">광고 스냅샷 없음</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 메인 대시보드 ─────────────────────────────────────────

// ── 자비스 실패 위젯 ────────────────────────────────────────
// agent_actions 에서 24시간 내 status='rejected'/'failed' 건을 모음
interface FailureRow {
  id: string;
  action_type: string;
  summary: string;
  status: string;
  reject_reason?: string | null;
  result_log?: { error?: string } | null;
  created_at: string;
}

function RecentFailuresWidget() {
  const [items, setItems] = useState<FailureRow[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/agent-actions?status=rejected,failed&limit=30')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.actions) return;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const recent = (d.actions as FailureRow[]).filter(a =>
          new Date(a.created_at).getTime() >= cutoff,
        );
        setItems(recent);
      })
      .catch(() => {});
  }, []);

  if (items.length === 0) return null; // 노이즈 방지

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-admin-base">⚠️</span>
          <span className="text-admin-sm font-semibold text-red-800">
            최근 24시간 자비스 실패 {items.length}건
          </span>
        </div>
        <span className="text-[11px] text-red-600">{expanded ? '접기' : '펼치기'}</span>
      </button>
      {expanded && (
        <ul className="mt-3 space-y-2">
          {items.slice(0, 5).map(item => {
            const errMsg = item.reject_reason || item.result_log?.error || '(원문 없음)';
            return (
              <li key={item.id} className="bg-white border border-red-100 rounded p-2 text-admin-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-red-500">{item.action_type}</span>
                  <span className="text-[10px] text-admin-muted-2">
                    {item.created_at ? String(item.created_at).slice(5, 16).replace('T', ' ') : ''}
                  </span>
                </div>
                <div className="mt-1 text-admin-text-2">{item.summary}</div>
                <div className="mt-1 text-[11px] text-red-700 break-all">
                  {errMsg.length > 200 ? errMsg.slice(0, 200) + '…' : errMsg}
                </div>
              </li>
            );
          })}
          {items.length > 5 && (
            <li className="text-center text-[11px] text-admin-muted">
              +{items.length - 5}건 더 — <a href="/admin/jarvis" className="text-red-600 hover:underline">전체 보기</a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

type DashboardFetchResult<T> =
  | { ok: true; data: T; status: number; url: string }
  | { ok: false; data: null; status: number | null; url: string; error: string; authExpired?: boolean };

interface PackagesResponse {
  packages?: TravelPackage[];
}

interface DashboardStatsResponse {
  stats?: DashboardStats;
}

interface CapitalSummaryResponse {
  total?: number;
}

interface BankTransactionsSummaryResponse {
  count?: number;
  transactions?: unknown[];
}

interface ChartResponse {
  data?: MonthlyChartData[];
  error?: string;
}

interface RevenueRecognitionResponse {
  recognized?: RecognizedRevenueMonth[];
  newBookings?: NewBookingsMonth[];
  pace?: BookingPaceBucket[];
  cancellation_90d?: Cancellation90d;
  error?: string;
}

interface OperationsResponse {
  aiUsage?: AIUsageStats;
  settlement?: SettlementBalances;
  takeRates?: OperatorTakeRate[];
  repeat?: RepeatBookingStats;
  dataQuality?: DataQualityReport;
  error?: string;
}

interface AgentActionsResponse {
  actions?: any[];
}

async function fetchDashboardJson<T>(url: string): Promise<DashboardFetchResult<T>> {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
    const contentType = res.headers.get('content-type') ?? '';
    const authExpired = res.status === 401 || res.status === 307 || res.status === 308;

    if (!res.ok || !contentType.includes('application/json')) {
      return {
        ok: false,
        data: null,
        status: res.status,
        url,
        authExpired,
        error: authExpired ? 'session-expired' : `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as T;
    return { ok: true, data, status: res.status, url };
  } catch (err) {
    return {
      ok: false,
      data: null,
      status: null,
      url,
      error: err instanceof Error ? err.message : 'network-error',
    };
  }
}

function fetchErrorLabel(label: string, result: DashboardFetchResult<unknown>) {
  if (!result.ok && result.authExpired) return '세션 만료';
  if (result.status === 404) return `${label} 없음`;
  return label;
}

export default function AdminPage({
  initialPendingPackages,
  initialPackages,
}: {
  initialPendingPackages?: TravelPackage[];
  initialPackages?: TravelPackage[];
} = {}) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chartData, setChartData] = useState<MonthlyChartData[]>([]);
  const [recognized, setRecognized] = useState<RecognizedRevenueMonth[]>([]);
  const [newBookings, setNewBookings] = useState<NewBookingsMonth[]>([]);
  const [pace, setPace] = useState<BookingPaceBucket[]>([]);
  const [cancellation90d, setCancellation90d] = useState<Cancellation90d | null>(null);
  const [aiUsage, setAiUsage] = useState<AIUsageStats | null>(null);
  const [aiCredits, setAiCredits] = useState<AICredits | null>(null);
  const [settlement, setSettlement] = useState<SettlementBalances | null>(null);
  const [takeRates, setTakeRates] = useState<OperatorTakeRate[]>([]);
  const [repeat, setRepeat] = useState<RepeatBookingStats | null>(null);
  const [dataQuality, setDataQuality] = useState<DataQualityReport | null>(null);
  const [packages, setPackages] = useState<TravelPackage[]>(initialPackages ?? []);
  const [pendingPackages, setPendingPackages] = useState<TravelPackage[]>(initialPendingPackages ?? []);
  const [capitalTotal, setCapitalTotal] = useState<number | null>(null);
  const [unmatchedCount, setUnmatchedCount] = useState<number | null>(null);
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [actionProcessingId, setActionProcessingId] = useState<string | null>(null);
  const [dashboardStatusMessage, setDashboardStatusMessage] = useState('');
  // 서버 pre-fetch가 있으면 초기 로딩 스피너 스킵
  const [isLoading, setIsLoading] = useState(!(initialPendingPackages && initialPackages));
  const _skipPackageFetch = useRef(!!(initialPendingPackages && initialPackages));
  // UX-2: 새로고침 상태 추적
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  // BUG-4: fetch 실패 배너
  const [fetchErrors, setFetchErrors] = useState<string[]>([]);
  // 글로벌 기간 필터 (revenue-recognition + chart 공통)
  const [period, setPeriod] = useState<'3m' | '6m' | '12m'>('6m');

  // 상세 패널
  const [selectedPackage, setSelectedPackage] = useState<TravelPackage | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const selectedPackageDrawerRef = useRef<HTMLDivElement | null>(null);
  const selectedPackageCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selectedPackage) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const getFocusableElements = () => Array.from(
      selectedPackageDrawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      selectedPackageCloseButtonRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedPackage(null);
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.setTimeout(() => {
        if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
      }, 0);
    };
  }, [selectedPackage]);

  const loadAll = async (months = 6) => {
    setFetchErrors([]);
    try {
      // 서버 pre-fetch 패키지가 있으면 packages 2개 fetch 스킵 — stats/capital만 병렬 조회
      const skipPkg = _skipPackageFetch.current;
      _skipPackageFetch.current = false;
      const hasHydratedShell = skipPkg || stats !== null || packages.length > 0 || pendingPackages.length > 0;
      setIsLoading(!hasHydratedShell);

      const addFetchError = (label: string, result?: DashboardFetchResult<unknown> | null) => {
        setFetchErrors(prev => [...new Set([...prev, result ? fetchErrorLabel(label, result) : label])]);
      };

      const pendingReq: Promise<DashboardFetchResult<PackagesResponse> | null> =
        skipPkg ? Promise.resolve(null) : fetchDashboardJson<PackagesResponse>('/api/packages?status=pending');
      const approvedReq: Promise<DashboardFetchResult<PackagesResponse> | null> =
        skipPkg ? Promise.resolve(null) : fetchDashboardJson<PackagesResponse>('/api/packages');

      const [pendingRes, approvedRes, statsRes, capRes, unmatchedRes] = await Promise.all([
        pendingReq,
        approvedReq,
        fetchDashboardJson<DashboardStatsResponse>('/api/dashboard'),
        fetchDashboardJson<CapitalSummaryResponse>('/api/capital?summary=1'),
        fetchDashboardJson<BankTransactionsSummaryResponse>('/api/bank-transactions?match_status=unmatched&summary=1'),
      ]);

      if (pendingRes?.ok) setPendingPackages(pendingRes.data.packages || []);
      else if (pendingRes) addFetchError('승인대기 상품', pendingRes);

      if (approvedRes?.ok) setPackages(approvedRes.data.packages || []);
      else if (approvedRes) addFetchError('상품 목록', approvedRes);

      if (statsRes.ok && statsRes.data.stats) setStats(statsRes.data.stats);
      else addFetchError('기본 KPI', statsRes);

      if (capRes.ok && capRes.data.total != null) setCapitalTotal(capRes.data.total);
      else if (!capRes.ok) addFetchError('자본 잔액', capRes);

      if (unmatchedRes.ok) {
        if (unmatchedRes.data.count != null) setUnmatchedCount(Number(unmatchedRes.data.count) || 0);
        else if (unmatchedRes.data.transactions) setUnmatchedCount(unmatchedRes.data.transactions.length);
      } else {
        addFetchError('미매칭 입금', unmatchedRes);
      }

      // 차트 (fire-and-forget — 느려도 초기 렌더 블록 안 함)
      fetchDashboardJson<ChartResponse>(`/api/dashboard/chart?months=${months}`)
        .then(r => {
          if (r.ok && r.data.data) setChartData(r.data.data);
          else addFetchError('차트', r);
        });

      // V4: 매출 인식 분리 + Booking Pace + 90일 취소율
      fetchDashboardJson<RevenueRecognitionResponse>(`/api/dashboard/revenue-recognition?months=${months}`)
        .then(r => {
          if (!r.ok || r.data.error) { addFetchError('매출인식', r); return; }
          if (r.data.recognized) setRecognized(r.data.recognized);
          if (r.data.newBookings) setNewBookings(r.data.newBookings);
          if (r.data.pace) setPace(r.data.pace);
          if (r.data.cancellation_90d) setCancellation90d(r.data.cancellation_90d);
        });

      // V4: 운영 KPI — BUG-3: 에러 응답 방어 추가
      fetchDashboardJson<OperationsResponse>('/api/dashboard/operations?mode=dashboard')
        .then(r => {
          if (!r.ok || r.data.error) { addFetchError('운영KPI', r); return; }
          if (r.data.aiUsage) setAiUsage(r.data.aiUsage);
          if (r.data.settlement) setSettlement(r.data.settlement);
          if (r.data.takeRates) setTakeRates(r.data.takeRates);
          if (r.data.repeat) setRepeat(r.data.repeat);
          if (r.data.dataQuality) setDataQuality(r.data.dataQuality);
        });

      fetchDashboardJson<AgentActionsResponse>('/api/agent-actions?status=pending&limit=6&count=none&fields=compact')
        .then(r => {
          if (r.ok && r.data.actions) setPendingActions(r.data.actions);
          else if (!r.ok) addFetchError('자비스 결재', r);
        });

      // AI 프로바이더 크레딧 (DeepSeek 잔액 + Gemini/Claude 사용량)
      fetchDashboardJson<AICredits>('/api/admin/ai-credits?live_balance=0')
        .then(r => {
          if (r.ok && r.data.credits) setAiCredits(r.data);
          else if (!r.ok) addFetchError('AI 크레딧', r);
        });

    } catch (err) {
      console.error('대시보드 로드 실패:', err);
      setFetchErrors(['초기로드']);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setLastRefreshed(new Date());
    }
  };

  // 첫 진입 1회만 서버 프리패치 보강 로드. period 변경은 버튼 핸들러가 직접 호출한다.
  // eslint-disable-next-line
  useEffect(() => { loadAll(6); }, []);

  const handleAction = async (packageId: string, action: 'approve' | 'reject') => {
    const actionLabel = action === 'approve' ? '승인' : '반려';
    const targetPackage = pendingPackages.find(pkg => pkg.id === packageId)
      ?? (selectedPackage?.id === packageId ? selectedPackage : undefined);
    setDashboardStatusMessage(`상품 ${actionLabel} 처리 중입니다.`);
    setProcessingId(packageId);
    try {
      const res = await fetch('/api/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, action }),
      });
      if (res.ok) {
        trackEngagement({
          event_type: ANALYTICS_EVENTS.adminActionCompleted,
          page_url: '/admin',
          metadata: {
            surface: 'dashboard_pending_package',
            action: action,
            packageId,
            ...buildDashboardPackageDecisionMetadata(targetPackage, action),
          },
        });
        setSelectedPackage(null);
        await loadAll();
      }
      setDashboardStatusMessage(res.ok ? `상품 ${actionLabel}을 완료했습니다.` : `상품 ${actionLabel}에 실패했습니다.`);
    } catch {
      setDashboardStatusMessage(`상품 ${actionLabel}에 실패했습니다.`);
    } finally { setProcessingId(null); }
  };

  const handleAgentAction = async (act: any, action: 'approve' | 'reject') => {
    const actionLabel = action === 'approve' ? '승인' : '반려';
    setActionProcessingId(act.id);
    setDashboardStatusMessage(`자비스 결재 ${actionLabel} 처리 중입니다.`);
    try {
      const res = await fetch('/api/agent-actions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: act.id, action }),
      });
      if (res.ok) {
        trackEngagement({
          event_type: ANALYTICS_EVENTS.adminActionCompleted,
          page_url: '/admin',
          metadata: {
            surface: 'dashboard_agent_action',
            action: action,
            actionId: act.id,
            actionType: act.action_type,
            ...buildDashboardAgentActionDecisionMetadata(act, action),
          },
        });
        setPendingActions(prev => prev.filter(a => a.id !== act.id));
      }
      setDashboardStatusMessage(res.ok ? `자비스 결재 ${actionLabel}을 완료했습니다.` : `자비스 결재 ${actionLabel}에 실패했습니다.`);
    } catch {
      setDashboardStatusMessage(`자비스 결재 ${actionLabel}에 실패했습니다.`);
    } finally {
      setActionProcessingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="admin-dashboard-loading-state">
        {/* 헤더 스켈레톤 */}
        <div className="flex items-center justify-between animate-pulse">
          <div className="space-y-1.5">
            <div className="h-5 bg-admin-surface-2 rounded w-36" />
            <div className="h-3 bg-admin-surface-2 rounded w-48" />
          </div>
          <div className="h-8 bg-admin-surface-2 rounded w-24" />
        </div>
        <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4 shadow-admin-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-admin-base font-bold text-text-primary">오늘 처리할 일을 불러오는 중입니다.</p>
              <p className="mt-1 text-admin-xs text-admin-muted-2">기다리는 동안 핵심 운영 화면은 바로 열 수 있습니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { href: '/admin/bookings', label: '예약 확인' },
                { href: '/admin/payments', label: '입금 확인' },
                { href: '/admin/packages', label: '상품 검수' },
              ].map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-admin-sm border border-admin-border-mid bg-white px-3 py-2 text-admin-xs font-semibold text-admin-text-2 shadow-admin-xs hover:bg-admin-bg"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-admin-md bg-admin-surface-2" />
            ))}
          </div>
        </div>
        {/* TwoTrackKPI 스켈레톤 — 2열 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4">
              <div className="h-3 bg-admin-surface-2 rounded w-32 mb-2" />
              <div className="h-8 bg-admin-surface-2 rounded w-24 mb-1" />
              <div className="h-3 bg-admin-surface-2 rounded w-40" />
            </div>
          ))}
        </div>
        {/* 재무 카드 스켈레톤 — 4열 */}
        <div className="grid grid-cols-4 gap-2 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-3">
              <div className="h-3 bg-admin-surface-2 rounded w-16 mb-2" />
              <div className="h-5 bg-admin-surface-2 rounded w-20" />
            </div>
          ))}
        </div>
        {/* 차트 스켈레톤 */}
        <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4 animate-pulse">
          <div className="h-4 bg-admin-surface-2 rounded w-32 mb-3" />
          <div className="h-[200px] bg-admin-surface-2 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p
        id="admin-dashboard-status"
        data-testid="admin-dashboard-status"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {dashboardStatusMessage}
      </p>
      {dashboardStatusMessage && (
        <div
          data-testid="admin-dashboard-visible-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`rounded-admin-md border px-4 py-3 text-admin-xs font-semibold shadow-admin-xs ${
            dashboardStatusMessage.includes('실패')
              ? 'border-red-200 bg-red-50 text-red-700'
              : dashboardStatusMessage.includes('처리 중') || dashboardStatusMessage.includes('새로고침')
                ? 'border-blue-100 bg-blue-50 text-blue-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{dashboardStatusMessage}</span>
            {dashboardStatusMessage.includes('실패') && (
              <button
                type="button"
                onClick={() => {
                  const m = period === '3m' ? 3 : period === '12m' ? 12 : 6;
                  setIsRefreshing(true);
                  loadAll(m);
                }}
                disabled={isRefreshing || isLoading}
                className="rounded-admin-sm border border-red-200 bg-white px-3 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                다시 불러오기
              </button>
            )}
          </div>
        </div>
      )}
      {/* BUG-4: fetch 실패 배너 */}
      {fetchErrors.length > 0 && (
        <div
          id="admin-dashboard-fetch-errors"
          className="flex flex-col gap-3 rounded-admin-md border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="admin-dashboard-fetch-errors"
        >
          <div className="min-w-0">
            <p className="text-admin-sm font-bold text-amber-900">일부 데이터를 확인하지 못했습니다.</p>
            <p className="mt-0.5 text-admin-xs text-amber-800">
              {fetchErrors.join(', ')} 데이터가 비어 있을 수 있어 오늘 업무 큐를 새로고침 후 다시 확인하세요.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const m = period === '3m' ? 3 : period === '12m' ? 12 : 6;
                setIsRefreshing(true);
                loadAll(m);
              }}
              disabled={isRefreshing || isLoading}
              className="rounded-admin-sm bg-amber-700 px-3 py-2 text-admin-xs font-semibold text-white shadow-admin-xs hover:bg-amber-800 disabled:opacity-50"
              data-testid="admin-dashboard-fetch-retry"
            >
              다시 불러오기
            </button>
            <button
              type="button"
              onClick={() => setFetchErrors([])}
              className="rounded-admin-sm border border-amber-300 bg-white px-3 py-2 text-admin-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* UX-2 + E: sticky frosted-glass 헤더 + 기간 필터 + 새로고침 버튼 */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-white/80 backdrop-blur-md border-b border-admin-border-mid/70 shadow-[0_1px_8px_rgba(0,0,0,0.04)] flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-admin-lg font-bold text-text-primary whitespace-nowrap">어드민 대시보드</h1>
          {lastRefreshed && (
            <p className="text-[11px] text-admin-muted-2 mt-0.5">
              마지막 새로고침: {lastRefreshed.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          )}
        </div>

        {/* 글로벌 기간 필터 — revenue-recognition + chart 공통 적용 */}
        <div className="order-3 flex flex-1 items-center gap-1 bg-bg-section rounded-[8px] p-0.5 sm:order-none sm:ml-auto sm:flex-none">
          {(['3m', '6m', '12m'] as const).map((p) => (
            <button
              type="button"
              key={p}
              aria-pressed={period === p}
              onClick={() => {
                setPeriod(p);
                const m = p === '3m' ? 3 : p === '12m' ? 12 : 6;
                setIsRefreshing(true);
                loadAll(m);
              }}
              disabled={isRefreshing || isLoading}
              className={`flex-1 rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition-all disabled:opacity-50 sm:flex-none ${
                period === p
                  ? 'bg-white text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                  : 'text-text-secondary hover:text-text-body'
              }`}
            >
              {p === '3m' ? '3개월' : p === '6m' ? '6개월' : '12개월'}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-busy={isRefreshing}
          onClick={() => {
            const m = period === '3m' ? 3 : period === '12m' ? 12 : 6;
            setIsRefreshing(true);
            loadAll(m);
          }}
          disabled={isRefreshing || isLoading}
          className="order-4 flex items-center gap-1.5 rounded-[10px] bg-white px-3 py-1.5 text-admin-xs text-text-body shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-shadow hover:bg-admin-bg disabled:opacity-50 sm:order-none"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={isRefreshing ? 'animate-spin' : ''}>
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
            <path d="M3 16v5h5"/>
          </svg>
          {isRefreshing ? '새로고침 중...' : '새로고침'}
        </button>
      </div>

      {/* Zone 0: first screen starts with work to clear, not charts or finance summaries. */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <TodayWorkQueue
          stats={stats}
          unmatchedCount={unmatchedCount}
          pendingActionsCount={pendingActions.length}
          pendingPackagesCount={pendingPackages.length}
          dataIssueCount={fetchErrors.length}
        />
        <BookingOpsPanel
          compact
          limit={4}
          className="min-w-0 xl:sticky xl:top-[92px]"
        />
      </div>

      <OperatorCommandBar
        stats={stats}
        unmatchedCount={unmatchedCount}
        pendingActionsCount={pendingActions.length}
        pendingPackagesCount={pendingPackages.length}
      />

      <OwnerFinanceCommandCenter
        stats={stats}
        settlement={settlement}
        capitalTotal={capitalTotal}
        unmatchedCount={unmatchedCount}
        pendingActionsCount={pendingActions.length}
        pendingPackagesCount={pendingPackages.length}
      />

      {/* ── Zone 1: 긴급 액션 ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-1">
        <span className="text-[11px] font-semibold text-admin-muted-2 uppercase tracking-wider whitespace-nowrap">긴급 처리</span>
        <div className="flex-1 h-px bg-admin-surface-2" />
      </div>

      {/* 자비스 실패 위젯 (실패 0건이면 자동 숨김) */}
      <RecentFailuresWidget />

      {/* 실무자 경고판 — D-7 미납·미매칭·미수금 즉시 처리 */}
      <ActionBoard stats={stats} unmatchedCount={unmatchedCount} />

      {/* 자비스 결재 대기 */}
      {pendingActions.length > 0 && (
        <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-admin-base font-semibold text-text-primary flex items-center gap-2">
              자비스 결재 대기
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingActions.length}</span>
            </h2>
            <Link href="/admin/jarvis?tab=actions" className="text-admin-xs text-blue-600 hover:underline">전체 보기</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pendingActions.slice(0, 6).map((act: any) => {
              const agentActionSummaryId = `admin-dashboard-agent-action-summary-${act.id}`;
              const agentDecisionSummaryId = `admin-dashboard-agent-action-decision-${act.id}`;
              const agentTypeLabel = { operations: '운영', sales: '영업', marketing: '마케팅', finance: '재무', products: '상품', system: '시스템' }[act.agent_type as string] || act.agent_type || '미분류';
              const priorityLabel = { low: '낮음', normal: '보통', high: '높음', critical: '긴급' }[act.priority as string] || act.priority || '보통';
              const agentDecisionSummaryText = `다음 결정: ${priorityLabel} 우선순위 ${agentTypeLabel} 제안을 승인 또는 반려합니다.`;
              const agentActionDescriptionIds = `${agentActionSummaryId} ${agentDecisionSummaryId} admin-dashboard-status`;
              return (
                <article
                  key={act.id}
                  aria-describedby={`${agentActionSummaryId} ${agentDecisionSummaryId}`}
                  className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 shadow-admin-xs hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160"
                >
                  <p id={agentActionSummaryId} className="sr-only">
                    자비스 결재 대기 항목입니다. 분류는 {agentTypeLabel}, 우선순위는 {priorityLabel}, 작업 유형은 {act.action_type || '미지정'}입니다. 요약: {act.summary || '요약 없음'}. {agentDecisionSummaryText}
                  </p>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                      { operations: 'bg-blue-50 text-blue-600', sales: 'bg-purple-50 text-purple-600',
                        marketing: 'bg-pink-50 text-pink-600', finance: 'bg-emerald-50 text-emerald-600',
                        products: 'bg-cyan-50 text-cyan-600', system: 'bg-admin-surface-2 text-admin-muted',
                      }[act.agent_type as string] || 'bg-admin-surface-2 text-admin-muted'
                    }`}>
                      {agentTypeLabel}
                    </span>
                    {act.priority !== 'normal' && (
                      <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                        act.priority === 'critical' ? 'bg-red-50 text-red-600' :
                        act.priority === 'high' ? 'bg-orange-50 text-orange-600' : 'bg-admin-bg text-admin-muted'
                      }`}>
                        {priorityLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-admin-sm font-medium text-admin-text-2 truncate">{act.summary}</p>
                  <p className="text-[11px] text-admin-muted-2 mt-0.5">{act.action_type}</p>
                  <p
                    id={agentDecisionSummaryId}
                    data-testid="admin-dashboard-agent-action-decision-summary"
                    className="mt-2 rounded-admin-sm border border-admin-border bg-admin-bg px-2 py-1.5 text-[11px] font-semibold text-admin-text-2"
                  >
                    {agentDecisionSummaryText}
                  </p>
                  <div className="mt-2 flex gap-1" role="group" aria-label={`${act.summary || '자비스 결재'} 처리`}>
                    <button
                      type="button"
                      data-testid="admin-dashboard-agent-action-approve"
                      aria-label={`${act.summary} 승인`}
                      aria-busy={actionProcessingId === act.id}
                      aria-describedby={agentActionDescriptionIds}
                      onClick={() => { void handleAgentAction(act, 'approve'); }}
                      disabled={actionProcessingId === act.id}
                      className="flex-1 bg-brand text-white py-1 rounded text-[11px] hover:bg-blue-700 disabled:bg-slate-300 transition"
                    >
                      승인
                    </button>
                    <button
                      type="button"
                      data-testid="admin-dashboard-agent-action-reject"
                      aria-label={`${act.summary} 반려`}
                      aria-busy={actionProcessingId === act.id}
                      aria-describedby={agentActionDescriptionIds}
                      onClick={() => { void handleAgentAction(act, 'reject'); }}
                      disabled={actionProcessingId === act.id}
                      className="flex-1 bg-white border border-admin-border-strong text-admin-muted py-1 rounded text-[11px] hover:bg-admin-bg transition"
                    >
                      반려
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* 승인 대기 상품 */}
      {pendingPackages.length > 0 && (
        <div className="bg-admin-surface border border-admin-border-mid rounded-admin-md shadow-admin-xs p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-admin-base font-semibold text-text-primary">승인 대기 ({pendingPackages.length})</h2>
            <Link href="/admin/packages" className="text-admin-xs text-blue-600 hover:underline">전체 보기</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pendingPackages.slice(0, 6).map(pkg => {
              const pendingPackageSummaryId = `admin-dashboard-pending-package-summary-${pkg.id}`;
              const pendingPackageDecisionSummaryId = `admin-dashboard-pending-package-decision-${pkg.id}`;
              const pendingPackageConfidenceLabel = `${Math.round(pkg.confidence * 100)}%`;
              const pendingPackageDecisionSummaryText = pkg.confidence >= 0.8
                ? `다음 결정: 신뢰도 ${pendingPackageConfidenceLabel}라 승인 전 상세만 빠르게 확인합니다.`
                : `다음 결정: 신뢰도 ${pendingPackageConfidenceLabel}라 상세 확인 후 승인 또는 반려합니다.`;
              const pendingPackageDescriptionIds = `${pendingPackageSummaryId} ${pendingPackageDecisionSummaryId} admin-dashboard-status`;
              return (
                <article
                  key={pkg.id}
                  aria-describedby={`${pendingPackageSummaryId} ${pendingPackageDecisionSummaryId}`}
                  className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-3 shadow-admin-xs hover:border-admin-border-strong hover:shadow-admin-sm transition-all duration-160"
                >
                  <p id={pendingPackageSummaryId} className="sr-only">
                    승인 대기 상품입니다. 상품명은 {pkg.title}, 목적지는 {pkg.destination || '미지정'}, 가격은 {pkg.price ? `${pkg.price.toLocaleString()}원` : '미지정'}, 추출 신뢰도는 {pendingPackageConfidenceLabel}입니다. {pendingPackageDecisionSummaryText}
                  </p>
                  <p className="text-admin-sm font-medium text-admin-text-2 truncate">{pkg.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {pkg.destination && <span className="text-[11px] text-admin-muted">{pkg.destination}</span>}
                    {pkg.price && <span className="text-[11px] text-admin-muted">₩{pkg.price.toLocaleString()}</span>}
                    <span className={`ml-auto px-1.5 py-0.5 text-[10px] rounded font-medium ${
                      pkg.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-700' :
                      pkg.confidence >= 0.6 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                    }`}>{pendingPackageConfidenceLabel}</span>
                  </div>
                  <p
                    id={pendingPackageDecisionSummaryId}
                    data-testid="admin-dashboard-pending-package-decision-summary"
                    className="mt-2 rounded-admin-sm border border-admin-border bg-admin-bg px-2 py-1.5 text-[11px] font-semibold text-admin-text-2"
                  >
                    {pendingPackageDecisionSummaryText}
                  </p>
                  <div className="mt-2 flex gap-1" role="group" aria-label={`${pkg.title} 승인 대기 상품 처리`}>
                    <button
                      type="button"
                      onClick={() => {
                        trackEngagement({
                          event_type: ANALYTICS_EVENTS.adminActionCompleted,
                          page_url: '/admin',
                          metadata: {
                            surface: 'admin_dashboard_pending_package',
                            action: 'pending_package_detail_opened',
                            package_id: pkg.id,
                            confidence: pkg.confidence,
                            decision_summary: pendingPackageDecisionSummaryText,
                          },
                        });
                        setSelectedPackage(pkg);
                      }}
                      data-testid="admin-dashboard-package-detail"
                      aria-label={`${pkg.title} 상세 보기`}
                      aria-describedby={pendingPackageDescriptionIds}
                      className="flex-1 bg-white border border-admin-border-strong text-admin-text-2 py-1 rounded text-[11px] hover:bg-admin-bg transition">
                      상세
                    </button>
                    <button type="button" onClick={() => { void handleAction(pkg.id, 'approve'); }} disabled={processingId === pkg.id}
                      data-testid="admin-dashboard-package-approve"
                      aria-label={`${pkg.title} 승인`}
                      aria-busy={processingId === pkg.id}
                      aria-describedby={pendingPackageDescriptionIds}
                      className="flex-1 bg-brand text-white py-1 rounded text-[11px] hover:bg-blue-700 disabled:bg-slate-300 transition">
                      승인
                    </button>
                    <button type="button" onClick={() => { void handleAction(pkg.id, 'reject'); }} disabled={processingId === pkg.id}
                      data-testid="admin-dashboard-package-reject"
                      aria-label={`${pkg.title} 반려`}
                      aria-busy={processingId === pkg.id}
                      aria-describedby={pendingPackageDescriptionIds}
                      className="flex-1 bg-white border border-admin-border-strong text-admin-muted py-1 rounded text-[11px] hover:bg-admin-bg transition">
                      반려
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Zone 2: 현황 KPI ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-1 mt-2">
        <span className="text-[11px] font-semibold text-admin-muted-2 uppercase tracking-wider whitespace-nowrap">현황 KPI</span>
        <div className="flex-1 h-px bg-admin-surface-2" />
      </div>

      {/* 매출 인식 분리 KPI (IFRS 15 / ASC 606) */}
      <TwoTrackKPI recognized={recognized} newBookings={newBookings} periodLabel={period === '3m' ? '최근 3개월' : period === '12m' ? '최근 12개월' : '최근 6개월'} />

      {/* Booking Pace + 90일 취소율 */}
      {(pace.length > 0 || cancellation90d) && (
        <BookingPaceWidget pace={pace} cancellation90d={cancellation90d} />
      )}

      {/* 캐시플로우 차트 */}
      <CashflowChart chartData={chartData} periodLabel={period === '3m' ? '최근 3개월' : period === '12m' ? '최근 12개월' : '최근 6개월'} />

      {/* 운영 KPI — 정산 잔여(payable/receivable) + AI 비용 */}
      <OperationsKPI aiUsage={aiUsage} settlement={settlement} aiCredits={aiCredits} />

      {/* ── Zone 3: 분석 ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-1 mt-2">
        <span className="text-[11px] font-semibold text-admin-muted-2 uppercase tracking-wider whitespace-nowrap">분석</span>
        <div className="flex-1 h-px bg-admin-surface-2" />
      </div>

      {/* Retention + Take Rate (Tufte Small Multiples) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <OperatorTakeRatesWidget rows={takeRates} />
        </div>
        <RepeatBookingCard stats={repeat} />
      </div>

      {/* AI 인사이트 (ROAS 포함) */}
      <AIInsights packages={packages} chartData={chartData} />

      {/* 검색광고 성과 */}
      <AdKpiWidget />

      {/* SNS 채널 현황 */}
      <SocialMetricsWidget />

      {/* 추천 시스템 헬스 (점수 v3) */}
      <ScoringKpiWidget />

      {/* 데이터 품질 모니터 (issues=0이면 자동 숨김) */}
      <DataQualityMonitor report={dataQuality} />

      {/* 바로가기 */}
      <div className="bg-white border border-dashed border-admin-border-strong rounded-lg p-4">
        <h2 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide tracking-wide mb-3">바로가기</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { title: '운영', links: [
              { href: '/admin/bookings', label: '예약 관리' },
              { href: '/admin/customers', label: '고객 관리' },
              { href: '/admin/payments', label: '입금/정산' },
              { href: '/admin/inbox', label: '고객 문의' },
            ]},
            { title: '상품', links: [
              { href: '/admin/packages', label: '상품 관리' },
              { href: '/admin/upload', label: '업로드' },
              { href: '/admin/registration-monitor', label: '등록 모니터' },
              { href: '/admin/fraud-quarantine', label: '자동 격리 검토' },
              { href: '/admin/land-operators', label: '랜드사 관리' },
              { href: '/admin/destinations', label: '출발지 관리' },
            ]},
            { title: 'AI/마케팅', links: [
              { href: '/admin/marketing', label: '마케팅 대시' },
              { href: '/admin/marketing/card-news', label: '카드뉴스' },
              { href: '/admin/content-hub', label: '콘텐츠 허브' },
              { href: '/admin/content-calendar', label: '콘텐츠 캘린더' },
              { href: '/admin/search-ads', label: '검색광고' },
              { href: '/admin/jarvis', label: '자비스 AI' },
            ]},
            { title: '재무', links: [
              { href: '/admin/ledger', label: '통합 장부' },
              { href: '/admin/settlements', label: '정산 관리' },
              { href: '/admin/tax', label: '세무 관리' },
              { href: '/admin/control-tower', label: 'OS 관제탑' },
            ]},
          ].map(group => (
            <div key={group.title} className="space-y-1">
              <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{group.title}</p>
              {group.links.map(l => (
                <Link key={l.href} href={l.href}
                  className="block text-admin-xs px-2 py-1 text-admin-muted rounded hover:bg-admin-bg hover:text-admin-text-2 truncate">
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 고객 페이지 바로가기 */}
      <div className="bg-white border border-dashed border-blue-200 rounded-lg p-4">
        <h2 className="text-[11px] font-semibold text-blue-400 uppercase tracking-wide mb-3">고객 페이지 (프론트)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { title: '메인/상품', links: [
              { href: '/', label: '메인 랜딩' },
              { href: '/packages', label: '상품 목록' },
              { href: '/blog', label: '블로그' },
              { href: '/concierge', label: 'AI 컨시어지' },
            ]},
            { title: '단체/견적', links: [
              { href: '/group', label: '단체여행 랜딩' },
              { href: ADMIN_GROUP_INQUIRY_HREF, label: '단체 견적 (AI)' },
              { href: '/partner-apply', label: '파트너 신청' },
            ]},
            { title: '인플루언서', links: [
              { href: '/admin/partner-preview', label: '파트너 포털·코브랜딩 미리보기' },
              { href: '/admin/affiliates', label: '제휴 관리 (어드민)' },
            ]},
            { title: '기타', links: [
              { href: '/lp', label: '마케팅 랜딩(LP)' },
              { href: '/login', label: '로그인' },
            ]},
          ].map(group => (
            <div key={group.title} className="space-y-1">
              <p className="text-[11px] font-semibold text-blue-400 uppercase">{group.title}</p>
              {group.links.map(l => (
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
                  className="block text-admin-xs px-2 py-1 text-blue-600 rounded hover:bg-blue-50 hover:text-blue-800 truncate">
                  ↗ {l.label}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 상세 슬라이드 패널 */}
      {selectedPackage && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {(() => {
            const selectedPackageSummaryId = `admin-dashboard-selected-package-summary-${selectedPackage.id}`;
            const selectedPackageDecisionSummaryId = `admin-dashboard-selected-package-decision-${selectedPackage.id}`;
            const selectedPackageTitleId = `admin-dashboard-selected-package-title-${selectedPackage.id}`;
            const selectedPackageConfidenceLabel = `${Math.round(selectedPackage.confidence * 100)}%`;
            const selectedPackagePriceLabel = selectedPackage.price ? `${selectedPackage.price.toLocaleString()}원` : '가격 미지정';
            const selectedPackageDestinationLabel = selectedPackage.destination || '목적지 미지정';
            const selectedPackageDecisionSummaryText = selectedPackage.confidence >= 0.8
              ? `승인 전 확인: ${selectedPackageDestinationLabel}, ${selectedPackagePriceLabel}, 신뢰도 ${selectedPackageConfidenceLabel}. 고객 노출 전 핵심 정보만 최종 확인합니다.`
              : `승인 전 확인: ${selectedPackageDestinationLabel}, ${selectedPackagePriceLabel}, 신뢰도 ${selectedPackageConfidenceLabel}. 상세 검수 후 승인 또는 반려를 결정합니다.`;
            const selectedPackageDescriptionIds = `${selectedPackageSummaryId} ${selectedPackageDecisionSummaryId} admin-dashboard-status`;
            return (
              <>
          <button
            type="button"
            aria-label="상품 상세 닫기"
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setSelectedPackage(null)}
          />
          <div
            ref={selectedPackageDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={selectedPackageTitleId}
            aria-describedby={selectedPackageDescriptionIds}
            className="relative flex h-dvh max-h-dvh w-full max-w-lg flex-col bg-white shadow-admin-lg border-l border-admin-border-mid"
          >
            <div className="shrink-0 bg-white border-b border-admin-border-mid px-5 py-4 flex items-start justify-between">
              <div className="flex-1 pr-4">
                <h2 id={selectedPackageTitleId} className="text-admin-lg font-semibold text-admin-text-2 leading-snug">{selectedPackage.title}</h2>
                <span className={`px-2 py-0.5 text-[11px] rounded font-medium ${
                  selectedPackage.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-700' :
                  selectedPackage.confidence >= 0.6 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                }`}>{selectedPackageConfidenceLabel}</span>
              </div>
              <button
                type="button"
                ref={selectedPackageCloseButtonRef}
                aria-label="상품 상세 닫기"
                onClick={() => setSelectedPackage(null)}
                className="text-admin-muted-2 hover:text-admin-muted p-1"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4 text-admin-sm">
              <p id={selectedPackageSummaryId} className="sr-only">
                선택된 승인 대기 상품입니다. 상품명은 {selectedPackage.title}, 목적지는 {selectedPackageDestinationLabel}, 가격은 {selectedPackagePriceLabel}, 추출 신뢰도는 {selectedPackageConfidenceLabel}입니다. {selectedPackageDecisionSummaryText}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {selectedPackage.destination && <div><span className="text-admin-muted">목적지</span><p className="text-admin-text-2 font-medium">{selectedPackage.destination}</p></div>}
                {selectedPackage.duration && <div><span className="text-admin-muted">기간</span><p className="text-admin-text-2 font-medium">{selectedPackage.duration}일</p></div>}
                {selectedPackage.price && <div><span className="text-admin-muted">가격</span><p className="text-admin-text-2 font-medium">₩{selectedPackage.price.toLocaleString()}</p></div>}
                <div><span className="text-admin-muted">파일</span><p className="text-admin-text-2">{selectedPackage.filename}</p></div>
              </div>
              {selectedPackage.itinerary && selectedPackage.itinerary.length > 0 && (
                <div>
                  <p className="text-admin-muted mb-1">일정</p>
                  <ul className="space-y-0.5 text-admin-text-2">
                    {selectedPackage.itinerary.map((item, i) => <li key={i} className="pl-2 border-l-2 border-admin-border-mid">{item}</li>)}
                  </ul>
                </div>
              )}
              {selectedPackage.inclusions && selectedPackage.inclusions.length > 0 && (
                <div>
                  <p className="text-admin-muted mb-1">포함 사항</p>
                  <ul className="space-y-0.5 text-admin-text-2">
                    {selectedPackage.inclusions.map((item, i) => <li key={i}>- {item}</li>)}
                  </ul>
                </div>
              )}
              {selectedPackage.special_notes && (
                <div>
                  <p className="text-admin-muted mb-1">특별 안내</p>
                  <p className="text-admin-text-2">{selectedPackage.special_notes}</p>
                </div>
              )}
            </div>

            <div className="shrink-0 bg-white border-t border-admin-border-mid px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              <p
                id={selectedPackageDecisionSummaryId}
                data-testid="admin-dashboard-selected-package-decision-summary"
                className="mb-2 rounded-admin-sm border border-admin-border bg-admin-bg px-3 py-2 text-[11px] font-semibold text-admin-text-2"
              >
                {selectedPackageDecisionSummaryText}
              </p>
              <div className="flex gap-2">
              {selectedPackage.status === 'pending' && (
                <>
                  <button
                    type="button"
                    onClick={() => { void handleAction(selectedPackage.id, 'approve'); }}
                    disabled={processingId === selectedPackage.id}
                    data-testid="admin-dashboard-selected-package-approve"
                    aria-label={`${selectedPackage.title} 승인`}
                    aria-busy={processingId === selectedPackage.id}
                    aria-describedby={selectedPackageDescriptionIds}
                    className="flex-1 bg-brand text-white py-2 rounded text-admin-sm hover:bg-blue-700 disabled:bg-slate-300 transition">승인</button>
                  <button
                    type="button"
                    onClick={() => { void handleAction(selectedPackage.id, 'reject'); }}
                    disabled={processingId === selectedPackage.id}
                    data-testid="admin-dashboard-selected-package-reject"
                    aria-label={`${selectedPackage.title} 반려`}
                    aria-busy={processingId === selectedPackage.id}
                    aria-describedby={selectedPackageDescriptionIds}
                    className="flex-1 bg-white border border-admin-border-strong text-admin-text-2 py-2 rounded text-admin-sm hover:bg-admin-bg transition">반려</button>
                </>
              )}
              <button type="button" onClick={() => setSelectedPackage(null)}
                className="flex-1 bg-white border border-admin-border-strong text-admin-text-2 py-2 rounded text-admin-sm hover:bg-admin-bg transition">닫기</button>
              </div>
            </div>
          </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
