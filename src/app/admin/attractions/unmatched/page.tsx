'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';

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

interface UnmatchedSummary {
  counts: { pending: number; ignored: number; added: number; all: number };
  pending_high_occurrence: number;
  auto_alias_resolved_total: number;
  manual_link_alias_total: number;
  high_occurrence_threshold: number;
  recent_auto_alias: Array<{
    id: string;
    activity: string;
    resolved_at: string | null;
    resolved_attraction_id: string | null;
    occurrence_count: number | null;
  }>;
}

interface BootstrapCandidate {
  id: string;
  activity: string;
  occurrence_count: number | null;
  region: string | null;
  country: string | null;
  suggestion: {
    id: string;
    name: string;
    score: number;
    matched_via: string;
    matched_term: string;
  } | null;
}

export default function UnmatchedPage() {
  const [items, setItems] = useState<UnmatchedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [summary, setSummary] = useState<UnmatchedSummary | null>(null);
  const [highFreqOnly, setHighFreqOnly] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapCandidates, setBootstrapCandidates] = useState<BootstrapCandidate[]>([]);
  const [bootstrapMeta, setBootstrapMeta] = useState<{
    min_occurrences: number;
    score_min: number;
    score_max: number;
  } | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ short_desc: '', country: '', region: '', badge_type: 'tour', emoji: '📍' });

  const occThreshold = summary?.high_occurrence_threshold ?? 3;

  const displayedItems = useMemo(
    () => (highFreqOnly ? items.filter(i => (i.occurrence_count ?? 0) >= occThreshold) : items),
    [highFreqOnly, items, occThreshold],
  );

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
    if (selectedIds.size === displayedItems.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(displayedItems.map(i => i.id)));
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

  // CSV 다운로드 — attractions 업로드 형식 (name,short_desc,long_desc,country,region,badge_type,emoji)
  const downloadCSV = () => {
    const targetItems = selectedIds.size > 0 ? displayedItems.filter(i => selectedIds.has(i.id)) : displayedItems;
    // activity에서 관광지명 정리: ▶ 제거, 앞뒤 공백, 괄호 설명 유지
    const cleanName = (activity: string) => activity.replace(/^.*▶/, '').replace(/^☆\s*/, '').trim();
    const header = 'name,short_desc,long_desc,country,region,badge_type,emoji\n';
    const rows = targetItems.map(i => {
      const name = cleanName(i.activity || '');
      return `"${name.replace(/"/g, '""')}","","","${i.country || ''}","${i.region || ''}","tour",""`;
    }).join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `관광지_업로드용_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 별칭 연결
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState<{ id: string; name: string; country: string | null; region: string | null }[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);

  // 🤖 자동 추천 (suggest API) — Senzing/Tamr ER pattern
  interface Suggestion {
    id: string;
    name: string;
    aliases: string[];
    region: string | null;
    country: string | null;
    category: string | null;
    emoji: string | null;
    short_desc: string | null;
    score: number;
    matched_via: string;
    matched_term: string;
  }
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const loadSuggestions = async (unmatchedId: string) => {
    if (suggestingId === unmatchedId) {
      setSuggestingId(null);
      setSuggestions([]);
      return;
    }
    setSuggestingId(unmatchedId);
    setLinkingId(null);
    setAddingId(null);
    setSuggestLoading(true);
    setSuggestions([]);
    try {
      const res = await fetch(`/api/unmatched/suggest?id=${encodeURIComponent(unmatchedId)}`);
      const json = await res.json();
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : []);
    } catch (err) {
      console.error('자동 추천 실패', err);
      setSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
  };

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

  const linkAlias = async (unmatchedId: string, attractionId: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/unmatched', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unmatchedId, action: 'link_alias', attractionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
        return false;
      }
      alert(data.message);
      setLinkingId(null);
      setLinkSearch('');
      setLinkResults([]);
      load();
      return true;
    } catch (err) {
      alert('연결 실패');
      return false;
    }
  };

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/unmatched?summary=1');
      const json = await res.json();
      if (json.counts) {
        setSummary({
          ...json,
          manual_link_alias_total: typeof json.manual_link_alias_total === 'number' ? json.manual_link_alias_total : 0,
          high_occurrence_threshold: typeof json.high_occurrence_threshold === 'number' ? json.high_occurrence_threshold : 3,
        } as UnmatchedSummary);
      }
    } catch {
      setSummary(null);
    }
  }, []);

  const loadBootstrap = async () => {
    setBootstrapLoading(true);
    setBootstrapOpen(true);
    try {
      const res = await fetch('/api/unmatched?bootstrap=1&limit=40');
      const json = await res.json();
      setBootstrapCandidates(Array.isArray(json.candidates) ? json.candidates : []);
      if (typeof json.min_occurrences === 'number' && typeof json.score_min === 'number' && typeof json.score_max === 'number') {
        setBootstrapMeta({
          min_occurrences: json.min_occurrences,
          score_min: json.score_min,
          score_max: json.score_max,
        });
      }
    } catch {
      setBootstrapCandidates([]);
    } finally {
      setBootstrapLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/unmatched?status=${statusFilter}`);
      const json = await res.json();
      setItems(json.items || []);
    } finally {
      setLoading(false);
      void loadSummary();
    }
  }, [statusFilter, loadSummary]);

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
        <div className="flex gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => void loadBootstrap()}
            disabled={bootstrapLoading}
            className="px-3 py-1.5 bg-amber-700 text-white text-sm rounded-lg hover:bg-amber-800 disabled:opacity-50"
          >
            {bootstrapLoading ? '후보 분석…' : '애매 후보(빈도≥3)'}
          </button>
          <button onClick={downloadCSV}
            className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
            CSV↓ {selectedIds.size > 0 ? `(${selectedIds.size}건)` : `(${displayedItems.length}건)`}
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

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-slate-800">{summary.counts.pending}</div>
            <div className="text-xs text-slate-500">대기중</div>
          </div>
          <div className="bg-white border border-amber-200 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-amber-700">{summary.pending_high_occurrence}</div>
            <div className="text-xs text-slate-500">대기 · 등장 {summary.high_occurrence_threshold}회+</div>
          </div>
          <div className="bg-white border border-emerald-200 rounded-xl p-3 text-center">
            <div className="flex justify-center gap-5 items-baseline">
              <div>
                <div className="text-xl font-bold text-emerald-700">{summary.auto_alias_resolved_total}</div>
                <div className="text-[10px] text-slate-500">자동(크론)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-violet-700">{summary.manual_link_alias_total}</div>
                <div className="text-[10px] text-slate-500">수동(UI)</div>
              </div>
            </div>
            <div className="text-xs text-slate-500 mt-1">누적 별칭 연결</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 text-left text-xs text-slate-600">
            <div className="font-semibold text-slate-700 mb-1">최근 자동 처리</div>
            {summary.recent_auto_alias.length === 0 ? (
              <span className="text-slate-400">아직 없음</span>
            ) : (
              <ul className="space-y-0.5 max-h-20 overflow-y-auto">
                {summary.recent_auto_alias.map(r => (
                  <li key={r.id} className="truncate" title={r.activity}>
                    {r.activity.slice(0, 28)}
                    {r.activity.length > 28 ? '…' : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {bootstrapOpen && (
        <div className="mb-4 border border-amber-200 bg-amber-50/60 rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-sm font-bold text-amber-900">
              애매 매칭 후보 (빈도≥{bootstrapMeta?.min_occurrences ?? occThreshold}, 점수 {bootstrapMeta?.score_min ?? 75}~{bootstrapMeta?.score_max ?? 94})
            </h2>
            <button type="button" className="text-xs text-slate-500 hover:text-slate-700" onClick={() => setBootstrapOpen(false)}>닫기</button>
          </div>
          <p className="text-[11px] text-amber-800 mb-2">
            크론 자동해결(기본 95점+)에 안 걸린 건입니다. Vercel 환경변수 <span className="font-mono">UNMATCHED_BOOTSTRAP_*</span>로 구간을 조정할 수 있습니다. 행의 「적용」으로 별칭을 한 번에 연결할 수 있습니다.
          </p>
          {bootstrapLoading ? (
            <p className="text-xs text-amber-700 py-4 text-center">분석 중…</p>
          ) : bootstrapCandidates.length === 0 ? (
            <p className="text-xs text-slate-500 py-3 text-center">현재 조건에 맞는 후보가 없습니다.</p>
          ) : (
          <div className="max-h-56 overflow-y-auto space-y-1">
            {bootstrapCandidates.map(c => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 bg-white border border-amber-100 rounded-lg px-2 py-1.5 text-xs">
                <span className="font-medium text-slate-800 flex-1 min-w-[120px]">{c.activity}</span>
                <span className="text-blue-600 font-bold">{c.occurrence_count ?? 0}회</span>
                {c.suggestion ? (
                  <>
                    <span className="text-slate-600">→ {c.suggestion.name}</span>
                    <span className="text-amber-700 font-mono">{Math.round(c.suggestion.score)}점</span>
                    <button
                      type="button"
                      className="ml-auto px-2 py-0.5 bg-violet-600 text-white rounded hover:bg-violet-700"
                      onClick={async () => {
                        const ok = await linkAlias(c.id, c.suggestion!.id);
                        if (ok) setBootstrapCandidates(prev => prev.filter(x => x.id !== c.id));
                      }}
                    >
                      적용
                    </button>
                  </>
                ) : (
                  <span className="text-slate-400">후보 없음</span>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-3 mb-4 items-center flex-wrap">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={selectedIds.size === displayedItems.length && displayedItems.length > 0}
            onChange={toggleSelectAll} className="rounded" />
          <span className="text-xs text-slate-500">전체</span>
        </label>
        {statusFilter === 'pending' && (
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-600">
            <input type="checkbox" checked={highFreqOnly} onChange={e => { setHighFreqOnly(e.target.checked); setSelectedIds(new Set()); }} className="rounded" />
            등장 {occThreshold}회 이상만
          </label>
        )}
        {['pending', 'ignored', 'added', 'all'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setSelectedIds(new Set()); setHighFreqOnly(false); }}
            className={`px-3 py-1.5 text-sm rounded-lg ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {s === 'pending' ? '대기중' : s === 'ignored' ? '무시됨' : s === 'added' ? '추가됨' : '전체'}
          </button>
        ))}
        <span className="text-sm text-slate-500 self-center ml-auto">
          {selectedIds.size > 0 ? `${selectedIds.size}건 선택 / ` : ''}표시 {displayedItems.length}건
          {highFreqOnly ? ` (전체 ${items.length}건 중)` : ''}
        </span>
      </div>

      {loading ? <p className="text-slate-400 py-10 text-center">로딩 중...</p> : displayedItems.length === 0 ? (
        <p className="text-slate-400 py-10 text-center">미매칭 항목이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {displayedItems.map(item => (
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
                  <button onClick={() => loadSuggestions(item.id)}
                    className="px-3 py-1.5 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600 font-medium">
                    {suggestingId === item.id ? '접기' : '🤖 자동 추천'}
                  </button>
                  <button onClick={() => { setLinkingId(linkingId === item.id ? null : item.id); setAddingId(null); setSuggestingId(null); setLinkSearch(''); setLinkResults([]); }}
                    className="px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700">
                    {linkingId === item.id ? '접기' : '별칭 연결'}
                  </button>
                  <button onClick={() => { setAddingId(addingId === item.id ? null : item.id); setLinkingId(null); setSuggestingId(null); setAddForm(f => ({ ...f, country: item.country || '', region: item.region || '' })); }}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                    {addingId === item.id ? '접기' : 'DB 추가'}
                  </button>
                  <button onClick={() => changeStatus(item.id, 'ignored')}
                    className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200">무시</button>
                </div>
              </div>

              {/* 🤖 자동 추천 패널 */}
              {suggestingId === item.id && (
                <div className="mt-3 pt-3 border-t border-amber-100 bg-amber-50/50 rounded-lg p-3">
                  <p className="text-xs text-amber-700 mb-2 font-medium">
                    🤖 attractions DB 에서 유사 후보 자동 검색 — 클릭 한 번으로 alias 적립
                  </p>
                  {suggestLoading ? (
                    <p className="text-xs text-amber-500">분석 중…</p>
                  ) : suggestions.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      유사 후보 없음. <button onClick={() => { setSuggestingId(null); setLinkingId(item.id); }} className="text-violet-600 underline">수동 검색</button> 또는 <button onClick={() => { setSuggestingId(null); setAddingId(item.id); setAddForm(f => ({ ...f, country: item.country || '', region: item.region || '' })); }} className="text-blue-600 underline">신규 DB 추가</button>.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {suggestions.map(s => (
                        <button key={s.id}
                          onClick={() => linkAlias(item.id, s.id)}
                          className="w-full text-left bg-white hover:bg-amber-50 border border-amber-200 rounded-lg p-3 transition flex items-center justify-between gap-3"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{s.emoji || '📍'}</span>
                              <span className="font-bold text-slate-800">{s.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-mono">
                                {s.matched_via} {Math.round(s.score)}점
                              </span>
                            </div>
                            {s.short_desc && <p className="text-xs text-slate-500 mt-1 ml-6">{s.short_desc}</p>}
                            <div className="flex gap-2 mt-1 ml-6 text-[10px] text-slate-400">
                              {s.country && <span>🌍 {s.country}</span>}
                              {s.region && <span>📍 {s.region}</span>}
                              {s.category && <span>·{s.category}</span>}
                              {s.aliases.length > 0 && <span>· aliases {s.aliases.length}개</span>}
                            </div>
                            {s.matched_term !== s.name && (
                              <p className="text-[10px] text-amber-600 mt-1 ml-6">
                                ⤷ 매칭 근거: <span className="font-mono">"{s.matched_term}"</span>
                              </p>
                            )}
                          </div>
                          <span className="text-amber-600 text-lg flex-shrink-0">→</span>
                        </button>
                      ))}
                      <p className="text-[10px] text-slate-400 text-center pt-1">
                        클릭 → "{item.activity}" 가 해당 관광지의 alias 로 영구 적립됨 (다음 등록부터 자동 매칭)
                      </p>
                    </div>
                  )}
                </div>
              )}

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
