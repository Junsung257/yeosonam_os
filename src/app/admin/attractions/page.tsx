'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

interface PhotoItem { pexels_id: number; src_medium: string; src_large: string; photographer: string; alt?: string; }

interface Attraction {
  id: string;
  name: string;
  short_desc: string | null;
  long_desc: string | null;
  country: string | null;
  region: string | null;
  category: string | null;
  badge_type: string;
  emoji: string | null;
  aliases: string[];
  photos: PhotoItem[];
  mention_count: number;
  created_at: string;
}

const BADGE_OPTIONS = [
  { value: 'tour', label: '관광', color: 'bg-blue-100 text-blue-700', icon: '📍' },
  { value: 'special', label: '특전', color: 'bg-cyan-100 text-cyan-700', icon: '⭐' },
  { value: 'shopping', label: '쇼핑', color: 'bg-purple-100 text-purple-700', icon: '🛍️' },
  { value: 'meal', label: '특식', color: 'bg-amber-100 text-amber-700', icon: '🍽️' },
  { value: 'optional', label: '선택관광', color: 'bg-pink-100 text-pink-700', icon: '💎' },
  { value: 'hotel', label: '숙소', color: 'bg-indigo-100 text-indigo-700', icon: '🏨' },
  { value: 'restaurant', label: '식당', color: 'bg-orange-100 text-orange-700', icon: '🥘' },
  { value: 'golf', label: '골프', color: 'bg-green-100 text-green-700', icon: '⛳' },
];

