'use client';

import { useState, useEffect, useCallback } from 'react';

interface DestMeta {
  tagline: string | null;
  hero_tagline: string | null;
  hero_image_url: string | null;
  photo_approved: boolean;
}

interface DestRow {
  destination: string;
  package_count: number;
  min_price: number | null;
  avg_rating: number | null;
  metadata: DestMeta | null;
}

interface PexelsResult {
  id: number;
  photographer: string;
  src_large: string;
  src_medium: string;
  src_thumb: string;
  alt: string;
}

type StatusFilter = 'all' | 'missing' | 'pending' | 'approved';

function statusBadge(meta: DestMeta | null) {
  if (!meta) return { label: '미설정', color: 'bg-rose-100 text-rose-700', icon: '🔴' };
  if (meta.photo_approved) return { label: '완료', color: 'bg-emerald-100 text-emerald-700', icon: '✅' };
  if (meta.hero_image_url) return { label: '사진 미승인', color: 'bg-amber-100 text-amber-700', icon: '⚠️' };
  return { label: '타이틀만', color: 'bg-blue-100 text-blue-700', icon: '📝' };
}

export default function AdminDestinationsPage() {
  const [rows, setRows] = useState<DestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, Partial<DestMeta>>>({});
  const [photoSearch, setPhotoSearch] = useState<Record<string, { keyword: string; results: PexelsResult[]; loading: boolean }>>({});
  const [autoGenProgress, setAutoGenProgress] = useState<{ current: number; total: number } | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [destsRes, metaRes] = await Promise.all([
        fetch('/api/admin/active-destinations'),
        fetch('/api/destinations/meta-list'),
      ]);
      if (!destsRes.ok) {
        setMsg(`❌ 여행지 목록 조회 실패 (${destsRes.status})`);
        return;
      }
      const dests = await destsRes.json();
      const metas = metaRes.ok ? await metaRes.json() : { data: [] };

      const metaMap: Record<string, DestMeta> = {};
      if (Array.isArray(metas.data)) {
        metas.data.forEach((m: DestMeta & { destination: string }) => {
          metaMap[m.destination] = m;
        });
      }

      const combined: DestRow[] = (dests.data || []).map((d: any) => ({
        destination: d.destination,
        package_count: d.package_count,
        min_price: d.min_price,
        avg_rating: d.avg_rating,
        metadata: metaMap[d.destination] || null,
      }));

      setRows(combined);
    } catch (err) {
      setMsg(`❌ 네트워크 오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => {
    if (search && !r.destination.includes(search)) return false;
    if (filter === 'missing') return !r.metadata;
    if (filter === 'pending') return r.metadata && !r.metadata.photo_approved;
    if (filter === 'approved') return r.metadata?.photo_approved === true;
    return true;
  });

  // ── 인라인 저장 ─────────────────────────────────────────────
  async function patchMeta(destination: string, patch: Partial<DestMeta>) {
    setSaving(p => ({ ...p, [destination]: true }));
    try {
      const res = await fetch(`/api/destinations/${encodeURIComponent(destination)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setRows(prev =>
          prev.map(r =>
            r.destination === destination
              ? { ...r, metadata: { tagline: null, hero_tagline: null, hero_image_url: null, photo_approved: false, ...r.metadata, ...patch } }
              : r
          )
        );
        setEditing(p => { const n = { ...p }; delete n[destination]; return n; });
        setMsg(`✅ ${destination} 저장 완료`);
      } else {
        const j = await res.json();
        setMsg(`❌ ${j.error}`);
      }
    } finally {
      setSaving(p => ({ ...p, [destination]: false }));
      setTimeout(() => setMsg(''), 3000);
    }
  }

  // ── Haiku 타이틀 자동생성 ───────────────────────────────────
  async function autoGenTagline(destination: string) {
    setSaving(p => ({ ...p, [destination]: true }));
    setMsg(`⏳ ${destination} 타이틀 생성 중...`);
    try {
      const res = await fetch(`/api/destinations/${encodeURIComponent(destination)}`, { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        setRows(prev =>
          prev.map(r =>
            r.destination === destination
              ? { ...r, metadata: { tagline: null, hero_tagline: null, hero_image_url: null, photo_approved: false, ...r.metadata, ...json.data } }
              : r
          )
        );
        setMsg(`✅ ${destination} 타이틀 생성 완료`);
      } else {
        setMsg(`❌ ${json.error}`);
      }
    } finally {
      setSaving(p => ({ ...p, [destination]: false }));
      setTimeout(() => setMsg(''), 4000);
    }
  }

  // ── 미설정 전체 자동생성 ────────────────────────────────────
  async function bulkAutoGen() {
    const targets = rows.filter(r => !r.metadata?.tagline);
    setAutoGenProgress({ current: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      await autoGenTagline(targets[i].destination);
      setAutoGenProgress({ current: i + 1, total: targets.length });
      await new Promise(r => setTimeout(r, 500));
    }
    setAutoGenProgress(null);
  }

  // ── Pexels 검색 ─────────────────────────────────────────────
  const DEFAULT_KEYWORD = (destination: string) => `${destination} travel landscape`;

  async function searchPexels(destination: string) {
    const state = photoSearch[destination];
    const keyword = state?.keyword || DEFAULT_KEYWORD(destination);
    setPhotoSearch(p => ({ ...p, [destination]: { ...p[destination], loading: true, keyword } }));
    try {
      const res = await fetch(`/api/destinations/hero-photo?destination=${encodeURIComponent(destination)}&keyword=${encodeURIComponent(keyword)}`);
      const json = await res.json();
      setPhotoSearch(p => ({ ...p, [destination]: { keyword, results: json.photos || [], loading: false } }));
    } catch {
      setPhotoSearch(p => ({ ...p, [destination]: { keyword, results: [], loading: false } }));
    }
  }

  // ── Pexels → Storage 저장 ────────────────────────────────────
  async function saveHeroPhoto(destination: string, photo: PexelsResult) {
    setSaving(p => ({ ...p, [destination]: true }));
    setMsg(`⏳ ${destination} 사진 Storage 저장 중...`);
    try {
      const res = await fetch('/api/destinations/hero-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination,
          pexels_id: photo.id,
          src_large: photo.src_large,
          photographer: photo.photographer,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setRows(prev =>
          prev.map(r =>
            r.destination === destination
              ? { ...r, metadata: { tagline: null, hero_tagline: null, photo_approved: false, ...r.metadata, hero_image_url: json.public_url } }
              : r
          )
        );
        setMsg(`✅ ${destination} 사진 저장 완료 (승인 필요)`);
      } else {
        setMsg(`❌ ${json.error}`);
      }
    } finally {
      setSaving(p => ({ ...p, [destination]: false }));
      setTimeout(() => setMsg(''), 4000);
    }
  }

  // ── 승인 토글 ────────────────────────────────────────────────
  async function toggleApprove(destination: string, current: boolean) {
    await patchMeta(destination, { photo_approved: !current });
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] p-6">
      <div className="max-w-6xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black text-slate-900">여행지 관리</h1>
            <p className="text-sm text-slate-500 mt-1">
              destination_metadata · 히어로 사진 · 어드민 승인 게이트
            </p>
          </div>
          <div className="flex gap-2">
            {autoGenProgress ? (
              <span className="text-sm text-slate-600 bg-white border border-slate-200 px-4 py-2 rounded-lg">
                ⏳ 자동생성 {autoGenProgress.current}/{autoGenProgress.total}
              </span>
            ) : (
              <button
                onClick={bulkAutoGen}
                className="text-sm font-semibold bg-[#3182F6] text-white px-4 py-2 rounded-lg hover:bg-[#2563eb] transition"
              >
                ✨ 미설정 전체 자동생성
              </button>
            )}
          </div>
        </div>

        {/* 알림 */}
        {msg && (
          <div className="mb-4 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700">
            {msg}
          </div>
        )}

        {/* 필터 + 검색 */}
        <div className="flex flex-wrap gap-2 mb-5">
          {(['all', 'missing', 'pending', 'approved'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-sm font-semibold px-3.5 py-1.5 rounded-full transition ${
                filter === f
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
              }`}
            >
              {f === 'all' ? '전체' : f === 'missing' ? '🔴 미설정' : f === 'pending' ? '⚠️ 미승인' : '✅ 완료'}
              {f === 'all' && ` (${rows.length})`}
              {f === 'missing' && ` (${rows.filter(r => !r.metadata).length})`}
              {f === 'pending' && ` (${rows.filter(r => r.metadata && !r.metadata.photo_approved).length})`}
              {f === 'approved' && ` (${rows.filter(r => r.metadata?.photo_approved).length})`}
            </button>
          ))}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="여행지 검색..."
            className="ml-auto text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#3182F6] w-40"
          />
        </div>

        {/* 목록 */}
        {loading ? (
          <div className="text-center py-20 text-slate-400">로딩 중...</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(row => {
              const status = statusBadge(row.metadata);
              const isExpanded = expanded === row.destination;
              const edit = editing[row.destination] || {};
              const ps = photoSearch[row.destination];

              return (
                <div key={row.destination} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {/* 요약 행 */}
                  <div
                    className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50 transition"
                    onClick={() => setExpanded(isExpanded ? null : row.destination)}
                  >
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${status.color}`}>
                      {status.icon} {status.label}
                    </span>
                    <span className="font-bold text-slate-900 flex-1">{row.destination}</span>
                    <span className="text-sm text-slate-400">{row.package_count}개 상품</span>
                    {row.metadata?.tagline && (
                      <span className="text-sm text-slate-500 hidden md:inline truncate max-w-[200px]">
                        {row.metadata.tagline}
                      </span>
                    )}
                    <span className="text-slate-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                  </div>

                  {/* 확장 패널 */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 p-5 space-y-6">
                      {/* 타이틀 편집 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1.5">TAGLINE (H1)</label>
                          <div className="flex gap-2">
                            <input
                              value={edit.tagline ?? row.metadata?.tagline ?? ''}
                              onChange={e => setEditing(p => ({ ...p, [row.destination]: { ...p[row.destination], tagline: e.target.value } }))}
                              placeholder="감성 타이틀 입력..."
                              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#3182F6]"
                            />
                            <button
                              onClick={() => autoGenTagline(row.destination)}
                              disabled={saving[row.destination]}
                              className="text-xs bg-violet-100 text-violet-700 font-bold px-3 py-2 rounded-lg hover:bg-violet-200 transition disabled:opacity-50 whitespace-nowrap"
                            >
                              ✨ Haiku
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1.5">HERO_TAGLINE (서브설명)</label>
                          <input
                            value={edit.hero_tagline ?? row.metadata?.hero_tagline ?? ''}
                            onChange={e => setEditing(p => ({ ...p, [row.destination]: { ...p[row.destination], hero_tagline: e.target.value } }))}
                            placeholder="1~2문장 서브 설명..."
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#3182F6]"
                          />
                        </div>
                      </div>

                      {Object.keys(edit).length > 0 && (
                        <button
                          onClick={() => patchMeta(row.destination, edit)}
                          disabled={saving[row.destination]}
                          className="text-sm font-bold bg-slate-900 text-white px-5 py-2 rounded-lg hover:bg-slate-700 transition disabled:opacity-50"
                        >
                          {saving[row.destination] ? '저장 중...' : '💾 저장'}
                        </button>
                      )}

                      {/* 히어로 사진 */}
                      <div>
                        <label className="text-xs font-bold text-slate-500 block mb-3">히어로 사진</label>

                        {/* 현재 사진 */}
                        {row.metadata?.hero_image_url && (
                          <div className="mb-4 flex items-start gap-4">
                            <img
                              src={row.metadata.hero_image_url}
                              alt="현재 히어로"
                              className="w-40 h-24 object-cover rounded-lg border border-slate-200"
                            />
                            <div className="flex flex-col gap-2">
                              <span className={`text-xs font-bold px-2.5 py-1 rounded-full w-fit ${
                                row.metadata.photo_approved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {row.metadata.photo_approved ? '✅ 고객 노출 중' : '⚠️ 미승인 (고객 미노출)'}
                              </span>
                              <button
                                onClick={() => toggleApprove(row.destination, row.metadata!.photo_approved)}
                                disabled={saving[row.destination]}
                                className={`text-sm font-bold px-4 py-1.5 rounded-lg transition disabled:opacity-50 ${
                                  row.metadata.photo_approved
                                    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                                    : 'bg-emerald-500 text-white hover:bg-emerald-600'
                                }`}
                              >
                                {row.metadata.photo_approved ? '🔒 승인 취소' : '✅ 승인 (고객 노출)'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Pexels 검색 */}
                        <div className="flex gap-2 mb-3">
                          <input
                            value={ps?.keyword ?? DEFAULT_KEYWORD(row.destination)}
                            onChange={e => setPhotoSearch(p => ({ ...p, [row.destination]: { ...p[row.destination], keyword: e.target.value, results: p[row.destination]?.results || [] } }))}
                            placeholder="Pexels 검색 키워드..."
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#3182F6]"
                            onKeyDown={e => e.key === 'Enter' && searchPexels(row.destination)}
                          />
                          <button
                            onClick={() => searchPexels(row.destination)}
                            disabled={ps?.loading}
                            className="text-sm font-bold bg-[#3182F6] text-white px-4 py-2 rounded-lg hover:bg-[#2563eb] transition disabled:opacity-50"
                          >
                            {ps?.loading ? '검색 중...' : '🔍 검색'}
                          </button>
                        </div>

                        {/* Pexels 결과 */}
                        {ps?.results && ps.results.length > 0 && (
                          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                            {ps.results.map(photo => (
                              <div key={photo.id} className="relative group">
                                <img
                                  src={photo.src_thumb}
                                  alt={photo.alt}
                                  className="w-full aspect-video object-cover rounded-lg border border-slate-200 cursor-pointer group-hover:border-[#3182F6] transition"
                                  title={`© ${photo.photographer}`}
                                />
                                <button
                                  onClick={() => saveHeroPhoto(row.destination, photo)}
                                  disabled={saving[row.destination]}
                                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition rounded-lg flex items-center justify-center text-white text-xs font-bold"
                                >
                                  저장
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {ps && !ps.loading && ps.results.length === 0 && (
                          <p className="text-sm text-slate-400">검색 결과 없음. 키워드를 영어로 바꿔보세요.</p>
                        )}
                      </div>

                      {/* 고객 페이지 링크 */}
                      <div className="flex gap-3 pt-2 border-t border-slate-100">
                        <a
                          href={`/destinations/${encodeURIComponent(row.destination)}`}
                          target="_blank"
                          rel="noopener"
                          className="text-xs text-[#3182F6] hover:underline font-medium"
                        >
                          → 고객 페이지 미리보기
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filtered.length === 0 && !loading && (
              <div className="text-center py-20 text-slate-400">
                {search ? `"${search}" 검색 결과 없음` : '해당 조건의 여행지가 없습니다.'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
