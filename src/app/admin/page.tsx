'use client';

import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import Link from 'next/link';
import nextDynamic from 'next/dynamic';

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
  totalMonthBookings: number; totalMileage: number; expiringPassports: number;
}

interface MonthlyChartData {
  month: string; direct_sales: number; affiliate_sales: number;
  direct_margin: number; affiliate_margin: number;
  total_commission: number; ad_spend_krw: number; net_margin: number;
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
const fmtComma = (n: number) => n.toLocaleString();

// ── 서브 컴포넌트: TwoTrackKPI ────────────────────────────

function TwoTrackKPI({ stats, prevMonthGrowth }: { stats: DashboardStats | null; prevMonthGrowth: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-slate-400 uppercase">예약 지표 (당월)</span>
          {prevMonthGrowth !== 0 && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${prevMonthGrowth >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {prevMonthGrowth >= 0 ? '+' : ''}{prevMonthGrowth}%
            </span>
          )}
        </div>
        <p className="text-[28px] font-bold text-[#001f3f] tabular-nums">
          {stats ? `₩${fmt만(stats.totalSales)}` : '—'}
        </p>
        <p className="text-[12px] text-slate-500 mt-1">
          {stats?.totalMonthBookings ?? 0}건 신규 예약
        </p>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <span className="text-[11px] font-semibold text-slate-400 uppercase block mb-2">출발 확정 (당월)</span>
        <p className="text-[28px] font-bold text-emerald-700 tabular-nums">
          {stats ? `₩${fmt만(stats.totalPaid)}` : '—'}
        </p>
        <p className="text-[12px] text-slate-500 mt-1">
          입금률 {stats && stats.totalSales > 0 ? Math.round((stats.totalPaid / stats.totalSales) * 100) : 0}%
        </p>
      </div>
    </div>
  );
}

// ── 서브 컴포넌트: CashflowChart ──────────────────────────

function CashflowChart({ chartData }: { chartData: MonthlyChartData[] }) {
  if (chartData.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-slate-800 mb-3">캐시플로우 예측 (6개월)</h2>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5) + '월'} />
          <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={v => fmt만(Number(v))} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
          <Tooltip
            formatter={(value: unknown, name: unknown) => [
              name === 'cancel_rate' ? `${value}%` : `₩${fmtComma(Number(value ?? 0))}`,
              name === 'direct_sales' ? '출발 예정 총액' :
              name === 'direct_margin' ? '잔금 완료액' :
              name === 'cancel_rate' ? '예상 취소율' : String(name),
            ] as [string, string]}
          />
          <Bar yAxisId="left" dataKey="direct_sales" fill="#cbd5e1" radius={[3, 3, 0, 0]} name="direct_sales" />
          <Bar yAxisId="left" dataKey="direct_margin" fill="#3b82f6" radius={[3, 3, 0, 0]} name="direct_margin" />
          <Line yAxisId="right" type="monotone" dataKey="net_margin" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} name="cancel_rate" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 서브 컴포넌트: ActionBoard ─────────────────────────────

function ActionBoard({ stats, unmatchedCount }: { stats: DashboardStats | null; unmatchedCount: number | null }) {
  const actions = [
    { label: 'D-7 잔금 미납', count: stats?.activeBookings ?? 0, color: 'text-red-600 bg-red-50 border-red-200', href: '/admin/bookings', btnLabel: '알림톡 발송' },
    { label: '여권 만료 임박', count: stats?.expiringPassports ?? 0, color: 'text-amber-600 bg-amber-50 border-amber-200', href: '/admin/customers', btnLabel: '확인' },
    { label: '미매칭 입금', count: unmatchedCount ?? 0, color: 'text-blue-600 bg-blue-50 border-blue-200', href: '/admin/payments', btnLabel: '매칭하기' },
    { label: '미수금', count: stats ? Math.round(stats.totalOutstanding / 10000) : 0, color: 'text-red-600 bg-red-50 border-red-200', href: '/admin/payments', btnLabel: '독촉', unit: '만원' },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-slate-800 mb-3">실무자 경고판</h2>
      <div className="space-y-2">
        {actions.map((a, i) => (
          <div key={i} className={`flex items-center justify-between p-2.5 rounded border ${a.color}`}>
            <div className="flex items-center gap-3">
              <span className="text-[18px] font-bold tabular-nums">{a.count}{a.unit ? '' : '건'}</span>
              <span className="text-[13px] font-medium">{a.label}</span>
            </div>
            <Link href={a.href} className="px-2.5 py-1 bg-white border border-slate-200 rounded text-[11px] text-slate-600 hover:bg-slate-50 transition">
              {a.btnLabel}
            </Link>
          </div>
        ))}
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
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-semibold text-slate-800">SNS 채널 현황</h2>
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
              <p className="text-[16px] font-bold text-slate-800 tabular-nums">{ch.current.toLocaleString()}</p>
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
                className="w-20 border border-slate-200 rounded px-2 py-1 text-[12px] text-slate-600 focus:ring-1 focus:ring-[#005d90]" />
              <input type="number" value={formValues[i]}
                onChange={e => { const next = [...formValues]; next[i] = e.target.value; setFormValues(next); }}
                className="flex-1 border border-slate-200 rounded px-2 py-1 text-[13px] focus:ring-1 focus:ring-[#005d90]" />
              {channels.length > 1 && (
                <button onClick={() => {
                  setChannels(channels.filter((_, idx) => idx !== i));
                  setFormValues(formValues.filter((_, idx) => idx !== i));
                }} className="text-slate-300 hover:text-red-500 text-[13px]">x</button>
              )}
            </div>
          ))}
          <button onClick={() => {
            setChannels([...channels, { name: `채널${channels.length + 1}`, current: 0, prev: 0 }]);
            setFormValues([...formValues, '0']);
          }} className="w-full py-1 border border-dashed border-slate-300 rounded text-[11px] text-slate-400 hover:text-slate-600 hover:border-slate-400 transition">
            + 채널 추가
          </button>
          <button onClick={handleSave} className="w-full py-1.5 bg-[#001f3f] text-white rounded text-[12px] hover:bg-blue-900 transition">저장</button>
        </div>
      )}
    </div>
  );
}

