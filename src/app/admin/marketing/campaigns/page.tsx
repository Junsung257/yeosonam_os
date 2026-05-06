'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { AdCampaign, CampaignObjective } from '@/types/meta-ads';

const OBJECTIVES: { value: CampaignObjective; label: string }[] = [
  { value: 'LINK_CLICKS', label: '링크 클릭' },
  { value: 'CONVERSIONS', label: '전환' },
  { value: 'REACH', label: '도달' },
  { value: 'BRAND_AWARENESS', label: '브랜드 인지도' },
];

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  ARCHIVED: 'bg-red-100 text-red-600',
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안', ACTIVE: '집행 중', PAUSED: '일시정지', ARCHIVED: '종료',
};

interface Package {
  id: string;
  title: string;
  destination: string;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    package_id: '',
    name: '',
    objective: 'LINK_CLICKS' as CampaignObjective,
    daily_budget_krw: 50000,
  });

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/meta/campaigns');
      if (res.ok) {
        const { campaigns: list } = await res.json();
        setCampaigns(list ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
    fetch('/api/packages?status=approved&limit=100')
      .then(r => r.json())
      .then(data => setPackages(data.packages ?? []));
  }, [fetchCampaigns]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.package_id || !form.name || !form.daily_budget_krw) {
      setError('모든 필드를 입력해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/meta/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '생성 실패');
        return;
      }

      setShowModal(false);
      setForm({ package_id: '', name: '', objective: 'LINK_CLICKS', daily_budget_krw: 50000 });
      fetchCampaigns();

      if (!data.meta_created) {
        alert(`캠페인이 DB에 저장됐습니다.\nMeta 연동: ${data.meta_error ?? '미설정'}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">캠페인 관리</h1>
          <p className="text-sm text-slate-500">Meta 광고 캠페인을 생성하고 관리합니다</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/admin/marketing')}
            className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            ← 대시보드
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            + 새 캠페인
          </button>
        </div>
      </div>

      {/* 캠페인 테이블 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
                <div className="h-4 bg-slate-100 rounded-full animate-pulse w-20" />
                <div className="h-3.5 bg-slate-100 rounded animate-pulse w-24" />
              </div>
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            캠페인이 없습니다. 첫 캠페인을 만들어보세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">캠페인명</th>
                  <th className="px-4 py-3 text-left">연결 상품</th>
                  <th className="px-4 py-3 text-left">목표</th>
                  <th className="px-4 py-3 text-left">상태</th>
                  <th className="px-4 py-3 text-right">일예산</th>
                  <th className="px-4 py-3 text-right">총 지출</th>
                  <th className="px-4 py-3 text-left">Meta 연동</th>
                  <th className="px-4 py-3 text-left">생성일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800 max-w-xs truncate">{c.name}</div>
                      {c.auto_pause_reason && (
                        <div className="text-xs text-amber-600 mt-0.5">{c.auto_pause_reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[160px] truncate">
                      {c.package_title ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{c.objective}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_BADGE[c.status]}`}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {((c.daily_budget_krw ?? 0) / 10000).toFixed(0)}만원
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {((c.total_spend_krw ?? 0) / 10000).toFixed(0)}만원
                    </td>
                    <td className="px-4 py-3">
                      {c.meta_campaign_id ? (
                        <span className="text-xs text-green-600">✓ 연동됨</span>
                      ) : (
                        <span className="text-xs text-slate-400">미연동</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {c.created_at?.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 신규 캠페인 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-4">새 캠페인 생성</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600">연결 상품 *</label>
                <select
                  value={form.package_id}
                  onChange={e => setForm(f => ({ ...f, package_id: e.target.value }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">상품 선택...</option>
                  {packages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.destination})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600">캠페인명 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: 발리 7일 패키지 - 2026 봄"
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600">캠페인 목표</label>
                <select
                  value={form.objective}
                  onChange={e => setForm(f => ({ ...f, objective: e.target.value as CampaignObjective }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                >
                  {OBJECTIVES.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600">
                  일일 예산 *
                </label>
                <div className="mt-1 relative">
                  <input
                    type="number"
                    value={form.daily_budget_krw}
                    onChange={e => setForm(f => ({ ...f, daily_budget_krw: parseInt(e.target.value) || 0 }))}
                    min={10000}
                    step={10000}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm pr-8"
                  />
                  <span className="absolute right-3 top-2 text-xs text-slate-400">원</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  최소 10,000원 / Meta에는 USD로 변환되어 설정됩니다
                </p>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setError(''); }}
                  className="flex-1 border border-slate-200 text-sm text-slate-600 py-2 rounded-lg hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 text-white text-sm py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? '생성 중...' : '캠페인 생성'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
