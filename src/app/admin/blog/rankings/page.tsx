'use client';

/**
 * /admin/blog/rankings — 블로그 SEO 순위 대시보드
 * - 7/14/30일 누적 클릭/노출/평균순위
 * - 미해결 이탈 경보
 * - Top movers (상승/하락)
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, KpiCard } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { ArrowLeft, Search, MousePointerClick, Eye, FileText, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

interface TopRow {
  slug: string;
  clicks: number;
  impressions: number;
  avg_position: number | null;
  query_count: number;
}
interface Mover {
  slug: string;
  query: string;
  first_position: number;
  last_position: number;
  delta: number;
  impressions: number;
  clicks: number;
}
interface Alert {
  id: number;
  slug: string;
  query: string;
  prev_position: number;
  curr_position: number;
  delta: number;
  detected_at: string;
}

const RANK_SOURCES = [
  { id: 'gsc-page', label: 'Google', description: 'Search Console' },
  { id: 'naver_blog', label: 'Naver Blog', description: 'SERP/Advisor' },
  { id: 'naver_web', label: 'Naver Web', description: 'SERP/Advisor' },
  { id: 'all', label: '전체', description: '통합' },
] as const;

export default function BlogRankingsPage() {
  const [days, setDays] = useState(14);
  const [source, setSource] = useState<(typeof RANK_SOURCES)[number]['id']>('gsc-page');
  const [summary, setSummary] = useState<{ totals: any; top: TopRow[]; source?: string; source_counts?: Record<string, number> } | null>(null);
  const [movers, setMovers] = useState<{ ups: Mover[]; downs: Mover[] } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [running, setRunning] = useState(false);

  const fetchAll = useCallback(async () => {
    const [sumRes, movRes, alertRes] = await Promise.all([
      fetch(`/api/admin/rank-dashboard?days=${days}&source=${source}`).then(r => r.json()),
      fetch(`/api/admin/rank-dashboard?view=top_movers&days=${days}&source=${source}`).then(r => r.json()),
      fetch(`/api/admin/rank-dashboard?view=alerts`).then(r => r.json()),
    ]);
    setSummary(sumRes);
    setMovers(movRes);
    setAlerts(alertRes.alerts || []);
  }, [days, source]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const triggerCron = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/admin/cron-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/api/cron/rank-tracking' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      alert('순위 추적 실행 완료\n\n' + JSON.stringify(data, null, 2).slice(0, 500));
      fetchAll();
    } catch (e) {
      alert('실패: ' + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="블로그 순위 대시보드"
        subtitle="GSC 기반 일일 순위 추적 · 5계단 이상 하락 자동 경보"
        actions={
          <>
            <Link href="/admin/blog/queue">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                발행 큐
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={triggerCron} disabled={running}>
              <Search size={14} />
              {running ? '추적중…' : '순위 즉시 추적'}
            </Button>
          </>
        }
      />

      {/* 기간 탭 */}
      <section className="admin-card p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">현재 데이터 범위</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              이 화면은 Google Search Console 기반의 구글 노출, 클릭, 평균 순위입니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">네이버 순위</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              네이버는 별도 서치어드바이저/검색 결과 수집 파이프라인이 필요하며, 아직 GSC 숫자와 섞어 표시하지 않습니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">광고 OS 연결</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              클릭, CTA, 예약, CPA, ROAS는 Ad OS 학습 루프에서 블로그/키워드/상품 단위로 합쳐 판단합니다.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-1 bg-admin-surface-2 rounded-admin-sm p-1 w-fit">
        {RANK_SOURCES.map(item => (
          <button key={item.id}
            onClick={() => setSource(item.id)}
            className={`min-w-24 px-3 py-1.5 text-left rounded-admin-xs transition-colors ${source === item.id ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'}`}>
            <span className="block text-admin-sm font-semibold">{item.label}</span>
            <span className="block text-admin-2xs">{item.description}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-1 bg-admin-surface-2 rounded-admin-sm p-1 w-fit">
        {[7, 14, 30].map(d => (
          <button key={d}
            onClick={() => setDays(d)}
            className={`px-3 h-8 text-admin-sm font-medium rounded-admin-xs transition-colors admin-num ${days === d ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'}`}>
            {d}일
          </button>
        ))}
      </div>

      {/* 누적 요약 */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="총 클릭" value={(summary.totals?.total_clicks || 0).toLocaleString()} icon={MousePointerClick} tone="positive" />
          <KpiCard label="총 노출" value={(summary.totals?.total_impressions || 0).toLocaleString()} icon={Eye} />
          <KpiCard label="추적 중인 글" value={(summary.totals?.tracked_slugs || 0).toLocaleString()} icon={FileText} />
          <KpiCard label="데이터 소스" value={RANK_SOURCES.find(item => item.id === source)?.label || 'Google'} icon={Search} />
        </div>
      )}

      {/* 미해결 경보 */}
      {alerts.length > 0 && (
        <div className="bg-danger-light border border-danger/30 rounded-admin-md p-3">
          <p className="text-admin-xs font-semibold text-danger mb-2 inline-flex items-center gap-1.5">
            <AlertTriangle size={12} />
            순위 하락 경보 (<span className="admin-num">{alerts.length}</span>건)
          </p>
          <table className="w-full text-admin-xs">
            <thead>
              <tr className="border-b border-danger/30">
                <th className="text-left px-2 py-1 text-danger font-semibold">slug</th>
                <th className="text-left px-2 py-1 text-danger font-semibold">검색어</th>
                <th className="text-right px-2 py-1 text-danger font-semibold">7일 평균 → 어제</th>
                <th className="text-right px-2 py-1 text-danger font-semibold">하락폭</th>
              </tr>
            </thead>
            <tbody>
              {alerts.slice(0, 10).map(a => (
                <tr key={a.id} className="border-b border-danger/15">
                  <td className="px-2 py-1.5">
                    <Link href={`/blog/${a.slug}`} className="text-brand hover:text-brand-dark hover:underline font-mono text-admin-2xs">{a.slug.slice(0, 30)}</Link>
                  </td>
                  <td className="px-2 py-1.5 text-admin-text-2">{a.query}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-admin-muted admin-num">{a.prev_position} → <b className="text-danger">{a.curr_position}</b></td>
                  <td className="px-2 py-1.5 text-right text-danger font-semibold admin-num">+{a.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top performers */}
      {summary?.top && summary.top.length > 0 && (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <div className="px-3 py-2.5 border-b border-admin-border">
            <p className="text-admin-xs font-semibold text-admin-text-2">Top 30 — <span className="admin-num">{days}</span>일 누적 클릭 순</p>
          </div>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>slug</th>
                <th className="text-right">클릭</th>
                <th className="text-right">노출</th>
                <th className="text-right">CTR</th>
                <th className="text-right">평균순위</th>
                <th className="text-right">검색어수</th>
              </tr>
            </thead>
            <tbody>
              {summary.top.map((t: TopRow) => (
                <tr key={t.slug}>
                  <td>
                    <Link href={`/blog/${t.slug}`} className="text-brand hover:text-brand-dark hover:underline font-mono text-admin-xs">{t.slug.slice(0, 40)}</Link>
                  </td>
                  <td className="text-right font-mono admin-num">{t.clicks.toLocaleString()}</td>
                  <td className="text-right font-mono text-admin-muted admin-num">{t.impressions.toLocaleString()}</td>
                  <td className="text-right font-mono admin-num">
                    {t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(1) + '%' : '—'}
                  </td>
                  <td className="text-right font-mono admin-num">{t.avg_position ?? '—'}</td>
                  <td className="text-right text-admin-muted admin-num">{t.query_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Movers */}
      {movers && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-status-successBg border border-success/20 rounded-admin-md p-3">
            <p className="text-admin-xs font-semibold text-status-successFg mb-2 inline-flex items-center gap-1.5">
              <TrendingUp size={12} />
              순위 상승 TOP 20
            </p>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {movers.ups.length === 0 && <p className="text-admin-xs text-status-successFg opacity-70">데이터 부족</p>}
              {movers.ups.map((m, i) => (
                <div key={i} className="flex justify-between text-admin-2xs py-1 border-b border-success/15">
                  <span className="text-admin-text truncate flex-1">{m.query}</span>
                  <span className="font-mono text-status-successFg font-semibold admin-num">{m.first_position} → {m.last_position}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-danger-light border border-danger/20 rounded-admin-md p-3">
            <p className="text-admin-xs font-semibold text-danger mb-2 inline-flex items-center gap-1.5">
              <TrendingDown size={12} />
              순위 하락 TOP 20
            </p>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {movers.downs.length === 0 && <p className="text-admin-xs text-danger opacity-70">데이터 부족</p>}
              {movers.downs.map((m, i) => (
                <div key={i} className="flex justify-between text-admin-2xs py-1 border-b border-danger/15">
                  <span className="text-admin-text truncate flex-1">{m.query}</span>
                  <span className="font-mono text-danger font-semibold admin-num">{m.first_position} → {m.last_position}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
