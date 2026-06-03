'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  LogOut,
  Receipt,
  TicketPercent,
  UserCircle,
} from 'lucide-react';
import { fmtDateISO, fmtMonthDay } from '@/lib/admin-utils';

type TabKey = 'overview' | 'bookings' | 'settlements' | 'links' | 'content' | 'profile';

interface AffiliateInfo {
  id: string;
  name: string;
  referral_code: string;
  branding_level?: string;
  content_quota?: number;
  content_used?: number;
}

interface AffiliateProfile {
  id: string;
  name: string;
  referral_code: string;
  grade: number;
  grade_label: string;
  grade_rate: string;
  next_grade: string;
  bonus_rate: number;
  branding_level: string;
  content_quota: number;
  content_used: number;
  total_commission: number;
  booking_count: number;
  payout_type: string;
  last_conversion_at: string | null;
}

interface Settlement {
  id: string;
  settlement_period: string;
  status: string;
  total_amount: number;
  final_total: number;
  tax_deduction: number;
  final_payout: number;
  settled_at: string | null;
  qualified_booking_count: number;
}

interface RecentBooking {
  id: string;
  product_name: string;
  booking_date: string | null;
  status: string;
  total_price: number;
  influencer_commission: number;
  created_at: string;
  promo_code: string | null;
  attribution: {
    method: string;
    label: string;
    detail: string;
    model: string;
  };
}

interface PromoCode {
  id: string;
  code: string;
  discount_type: 'fixed' | 'percent';
  discount_value: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  uses_count: number | null;
  created_at: string;
}

interface SubIdStat {
  sub_id: string;
  clicks_30d: number;
  unique_sessions_30d: number;
  touched_packages_30d: number;
  tracking_url: string;
}

