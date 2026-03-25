'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Tenant {
  id:               string;
  name:             string;
  contact_name?:    string;
  contact_phone?:   string;
  contact_email?:   string;
  commission_rate:  number;
  status:           string;
  description?:     string;
  created_at:       string;
}

interface TenantStats {
  product_count:  number;
  sale_count:     number;
  settlement_cost: number;
}

const EMPTY_FORM = {
  id:              '',
  name:            '',
  contact_name:    '',
  contact_phone:   '',
  contact_email:   '',
  commission_rate: 18,
  status:          'active',
  description:     '',
};

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-green-50 text-green-700',
  inactive:  'bg-slate-100 text-slate-500',
  suspended: 'bg-red-50 text-red-600',
};

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function TenantsPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats,   setStats]   = useState<Record<string, TenantStats>>({});
  const [loading, setLoading] = useState(true);
  const [panel,   setPanel]   = useState(false);
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const thisMonth = new Date().toISOString().slice(0, 7);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch('/api/tenants');
    const data = await res.json();
    const list: Tenant[] = data.tenants ?? [];
    setTenants(list);

    // 각 테넌트 통계 병렬 로드
    const statsMap: Record<string, TenantStats> = {};
    await Promise.all(list.map(async (t) => {
      try {
        const [prodRes, setRes] = await Promise.all([
          fetch(`/api/tenant/products?tenant_id=${t.id}`),
          fetch(`/api/tenant/settlements?tenant_id=${t.id}&month=${thisMonth}`),
        ]);
        const [prodData, setData] = await Promise.all([prodRes.json(), setRes.json()]);
        statsMap[t.id] = {
          product_count:   (prodData.products ?? []).length,
          sale_count:      (setData.rows ?? []).length,
          settlement_cost: setData.total_cost ?? 0,
        };
      } catch {
        statsMap[t.id] = { product_count: 0, sale_count: 0, settlement_cost: 0 };
      }
    }));
    setStats(statsMap);
    setLoading(false);
  }, [thisMonth]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setError('');
    setPanel(true);
  }

  function openEdit(t: Tenant) {
    setForm({
      id:              t.id,
      name:            t.name,
      contact_name:    t.contact_name  ?? '',
      contact_phone:   t.contact_phone ?? '',
      contact_email:   t.contact_email ?? '',
      commission_rate: t.commission_rate,
      status:          t.status,
      description:     t.description   ?? '',
    });
    setError('');
    setPanel(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const method = form.id ? 'PUT' : 'POST';
      const url    = form.id ? `/api/tenants/${form.id}` : '/api/tenants';
      const body   = { ...form };
      if (!form.id) delete (body as { id?: string }).id;
      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPanel(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">테넌트 관리</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">입점 랜드사(테넌트) 목록 및 현황을 관리합니다.</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[#001f3f] text-white rounded-lg text-[13px] font-medium hover:bg-blue-900 transition"
        >
          + 테넌트 등록
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-500 text-[14px]">로딩 중...</div>
      ) : tenants.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-white rounded-lg border border-slate-200">
          <p className="text-[14px] font-medium">등록된 테넌트가 없습니다.</p>
          <p className="text-[13px] mt-1">+ 테넌트 등록 버튼으로 랜드사를 추가하세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tenants.map(t => {
            const s = stats[t.id] ?? { product_count: 0, sale_count: 0, settlement_cost: 0 };
            return (
              <div key={t.id} className="bg-white rounded-lg border border-slate-200 p-5 flex flex-col gap-4 hover:border-slate-300 transition">
                {/* 헤더 */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[16px] font-bold text-slate-800">{t.name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[t.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {t.status}
                      </span>
                    </div>
                    {t.contact_name && (
                      <p className="text-[11px] text-slate-500 mt-0.5">담당: {t.contact_name} {t.contact_phone && `/ ${t.contact_phone}`}</p>
                    )}
                  </div>
                  <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    수수료 {t.commission_rate}%
                  </span>
                </div>

                {/* 통계 */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p className="text-[11px] text-slate-500">등록 상품</p>
                    <p className="text-lg font-bold text-slate-800">{s.product_count}</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p className="text-[11px] text-slate-500">이번 달 판매</p>
                    <p className="text-lg font-bold text-slate-800">{s.sale_count}건</p>
                  </div>
                  <div className="bg-blue-50 border border-slate-200 rounded-lg p-2">
                    <p className="text-[11px] text-slate-500">정산 예정</p>
                    <p className="text-[13px] font-bold text-slate-800">{fmt(s.settlement_cost)}원</p>
                  </div>
                </div>

                {/* 액션 버튼 */}
                <div className="flex gap-2">
                  <button
                    onClick={() => router.push(`/tenant/${t.id}/products`)}
                    className="flex-1 bg-[#001f3f] text-white py-2 rounded-lg text-[13px] font-medium hover:bg-blue-900 transition"
                  >
                    테넌트 뷰 열기
                  </button>
                  <button
                    onClick={() => openEdit(t)}
                    className="px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-[13px] hover:bg-slate-50 transition"
                  >
                    수정
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 등록/수정 슬라이드 패널 */}
      {panel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPanel(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto border-l border-slate-200">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-[16px] font-bold text-slate-800">
                  {form.id ? '테넌트 수정' : '새 테넌트 등록'}
                </h3>
                <button onClick={() => setPanel(false)} className="text-slate-500 hover:text-slate-700 text-lg">&times;</button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">업체명 *</label>
                  <input
                    type="text" required value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="예: 가나다 투어"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">담당자명</label>
                    <input
                      type="text" value={form.contact_name}
                      onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">연락처</label>
                    <input
                      type="text" value={form.contact_phone}
                      onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="예: 051-000-0000"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">이메일</label>
                  <input
                    type="email" value={form.contact_email}
                    onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">수수료율 (%)</label>
                    <input
                      type="number" min="0" max="100" step="0.01" value={form.commission_rate}
                      onChange={e => setForm(f => ({ ...f, commission_rate: Number(e.target.value) }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">상태</label>
                    <select
                      value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="active">active -- 운영 중</option>
                      <option value="inactive">inactive -- 비활성</option>
                      <option value="suspended">suspended -- 정지</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">메모</label>
                  <textarea
                    value={form.description} rows={2}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{error}</div>}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setPanel(false)}
                    className="flex-1 bg-white border border-slate-300 text-slate-700 py-2 rounded-lg text-[14px] hover:bg-slate-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-[#001f3f] text-white py-2 rounded-lg text-[14px] font-medium hover:bg-blue-900 disabled:opacity-50"
                  >
                    {saving ? '저장 중...' : (form.id ? '수정 저장' : '등록')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
