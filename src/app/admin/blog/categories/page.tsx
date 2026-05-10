'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Plus, ArrowLeft, X } from 'lucide-react';

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
  both: 'bg-admin-surface-2 text-admin-muted',
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
      <PageHeader
        title="블로그 카테고리 관리"
        subtitle="정보성 블로그 + 상품 블로그에 사용되는 카테고리를 관리합니다"
        breadcrumb={[{ label: '블로그', href: '/admin/blog' }, { label: '카테고리' }]}
        actions={
          <Button variant="primary" size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus size={14} />
            새 카테고리
          </Button>
        }
      />

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
        <div className="admin-card overflow-hidden divide-y divide-admin-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
              <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-16" />
              <div className="h-7 bg-admin-surface-2 rounded-admin-sm animate-pulse w-12" />
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th style={{ width: 64 }}>순서</th>
                <th>라벨</th>
                <th>Key</th>
                <th style={{ width: 80 }}>범위</th>
                <th style={{ width: 80 }}>상태</th>
                <th style={{ width: 128 }}></th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.id} className={!cat.is_active ? 'opacity-50' : ''}>
                  <td className="text-admin-xs text-admin-muted admin-num">{cat.display_order}</td>
                  <td>
                    <p className="text-admin-sm font-medium text-admin-text">{cat.label}</p>
                    {cat.description && <p className="text-admin-xs text-admin-muted-2 mt-0.5">{cat.description}</p>}
                  </td>
                  <td>
                    <code className="text-admin-xs text-admin-muted bg-admin-surface-2 px-1.5 py-0.5 rounded-admin-xs font-mono">{cat.key}</code>
                  </td>
                  <td>
                    <span className={`px-2 py-0.5 text-admin-2xs rounded-admin-xs font-semibold ${SCOPE_BADGE[cat.scope]}`}>
                      {SCOPE_LABEL[cat.scope]}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => handleToggleActive(cat)}
                      className={`px-2 py-0.5 text-admin-2xs rounded-admin-xs font-semibold transition-colors ${cat.is_active ? 'bg-status-successBg text-status-successFg hover:opacity-80' : 'bg-admin-surface-2 text-admin-muted hover:bg-admin-border-mid'}`}>
                      {cat.is_active ? '활성' : '비활성'}
                    </button>
                  </td>
                  <td className="text-right">
                    <button onClick={() => { setEditing(cat); setShowForm(true); }}
                      className="text-admin-xs text-brand hover:text-brand-dark hover:underline mr-2 font-medium">수정</button>
                    <button onClick={() => handleDelete(cat.id)}
                      className="text-admin-xs text-danger hover:underline font-medium">비활성화</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-admin-sm text-white text-admin-sm font-medium shadow-admin-md bg-admin-text">
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
    <div className="admin-card border-brand/20 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-admin-h3 text-admin-text">
          {isEdit ? '카테고리 수정' : '새 카테고리'}
        </h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-admin-sm text-admin-muted hover:text-admin-text hover:bg-admin-surface-2 transition-colors"
          aria-label="닫기"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-admin-xs text-admin-text-2 font-medium mb-1.5">Key (영소문자, 수정 불가)</label>
          <input value={key} onChange={e => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            disabled={isEdit}
            placeholder="예: accommodation"
            className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-sm font-mono bg-admin-surface text-admin-text disabled:bg-admin-surface-2 disabled:text-admin-muted-2 focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors" />
        </div>
        <div>
          <label className="block text-admin-xs text-admin-text-2 font-medium mb-1.5">라벨 (화면 표시)</label>
          <input value={label} onChange={e => setLabel(e.target.value)}
            placeholder="예: 숙박"
            className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-admin-xs text-admin-text-2 font-medium mb-1.5">설명 (선택)</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="카테고리에 대한 간단한 설명"
            className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors" />
        </div>
        <div>
          <label className="block text-admin-xs text-admin-text-2 font-medium mb-1.5">범위</label>
          <select value={scope} onChange={e => setScope(e.target.value as any)}
            className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors">
            <option value="info">정보성 전용</option>
            <option value="product">상품 전용</option>
            <option value="both">공용</option>
          </select>
        </div>
        <div>
          <label className="block text-admin-xs text-admin-text-2 font-medium mb-1.5">표시 순서</label>
          <input type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value) || 0)}
            className="w-full h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors" />
        </div>
      </div>

      {error && <p className="text-admin-xs text-danger">{error}</p>}

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  );
}
