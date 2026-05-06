'use client';

import { useState } from 'react';
import { useVendors, type Vendor } from '@/hooks/useVendors';

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
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-admin-lg font-semibold text-slate-800">랜드사 관리</h1>
        <p className="text-admin-sm text-slate-500 mt-0.5">
          비활성화된 랜드사는 상품 드롭다운에서 숨겨지지만 기존 연결 기록은 유지됩니다.
          이름/연락처를 수정하려면 해당 셀을 클릭하세요.
        </p>
      </div>

      {/* 통계 배지 */}
      <div className="flex gap-3">
        <span className="px-3 py-1 bg-green-50 text-green-700 rounded text-[11px] font-medium">
          활성 {active.length}개
        </span>
        {inactive.length > 0 && (
          <span className="px-3 py-1 bg-red-50 text-red-600 rounded text-[11px] font-medium">
            비활성 {inactive.length}개
          </span>
        )}
      </div>

      {/* 신규 추가 폼 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
        <h2 className="text-admin-base font-semibold text-slate-800 mb-3">신규 랜드사 추가</h2>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="랜드사명 *"
            className="flex-1 border border-slate-200 rounded px-3 py-2 text-admin-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            value={newContact}
            onChange={e => setNewContact(e.target.value)}
            placeholder="담당자 연락처 (선택)"
            className="w-52 border border-slate-200 rounded px-3 py-2 text-admin-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded text-admin-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {saving ? '추가 중...' : '+ 추가'}
          </button>
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-admin-sm">
            <thead>
              <tr className="border-b-2 border-slate-100">
                {['랜드사명', '연락처', '상태', '액션'].map(h => (
                  <th key={h} className="px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-50">
                  {[120, 100, 48, 64].map((w, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-3 bg-slate-100 rounded animate-pulse" style={{ width: w }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : all.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14">
          <svg className="w-10 h-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>
          <p className="text-admin-sm font-medium text-slate-500">등록된 랜드사가 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-admin-sm">
            <thead>
              <tr className="border-b-2 border-slate-100">
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80">랜드사명</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80">연락처</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80">상태</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80">액션</th>
              </tr>
            </thead>
            <tbody>
              {all.map(v => (
                <tr key={v.id} className={`border-b border-slate-200 transition-colors ${v.is_active ? 'hover:bg-slate-50' : 'bg-red-50/30'}`}>
                  {/* 이름 셀 -- 클릭 시 인라인 에디트 */}
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {editingId === v.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleUpdate();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="border border-blue-400 rounded px-2 py-1 text-admin-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(v)}
                        className="text-left hover:text-blue-600 w-full group flex items-center gap-1"
                        title="클릭하여 수정"
                      >
                        {v.name}
                        <span className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-500">edit</span>
                      </button>
                    )}
                  </td>
                  {/* 연락처 셀 */}
                  <td className="px-3 py-2 text-slate-500 text-admin-sm">
                    {editingId === v.id ? (
                      <div className="flex gap-1">
                        <input
                          value={editContact}
                          onChange={e => setEditContact(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          placeholder="연락처"
                          className="border border-blue-400 rounded px-2 py-1 text-admin-sm w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={handleUpdate}
                          disabled={editSaving}
                          className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] hover:bg-blue-700 disabled:opacity-50"
                        >
                          {editSaving ? '...' : '저장'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 bg-white border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer hover:text-blue-600"
                        onClick={() => startEdit(v)}
                        title="클릭하여 수정"
                      >
                        {v.contact || '-'}
                      </span>
                    )}
                  </td>
                  {/* 상태 */}
                  <td className="px-3 py-2 text-center">
                    {v.is_active
                      ? <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-[11px] font-medium">활성</span>
                      : <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-[11px] font-medium">비활성</span>
                    }
                  </td>
                  {/* 액션 */}
                  <td className="px-3 py-2 text-center">
                    {editingId === v.id ? null : v.is_active ? (
                      <button
                        onClick={async () => {
                          const ok = await softDelete(v.id);
                          showToast(ok ? 'success' : 'error', ok ? `${v.name} 비활성화됨` : '처리 실패');
                        }}
                        className="px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50 transition-colors"
                      >
                        비활성화
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          const ok = await restore(v.id);
                          showToast(ok ? 'success' : 'error', ok ? `${v.name} 복구됨` : '처리 실패');
                        }}
                        className="px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50 transition-colors"
                      >
                        복구
                      </button>
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
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg border text-admin-sm font-medium z-50 transition-all
          ${toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
