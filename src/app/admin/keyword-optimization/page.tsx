'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

interface OptimizationLog {
  id: string;
  ran_at: string;
  platform: string;
  status: 'success' | 'partial' | 'error';
  keywords_analyzed: number;
  bids_adjusted: number;
  negative_keywords_added: number;
  suggestions_added: number;
  total_spend_before: number;
  total_spend_after: number;
  errors: string[] | null;
  duration_ms: number;
  created_at: string;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '-';
  return `₩${n.toLocaleString('ko-KR')}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}초`;
}

export default function KeywordOptimizationPage() {
  const [logs, setLogs] = useState<OptimizationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<string>('all');
  const [limit, setLimit] = useState(50);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = '/api/admin/optimization/logs' + (platform !== 'all' ? `?platform=${platform}&limit=${limit}` : `?limit=${limit}`);
        // 우선 Supabase 직접 조회 (fallback)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          let query = supabase
            .from('optimization_log')
            .select('*')
            .order('ran_at', { ascending: false })
            .limit(limit);
          if (platform !== 'all') {
            query = query.eq('platform', platform);
          }
          const { data, error: dbError } = await query;
          if (dbError) {
            setError(dbError.message);
          } else {
            setLogs((data ?? []) as OptimizationLog[]);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [platform, limit]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-admin-text">최적화 로그</h1>
        <div className="flex gap-2 items-center">
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            className="px-3 py-1.5 rounded-admin-md border border-admin-border bg-admin-surface text-admin-sm text-admin-text"
          >
            <option value="all">전체 플랫폼</option>
            <option value="naver">네이버</option>
            <option value="google">구글</option>
            <option value="meta">메타</option>
          </select>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="px-3 py-1.5 rounded-admin-md border border-admin-border bg-admin-surface text-admin-sm text-admin-text"
          >
            <option value={20}>20개</option>
            <option value={50}>50개</option>
            <option value={100}>100개</option>
          </select>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-admin-sm">
          {error}
        </div>
      )}

      {/* 로딩 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 bg-admin-surface-2 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-admin-text-2">
          <p>아직 최적화 로그가 없습니다.</p>
          <p className="text-admin-sm mt-1">Optimization Cron이 실행된 후 확인할 수 있습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map(log => (
            <div
              key={log.id}
              className="bg-admin-surface rounded-xl border border-admin-border p-4 transition-colors hover:border-admin-border-hover"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      log.status === 'success' ? 'bg-success/10 text-success' :
                      log.status === 'partial' ? 'bg-warning/10 text-warning' :
                      'bg-danger/10 text-danger'
                    }`}>
                      {log.status === 'success' ? '성공' : log.status === 'partial' ? '부분 성공' : '오류'}
                    </span>
                    <span className="text-admin-xs text-admin-text-2">
                      {new Date(log.ran_at).toLocaleString('ko-KR')}
                    </span>
                    <span className="text-admin-xs text-admin-text-2">·</span>
                    <span className="text-admin-xs font-medium text-admin-text">{log.platform}</span>
                    <span className="text-admin-xs text-admin-text-2">·</span>
                    <span className="text-admin-xs text-admin-text-2">{fmtDuration(log.duration_ms)}</span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-admin-sm">
                    <span className="text-admin-text-2">
                      분석: <strong className="text-admin-text">{log.keywords_analyzed}</strong>개
                    </span>
                    <span className="text-admin-text-2">
                      입찰 조정: <strong className="text-admin-text">{log.bids_adjusted}</strong>개
                    </span>
                    <span className="text-admin-text-2">
                      제외 키워드: <strong className="text-admin-text">{log.negative_keywords_added}</strong>개
                    </span>
                    <span className="text-admin-text-2">
                      제안: <strong className="text-admin-text">{log.suggestions_added}</strong>개
                    </span>
                    <span className="text-admin-text-2">
                      지출: {fmtMoney(log.total_spend_before)} → {fmtMoney(log.total_spend_after)}
                    </span>
                  </div>
                </div>
              </div>

              {log.errors && log.errors.length > 0 && (
                <div className="mt-2 bg-danger/5 rounded-lg p-2">
                  {log.errors.map((err, i) => (
                    <p key={i} className="text-admin-xs text-danger">{err}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
