'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface TenantProduct {
  id:             string;
  title:          string;
  destination?:   string;
  category?:      string;
  cost_price:     number;
  price:          number;
  min_participants?: number;
  status:         string;
  notes?:         string;
  created_at:     string;
}

const CATEGORIES = ['package','hotel','cruise','activity','golf','theme'];

const STATUS_BADGE: Record<string, string> = {
  approved: 'bg-green-100 text-green-700',
  pending:  'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
};

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

const EMPTY_FORM = {
  id:               '',
  title:            '',
  destination:      '',
  category:         'package',
  product_type:     '',
  cost_price:       0,
  price:            0,
  min_participants: 4,
  notes:            '',
};

export default function TenantProductsPage() {
  const params   = useParams();
  const tenantId = params.tenantId as string;

  const [products, setProducts] = useState<TenantProduct[]>([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/tenant/products?tenant_id=${tenantId}`);
    const data = await res.json();
    setProducts(data.products ?? []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setError('');
    setModal(true);
  }

  function openEdit(p: TenantProduct) {
    setForm({
      id:               p.id,
      title:            p.title,
      destination:      p.destination ?? '',
      category:         p.category ?? 'package',
      product_type:     '',
      cost_price:       p.cost_price,
      price:            p.price,
      min_participants: p.min_participants ?? 4,
      notes:            p.notes ?? '',
    });
    setError('');
    setModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const method = form.id ? 'PUT' : 'POST';
      const body   = { ...form, tenant_id: tenantId };
      if (!form.id) delete (body as { id?: string }).id;
      const res  = await fetch('/api/tenant/products', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  const margin = form.price - form.cost_price;
  const marginPct = form.price > 0 ? ((margin / form.price) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">상품 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">등록된 상품은 여소남 AI 컨시어지에 노출됩니다.</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
        >
          + 상품 등록
        </button>
      </div>

      {/* 상품 목록 */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              {['상품명', '목적지', '카테고리', '원가', '판매가', '마진', '인원', '상태', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">등록된 상품이 없습니다. 상품을 등록해 주세요.</td></tr>
            ) : (
              products.map(p => {
                const m = p.price - p.cost_price;
                const mp = p.price > 0 ? ((m / p.price) * 100).toFixed(1) : '0';
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">{p.title}</td>
                    <td className="px-4 py-3 text-gray-600">{p.destination ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{p.category ?? '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-orange-600 font-medium">₩{fmt(p.cost_price)}</td>
                    <td className="px-4 py-3 text-indigo-700 font-bold">₩{fmt(p.price)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${m >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        ₩{fmt(m)} ({mp}%)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.min_participants ?? 4}명+</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(p)}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        수정
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 등록/수정 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              {form.id ? '상품 수정' : '새 상품 등록'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상품명 *</label>
                <input
                  type="text" required value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="예: 발리 5박 6일 리조트 패키지"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">목적지</label>
                  <input
                    type="text" value={form.destination}
                    onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="예: 발리, 방콕"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                  <select
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">원가 (KRW) *</label>
                  <input
                    type="number" required min="0" value={form.cost_price}
                    onChange={e => setForm(f => ({ ...f, cost_price: Number(e.target.value) }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">판매가 (KRW) *</label>
                  <input
                    type="number" required min="0" value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>

              {/* 마진 미리보기 */}
              <div className="bg-indigo-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">예상 마진:</span>
                  <span className={`font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    ₩{fmt(margin)} ({marginPct}%)
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">※ 여소남 OS 수수료는 판매가에서 자동 차감됩니다.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">최소 출발 인원</label>
                <input
                  type="number" min="1" value={form.min_participants}
                  onChange={e => setForm(f => ({ ...f, min_participants: Number(e.target.value) }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
                <textarea
                  value={form.notes} rows={2}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModal(false)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : (form.id ? '수정 저장' : '등록')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
