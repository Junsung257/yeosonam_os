'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Plus, Camera, Search as SearchIcon, Download, Upload as UploadIcon, AlertCircle } from 'lucide-react';

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
  // 감사(2026-05-11): useEffect+fetch → useSWR. 필터 변경 자동 dedup + keepPreviousData.
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [filter, setFilter] = useState({ country: '', region: '', badge: '', search: '' });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', short_desc: '', long_desc: '', country: '', region: '', badge_type: 'tour', emoji: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [photoPanel, setPhotoPanel] = useState<{ id: string; results: PhotoItem[]; keyword: string; searching: boolean } | null>(null);
  const [autoPhotoProgress, setAutoPhotoProgress] = useState<{ current: number; total: number } | null>(null);
  const [displayCount, setDisplayCount] = useState(50); // 페이지네이션: 50개씩

  const listKey = useMemo(() => {
    const params = new URLSearchParams();
    if (filter.country) params.set('country', filter.country);
    if (filter.region) params.set('region', filter.region);
    if (filter.badge)  params.set('badge_type', filter.badge);
    return `/api/attractions?${params}`;
  }, [filter.country, filter.region, filter.badge]);

  const { data: listData, isLoading: loading, mutate: mutateList } = useSWR<{ attractions: Attraction[] }>(listKey);

  useEffect(() => {
    if (listData?.attractions) setAttractions(listData.attractions);
  }, [listData]);

  const load = useCallback(() => mutateList(), [mutateList]);

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

  // ── X4-3 박제 (2026-05-15): attraction 정확/부정확 1-click 피드백 (active learning) ──
  const submitFeedback = async (id: string, verdict: 'accurate' | 'inaccurate') => {
    try {
      const res = await fetch(`/api/admin/attractions/${id}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || '피드백 실패'); return; }
      alert(data.message || '피드백 완료');
      load();
    } catch (e) { alert(e instanceof Error ? e.message : '피드백 실패'); }
  };

  // ── B 박제 (2026-05-15): alias 수동 추가/삭제 (사장님 도메인 전문성 보완) ──
  const [aliasInput, setAliasInput] = useState<Record<string, string>>({});
  const addAlias = async (id: string) => {
    const alias = (aliasInput[id] ?? '').trim();
    if (!alias) return;
    try {
      const res = await fetch(`/api/admin/attractions/${id}/aliases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'alias 추가 실패'); return; }
      setAttractions(prev => prev.map(a => a.id === id ? { ...a, aliases: data.aliases } : a));
      setAliasInput(p => ({ ...p, [id]: '' }));
    } catch (e) { alert(e instanceof Error ? e.message : 'alias 추가 실패'); }
  };
  const removeAlias = async (id: string, alias: string) => {
    try {
      const res = await fetch(`/api/admin/attractions/${id}/aliases`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'alias 삭제 실패'); return; }
      setAttractions(prev => prev.map(a => a.id === id ? { ...a, aliases: data.aliases } : a));
    } catch (e) { alert(e instanceof Error ? e.message : 'alias 삭제 실패'); }
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
        // ERR-pexels-korean-search@2026-04-21: attractionId 전달 → 서버가 aliases 의 영어명 우선 사용.
        // 영어 alias 없으면 서버가 자동으로 한글+지역 fallback.
        // PR #89 Phase 2b: wikimedia=true 로 Wikidata QID 있는 attraction 은 Commons P18 우선 (false-match 0)
        const res = await fetch('/api/attractions/photos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attractionId: a.id, per_page: 3, wikimedia: true }),
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
    // ⚠️ ERR-attractions-csv-badge-check@2026-04-21: 엑셀에서 badge_type 칸에 공백/한글/대소문자 변형 등이 들어가면
    //    서버 CHECK 제약 위반으로 전체 0건 반영되던 사고 → 서버가 정규화하지만 클라이언트도 확실히 trim 후 fallback.
    const items = dataRows.map(cols => {
      const badgeRaw = (cols[5] || '').trim();
      return {
        name: (cols[0] || '').trim(),
        short_desc: (cols[1] || '').trim(),
        long_desc: (cols[2] || '').trim() || null,
        country: (cols[3] || '').trim(),
        region: (cols[4] || '').trim(),
        badge_type: badgeRaw || 'tour', // 빈/공백 → 'tour' (서버가 한번 더 한글·대소문자 정규화)
        emoji: (cols[6] || '').trim(),
      };
    }).filter(i => i.name);
    if (items.length === 0) { alert('유효한 행이 없습니다. CSV 형식을 확인해주세요.\n헤더: name,short_desc,long_desc,country,region,badge_type,emoji'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/attractions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '서버 오류');
      const dup = json.skippedDuplicates > 0 ? `\n(중복 name ${json.skippedDuplicates}건 자동 제거)` : '';
      if (json.totalErrors > 0) {
        const top = (json.errors || []).slice(0, 5).map((e: { name: string; error: string }) => `  • ${e.name.slice(0, 40)}: ${e.error.slice(0, 60)}`).join('\n');
        alert(`CSV 업로드: ${json.upserted}/${items.length}건 반영\n실패 ${json.totalErrors}건:\n${top}${json.totalErrors > 5 ? `\n  ... 외 ${json.totalErrors - 5}건` : ''}${dup}`);
      } else {
        alert(`CSV 업로드 완료: ${json.upserted ?? 0}건 반영 (총 ${items.length}건)${dup}`);
      }
      load();
    } catch (err) {
      alert(`CSV 업로드 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally { setSaving(false); e.target.value = ''; }
  };

  const countries = [...new Set(attractions.map(a => a.country).filter(Boolean))] as string[];
  const regions = [...new Set(attractions.map(a => a.region).filter(Boolean))] as string[];
  const badgeStyle = (bt: string) => BADGE_OPTIONS.find(b => b.value === bt)?.color || 'bg-admin-surface-2 text-admin-text-2';
  const badgeLabel = (bt: string) => BADGE_OPTIONS.find(b => b.value === bt)?.label || bt;
  const photoCount = attractions.filter(a => a.photos?.length > 0).length;
  const noPhotoCount = attractions.filter(a => !a.photos || a.photos.length === 0).length;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title="관광지 관리"
        subtitle={
          <>총 <b className="text-admin-text admin-num">{attractions.length}</b>개 · 사진 <b className="text-success admin-num">{photoCount}</b>개 완료 · 사진 미등록 <b className="text-warning admin-num">{noPhotoCount}</b>개</>
        }
        actions={
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={autoGeneratePhotos}
              disabled={!!autoPhotoProgress}
              className="h-8 px-3 inline-flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-admin-sm font-semibold rounded-admin-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Camera size={14} />
              {autoPhotoProgress ? `${autoPhotoProgress.current}/${autoPhotoProgress.total}` : `사진 일괄생성 (${noPhotoCount})`}
            </button>
            <a href="/admin/attractions/unmatched">
              <Button variant="secondary" size="sm">
                <AlertCircle size={14} />
                미매칭
              </Button>
            </a>
            <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
              <Plus size={14} />
              신규
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadCsv}>
              <Download size={14} />
              CSV
            </Button>
            <label className={`h-8 px-3 inline-flex items-center gap-1.5 text-admin-sm rounded-admin-sm font-medium cursor-pointer transition-colors ${
              saving
                ? 'bg-status-warningBg text-status-warningFg animate-pulse'
                : 'bg-admin-surface border border-admin-border-mid text-admin-text-2 hover:bg-admin-surface-2 hover:border-admin-border-strong'
            }`}>
              <UploadIcon size={14} />
              {saving ? '업로드 중…' : 'CSV 업로드'}
              <input type="file" accept=".csv" onChange={uploadCsv} className="hidden" disabled={saving} />
            </label>
          </div>
        }
      />

      {/* 자동생성 프로그레스 */}
      {autoPhotoProgress && (
        <div className="mb-4 bg-brand-light border border-brand/20 rounded-admin-md p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-admin-sm font-bold text-brand">📷 Pexels 사진 자동 생성 중…</span>
            <span className="text-admin-xs text-brand admin-num">{autoPhotoProgress.current} / {autoPhotoProgress.total}</span>
          </div>
          <div className="w-full bg-brand/15 rounded-full h-2">
            <div className="bg-brand h-2 rounded-full transition-all" style={{ width: `${(autoPhotoProgress.current / autoPhotoProgress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-2 mb-4 admin-card p-3">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-admin-muted-2 pointer-events-none" />
          <input
            value={filter.search}
            onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            placeholder="관광지명, 국가, 지역 검색"
            className="w-full h-9 pl-8 pr-3 text-admin-base border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
        </div>
        <select value={filter.country} onChange={e => setFilter(f => ({ ...f, country: e.target.value }))} className="h-9 text-admin-sm border border-admin-border-mid rounded-admin-sm px-2.5 bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors">
          <option value="">전체 국가</option>
          {countries.sort().map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter.region} onChange={e => setFilter(f => ({ ...f, region: e.target.value }))} className="h-9 text-admin-sm border border-admin-border-mid rounded-admin-sm px-2.5 bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors">
          <option value="">전체 지역</option>
          {regions.sort().map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filter.badge} onChange={e => setFilter(f => ({ ...f, badge: e.target.value }))} className="h-9 text-admin-sm border border-admin-border-mid rounded-admin-sm px-2.5 bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors">
          <option value="">전체 배지</option>
          {BADGE_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.icon} {b.label}</option>)}
        </select>
        <span className="text-admin-sm text-admin-muted self-center admin-num">{filtered.length}건</span>
      </div>

      {/* 신규 등록 폼 */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-admin-md p-4 mb-4">
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
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white border border-admin-border rounded-admin-md p-4 flex items-center gap-4">
              <div className="w-10 h-10 bg-admin-surface-2 rounded-admin-md animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse w-40" />
                <div className="h-2.5 bg-admin-surface-2 rounded animate-pulse w-24" />
              </div>
              <div className="h-5 bg-admin-surface-2 rounded-full animate-pulse w-14" />
              <div className="h-5 bg-admin-surface-2 rounded-full animate-pulse w-10" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.slice(0, displayCount).map(a => {
            const isExpanded = expandedId === a.id;
            const isPhotoOpen = photoPanel?.id === a.id;
            return (
              <div key={a.id} className="bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden hover:shadow-admin-xs transition">
                {/* 메인 행 */}
                <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : a.id)}>
                  {/* 사진 썸네일 */}
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-admin-surface-2 shrink-0 flex items-center justify-center">
                    {a.photos?.length > 0 ? (
                      <img src={a.photos[0].src_medium} alt={a.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl">{a.emoji || '📍'}</span>
                    )}
                  </div>

                  {/* 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-admin-text-2 text-sm">{a.emoji} {a.name}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeStyle(a.badge_type)}`}>{badgeLabel(a.badge_type)}</span>
                      {a.photos?.length > 0 && <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">📷{a.photos.length}</span>}
                    </div>
                    <p className="text-xs text-admin-muted mt-0.5 truncate">{a.short_desc || '설명 없음'}</p>
                    <div className="flex gap-3 mt-1 text-[10px] text-admin-muted-2">
                      <span>🌍 {a.country || '-'}</span>
                      <span>📍 {a.region || '-'}</span>
                      <span>등장 {a.mention_count}회</span>
                    </div>
                  </div>

                  {/* 확장 아이콘 */}
                  <span className="text-admin-muted-2 text-lg shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* 확장 패널 */}
                {isExpanded && (
                  <div className="border-t border-admin-border bg-admin-bg p-4 space-y-4">
                    {/* 사진 관리 */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold text-admin-muted">📷 사진 ({a.photos?.length || 0}/5)</h4>
                        <button onClick={(e) => {
                          e.stopPropagation();
                          // ERR-pexels-korean-search@2026-04-21: 영어 alias 있으면 Pexels 검색에 그걸 기본 키워드로
                          const englishAlias = (a.aliases || []).find(al => typeof al === 'string' && /^[\x20-\x7E\s]{2,}$/.test(al));
                          const defaultKeyword = englishAlias || `${a.name} ${a.region || ''} travel`;
                          setPhotoPanel(isPhotoOpen ? null : { id: a.id, results: [], keyword: defaultKeyword, searching: false });
                        }}
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
                              <p className="text-[8px] text-admin-muted-2 mt-0.5 truncate w-28">📸 {p.photographer}</p>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs text-admin-muted-2">사진 없음 — 위 버튼으로 추가하세요</p>}

                      {/* Pexels 검색 패널 */}
                      {isPhotoOpen && photoPanel && (
                        <div className="mt-3 bg-white border border-blue-200 rounded-admin-md p-3">
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
                                    <p className="text-[8px] text-admin-muted-2 px-1 truncate">{already ? '✅ 추가됨' : `📸 ${p.photographer}`}</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* X4-3 박제 (2026-05-15): 정확/부정확 1-click 피드백 (active learning) */}
                    <div className="flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="text-xs text-admin-muted">
                        🤖 자동 시드 검증 (사장님 1-click)
                        <span className="ml-2 text-blue-700">정확도가 다음 시드 학습에 반영됩니다</span>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); if (confirm(`"${a.name}" 정확? confidence +10%`)) submitFeedback(a.id, 'accurate'); }}
                          className="text-xs px-2.5 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg font-medium"
                        >✅ 정확</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (confirm(`"${a.name}" 부정확? confidence -20%, 30% 미만 자동 비활성`)) submitFeedback(a.id, 'inaccurate'); }}
                          className="text-xs px-2.5 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg font-medium"
                        >❌ 부정확</button>
                      </div>
                    </div>

                    {/* B 박제 (2026-05-15): 표기 변형 (aliases) 수동 보완 */}
                    <div>
                      <h4 className="text-xs font-bold text-admin-muted mb-2">🏷️ 표기 변형 ({a.aliases?.length || 0})</h4>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {(a.aliases || []).map(al => (
                          <span key={al} className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                            {al}
                            <button
                              onClick={(e) => { e.stopPropagation(); removeAlias(a.id, al); }}
                              className="text-blue-400 hover:text-red-500 font-bold ml-0.5"
                              title="삭제"
                            >×</button>
                          </span>
                        ))}
                        {(a.aliases || []).length === 0 && (
                          <span className="text-[11px] text-admin-muted-2">표기 변형 없음 — 추가 시 매칭 정확도 ↑</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={aliasInput[a.id] ?? ''}
                          onChange={e => setAliasInput(p => ({ ...p, [a.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAlias(a.id); } }}
                          onClick={e => e.stopPropagation()}
                          placeholder="예: 도멘 드 마리 (한 줄 입력)"
                          className="flex-1 text-xs border rounded-lg px-2 py-1.5"
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); addAlias(a.id); }}
                          className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium"
                        >
                          + 추가
                        </button>
                      </div>
                    </div>

                    {/* 기본 정보 편집 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-admin-muted mb-1 block">관광지명</label>
                        <input defaultValue={a.name} onBlur={e => { if (e.target.value !== a.name) inlineSave(a.id, 'name', e.target.value); }}
                          className="w-full text-sm border rounded-lg px-3 py-2" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-admin-muted mb-1 block">한줄 설명</label>
                        <input defaultValue={a.short_desc || ''} onBlur={e => { if (e.target.value !== (a.short_desc || '')) inlineSave(a.id, 'short_desc', e.target.value); }}
                          className="w-full text-sm border rounded-lg px-3 py-2" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-[10px] font-bold text-admin-muted mb-1 block">상세 설명 (long_desc)</label>
                        <textarea defaultValue={a.long_desc || ''} onBlur={e => { if (e.target.value !== (a.long_desc || '')) inlineSave(a.id, 'long_desc', e.target.value); }}
                          rows={3} className="w-full text-sm border rounded-lg px-3 py-2 resize-none" />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-admin-muted mb-1 block">국가</label>
                          <input defaultValue={a.country || ''} onBlur={e => { if (e.target.value !== (a.country || '')) inlineSave(a.id, 'country', e.target.value); }}
                            className="w-full text-sm border rounded-lg px-3 py-2" />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-admin-muted mb-1 block">지역</label>
                          <input defaultValue={a.region || ''} onBlur={e => { if (e.target.value !== (a.region || '')) inlineSave(a.id, 'region', e.target.value); }}
                            className="w-full text-sm border rounded-lg px-3 py-2" />
                        </div>
                        <div className="w-20">
                          <label className="text-[10px] font-bold text-admin-muted mb-1 block">이모지</label>
                          <input defaultValue={a.emoji || ''} onBlur={e => { if (e.target.value !== (a.emoji || '')) inlineSave(a.id, 'emoji', e.target.value); }}
                            className="w-full text-sm border rounded-lg px-3 py-2 text-center" />
                        </div>
                      </div>
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-admin-muted mb-1 block">배지 타입</label>
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
              className="w-full py-3 bg-admin-surface-2 text-admin-muted text-sm rounded-admin-md hover:bg-slate-200 font-medium">
              더보기 ({displayCount}/{filtered.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
