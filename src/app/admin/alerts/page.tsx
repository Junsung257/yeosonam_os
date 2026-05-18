/**
 * /admin/alerts — 모든 admin_alerts 통합 히스토리 (v3.6, 2026-04-30)
 *
 * 카테고리별 필터 + severity 필터 + 미해결/해결 분리 + 통계 카드
 * 자비스 list_admin_alerts 도구의 사람 버전
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader, KpiCard } from '@/components/admin/patterns';
import { Bell, AlertTriangle, CheckCircle2, Trophy } from 'lucide-react';
import { fmtDateTime } from '@/lib/admin-utils';

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
  // 2026-05-19 박제: 등록 파이프라인 silent fail 가시화 카테고리 5종
  'catalog-split-fallback': { label: '카탈로그 분리 실패', emoji: '⚠️', color: 'bg-rose-50 text-rose-800 border-rose-200' },
  'register-backfill': { label: '등록 백필 실패', emoji: '🔧', color: 'bg-orange-50 text-orange-800 border-orange-200' },
  'approve-post-processing': { label: '승인 후처리 실패', emoji: '📋', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  'attractions-pexels': { label: 'Pexels 사진 실패', emoji: '🖼️', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  'active-learning-reject': { label: 'Active Learning 실패', emoji: '🧠', color: 'bg-purple-50 text-purple-800 border-purple-200' },
  general: { label: '일반', emoji: 'ℹ️', color: 'bg-admin-bg text-admin-text-2 border-admin-border-mid' },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-700',
  warning: 'bg-amber-100 text-amber-700',
  info: 'bg-admin-surface-2 text-admin-text-2',
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
    <div className="max-w-6xl mx-auto space-y-5">
      <PageHeader
        title="운영 알림"
        subtitle="정책 winner · features 변경 · LTR 시그널 통합. 자비스가 push 알림 자동 누적."
      />

      {/* 통계 카드 */}
      {stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="총 알림" value={stats.total.toLocaleString()} icon={Bell} />
          <KpiCard
            label="미확인"
            value={stats.unacked.toLocaleString()}
            icon={AlertTriangle}
            tone={stats.unacked > 0 ? 'negative' : 'positive'}
          />
          <KpiCard
            label="이번 주 critical"
            value={(stats.by_severity.critical ?? 0).toLocaleString()}
            icon={AlertTriangle}
            tone={stats.by_severity.critical ? 'negative' : 'positive'}
          />
          <KpiCard
            label="정책 winner 누적"
            value={(stats.by_category.policy_winner ?? 0).toLocaleString()}
            icon={Trophy}
          />
        </section>
      )}

      {/* 필터 */}
      <section className="admin-card p-4 flex flex-wrap items-center gap-3">
        <label className="text-admin-xs font-semibold text-admin-text-2">카테고리</label>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="h-8 text-admin-sm border border-admin-border-mid rounded-admin-sm px-2.5 bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
        >
          <option value="">전체</option>
          {Object.keys(CATEGORY_LABELS).map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c].emoji} {CATEGORY_LABELS[c].label}</option>
          ))}
        </select>

        <label className="text-admin-xs font-semibold text-admin-text-2">심각도</label>
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          className="h-8 text-admin-sm border border-admin-border-mid rounded-admin-sm px-2.5 bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
        >
          <option value="">전체</option>
          <option value="critical">critical</option>
          <option value="warning">warning</option>
          <option value="info">info</option>
        </select>

        <label className="text-admin-xs flex items-center gap-1.5 ml-auto cursor-pointer text-admin-text-2">
          <input
            type="checkbox"
            checked={showAcked}
            onChange={e => setShowAcked(e.target.checked)}
            className="rounded border-admin-border-mid text-brand focus:ring-brand/30"
          />
          확인된 알림도 표시
        </label>
      </section>

      {/* 알림 목록 */}
      <section className="space-y-2">
        {loading ? (
          <p className="text-center text-admin-sm text-admin-muted-2 py-8">로딩 중…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-admin-surface rounded-admin-md border border-admin-border-mid">
            <div className="w-12 h-12 rounded-full bg-status-successBg flex items-center justify-center text-status-successFg mb-3">
              <CheckCircle2 size={20} strokeWidth={1.75} />
            </div>
            <p className="text-admin-base font-semibold text-admin-text">미확인 알림 없음</p>
            <p className="text-admin-xs text-admin-muted mt-1">모든 시그널이 ✓ 처리됐어요. 새 알림 발생 시 자동 누적.</p>
          </div>
        ) : (
          filtered.map(a => {
            const cat = CATEGORY_LABELS[a.category] ?? CATEGORY_LABELS.general;
            const acked = !!a.acknowledged_at;
            return (
              <div key={a.id} className={`border rounded-admin-md p-4 ${acked ? 'bg-admin-bg/60 border-admin-border-mid opacity-70' : cat.color}`}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">{cat.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEVERITY_BADGE[a.severity] ?? SEVERITY_BADGE.info}`}>
                        {a.severity}
                      </span>
                      <span className="text-[10px] font-medium text-admin-muted">{cat.label}</span>
                      <span className="text-[10px] text-admin-muted-2">{fmtDateTime(a.created_at)}</span>
                      {acked && <span className="text-[10px] text-emerald-600 ml-auto">✓ 확인됨</span>}
                    </div>
                    <p className="text-sm font-bold text-admin-text leading-snug">{a.title}</p>
                    {a.message && <p className="text-xs text-admin-text-2 mt-1 leading-relaxed break-keep">{a.message}</p>}
                    {a.ref_type && a.ref_id && (
                      <p className="text-[10px] text-admin-muted mt-1.5 font-mono">
                        {a.ref_type}: <code className="bg-admin-surface-2 px-1 rounded">{a.ref_id}</code>
                      </p>
                    )}
                  </div>
                  {!acked && (
                    <button
                      onClick={() => ack(a.id)}
                      className="h-8 px-3 text-admin-sm font-medium text-brand bg-admin-surface border border-admin-border-mid hover:bg-brand-light hover:border-brand rounded-admin-sm transition-colors flex-shrink-0"
                    >
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
