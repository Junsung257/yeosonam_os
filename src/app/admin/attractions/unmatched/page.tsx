'use client';
import { useState, useEffect, useCallback } from 'react';

interface UnmatchedItem {
  id: string;
  activity: string;
  package_id: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number;
  status: string;
  created_at: string;
}

export default function UnmatchedPage() {
  const [items, setItems] = useState<UnmatchedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ short_desc: '', country: '', region: '', badge_type: 'tour', emoji: '📍' });

  // 일괄 선택
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map(i => i.id)));
  };

  // 일괄 삭제 (ignored 처리)
  const bulkIgnore = async () => {
    if (!selectedIds.size || !confirm(`${selectedIds.size}건을 일괄 무시 처리하시겠습니까?`)) return;
    const ids = Array.from(selectedIds);
    setItems(prev => prev.filter(i => !selectedIds.has(i.id)));
    setSelectedIds(new Set());
    for (const id of ids) {
      await fetch('/api/unmatched', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'ignored' }),
      });
    }
  };

  // CSV 다운로드
  const downloadCSV = () => {
    const targetItems = selectedIds.size > 0 ? items.filter(i => selectedIds.has(i.id)) : items;
    const header = 'activity,package_title,day_number,country,region,occurrence_count,status\n';
    const rows = targetItems.map(i =>
      `"${(i.activity || '').replace(/"/g, '""')}","${i.package_title || ''}",${i.day_number || ''},"${i.country || ''}","${i.region || ''}",${i.occurrence_count},"${i.status}"`
    ).join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `미매칭_관광지_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 별칭 연결
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState<{ id: string; name: string; country: string | null; region: string | null }[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);

  // 검색 debounce
  useEffect(() => {
    if (!linkSearch || linkSearch.length < 2) { setLinkResults([]); return; }
    const timer = setTimeout(async () => {
      setLinkLoading(true);
      try {
        const res = await fetch(`/api/attractions?search=${encodeURIComponent(linkSearch)}&limit=5`);
        const json = await res.json();
        setLinkResults(json.attractions || []);
      } catch { setLinkResults([]); }
      finally { setLinkLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [linkSearch]);

  const linkAlias = async (unmatchedId: string, attractionId: string) => {
    try {
      const res = await fetch('/api/unmatched', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unmatchedId, action: 'link_alias', attractionId }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      alert(data.message);
      setLinkingId(null);
      setLinkSearch('');
      setLinkResults([]);
      load();
    } catch (err) {
      alert('연결 실패');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/unmatched?status=${statusFilter}`);
      const json = await res.json();
      setItems(json.items || []);
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (id: string, status: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await fetch('/api/unmatched', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
  };

  const addToAttractions = async (item: UnmatchedItem) => {
    await fetch('/api/attractions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: item.activity,
        short_desc: addForm.short_desc || null,
        country: addForm.country || item.country || null,
        region: addForm.region || item.region || null,
        badge_type: addForm.badge_type,
        emoji: addForm.emoji || null,
      }),
    });
    await changeStatus(item.id, 'added');
    setAddingId(null);
    setAddForm({ short_desc: '', country: '', region: '', badge_type: 'tour', emoji: '📍' });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">🔍 미매칭 관광지</h1>
          <p className="text-sm text-slate-500 mt-1">랜딩페이지에서 DB에 매칭되지 않은 관광지 목록입니다.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadCSV}
            className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
            CSV↓ {selectedIds.size > 0 ? `(${selectedIds.size}건)` : `(${items.length}건)`}
          </button>
          {selectedIds.size > 0 && (
            <button onClick={bulkIgnore}
              className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600">
              일괄 무시 ({selectedIds.size}건)
            </button>
          )}
          <a href="/admin/attractions" className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200">← 관광지 관리</a>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-4 items-center">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={selectedIds.size === items.length && items.length > 0}
            onChange={toggleSelectAll} className="rounded" />
          <span className="text-xs text-slate-500">전체</span>
        </label>
        {['pending', 'ignored', 'added', 'all'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setSelectedIds(new Set()); }}
            className={`px-3 py-1.5 text-sm rounded-lg ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {s === 'pending' ? '대기중' : s === 'ignored' ? '무시됨' : s === 'added' ? '추가됨' : '전체'}
          </button>
        ))}
        <span className="text-sm text-slate-500 self-center ml-auto">
          {selectedIds.size > 0 ? `${selectedIds.size}건 선택 / ` : ''}총 {items.length}건
        </span>
      </div>

      {loading ? <p className="text-slate-400 py-10 text-center">로딩 중...</p> : items.length === 0 ? (
        <p className="text-slate-400 py-10 text-center">미매칭 항목이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className={`bg-white border rounded-xl p-4 ${selectedIds.has(item.id) ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <input type="checkbox" checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)} className="rounded mt-1 flex-shrink-0" />
                  <div className="flex-1">
                  <h3 className="font-bold text-slate-800">{item.activity}</h3>
                  <div className="flex gap-3 mt-1 text-xs text-slate-400">
                    {item.package_title && <span>📦 {item.package_title}</span>}
                    {item.day_number && <span>Day {item.day_number}</span>}
                    {item.country && <span>🌍 {item.country}</span>}
                    {item.region && <span>📍 {item.region}</span>}
                    <span className="font-bold text-blue-600">등장 {item.occurrence_count}회</span>
                  </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setLinkingId(linkingId === item.id ? null : item.id); setAddingId(null); setLinkSearch(''); setLinkResults([]); }}
                    className="px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700">
                    {linkingId === item.id ? '접기' : '별칭 연결'}
                  </button>
                  <button onClick={() => { setAddingId(addingId === item.id ? null : item.id); setLinkingId(null); setAddForm(f => ({ ...f, country: item.country || '', region: item.region || '' })); }}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                    {addingId === item.id ? '접기' : 'DB 추가'}
                  </button>
                  <button onClick={() => changeStatus(item.id, 'ignored')}
                    className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200">무시</button>
                </div>
              </div>

              {/* 별칭 연결 패널 */}
              {linkingId === item.id && (
                <div className="mt-3 pt-3 border-t border-violet-100 bg-violet-50/50 rounded-lg p-3">
                  <p className="text-xs text-violet-700 mb-2 font-medium">
                    &quot;{item.activity}&quot;을(를) 기존 관광지의 별칭으로 연결합니다
                  </p>
                  <input
                    type="text"
                    value={linkSearch}
                    onChange={e => setLinkSearch(e.target.value)}
                    placeholder="관광지명 검색 (2글자 이상)..."
                    className="w-full text-sm border border-violet-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-violet-500 focus:outline-none"
                    autoFocus
                  />
                  {linkLoading && <p className="text-xs text-violet-400 mt-1">검색 중...</p>}
                  {linkResults.length > 0 && (
                    <div className="mt-2 border border-violet-200 rounded-lg overflow-hidden bg-white">
                      {linkResults.map(attr => (
                        <button key={attr.id}
                          onClick={() => linkAlias(item.id, attr.id)}
                          className="w-full text-left px-3 py-2 hover:bg-violet-50 border-b border-violet-50 last:border-0 flex items-center justify-between"
                        >
                          <span className="text-sm font-medium text-slate-800">{attr.name}</span>
                          <span className="text-[10px] text-slate-400">
                            {attr.country || ''} {attr.region || ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {linkSearch.length >= 2 && !linkLoading && linkResults.length === 0 && (
                    <p className="text-xs text-slate-400 mt-2">검색 결과가 없습니다.</p>
                  )}
                </div>
              )}

              {/* 추가 폼 */}
              {addingId === item.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-6 gap-2">
                  <input placeholder="설명" value={addForm.short_desc} onChange={e => setAddForm(f => ({ ...f, short_desc: e.target.value }))}
                    className="col-span-2 text-sm border rounded px-2 py-1.5" />
                  <input placeholder="국가" value={addForm.country} onChange={e => setAddForm(f => ({ ...f, country: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5" />
                  <input placeholder="지역" value={addForm.region} onChange={e => setAddForm(f => ({ ...f, region: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5" />
                  <select value={addForm.badge_type} onChange={e => setAddForm(f => ({ ...f, badge_type: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5">
                    <option value="tour">관광</option>
                    <option value="special">특전</option>
                    <option value="shopping">쇼핑</option>
                    <option value="meal">특식</option>
                    <option value="optional">선택관광</option>
                    <option value="hotel">숙소</option>
                  </select>
                  <input placeholder="이모지" value={addForm.emoji} onChange={e => setAddForm(f => ({ ...f, emoji: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5 w-16" />
                  <button onClick={() => addToAttractions(item)}
                    className="col-span-6 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
                    &quot;{item.activity}&quot; attractions DB에 추가
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
