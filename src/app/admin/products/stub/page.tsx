'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, FormRow } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { ArrowLeft, RefreshCw, Package as PackageIcon } from 'lucide-react';

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
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Stub 상품 등록"
        subtitle="랜드사+지역+가격만으로 자리지킴이 상품을 만들어 두면, 이후 들어오는 예약·KTKG 트리플이 매칭됩니다. 고객 페이지엔 노출되지 않습니다."
        actions={
          <Link href="/admin/packages">
            <Button variant="secondary" size="sm">
              <ArrowLeft size={14} />
              상품 관리
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={handleSubmit} className="admin-card p-5 space-y-4">
          <h2 className="text-admin-h3 text-admin-text">신규 Stub 등록</h2>

          <FormRow label="랜드사" required>
            <select
              value={form.land_operator_id}
              onChange={e => setForm(f => ({ ...f, land_operator_id: e.target.value, land_operator_name: '' }))}
              className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
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
                className="mt-2 w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
            )}
          </FormRow>

          <FormRow label="목적지" required>
            <input
              type="text"
              value={form.destination}
              onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
              placeholder="치앙마이 / 다낭 / 사이판 …"
              required
              className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            />
          </FormRow>

          <div className="grid grid-cols-2 gap-3">
            <FormRow label="가격 (원, 1인)">
              <input
                type="number"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                placeholder="619000"
                className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
            </FormRow>
            <FormRow label="기간 (박)">
              <input
                type="number"
                value={form.duration_nights}
                onChange={e => setForm(f => ({ ...f, duration_nights: e.target.value }))}
                placeholder="3"
                className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              />
            </FormRow>
          </div>

          <FormRow label="출발일">
            <input
              type="date"
              value={form.departure_date}
              onChange={e => setForm(f => ({ ...f, departure_date: e.target.value }))}
              className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            />
          </FormRow>

          <FormRow label="상품명 hint" hint="비우면 자동 생성">
            <input
              type="text"
              value={form.title_hint}
              onChange={e => setForm(f => ({ ...f, title_hint: e.target.value }))}
              placeholder="치앙마이 골든트라이앵글 3박5일"
              className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            />
          </FormRow>

          <FormRow label="메모 (internal)">
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="노팁노옵션, 가이드팁 50달러 등"
              className="w-full border border-admin-border-mid rounded-admin-sm px-3 py-2 text-admin-base bg-admin-surface text-admin-text resize-none focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            />
          </FormRow>

          <Button
            type="submit"
            variant="primary"
            disabled={saving || !form.destination.trim() || (!form.land_operator_id && !form.land_operator_name.trim())}
            className="w-full"
          >
            {saving ? '등록 중…' : 'Stub 상품 등록'}
          </Button>

          {error && (
            <div className="p-3 bg-danger-light border border-danger/20 rounded-admin-sm text-admin-sm text-danger">{error}</div>
          )}
          {savedId && (
            <div className="p-3 bg-status-successBg border border-success/20 rounded-admin-sm text-admin-sm text-status-successFg">
              ✓ Stub 상품 등록 완료. id: <code className="font-mono text-admin-xs">{savedId.slice(0, 8)}</code>
            </div>
          )}
        </form>

        <div className="admin-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-admin-h3 text-admin-text">최근 Stub 상품</h2>
            <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-1 text-admin-xs text-brand hover:text-brand-dark font-medium">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {loading ? '새로고침 중…' : '새로고침'}
            </button>
          </div>
          {stubs.length === 0 && !loading && (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="w-12 h-12 rounded-full bg-admin-surface-2 flex items-center justify-center text-admin-muted">
                <PackageIcon size={20} strokeWidth={1.75} />
              </div>
              <p className="text-admin-sm font-medium text-admin-muted">등록된 Stub 상품이 없습니다.</p>
            </div>
          )}
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {stubs.map(s => (
              <div key={s.id} className="border border-admin-border-mid rounded-admin-sm p-3 text-admin-xs space-y-1.5 hover:border-admin-border-strong transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-admin-text text-admin-sm truncate">{s.title}</span>
                  {s.data_completeness != null && (
                    <span className="text-admin-2xs admin-num text-admin-muted shrink-0">
                      완성도 {Math.round(s.data_completeness * 100)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-admin-muted admin-num">
                  {s.destination && <span>📍 {s.destination}</span>}
                  {s.land_operator && <span>🏢 {s.land_operator}</span>}
                  {s.price && <span>💰 {s.price.toLocaleString()}원</span>}
                  {s.nights && <span>🌙 {s.nights}박</span>}
                </div>
                {s.confirmed_dates && s.confirmed_dates.length > 0 && (
                  <div className="text-admin-muted admin-num">📅 {s.confirmed_dates.join(', ')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
