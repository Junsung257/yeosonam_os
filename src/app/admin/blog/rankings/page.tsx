'use client';

/**
 * /admin/blog/rankings — 블로그 SEO 순위 대시보드
 * - 7/14/30일 누적 클릭/노출/평균순위
 * - 미해결 이탈 경보
 * - Top movers (상승/하락)
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

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

export default function BlogRankingsPage() {
  const [days, setDays] = useState(14);
  const [summary, setSummary] = useState<{ totals: any; top: TopRow[] } | null>(null);
  const [movers, setMovers] = useState<{ ups: Mover[]; downs: Mover[] } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [running, setRunning] = useState(false);

  const fetchAll = useCallback(async () => {
    const [sumRes, movRes, alertRes] = await Promise.all([
      fetch(`/api/admin/rank-dashboard?days=${days}`).then(r => r.json()),
      fetch(`/api/admin/rank-dashboard?view=top_movers&days=${days}`).then(r => r.json()),
      fetch(`/api/admin/rank-dashboard?view=alerts`).then(r => r.json()),
    ]);
    setSummary(sumRes);
    setMovers(movRes);
    setAlerts(alertRes.alerts || []);
  }, [days]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const triggerCron = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/cron/rank-tracking');
      const data = await res.json();
      alert('순위 추적 실행 완료\n\n' + JSON.stringify(data, null, 2).slice(0, 500));
      fetchAll();
    } catch (e) {
      alert('실패: ' + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">블로그 순위 대시보드</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">
            GSC 기반 일일 순위 추적 · 5계단 이상 하락 자동 경보
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/blog/queue" className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50">
            ← 발행 큐
          </Link>
          <button
            onClick={triggerCron}
            disabled={running}
            className="px-3 py-2 bg-indigo-600 text-white text-[12px] rounded-lg disabled:opacity-50"
          >
            {running ? '추적중...' : '🔍 순위 즉시 추적'}
          </button>
        </div>
      </div>

      {/* 기간 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[7, 14, 30].map(d => (
          <button key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md ${days === d ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
            {d}일
          </button>
        ))}
      </div>

      {/* 누적 요약 */}
      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-[11px] text-slate-400">총 클릭</p>
            <p className="text-[22px] font-bold text-slate-800">{(summary.totals?.total_clicks || 0).toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-[11px] text-slate-400">총 노출</p>
            <p className="text-[22px] font-bold text-slate-800">{(summary.totals?.total_impressions || 0).toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-[11px] text-slate-400">추적 중인 글</p>
            <p className="text-[22px] font-bold text-slate-800">{summary.totals?.tracked_slugs || 0}</p>
          </div>
        </div>
      )}

      {/* 미해결 경보 */}
      {alerts.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
          <p className="text-[12px] font-semibold text-rose-700 mb-2">🚨 순위 하락 경보 ({alerts.length}건)</p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-rose-200">
                <th className="text-left px-2 py-1 text-rose-600">slug</th>
                <th className="text-left px-2 py-1 text-rose-600">검색어</th>
                <th className="text-right px-2 py-1 text-rose-600">7일 평균 → 어제</th>
                <th className="text-right px-2 py-1 text-rose-600">하락폭</th>
              </tr>
            </thead>
            <tbody>
              {alerts.slice(0, 10).map(a => (
                <tr key={a.id} className="border-b border-rose-100">
                  <td className="px-2 py-1.5">
                    <Link href={`/blog/${a.slug}`} className="text-blue-600 hover:underline">{a.slug.slice(0, 30)}</Link>
                  </td>
                  <td className="px-2 py-1.5 text-slate-700">{a.query}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-600">{a.prev_position} → <b className="text-rose-700">{a.curr_position}</b></td>
                  <td className="px-2 py-1.5 text-right text-rose-700 font-semibold">+{a.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top performers */}
      {summary?.top && summary.top.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <p className="text-[12px] font-semibold text-slate-700">Top 30 — {days}일 누적 클릭 순</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 text-[11px] text-slate-500">slug</th>
                <th className="text-right px-3 py-2 text-[11px] text-slate-500">클릭</th>
                <th className="text-right px-3 py-2 text-[11px] text-slate-500">노출</th>
                <th className="text-right px-3 py-2 text-[11px] text-slate-500">CTR</th>
                <th className="text-right px-3 py-2 text-[11px] text-slate-500">평균순위</th>
                <th className="text-right px-3 py-2 text-[11px] text-slate-500">검색어수</th>
              </tr>
            </thead>
            <tbody>
              {summary.top.map((t: TopRow) => (
                <tr key={t.slug} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-[11px]">
                    <Link href={`/blog/${t.slug}`} className="text-blue-600 hover:underline">{t.slug.slice(0, 40)}</Link>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right font-mono">{t.clicks.toLocaleString()}</td>
                  <td className="px-3 py-2 text-[11px] text-right font-mono text-slate-500">{t.impressions.toLocaleString()}</td>
                  <td className="px-3 py-2 text-[11px] text-right font-mono">
                    {t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(1) + '%' : '-'}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right font-mono">{t.avg_position ?? '-'}</td>
                  <td className="px-3 py-2 text-[11px] text-right text-slate-500">{t.query_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Movers */}
      {movers && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="text-[12px] font-semibold text-emerald-700 mb-2">📈 순위 상승 TOP 20</p>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {movers.ups.length === 0 && <p className="text-[11px] text-emerald-600">데이터 부족</p>}
              {movers.ups.map((m, i) => (
                <div key={i} className="flex justify-between text-[10px] py-1 border-b border-emerald-100">
                  <span className="text-slate-700 truncate flex-1">{m.query}</span>
                  <span className="font-mono text-emerald-700 font-semibold">{m.first_position} → {m.last_position}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-[12px] font-semibold text-rose-700 mb-2">📉 순위 하락 TOP 20</p>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {movers.downs.length === 0 && <p className="text-[11px] text-rose-600">데이터 부족</p>}
              {movers.downs.map((m, i) => (
                <div key={i} className="flex justify-between text-[10px] py-1 border-b border-rose-100">
                  <span className="text-slate-700 truncate flex-1">{m.query}</span>
                  <span className="font-mono text-rose-700 font-semibold">{m.first_position} → {m.last_position}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
