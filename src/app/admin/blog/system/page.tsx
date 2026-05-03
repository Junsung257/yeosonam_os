'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type CronHealthRow = Record<string, unknown>;

interface BlogSystemPayload {
  blog_cron_health: CronHealthRow[];
  blog_failures_24h: Array<{
    cron_name: string;
    status: string;
    started_at: string;
    elapsed_ms: number | null;
    error_count: number | null;
    error_messages: string[] | null;
  }>;
  blog_success_rate_7d_percent: Record<string, number>;
  blog_queue_counts: Record<string, number>;
  indexing_recent: Array<{
    url: string;
    google_status: string;
    google_error: string | null;
    indexnow_status: string;
    indexnow_error: string | null;
    reported_at: string;
  }>;
  hints: { cron_secret_configured: boolean; base_url_for_cron_fetch: string | null };
  generated_at: string;
}

export default function BlogSystemPage() {
  const [data, setData] = useState<BlogSystemPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  /** 수동 실행(발행자 등) 응답 — 새로고침 전까지 유지 */
  const [actionLog, setActionLog] = useState<string | null>(null);
  /** 대시보드 API 로드 실패 메시지 */
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/ops/blog-system');
      const json = await res.json();
      if (!res.ok) {
        setData(null);
        setLoadError(`API 오류: ${json.error || res.statusText}`);
      } else {
        setData(json as BlogSystemPayload);
      }
    } catch (e) {
      setData(null);
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const trigger = async (action: string) => {
    setRunning(action);
    try {
      const res = await fetch('/api/blog/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      setActionLog(JSON.stringify(json, null, 2).slice(0, 4000));
      await load();
    } catch (e) {
      setActionLog('실패: ' + (e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">블로그 시스템 · 크론</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Vercel 대신 여기서 발행 파이프라인 상태를 봅니다. 스케줄 시각은 배포의{' '}
            <code className="text-[11px] bg-slate-100 px-1 rounded">vercel.json</code> 과 동일합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/ops"
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50"
          >
            전체 크론
          </Link>
          <Link
            href="/admin/blog/queue"
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50"
          >
            자동 발행 큐
          </Link>
          <Link href="/admin/blog" className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50">
            ← 블로그 목록
          </Link>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 text-white text-[12px] rounded-lg hover:bg-slate-900 disabled:opacity-50"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* 환경 힌트 */}
      {data && (
        <div
          className={`rounded-lg border px-3 py-2 text-[12px] ${
            data.hints.cron_secret_configured
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          CRON_SECRET: {data.hints.cron_secret_configured ? '설정됨 (수동 발행·브리지에 필요)' : '없음 — 프로덕션 발행자가 401 날 수 있음'}
          {data.hints.base_url_for_cron_fetch && (
            <span className="block mt-1 text-[11px] opacity-90">내부 호출 BASE: {data.hints.base_url_for_cron_fetch}</span>
          )}
        </div>
      )}

      {/* 수동 실행 */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-[13px] font-semibold text-slate-800 mb-2">수동 실행 (큐 페이지와 동일 API)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              ['run_scheduler', '🗓️ 스케줄러'],
              ['run_trend_miner', '🔥 트렌드'],
              ['run_publisher', '✍️ 발행자'],
              ['run_lifecycle', '🗄️ 라이프사이클'],
            ] as const
          ).map(([action, label]) => (
            <button
              key={action}
              type="button"
              disabled={running !== null}
              onClick={() => trigger(action)}
              className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[12px] hover:bg-slate-100 disabled:opacity-50"
            >
              {running === action ? '…' : label}
            </button>
          ))}
        </div>
        {actionLog && (
          <pre className="mt-3 p-3 bg-slate-900 text-emerald-100 text-[11px] rounded-lg overflow-x-auto max-h-64 whitespace-pre-wrap">
            {actionLog}
          </pre>
        )}
      </div>

      {loading && !data && <p className="text-slate-400 text-[13px]">불러오는 중…</p>}

      {loadError && !loading && (
        <pre className="text-rose-700 text-[12px] whitespace-pre-wrap bg-rose-50 border border-rose-200 rounded-lg p-3">{loadError}</pre>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(data.blog_queue_counts).map(([k, v]) => (
              <div key={k} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-[10px] text-slate-500 uppercase">{k}</p>
                <p className="text-[20px] font-bold text-slate-800">{v}</p>
              </div>
            ))}
            {Object.keys(data.blog_queue_counts).length === 0 && (
              <p className="text-[12px] text-slate-400 col-span-full">큐 집계 없음</p>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[12px] font-semibold text-slate-700">
              블로그 관련 크론 요약 (cron_health)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <tbody>
                  {data.blog_cron_health.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-slate-400">뷰가 비었거나 아직 기록 없음</td>
                    </tr>
                  ) : (
                    data.blog_cron_health.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 align-top">
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-pre-wrap">
                          {JSON.stringify(row, null, 0)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[12px] font-semibold text-slate-700">
              최근 24시간 블로그 크론 비성공 로그
            </div>
            {data.blog_failures_24h.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-slate-400">없음</p>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {data.blog_failures_24h.map((f, i) => (
                  <li key={i} className="px-3 py-2 text-[11px]">
                    <span className="font-semibold text-slate-800">{f.cron_name}</span>{' '}
                    <span className="text-rose-600">{f.status}</span>{' '}
                    <span className="text-slate-400">{new Date(f.started_at).toLocaleString('ko-KR')}</span>
                    {f.error_messages?.length ? (
                      <pre className="mt-1 text-rose-700 whitespace-pre-wrap">{f.error_messages.join('\n')}</pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <h3 className="text-[12px] font-semibold text-slate-700 mb-2">7일 성공률 (블로그 크론만)</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.blog_success_rate_7d_percent)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, pct]) => (
                  <span key={name} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-[11px]">
                    <span className="font-mono">{name}</span>
                    <span className="font-bold">{pct}%</span>
                  </span>
                ))}
              {Object.keys(data.blog_success_rate_7d_percent).length === 0 && (
                <span className="text-[11px] text-slate-400">7일간 로그 없음</span>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[12px] font-semibold text-slate-700">
              최근 색인 알림 (notifyIndexing)
            </div>
            {data.indexing_recent.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-slate-400">기록 없음</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-[11px] max-h-64 overflow-y-auto">
                {data.indexing_recent.map((r, i) => (
                  <li key={i} className="px-3 py-2">
                    <div className="truncate text-blue-700" title={r.url}>
                      {r.url}
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      Google: {r.google_status}
                      {r.google_error ? ` (${r.google_error})` : ''} · IndexNow: {r.indexnow_status}
                      {r.indexnow_error ? ` (${r.indexnow_error})` : ''} ·{' '}
                      {new Date(r.reported_at).toLocaleString('ko-KR')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[10px] text-slate-400">갱신: {new Date(data.generated_at).toLocaleString('ko-KR')}</p>
        </>
      )}
    </div>
  );
}
