'use client';

import { useState } from 'react';
import { useVendors, type Vendor } from '@/hooks/useVendors';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Plus, Building2 } from 'lucide-react';

export default function LandOperatorsPage() {
  const { all, loading, softDelete, restore, addVendor, updateVendor } = useVendors(true);
  const [newName, setNewName] = useState('');
  const [newContact, setNewContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // 인라인 에디트 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContact, setEditContact] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const op = await addVendor(newName.trim(), newContact.trim() || undefined);
    setSaving(false);
    if (op) {
      setNewName('');
      setNewContact('');
      showToast('success', `${op.name} 추가됨`);
    } else {
      showToast('error', '추가 실패 - 다시 시도해주세요.');
    }
  };

  const startEdit = (v: Vendor) => {
    setEditingId(v.id);
    setEditName(v.name);
    setEditContact(v.contact ?? '');
  };

  const handleUpdate = async () => {
    if (!editingId || !editName.trim()) return;
    setEditSaving(true);
    const ok = await updateVendor(editingId, editName.trim(), editContact.trim() || null);
    setEditSaving(false);
    setEditingId(null);
    showToast(ok ? 'success' : 'error', ok ? '수정됨' : '수정 실패');
  };

  const active = all.filter(v => v.is_active);
  const inactive = all.filter(v => !v.is_active);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader
        title="랜드사 관리"
        subtitle="비활성화된 랜드사는 상품 드롭다운에서 숨겨지지만 기존 연결 기록은 유지됩니다. 이름/연락처를 수정하려면 해당 셀을 클릭하세요."
        badge={
          <span className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 bg-status-successBg text-status-successFg rounded-admin-xs text-admin-xs font-semibold">
              활성 <span className="admin-num">{active.length}</span>
            </span>
            {inactive.length > 0 && (
              <span className="px-2 py-0.5 bg-status-dangerBg text-status-dangerFg rounded-admin-xs text-admin-xs font-semibold">
                비활성 <span className="admin-num">{inactive.length}</span>
              </span>
            )}
          </span>
        }
      />

      {/* 신규 추가 폼 */}
      <div className="admin-card p-4">
        <h2 className="text-admin-h3 text-admin-text mb-3">신규 랜드사 추가</h2>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="랜드사명 *"
            className="flex-1 h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base text-admin-text bg-admin-surface focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
          <input
            value={newContact}
            onChange={e => setNewContact(e.target.value)}
            placeholder="담당자 연락처 (선택)"
            className="w-52 h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base text-admin-text bg-admin-surface focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
          <Button variant="primary" onClick={handleAdd} disabled={saving || !newName.trim()}>
            <Plus size={14} />
            {saving ? '추가 중…' : '추가'}
          </Button>
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <table className="admin-data-table">
            <thead>
              <tr>
                {['랜드사명', '연락처', '상태', '액션'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {[120, 100, 48, 64].map((w, j) => (
                    <td key={j}>
                      <div className="h-3 bg-admin-surface-2 rounded animate-pulse" style={{ width: w }} />
                      <span className="sr-only">랜드사 정보 로딩 중</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : all.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 bg-admin-surface rounded-admin-md border border-admin-border-mid">
          <div className="w-12 h-12 rounded-full bg-admin-surface-2 flex items-center justify-center text-admin-muted">
            <Building2 size={20} strokeWidth={1.75} />
          </div>
          <p className="text-admin-sm font-medium text-admin-muted">등록된 랜드사가 없습니다.</p>
        </div>
      ) : (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>랜드사명</th>
                <th>연락처</th>
                <th className="text-center">상태</th>
                <th className="text-center">액션</th>
              </tr>
            </thead>
            <tbody>
              {all.map(v => (
                <tr key={v.id} className={v.is_active ? '' : 'opacity-60'}>
                  {/* 이름 셀 */}
                  <td className="font-medium text-admin-text">
                    {editingId === v.id ? (
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleUpdate();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="h-8 border border-brand rounded-admin-sm px-2 text-admin-sm w-full bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus"
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(v)}
                        className="text-left hover:text-brand w-full group flex items-center gap-1.5 transition-colors"
                        title="클릭하여 수정"
                      >
                        {v.name}
                        <span className="opacity-0 group-hover:opacity-100 text-admin-2xs text-admin-muted-2 uppercase tracking-wider">edit</span>
                      </button>
                    )}
                  </td>
                  {/* 연락처 셀 */}
                  <td className="text-admin-muted text-admin-sm">
                    {editingId === v.id ? (
                      <div className="flex gap-1.5">
                        <input
                          value={editContact}
                          onChange={e => setEditContact(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          placeholder="연락처"
                          className="h-8 border border-brand rounded-admin-sm px-2 text-admin-sm w-32 bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus"
                        />
                        <Button variant="primary" size="sm" onClick={handleUpdate} disabled={editSaving}>
                          {editSaving ? '…' : '저장'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                          취소
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-left hover:text-brand transition-colors"
                        onClick={() => startEdit(v)}
                        title="클릭하여 수정"
                      >
                        {v.contact || '—'}
                      </button>
                    )}
                  </td>
                  {/* 상태 */}
                  <td className="text-center">
                    {v.is_active
                      ? <span className="px-2 py-0.5 bg-status-successBg text-status-successFg rounded-admin-xs text-admin-xs font-semibold">활성</span>
                      : <span className="px-2 py-0.5 bg-status-dangerBg text-status-dangerFg rounded-admin-xs text-admin-xs font-semibold">비활성</span>
                    }
                  </td>
                  {/* 액션 */}
                  <td className="text-center">
                    {editingId === v.id ? null : v.is_active ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          const ok = await softDelete(v.id);
                          showToast(ok ? 'success' : 'error', ok ? `${v.name} 비활성화됨` : '처리 실패');
                        }}
                      >
                        비활성화
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          const ok = await restore(v.id);
                          showToast(ok ? 'success' : 'error', ok ? `${v.name} 복구됨` : '처리 실패');
                        }}
                      >
                        복구
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-admin-sm shadow-admin-md text-admin-sm font-medium z-50 transition-all
          ${toast.type === 'success' ? 'bg-success text-white' : 'bg-danger text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
