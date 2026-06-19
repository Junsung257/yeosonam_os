'use client';

import { useState, useEffect } from 'react';

/* ── 타입 ── */
interface BrandKit {
  id: string;
  code: string;
  name: string;
  colors: Record<string, string>;
  fonts: Record<string, string>;
  logo_text: string | null;
  logo_url: string | null;
  logo_light_url: string | null;
  domain: string | null;
  voice_guide: string | null;
  voice_samples: Array<{ platform: string; text: string }> | null;
  is_active: boolean;
  owner_type: string;
  owner_id: string;
  brand_name: string;
  brand_tagline: string | null;
  watermark_text: string | null;
  watermark_enabled: boolean;
  social_links: Record<string, string>;
  created_at: string;
  updated_at: string;
}

const COLOR_KEYS = ['primary', 'accent', 'ink', 'mute', 'surface'] as const;
const DEFAULT_COLORS: Record<string, string> = {
  primary: '#001f3f',
  accent: '#005d90',
  ink: '#1a1a2e',
  mute: '#6b7280',
  surface: '#f8f9fb',
};
const DEFAULT_FONTS: Record<string, string> = {
  sans: 'Pretendard',
  serif: 'Noto Serif KR',
  mono: 'D2Coding',
};

const emptyKit = (): BrandKit => ({
  id: '',
  code: '',
  name: '',
  colors: { ...DEFAULT_COLORS },
  fonts: { ...DEFAULT_FONTS },
  logo_text: null,
  logo_url: null,
  logo_light_url: null,
  domain: null,
  voice_guide: null,
  voice_samples: null,
  is_active: true,
  owner_type: 'platform',
  owner_id: '00000000-0000-0000-0000-000000000000',
  brand_name: '',
  brand_tagline: null,
  watermark_text: null,
  watermark_enabled: true,
  social_links: {},
  created_at: '',
  updated_at: '',
});

