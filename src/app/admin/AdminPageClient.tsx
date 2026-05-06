'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import nextDynamic from 'next/dynamic';
import { fmtNum as fmtComma } from '@/lib/admin-utils';
import ScoringKpiWidget from '@/components/admin/ScoringKpiWidget';

const ComposedChart = nextDynamic(() => import('recharts').then(m => ({ default: m.ComposedChart })), { ssr: false });
const Bar = nextDynamic(() => import('recharts').then(m => ({ default: m.Bar })), { ssr: false });
const Line = nextDynamic(() => import('recharts').then(m => ({ default: m.Line })), { ssr: false });
const LineChart = nextDynamic(() => import('recharts').then(m => ({ default: m.LineChart })), { ssr: false });
const XAxis = nextDynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = nextDynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = nextDynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });
const Cell = nextDynamic(() => import('recharts').then(m => ({ default: m.Cell })), { ssr: false });

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

interface TravelPackage {
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
    <div className="grid grid-cols-2 gap-3">
      {/* 카드 1: 출발일 기준 확정매출 (회계, IFRS 15) */}
      <Link href="/admin/bookings?mode=recognized" className="block bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow">
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
        <p className="text-[11px] text-slate-500 mt-1">
          {thisRecognized?.recognized_bookings ?? 0}건 출발 완료 · 마진 ₩{thisRecognized ? fmt만(thisRecognized.margin) : 0}
        </p>
        <MiniSpark data={recognizedSpark} color="#059669" />
      </Link>

