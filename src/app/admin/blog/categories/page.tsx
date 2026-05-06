'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Category {
  id: string;
  key: string;
  label: string;
  description: string | null;
  scope: 'info' | 'product' | 'both';
  display_order: number;
  is_active: boolean;
  created_at: string;
}

const SCOPE_LABEL: Record<string, string> = {
  info: '정보성',
  product: '상품',
  both: '공용',
};

const SCOPE_BADGE: Record<string, string> = {
  info: 'bg-indigo-50 text-indigo-600',
  product: 'bg-emerald-50 text-emerald-600',
  both: 'bg-slate-100 text-slate-600',
};

export default function BlogCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/blog-categories?include_inactive=1');
      const data = await res.json();
      setCategories(data.categories || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const handleDelete = async (id: string) => {
    if (!confirm('정말 비활성화하시겠습니까?')) return;
    const res = await fetch(`/api/blog-categories?id=${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('비활성화 완료'); loadCategories(); }
    else showToast('실패');
  };

  const handleToggleActive = async (cat: Category) => {
    const res = await fetch('/api/blog-categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cat.id, is_active: !cat.is_active }),
    });
    if (res.ok) { showToast(cat.is_active ? '비활성화' : '활성화'); loadCategories(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/admin/blog" className="text-admin-xs text-slate-500 hover:text-slate-700">← 블로그</Link>
          </div>
          <h1 className="text-[18px] font-bold text-slate-800 mt-1">블로그 카테고리 관리</h1>
          <p className="text-admin-xs text-slate-400 mt-0.5">
            정보성 블로그 + 상품 블로그에 사용되는 카테고리를 관리합니다.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="px-4 py-2 bg-blue-600 text-white text-admin-sm font-semibold rounded-lg hover:bg-blue-700 transition"
        >
          + 새 카테고리
        </button>
      </div>

      {/* 폼 */}
      {showForm && (
        <CategoryForm
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadCategories(); showToast('저장 완료'); }}
        />
      )}

      {/* 목록 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden divide-y divide-slate-50">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
              <div className="h-4 bg-slate-100 rounded-full animate-pulse w-16" />
              <div className="h-7 bg-slate-100 rounded-lg animate-pulse w-12" />
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-[11px] text-slate-500 font-medium w-16">순서</th>
                <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium">라벨</th>
                <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium">Key</th>
                <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium w-20">범위</th>
                <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium w-20">상태</th>
                <th className="w-32"></th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.id} className={`border-b border-slate-100 hover:bg-slate-50 transition ${!cat.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 text-admin-xs text-slate-500 tabular-nums">{cat.display_order}</td>
                  <td className="px-3 py-3">
                    <p className="text-admin-sm font-medium text-slate-800">{cat.label}</p>
                    {cat.description && <p className="text-[11px] text-slate-400 mt-0.5">{cat.description}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <code className="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{cat.key}</code>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${SCOPE_BADGE[cat.scope]}`}>
                      {SCOPE_LABEL[cat.scope]}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <button onClick={() => handleToggleActive(cat)}
                      className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${cat.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {cat.is_active ? '활성' : '비활성'}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => { setEditing(cat); setShowForm(true); }}
                      className="text-[11px] text-blue-600 hover:underline mr-2">수정</button>
                    <button onClick={() => handleDelete(cat.id)}
                      className="text-[11px] text-red-500 hover:underline">비활성화</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-white text-admin-sm shadow-lg bg-slate-800">
          {toast}
        </div>
      )}
    </div>
  );
}

function CategoryForm({ initial, onClose, onSaved }: {
  initial: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(initial?.key || '');
  const [label, setLabel] = useState(initial?.label || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [scope, setScope] = useState<'info' | 'product' | 'both'>(initial?.scope || 'info');
  const [displayOrder, setDisplayOrder] = useState(initial?.display_order || 99);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!initial;

  const handleSave = async () => {
    setError('');
    if (!label.trim()) { setError('라벨은 필수입니다.'); return; }
    if (!isEdit && !key.trim()) { setError('Key는 필수입니다.'); return; }

    setSaving(true);
    try {
      const body: Record<string, unknown> = { label, description, scope, display_order: displayOrder };
      if (isEdit) body.id = initial.id;
      else body.key = key;

      const res = await fetch('/api/blog-categories', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-indigo-200 rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-admin-base font-semibold text-slate-800">
          {isEdit ? '카테고리 수정' : '새 카테고리'}
        </h2>
        <button onClick={onClose} className="text-admin-xs text-slate-500 hover:text-slate-700">✕ 취소</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">Key (영소문자, 수정 불가)</label>
          <input value={key} onChange={e => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            disabled={isEdit}
            placeholder="예: accommodation"
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm font-mono disabled:bg-slate-50 disabled:text-slate-400" />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">라벨 (화면 표시)</label>
          <input value={label} onChange={e => setLabel(e.target.value)}
            placeholder="예: 숙박"
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] text-slate-400 mb-1">설명 (선택)</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="카테고리에 대한 간단한 설명"
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm" />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">범위</label>
          <select value={scope} onChange={e => setScope(e.target.value as any)}
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm">
            <option value="info">정보성 전용</option>
            <option value="product">상품 전용</option>
            <option value="both">공용</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">표시 순서</label>
          <input type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value) || 0)}
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm" />
        </div>
      </div>

      {error && <p className="text-admin-xs text-red-600">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button onClick={onClose}
          className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-admin-xs rounded hover:bg-slate-50">
          취소
        </button>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-admin-xs font-medium rounded hover:bg-blue-700 disabled:opacity-40">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
