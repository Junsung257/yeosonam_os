'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface LandOperator {
  id: string;
  name: string;
  is_active?: boolean;
}

interface StubPackage {
  id: string;
  title: string;
  destination: string | null;
  price: number | null;
  land_operator: string | null;
  land_operator_id: string | null;
  confirmed_dates: string[] | null;
  nights: number | null;
  data_completeness: number | null;
  created_at: string;
}

export default function StubProductsPage() {
  const [operators, setOperators] = useState<LandOperator[]>([]);
  const [stubs, setStubs] = useState<StubPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const [form, setForm] = useState({
    land_operator_id: '',
    land_operator_name: '',
    destination: '',
    price: '',
    duration_nights: '',
    departure_date: '',
    title_hint: '',
    notes: '',
  });

  const refresh = async () => {
    setLoading(true);
    try {
      const [opRes, stubRes] = await Promise.all([
        fetch('/api/land-operators'),
        fetch('/api/products/stub?limit=50'),
      ]);
      const opData = await opRes.json();
      const stubData = await stubRes.json();
      setOperators((opData.operators || []).filter((o: LandOperator) => !o.id.startsWith('default-') || true));
      setStubs(stubData.stubs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록 조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedId(null);
    try {
      const payload: Record<string, unknown> = {
        destination: form.destination.trim(),
        title_hint: form.title_hint.trim() || undefined,
        notes: form.notes.trim() || undefined,
        source: 'manual',
      };
      if (form.land_operator_id) payload.land_operator_id = form.land_operator_id;
      else if (form.land_operator_name.trim()) payload.land_operator_name = form.land_operator_name.trim();
      if (form.price) payload.price = parseInt(form.price, 10);
      if (form.duration_nights) payload.duration_nights = parseInt(form.duration_nights, 10);
      if (form.departure_date) payload.departure_date = form.departure_date;

      const res = await fetch('/api/products/stub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '등록 실패');
        return;
      }
      setSavedId(data.package.id);
      setForm({
        land_operator_id: '',
        land_operator_name: '',
        destination: '',
        price: '',
        duration_nights: '',
        departure_date: '',
        title_hint: '',
        notes: '',
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-5xl mx-auto px-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Stub 상품 등록</h1>
            <p className="text-sm text-slate-500 mt-1">
              랜드사+지역+가격만으로 자리지킴이 상품을 만들어 두면, 이후 들어오는 예약·KTKG 트리플이 매칭됩니다. 고객 페이지엔 노출되지 않습니다.
            </p>
          </div>
          <Link href="/admin/packages" className="text-sm text-blue-600 hover:underline">← 상품 관리</Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-slate-900">신규 Stub 등록</h2>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">랜드사 *</label>
              <select
                value={form.land_operator_id}
                onChange={e => setForm(f => ({ ...f, land_operator_id: e.target.value, land_operator_name: '' }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— 직접 입력 또는 선택 —</option>
                {operators.filter(o => !o.id.startsWith('default-')).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              {!form.land_operator_id && (
                <input
                  type="text"
                  value={form.land_operator_name}
                  onChange={e => setForm(f => ({ ...f, land_operator_name: e.target.value }))}
                  placeholder="신규 랜드사명 (없으면 자동 생성됨)"
                  className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">목적지 *</label>
              <input
                type="text"
                value={form.destination}
                onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
                placeholder="치앙마이 / 다낭 / 사이판 ..."
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">가격 (원, 1인)</label>
                <input
                  type="number"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="619000"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">기간 (박)</label>
                <input
                  type="number"
                  value={form.duration_nights}
                  onChange={e => setForm(f => ({ ...f, duration_nights: e.target.value }))}
                  placeholder="3"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">출발일</label>
                <input
                  type="date"
                  value={form.departure_date}
                  onChange={e => setForm(f => ({ ...f, departure_date: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">상품명 hint (선택)</label>
              <input
                type="text"
                value={form.title_hint}
                onChange={e => setForm(f => ({ ...f, title_hint: e.target.value }))}
                placeholder="치앙마이 골든트라이앵글 3박5일 (비우면 자동 생성)"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">메모 (internal)</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="노팁노옵션, 가이드팁 50달러 등"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={saving || !form.destination.trim() || (!form.land_operator_id && !form.land_operator_name.trim())}
              className="w-full bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:bg-slate-300"
            >
              {saving ? '등록 중...' : 'Stub 상품 등록'}
            </button>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">{error}</div>
            )}
            {savedId && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-700">
                ✓ Stub 상품 등록 완료. id: <code className="font-mono text-xs">{savedId.slice(0, 8)}</code>
              </div>
            )}
          </form>

          <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">최근 Stub 상품</h2>
              <button onClick={refresh} disabled={loading} className="text-xs text-blue-600 hover:underline">
                {loading ? '새로고침 중...' : '새로고침'}
              </button>
            </div>
            {stubs.length === 0 && !loading && (
              <div className="flex flex-col items-center gap-2 py-12">
                <svg className="w-9 h-9 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                <p className="text-admin-sm font-medium text-slate-500">등록된 Stub 상품이 없습니다.</p>
              </div>
            )}
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {stubs.map(s => (
                <div key={s.id} className="border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900 text-sm truncate">{s.title}</span>
                    {s.data_completeness != null && (
                      <span className="text-[10px] tabular-nums text-slate-500 shrink-0">
                        완성도 {Math.round(s.data_completeness * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-slate-600">
                    {s.destination && <span>📍 {s.destination}</span>}
                    {s.land_operator && <span>🏢 {s.land_operator}</span>}
                    {s.price && <span>💰 {s.price.toLocaleString()}원</span>}
                    {s.nights && <span>🌙 {s.nights}박</span>}
                  </div>
                  {s.confirmed_dates && s.confirmed_dates.length > 0 && (
                    <div className="text-slate-500">📅 {s.confirmed_dates.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