      {/* 카드 2: 생성일 기준 신규예약 (영업, 취소 가능) */}
      <Link href="/admin/bookings?mode=new" className="block bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">신규예약 · 생성일 기준 <span className="font-normal normal-case">({periodLabel})</span></span>
          {bookingsGrowth !== 0 && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${bookingsGrowth >= 0 ? 'bg-success-light text-success' : 'bg-danger-light text-danger'}`}>
              {bookingsGrowth >= 0 ? '+' : ''}{bookingsGrowth}%
            </span>
          )}
        </div>
        <p className="text-[28px] font-bold text-text-primary tabular-nums leading-none">
          {thisBookings?.live_bookings ?? 0}<span className="text-[18px] text-slate-400 ml-1">건</span>
        </p>
        <p className="text-[11px] text-slate-500 mt-1">
          ₩{thisBookings ? fmt만(thisBookings.gmv_live) : 0}
          {thisBookings && thisBookings.cancellation_rate > 0 && (
            <span className="text-red-500 ml-2">취소율 {Math.round(thisBookings.cancellation_rate * 100)}%</span>
          )}
          {thisBookings?.avg_lead_time != null && (
            <span className="text-slate-400 ml-2">리드 D-{thisBookings.avg_lead_time}</span>
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
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-admin-base font-semibold text-text-primary">캐시플로우 ({periodLabel})</h2>
        <span className="text-[10px] text-slate-400">출발일 기준 / 직접·제휴 합산</span>
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
      <Link href="/admin/bookings?mode=upcoming" className="md:col-span-2 bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow block">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-admin-base font-semibold text-text-primary">Booking Pace · 향후 출발</h2>
          <span className="text-[11px] text-slate-500 tabular-nums">
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
                <p className="text-[11px] font-bold text-slate-700 tabular-nums">{p.bookings}</p>
                <p className="text-[10px] text-slate-400">{bucketLabels[p.bucket]}</p>
              </div>
            );
          })}
        </div>
      </Link>

      {/* 90일 Cancellation Rate */}
      <Link href="/admin/bookings?lifecycle=cancelled" className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow block">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">취소율 (최근 90일)</h2>
          <span className="text-[10px] text-slate-400">Booking.com 표준</span>
        </div>
        <p className={`text-[28px] font-bold tabular-nums leading-none ${cancelColor}`}>
          {cancelPct}<span className="text-admin-lg ml-0.5">%</span>
        </p>
        <p className="text-[11px] text-slate-500 mt-1">
          {cancellation90d
            ? `${cancellation90d.cancelled_in_window} / ${cancellation90d.total_in_window}건`
            : '데이터 없음'}
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
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
      <Link href="/admin/land-settlements" className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow block">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">랜드사 미지급</span>
          <span className="text-[10px] text-slate-400">payable</span>
        </div>
        <p className="text-[24px] font-bold text-amber-700 tabular-nums leading-none">
          {settlement ? fmt만KRW(payable) : '—'}
        </p>
        <div className="mt-2 flex gap-1 text-[10px]">
          {(settlement?.payable.aging ?? []).map(a => (
            <div key={a.bucket} className={`flex-1 px-1.5 py-1 rounded text-center ${
              a.bucket === '90d+' && a.amount > 0 ? 'bg-red-50 text-red-700' :
              a.bucket === '60-90d' && a.amount > 0 ? 'bg-amber-50 text-amber-700' :
              'bg-slate-50 text-slate-500'
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
      <Link href="/admin/payments?filter=outstanding" className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow block">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">고객 미입금</span>
          <span className="text-[10px] text-slate-400">receivable</span>
        </div>
        <p className="text-[24px] font-bold text-red-600 tabular-nums leading-none">
          {settlement ? fmt만KRW(receivable) : '—'}
        </p>
        <div className="mt-2 flex gap-1 text-[10px]">
          {(settlement?.receivable.aging ?? []).map(a => (
            <div key={a.bucket} className={`flex-1 px-1.5 py-1 rounded text-center ${
              a.bucket === '90d+' && a.amount > 0 ? 'bg-red-50 text-red-700' :
              a.bucket === '60-90d' && a.amount > 0 ? 'bg-amber-50 text-amber-700' :
              'bg-slate-50 text-slate-500'
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
      <Link href="/admin/jarvis" className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow block">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">AI 비용 (30일)</span>
          <span className="text-[10px] text-slate-400">자비스 V2 ledger</span>
        </div>
        <p className="text-[24px] font-bold text-purple-700 tabular-nums leading-none">
          {aiUsage ? fmt천원(aiKrw30d) : '—'}
        </p>
        <p className="text-[11px] text-slate-500 mt-1">
          7일 {fmt천원(aiKrw7d)} · {aiUsage?.total_calls_30d ?? 0}회
          {aiUsage && (aiUsage.by_model?.length ?? 0) > 0 && (
            <span className="text-slate-400 ml-2">top: {aiUsage.by_model[0].model.replace(/^claude-/, '').replace(/^gpt-/, '').slice(0, 18)}</span>
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
                <span key={p.provider} className="text-[10px] text-slate-400 flex items-center gap-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: PROVIDER_LABEL[p.provider]?.color ?? '#94a3b8' }} />
                  {PROVIDER_LABEL[p.provider]?.name ?? p.provider} {Math.round((p.cost_usd / totalCost) * 100)}%
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 잔여 크레딧 */}
        {aiCredits && (
          <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
            {/* DeepSeek */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1 text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#3b82f6' }} />
                DeepSeek 잔액
              </span>
              {aiCredits.credits.deepseek.balance_available
                ? <span className="font-medium text-blue-700 tabular-nums">¥{aiCredits.credits.deepseek.balance_raw?.toFixed(2)} <span className="text-slate-400">(≈${aiCredits.credits.deepseek.balance_usd?.toFixed(2)})</span></span>
                : <span className="text-slate-400">{aiCredits.credits.deepseek.key_configured ? '조회 실패' : '키 미설정'}</span>
              }
            </div>
            {/* Gemini */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1 text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#10b981' }} />
                Gemini 이번달
              </span>
              <span className="font-medium text-emerald-700 tabular-nums">
                {aiCredits.credits.gemini.month_calls > 0
                  ? `$${aiCredits.credits.gemini.month_cost_usd.toFixed(4)} · ${aiCredits.credits.gemini.month_calls}회`
                  : <span className="text-slate-400">사용 없음</span>
                }
              </span>
            </div>
            {/* Claude */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1 text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#f59e0b' }} />
                Claude 이번달
              </span>
              <span className="font-medium text-amber-700 tabular-nums">
                {aiCredits.credits.anthropic.month_calls > 0
                  ? `$${aiCredits.credits.anthropic.month_cost_usd.toFixed(4)} · ${aiCredits.credits.anthropic.month_calls}회`
                  : <span className="text-slate-400">직접 호출 없음</span>
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
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-admin-base font-semibold text-text-primary">랜드사별 GMV · Take Rate</h2>
        <span className="text-[10px] text-slate-400">최근 6개월 출발 완료 기준</span>
      </div>
      <div className="space-y-1.5">
        {rows.map(r => {
          const widthPct = Math.max(2, (r.gmv / maxGmv) * 100);
          const takePct = r.take_rate != null ? Math.round(r.take_rate * 1000) / 10 : null;
          const takeColor = takePct == null ? 'text-slate-300' : takePct >= 30 ? 'text-emerald-700' : takePct >= 15 ? 'text-blue-700' : 'text-amber-700';
          return (
            <Link
              key={r.operator_id ?? 'unknown'}
              href={r.operator_id ? `/admin/land-operators?id=${r.operator_id}` : '/admin/land-operators'}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 group hover:bg-slate-50 px-1.5 py-1 rounded transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-admin-xs text-slate-700 font-medium truncate w-20 shrink-0">{r.operator_name}</span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 group-hover:bg-blue-500 transition-colors" style={{ width: `${widthPct}%` }} />
                </div>
              </div>
              <span className="text-[11px] text-slate-500 tabular-nums w-12 text-right">{r.bookings}건</span>
              <span className="text-[11px] text-slate-700 tabular-nums w-16 text-right">{fmt만KRW(r.gmv)}</span>
              <span className={`text-[11px] tabular-nums font-semibold w-14 text-right ${takeColor}`}>
                {takePct != null ? `${takePct}%` : '—'}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="text-[9px] text-slate-400 mt-2">Take Rate ≥30% 우수 · 15~30% 표준 · &lt;15% 마진 점검 · — 데이터 결측</p>
    </div>
  );
}

// ── 서브 컴포넌트: RepeatBookingCard (Retention KPI) ─────────────────

function RepeatBookingCard({ stats }: { stats: RepeatBookingStats | null }) {
  if (!stats) return null;
  const repeatPct = Math.round(stats.repeat_rate * 1000) / 10;
  const repeatRevPct = Math.round(stats.repeat_revenue_share * 1000) / 10;
  const repeatColor = repeatPct >= 20 ? 'text-emerald-700' : repeatPct >= 10 ? 'text-blue-700' : 'text-slate-700';

  return (
    <Link href="/admin/customers?sort=mileage" className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">재방문 고객</span>
        <span className="text-[10px] text-slate-400">retention</span>
      </div>
      <p className={`text-[24px] font-bold tabular-nums leading-none ${repeatColor}`}>
        {repeatPct}<span className="text-admin-lg ml-0.5">%</span>
      </p>
      <p className="text-[11px] text-slate-500 mt-1">
        {stats.repeat_customers} / {stats.total_customers}명 · 매출비중 {repeatRevPct}%
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
        <div className="bg-slate-50 px-1.5 py-1 rounded text-center">
          <p className="text-slate-400">1회</p>
          <p className="text-slate-700 font-medium tabular-nums">{stats.one_time}</p>
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
        <p className="text-[10px] text-slate-400 mt-1.5">Top LTV {fmt만KRW(stats.top_customer_ltv)}</p>
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
    info: 'text-slate-600 bg-slate-50 border-slate-200',
  };
  const sevLabel: Record<DataQualityIssue['severity'], string> = {
    critical: '심각', warning: '주의', info: '참고',
  };

  return (
    <div className={`border rounded-lg p-4 ${scoreBg}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-admin-base font-semibold text-text-primary">데이터 품질 모니터</h2>
          <span className="text-[10px] text-slate-500">live 예약 {report.total_live}건 기준</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">건강도</span>
          <span className={`text-[20px] font-bold tabular-nums ${scoreColor}`}>{score}</span>
          <span className="text-[11px] text-slate-400">/ 100</span>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mb-2">
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
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-admin-base font-semibold text-text-primary">실무자 경고판</h2>
        {cards.some(c => c.count > 0) && (
          <span className="text-[11px] text-slate-400">{cards.filter(c => c.count > 0).length}개 항목 처리 필요</span>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {cards.map((c, i) => {
          const s = severityStyles[c.severity];
          const isEmpty = c.count === 0;
          return (
            <div key={i} className={`rounded-xl border p-3.5 flex flex-col gap-2 transition-opacity ${isEmpty ? 'opacity-40 border-slate-100 bg-slate-50' : s.card}`}>
              <div className="flex items-start justify-between">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center relative ${isEmpty ? 'text-slate-400 bg-slate-100' : s.icon}`}>
                  {c.icon}
                  {!isEmpty && c.severity === 'red' && (
                    <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${s.pulse} animate-ping opacity-75`} />
                  )}
                </div>
                <span className={`text-[26px] font-black tabular-nums leading-none ${isEmpty ? 'text-slate-300' : s.count}`}>
                  {c.count.toLocaleString()}
                  <span className="text-admin-xs font-medium ml-0.5">{c.unit}</span>
                </span>
              </div>
              <div>
                <p className={`text-admin-xs font-semibold ${isEmpty ? 'text-slate-400' : 'text-slate-700'}`}>{c.label}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{c.desc}</p>
              </div>
              <Link href={c.href}
                className={`mt-auto w-full text-center py-1.5 rounded-lg text-[11px] font-medium transition ${isEmpty ? 'bg-slate-100 text-slate-400 pointer-events-none' : s.btn}`}>
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
    setShowForm(false);
  };

  const chartData = history.map(h => ({
    date: h.date.length === 7 ? h.date.slice(2) + '월' : h.date.slice(5),
    ...Object.fromEntries(channels.map((ch, i) => [ch.name, h.values[i] ?? 0])),
  }));

  const COLORS = ['#3b82f6', '#8b5cf6', '#0ea5e9', '#ef4444'];

  return (
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-admin-base font-semibold text-text-primary flex items-center gap-1.5">
          SNS 채널 현황
          <span className="text-[10px] text-slate-300 font-normal" title="이 데이터는 이 브라우저에만 저장됩니다. 기기가 바뀌면 초기화됩니다.">⚠ 로컬</span>
        </h2>
        <button onClick={() => { setShowForm(!showForm); setFormValues(channels.map(c => String(c.current))); }}
          className="px-2 py-1 bg-white border border-slate-300 rounded text-[11px] text-slate-600 hover:bg-slate-50 transition">
          지표 업데이트
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {channels.map((ch, i) => {
          const diff = ch.current - ch.prev;
          const growth = ch.prev > 0 ? Math.round((diff / ch.prev) * 100) : 0;
          return (
            <div key={i} className="text-center">
              <p className="text-[10px] text-slate-400">{ch.name}</p>
              <p className="text-admin-lg font-bold text-slate-800 tabular-nums">{ch.current.toLocaleString()}</p>
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
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          {channels.map((ch, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="text" value={ch.name}
                onChange={e => {
                  const next = [...channels];
                  next[i] = { ...next[i], name: e.target.value };
                  setChannels(next);
                }}
                className="w-20 border border-slate-200 rounded px-2 py-1 text-admin-xs text-slate-600 focus:ring-1 focus:ring-[#005d90]" />
              <input type="number" value={formValues[i]}
                onChange={e => { const next = [...formValues]; next[i] = e.target.value; setFormValues(next); }}
                className="flex-1 border border-slate-200 rounded px-2 py-1 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
              {channels.length > 1 && (
                <button onClick={() => {
                  setChannels(channels.filter((_, idx) => idx !== i));
                  setFormValues(formValues.filter((_, idx) => idx !== i));
                }} className="text-slate-300 hover:text-red-500 text-admin-sm">x</button>
              )}
            </div>
          ))}
          <button onClick={() => {
            setChannels([...channels, { name: `채널${channels.length + 1}`, current: 0, prev: 0 }]);
            setFormValues([...formValues, '0']);
          }} className="w-full py-1 border border-dashed border-slate-300 rounded text-[11px] text-slate-400 hover:text-slate-600 hover:border-slate-400 transition">
            + 채널 추가
          </button>
          <button onClick={handleSave} className="w-full py-1.5 bg-brand text-white rounded text-admin-xs hover:bg-blue-700 transition">저장</button>
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
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
      <h2 className="text-admin-base font-semibold text-text-primary mb-3">AI 인사이트</h2>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-slate-400 uppercase font-semibold mb-2">판매중 상품 Top 3</p>
          {top3.length === 0 ? (
            <p className="text-admin-xs text-slate-400">데이터 없음</p>
          ) : (
            <div className="space-y-1.5">
              {top3.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                    i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : 'bg-amber-700'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-admin-xs text-slate-700 truncate">{p.title}</p>
                    <p className="text-[10px] text-slate-400">₩{(p.price ?? 0).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-[11px] text-slate-400 uppercase font-semibold mb-2">승인 현황</p>
          <div className="space-y-1.5">
            {['approved', 'pending', 'active'].map(status => {
              const count = packages.filter(p => p.status === status).length;
              const label = status === 'approved' ? '승인 완료' : status === 'pending' ? '대기중' : '판매중';
              const color = status === 'approved' ? 'bg-emerald-50 text-emerald-700' : status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700';
              return (
                <div key={status} className="flex items-center justify-between">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>{label}</span>
                  <span className="text-admin-sm font-bold text-slate-700 tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-slate-400 uppercase font-semibold mb-2">마케팅 ROAS</p>
          {roasData ? (
            <div className="text-center py-3">
              <p className={`text-[24px] font-bold tabular-nums ${roasData.roas >= 2 ? 'text-emerald-700' : roasData.roas >= 1 ? 'text-amber-700' : 'text-red-600'}`}>
                {roasData.roas.toFixed(1)}x
              </p>
              <p className="text-[10px] text-slate-400 mt-1">
                광고비 {fmt만KRW(roasData.spend)} · {roasData.month.slice(5)}월
              </p>
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-[24px] font-bold text-slate-300">—</p>
              <p className="text-[10px] text-slate-400 mt-1">광고 스냅샷 없음</p>
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
                  <span className="text-[10px] text-slate-400">
                    {new Date(item.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="mt-1 text-slate-700">{item.summary}</div>
                <div className="mt-1 text-[11px] text-red-700 break-all">
                  {errMsg.length > 200 ? errMsg.slice(0, 200) + '…' : errMsg}
                </div>
              </li>
            );
          })}
          {items.length > 5 && (
            <li className="text-center text-[11px] text-slate-500">
              +{items.length - 5}건 더 — <a href="/admin/jarvis" className="text-red-600 hover:underline">전체 보기</a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
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

  const loadAll = async (months = 6) => {
    setIsLoading(true);
    setFetchErrors([]);
    try {
      // 서버 pre-fetch 패키지가 있으면 packages 2개 fetch 스킵 — stats/capital만 병렬 조회
      const skipPkg = _skipPackageFetch.current;
      _skipPackageFetch.current = false;

      const fetches: Promise<Response | null>[] = [
        skipPkg ? Promise.resolve(null) : fetch('/api/packages?status=pending'),
        skipPkg ? Promise.resolve(null) : fetch('/api/packages'),
        fetch('/api/dashboard'),
        fetch('/api/capital').catch(() => null),
        // BUG-1: 서버에서 필터 완료 (기존: 500건 limit → client filter, 신규: 전체 기간 unmatched만)
        fetch('/api/bank-transactions?match_status=unmatched').catch(() => null),
      ];
      const [pendingRes, approvedRes, statsRes, capRes, unmatchedRes] = await Promise.all(fetches);

      if (pendingRes) {
        const pendingData = await pendingRes.json();
        setPendingPackages(pendingData.packages || []);
      }
      if (approvedRes) {
        const approvedData = await approvedRes.json();
        setPackages(approvedData.packages || []);
      }
      const statsData = await statsRes!.json();
      if (statsData.stats) setStats(statsData.stats);

      if (capRes && (capRes as Response).ok) {
        const capData = await (capRes as Response).json().catch(() => null);
        if (capData?.total != null) setCapitalTotal(capData.total);
      }
      if (unmatchedRes && (unmatchedRes as Response).ok) {
        const txData = await (unmatchedRes as Response).json().catch(() => null);
        if (txData?.transactions) setUnmatchedCount((txData.transactions as any[]).length);
      }

      // 차트 (fire-and-forget — 느려도 초기 렌더 블록 안 함)
      fetch(`/api/dashboard/chart?months=${months}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.data) setChartData(d.data); })
        .catch(() => { setFetchErrors(prev => [...new Set([...prev, '차트'])]); });

      // V4: 매출 인식 분리 + Booking Pace + 90일 취소율
      fetch(`/api/dashboard/revenue-recognition?months=${months}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d || d.error) { setFetchErrors(prev => [...new Set([...prev, '매출인식'])]); return; }
          if (d.recognized) setRecognized(d.recognized);
          if (d.newBookings) setNewBookings(d.newBookings);
          if (d.pace) setPace(d.pace);
          if (d.cancellation_90d) setCancellation90d(d.cancellation_90d);
        })
        .catch(() => { setFetchErrors(prev => [...new Set([...prev, '매출인식'])]); });

      // V4: 운영 KPI — BUG-3: 에러 응답 방어 추가
      fetch('/api/dashboard/operations')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d || d.error) { setFetchErrors(prev => [...new Set([...prev, '운영KPI'])]); return; }
          if (d.aiUsage) setAiUsage(d.aiUsage);
          if (d.settlement) setSettlement(d.settlement);
          if (d.takeRates) setTakeRates(d.takeRates);
          if (d.repeat) setRepeat(d.repeat);
          if (d.dataQuality) setDataQuality(d.dataQuality);
        })
        .catch(() => { setFetchErrors(prev => [...new Set([...prev, '운영KPI'])]); });

      fetch('/api/agent-actions?status=pending&limit=6')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.actions) setPendingActions(d.actions); })
        .catch(() => {});

      // AI 프로바이더 크레딧 (DeepSeek 잔액 + Gemini/Claude 사용량)
      fetch('/api/admin/ai-credits')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.credits) setAiCredits(d); })
        .catch(() => {});

    } catch (err) {
      console.error('대시보드 로드 실패:', err);
      setFetchErrors(['초기로드']);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setLastRefreshed(new Date());
    }
  };

  useEffect(() => { loadAll(6); }, []);

  const handleAction = async (packageId: string, action: 'approve' | 'reject') => {
    setProcessingId(packageId);
    try {
      const res = await fetch('/api/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, action }),
      });
      if (res.ok) {
        setSelectedPackage(null);
        await loadAll();
      }
    } finally { setProcessingId(null); }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {/* 헤더 스켈레톤 */}
        <div className="flex items-center justify-between animate-pulse">
          <div className="space-y-1.5">
            <div className="h-5 bg-slate-100 rounded w-36" />
            <div className="h-3 bg-slate-100 rounded w-48" />
          </div>
          <div className="h-8 bg-slate-100 rounded w-24" />
        </div>
        {/* ActionBoard 스켈레톤 */}
        <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 animate-pulse">
          <div className="h-4 bg-slate-100 rounded w-24 mb-3" />
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded" />)}
          </div>
        </div>
        {/* TwoTrackKPI 스켈레톤 — 2열 */}
        <div className="grid grid-cols-2 gap-3 animate-pulse">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
              <div className="h-3 bg-slate-100 rounded w-32 mb-2" />
              <div className="h-8 bg-slate-100 rounded w-24 mb-1" />
              <div className="h-3 bg-slate-100 rounded w-40" />
            </div>
          ))}
        </div>
        {/* 재무 카드 스켈레톤 — 4열 */}
        <div className="grid grid-cols-4 gap-2 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-3">
              <div className="h-3 bg-slate-100 rounded w-16 mb-2" />
              <div className="h-5 bg-slate-100 rounded w-20" />
            </div>
          ))}
        </div>
        {/* 차트 스켈레톤 */}
        <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 animate-pulse">
          <div className="h-4 bg-slate-100 rounded w-32 mb-3" />
          <div className="h-[200px] bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* BUG-4: fetch 실패 배너 */}
      {fetchErrors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center justify-between">
          <span className="text-admin-xs text-amber-800">
            일부 데이터 로드 실패 ({fetchErrors.join(', ')}) — 새로고침 후 재시도
          </span>
          <button onClick={() => setFetchErrors([])} className="text-amber-600 text-[11px] hover:underline ml-4">닫기</button>
        </div>
      )}

      {/* UX-2 + E: sticky frosted-glass 헤더 + 기간 필터 + 새로고침 버튼 */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-white/80 backdrop-blur-md border-b border-slate-200/70 shadow-[0_1px_8px_rgba(0,0,0,0.04)] flex items-center justify-between gap-3">
        <div>
          <h1 className="text-admin-lg font-bold text-text-primary">어드민 대시보드</h1>
          {lastRefreshed && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              마지막 새로고침: {lastRefreshed.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          )}
        </div>

        {/* 글로벌 기간 필터 — revenue-recognition + chart 공통 적용 */}
        <div className="flex items-center gap-1 bg-bg-section rounded-[8px] p-0.5 ml-auto">
          {(['3m', '6m', '12m'] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPeriod(p);
                const m = p === '3m' ? 3 : p === '12m' ? 12 : 6;
                setIsRefreshing(true);
                loadAll(m);
              }}
              disabled={isRefreshing || isLoading}
              className={`px-2.5 py-1 rounded-[6px] text-[11px] font-semibold transition-all disabled:opacity-50 ${
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
          onClick={() => {
            const m = period === '3m' ? 3 : period === '12m' ? 12 : 6;
            setIsRefreshing(true);
            loadAll(m);
          }}
          disabled={isRefreshing || isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-admin-xs text-text-body hover:bg-admin-bg disabled:opacity-50 transition-shadow"
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

      {/* ── Zone 1: 긴급 액션 ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-1">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">긴급 처리</span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>

      {/* 자비스 실패 위젯 (실패 0건이면 자동 숨김) */}
      <RecentFailuresWidget />

      {/* 실무자 경고판 — D-7 미납·미매칭·미수금 즉시 처리 */}
      <ActionBoard stats={stats} unmatchedCount={unmatchedCount} />

      {/* 자비스 결재 대기 */}
      {pendingActions.length > 0 && (
        <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-admin-base font-semibold text-text-primary flex items-center gap-2">
              자비스 결재 대기
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingActions.length}</span>
            </h2>
            <Link href="/admin/jarvis?tab=actions" className="text-admin-xs text-blue-600 hover:underline">전체 보기</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pendingActions.slice(0, 6).map((act: any) => (
              <div key={act.id} className="rounded-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-3 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                    { operations: 'bg-blue-50 text-blue-600', sales: 'bg-purple-50 text-purple-600',
                      marketing: 'bg-pink-50 text-pink-600', finance: 'bg-emerald-50 text-emerald-600',
                      products: 'bg-cyan-50 text-cyan-600', system: 'bg-slate-100 text-slate-600',
                    }[act.agent_type as string] || 'bg-slate-100 text-slate-600'
                  }`}>
                    {{ operations: '운영', sales: '영업', marketing: '마케팅', finance: '재무', products: '상품', system: '시스템' }[act.agent_type as string] || act.agent_type}
                  </span>
                  {act.priority !== 'normal' && (
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                      act.priority === 'critical' ? 'bg-red-50 text-red-600' :
                      act.priority === 'high' ? 'bg-orange-50 text-orange-600' : 'bg-slate-50 text-slate-500'
                    }`}>
                      {{ low: '낮음', high: '높음', critical: '긴급' }[act.priority as string] || act.priority}
                    </span>
                  )}
                </div>
                <p className="text-admin-sm font-medium text-slate-800 truncate">{act.summary}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{act.action_type}</p>
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={async () => {
                      setActionProcessingId(act.id);
                      try {
                        await fetch('/api/agent-actions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_id: act.id, action: 'approve' }) });
                        setPendingActions(prev => prev.filter(a => a.id !== act.id));
                      } catch {} finally { setActionProcessingId(null); }
                    }}
                    disabled={actionProcessingId === act.id}
                    className="flex-1 bg-brand text-white py-1 rounded text-[11px] hover:bg-blue-700 disabled:bg-slate-300 transition"
                  >
                    승인
                  </button>
                  <button
                    onClick={async () => {
                      setActionProcessingId(act.id);
                      try {
                        await fetch('/api/agent-actions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_id: act.id, action: 'reject' }) });
                        setPendingActions(prev => prev.filter(a => a.id !== act.id));
                      } catch {} finally { setActionProcessingId(null); }
                    }}
                    disabled={actionProcessingId === act.id}
                    className="flex-1 bg-white border border-slate-300 text-slate-600 py-1 rounded text-[11px] hover:bg-slate-50 transition"
                  >
                    반려
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 승인 대기 상품 */}
      {pendingPackages.length > 0 && (
        <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-admin-base font-semibold text-text-primary">승인 대기 ({pendingPackages.length})</h2>
            <Link href="/admin/packages" className="text-admin-xs text-blue-600 hover:underline">전체 보기</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pendingPackages.slice(0, 6).map(pkg => (
              <div key={pkg.id} className="rounded-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-3 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] cursor-pointer transition-shadow"
                onClick={() => setSelectedPackage(pkg)}>
                <p className="text-admin-sm font-medium text-slate-800 truncate">{pkg.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  {pkg.destination && <span className="text-[11px] text-slate-500">{pkg.destination}</span>}
                  {pkg.price && <span className="text-[11px] text-slate-500">₩{pkg.price.toLocaleString()}</span>}
                  <span className={`ml-auto px-1.5 py-0.5 text-[10px] rounded font-medium ${
                    pkg.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-700' :
                    pkg.confidence >= 0.6 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                  }`}>{Math.round(pkg.confidence * 100)}%</span>
                </div>
                <div className="mt-2 flex gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => handleAction(pkg.id, 'approve')} disabled={processingId === pkg.id}
                    className="flex-1 bg-brand text-white py-1 rounded text-[11px] hover:bg-blue-700 disabled:bg-slate-300 transition">
                    승인
                  </button>
                  <button onClick={() => handleAction(pkg.id, 'reject')} disabled={processingId === pkg.id}
                    className="flex-1 bg-white border border-slate-300 text-slate-600 py-1 rounded text-[11px] hover:bg-slate-50 transition">
                    반려
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Zone 2: 현황 KPI ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-1 mt-2">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">현황 KPI</span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>

      {/* 매출 인식 분리 KPI (IFRS 15 / ASC 606) */}
      <TwoTrackKPI recognized={recognized} newBookings={newBookings} periodLabel={period === '3m' ? '최근 3개월' : period === '12m' ? '최근 12개월' : '최근 6개월'} />

      {/* 재무 미니 카드 — 모두 drilldown 가능 (Stripe 패턴) */}
      {(() => {
        const prevMargin = recognized.length >= 2 ? recognized[recognized.length - 2].margin : null;
        const curMargin = recognized.length >= 1 ? recognized[recognized.length - 1].margin : null;
        const marginMoM = prevMargin != null && prevMargin !== 0 && curMargin != null
          ? ((curMargin - prevMargin) / Math.abs(prevMargin)) * 100 : null;
        const prevBk = newBookings.length >= 2 ? newBookings[newBookings.length - 2].total_bookings : null;
        const curBk = newBookings.length >= 1 ? newBookings[newBookings.length - 1].total_bookings : null;
        const bkMoM = prevBk != null && prevBk !== 0 && curBk != null
          ? ((curBk - prevBk) / prevBk) * 100 : null;
        const Badge = ({ pct }: { pct: number | null }) => pct == null ? null : (
          <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded ${
            pct >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
          }`}>
            {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
          </span>
        );
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {/* 이번달 마진 — featured card */}
            <Link href="/admin/ledger"
              className="bg-brand rounded-xl p-4 shadow-[0_8px_24px_rgba(0,31,63,0.25)] hover:bg-[#1B64DA] transition block">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-blue-200 font-medium">이번달 마진</p>
                <svg className="w-4 h-4 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                </svg>
              </div>
              <p className={`text-[22px] font-black tabular-nums leading-tight ${stats && stats.margin < 0 ? 'text-red-300' : 'text-white'}`}>
                {stats ? `₩${fmt만(stats.margin)}` : '—'}
              </p>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[10px] text-blue-300">출발일 기준</p>
                <Badge pct={marginMoM} />
              </div>
            </Link>
            {/* 자본 잔액 */}
            <Link href="/admin/ledger"
              className="bg-white border border-slate-100 rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:border-slate-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition block">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-slate-400 font-medium">자본 잔액</p>
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-[22px] font-black tabular-nums leading-tight text-emerald-700">
                {capitalTotal !== null ? `₩${fmt만(capitalTotal)}` : '—'}
              </p>
              <p className="text-[10px] text-slate-400 mt-1.5">자본 관리 → 장부</p>
            </Link>
            {/* 미수금 */}
            <Link href="/admin/payments?filter=outstanding"
              className="bg-white border border-slate-100 rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:border-slate-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition block">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-slate-400 font-medium">미수금</p>
                <svg className={`w-4 h-4 ${stats && stats.totalOutstanding > 0 ? 'text-red-400' : 'text-slate-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <p className={`text-[22px] font-black tabular-nums leading-tight ${stats && stats.totalOutstanding > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {stats ? `₩${fmt만(stats.totalOutstanding)}` : '—'}
              </p>
              <p className="text-[10px] text-slate-400 mt-1.5">이번달 잔금 미납</p>
            </Link>
            {/* 진행 예약 */}
            <Link href="/admin/bookings?status=pending,confirmed"
              className="bg-white border border-slate-100 rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:border-slate-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition block">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-slate-400 font-medium">진행 예약</p>
                <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
              </div>
              <p className="text-[22px] font-black tabular-nums leading-tight text-text-primary">
                {stats?.activeBookings ?? 0}<span className="text-admin-base font-semibold ml-0.5">건</span>
              </p>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[10px] text-slate-400">이번달 총 {stats?.totalMonthBookings ?? 0}건 중</p>
                <Badge pct={bkMoM} />
              </div>
            </Link>
          </div>
        );
      })()}

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
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">분석</span>
        <div className="flex-1 h-px bg-slate-100" />
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

      {/* SNS 채널 현황 */}
      <SocialMetricsWidget />

      {/* 추천 시스템 헬스 (점수 v3) */}
      <ScoringKpiWidget />

      {/* 데이터 품질 모니터 (issues=0이면 자동 숨김) */}
      <DataQualityMonitor report={dataQuality} />

      {/* 바로가기 */}
      <div className="bg-white border border-dashed border-slate-300 rounded-lg p-4">
        <h2 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide tracking-wide mb-3">바로가기</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { title: '운영', links: [
              { href: '/admin/bookings', label: '예약 관리' },
              { href: '/admin/customers', label: '고객 관리' },
              { href: '/admin/payments', label: '입금 관리' },
              { href: '/admin/upload', label: '업로드' },
            ]},
            { title: '상품', links: [
              { href: '/admin/packages', label: '상품 관리' },
              { href: '/admin/products/review', label: '상품 검수' },
              { href: '/admin/land-operators', label: '랜드사 관리' },
              { href: '/admin/departing-locations', label: '출발지 관리' },
            ]},
            { title: 'AI/마케팅', links: [
              { href: '/admin/marketing', label: '마케팅' },
              { href: '/admin/marketing/card-news', label: '카드뉴스' },
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
                  className="block text-admin-xs px-2 py-1 text-slate-500 rounded hover:bg-slate-50 hover:text-slate-700 truncate">
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
              { href: '/group-inquiry', label: '단체 견적 (AI)' },
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
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedPackage(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-white shadow-xl border-l border-slate-200 h-full overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between">
              <div className="flex-1 pr-4">
                <h2 className="text-admin-lg font-semibold text-slate-800 leading-snug">{selectedPackage.title}</h2>
                <span className={`px-2 py-0.5 text-[11px] rounded font-medium ${
                  selectedPackage.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-700' :
                  selectedPackage.confidence >= 0.6 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                }`}>{Math.round(selectedPackage.confidence * 100)}%</span>
              </div>
              <button onClick={() => setSelectedPackage(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 text-admin-sm">
              <div className="grid grid-cols-2 gap-2">
                {selectedPackage.destination && <div><span className="text-slate-500">목적지</span><p className="text-slate-800 font-medium">{selectedPackage.destination}</p></div>}
                {selectedPackage.duration && <div><span className="text-slate-500">기간</span><p className="text-slate-800 font-medium">{selectedPackage.duration}일</p></div>}
                {selectedPackage.price && <div><span className="text-slate-500">가격</span><p className="text-slate-800 font-medium">₩{selectedPackage.price.toLocaleString()}</p></div>}
                <div><span className="text-slate-500">파일</span><p className="text-slate-800">{selectedPackage.filename}</p></div>
              </div>
              {selectedPackage.itinerary && selectedPackage.itinerary.length > 0 && (
                <div>
                  <p className="text-slate-500 mb-1">일정</p>
                  <ul className="space-y-0.5 text-slate-700">
                    {selectedPackage.itinerary.map((item, i) => <li key={i} className="pl-2 border-l-2 border-slate-200">{item}</li>)}
                  </ul>
                </div>
              )}
              {selectedPackage.inclusions && selectedPackage.inclusions.length > 0 && (
                <div>
                  <p className="text-slate-500 mb-1">포함 사항</p>
                  <ul className="space-y-0.5 text-slate-700">
                    {selectedPackage.inclusions.map((item, i) => <li key={i}>- {item}</li>)}
                  </ul>
                </div>
              )}
              {selectedPackage.special_notes && (
                <div>
                  <p className="text-slate-500 mb-1">특별 안내</p>
                  <p className="text-slate-700">{selectedPackage.special_notes}</p>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-5 py-3 flex gap-2">
              {selectedPackage.status === 'pending' && (
                <>
                  <button onClick={() => handleAction(selectedPackage.id, 'approve')} disabled={processingId === selectedPackage.id}
                    className="flex-1 bg-brand text-white py-2 rounded text-admin-sm hover:bg-blue-700 disabled:bg-slate-300 transition">승인</button>
                  <button onClick={() => handleAction(selectedPackage.id, 'reject')} disabled={processingId === selectedPackage.id}
                    className="flex-1 bg-white border border-slate-300 text-slate-700 py-2 rounded text-admin-sm hover:bg-slate-50 transition">반려</button>
                </>
              )}
              <button onClick={() => setSelectedPackage(null)}
                className="flex-1 bg-white border border-slate-300 text-slate-700 py-2 rounded text-admin-sm hover:bg-slate-50 transition">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
