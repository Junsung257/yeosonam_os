'use client';
import { useState, useEffect, useCallback } from 'react';

interface Attraction {
  id: string;
  name: string;
  short_desc: string | null;
  country: string | null;
  region: string | null;
  category: string | null;
  badge_type: string;
  emoji: string | null;
  mention_count: number;
  created_at: string;
}

const BADGE_OPTIONS = [
  { value: 'tour', label: '관광', color: 'bg-blue-100 text-blue-800' },
  { value: 'special', label: '특전', color: 'bg-cyan-100 text-cyan-800' },
  { value: 'shopping', label: '쇼핑', color: 'bg-purple-100 text-purple-800' },
  { value: 'meal', label: '특식', color: 'bg-amber-100 text-amber-800' },
];

export default function AttractionsPage() {
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ country: '', region: '', badge: '' });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', short_desc: '', country: '', region: '', badge_type: 'tour', emoji: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.country) params.set('country', filter.country);
      if (filter.region) params.set('region', filter.region);
      if (filter.badge) params.set('badge_type', filter.badge);
      const res = await fetch(`/api/attractions?${params}`);
      const json = await res.json();
      setAttractions(json.attractions || []);
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // 인라인 자동 저장: 셀 변경 → 즉시 API 호출 → 로컬 상태 업데이트
  const inlineSave = async (id: string, field: string, value: string) => {
    // 로컬 상태 즉시 업데이트 (낙관적 UI)
    setAttractions(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
    try {
      await fetch('/api/attractions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
    } catch { load(); } // 실패 시 리로드
  };

  // 신규 등록
  const addAttraction = async () => {
    if (!addForm.name.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/attractions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      setShowAdd(false);
      setAddForm({ name: '', short_desc: '', country: '', region: '', badge_type: 'tour', emoji: '' });
      load();
    } finally { setSaving(false); }
  };

  // 삭제
  const deleteAttraction = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await fetch(`/api/attractions?id=${id}`, { method: 'DELETE' });
    load();
  };

  // CSV 다운로드
  const downloadCsv = () => {
    const header = 'name,short_desc,country,region,badge_type,emoji\n';
    const rows = attractions.map(a =>
      `"${a.name}","${a.short_desc || ''}","${a.country || ''}","${a.region || ''}","${a.badge_type}","${a.emoji || ''}"`
    ).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'attractions.csv'; link.click();
  };

  // CSV 업로드
  const uploadCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').slice(1).filter(l => l.trim());
    const items = lines.map(line => {
      const cols = line.match(/(".*?"|[^,]+)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) || [];
      return { name: cols[0], short_desc: cols[1], country: cols[2], region: cols[3], badge_type: cols[4] || 'tour', emoji: cols[5] };
    }).filter(i => i.name);

    setSaving(true);
    try {
      await fetch('/api/attractions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      load();
    } finally { setSaving(false); e.target.value = ''; }
  };

  // 고유 국가/지역 목록
  const countries = [...new Set(attractions.map(a => a.country).filter(Boolean))] as string[];
  const regions = [...new Set(attractions.map(a => a.region).filter(Boolean))] as string[];
  const badgeStyle = (bt: string) => BADGE_OPTIONS.find(b => b.value === bt)?.color || 'bg-gray-100 text-gray-800';
  const badgeLabel = (bt: string) => BADGE_OPTIONS.find(b => b.value === bt)?.label || bt;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800">🌏 관광지 관리</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">+ 신규 등록</button>
          <button onClick={downloadCsv} className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200">CSV 다운로드</button>
          <label className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 cursor-pointer">
            CSV 업로드
            <input type="file" accept=".csv" onChange={uploadCsv} className="hidden" />
          </label>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-4">
        <select value={filter.country} onChange={e => setFilter(f => ({ ...f, country: e.target.value }))} className="text-sm border rounded-lg px-3 py-1.5">
          <option value="">전체 국가</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter.region} onChange={e => setFilter(f => ({ ...f, region: e.target.value }))} className="text-sm border rounded-lg px-3 py-1.5">
          <option value="">전체 지역</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filter.badge} onChange={e => setFilter(f => ({ ...f, badge: e.target.value }))} className="text-sm border rounded-lg px-3 py-1.5">
          <option value="">전체 배지</option>
          {BADGE_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <span className="text-sm text-slate-500 self-center">총 {attractions.length}건</span>
      </div>

      {/* 신규 등록 폼 */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <h3 className="font-bold text-blue-900 mb-3">신규 관광지 등록</h3>
          <div className="grid grid-cols-6 gap-2">
            <input placeholder="관광지명 *" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className="col-span-2 text-sm border rounded px-2 py-1.5" />
            <input placeholder="설명" value={addForm.short_desc} onChange={e => setAddForm(f => ({ ...f, short_desc: e.target.value }))} className="col-span-2 text-sm border rounded px-2 py-1.5" />
            <input placeholder="국가" value={addForm.country} onChange={e => setAddForm(f => ({ ...f, country: e.target.value }))} className="text-sm border rounded px-2 py-1.5" />
            <input placeholder="지역" value={addForm.region} onChange={e => setAddForm(f => ({ ...f, region: e.target.value }))} className="text-sm border rounded px-2 py-1.5" />
            <select value={addForm.badge_type} onChange={e => setAddForm(f => ({ ...f, badge_type: e.target.value }))} className="text-sm border rounded px-2 py-1.5">
              {BADGE_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            <input placeholder="이모지" value={addForm.emoji} onChange={e => setAddForm(f => ({ ...f, emoji: e.target.value }))} className="text-sm border rounded px-2 py-1.5" />
            <div className="col-span-4 flex gap-2">
              <button onClick={addAttraction} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">등록</button>
              <button onClick={() => setShowAdd(false)} className="px-3 py-1 bg-slate-200 text-sm rounded">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 테이블 */}
      {loading ? <p className="text-slate-400 py-10 text-center">로딩 중...</p> : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="py-2 px-3 font-semibold text-slate-600">이모지</th>
              <th className="py-2 px-3 font-semibold text-slate-600">관광지명</th>
              <th className="py-2 px-3 font-semibold text-slate-600">배지</th>
              <th className="py-2 px-3 font-semibold text-slate-600">설명</th>
              <th className="py-2 px-3 font-semibold text-slate-600">국가</th>
              <th className="py-2 px-3 font-semibold text-slate-600">지역</th>
              <th className="py-2 px-3 font-semibold text-slate-600 text-center">등장</th>
              <th className="py-2 px-3 font-semibold text-slate-600 text-center">액션</th>
            </tr>
          </thead>
          <tbody>
            {attractions.map(a => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="py-1.5 px-3">
                  <input defaultValue={a.emoji || ''} onBlur={e => { if (e.target.value !== (a.emoji || '')) inlineSave(a.id, 'emoji', e.target.value); }}
                    className="w-10 text-center text-lg bg-transparent hover:bg-white focus:bg-white focus:border-blue-300 border border-transparent rounded px-1 py-0.5 outline-none" />
                </td>
                <td className="py-1.5 px-3">
                  <input defaultValue={a.name} onBlur={e => { if (e.target.value !== a.name) inlineSave(a.id, 'name', e.target.value); }}
                    className="w-full font-medium text-slate-800 bg-transparent hover:bg-white focus:bg-white focus:border-blue-300 border border-transparent rounded px-2 py-0.5 outline-none" />
                </td>
                <td className="py-1.5 px-3">
                  <select value={a.badge_type} onChange={e => inlineSave(a.id, 'badge_type', e.target.value)}
                    className={`px-2 py-0.5 rounded-full text-xs font-bold border-0 cursor-pointer ${badgeStyle(a.badge_type)}`}>
                    {BADGE_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </td>
                <td className="py-1.5 px-3">
                  <input defaultValue={a.short_desc || ''} onBlur={e => { if (e.target.value !== (a.short_desc || '')) inlineSave(a.id, 'short_desc', e.target.value); }}
                    className="w-full text-xs text-slate-600 bg-transparent hover:bg-white focus:bg-white focus:border-blue-300 border border-transparent rounded px-2 py-0.5 outline-none" />
                </td>
                <td className="py-1.5 px-3">
                  <input defaultValue={a.country || ''} onBlur={e => { if (e.target.value !== (a.country || '')) inlineSave(a.id, 'country', e.target.value); }}
                    className="w-20 text-slate-500 bg-transparent hover:bg-white focus:bg-white focus:border-blue-300 border border-transparent rounded px-2 py-0.5 outline-none" />
                </td>
                <td className="py-1.5 px-3">
                  <input defaultValue={a.region || ''} onBlur={e => { if (e.target.value !== (a.region || '')) inlineSave(a.id, 'region', e.target.value); }}
                    className="w-20 text-slate-500 bg-transparent hover:bg-white focus:bg-white focus:border-blue-300 border border-transparent rounded px-2 py-0.5 outline-none" />
                </td>
                <td className="py-1.5 px-3 text-center text-slate-500">{a.mention_count}</td>
                <td className="py-1.5 px-3 text-center">
                  <button onClick={() => deleteAttraction(a.id)} className="text-red-400 hover:text-red-600 text-xs">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
