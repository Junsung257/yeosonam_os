'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface BrandKit {
  id: string;
  code: string;
  name: string;
  colors: Record<string, string>;
  fonts: Record<string, string>;
  logo_text: string | null;
  logo_url: string | null;
  domain: string | null;
  voice_guide: string | null;
  voice_samples: Array<{ platform: string; text: string }> | null;
  is_active: boolean;
  updated_at: string;
}

const COLOR_KEYS = ['primary', 'accent', 'ink', 'mute', 'surface', 'inverse', 'danger', 'success', 'gold'] as const;

export default function BrandKitsPage() {
  const router = useRouter();
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const fetchKits = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/brand-kits');
      if (!res.ok) { setKits([]); return; }
      const data = await res.json();
      setKits(data.brand_kits ?? []);
    } catch {
      setKits([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchKits(); }, []);

  const openEdit = async (kit: BrandKit) => {
    try {
      const res = await fetch(`/api/brand-kits/${kit.id}`);
      const data = res.ok ? await res.json() : null;
      setEditing(data?.brand_kit ?? kit);
    } catch {
      setEditing(kit);
    }
    setSaveMsg('');
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/brand-kits/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editing.name,
          colors: editing.colors,
          fonts: editing.fonts,
          logo_text: editing.logo_text,
          logo_url: editing.logo_url,
          domain: editing.domain,
          voice_guide: editing.voice_guide,
          voice_samples: editing.voice_samples,
          is_active: editing.is_active,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveMsg('저장됨');
        setEditing(data.brand_kit);
        fetchKits();
      } else {
        setSaveMsg(data.error ?? '저장 실패');
      }
    } finally {
      setSaving(false);
    }
  };

  const setColor = (key: string, val: string) => {
    if (!editing) return;
    setEditing({ ...editing, colors: { ...editing.colors, [key]: val } });
  };

  const setFont = (key: string, val: string) => {
    if (!editing) return;
    setEditing({ ...editing, fonts: { ...editing.fonts, [key]: val } });
  };

  const addVoiceSample = () => {
    if (!editing) return;
    setEditing({
      ...editing,
      voice_samples: [...(editing.voice_samples ?? []), { platform: 'instagram', text: '' }],
    });
  };

  const updateVoiceSample = (i: number, field: 'platform' | 'text', val: string) => {
    if (!editing) return;
    const samples = [...(editing.voice_samples ?? [])];
    samples[i] = { ...samples[i], [field]: val };
    setEditing({ ...editing, voice_samples: samples });
  };

  const removeVoiceSample = (i: number) => {
    if (!editing) return;
    setEditing({
      ...editing,
      voice_samples: (editing.voice_samples ?? []).filter((_, idx) => idx !== i),
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">브랜드킷 관리</h1>
          <p className="text-sm text-slate-500">카드뉴스·블로그·인스타에 주입되는 브랜드 토큰·보이스 가이드</p>
        </div>
        <button
          onClick={() => router.push('/admin/marketing')}
          className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          ← 대시보드
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 space-y-3">
              <div className="h-4 bg-slate-100 rounded animate-pulse w-36" />
              <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
              <div className="h-3 bg-slate-100 rounded animate-pulse w-2/3" />
            </div>
          ))}
        </div>
      ) : kits.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <svg className="w-10 h-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" /></svg>
          <p className="text-admin-sm font-medium text-slate-500">브랜드킷이 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {kits.map(kit => (
            <div key={kit.id} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{kit.code}</span>
                  <p className="font-semibold text-slate-800 mt-1">{kit.name}</p>
                  {kit.domain && <p className="text-xs text-slate-400">{kit.domain}</p>}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${kit.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {kit.is_active ? '활성' : '비활성'}
                </span>
              </div>

              {/* 컬러 스와치 */}
              <div className="flex gap-1.5 flex-wrap">
                {COLOR_KEYS.map(k => (
                  kit.colors?.[k] ? (
                    <div key={k} title={`${k}: ${kit.colors[k]}`}
                      style={{ background: kit.colors[k] }}
                      className="w-6 h-6 rounded-full border border-white shadow-sm" />
                  ) : null
                ))}
              </div>

              <p className="text-xs text-slate-400 line-clamp-2">
                {kit.voice_guide ? `"${kit.voice_guide.slice(0, 100)}${kit.voice_guide.length > 100 ? '…' : ''}"` : '보이스 가이드 없음'}
              </p>

              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-300">{kit.updated_at?.slice(0, 10)}</p>
                <button
                  onClick={() => openEdit(kit)}
                  className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 font-medium"
                >
                  편집
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 편집 패널 */}
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={() => setEditing(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white z-50 flex flex-col border-l border-slate-200 shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{editing.code}</span>
                <h2 className="text-admin-lg font-bold text-slate-800 mt-1">{editing.name} 편집</h2>
              </div>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 기본 정보 */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">기본 정보</h3>
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">이름</label>
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">로고 텍스트</label>
                    <input value={editing.logo_text ?? ''} onChange={e => setEditing({ ...editing, logo_text: e.target.value || null })}
                      placeholder="YEOSONAM" className="w-full border border-slate-200 rounded px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">도메인</label>
                    <input value={editing.domain ?? ''} onChange={e => setEditing({ ...editing, domain: e.target.value || null })}
                      placeholder="yeosonam.com" className="w-full border border-slate-200 rounded px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">로고 URL (이미지)</label>
                  <input value={editing.logo_url ?? ''} onChange={e => setEditing({ ...editing, logo_url: e.target.value || null })}
                    placeholder="https://..." className="w-full border border-slate-200 rounded px-3 py-2 text-sm" />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="is_active" checked={editing.is_active}
                    onChange={e => setEditing({ ...editing, is_active: e.target.checked })}
                    className="rounded" />
                  <label htmlFor="is_active" className="text-sm text-slate-700">활성 상태</label>
                </div>
              </section>

              {/* 컬러 팔레트 */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">컬러 팔레트</h3>
                <div className="grid grid-cols-2 gap-2">
                  {COLOR_KEYS.map(k => (
                    <div key={k} className="flex items-center gap-2">
                      <input type="color" value={editing.colors?.[k] || '#000000'}
                        onChange={e => setColor(k, e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-slate-200" />
                      <div>
                        <p className="text-[11px] font-medium text-slate-600">{k}</p>
                        <input value={editing.colors?.[k] || ''} onChange={e => setColor(k, e.target.value)}
                          placeholder="#000000" className="text-[11px] font-mono text-slate-500 w-20 border-none outline-none" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 폰트 */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">폰트</h3>
                <div className="grid grid-cols-3 gap-2">
                  {['sans', 'serif', 'mono'].map(k => (
                    <div key={k}>
                      <label className="text-[11px] text-slate-500 block mb-1">{k}</label>
                      <input value={editing.fonts?.[k] || ''} onChange={e => setFont(k, e.target.value)}
                        placeholder="Pretendard" className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs" />
                    </div>
                  ))}
                </div>
              </section>

              {/* 보이스 가이드 */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">브랜드 보이스 가이드</h3>
                <p className="text-[11px] text-slate-400">카드뉴스·블로그 AI 생성 시 LLM에 주입되는 브랜드 톤앤매너 지침</p>
                <textarea
                  value={editing.voice_guide ?? ''}
                  onChange={e => setEditing({ ...editing, voice_guide: e.target.value || null })}
                  placeholder="예: 여소남은 20-40대 여행 애호가를 위한 브랜드로, 따뜻하고 전문적인 톤을 사용합니다. 직접 화법보다는 경험을 공유하는 방식으로 작성하며..."
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm h-28 resize-none focus:ring-1 focus:ring-blue-300"
                />
              </section>

              {/* 보이스 샘플 */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">보이스 샘플 (Few-shot)</h3>
                  <button onClick={addVoiceSample}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                    + 추가
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">AI가 글을 쓸 때 참조할 실제 카피 예시. 많을수록 일관성↑</p>
                {(editing.voice_samples ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400 italic">샘플 없음</p>
                ) : (
                  <div className="space-y-2">
                    {(editing.voice_samples ?? []).map((s, i) => (
                      <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <select value={s.platform} onChange={e => updateVoiceSample(i, 'platform', e.target.value)}
                            className="text-xs border border-slate-200 rounded px-2 py-1">
                            <option value="instagram">Instagram</option>
                            <option value="blog">Blog</option>
                            <option value="meta_ads">Meta Ads</option>
                            <option value="threads">Threads</option>
                            <option value="general">General</option>
                          </select>
                          <button onClick={() => removeVoiceSample(i)}
                            className="ml-auto text-xs text-red-400 hover:text-red-600">삭제</button>
                        </div>
                        <textarea value={s.text} onChange={e => updateVoiceSample(i, 'text', e.target.value)}
                          placeholder="실제 카피 예시를 입력하세요..."
                          className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 h-16 resize-none" />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* 하단 저장 버튼 */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
              {saveMsg && (
                <span className={`text-xs ${saveMsg === '저장됨' ? 'text-green-600' : 'text-red-500'}`}>
                  {saveMsg}
                </span>
              )}
              <div className="ml-auto flex gap-3">
                <button onClick={() => setEditing(null)}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                  닫기
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
