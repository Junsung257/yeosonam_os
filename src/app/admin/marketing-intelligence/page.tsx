import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  RefreshCw,
  BarChart3,
  GitBranch,
  CheckSquare,
  Users,
  TrendingUp,
  Activity,
  Target,
  DollarSign,
  Eye,
  MousePointerClick,
  AlertTriangle,
  Play,
  Zap,
  Layers,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── 타입 ─────────────────────────────────────────────────

interface AttributionRow {
  channel: string;
  sessions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  cost: number;
  roi: number;
  last_updated: string;
}

interface AbExperiment {
  id: string;
  name: string;
  variant_a_name: string;
  variant_b_name: string;
  variant_a_conversions: number;
  variant_b_conversions: number;
  variant_a_views: number;
  variant_b_views: number;
  started_at: string;
  status: string;
  winner: string | null;
  confidence: number | null;
}

interface ContentReviewItem {
  id: string;
  title: string;
  channel: string;
  submitted_at: string;
  status: string;
  reviewer?: string;
}

interface RfmSegment {
  segment: string;
  count: number;
  avg_recency: number;
  avg_frequency: number;
  avg_monetary: number;
}

interface PredictiveInsight {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: number;
  expected_impact: string;
  confidence_score: number;
  created_at: string;
}

// ── 상수 ─────────────────────────────────────────────────

const CHANNEL_LABEL: Record<string, string> = {
  instagram: '인스타그램',
  facebook: '페이스북',
  google_ads: 'Google Ads',
  naver_blog: '네이버 블로그',
  kakao: '카카오톡',
  email: '이메일',
  referral: '추천',
  organic: '오가닉',
  direct: '직접',
};

const CHANNEL_ICON: Record<string, LucideIcon> = {
  instagram: Eye,
  facebook: Eye,
  google_ads: MousePointerClick,
  naver_blog: Layers,
};

const ENGINE_BUTTONS = [
  { label: '어트리뷰션 새로고침', endpoint: '/api/marketing/refresh-attribution', icon: RefreshCw, color: 'blue' },
  { label: 'RFM 재계산', endpoint: '/api/marketing/refresh-rfm', icon: Target, color: 'purple' },
  { label: '예측 인사이트 생성', endpoint: '/api/marketing/run-predictive', icon: TrendingUp, color: 'emerald' },
  { label: '콘텐츠 갭 자동 치유', endpoint: '/api/marketing/auto-heal-gaps', icon: Zap, color: 'orange' },
  { label: 'A/B 테스트 자동 종료', endpoint: '/api/marketing/auto-finalize-ab', icon: GitBranch, color: 'indigo' },
] as const;

const TAB_ITEMS = [
  { key: 'overview', label: '개요', icon: BarChart3 },
  { key: 'attribution', label: '어트리뷰션', icon: Activity },
  { key: 'ab_test', label: 'A/B 테스트', icon: GitBranch },
  { key: 'content_review', label: '콘텐츠 검수', icon: CheckSquare },
  { key: 'segments', label: '고객 세그먼트', icon: Users },
  { key: 'insights', label: '예측 인사이트', icon: TrendingUp },
] as const;

// ── 서버 데이터 페칭 ────────────────────────────────────

async function fetchAttributionSummary(): Promise<AttributionRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin
    .from('attribution_summary')
    .select('*')
    .order('revenue', { ascending: false })
    .limit(20);
  return (data ?? []) as AttributionRow[];
}

async function fetchAbExperiments(): Promise<(AbExperiment & { variants: { name: string; views: number; conversions: number }[] })[]> {
  if (!isSupabaseConfigured) return [];
  const { data: experiments } = await supabaseAdmin
    .from('ab_experiments')
    .select('*')
    .in('status', ['active', 'running'])
    .order('started_at', { ascending: false })
    .limit(20);
  if (!experiments) return [];

  const results = await Promise.all(
    (experiments as AbExperiment[]).map(async (exp) => {
      const { data: variants } = await supabaseAdmin
        .from('ab_variants')
        .select('name, views, conversions')
        .eq('experiment_id', exp.id);
      return {
        ...exp,
        variants: (variants ?? []) as { name: string; views: number; conversions: number }[],
      };
    }),
  );
  return results;
}

async function fetchContentReviewQueue(): Promise<ContentReviewItem[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin
    .from('content_review_queue')
    .select('*')
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true })
    .limit(50);
  return (data ?? []) as ContentReviewItem[];
}

