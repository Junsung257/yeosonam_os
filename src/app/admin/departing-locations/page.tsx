'use client';

import { useState } from 'react';
import { useLocations, type Location } from '@/hooks/useLocations';

export default function DepartingLocationsPage() {
  const { all, loading, softDelete, restore, addLocation, updateLocation } = useLocations(true);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // 인라인 에디트 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const loc = await addLocation(newName.trim());
    setSaving(false);
    if (loc) {
      setNewName('');
      showToast('success', `${loc.name} 추가됨`);
    } else {
      showToast('error', '추가 실패 - 다시 시도해주세요.');
    }
  };

  const startEdit = (l: Location) => {
    setEditingId(l.id);
    setEditName(l.name);
  };

  const handleUpdate = async () => {
    if (!editingId || !editName.trim()) return;
    setEditSaving(true);
    const ok = await updateLocation(editingId, editName.trim());
    setEditSaving(false);
    setEditingId(null);
    showToast(ok ? 'success' : 'error', ok ? '수정됨' : '수정 실패');
  };

  const active = all.filter(l => l.is_active);
  const inactive = all.filter(l => !l.is_active);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-[16px] font-semibold text-slate-800">지역/출발지 관리</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">
          비활성화된 출발지는 예약 드롭다운에서 숨겨지지만 기존 예약 기록은 유지됩니다.
          이름을 수정하려면 해당 셀을 클릭하세요.
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
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h2 className="text-[14px] font-semibold text-slate-800 mb-3">신규 출발지 추가</h2>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="출발지명 (예: 제주, 김포)"
            className="flex-1 border border-slate-200 rounded px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newName.trim()}
            className="px-4 py-2 bg-[#001f3f] text-white rounded text-[13px] font-medium hover:bg-blue-900 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {saving ? '추가 중...' : '+ 추가'}
          </button>
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <p className="text-slate-500 text-[13px]">로딩 중...</p>
      ) : all.length === 0 ? (
        <p className="text-slate-500 text-[13px]">등록된 출발지가 없습니다.</p>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-slate-500">출발지명</th>
                <th className="px-3 py-2 text-center text-[11px] font-medium text-slate-500">상태</th>
                <th className="px-3 py-2 text-center text-[11px] font-medium text-slate-500">액션</th>
              </tr>
            </thead>
            <tbody>
              {all.map(l => (
                <tr key={l.id} className={`border-b border-slate-200 transition-colors ${l.is_active ? 'hover:bg-slate-50' : 'bg-red-50/30'}`}>
                  {/* 이름 셀 -- 클릭 시 인라인 에디트 */}
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {editingId === l.id ? (
                      <div className="flex gap-1">
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="border border-blue-400 rounded px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={handleUpdate}
                          disabled={editSaving}
                          className="px-2 py-1 bg-[#001f3f] text-white rounded text-[11px] hover:bg-blue-900 disabled:opacity-50"
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
                      <button
                        onClick={() => startEdit(l)}
                        className="text-left hover:text-blue-600 group flex items-center gap-1"
                        title="클릭하여 수정"
                      >
                        {l.name}
                        <span className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-500">edit</span>
                      </button>
                    )}
                  </td>
                  {/* 상태 */}
                  <td className="px-3 py-2 text-center">
                    {l.is_active
                      ? <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-[11px] font-medium">활성</span>
                      : <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-[11px] font-medium">비활성</span>
                    }
                  </td>
                  {/* 액션 */}
                  <td className="px-3 py-2 text-center">
                    {editingId === l.id ? null : l.is_active ? (
                      <button
                        onClick={async () => {
                          const ok = await softDelete(l.id);
                          showToast(ok ? 'success' : 'error', ok ? `${l.name} 비활성화됨` : '처리 실패');
                        }}
                        className="px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded text-[11px] hover:bg-slate-50 transition-colors"
                      >
                        비활성화
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          const ok = await restore(l.id);
                          showToast(ok ? 'success' : 'error', ok ? `${l.name} 복구됨` : '처리 실패');
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
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg border text-[13px] font-medium z-50 transition-all
          ${toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