export default function AttractionsPage() {
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ country: '', region: '', badge: '', search: '' });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', short_desc: '', long_desc: '', country: '', region: '', badge_type: 'tour', emoji: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [photoPanel, setPhotoPanel] = useState<{ id: string; results: PhotoItem[]; keyword: string; searching: boolean } | null>(null);
  const [autoPhotoProgress, setAutoPhotoProgress] = useState<{ current: number; total: number } | null>(null);
  const [displayCount, setDisplayCount] = useState(50); // 페이지네이션: 50개씩

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
  }, [filter.country, filter.region, filter.badge]);

  useEffect(() => { load(); }, [load]);

  // 검색 필터 적용
  const filtered = filter.search
    ? attractions.filter(a =>
        a.name.includes(filter.search) ||
        (a.short_desc || '').includes(filter.search) ||
        (a.country || '').includes(filter.search) ||
        (a.region || '').includes(filter.search))
    : attractions;

  // 인라인 저장
  const inlineSave = async (id: string, field: string, value: string | string[]) => {
    setAttractions(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
    try {
      await fetch('/api/attractions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
    } catch { load(); }
  };

  // 신규 등록
  const addAttraction = async () => {
    if (!addForm.name.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/attractions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      setShowAdd(false);
      setAddForm({ name: '', short_desc: '', long_desc: '', country: '', region: '', badge_type: 'tour', emoji: '' });
      load();
    } finally { setSaving(false); }
  };

  // 삭제
  const deleteAttraction = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await fetch(`/api/attractions?id=${id}`, { method: 'DELETE' });
    setAttractions(prev => prev.filter(a => a.id !== id));
  };

  // ── 사진 관리 ──
  const searchPhotos = async (id: string, keyword: string) => {
    setPhotoPanel(p => p ? { ...p, searching: true } : { id, results: [], keyword, searching: true });
    try {
      const res = await fetch('/api/attractions/photos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, per_page: 10 }),
      });
      const data = await res.json();
      setPhotoPanel(p => ({ id, results: data.photos || [], keyword, searching: false }));
    } catch { setPhotoPanel(p => p ? { ...p, searching: false } : p); }
  };

  const addPhotoToAttraction = async (attractionId: string, photo: PhotoItem) => {
    const a = attractions.find(x => x.id === attractionId);
    if (!a) return;
    if (a.photos?.some(p => p.pexels_id === photo.pexels_id)) return;
    const updated = [...(a.photos || []), photo].slice(0, 5);
    setAttractions(prev => prev.map(x => x.id === attractionId ? { ...x, photos: updated } : x));
    await fetch('/api/attractions/photos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: attractionId, photos: updated }),
    });
  };

  const removePhoto = async (attractionId: string, pexelsId: number) => {
    const a = attractions.find(x => x.id === attractionId);
    if (!a) return;
    const updated = (a.photos || []).filter(p => p.pexels_id !== pexelsId);
    setAttractions(prev => prev.map(x => x.id === attractionId ? { ...x, photos: updated } : x));
    await fetch('/api/attractions/photos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: attractionId, photos: updated }),
    });
  };

  // ── 사진 일괄 자동 생성 ──
  const autoGeneratePhotos = async () => {
    const noPhotos = attractions.filter(a => !a.photos || a.photos.length === 0);
    if (noPhotos.length === 0) { alert('사진 없는 관광지가 없습니다.'); return; }
    if (!confirm(`사진 없는 ${noPhotos.length}개 관광지에 자동으로 Pexels 사진을 추가합니다.\n(Pexels 무료: 200건/시간)\n진행하시겠습니까?`)) return;

    setAutoPhotoProgress({ current: 0, total: noPhotos.length });
    for (let i = 0; i < noPhotos.length; i++) {
      const a = noPhotos[i];
      setAutoPhotoProgress({ current: i + 1, total: noPhotos.length });
      try {
        const keyword = `${a.name} ${a.region || a.country || ''} travel`.trim();
        const res = await fetch('/api/attractions/photos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, per_page: 3 }),
        });
        const data = await res.json();
        const photos = (data.photos || []).slice(0, 3);
        if (photos.length > 0) {
          await fetch('/api/attractions/photos', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: a.id, photos }),
          });
          setAttractions(prev => prev.map(x => x.id === a.id ? { ...x, photos } : x));
        }
        // Rate limit: 200 req/hour → 간격 두기
        if (i < noPhotos.length - 1) await new Promise(r => setTimeout(r, 400));
      } catch { /* skip */ }
    }
    setAutoPhotoProgress(null);
  };

  // CSV
  const downloadCsv = () => {
    const header = 'name,short_desc,long_desc,country,region,badge_type,emoji\n';
    const rows = attractions.map(a =>
      `"${a.name}","${a.short_desc || ''}","${(a.long_desc || '').replace(/"/g, '""')}","${a.country || ''}","${a.region || ''}","${a.badge_type}","${a.emoji || ''}"`
    ).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'attractions.csv'; link.click();
  };

  const uploadCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    // 멀티라인 CSV 파싱: long_desc에 줄바꿈이 포함될 수 있음
    const parseCsvFull = (csv: string): string[][] => {
      const rows: string[][] = [];
      let current = '';
      let inQuotes = false;
      const row: string[] = [];
      for (let i = 0; i < csv.length; i++) {
        const ch = csv[i];
        if (ch === '"') {
          if (inQuotes && csv[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
          row.push(current); current = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
          if (ch === '\r' && csv[i + 1] === '\n') i++;
          row.push(current); current = '';
          if (row.some(c => c.trim())) rows.push([...row]);
          row.length = 0;
        } else {
          current += ch;
        }
      }
      row.push(current);
      if (row.some(c => c.trim())) rows.push(row);
      return rows;
    };
    const allRows = parseCsvFull(text);
    const dataRows = allRows.slice(1); // 헤더 제외
    // header: name,short_desc,long_desc,country,region,badge_type,emoji
    const items = dataRows.map(cols => ({
      name: (cols[0] || '').trim(),
      short_desc: (cols[1] || '').trim(),
      long_desc: (cols[2] || '').trim() || null,
      country: (cols[3] || '').trim(),
      region: (cols[4] || '').trim(),
      badge_type: (cols[5] || 'tour').trim(),
      emoji: (cols[6] || '').trim(),
    })).filter(i => i.name);
    setSaving(true);
    try { await fetch('/api/attractions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }); load(); }
    finally { setSaving(false); e.target.value = ''; }
  };

  const countries = [...new Set(attractions.map(a => a.country).filter(Boolean))] as string[];
  const regions = [...new Set(attractions.map(a => a.region).filter(Boolean))] as string[];
  const badgeStyle = (bt: string) => BADGE_OPTIONS.find(b => b.value === bt)?.color || 'bg-gray-100 text-gray-800';
  const badgeLabel = (bt: string) => BADGE_OPTIONS.find(b => b.value === bt)?.label || bt;
  const photoCount = attractions.filter(a => a.photos?.length > 0).length;
  const noPhotoCount = attractions.filter(a => !a.photos || a.photos.length === 0).length;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      {/* 헤더 */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">🌏 관광지 관리</h1>
          <p className="text-xs text-slate-400 mt-1">
            총 {attractions.length}개 | 사진 {photoCount}개 완료 | 사진 미등록 {noPhotoCount}개
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={autoGeneratePhotos} disabled={!!autoPhotoProgress}
            className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs font-bold rounded-lg hover:opacity-90 disabled:opacity-50">
            {autoPhotoProgress ? `📷 ${autoPhotoProgress.current}/${autoPhotoProgress.total}` : `📷 사진 일괄생성 (${noPhotoCount}개)`}
          </button>
          <a href="/admin/attractions/unmatched" className="px-3 py-1.5 bg-amber-100 text-amber-800 text-xs font-bold rounded-lg hover:bg-amber-200">🔍 미매칭</a>
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">+ 신규</button>
          <button onClick={downloadCsv} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200">CSV↓</button>
          <label className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200 cursor-pointer">
            CSV↑<input type="file" accept=".csv" onChange={uploadCsv} className="hidden" />
          </label>
        </div>
      </div>

      {/* 자동생성 프로그레스 */}
      {autoPhotoProgress && (
        <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-bold text-purple-800">📷 Pexels 사진 자동 생성 중...</span>
            <span className="text-xs text-purple-600">{autoPhotoProgress.current} / {autoPhotoProgress.total}</span>
          </div>
          <div className="w-full bg-purple-200 rounded-full h-2">
            <div className="bg-purple-600 h-2 rounded-full transition-all" style={{ width: `${(autoPhotoProgress.current / autoPhotoProgress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* 필터 + 검색 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
          placeholder="🔍 관광지명, 국가, 지역 검색..." className="flex-1 min-w-[200px] text-sm border rounded-lg px-3 py-2" />
        <select value={filter.country} onChange={e => setFilter(f => ({ ...f, country: e.target.value }))} className="text-sm border rounded-lg px-3 py-2">
          <option value="">전체 국가</option>
          {countries.sort().map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter.region} onChange={e => setFilter(f => ({ ...f, region: e.target.value }))} className="text-sm border rounded-lg px-3 py-2">
          <option value="">전체 지역</option>
          {regions.sort().map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filter.badge} onChange={e => setFilter(f => ({ ...f, badge: e.target.value }))} className="text-sm border rounded-lg px-3 py-2">
          <option value="">전체 배지</option>
          {BADGE_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.icon} {b.label}</option>)}
        </select>
        <span className="text-xs text-slate-400 self-center">{filtered.length}건</span>
      </div>

      {/* 신규 등록 폼 */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
          <h3 className="font-bold text-blue-900 mb-3">신규 관광지 등록</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input placeholder="관광지명 *" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className="text-sm border rounded-lg px-3 py-2" />
            <input placeholder="한줄 설명" value={addForm.short_desc} onChange={e => setAddForm(f => ({ ...f, short_desc: e.target.value }))} className="text-sm border rounded-lg px-3 py-2" />
            <div className="flex gap-2">
              <input placeholder="국가" value={addForm.country} onChange={e => setAddForm(f => ({ ...f, country: e.target.value }))} className="flex-1 text-sm border rounded-lg px-3 py-2" />
              <input placeholder="지역" value={addForm.region} onChange={e => setAddForm(f => ({ ...f, region: e.target.value }))} className="flex-1 text-sm border rounded-lg px-3 py-2" />
            </div>
            <textarea placeholder="상세 설명 (long_desc)" value={addForm.long_desc} onChange={e => setAddForm(f => ({ ...f, long_desc: e.target.value }))}
              rows={2} className="md:col-span-2 text-sm border rounded-lg px-3 py-2 resize-none" />
            <div className="flex gap-2">
              <select value={addForm.badge_type} onChange={e => setAddForm(f => ({ ...f, badge_type: e.target.value }))} className="flex-1 text-sm border rounded-lg px-3 py-2">
                {BADGE_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.icon} {b.label}</option>)}
              </select>
              <input placeholder="이모지" value={addForm.emoji} onChange={e => setAddForm(f => ({ ...f, emoji: e.target.value }))} className="w-16 text-sm border rounded-lg px-3 py-2 text-center" />
            </div>
            <div className="md:col-span-3 flex gap-2">
              <button onClick={addAttraction} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">등록</button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 bg-slate-200 text-sm rounded-lg">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 카드 리스트 */}
      {loading ? <p className="text-slate-400 py-16 text-center">로딩 중...</p> : (
        <div className="space-y-3">
          {filtered.slice(0, displayCount).map(a => {
            const isExpanded = expandedId === a.id;
            const isPhotoOpen = photoPanel?.id === a.id;
            return (
              <div key={a.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-sm transition">
                {/* 메인 행 */}
                <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : a.id)}>
                  {/* 사진 썸네일 */}
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
                    {a.photos?.length > 0 ? (
                      <img src={a.photos[0].src_medium} alt={a.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl">{a.emoji || '📍'}</span>
                    )}
                  </div>

                  {/* 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-800 text-sm">{a.emoji} {a.name}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeStyle(a.badge_type)}`}>{badgeLabel(a.badge_type)}</span>
                      {a.photos?.length > 0 && <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">📷{a.photos.length}</span>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{a.short_desc || '설명 없음'}</p>
                    <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
                      <span>🌍 {a.country || '-'}</span>
                      <span>📍 {a.region || '-'}</span>
                      <span>등장 {a.mention_count}회</span>
                    </div>
                  </div>

                  {/* 확장 아이콘 */}
                  <span className="text-slate-300 text-lg shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* 확장 패널 */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-4">
                    {/* 사진 관리 */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold text-slate-600">📷 사진 ({a.photos?.length || 0}/5)</h4>
                        <button onClick={(e) => { e.stopPropagation(); setPhotoPanel(isPhotoOpen ? null : { id: a.id, results: [], keyword: `${a.name} ${a.region || ''} travel`, searching: false }); }}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200">
                          {isPhotoOpen ? '닫기' : '+ 사진 추가/변경'}
                        </button>
                      </div>
                      {/* 현재 사진 */}
                      {a.photos?.length > 0 ? (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {a.photos.map(p => (
                            <div key={p.pexels_id} className="relative shrink-0 group">
                              <img src={p.src_medium} alt="" className="w-28 h-20 object-cover rounded-lg" />
                              <button onClick={(e) => { e.stopPropagation(); removePhoto(a.id, p.pexels_id); }}
                                className="absolute top-1 right-1 w-5 h-5 bg-red-500/80 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition">×</button>
                              <p className="text-[8px] text-slate-400 mt-0.5 truncate w-28">📸 {p.photographer}</p>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-slate-400">사진 없음 — 위 버튼으로 추가하세요</p>}

                      {/* Pexels 검색 패널 */}
                      {isPhotoOpen && photoPanel && (
                        <div className="mt-3 bg-white border border-blue-200 rounded-xl p-3">
                          <div className="flex gap-2 mb-3">
                            <input value={photoPanel.keyword} onChange={e => setPhotoPanel(p => p ? { ...p, keyword: e.target.value } : p)}
                              onKeyDown={e => { if (e.key === 'Enter') searchPhotos(a.id, photoPanel.keyword); }}
                              className="flex-1 border rounded-lg px-3 py-1.5 text-sm" placeholder="Pexels 검색 키워드" />
                            <button onClick={() => searchPhotos(a.id, photoPanel.keyword)} disabled={photoPanel.searching}
                              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                              {photoPanel.searching ? '...' : '검색'}
                            </button>
                          </div>
                          {photoPanel.results.length > 0 && (
                            <div className="grid grid-cols-5 gap-2">
                              {photoPanel.results.map(p => {
                                const already = a.photos?.some(x => x.pexels_id === p.pexels_id);
                                return (
                                  <div key={p.pexels_id} onClick={() => !already && addPhotoToAttraction(a.id, p)}
                                    className={`cursor-pointer rounded-lg overflow-hidden border-2 transition ${already ? 'border-green-400 opacity-60' : 'border-transparent hover:border-blue-400'}`}>
                                    <img src={p.src_medium} alt={p.alt || ''} className="w-full h-16 object-cover" />
                                    <p className="text-[8px] text-slate-400 px-1 truncate">{already ? '✅ 추가됨' : `📸 ${p.photographer}`}</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 기본 정보 편집 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 mb-1 block">관광지명</label>
                        <input defaultValue={a.name} onBlur={e => { if (e.target.value !== a.name) inlineSave(a.id, 'name', e.target.value); }}
                          className="w-full text-sm border rounded-lg px-3 py-2" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 mb-1 block">한줄 설명</label>
                        <input defaultValue={a.short_desc || ''} onBlur={e => { if (e.target.value !== (a.short_desc || '')) inlineSave(a.id, 'short_desc', e.target.value); }}
                          className="w-full text-sm border rounded-lg px-3 py-2" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-[10px] font-bold text-slate-500 mb-1 block">상세 설명 (long_desc)</label>
                        <textarea defaultValue={a.long_desc || ''} onBlur={e => { if (e.target.value !== (a.long_desc || '')) inlineSave(a.id, 'long_desc', e.target.value); }}
                          rows={3} className="w-full text-sm border rounded-lg px-3 py-2 resize-none" />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-slate-500 mb-1 block">국가</label>
                          <input defaultValue={a.country || ''} onBlur={e => { if (e.target.value !== (a.country || '')) inlineSave(a.id, 'country', e.target.value); }}
                            className="w-full text-sm border rounded-lg px-3 py-2" />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-slate-500 mb-1 block">지역</label>
                          <input defaultValue={a.region || ''} onBlur={e => { if (e.target.value !== (a.region || '')) inlineSave(a.id, 'region', e.target.value); }}
                            className="w-full text-sm border rounded-lg px-3 py-2" />
                        </div>
                        <div className="w-20">
                          <label className="text-[10px] font-bold text-slate-500 mb-1 block">이모지</label>
                          <input defaultValue={a.emoji || ''} onBlur={e => { if (e.target.value !== (a.emoji || '')) inlineSave(a.id, 'emoji', e.target.value); }}
                            className="w-full text-sm border rounded-lg px-3 py-2 text-center" />
                        </div>
                      </div>
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-slate-500 mb-1 block">배지 타입</label>
                          <select value={a.badge_type} onChange={e => inlineSave(a.id, 'badge_type', e.target.value)}
                            className="w-full text-sm border rounded-lg px-3 py-2">
                            {BADGE_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.icon} {b.label}</option>)}
                          </select>
                        </div>
                        <button onClick={() => deleteAttraction(a.id)} className="px-3 py-2 bg-red-50 text-red-500 text-xs rounded-lg hover:bg-red-100">삭제</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {/* 더보기 버튼 */}
          {filtered.length > displayCount && (
            <button onClick={() => setDisplayCount(c => c + 50)}
              className="w-full py-3 bg-slate-100 text-slate-600 text-sm rounded-xl hover:bg-slate-200 font-medium">
              더보기 ({displayCount}/{filtered.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