interface Insight {
  id: string;
  insight_type: string;
  title: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

interface DashboardStats {
  affiliate: AffiliateProfile;
  stats: {
    total_links: number;
    total_clicks: number;
    total_conversions: number;
    conversion_rate: string;
    link_clicks: number;
    content_clicks: number;
    content_views: number;
  };
  funnel_30d: {
    clicks: number;
    bookings: number;
    settlements_krw: number;
    click_to_booking_rate: number;
  };
  commission_summary: {
    total_gross: number;
    total_payout: number;
    pending_amount: number;
    ready_payout: number;
    completed_payout: number;
    by_status: Record<string, { count: number; total_amount: number; final_payout: number }>;
  };
  tier_progress: {
    current_label: string;
    current_booking_count: number;
    current_step: number;
    next_step: number;
    progress_pct: number;
  };
  recent_bookings: RecentBooking[];
  settlements: Settlement[];
  promo_codes: PromoCode[];
  sub_id_stats: SubIdStat[];
  co_brand: {
    path: string;
    full_url: string;
    landing_views_30d: number;
  };
  recent_card_news: Array<{
    id: string;
    title_slides: Array<{ title?: string }> | null;
    created_at: string;
    views: number | null;
    clicks: number | null;
    status: string;
  }>;
  insights: Insight[];
  booking_trend: Array<{ date: string; bookings: number; revenue: number }>;
  total_views: number;
  total_clicks: number;
  content_clicks: number;
  total_revenue: number;
  pending_revenue: number;
  attribution_notice: string;
  metric_definitions?: Record<string, string>;
}

const TABS: Array<{ key: TabKey; label: string; Icon: typeof BarChart3 }> = [
  { key: 'overview', label: '개요', Icon: BarChart3 },
  { key: 'bookings', label: '예약/귀속', Icon: FileText },
  { key: 'settlements', label: '정산', Icon: Receipt },
  { key: 'links', label: '링크', Icon: Link2 },
  { key: 'content', label: '콘텐츠', Icon: TicketPercent },
  { key: 'profile', label: '프로필', Icon: UserCircle },
];

function krw(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString()}원`;
}

function pct(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function titleFromSlides(slides: Array<{ title?: string }> | null | undefined) {
  return slides?.[0]?.title || '제목 없음';
}

export default function AffiliateDashboardPage() {
  const router = useRouter();
  const [info, setInfo] = useState<AffiliateInfo | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('affiliate_info');
    if (stored) {
      try {
        setInfo(JSON.parse(stored));
      } catch {
        localStorage.removeItem('affiliate_info');
      }
    }
  }, []);

  const loadStats = useCallback(async () => {
    const token = localStorage.getItem('affiliate_token');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/affiliate/dashboard', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || '대시보드를 불러오지 못했습니다.');
      }
      setStats(json);
      if (json.affiliate) {
        setInfo((prev) => prev || {
          id: json.affiliate.id,
          name: json.affiliate.name,
          referral_code: json.affiliate.referral_code,
          branding_level: json.affiliate.branding_level,
          content_quota: json.affiliate.content_quota,
          content_used: json.affiliate.content_used,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '대시보드를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const copyText = async (label: string, value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1400);
  };

  const handleLogout = () => {
    localStorage.removeItem('affiliate_token');
    localStorage.removeItem('affiliate_info');
    router.replace('/affiliate/login');
  };

  const profile = stats?.affiliate;
  const displayName = profile?.name || info?.name || '';
  const referralCode = profile?.referral_code || info?.referral_code || '';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div>
            <h1 className="text-sm font-semibold">파트너 포털</h1>
            <p className="text-xs text-slate-500">{displayName}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/affiliate/card-news/new"
              className="inline-flex h-9 items-center rounded-md bg-slate-950 px-3 text-xs font-medium text-white hover:bg-slate-800"
            >
              콘텐츠 생성
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
              title="로그아웃"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5 overflow-x-auto">
          <div className="flex min-w-max gap-1 rounded-md border border-slate-200 bg-white p-1">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`inline-flex h-9 items-center gap-2 rounded px-3 text-xs font-medium ${
                  activeTab === key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-5">
            <p className="text-sm font-medium text-rose-700">{error}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadStats}
                className="inline-flex h-9 items-center rounded border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700"
              >
                다시 시도
              </button>
              <button
                type="button"
                onClick={() => router.push('/affiliate/login')}
                className="inline-flex h-9 items-center rounded bg-rose-700 px-3 text-xs font-medium text-white"
              >
                로그인
              </button>
            </div>
          </div>
        ) : stats && profile ? (
          <>
            {activeTab === 'overview' && <OverviewTab stats={stats} profile={profile} />}
            {activeTab === 'bookings' && <BookingsTab bookings={stats.recent_bookings} />}
            {activeTab === 'settlements' && <SettlementsTab stats={stats} />}
            {activeTab === 'links' && (
              <LinksTab
                referralCode={referralCode}
                coBrand={stats.co_brand}
                promoCodes={stats.promo_codes}
                subStats={stats.sub_id_stats}
                copied={copied}
                onCopy={copyText}
              />
            )}
            {activeTab === 'content' && <ContentTab stats={stats} />}
            {activeTab === 'profile' && <ProfileTab profile={profile} notice={stats.attribution_notice} />}
          </>
        ) : null}
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-md border border-slate-200 bg-white" />
      ))}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function OverviewTab({ stats, profile }: { stats: DashboardStats; profile: AffiliateProfile }) {
  const quotaPct = profile.content_quota > 0 ? Math.round((profile.content_used / profile.content_quota) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="30일 유입 클릭" value={stats.funnel_30d.clicks.toLocaleString()} sub={`${stats.co_brand.landing_views_30d.toLocaleString()} 랜딩뷰`} />
        <MetricCard label="30일 예약" value={stats.funnel_30d.bookings.toLocaleString()} sub={`${pct(stats.funnel_30d.click_to_booking_rate)} 전환`} />
        <MetricCard label="콘텐츠 클릭" value={stats.stats.content_clicks.toLocaleString()} sub={`${stats.stats.content_views.toLocaleString()} 조회`} />
        <MetricCard label="지급 대기" value={krw(stats.commission_summary.ready_payout)} sub="READY 정산" />
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">등급 진행</h2>
            <p className="mt-1 text-xs text-slate-500">
              {stats.tier_progress.current_label} · {stats.tier_progress.current_booking_count.toLocaleString()}건
            </p>
          </div>
          <span className="text-sm font-semibold tabular-nums">{stats.tier_progress.progress_pct}%</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, stats.tier_progress.progress_pct)}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>{stats.tier_progress.current_step}건</span>
          <span>{stats.tier_progress.next_step}건</span>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-md border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">콘텐츠 사용량</h2>
            <Link href="/affiliate/card-news" className="text-xs font-medium text-slate-600 hover:text-slate-950">전체 보기</Link>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>이번 달 생성</span>
            <span className="tabular-nums">{profile.content_used} / {profile.content_quota}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, quotaPct)}%` }} />
          </div>
          <div className="mt-4 space-y-2">
            {stats.recent_card_news.slice(0, 4).map((item) => (
              <Link key={item.id} href={`/affiliate/card-news/${item.id}`} className="flex items-center justify-between rounded border border-slate-100 p-3 hover:bg-slate-50">
                <span className="truncate text-xs font-medium">{titleFromSlides(item.title_slides)}</span>
                <span className="ml-3 text-xs tabular-nums text-slate-500">{Number(item.clicks || 0).toLocaleString()} 클릭</span>
              </Link>
            ))}
            {stats.recent_card_news.length === 0 ? <p className="py-5 text-center text-sm text-slate-500">아직 생성한 콘텐츠가 없습니다.</p> : null}
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold">최근 7일 활동</h2>
          <div className="flex h-32 items-end gap-2">
            {stats.booking_trend.map((day) => {
              const max = Math.max(...stats.booking_trend.map((d) => d.bookings), 1);
              const h = (day.bookings / max) * 100;
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] tabular-nums text-slate-500">{day.bookings}</span>
                  <div className="relative h-24 w-full rounded-t bg-slate-100">
                    <div className="absolute bottom-0 w-full rounded-t bg-slate-800" style={{ height: `${Math.max(h, 8)}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-500">{fmtMonthDay(day.date)}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function BookingsTab({ bookings }: { bookings: RecentBooking[] }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const statusOptions = useMemo(() => ['all', ...Array.from(new Set(bookings.map((booking) => booking.status || 'UNKNOWN')))], [bookings]);
  const methodOptions = useMemo(() => ['all', ...Array.from(new Set(bookings.map((booking) => booking.attribution.method)))], [bookings]);
  const filteredBookings = useMemo(() => bookings.filter((booking) => {
    const statusOk = statusFilter === 'all' || (booking.status || 'UNKNOWN') === statusFilter;
    const methodOk = methodFilter === 'all' || booking.attribution.method === methodFilter;
    const dateValue = new Date(booking.booking_date || booking.created_at).getTime();
    const days = periodFilter === '7d' ? 7 : periodFilter === '30d' ? 30 : null;
    const periodOk = !days || (Number.isFinite(dateValue) && dateValue >= Date.now() - days * 86400000);
    return statusOk && methodOk && periodOk;
  }), [bookings, methodFilter, periodFilter, statusFilter]);

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-sm font-semibold">최근 예약과 귀속 방식</h2>
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"
            aria-label="예약 상태 필터"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>{status === 'all' ? '전체 상태' : status}</option>
            ))}
          </select>
          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"
            aria-label="예약 기간 필터"
          >
            <option value="all">전체 기간</option>
            <option value="7d">최근 7일</option>
            <option value="30d">최근 30일</option>
          </select>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"
            aria-label="귀속 방식 필터"
          >
            {methodOptions.map((method) => (
              <option key={method} value={method}>{method === 'all' ? '전체 귀속' : method}</option>
            ))}
          </select>
        </div>
      </div>
      {bookings.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">아직 귀속된 예약이 없습니다.</p>
      ) : filteredBookings.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">필터에 맞는 예약이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">예약</th>
                <th className="px-4 py-3 text-left font-medium">귀속 방식</th>
                <th className="px-4 py-3 text-right font-medium">예약금액</th>
                <th className="px-4 py-3 text-right font-medium">커미션</th>
                <th className="px-4 py-3 text-center font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBookings.map((booking) => (
                <tr key={booking.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{booking.product_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{booking.booking_date ? fmtDateISO(booking.booking_date) : fmtDateISO(booking.created_at)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{booking.attribution.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{booking.attribution.model}{booking.promo_code ? ` · ${booking.promo_code}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{krw(booking.total_price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{krw(booking.influencer_commission)}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={booking.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SettlementsTab({ stats }: { stats: DashboardStats }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const statusOptions = useMemo(() => ['all', ...Array.from(new Set(stats.settlements.map((s) => s.status || 'UNKNOWN')))], [stats.settlements]);
  const filteredSettlements = useMemo(() => (
    statusFilter === 'all'
      ? stats.settlements
      : stats.settlements.filter((s) => (s.status || 'UNKNOWN') === statusFilter)
  ), [stats.settlements, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="발생 커미션" value={krw(stats.commission_summary.total_gross)} />
        <MetricCard label="지급 예정" value={krw(stats.commission_summary.ready_payout)} />
        <MetricCard label="지급 완료" value={krw(stats.commission_summary.completed_payout)} />
        <MetricCard label="보류/대기" value={krw(stats.commission_summary.pending_amount)} />
      </div>
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-sm font-semibold">정산 내역</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"
            aria-label="정산 상태 필터"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>{status === 'all' ? '전체 상태' : status}</option>
            ))}
          </select>
        </div>
        {stats.settlements.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">아직 정산 내역이 없습니다.</p>
        ) : filteredSettlements.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">필터에 맞는 정산 내역이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">정산월</th>
                  <th className="px-4 py-3 text-right font-medium">건수</th>
                  <th className="px-4 py-3 text-right font-medium">발생액</th>
                  <th className="px-4 py-3 text-right font-medium">원천징수</th>
                  <th className="px-4 py-3 text-right font-medium">실지급액</th>
                  <th className="px-4 py-3 text-center font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSettlements.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-medium">{s.settlement_period}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{s.qualified_booking_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{krw(s.total_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-600">{s.tax_deduction > 0 ? `-${krw(s.tax_deduction)}` : '0원'}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{krw(s.final_payout)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function LinksTab({
  referralCode,
  coBrand,
  promoCodes,
  subStats,
  copied,
  onCopy,
}: {
  referralCode: string;
  coBrand: DashboardStats['co_brand'];
  promoCodes: PromoCode[];
  subStats: SubIdStat[];
  copied: string;
  onCopy: (label: string, value: string) => void;
}) {
  const baseUrl = coBrand.full_url || coBrand.path;
  const [customSubId, setCustomSubId] = useState('');
  const subIdPresets = ['instagram', 'kakao', 'blog', 'youtube', 'dm'];
  const normalizedSubId = customSubId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const generatedSubUrl = normalizedSubId
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}sub_id=${encodeURIComponent(normalizedSubId)}`
    : '';

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">대표 추천 링크</h2>
        <div className="mt-3 flex flex-col gap-2 rounded-md bg-slate-50 p-3 md:flex-row md:items-center md:justify-between">
          <code className="break-all text-xs text-slate-700">{baseUrl}</code>
          <div className="flex gap-2">
            <button type="button" onClick={() => onCopy('base', baseUrl)} className="inline-flex h-8 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-xs font-medium">
              <Copy size={14} /> {copied === 'base' ? '복사됨' : '복사'}
            </button>
            <Link href={coBrand.path} className="inline-flex h-8 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-xs font-medium">
              <ExternalLink size={14} /> 열기
            </Link>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold">Sub-ID 추적 링크</h2>
        </div>
        <div className="border-b border-slate-100 p-4">
          <label className="block text-xs font-medium text-slate-600" htmlFor="custom-sub-id">새 Sub-ID</label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {subIdPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCustomSubId(preset)}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                {preset}
              </button>
            ))}
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-[220px_1fr_auto] md:items-center">
            <input
              id="custom-sub-id"
              type="text"
              value={customSubId}
              onChange={(e) => setCustomSubId(e.target.value)}
              placeholder="instagram-story"
              className="h-9 rounded border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
            />
            <code className="min-h-9 break-all rounded bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {generatedSubUrl || `${baseUrl}?sub_id=instagram-story`}
            </code>
            <button
              type="button"
              onClick={() => onCopy(`custom:${normalizedSubId}`, generatedSubUrl)}
              disabled={!generatedSubUrl}
              className="inline-flex h-9 items-center justify-center gap-2 rounded border border-slate-200 bg-white px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Copy size={14} /> {copied === `custom:${normalizedSubId}` ? '복사됨' : '복사'}
            </button>
          </div>
        </div>
        {subStats.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">최근 30일 Sub-ID 유입이 없습니다.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {subStats.map((row) => (
              <div key={row.sub_id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_120px_120px_120px_auto] md:items-center">
                <code className="break-all text-xs text-slate-700">{row.tracking_url}</code>
                <span className="text-xs tabular-nums text-slate-500">{row.clicks_30d} 클릭</span>
                <span className="text-xs tabular-nums text-slate-500">{row.unique_sessions_30d} 세션</span>
                <span className="text-xs tabular-nums text-slate-500">{row.touched_packages_30d} 상품</span>
                <button type="button" onClick={() => onCopy(row.sub_id, row.tracking_url)} className="inline-flex h-8 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-xs font-medium">
                  <Copy size={14} /> {copied === row.sub_id ? '복사됨' : '복사'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold">프로모코드</h2>
        </div>
        {promoCodes.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">등록된 프로모코드가 없습니다.</p>
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {promoCodes.map((promo) => {
              const remainingCount = promo.max_uses === null ? null : Math.max(0, promo.max_uses - Number(promo.uses_count || 0));
              const remaining = remainingCount === null ? '무제한' : remainingCount.toLocaleString();
              const lowStock = remainingCount !== null && remainingCount <= 10;
              const soldOut = remainingCount === 0;
              return (
                <div key={promo.id} className={`rounded-md border p-4 ${soldOut ? 'border-rose-300 bg-rose-50/70' : lowStock ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <code className="font-semibold">{promo.code}</code>
                    <StatusBadge status={promo.is_active ? 'ACTIVE' : 'INACTIVE'} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <div><span className="block">혜택</span><strong className="text-slate-900">{promo.discount_type === 'percent' ? `${promo.discount_value}%` : krw(promo.discount_value)}</strong></div>
                    <div><span className="block">사용</span><strong className="text-slate-900">{Number(promo.uses_count || 0).toLocaleString()}</strong></div>
                    <div><span className="block">잔여</span><strong className="text-slate-900">{remaining}</strong></div>
                  </div>
                  {remainingCount !== null && remainingCount <= 10 ? (
                    <p className={`mt-3 rounded px-2 py-1 text-xs font-medium ${soldOut ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
                      {soldOut ? '프로모코드가 모두 소진되었습니다.' : '잔여 사용량이 10개 이하입니다.'}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function ContentTab({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">최근 콘텐츠</h2>
        <div className="mt-4 space-y-2">
          {stats.recent_card_news.map((item) => (
            <Link key={item.id} href={`/affiliate/card-news/${item.id}`} className="block rounded border border-slate-100 p-3 hover:bg-slate-50">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium">{titleFromSlides(item.title_slides)}</p>
                <StatusBadge status={item.status} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {fmtDateISO(item.created_at)} · {Number(item.views || 0).toLocaleString()} 조회 · {Number(item.clicks || 0).toLocaleString()} 클릭
              </p>
            </Link>
          ))}
          {stats.recent_card_news.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">아직 생성한 콘텐츠가 없습니다.</p> : null}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">AI 인사이트</h2>
        <div className="mt-4 space-y-2">
          {stats.insights.map((insight) => (
            <div key={insight.id} className="rounded border border-slate-100 p-3">
              <p className="text-sm font-medium">{insight.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{insight.content}</p>
              <p className="mt-2 text-[11px] text-slate-400">{fmtDateISO(insight.created_at)}</p>
            </div>
          ))}
          {stats.insights.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">아직 표시할 인사이트가 없습니다.</p> : null}
        </div>
      </section>
    </div>
  );
}

function ProfileTab({ profile, notice }: { profile: AffiliateProfile; notice: string }) {
  const brandingLabel = profile.branding_level === 'white_label'
    ? '화이트라벨'
    : profile.branding_level === 'co_brand'
      ? '코브랜딩'
      : '기본 파트너';

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">기본 정보</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <InfoItem label="이름" value={profile.name} />
          <InfoItem label="추천 코드" value={profile.referral_code} />
          <InfoItem label="등급" value={profile.grade_label} />
          <InfoItem label="보너스율" value={pct(profile.bonus_rate * 100)} />
          <InfoItem label="브랜딩" value={brandingLabel} />
          <InfoItem label="정산 유형" value={profile.payout_type || '-'} />
          <InfoItem label="누적 예약" value={`${profile.booking_count.toLocaleString()}건`} />
          <InfoItem label="누적 커미션" value={krw(profile.total_commission)} />
          <InfoItem label="마지막 전환" value={profile.last_conversion_at ? fmtDateISO(profile.last_conversion_at) : '-'} />
        </dl>
      </section>
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">정산 안내</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{notice}</p>
      </section>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium text-slate-950">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = (status || 'UNKNOWN').toUpperCase();
  const tone =
    normalized === 'COMPLETED' || normalized === 'ACTIVE'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : normalized === 'READY' || normalized === 'CONFIRMED'
        ? 'bg-sky-50 text-sky-700 ring-sky-200'
        : normalized === 'VOID' || normalized === 'CANCELLED' || normalized === 'INACTIVE'
          ? 'bg-rose-50 text-rose-700 ring-rose-200'
          : 'bg-slate-50 text-slate-600 ring-slate-200';

  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>
      {normalized}
    </span>
  );
}
