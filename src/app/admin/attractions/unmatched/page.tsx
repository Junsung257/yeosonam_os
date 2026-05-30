'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';

interface SuggestedCard {
  name: string;
  short_desc: string | null;
  long_desc: string | null;
  badge_type: string;
  emoji: string;
  aliases: string[];
}

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
  note: string | null;  // P11-3: Wikidata 제안 JSON / 관리자 메모
  created_at: string;
  suggested_card?: SuggestedCard | null;
  suggested_at?: string | null;
}

/** note 컬럼이 Wikidata 제안 JSON인지 확인 */
function parseNote(note: string | null): { qid?: string; label?: string; confidence?: number } | null {
  if (!note) return null;
  // auto-inserted or auto-matched -> Wikidata qid 포함
  const match = note.match(/^auto-(inserted|matched):\s*(Q\d+)/);
  if (match) {
    return { qid: match[2], label: undefined, confidence: 1.0 };
  }
  // JSON 형식 (Wikidata suggestion blob) — "[WIKIDATA] {...}" 접두사 대응
  const jsonStr = note.replace(/^\[WIKIDATA\]\s*/, '');
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && parsed.qid) {
      return { qid: parsed.qid, label: parsed.label ?? parsed.name, confidence: parsed.confidence };
    }
  } catch { /* not JSON */ }
  return null;
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

