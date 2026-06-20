'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Eye, FileText, MousePointerClick, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { KpiCard, PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';

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

interface VisibilitySummary {
  total: number;
  google_indexed: number;
  google_visible: number;
  naver_index_requested: number;
  naver_visible: number;
}

const RANK_SOURCES = [
  { id: 'gsc-page', label: '구글', description: '서치콘솔' },
  { id: 'naver_blog', label: '네이버 블로그', description: '검색 결과/어드바이저' },
  { id: 'naver_web', label: '네이버 웹문서', description: '검색 결과/어드바이저' },
  { id: 'all', label: '전체', description: '통합' },
] as const;

export default function BlogRankingsPage() {
  const [days, setDays] = useState(14);
  const [source, setSource] = useState<(typeof RANK_SOURCES)[number]['id']>('gsc-page');
  const [summary, setSummary] = useState<{ totals: any; top: TopRow[]; source?: string; source_counts?: Record<string, number> } | null>(null);
  const [visibilitySummary, setVisibilitySummary] = useState<VisibilitySummary | null>(null);
  const [movers, setMovers] = useState<{ ups: Mover[]; downs: Mover[] } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const fetchAll = useCallback(async () => {
    const [sumRes, movRes, alertRes, visibilityRes] = await Promise.all([
      fetch(`/api/admin/rank-dashboard?days=${days}&source=${source}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/admin/rank-dashboard?view=top_movers&days=${days}&source=${source}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/admin/rank-dashboard?view=alerts', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/admin/blog/visibility?limit=120', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
    ]);
    setSummary(sumRes);
    setMovers(movRes);
    setAlerts(alertRes.alerts || []);
    setVisibilitySummary(visibilityRes?.summary || null);
  }, [days, source]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function triggerCron() {
    setRunning(true);
    try {
      const res = await fetch('/api/admin/cron-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/api/cron/rank-tracking' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchAll();
      setNotice({ tone: 'success', message: '순위 추적이 완료되었습니다.' });
    } catch (error) {
      setNotice({ tone: 'error', message: `실패: ${(error as Error).message}` });
    } finally {
      setRunning(false);
    }
  }

  const currentSource = RANK_SOURCES.find((item) => item.id === source);

  return (
    <div className="space-y-5">
      <PageHeader
        title="블로그 순위/노출 대시보드"
        subtitle="Google과 Naver의 색인, 실제 노출, 키워드 순위를 분리해서 확인합니다."
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
              {running ? '추적 중' : '순위 즉시 추적'}
            </Button>
          </>
        }
      />

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

      <section className="admin-card p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">색인과 노출은 다릅니다</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              구글 서치콘솔의 색인 상태는 검색 결과 노출을 보장하지 않습니다. 실제 노출은 URL 검색, 서치콘솔 성과, 검색 결과 순위 추적으로 따로 확인합니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">네이버는 별도 판단</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              네이버 수집 알림은 새 URL을 빠르게 알려주는 기능입니다. 색인 보장이 아니므로 요청됨, 검증 불가, 검색 노출 확인을 분리합니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">광고 운영 연결</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              순위, 클릭, 상담 버튼, 예약, 전환 비용, 광고 수익률은 블로그/키워드/상품 단위로 묶여 광고 중지와 확장 후보로 넘어갑니다.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="구글 색인" value={(visibilitySummary?.google_indexed || 0).toLocaleString('ko-KR')} icon={FileText} tone="positive" />
        <KpiCard label="구글 노출" value={(visibilitySummary?.google_visible || 0).toLocaleString('ko-KR')} icon={Eye} />
        <KpiCard label="네이버 요청" value={(visibilitySummary?.naver_index_requested || 0).toLocaleString('ko-KR')} icon={Search} />
        <KpiCard label="네이버 노출" value={(visibilitySummary?.naver_visible || 0).toLocaleString('ko-KR')} icon={Eye} />
        <KpiCard label="추적 글" value={(visibilitySummary?.total || summary?.totals?.tracked_slugs || 0).toLocaleString('ko-KR')} icon={FileText} />
      </div>

      <div className="flex flex-wrap gap-1 rounded-admin-sm bg-admin-surface-2 p-1 w-fit">
        {RANK_SOURCES.map((item) => (
          <button
            key={item.id}
            onClick={() => setSource(item.id)}
            className={`min-w-24 rounded-admin-xs px-3 py-1.5 text-left transition-colors ${source === item.id ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'}`}
          >
            <span className="block text-admin-sm font-semibold">{item.label}</span>
            <span className="block text-admin-2xs">{item.description}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-1 rounded-admin-sm bg-admin-surface-2 p-1 w-fit">
        {[7, 14, 30].map((value) => (
          <button
            key={value}
            onClick={() => setDays(value)}
            className={`h-8 rounded-admin-xs px-3 text-admin-sm font-medium transition-colors admin-num ${days === value ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'}`}
          >
            {value}일
          </button>
        ))}
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label={`${currentSource?.label || '통합'} 클릭`} value={(summary.totals?.total_clicks || 0).toLocaleString('ko-KR')} icon={MousePointerClick} tone="positive" />
          <KpiCard label={`${currentSource?.label || '통합'} 노출`} value={(summary.totals?.total_impressions || 0).toLocaleString('ko-KR')} icon={Eye} />
          <KpiCard label="평균 순위" value={summary.totals?.avg_position ? Number(summary.totals.avg_position).toFixed(1) : '-'} icon={Search} />
          <KpiCard label="데이터 소스" value={currentSource?.label || '통합'} icon={FileText} />
        </div>
      )}

      {alerts.length > 0 && (
        <div className="rounded-admin-md border border-danger/30 bg-danger-light p-3">
          <p className="mb-2 inline-flex items-center gap-1.5 text-admin-xs font-semibold text-danger">
            <AlertTriangle size={12} />
            순위 하락 경보 <span className="admin-num">{alerts.length}</span>건
          </p>
          <table className="w-full text-admin-xs">
            <thead>
              <tr className="border-b border-danger/30">
                <th className="px-2 py-1 text-left font-semibold text-danger">slug</th>
                <th className="px-2 py-1 text-left font-semibold text-danger">검색어</th>
                <th className="px-2 py-1 text-right font-semibold text-danger">이전 → 현재</th>
                <th className="px-2 py-1 text-right font-semibold text-danger">하락</th>
              </tr>
            </thead>
            <tbody>
              {alerts.slice(0, 10).map((alert) => (
                <tr key={alert.id} className="border-b border-danger/15">
                  <td className="px-2 py-1.5">
                    <Link href={`/blog/${alert.slug}`} className="font-mono text-admin-2xs text-brand hover:underline">{alert.slug.slice(0, 30)}</Link>
                  </td>
                  <td className="px-2 py-1.5 text-admin-text-2">{alert.query}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-admin-muted admin-num">{alert.prev_position} → <b className="text-danger">{alert.curr_position}</b></td>
                  <td className="px-2 py-1.5 text-right font-semibold text-danger admin-num">+{alert.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary?.top && summary.top.length > 0 && (
        <div className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
          <div className="border-b border-admin-border px-3 py-2.5">
            <p className="text-admin-xs font-semibold text-admin-text-2">Top 30, 최근 <span className="admin-num">{days}</span>일</p>
          </div>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>slug</th>
                <th className="text-right">클릭</th>
                <th className="text-right">노출</th>
                <th className="text-right">CTR</th>
                <th className="text-right">평균순위</th>
                <th className="text-right">검색어 수</th>
              </tr>
            </thead>
            <tbody>
              {summary.top.map((row) => (
                <tr key={row.slug}>
                  <td><Link href={`/blog/${row.slug}`} className="font-mono text-admin-xs text-brand hover:underline">{row.slug.slice(0, 44)}</Link></td>
                  <td className="text-right admin-num">{row.clicks.toLocaleString('ko-KR')}</td>
                  <td className="text-right text-admin-muted admin-num">{row.impressions.toLocaleString('ko-KR')}</td>
                  <td className="text-right admin-num">{row.impressions > 0 ? `${((row.clicks / row.impressions) * 100).toFixed(1)}%` : '-'}</td>
                  <td className="text-right admin-num">{row.avg_position ? Number(row.avg_position).toFixed(1) : '-'}</td>
                  <td className="text-right text-admin-muted admin-num">{row.query_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {movers && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-admin-md border border-success/20 bg-status-successBg p-3">
            <p className="mb-2 inline-flex items-center gap-1.5 text-admin-xs font-semibold text-status-successFg">
              <TrendingUp size={12} />
              순위 상승 TOP 20
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {movers.ups.length === 0 && <p className="text-admin-xs text-status-successFg opacity-70">데이터 부족</p>}
              {movers.ups.map((mover, index) => (
                <div key={`${mover.slug}-${mover.query}-${index}`} className="flex justify-between border-b border-success/15 py-1 text-admin-2xs">
                  <span className="flex-1 truncate text-admin-text">{mover.query}</span>
                  <span className="font-mono font-semibold text-status-successFg admin-num">{mover.first_position} → {mover.last_position}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-admin-md border border-danger/20 bg-danger-light p-3">
            <p className="mb-2 inline-flex items-center gap-1.5 text-admin-xs font-semibold text-danger">
              <TrendingDown size={12} />
              순위 하락 TOP 20
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {movers.downs.length === 0 && <p className="text-admin-xs text-danger opacity-70">데이터 부족</p>}
              {movers.downs.map((mover, index) => (
                <div key={`${mover.slug}-${mover.query}-${index}`} className="flex justify-between border-b border-danger/15 py-1 text-admin-2xs">
                  <span className="flex-1 truncate text-admin-text">{mover.query}</span>
                  <span className="font-mono font-semibold text-danger admin-num">{mover.first_position} → {mover.last_position}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