// ── 서브 컴포넌트: AIInsights ──────────────────────────────

function AIInsights({ packages }: { packages: TravelPackage[] }) {
  const top3 = useMemo(() =>
    packages
      .filter(p => p.price && p.price > 0)
      .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
      .slice(0, 3),
  [packages]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h2 className="text-[14px] font-semibold text-slate-800 mb-3">AI 인사이트</h2>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-slate-400 uppercase font-semibold mb-2">Top 3 효자 상품</p>
          {top3.length === 0 ? (
            <p className="text-[12px] text-slate-400">데이터 없음</p>
          ) : (
            <div className="space-y-1.5">
              {top3.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                    i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : 'bg-amber-700'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-slate-700 truncate">{p.title}</p>
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
                  <span className="text-[13px] font-bold text-slate-700 tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-slate-400 uppercase font-semibold mb-2">마케팅 ROAS</p>
          <div className="text-center py-3">
            <p className="text-[24px] font-bold text-[#001f3f]">—</p>
            <p className="text-[10px] text-slate-400 mt-1">데이터 수집 중</p>
          </div>
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
          <span className="text-[14px]">⚠️</span>
          <span className="text-[13px] font-semibold text-red-800">
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
              <li key={item.id} className="bg-white border border-red-100 rounded p-2 text-[12px]">
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

export default function AdminPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chartData, setChartData] = useState<MonthlyChartData[]>([]);
  const [packages, setPackages] = useState<TravelPackage[]>([]);
  const [pendingPackages, setPendingPackages] = useState<TravelPackage[]>([]);
  const [capitalTotal, setCapitalTotal] = useState<number | null>(null);
  const [unmatchedCount, setUnmatchedCount] = useState<number | null>(null);
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [actionProcessingId, setActionProcessingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 상세 패널
  const [selectedPackage, setSelectedPackage] = useState<TravelPackage | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [pendingRes, approvedRes, statsRes] = await Promise.all([
        fetch('/api/packages?status=pending'),
        fetch('/api/packages'),
        fetch('/api/dashboard'),
      ]);
      const pendingData = await pendingRes.json();
      const approvedData = await approvedRes.json();
      const statsData = await statsRes.json();
      setPendingPackages(pendingData.packages || []);
      setPackages(approvedData.packages || []);
      if (statsData.stats) setStats(statsData.stats);

      fetch('/api/dashboard/chart').then(r => r.ok ? r.json() : null).then(d => {
        if (d?.data) setChartData(d.data);
      }).catch(() => {});

      fetch('/api/agent-actions?status=pending&limit=6').then(r => r.ok ? r.json() : null).then(d => {
        if (d?.actions) setPendingActions(d.actions);
      }).catch(() => {});

      Promise.all([
        fetch('/api/capital').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/bank-transactions').then(r => r.ok ? r.json() : null).catch(() => null),
      ]).then(([capData, txData]) => {
        if (capData?.total != null) setCapitalTotal(capData.total);
        if (txData?.transactions) {
          setUnmatchedCount((txData.transactions as { match_status: string }[]).filter(t => t.match_status === 'unmatched').length);
        }
      });
    } catch (err) {
      console.error('대시보드 로드 실패:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

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

  const prevMonthGrowth = useMemo(() => {
    if (chartData.length < 2) return 0;
    const last = chartData[chartData.length - 1];
    const prev = chartData[chartData.length - 2];
    const lastTotal = last.direct_sales + last.affiliate_sales;
    const prevTotal = prev.direct_sales + prev.affiliate_sales;
    return prevTotal > 0 ? Math.round(((lastTotal - prevTotal) / prevTotal) * 100) : 0;
  }, [chartData]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-6 animate-pulse">
            <div className="h-6 bg-slate-100 rounded w-1/3 mb-3" />
            <div className="h-10 bg-slate-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 0. 자비스 실패 위젯 (실패 0건이면 자동 숨김) */}
      <RecentFailuresWidget />

      {/* A. 예약 vs 출발 KPI */}
      <TwoTrackKPI stats={stats} prevMonthGrowth={prevMonthGrowth} />

      {/* 재무 미니 카드 */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: '순 마진', value: stats ? `₩${fmt만(stats.margin)}` : '—', color: 'text-slate-800', href: '/admin/ledger' },
          { label: '가용 자산', value: capitalTotal !== null && stats ? `₩${fmt만((stats.totalPaid || 0) + capitalTotal - (stats.totalSales - stats.totalOutstanding || 0))}` : '—', color: 'text-emerald-700', href: '/admin/ledger' },
          { label: '미수금', value: stats ? `₩${fmt만(stats.totalOutstanding)}` : '—', color: 'text-red-600', href: '/admin/payments' },
          { label: '진행 예약', value: `${stats?.activeBookings ?? 0}건`, color: 'text-[#001f3f]', href: '/admin/bookings' },
        ].map((kpi, i) => (
          <Link key={i} href={kpi.href} className="bg-white border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition block">
            <p className="text-[10px] text-slate-400 uppercase">{kpi.label}</p>
            <p className={`text-[16px] font-bold tabular-nums ${kpi.color}`}>{kpi.value}</p>
          </Link>
        ))}
      </div>

      {/* B. 캐시플로우 차트 */}
      <CashflowChart chartData={chartData} />

      {/* C + D 중단 2열 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ActionBoard stats={stats} unmatchedCount={unmatchedCount} />
        <SocialMetricsWidget />
      </div>

      {/* E. AI 인사이트 */}
      <AIInsights packages={packages} />

      {/* 자비스 결재 대기 */}
      {pendingActions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-slate-800 flex items-center gap-2">
              자비스 결재 대기
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingActions.length}</span>
            </h2>
            <Link href="/admin/jarvis?tab=actions" className="text-[12px] text-blue-600 hover:underline">전체 보기</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pendingActions.slice(0, 6).map((act: any) => (
              <div key={act.id} className="border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition">
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
                <p className="text-[13px] font-medium text-slate-800 truncate">{act.summary}</p>
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
                    className="flex-1 bg-[#001f3f] text-white py-1 rounded text-[11px] hover:bg-blue-900 disabled:bg-slate-300 transition"
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
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-semibold text-slate-800">승인 대기 ({pendingPackages.length})</h2>
            <Link href="/admin/packages" className="text-[12px] text-blue-600 hover:underline">전체 보기</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pendingPackages.slice(0, 6).map(pkg => (
              <div key={pkg.id} className="border border-slate-200 rounded-lg p-3 hover:border-slate-300 cursor-pointer transition"
                onClick={() => setSelectedPackage(pkg)}>
                <p className="text-[13px] font-medium text-slate-800 truncate">{pkg.title}</p>
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
                    className="flex-1 bg-[#001f3f] text-white py-1 rounded text-[11px] hover:bg-blue-900 disabled:bg-slate-300 transition">
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

      {/* 바로가기 */}
      <div className="bg-white border border-dashed border-slate-300 rounded-lg p-4">
        <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">바로가기</h2>
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
              <p className="text-[11px] font-semibold text-slate-400 uppercase">{group.title}</p>
              {group.links.map(l => (
                <Link key={l.href} href={l.href}
                  className="block text-[12px] px-2 py-1 text-slate-500 rounded hover:bg-slate-50 hover:text-slate-700 truncate">
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
              { href: '/influencer', label: '인플루언서 포털' },
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
                  className="block text-[12px] px-2 py-1 text-blue-600 rounded hover:bg-blue-50 hover:text-blue-800 truncate">
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
                <h2 className="text-[16px] font-semibold text-slate-800 leading-snug">{selectedPackage.title}</h2>
                <span className={`px-2 py-0.5 text-[11px] rounded font-medium ${
                  selectedPackage.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-700' :
                  selectedPackage.confidence >= 0.6 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                }`}>{Math.round(selectedPackage.confidence * 100)}%</span>
              </div>
              <button onClick={() => setSelectedPackage(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 text-[13px]">
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
                    className="flex-1 bg-[#001f3f] text-white py-2 rounded text-[13px] hover:bg-blue-900 disabled:bg-slate-300 transition">승인</button>
                  <button onClick={() => handleAction(selectedPackage.id, 'reject')} disabled={processingId === selectedPackage.id}
                    className="flex-1 bg-white border border-slate-300 text-slate-700 py-2 rounded text-[13px] hover:bg-slate-50 transition">반려</button>
                </>
              )}
              <button onClick={() => setSelectedPackage(null)}
                className="flex-1 bg-white border border-slate-300 text-slate-700 py-2 rounded text-[13px] hover:bg-slate-50 transition">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
