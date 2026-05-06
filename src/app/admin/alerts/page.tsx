/**
 * /admin/alerts — 모든 admin_alerts 통합 히스토리 (v3.6, 2026-04-30)
 *
 * 카테고리별 필터 + severity 필터 + 미해결/해결 분리 + 통계 카드
 * 자비스 list_admin_alerts 도구의 사람 버전
 */
'use client';

import { useEffect, useState, useCallback } from 'react';

interface Alert {
  id: number;
  created_at: string;
  category: string;
  severity: string;
  title: string;
  message: string | null;
  ref_type: string | null;
  ref_id: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  meta: Record<string, unknown> | null;
}

interface Stats {
  total: number;
  unacked: number;
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
}

const CATEGORY_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  policy_winner: { label: '정책 winner', emoji: '🏆', color: 'bg-blue-50 text-blue-800 border-blue-200' },
  feature_change: { label: 'features 변경', emoji: '🔄', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  ltr_ready: { label: 'LTR 학습 준비', emoji: '📊', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  general: { label: '일반', emoji: 'ℹ️', color: 'bg-slate-50 text-slate-800 border-slate-200' },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-700',
  warning: 'bg-amber-100 text-amber-700',
  info: 'bg-slate-100 text-slate-700',
};

export default function AdminAlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAcked, setShowAcked] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/alerts?showAcked=${showAcked}`);
      const d = await res.json();
      setAlerts(d.alerts ?? []);
      setStats(d.stats ?? null);
    } finally { setLoading(false); }
  }, [showAcked]);

  useEffect(() => { load(); }, [load]);

  const ack = async (id: number) => {
    await fetch(`/api/admin/alerts/${id}/ack`, { method: 'POST' });
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a));
  };

  const filtered = alerts.filter(a =>
    (!categoryFilter || a.category === categoryFilter) &&
    (!severityFilter || a.severity === severityFilter),
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">🔔 운영 알림</h1>
        <p className="text-xs text-slate-500 mt-0.5">정책 winner · features 변경 · LTR 시그널 통합. 자비스가 push 알림 자동 누적.</p>
      </div>

      {/* 통계 카드 */}
      {stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="총 알림" value={stats.total} />
          <Kpi label="미확인" value={stats.unacked} tone={stats.unacked > 0 ? 'warning' : 'good'} />
          <Kpi label="이번 주 critical" value={stats.by_severity.critical ?? 0} tone={stats.by_severity.critical ? 'critical' : 'good'} />
          <Kpi label="정책 winner 누적" value={stats.by_category.policy_winner ?? 0} />
        </section>
      )}

      {/* 필터 */}
      <section className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold text-slate-700">카테고리:</label>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="text-xs border border-slate-300 rounded px-2 py-1">
          <option value="">전체</option>
          {Object.keys(CATEGORY_LABELS).map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c].emoji} {CATEGORY_LABELS[c].label}</option>
          ))}
        </select>

        <label className="text-xs font-semibold text-slate-700">심각도:</label>
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="text-xs border border-slate-300 rounded px-2 py-1">
          <option value="">전체</option>
          <option value="critical">critical</option>
          <option value="warning">warning</option>
          <option value="info">info</option>
        </select>

        <label className="text-xs flex items-center gap-1 ml-auto cursor-pointer">
          <input type="checkbox" checked={showAcked} onChange={e => setShowAcked(e.target.checked)} />
          확인된 알림도 표시
        </label>
      </section>

      {/* 알림 목록 */}
      <section className="space-y-2">
        {loading ? (
          <p className="text-center text-sm text-slate-400 py-8">로딩중...</p>
        ) : filtered.length === 0 ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
            <p className="text-emerald-700 font-semibold">🎉 미확인 알림 없음</p>
            <p className="text-xs text-emerald-600 mt-1">모든 시그널이 ✓ 처리됐어요. 새 알림 발생 시 자동 누적.</p>
          </div>
        ) : (
          filtered.map(a => {
            const cat = CATEGORY_LABELS[a.category] ?? CATEGORY_LABELS.general;
            const acked = !!a.acknowledged_at;
            return (
              <div key={a.id} className={`border rounded-xl p-4 ${acked ? 'bg-slate-50/60 border-slate-200 opacity-70' : cat.color}`}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">{cat.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEVERITY_BADGE[a.severity] ?? SEVERITY_BADGE.info}`}>
                        {a.severity}
                      </span>
                      <span className="text-[10px] font-medium text-slate-500">{cat.label}</span>
                      <span className="text-[10px] text-slate-400">{new Date(a.created_at).toLocaleString('ko-KR')}</span>
                      {acked && <span className="text-[10px] text-emerald-600 ml-auto">✓ 확인됨</span>}
                    </div>
                    <p className="text-sm font-bold text-slate-900 leading-snug">{a.title}</p>
                    {a.message && <p className="text-xs text-slate-700 mt-1 leading-relaxed break-keep">{a.message}</p>}
                    {a.ref_type && a.ref_id && (
                      <p className="text-[10px] text-slate-500 mt-1.5 font-mono">
                        {a.ref_type}: <code className="bg-slate-100 px-1 rounded">{a.ref_id}</code>
                      </p>
                    )}
                  </div>
                  {!acked && (
                    <button onClick={() => ack(a.id)}
                      className="text-xs font-semibold text-violet-700 bg-white border border-violet-300 hover:bg-violet-50 px-3 py-1.5 rounded transition flex-shrink-0">
                      ✓ 확인
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warning' | 'critical' }) {
  const cls = tone === 'critical' ? 'bg-rose-50 border-rose-200 text-rose-800'
    : tone === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
    : tone === 'good' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : 'bg-slate-50 border-slate-200 text-slate-800';
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums mt-1">{value}</div>
    </div>
  );
}