function SuggestedCardsBanner({ items, onAfterRegister }: { items: UnmatchedItem[]; onAfterRegister: () => void }) {
  const candidates = useMemo(
    () => items.filter(i => i.status === 'pending' && i.suggested_card && typeof i.suggested_card === 'object'),
    [items],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    setSelectedIds(new Set(candidates.map(c => c.id)));
  }, [candidates]);

  if (candidates.length === 0) return null;

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkRegister = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) { alert('선택된 카드 없음'); return; }
    if (!confirm(`${ids.length}건 AI 추천 카드를 attractions 에 일괄 등록하시겠습니까?\n(동일 name 시 alias 추가, 모바일 즉시 반영)`)) return;
    setBulkProgress({ current: 0, total: ids.length });
    let saved = 0, aliased = 0, failed = 0;
    for (let i = 0; i < ids.length; i++) {
      setBulkProgress({ current: i + 1, total: ids.length });
      try {
        const res = await fetch('/api/unmatched', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: ids[i], action: 'register_from_suggested_card' }),
        });
        const data = await res.json();
        if (res.ok) {
          if (data.message?.includes('alias 추가')) aliased++;
          else saved++;
        } else failed++;
        await new Promise(r => setTimeout(r, 150));
      } catch { failed++; }
    }
    setBulkProgress(null);
    alert(`등록 완료\n신규: ${saved} / alias 추가: ${aliased} / 실패: ${failed}`);
    setSelectedIds(new Set());
    onAfterRegister();
  };

  return (
    <div className="mb-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-emerald-700">
          🤖 AI 자동 추천 카드 ({candidates.length}건) — 신규 지역 자동 부트스트랩
        </h3>
        <button
          onClick={bulkRegister}
          disabled={!!bulkProgress || selectedIds.size === 0}
          className="px-4 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-semibold"
        >
          {bulkProgress ? `등록 중… ${bulkProgress.current}/${bulkProgress.total}` : `✅ ${selectedIds.size}건 일괄 등록`}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto">
        {candidates.map(c => {
          const card = c.suggested_card!;
          const isSelected = selectedIds.has(c.id);
          return (
            <label key={c.id} className={`flex gap-2 p-2 rounded border cursor-pointer transition ${
              isSelected ? 'bg-white border-emerald-400' : 'bg-white/60 border-slate-200'
            }`}>
              <input type="checkbox" checked={isSelected} onChange={() => toggleOne(c.id)} className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5">
                  <span>{card.emoji}</span>
                  <span className="font-bold text-sm truncate">{card.name}</span>
                  <span className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">{card.badge_type}</span>
                </div>
                {card.short_desc && <p className="text-xs text-admin-muted line-clamp-2">{card.short_desc}</p>}
                <p className="text-[10px] text-admin-muted-2 mt-1 truncate">원본: {c.activity}</p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
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

  // PR #87 Phase 1 — Wikidata 정규화 후보 (1-click 신규 등록).
  interface WikidataCandidate {
    qid: string;
    description: string | null;
    labels: { ko: string | null; en: string | null; zh: string | null; ja: string | null };
    aliases: { ko: string[]; en: string[]; zh: string[]; ja: string[] };
    image_filename: string | null;
    image_thumb_url: string | null;
    sitelinks: { kowiki: string | null; enwiki: string | null; zhwiki: string | null };
  }
  const [wikidata, setWikidata] = useState<WikidataCandidate | null>(null);
  const [registeringWd, setRegisteringWd] = useState(false);

  const loadSuggestions = async (unmatchedId: string) => {
    if (suggestingId === unmatchedId) {
      setSuggestingId(null);
      setSuggestions([]);
      setWikidata(null);
      return;
    }
    setSuggestingId(unmatchedId);
    setLinkingId(null);
    setAddingId(null);
    setSuggestLoading(true);
    setSuggestions([]);
    setWikidata(null);
    try {
      const res = await fetch(`/api/unmatched/suggest?id=${encodeURIComponent(unmatchedId)}`);
      const json = await res.json();
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : []);
      setWikidata(json.wikidata ?? null);
    } catch (err) {
      console.error('자동 추천 실패', err);
      setSuggestions([]);
      setWikidata(null);
    } finally {
      setSuggestLoading(false);
    }
  };

  const registerFromWikidata = async (unmatchedId: string, wd: WikidataCandidate) => {
    if (!confirm(`Wikidata ${wd.qid} "${wd.labels.ko ?? wd.labels.en}" 로 신규 등록하시겠습니까?\n다국어 alias ${[...wd.aliases.ko, ...wd.aliases.en, ...wd.aliases.zh, ...wd.aliases.ja].length}개 + Wikimedia 사진 자동 import`)) return;
    setRegisteringWd(true);
    try {
      const res = await fetch('/api/unmatched', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unmatchedId, action: 'register_from_wikidata', wikidata: wd }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? '등록 실패');
        return;
      }
      alert(data.message);
      setSuggestingId(null);
      setSuggestions([]);
      setWikidata(null);
      load();
    } catch (err) {
      alert('등록 실패: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRegisteringWd(false);
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
          <h1 className="text-2xl font-bold text-admin-text-2">🔍 미매칭 관광지</h1>
          <p className="text-sm text-admin-muted mt-1">랜딩페이지에서 DB에 매칭되지 않은 관광지 목록입니다.</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={async () => {
              if (!confirm('새 한글 fuzzy 매칭으로 대기 항목을 한 번에 retry 합니다 (최대 600건).\n시간이 약 1~2분 걸릴 수 있습니다.')) return;
              try {
                const res = await fetch('/api/admin/attractions/retry-unmatched?limit=600', { method: 'POST' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? '실패');
                alert(`✓ retry 완료\n처리 ${data.unmatched_processed}건 / 해소 ${data.resolved}건 / 남은 pending ${data.remaining_pending}건\n샘플: ${(data.sample_matches ?? []).slice(0, 5).map((s: { activity: string; canonical: string }) => `${s.activity}→${s.canonical}`).join(', ')}`);
                window.location.reload();
              } catch (err) {
                alert(`retry 실패: ${err instanceof Error ? err.message : err}`);
              }
            }}
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
            title="새 Hangul fuzzy + MRT canonical 매칭기로 대기 항목 자동 retry"
          >
            🔁 새 매칭으로 retry
          </button>
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
          <a href="/admin/attractions" className="px-3 py-1.5 bg-admin-surface-2 text-admin-text-2 text-sm rounded-lg hover:bg-slate-200">← 관광지 관리</a>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-3 text-center">
            <div className="text-2xl font-bold text-admin-text-2">{summary.counts.pending}</div>
            <div className="text-xs text-admin-muted">대기중</div>
          </div>
          <div className="bg-white border border-amber-200 rounded-admin-md p-3 text-center">
            <div className="text-2xl font-bold text-amber-700">{summary.pending_high_occurrence}</div>
            <div className="text-xs text-admin-muted">대기 · 등장 {summary.high_occurrence_threshold}회+</div>
          </div>
          <div className="bg-white border border-emerald-200 rounded-admin-md p-3 text-center">
            <div className="flex justify-center gap-5 items-baseline">
              <div>
                <div className="text-xl font-bold text-emerald-700">{summary.auto_alias_resolved_total}</div>
                <div className="text-[10px] text-admin-muted">자동(크론)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-violet-700">{summary.manual_link_alias_total}</div>
                <div className="text-[10px] text-admin-muted">수동(UI)</div>
              </div>
            </div>
            <div className="text-xs text-admin-muted mt-1">누적 별칭 연결</div>
          </div>
          <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-3 text-left text-xs text-admin-muted">
            <div className="font-semibold text-admin-text-2 mb-1">최근 자동 처리</div>
            {summary.recent_auto_alias.length === 0 ? (
              <span className="text-admin-muted-2">아직 없음</span>
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
        <div className="mb-4 border border-amber-200 bg-amber-50/60 rounded-admin-md p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-sm font-bold text-amber-900">
              애매 매칭 후보 (빈도≥{bootstrapMeta?.min_occurrences ?? occThreshold}, 점수 {bootstrapMeta?.score_min ?? 75}~{bootstrapMeta?.score_max ?? 94})
            </h2>
            <button type="button" className="text-xs text-admin-muted hover:text-admin-text-2" onClick={() => setBootstrapOpen(false)}>닫기</button>
          </div>
          <p className="text-[11px] text-amber-800 mb-2">
            크론 자동해결(기본 95점+)에 안 걸린 건입니다. Vercel 환경변수 <span className="font-mono">UNMATCHED_BOOTSTRAP_*</span>로 구간을 조정할 수 있습니다. 행의 「적용」으로 별칭을 한 번에 연결할 수 있습니다.
          </p>
          {bootstrapLoading ? (
            <p className="text-xs text-amber-700 py-4 text-center">분석 중…</p>
          ) : bootstrapCandidates.length === 0 ? (
            <p className="text-xs text-admin-muted py-3 text-center">현재 조건에 맞는 후보가 없습니다.</p>
          ) : (
          <div className="max-h-56 overflow-y-auto space-y-1">
            {bootstrapCandidates.map(c => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 bg-white border border-amber-100 rounded-lg px-2 py-1.5 text-xs">
                <span className="font-medium text-admin-text-2 flex-1 min-w-[120px]">{c.activity}</span>
                <span className="text-blue-600 font-bold">{c.occurrence_count ?? 0}회</span>
                {c.suggestion ? (
                  <>
                    <span className="text-admin-muted">→ {c.suggestion.name}</span>
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
                  <span className="text-admin-muted-2">후보 없음</span>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* PR #94 — AI 자동 추천 카드 일괄 등록 */}
      <SuggestedCardsBanner items={items} onAfterRegister={() => { load(); loadSummary(); }} />

      {/* 필터 */}
      <div className="flex gap-3 mb-4 items-center flex-wrap">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={selectedIds.size === displayedItems.length && displayedItems.length > 0}
            onChange={toggleSelectAll} className="rounded" />
          <span className="text-xs text-admin-muted">전체</span>
        </label>
        {statusFilter === 'pending' && (
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-admin-muted">
            <input type="checkbox" checked={highFreqOnly} onChange={e => { setHighFreqOnly(e.target.checked); setSelectedIds(new Set()); }} className="rounded" />
            등장 {occThreshold}회 이상만
          </label>
        )}
        {['pending', 'ignored', 'added', 'all'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setSelectedIds(new Set()); setHighFreqOnly(false); }}
            className={`px-3 py-1.5 text-sm rounded-lg ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-admin-surface-2 text-admin-muted hover:bg-slate-200'}`}>
            {s === 'pending' ? '대기중' : s === 'ignored' ? '무시됨' : s === 'added' ? '추가됨' : '전체'}
          </button>
        ))}
        <span className="text-sm text-admin-muted self-center ml-auto">
          {selectedIds.size > 0 ? `${selectedIds.size}건 선택 / ` : ''}표시 {displayedItems.length}건
          {highFreqOnly ? ` (전체 ${items.length}건 중)` : ''}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-3 flex items-center gap-3">
              <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
              <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-14" />
            </div>
          ))}
        </div>
      ) : displayedItems.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14">
          <svg className="w-10 h-10 text-admin-border-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="text-admin-sm font-medium text-admin-muted">미매칭 항목이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayedItems.map(item => (
            <div key={item.id} className={`bg-white border rounded-admin-md p-4 ${selectedIds.has(item.id) ? 'border-blue-400 bg-blue-50/30' : 'border-admin-border-mid'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <input type="checkbox" checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)} className="rounded mt-1 flex-shrink-0" />
                  <div className="flex-1">
                  <h3 className="font-bold text-admin-text-2">{item.activity}</h3>
                  <div className="flex gap-3 mt-1 text-xs text-admin-muted-2">
                    {item.package_title && <span>📦 {item.package_title}</span>}
                    {item.day_number && <span>Day {item.day_number}</span>}
                    {item.country && <span>🌍 {item.country}</span>}
                    {item.region && <span>📍 {item.region}</span>}
                    <span className="font-bold text-blue-600">등장 {item.occurrence_count}회</span>
                    {/* P11-3: Wikidata note badge */}
                    {(() => {
                      const parsed = parseNote(item.note);
                      if (!parsed) return null;
                      return (
                        <a href={`https://www.wikidata.org/wiki/${parsed.qid}`} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded text-[10px] font-medium hover:bg-sky-200"
                          title={`Wikidata ${parsed.qid} (conf=${parsed.confidence?.toFixed(2) ?? '?'})`}>
                          🌐 {parsed.qid} {parsed.label ? `· ${parsed.label}` : ''}
                        </a>
                      );
                    })()}
                  </div>
                  {item.note && item.note.startsWith('auto-') && (
                    <p className="text-[10px] text-emerald-600 mt-0.5">✓ {item.note}</p>
                  )}
                  {item.note && !item.note.startsWith('auto-') && (
                    <p className="text-[10px] text-admin-muted-2 mt-0.5 line-clamp-2">{item.note}</p>
                  )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {/* P11-3: 1-click reconcile (Wikidata 자동 검색) */}
                  {item.status === 'pending' && !item.note?.startsWith('auto-') && (
                    <button onClick={async () => {
                      const res = await fetch('/api/unmatched', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: item.id, action: 'reconcile_auto_insert' }),
                      });
                      const data = await res.json();
                      if (res.ok) {
                        alert(data.message || '처리 완료');
                        load();
                      } else {
                        alert(data.error || 'reconcile 실패');
                      }
                    }}
                      className="px-3 py-1.5 bg-sky-500 text-white text-xs rounded-lg hover:bg-sky-600 font-medium">
                      🪄 1-click reconcile
                    </button>
                  )}
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
                    className="px-3 py-1.5 bg-admin-surface-2 text-admin-muted text-xs rounded-lg hover:bg-slate-200">무시</button>
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
                    <p className="text-xs text-admin-muted">
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
                              <span className="font-bold text-admin-text-2">{s.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-mono">
                                {s.matched_via} {Math.round(s.score)}점
                              </span>
                            </div>
                            {s.short_desc && <p className="text-xs text-admin-muted mt-1 ml-6">{s.short_desc}</p>}
                            <div className="flex gap-2 mt-1 ml-6 text-[10px] text-admin-muted-2">
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
                      <p className="text-[10px] text-admin-muted-2 text-center pt-1">
                        클릭 → "{item.activity}" 가 해당 관광지의 alias 로 영구 적립됨 (다음 등록부터 자동 매칭)
                      </p>
                    </div>
                  )}

                  {/* PR #87 Phase 1 — Wikidata 정규화 후보 (외부 SSOT) */}
                  {wikidata && (
                    <div className="mt-3 pt-3 border-t border-sky-200">
                      <p className="text-xs text-sky-700 mb-2 font-medium">
                        🌐 Wikidata 정규화 후보 — 다국어 alias + 사진 자동 import
                      </p>
                      <div className="bg-white border border-sky-200 rounded-lg p-3">
                        <div className="flex gap-3">
                          {wikidata.image_thumb_url && (
                            <img src={wikidata.image_thumb_url} alt={wikidata.labels.ko ?? wikidata.qid}
                              className="w-20 h-20 object-cover rounded-lg flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-bold text-admin-text-2">{wikidata.labels.ko ?? wikidata.labels.en ?? wikidata.qid}</span>
                              <a href={`https://www.wikidata.org/wiki/${wikidata.qid}`} target="_blank" rel="noopener noreferrer"
                                className="text-[10px] text-sky-600 underline">{wikidata.qid}</a>
                            </div>
                            {wikidata.description && (
                              <p className="text-xs text-admin-muted mb-2 line-clamp-2">{wikidata.description}</p>
                            )}
                            <div className="flex flex-wrap gap-1 mb-2 text-[10px]">
                              {wikidata.labels.en && <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded">EN: {wikidata.labels.en}</span>}
                              {wikidata.labels.zh && <span className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">ZH: {wikidata.labels.zh}</span>}
                              {wikidata.labels.ja && <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">JA: {wikidata.labels.ja}</span>}
                              <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                alias {[...wikidata.aliases.ko, ...wikidata.aliases.en, ...wikidata.aliases.zh, ...wikidata.aliases.ja].length}개
                              </span>
                            </div>
                          </div>
                        </div>
                        <button onClick={() => registerFromWikidata(item.id, wikidata)}
                          disabled={registeringWd}
                          className="w-full mt-2 px-3 py-2 bg-sky-600 text-white text-xs rounded-lg hover:bg-sky-700 font-medium disabled:opacity-50">
                          {registeringWd ? '등록 중…' : `✅ 이 정보로 신규 attraction 등록 (Wikidata ${wikidata.qid})`}
                        </button>
                      </div>
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
                          <span className="text-sm font-medium text-admin-text-2">{attr.name}</span>
                          <span className="text-[10px] text-admin-muted-2">
                            {attr.country || ''} {attr.region || ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {linkSearch.length >= 2 && !linkLoading && linkResults.length === 0 && (
                    <p className="text-xs text-admin-muted-2 mt-2">검색 결과가 없습니다.</p>
                  )}
                </div>
              )}

              {/* 추가 폼 */}
              {addingId === item.id && (
                <div className="mt-3 pt-3 border-t border-admin-border grid grid-cols-6 gap-2">
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
