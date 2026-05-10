'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fmtNum as fmt } from '@/lib/admin-utils';
import { PageHeader, FormRow } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Plus, X } from 'lucide-react';

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
  inactive:  'bg-admin-surface-2 text-admin-muted',
  suspended: 'bg-red-50 text-red-600',
};

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
    <div className="space-y-5">
      <PageHeader
        title="테넌트 관리"
        subtitle="입점 랜드사(테넌트) 목록 및 현황을 관리합니다"
        actions={
          <Button variant="primary" size="sm" onClick={openCreate}>
            <Plus size={14} />
            테넌트 등록
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 flex items-center gap-4">
              <div className="h-4 bg-admin-surface-2 rounded animate-pulse flex-1" />
              <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-20" />
              <div className="h-4 bg-admin-surface-2 rounded animate-pulse w-24" />
            </div>
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <div className="text-center py-16 text-admin-muted admin-card">
          <p className="text-admin-base font-medium text-admin-text">등록된 테넌트가 없습니다.</p>
          <p className="text-admin-sm mt-1 text-admin-muted">상단 "테넌트 등록" 버튼으로 랜드사를 추가하세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {tenants.map(t => {
            const s = stats[t.id] ?? { product_count: 0, sale_count: 0, settlement_cost: 0 };
            return (
              <div key={t.id} className="admin-card p-5 flex flex-col gap-4 hover:border-admin-border-strong transition-colors duration-160">
                {/* 헤더 */}
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-admin-lg font-bold text-admin-text">{t.name}</span>
                      <span className={`text-admin-2xs px-2 py-0.5 rounded-admin-xs font-semibold uppercase ${STATUS_BADGE[t.status] ?? 'bg-admin-surface-2 text-admin-muted'}`}>
                        {t.status}
                      </span>
                    </div>
                    {t.contact_name && (
                      <p className="text-admin-xs text-admin-muted mt-1">담당: {t.contact_name} {t.contact_phone && `/ ${t.contact_phone}`}</p>
                    )}
                  </div>
                  <span className="text-admin-xs bg-brand-light text-brand px-2 py-0.5 rounded-admin-xs font-semibold admin-num">
                    수수료 {t.commission_rate}%
                  </span>
                </div>

                {/* 통계 */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-admin-surface-2 rounded-admin-sm p-2">
                    <p className="text-admin-2xs text-admin-muted uppercase tracking-wider">등록 상품</p>
                    <p className="text-admin-h3 font-bold text-admin-text admin-num mt-0.5">{s.product_count}</p>
                  </div>
                  <div className="bg-admin-surface-2 rounded-admin-sm p-2">
                    <p className="text-admin-2xs text-admin-muted uppercase tracking-wider">이번달 판매</p>
                    <p className="text-admin-h3 font-bold text-admin-text admin-num mt-0.5">{s.sale_count}<span className="text-admin-xs text-admin-muted ml-0.5">건</span></p>
                  </div>
                  <div className="bg-brand-light rounded-admin-sm p-2">
                    <p className="text-admin-2xs text-brand uppercase tracking-wider">정산 예정</p>
                    <p className="text-admin-sm font-bold text-brand admin-num mt-0.5">{fmt(s.settlement_cost)}원</p>
                  </div>
                </div>

                {/* 액션 버튼 */}
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => router.push(`/tenant/${t.id}/products`)}
                    className="flex-1"
                  >
                    테넌트 뷰 열기
                  </Button>
                  <Button variant="secondary" onClick={() => openEdit(t)}>
                    수정
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 등록/수정 슬라이드 패널 */}
      {panel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setPanel(false)} />
          <div className="admin-scope relative w-full max-w-md bg-admin-surface h-full overflow-y-auto border-l border-admin-border-mid shadow-admin-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-admin-h2 text-admin-text">
                  {form.id ? '테넌트 수정' : '새 테넌트 등록'}
                </h3>
                <button
                  onClick={() => setPanel(false)}
                  className="p-1.5 rounded-admin-sm text-admin-muted hover:text-admin-text hover:bg-admin-surface-2 transition-colors"
                  aria-label="닫기"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <FormRow label="업체명" required>
                  <input
                    type="text" required value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
                    placeholder="예: 가나다 투어"
                  />
                </FormRow>
                <div className="grid grid-cols-2 gap-3">
                  <FormRow label="담당자명">
                    <input
                      type="text" value={form.contact_name}
                      onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                      className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
                    />
                  </FormRow>
                  <FormRow label="연락처">
                    <input
                      type="text" value={form.contact_phone}
                      onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                      className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
                      placeholder="예: 051-000-0000"
                    />
                  </FormRow>
                </div>
                <FormRow label="이메일">
                  <input
                    type="email" value={form.contact_email}
                    onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                    className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
                  />
                </FormRow>
                <div className="grid grid-cols-2 gap-3">
                  <FormRow label="수수료율 (%)">
                    <input
                      type="number" min="0" max="100" step="0.01" value={form.commission_rate}
                      onChange={e => setForm(f => ({ ...f, commission_rate: Number(e.target.value) }))}
                      className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
                    />
                  </FormRow>
                  <FormRow label="상태">
                    <select
                      value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                      className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
                    >
                      <option value="active">active — 운영 중</option>
                      <option value="inactive">inactive — 비활성</option>
                      <option value="suspended">suspended — 정지</option>
                    </select>
                  </FormRow>
                </div>
                <FormRow label="메모">
                  <textarea
                    value={form.description} rows={2}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border border-admin-border-mid rounded-admin-sm px-3 py-2 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors resize-none"
                  />
                </FormRow>

                {error && <div className="p-2 bg-danger-light border border-danger/20 rounded-admin-sm text-admin-sm text-danger">{error}</div>}

                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="secondary" onClick={() => setPanel(false)} className="flex-1">
                    취소
                  </Button>
                  <Button type="submit" variant="primary" disabled={saving} className="flex-1">
                    {saving ? '저장 중…' : (form.id ? '수정 저장' : '등록')}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
