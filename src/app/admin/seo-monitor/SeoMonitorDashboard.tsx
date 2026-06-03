'use client';

import { useEffect, useState } from 'react';

interface DailySnapshot {
  date: string;
  total_clicks: number;
  total_impressions: number;
  avg_ctr: number;
  avg_position: number;
  top_keywords: { query: string; clicks: number; position: number }[];
}

interface SeoAlert {
  id: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  metrics: Record<string, number>;
  created_at: string;
}

interface SeoMonitorResponse {
  snapshots?: DailySnapshot[];
  alerts?: SeoAlert[];
  error?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-700',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  critical: 'bg-red-50 border-red-200 text-red-700',
};

const TYPE_LABELS: Record<string, string> = {
  traffic_drop: '트래픽 변동',
  ranking_drop: '순위 변동',
  algorithm_update: '알고리즘 업데이트',
};

function normalizeSnapshots(snapshots: DailySnapshot[] | undefined): DailySnapshot[] {
  return (snapshots ?? []).map((snapshot) => ({
    ...snapshot,
    total_clicks: Number.isFinite(snapshot.total_clicks) ? snapshot.total_clicks : 0,
    total_impressions: Number.isFinite(snapshot.total_impressions) ? snapshot.total_impressions : 0,
    avg_ctr: Number.isFinite(snapshot.avg_ctr) ? snapshot.avg_ctr : 0,
    avg_position: Number.isFinite(snapshot.avg_position) ? snapshot.avg_position : 0,
    top_keywords: Array.isArray(snapshot.top_keywords) ? snapshot.top_keywords : [],
  }));
}

export default function SeoMonitorDashboard() {
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([]);
  const [alerts, setAlerts] = useState<SeoAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/admin/seo-monitor', {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as SeoMonitorResponse | null;
        if (controller.signal.aborted) {
          return;
        }
        if (!response.ok) {
          setError(payload?.error ?? '데이터 로딩 실패');
          setSnapshots([]);
          setAlerts([]);
          return;
        }
        setSnapshots(normalizeSnapshots(payload?.snapshots));
        setAlerts(payload?.alerts ?? []);
      } catch (e) {
        if (controller.signal.aborted) {
          return;
        }
        setError(e instanceof Error ? e.message : '데이터 로딩 실패');
        setSnapshots([]);
        setAlerts([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-400">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
        로딩 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 미발견 알림 표시 */}
      {!loading && snapshots.length === 0 && alerts.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-1">아직 데이터가 없습니다</p>
          <p className="text-sm">GSC API가 설정되면 크론이 실행된 후 데이터가 표시됩니다.</p>
        </div>
      )}

      {/* 알림 목록 */}
      {alerts.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">최근 알림</h2>
          <div className="space-y-2">
            {alerts.slice(0, 10).map((alert) => (
              <div
                key={alert.id}
                className={`border rounded-lg p-3 text-sm ${SEVERITY_STYLES[alert.severity] || 'bg-gray-50 border-gray-200'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{alert.title}</span>
                  <span className="text-xs opacity-60">{TYPE_LABELS[alert.type] || alert.type}</span>
                  <span className="text-xs opacity-60 ml-auto">
                    {new Date(alert.created_at).toLocaleDateString('ko-KR')}
                  </span>
                </div>
                <p className="opacity-80">{alert.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 트래픽 트렌드 차트 (숫자 표) */}
      {snapshots.length >= 2 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">일일 트래픽 트렌드</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">날짜</th>
                  <th className="pb-2 pr-4 text-right">클릭</th>
                  <th className="pb-2 pr-4 text-right">노출</th>
                  <th className="pb-2 pr-4 text-right">CTR</th>
                  <th className="pb-2 pr-4 text-right">평균 포지션</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s, index) => {
                  const prev = snapshots[index + 1];
                  const clickDiff = prev && prev.total_clicks > 0
                    ? ((s.total_clicks - prev.total_clicks) / prev.total_clicks * 100).toFixed(1)
                    : null;
                  return (
                    <tr key={s.date} className="border-b border-gray-50">
                      <td className="py-2 pr-4 font-medium">{s.date}</td>
                      <td className="py-2 pr-4 text-right">
                        {s.total_clicks.toLocaleString()}
                        {clickDiff && (
                          <span className={`ml-1 text-xs ${Number(clickDiff) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {Number(clickDiff) >= 0 ? '+' : ''}{clickDiff}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">{s.total_impressions.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right">{(s.avg_ctr * 100).toFixed(1)}%</td>
                      <td className="py-2 pr-4 text-right font-mono">{s.avg_position.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top 키워드 (가장 최근 스냅샷) */}
      {(snapshots[0]?.top_keywords?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Top 20 키워드 ({snapshots[0].date})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">키워드</th>
                  <th className="pb-2 pr-4 text-right">클릭</th>
                  <th className="pb-2 pr-4 text-right">포지션</th>
                </tr>
              </thead>
              <tbody>
                {snapshots[0].top_keywords.map((kw, i) => (
                  <tr key={kw.query} className="border-b border-gray-50">
                    <td className="py-2 pr-4 text-gray-400 w-8">{i + 1}</td>
                    <td className="py-2 pr-4">{kw.query}</td>
                    <td className="py-2 pr-4 text-right">{kw.clicks}</td>
                    <td className="py-2 pr-4 text-right font-mono">{kw.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
