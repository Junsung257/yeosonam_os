'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface TermsTemplate {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  scope: Record<string, unknown>;
  notices: { type: string; title: string; text: string; severity?: string; surfaces?: string[] }[];
  priority: number;
  version: number;
  is_active: boolean;
  is_current: boolean;
  starts_at: string;
  ends_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const TIER_LABELS: Record<number, string> = {
  1: '플랫폼 기본',
  2: '랜드사 공통',
  3: '랜드사 × 상품타입',
};

const TIER_COLORS: Record<number, string> = {
  1: 'bg-slate-100 text-slate-700',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-purple-100 text-purple-700',
};

export default function TermsTemplatesPage() {
  const [templates, setTemplates] = useState<TermsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [filterTier, setFilterTier] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (includeInactive) params.set('include_inactive', 'true');
    if (filterTier) params.set('tier', String(filterTier));
    const res = await fetch(`/api/terms-templates?${params}`);
    const json = await res.json();
    setTemplates(json.data ?? []);
    setLoading(false);
  }, [includeInactive, filterTier]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">약관 템플릿 관리</h1>
          <p className="text-sm text-slate-500 mt-1">
            4-level 우선순위: 플랫폼(1) → 랜드사 공통(2) → 랜드사 × 상품타입(3) → 상품 특약(notices_parsed, 최우선)
          </p>
        </div>
        <Link
          href="/admin/terms-templates/new"
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-700"
        >
          + 새 약관 템플릿
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-4 p-3 bg-slate-50 rounded-lg">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={e => setIncludeInactive(e.target.checked)}
          />
          비활성 포함
        </label>
        <select
          value={filterTier ?? ''}
          onChange={e => setFilterTier(e.target.value ? Number(e.target.value) : null)}
          className="text-sm border border-slate-300 rounded px-2 py-1"
        >
          <option value="">모든 tier</option>
          <option value="1">Tier 1 (플랫폼)</option>
          <option value="2">Tier 2 (랜드사 공통)</option>
          <option value="3">Tier 3 (랜드사 × 상품타입)</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 space-y-2">
              <div className="h-4 bg-slate-100 rounded animate-pulse w-48" />
              <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <p className="text-slate-400">약관 템플릿이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <Link
              key={t.id}
              href={`/admin/terms-templates/${t.id}`}
              className="block bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 hover:border-slate-400 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${TIER_COLORS[t.tier]}`}>
                      T{t.tier} · {TIER_LABELS[t.tier]}
                    </span>
                    {!t.is_active && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-500">비활성</span>
                    )}
                    <span className="text-[10px] text-slate-400">v{t.version} · priority {t.priority}</span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 truncate">{t.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    blocks {t.notices.length}개 · scope {JSON.stringify(t.scope).slice(0, 80)}
                  </p>
                  {t.notes && <p className="text-xs text-slate-400 mt-1 italic">{t.notes}</p>}
                </div>
                <span className="text-xs text-slate-400 shrink-0">
                  {new Date(t.updated_at).toLocaleDateString('ko-KR')}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
