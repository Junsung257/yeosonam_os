'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface CronHealthPayload {
  health: Record<string, unknown>[];
  recent_failures_24h: Array<{
    cron_name: string;
    status: string;
    started_at: string;
    elapsed_ms: number | null;
    error_count: number | null;
    error_messages: string[] | null;
    alerted?: boolean;
  }>;
  success_rate_7d_percent: Record<string, number>;
  generated_at: string;
}

interface ConsoleLinksPayload {
  supabase_dashboard: string | null;
  vercel_project: string;
  vercel_cron: string;
  vercel_environment: string;
  vercel_cron_docs: string;
  hints: { vercel_env: string; supabase_env: string };
  meta?: { link_source?: string };
}

export default function AdminOpsCronPage() {
  const [data, setData] = useState<CronHealthPayload | null>(null);
  const [links, setLinks] = useState<ConsoleLinksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, linksRes] = await Promise.all([
        fetch('/api/ops/cron-health'),
        fetch('/api/ops/console-links'),
      ]);

      const linksJson = (await linksRes.json()) as ConsoleLinksPayload & { error?: string };
      if (linksRes.ok) setLinks(linksJson);
      else setLinks(null);

      const json = await healthRes.json();
      if (!healthRes.ok) {
        setData(null);
        setError(json.error || healthRes.statusText);
      } else {
        setData(json as CronHealthPayload);
      }
    } catch (e) {
      setData(null);
      setLinks(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">크론·백그라운드 작업</h1>
          <p className="text-admin-xs text-slate-500 mt-0.5">
            Vercel Cron 로그 대신 DB에 쌓인 실행 기록을 봅니다. 스케줄 변경·환경 변수는 여전히 Vercel에서 합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/blog/system"
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-admin-xs rounded-lg hover:bg-slate-50"
          >
            블로그 시스템
          </Link>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 text-white text-admin-xs rounded-lg hover:bg-slate-900 disabled:opacity-50"
          >
            새로고침
          </button>
        </div>
      </div>

      {links && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 space-y-2">
          <p className="text-admin-xs font-semibold text-slate-800">외부 콘솔 (새 탭)</p>
          <div className="flex flex-wrap gap-2">
            {links.supabase_dashboard ? (
              <a
                href={links.supabase_dashboard}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-2 rounded-lg bg-emerald-600 text-white text-admin-xs font-medium hover:bg-emerald-700"
              >
                Supabase 프로젝트
              </a>
            ) : (
              <span className="inline-flex items-center px-3 py-2 rounded-lg bg-slate-200 text-slate-500 text-admin-xs cursor-not-allowed" title="SUPABASE_URL 형식이 아니면 링크를 만들 수 없습니다">
                Supabase (URL 없음)
              </span>
            )}
            <a
              href={links.vercel_project}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-2 rounded-lg bg-slate-700 text-white text-admin-xs font-medium hover:bg-slate-800"
            >
              Vercel 프로젝트
            </a>
            <a
              href={links.vercel_cron}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-2 rounded-lg bg-black text-white text-admin-xs font-medium hover:bg-slate-900"
            >
              Vercel Cron
            </a>
            <a
              href={links.vercel_environment}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-2 rounded-lg bg-violet-700 text-white text-admin-xs font-medium hover:bg-violet-800"
            >
              Vercel 환경 변수
            </a>
            <a
              href={links.vercel_cron_docs}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-admin-xs font-medium hover:bg-slate-50"
            >
              Cron 문서
            </a>
          </div>
          <p className="text-[10px] text-slate-600 leading-relaxed">{links.hints.vercel_env}</p>
          <p className="text-[10px] text-slate-600 leading-relaxed">{links.hints.supabase_env}</p>
          {links.meta?.link_source && (
            <p className="text-[10px] text-slate-500">
              Vercel 링크 출처: <code className="bg-white/80 px-1 rounded">{links.meta.link_source}</code>
              {' — '}다른 팀/프로젝트면 <code className="bg-white/80 px-1 rounded">VERCEL_OPS_TEAM_SLUG</code>·
              <code className="bg-white/80 px-1 rounded">VERCEL_OPS_PROJECT_SLUG</code> 또는{' '}
              <code className="bg-white/80 px-1 rounded">OPS_VERCEL_DASHBOARD_URL</code>
            </p>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3.5 bg-slate-100 rounded animate-pulse" style={{ width: `${85 - i * 8}%` }} />
          ))}
        </div>
      )}
      {error && (
        <pre className="text-rose-700 text-admin-xs whitespace-pre-wrap bg-rose-50 border border-rose-200 rounded-lg p-3">{error}</pre>
      )}

      {data && (
        <>
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-admin-xs font-semibold text-slate-700">
              cron_health (전체)
            </div>
            <div className="max-h-[420px] overflow-y-auto text-[11px] font-mono">
              {(data.health || []).length === 0 ? (
                <p className="p-4 text-slate-400">데이터 없음 — Supabase에 cron_health 뷰·cron_run_logs 적재 여부 확인</p>
              ) : (
                <table className="w-full">
                  <tbody>
                    {data.health.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 align-top">
                        <td className="px-2 py-1.5 whitespace-pre-wrap break-all">{JSON.stringify(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-admin-xs font-semibold text-slate-700">
              최근 24시간 비성공 실행 (전체 크론)
            </div>
            {(data.recent_failures_24h || []).length === 0 ? (
              <p className="px-3 py-4 text-admin-xs text-slate-400">없음</p>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto text-[11px]">
                {data.recent_failures_24h.map((f, i) => (
                  <li key={i} className="px-3 py-2">
                    <span className="font-semibold text-slate-800">{f.cron_name}</span>{' '}
                    <span className="text-rose-600">{f.status}</span>{' '}
                    <span className="text-slate-400">{new Date(f.started_at).toLocaleString('ko-KR')}</span>
                    {f.alerted ? <span className="ml-2 text-amber-600">Slack 알림</span> : null}
                    {f.error_messages?.length ? (
                      <pre className="mt-1 text-rose-700 whitespace-pre-wrap">{f.error_messages.join('\n')}</pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3">
            <h2 className="text-admin-xs font-semibold text-slate-700 mb-2">7일 성공률 (%)</h2>
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
              {Object.entries(data.success_rate_7d_percent || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, pct]) => (
                  <span key={name} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-[11px]">
                    <span className="font-mono">{name}</span>
                    <span className="font-bold">{pct}%</span>
                  </span>
                ))}
            </div>
          </div>

          <p className="text-[10px] text-slate-400">갱신: {new Date(data.generated_at).toLocaleString('ko-KR')}</p>
        </>
      )}
    </div>
  );
}
