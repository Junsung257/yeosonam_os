/**
 * 점수 시스템 KPI 위젯 (v3.7, 2026-04-30)
 *
 * /admin 메인 대시보드 1줄 — 추천 시스템 운영 헬스 한눈.
 *  - 활성 정책 / 그룹 수 / LTR 진행 / 미해결 알림
 *  - 클릭 시 해당 페이지로 이동
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Stats {
  active_policy_version: string | null;
  total_groups: number;
  total_score_rows: number;
  ltr_samples: number;
  ltr_ready: boolean;
  unacked_alerts: number;
  recent_winner: { policy_version: string | null; confidence: number | null } | null;
}

export default function ScoringKpiWidget() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/admin/scoring/widget')
      .then(r => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) return null;

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <span>⭐</span>
          <span>추천 시스템</span>
        </h3>
        <Link href="/admin/scoring/funnel" className="text-[11px] text-violet-600 hover:underline">
          깔때기 →
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/admin/scoring" className="bg-slate-50 rounded-lg p-3 hover:bg-slate-100 transition">
          <div className="text-[10px] text-slate-400 uppercase">활성 정책</div>
          <div className="text-sm font-bold text-slate-900 mt-0.5 truncate">
            {stats.active_policy_version ?? '—'}
          </div>
        </Link>

        <div className="bg-slate-50 rounded-lg p-3">
          <div className="text-[10px] text-slate-400 uppercase">점수 그룹</div>
          <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
            {stats.total_groups.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500">
            {stats.total_score_rows.toLocaleString()} score row
          </div>
        </div>

        <Link href="/admin/scoring/funnel" className={`rounded-lg p-3 transition ${
          stats.ltr_ready ? 'bg-emerald-50 hover:bg-emerald-100' : 'bg-violet-50 hover:bg-violet-100'
        }`}>
          <div className="text-[10px] text-slate-500 uppercase">LTR 학습</div>
          <div className={`text-sm font-bold mt-0.5 tabular-nums ${
            stats.ltr_ready ? 'text-emerald-700' : 'text-violet-700'
          }`}>
            {stats.ltr_ready ? '✓ Ready' : `${stats.ltr_samples}/1000`}
          </div>
          <div className="text-[10px] text-slate-500">
            {stats.ltr_ready ? '학습 가능' : '데이터 누적 중'}
          </div>
        </Link>

        <Link href="/admin/alerts" className={`rounded-lg p-3 transition ${
          stats.unacked_alerts > 0 ? 'bg-amber-50 hover:bg-amber-100' : 'bg-slate-50 hover:bg-slate-100'
        }`}>
          <div className="text-[10px] text-slate-500 uppercase">미해결 알림</div>
          <div className={`text-sm font-bold mt-0.5 tabular-nums ${
            stats.unacked_alerts > 0 ? 'text-amber-700' : 'text-slate-500'
          }`}>
            {stats.unacked_alerts}
          </div>
          {stats.recent_winner?.policy_version && (
            <div className="text-[10px] text-amber-600 truncate">
              winner: {stats.recent_winner.policy_version}
            </div>
          )}
        </Link>
      </div>
    </section>
  );
}
