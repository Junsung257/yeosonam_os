/**
 * 5개 정책 weights side-by-side 비교 차트 (v3.8, 2026-04-30).
 *
 * /admin/scoring 페이지 하단에 임베드.
 * 가로 막대그래프로 정책별 가중치 시각화.
 */
'use client';

import { useEffect, useState } from 'react';

interface PolicyRow {
  id: string;
  version: string;
  is_active: boolean;
  weights: Record<string, number>;
  notes: string | null;
}

const AXIS_LABELS: Record<string, { ko: string; emoji: string }> = {
  price: { ko: '가격', emoji: '💰' },
  hotel: { ko: '호텔', emoji: '🏨' },
  meal: { ko: '식사', emoji: '🍽️' },
  free_options: { ko: '옵션', emoji: '💎' },
  shopping_avoidance: { ko: '쇼핑X', emoji: '🛍️' },
  reliability: { ko: '신뢰도', emoji: '✓' },
  climate_fit: { ko: '계절', emoji: '🌤️' },
  popularity: { ko: '인기', emoji: '🇰🇷' },
  korean_meal: { ko: '한식', emoji: '🍚' },
  free_time: { ko: '자유', emoji: '⏰' },
};

const POLICY_THEME: Record<string, { bg: string; border: string }> = {
  'v1.0-bootstrap': { bg: 'bg-slate-100', border: 'border-slate-400' },
  'intent-family': { bg: 'bg-emerald-100', border: 'border-emerald-400' },
  'intent-couple': { bg: 'bg-pink-100', border: 'border-pink-400' },
  'intent-filial': { bg: 'bg-amber-100', border: 'border-amber-400' },
  'intent-budget': { bg: 'bg-blue-100', border: 'border-blue-400' },
  'intent-no-option': { bg: 'bg-violet-100', border: 'border-violet-400' },
};

export default function PolicyWeightsCompare() {
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/scoring/policies')
      .then(r => r.ok ? r.json() : { policies: [] })
      .then(d => setPolicies(d.policies ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (policies.length === 0) return null;

  // 정규화된 weights (합=1)
  const normalized = policies.map(p => {
    const sum = Object.values(p.weights).reduce((a, b) => a + (Number(b) || 0), 0);
    if (sum === 0) return { ...p, weightsNorm: p.weights };
    const norm: Record<string, number> = {};
    for (const k of Object.keys(p.weights)) norm[k] = (Number(p.weights[k]) || 0) / sum;
    return { ...p, weightsNorm: norm };
  });

  const axes = Object.keys(AXIS_LABELS);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800">정책 가중치 비교 (10 axis)</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          각 정책의 가중치를 막대로 비교 — Intent별 어떤 axis를 강조하는지 한눈에. 활성 정책은 ⭐
        </p>
      </div>

      {/* 정책 범례 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {normalized.map(p => {
          const theme = POLICY_THEME[p.version] ?? POLICY_THEME['v1.0-bootstrap'];
          return (
            <span key={p.id} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border ${theme.bg} ${theme.border}`}>
              {p.is_active && <span>⭐</span>}
              <span>{p.version}</span>
            </span>
          );
        })}
      </div>

      {/* axis × 정책 그리드 */}
      <div className="space-y-2.5">
        {axes.map(axis => {
          const lbl = AXIS_LABELS[axis];
          const maxVal = Math.max(...normalized.map(p => p.weightsNorm[axis] ?? 0));
          if (maxVal === 0) return null;
          return (
            <div key={axis} className="flex items-center gap-3">
              <div className="w-20 flex-shrink-0 text-xs text-slate-700 flex items-center gap-1">
                <span>{lbl.emoji}</span>
                <span className="font-medium">{lbl.ko}</span>
              </div>
              <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${normalized.length}, 1fr)` }}>
                {normalized.map(p => {
                  const v = p.weightsNorm[axis] ?? 0;
                  const widthPct = maxVal > 0 ? (v / maxVal) * 100 : 0;
                  const theme = POLICY_THEME[p.version] ?? POLICY_THEME['v1.0-bootstrap'];
                  return (
                    <div key={p.id} className="flex items-center gap-1" title={`${p.version}: ${(v * 100).toFixed(1)}%`}>
                      <div className="flex-1 h-5 rounded bg-slate-50 overflow-hidden border border-slate-100 relative">
                        <div
                          className={`h-full ${theme.bg} ${theme.border} border-r transition-all`}
                          style={{ width: `${widthPct}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-end pr-1 text-[10px] tabular-nums font-semibold text-slate-700">
                          {(v * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 mt-4 leading-relaxed">
        ※ 막대 길이 = axis별 최대 정책 대비 비율. 숫자 = 정책 내 정규화 % · 정책 weights 편집은 위 "기준 가중치" 섹션
      </p>
    </section>
  );
}