export default function BrandKitsPage() {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchKits = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/brand-kits?all=true');
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
    setIsNew(false);
    setSaveMsg('');
  };

  const openNew = () => {
    setEditing(emptyKit());
    setIsNew(true);
    setSaveMsg('');
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveMsg('');

    try {
      let res: Response;
      if (isNew) {
        res = await fetch('/api/brand-kits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing),
        });
      } else {
        res = await fetch(`/api/brand-kits/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing),
        });
      }

      const data = await res.json();
      if (res.ok) {
        setSaveMsg('저장됨');
        if (data.brand_kit) setEditing(data.brand_kit);
        setIsNew(false);
        fetchKits();
      } else {
        setSaveMsg(data.error ?? '저장 실패');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/brand-kits/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      setDeleteConfirm(null);
      if (editing?.id === id) setEditing(null);
      fetchKits();
    } else {
      alert(data.error ?? '삭제 실패');
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
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-admin-text">브랜드킷 관리</h1>
          <p className="text-sm text-admin-muted">카드뉴스·블로그·소셜에 주입되는 브랜드 토큰과 보이스 가이드</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
        >
          + 새 브랜드킷
        </button>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-admin-md border border-admin-border shadow-sm p-5 space-y-3">
              <div className="h-4 bg-gray-100 rounded animate-pulse w-36" />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-full" />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
            </div>
          ))}
        </div>
      ) : kits.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 bg-white rounded-xl border">
          <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
          </svg>
          <p className="text-sm font-medium text-gray-400">브랜드킷이 없습니다.</p>
          <button onClick={openNew} className="text-xs text-amber-600 hover:text-amber-700 underline">
            첫 브랜드킷 만들기 →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {kits.map(kit => (
            <div key={kit.id} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{kit.code}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    kit.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {kit.is_active ? '활성' : '비활성'}
                  </span>
                </div>
                <span className="text-[10px] text-gray-400">{kit.owner_type}</span>
              </div>

              <div>
                <p className="font-semibold text-gray-900">{kit.name || kit.code}</p>
                {kit.domain && <p className="text-xs text-gray-400">{kit.domain}</p>}
              </div>

              {/* 컬러 스와치 */}
              <div className="flex gap-1.5 flex-wrap">
                {COLOR_KEYS.map(k => (
                  kit.colors?.[k] ? (
                    <div key={k}
                      title={`${k}: ${kit.colors[k]}`}
                      style={{ background: kit.colors[k] }}
                      className="w-5 h-5 rounded-full border border-white shadow-sm" />
                  ) : null
                ))}
              </div>

              {kit.voice_guide && (
                <p className="text-xs text-gray-400 line-clamp-1">
                  &ldquo;{kit.voice_guide.slice(0, 80)}{kit.voice_guide.length > 80 ? '…' : ''}&rdquo;
                </p>
              )}

              <div className="flex items-center justify-between pt-1">
                <p className="text-[10px] text-gray-400">{kit.updated_at?.slice(0, 10)}</p>
                <button
                  onClick={() => openEdit(kit)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 font-medium"
                >
                  편집
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── 편집/생성 사이드 패널 ─── */}
      {editing && (
        <>
          <button
            type="button"
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
            onClick={() => { setEditing(null); setIsNew(false); }}
            aria-label="브랜드킷 편집 패널 닫기"
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white z-50 flex flex-col border-l shadow-xl">
            {/* 패널 헤더 */}
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                  {isNew ? '신규' : editing.code}
                </span>
                <h2 className="text-lg font-bold text-gray-900 mt-1">
                  {isNew ? '새 브랜드킷 생성' : `${editing.name || editing.code} 편집`}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {!isNew && (
                  <button
                    onClick={() => setDeleteConfirm(editing.id)}
                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
                  >
                    삭제
                  </button>
                )}
                <button
                  onClick={() => { setEditing(null); setIsNew(false); }}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 기본 정보 */}
              <Section title="기본 정보">
                <Field label="Code (고유 식별자)">
                  <input value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value })}
                    placeholder="yeosonam"
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
                </Field>
                <Field label="이름">
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </Field>
                <Field label="브랜드명 (카드 표시)">
                  <input value={editing.brand_name} onChange={e => setEditing({ ...editing, brand_name: e.target.value })}
                    placeholder="여소남" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </Field>
                <Field label="태그라인">
                  <input value={editing.brand_tagline ?? ''} onChange={e => setEditing({ ...editing, brand_tagline: e.target.value || null })}
                    placeholder="당신의 완벽한 여행 파트너" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="로고 텍스트 (대체)">
                    <input value={editing.logo_text ?? ''} onChange={e => setEditing({ ...editing, logo_text: e.target.value || null })}
                      placeholder="YEOSONAM" className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </Field>
                  <Field label="도메인">
                    <input value={editing.domain ?? ''} onChange={e => setEditing({ ...editing, domain: e.target.value || null })}
                      placeholder="yeosonam.com" className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </Field>
                </div>
                <Field label="로고 URL (밝은 배경)">
                  <input value={editing.logo_url ?? ''} onChange={e => setEditing({ ...editing, logo_url: e.target.value || null })}
                    placeholder="https://..." className="w-full border rounded-lg px-3 py-2 text-sm" />
                </Field>
                <Field label="로고 URL (어두운 배경)">
                  <input value={editing.logo_light_url ?? ''} onChange={e => setEditing({ ...editing, logo_light_url: e.target.value || null })}
                    placeholder="https://..." className="w-full border rounded-lg px-3 py-2 text-sm" />
                </Field>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={editing.is_active}
                      onChange={e => setEditing({ ...editing, is_active: e.target.checked })} className="rounded" />
                    <span className="text-sm">활성</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={editing.watermark_enabled}
                      onChange={e => setEditing({ ...editing, watermark_enabled: e.target.checked })} className="rounded" />
                    <span className="text-sm">워터마크</span>
                  </label>
                </div>
                <Field label="워터마크 텍스트">
                  <input value={editing.watermark_text ?? ''} onChange={e => setEditing({ ...editing, watermark_text: e.target.value || null })}
                    placeholder="여소남 제공" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </Field>
              </Section>

              {/* 컬러 팔레트 (5색 - 간소화) */}
              <Section title="컬러 팔레트">
                <p className="text-[11px] text-gray-400 -mt-2">카드뉴스·블로그에 적용되는 브랜드 컬러</p>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {COLOR_KEYS.map(k => (
                    <div key={k} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                      <input type="color" value={editing.colors?.[k] || '#000000'}
                        onChange={e => setColor(k, e.target.value)}
                        className="w-9 h-9 rounded-lg cursor-pointer border border-gray-200" />
                      <div className="flex-1">
                        <p className="text-[11px] font-medium text-gray-500">{k}</p>
                        <input value={editing.colors?.[k] || ''} onChange={e => setColor(k, e.target.value)}
                          placeholder="#000000"
                          className="text-[11px] font-mono text-gray-600 w-24 bg-transparent border-none outline-none" />
                      </div>
                    </div>
                  ))}
                </div>
                {/* 미리보기 */}
                <div className="flex h-8 rounded-lg overflow-hidden mt-2">
                  {COLOR_KEYS.map(k => (
                    <div key={k} style={{ background: editing.colors?.[k] || '#ccc' }}
                      className="flex-1" title={k} />
                  ))}
                </div>
              </Section>

              {/* 폰트 */}
              <Section title="폰트">
                <div className="grid grid-cols-3 gap-2">
                  {['sans', 'serif', 'mono'].map(k => (
                    <div key={k}>
                      <label className="text-[11px] text-gray-500 block mb-1">{k}</label>
                      <input value={editing.fonts?.[k] || ''} onChange={e => setFont(k, e.target.value)}
                        placeholder="Pretendard" className="w-full border rounded-lg px-2 py-1.5 text-xs" />
                    </div>
                  ))}
                </div>
              </Section>

              {/* 보이스 가이드 */}
              <Section title="브랜드 보이스 가이드">
                <p className="text-[11px] text-gray-400 -mt-2">AI 생성 시 LLM에 주입되는 톤앤매너 지침</p>
                <textarea
                  value={editing.voice_guide ?? ''}
                  onChange={e => setEditing({ ...editing, voice_guide: e.target.value || null })}
                  placeholder="예: 여소남은 20-40대 여행 애호가를 위한 브랜드로, 따뜻하고 전문적인 톤을 사용합니다..."
                  className="w-full border rounded-lg px-3 py-2 text-sm h-28 resize-none focus:ring-1 focus:ring-blue-300 mt-1"
                />
              </Section>

              {/* 보이스 샘플 */}
              <Section title="보이스 샘플 (Few-shot)">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-gray-400">AI가 글을 쓸 때 참조할 실제 카피 예시</p>
                  <button onClick={addVoiceSample}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                    + 추가
                  </button>
                </div>
                {(editing.voice_samples ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">샘플 없음</p>
                ) : (
                  <div className="space-y-2 mt-2">
                    {(editing.voice_samples ?? []).map((s, i) => (
                      <div key={i} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <select value={s.platform} onChange={e => updateVoiceSample(i, 'platform', e.target.value)}
                            className="text-xs border rounded px-2 py-1">
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
                          className="w-full text-xs border rounded px-2 py-1.5 h-16 resize-none" />
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* 소셜 링크 */}
              <Section title="소셜 링크">
                {['instagram', 'facebook', 'twitter', 'youtube', 'blog', 'threads'].map(platform => (
                  <Field key={platform} label={platform}>
                    <input
                      value={editing.social_links?.[platform] ?? ''}
                      onChange={e => setEditing({
                        ...editing,
                        social_links: { ...(editing.social_links || {}), [platform]: e.target.value },
                      })}
                      placeholder={`https://${platform}.com/...`}
                      className="w-full border rounded-lg px-3 py-2 text-xs"
                    />
                  </Field>
                ))}
              </Section>

              {/* 소유자 정보 */}
              {!isNew && (
                <Section title="소유자 정보">
                  <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                    <div>
                      <p className="text-gray-400 mb-1">Owner Type</p>
                      <p className="font-mono">{editing.owner_type}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 mb-1">Owner ID</p>
                      <p className="font-mono text-[10px]">{editing.owner_id}</p>
                    </div>
                  </div>
                </Section>
              )}
            </div>

            {/* 하단 저장 버튼 */}
            <div className="px-6 py-4 border-t flex items-center gap-3 bg-gray-50">
              {saveMsg && (
                <span className={`text-xs ${saveMsg === '저장됨' ? 'text-green-600' : 'text-red-500'}`}>
                  {saveMsg}
                </span>
              )}
              <div className="ml-auto flex gap-3">
                <button onClick={() => { setEditing(null); setIsNew(false); }}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                  닫기
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? '저장 중...' : isNew ? '생성' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 삭제 확인 다이얼로그 */}
      {deleteConfirm && (
        <>
          <button
            type="button"
            className="fixed inset-0 bg-black/30 z-50"
            onClick={() => setDeleteConfirm(null)}
            aria-label="브랜드킷 삭제 확인 닫기"
          />
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 pointer-events-auto">
              <h3 className="font-semibold text-gray-900 mb-2">브랜드킷 삭제</h3>
              <p className="text-sm text-gray-500 mb-4">정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                  취소
                </button>
                <button onClick={() => handleDelete(deleteConfirm)}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">
                  삭제
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── 헬퍼 컴포넌트 ─── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}