async function fetchRfmData(): Promise<{ segments: RfmSegment[]; total: number }> {
  if (!isSupabaseConfigured) return { segments: [], total: 0 };
  const [{ data: rfm }, { data: countData }] = await Promise.all([
    supabaseAdmin
      .from('customer_rfm')
      .select('segment, count, avg_recency, avg_frequency, avg_monetary'),
    supabaseAdmin
      .from('customer_segments')
      .select('count', { count: 'exact', head: false }),
  ]);
  const segments = (rfm ?? []) as RfmSegment[];
  const total = (countData as { count: number }[] | null)?.[0]?.count ?? segments.reduce((s, r) => s + r.count, 0);
  return { segments, total };
}

async function fetchPredictiveInsights(): Promise<PredictiveInsight[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin
    .from('predictive_insights')
    .select('*')
    .order('priority', { ascending: true })
    .limit(20);
  return (data ?? []) as PredictiveInsight[];
}

// ── 포맷 헬퍼 ────────────────────────────────────────────

const fmtKRW = (n: number) => {
  if (n === 0) return '0';
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString();
};

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtNum = (n: number) => n.toLocaleString();

// ── 페이지 컴포넌트 ────────────────────────────────────

export default async function MarketingIntelligencePage() {
  const [
    attribution,
    experiments,
    reviewQueue,
    rfmData,
    insights,
  ] = await Promise.all([
    fetchAttributionSummary(),
    fetchAbExperiments(),
    fetchContentReviewQueue(),
    fetchRfmData(),
    fetchPredictiveInsights(),
  ]);

  // KPI 요약
  const totalAttributionRevenue = attribution.reduce((s, r) => s + r.revenue, 0);
  const totalAttributionCost = attribution.reduce((s, r) => s + r.cost, 0);
  const totalConversions = attribution.reduce((s, r) => s + r.conversions, 0);
  const totalSessions = attribution.reduce((s, r) => s + r.sessions, 0);
  const avgRoi = totalAttributionCost > 0 ? ((totalAttributionRevenue - totalAttributionCost) / totalAttributionCost) : 0;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div>
        <h1 className="text-admin-lg font-semibold text-admin-text-2">마케팅 인텔리전스</h1>
        <p className="text-[11px] text-admin-muted mt-0.5">어트리뷰션 · A/B 테스트 · 검수 · RFM · 예측 인사이트 통합 대시보드</p>
      </div>

      {/* ── 엔진 실행 섹션 ────────────────────────────── */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-blue-600" />
          <h2 className="text-admin-sm font-semibold text-blue-900">마케팅 엔진 실행</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {ENGINE_BUTTONS.map((btn) => {
            const Icon = btn.icon;
            const colorMap: Record<string, string> = {
              blue: 'bg-blue-600 hover:bg-blue-700 text-white',
              purple: 'bg-purple-600 hover:bg-purple-700 text-white',
              emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white',
              orange: 'bg-orange-500 hover:bg-orange-600 text-white',
              indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
            };
            return (
              <form key={btn.endpoint} action={btn.endpoint} method="POST" className="inline">
                <button
                  type="submit"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-admin-xs font-medium transition ${colorMap[btn.color]}`}
                >
                  <Play className="w-3 h-3" />
                  {Icon && <Icon className="w-3 h-3" />}
                  {btn.label}
                </button>
              </form>
            );
          })}
        </div>
        <p className="text-[10px] text-blue-500 mt-2">각 엔진은 서버에서 비동기로 실행됩니다. 결과는 새로고침 후 확인하세요.</p>
      </div>

      {/* ── Tab 네비게이션 ─────────────────────────────── */}
      <div className="border-b border-admin-border">
        <nav className="flex gap-0 -mb-px overflow-x-auto">
          {TAB_ITEMS.map((tab) => {
            const Icon = tab.icon;
            return (
              <a
                key={tab.key}
                href={`#tab-${tab.key}`}
                className="flex items-center gap-1.5 px-4 py-2.5 text-admin-xs font-medium border-b-2 border-transparent hover:border-blue-400 hover:text-blue-700 text-admin-muted whitespace-nowrap transition"
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </a>
            );
          })}
        </nav>
      </div>

      {/* ── 탭: 개요 ──────────────────────────────────── */}
      <section id="tab-overview" className="scroll-mt-16 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="총 어트리뷰션 매출"
            value={fmtKRW(totalAttributionRevenue)}
            sub={`${fmtNum(totalConversions)}건 전환`}
            icon={DollarSign}
            color="blue"
          />
          <KpiCard
            label="총 광고비"
            value={fmtKRW(totalAttributionCost)}
            sub={`ROAS ${avgRoi > 0 ? '+' : ''}${(avgRoi * 100).toFixed(0)}%`}
            icon={Activity}
            color="rose"
          />
          <KpiCard
            label="진행 중 A/B 테스트"
            value={String(experiments.length)}
            sub={experiments.filter((e) => e.winner).length > 0 ? `${experiments.filter((e) => e.winner).length}개 승자 결정됨` : '승자 미정'}
            icon={GitBranch}
            color="purple"
          />
          <KpiCard
            label="검수 대기 콘텐츠"
            value={String(reviewQueue.length)}
            sub={reviewQueue.length > 0 ? '승인 필요' : '모두 처리됨'}
            icon={CheckSquare}
            color={reviewQueue.length > 0 ? 'orange' : 'emerald'}
          />
          <KpiCard
            label="RFM 세그먼트 총 고객"
            value={fmtNum(rfmData.total)}
            sub={`${rfmData.segments.length}개 세그먼트`}
            icon={Users}
            color="cyan"
          />
          <KpiCard
            label="예측 인사이트"
            value={String(insights.length)}
            sub={insights.filter((i) => i.priority <= 3).length > 0 ? `${insights.filter((i) => i.priority <= 3).length}개 긴급` : '모든 인사이트 처리됨'}
            icon={TrendingUp}
            color={insights.filter((i) => i.priority <= 3).length > 0 ? 'amber' : 'emerald'}
          />
        </div>
      </section>

      {/* ── 탭: 어트리뷰션 ────────────────────────────── */}
      <section id="tab-attribution" className="scroll-mt-16 space-y-3">
        <h2 className="text-admin-base font-semibold text-admin-text-2">채널별 어트리뷰션 요약</h2>
        {attribution.length === 0 ? (
          <EmptyState message="어트리뷰션 데이터가 없습니다. 엔진을 실행해 주세요." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-admin-xs">
              <thead>
                <tr className="border-b border-admin-border">
                  <th className="text-left py-2 pr-4 font-medium text-admin-muted">채널</th>
                  <th className="text-right py-2 px-3 font-medium text-admin-muted">세션</th>
                  <th className="text-right py-2 px-3 font-medium text-admin-muted">클릭</th>
                  <th className="text-right py-2 px-3 font-medium text-admin-muted">전환</th>
                  <th className="text-right py-2 px-3 font-medium text-admin-muted">매출</th>
                  <th className="text-right py-2 px-3 font-medium text-admin-muted">광고비</th>
                  <th className="text-right py-2 pl-3 font-medium text-admin-muted">ROI</th>
                </tr>
              </thead>
              <tbody>
                {attribution.map((row, i) => (
                  <tr key={i} className="border-b border-admin-border/50 hover:bg-admin-bg transition">
                    <td className="py-2 pr-4 font-medium text-admin-text-2">
                      {CHANNEL_LABEL[row.channel] || row.channel}
                    </td>
                    <td className="text-right py-2 px-3 tabular-nums">{fmtNum(row.sessions)}</td>
                    <td className="text-right py-2 px-3 tabular-nums">{fmtNum(row.clicks)}</td>
                    <td className="text-right py-2 px-3 tabular-nums">{fmtNum(row.conversions)}</td>
                    <td className="text-right py-2 px-3 tabular-nums font-medium">{fmtKRW(row.revenue)}</td>
                    <td className="text-right py-2 px-3 tabular-nums">{fmtKRW(row.cost)}</td>
                    <td className="text-right py-2 pl-3 tabular-nums">
                      <span className={row.roi >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                        {row.roi >= 0 ? '+' : ''}{fmtPct(row.roi)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 탭: A/B 테스트 ────────────────────────────── */}
      <section id="tab-ab_test" className="scroll-mt-16 space-y-3">
        <h2 className="text-admin-base font-semibold text-admin-text-2">진행 중인 A/B 테스트</h2>
        {experiments.length === 0 ? (
          <EmptyState message="현재 진행 중인 A/B 테스트가 없습니다." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {experiments.map((exp) => {
              const aRate = exp.variant_a_views > 0 ? exp.variant_a_conversions / exp.variant_a_views : 0;
              const bRate = exp.variant_b_views > 0 ? exp.variant_b_conversions / exp.variant_b_views : 0;
              const winner = aRate > bRate ? 'A' : 'B';
              const uplift = aRate > 0 && bRate > 0 ? Math.abs(aRate - bRate) / Math.min(aRate, bRate) : 0;
              return (
                <div key={exp.id} className="bg-white rounded-admin-md border border-admin-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-admin-sm font-semibold text-admin-text-2">{exp.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      exp.status === 'running' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {exp.status === 'running' ? '실행 중' : '활성'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-admin-xs">
                    <div className="p-2 bg-admin-bg rounded">
                      <p className="text-admin-muted-2 mb-1">{exp.variant_a_name || 'A안'}</p>
                      <p className="font-semibold tabular-nums">{fmtPct(aRate)}</p>
                      <p className="text-[10px] text-admin-muted-2">{fmtNum(exp.variant_a_views)}회 노출 · {fmtNum(exp.variant_a_conversions)} 전환</p>
                    </div>
                    <div className="p-2 bg-admin-bg rounded">
                      <p className="text-admin-muted-2 mb-1">{exp.variant_b_name || 'B안'}</p>
                      <p className="font-semibold tabular-nums">{fmtPct(bRate)}</p>
                      <p className="text-[10px] text-admin-muted-2">{fmtNum(exp.variant_b_views)}회 노출 · {fmtNum(exp.variant_b_conversions)} 전환</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-admin-muted-2">
                      {exp.winner ? (
                        <span className="text-emerald-600 font-medium">{exp.winner}안 우세</span>
                      ) : (
                        <span>{winner}안 선두 (예상)</span>
                      )}
                    </span>
                    {exp.confidence != null && (
                      <span className="text-admin-muted-2">신뢰도 {fmtPct(exp.confidence)}</span>
                    )}
                  </div>
                  {uplift > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-emerald-600">
                      <ArrowUp className="w-3 h-3" />
                      최대 {(uplift * 100).toFixed(0)}% 개선 효과
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 탭: 콘텐츠 검수 ────────────────────────────── */}
      <section id="tab-content_review" className="scroll-mt-16 space-y-3">
        <h2 className="text-admin-base font-semibold text-admin-text-2">콘텐츠 검수 대기</h2>
        {reviewQueue.length === 0 ? (
          <EmptyState message="검수 대기 중인 콘텐츠가 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-admin-xs">
              <thead>
                <tr className="border-b border-admin-border">
                  <th className="text-left py-2 pr-4 font-medium text-admin-muted">제목</th>
                  <th className="text-left py-2 px-3 font-medium text-admin-muted">채널</th>
                  <th className="text-left py-2 px-3 font-medium text-admin-muted">제출일</th>
                  <th className="text-left py-2 pl-3 font-medium text-admin-muted">상태</th>
                </tr>
              </thead>
              <tbody>
                {reviewQueue.map((item) => (
                  <tr key={item.id} className="border-b border-admin-border/50 hover:bg-admin-bg transition">
                    <td className="py-2 pr-4 font-medium text-admin-text-2">{item.title}</td>
                    <td className="py-2 px-3 text-admin-muted">{CHANNEL_LABEL[item.channel] || item.channel}</td>
                    <td className="py-2 px-3 text-admin-muted tabular-nums">
                      {new Date(item.submitted_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="py-2 pl-3">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                        검수 대기
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 탭: 고객 세그먼트 ──────────────────────────── */}
      <section id="tab-segments" className="scroll-mt-16 space-y-3">
        <h2 className="text-admin-base font-semibold text-admin-text-2">RFM 세그먼트</h2>
        {rfmData.segments.length === 0 ? (
          <EmptyState message="RFM 데이터가 없습니다. 엔진을 실행해 주세요." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {rfmData.segments.map((seg) => {
              const segmentColors: Record<string, string> = {
                최우수: 'border-emerald-300 bg-emerald-50',
                우수: 'border-blue-300 bg-blue-50',
                일반: 'border-amber-300 bg-amber-50',
                휴면: 'border-orange-300 bg-orange-50',
                이탈: 'border-red-300 bg-red-50',
              };
              const defaultColor = 'border-slate-300 bg-slate-50';
              const colorClass = segmentColors[seg.segment] || defaultColor;
              const barColor: Record<string, string> = {
                최우수: 'bg-emerald-500',
                우수: 'bg-blue-500',
                일반: 'bg-amber-500',
                휴면: 'bg-orange-500',
                이탈: 'bg-red-500',
              };
              const barColorClass = barColor[seg.segment] || 'bg-slate-500';
              const maxCount = Math.max(...rfmData.segments.map((s) => s.count));
              return (
                <div key={seg.segment} className={`rounded-admin-md border p-4 ${colorClass}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-admin-sm font-semibold">{seg.segment}</span>
                    <span className="text-[18px] font-bold tabular-nums">{fmtNum(seg.count)}</span>
                  </div>
                  <div className="h-1.5 bg-white/60 rounded-full overflow-hidden mb-3">
                    <div className={`h-full rounded-full transition-all ${barColorClass}`}
                      style={{ width: `${(seg.count / maxCount) * 100}%` }} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <p className="text-admin-muted-2">최근 구매</p>
                      <p className="font-semibold tabular-nums">{seg.avg_recency.toFixed(0)}일</p>
                    </div>
                    <div>
                      <p className="text-admin-muted-2">구매 빈도</p>
                      <p className="font-semibold tabular-nums">{seg.avg_frequency.toFixed(1)}회</p>
                    </div>
                    <div>
                      <p className="text-admin-muted-2">평균 금액</p>
                      <p className="font-semibold tabular-nums">{fmtKRW(seg.avg_monetary)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 탭: 예측 인사이트 ──────────────────────────── */}
      <section id="tab-insights" className="scroll-mt-16 space-y-3">
        <h2 className="text-admin-base font-semibold text-admin-text-2">예측 마케팅 인사이트</h2>
        {insights.length === 0 ? (
          <EmptyState message="예측 인사이트가 없습니다. 엔진을 실행해 주세요." />
        ) : (
          <div className="space-y-2">
            {insights.map((insight) => {
              const priorityColors: Record<number, string> = {
                1: 'border-red-300 bg-red-50',
                2: 'border-orange-300 bg-orange-50',
                3: 'border-amber-300 bg-amber-50',
              };
              const priorityLabel: Record<number, string> = {
                1: 'P1-긴급',
                2: 'P2-중요',
                3: 'P3-관심',
              };
              const colorClass = priorityColors[insight.priority] || 'border-slate-200 bg-white';
              const label = priorityLabel[insight.priority] || `P${insight.priority}`;
              return (
                <div key={insight.id} className={`rounded-admin-md border p-4 ${colorClass}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-admin-sm font-semibold text-admin-text-2 truncate">{insight.title}</h3>
                        <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          insight.priority <= 2 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {label}
                        </span>
                      </div>
                      <p className="text-[11px] text-admin-muted line-clamp-2">{insight.description}</p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-[10px] text-admin-muted-2">예상 효과</p>
                      <p className="text-admin-xs font-semibold text-emerald-600">{insight.expected_impact}</p>
                      {insight.confidence_score > 0 && (
                        <p className="text-[10px] text-admin-muted-2 mt-0.5">
                          신뢰도 {(insight.confidence_score * 100).toFixed(0)}%
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-admin-muted-2">
                    {insight.category} · {new Date(insight.created_at).toLocaleDateString('ko-KR')}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── 서브 컴포넌트 ─────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  color: string;
}

function KpiCard({ label, value, sub, icon: Icon, color }: KpiCardProps) {
  const borderMap: Record<string, string> = {
    blue: 'border-blue-200',
    rose: 'border-rose-200',
    purple: 'border-purple-200',
    orange: 'border-orange-200',
    emerald: 'border-emerald-200',
    cyan: 'border-cyan-200',
    amber: 'border-amber-200',
  };
  const iconBgMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600',
    rose: 'bg-rose-100 text-rose-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    cyan: 'bg-cyan-100 text-cyan-600',
    amber: 'bg-amber-100 text-amber-600',
  };
  return (
    <div className={`bg-white rounded-admin-md border ${borderMap[color] || 'border-admin-border'} p-4`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-admin-muted-2 mb-0.5">{label}</p>
          <p className="text-[22px] font-bold text-admin-text-2 leading-tight tabular-nums">{value}</p>
          <p className="text-[10px] text-admin-muted mt-1">{sub}</p>
        </div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBgMap[color] || 'bg-slate-100 text-slate-500'}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-admin-md border border-admin-border p-8 text-center">
      <AlertTriangle className="w-8 h-8 text-admin-muted-2 mx-auto mb-2" />
      <p className="text-admin-sm text-admin-muted">{message}</p>
    </div>
  );
}
