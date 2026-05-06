'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { ContentBrief } from '@/lib/validators/content-brief';
import { TEMPLATE_META, TEMPLATE_IDS } from '@/lib/card-news/tokens';

interface Package { id: string; title: string; destination: string; status: string; }
interface Category { id: string; label: string; key: string; scope: string; }

const ANGLES: { key: string; label: string; description: string }[] = [
  { key: 'value',     label: '가성비',    description: '가격·포함사항 강조' },
  { key: 'emotional', label: '감성',      description: '풍경·감정 강조' },
  { key: 'filial',    label: '효도',      description: '안심·편안 강조' },
  { key: 'luxury',    label: '럭셔리',    description: '5성급·VIP 강조' },
  { key: 'urgency',   label: '긴급',      description: '마감임박·잔여석' },
  { key: 'activity',  label: '액티비티',  description: '관광지·체험 강조' },
  { key: 'food',      label: '미식',      description: '특식·맛집 강조' },
];

export default function CardNewsNewWizardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 블로그 편집 → "이 글로 카드뉴스 만들기" 진입 시 prefill
  const prefilledPackageId = searchParams.get('package_id') || '';
  const prefilledAngle = searchParams.get('angle') || '';

  // ── 단계 ─────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Step 1 입력 ──────────────────────────────────────
  const [mode, setMode] = useState<'product' | 'info'>('product');
  const [packageId, setPackageId] = useState(prefilledPackageId);
  const [angle, setAngle] = useState(prefilledAngle || 'value');
  const [topic, setTopic] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [slideCount, setSlideCount] = useState(6);
  const [tone, setTone] = useState('professional');
  const [extraPrompt, setExtraPrompt] = useState('');

  // ── 외부 데이터 ──────────────────────────────────────
  const [packages, setPackages] = useState<Package[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pkgFilter, setPkgFilter] = useState('');

  // ── Step 2 Brief ─────────────────────────────────────
  const [brief, setBrief] = useState<ContentBrief | null>(null);
  const [briefProductId, setBriefProductId] = useState<string | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  // ── Step 3 카드뉴스 생성 ────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => {
        const all: Package[] = d.data ?? d.packages ?? [];
        setPackages(all.filter(p => ['approved', 'active', 'pending', 'pending_review', 'draft'].includes(p.status)));
      })
      .catch(() => setPackages([]));
    fetch('/api/blog-categories?scope=info')
      .then(r => r.json())
      .then(d => {
        const cats: Category[] = d.categories || [];
        setCategories(cats);
        if (cats.length > 0) setCategoryId(cats[0].id);
      })
      .catch(() => {});
  }, []);

  const filteredPackages = useMemo(() => {
    if (!pkgFilter.trim()) return packages;
    const q = pkgFilter.toLowerCase();
    return packages.filter(p =>
      p.title.toLowerCase().includes(q) || (p.destination || '').toLowerCase().includes(q)
    );
  }, [packages, pkgFilter]);

  const step1Valid = mode === 'product' ? !!packageId : !!topic.trim();

  // ── Step 1 → Brief 생성 ─────────────────────────────
  const handleGenerateBrief = async () => {
    setBriefError(null);
    setLoadingBrief(true);
    try {
      const body: Record<string, unknown> = {
        mode,
        slide_count: slideCount,
        tone,
        extra_prompt: extraPrompt,
      };
      if (mode === 'product') {
        body.package_id = packageId;
        body.angle = angle;
      } else {
        body.topic = topic.trim();
        const cat = categories.find(c => c.id === categoryId);
        if (cat) body.category = cat.label;
      }
      const res = await fetch('/api/content-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch {
        throw new Error(
          res.status === 504 || res.status === 502
            ? 'Brief 생성이 오래 걸려 타임아웃됐습니다. 슬라이드 수를 줄이거나 잠시 후 다시 시도해 주세요.'
            : `Brief 생성 실패 (HTTP ${res.status})`,
        );
      }
      if (!res.ok) throw new Error(data?.error || `Brief 생성 실패 (HTTP ${res.status})`);
      setBrief(data.brief);
      setBriefProductId(data.product_id || null);
      setStep(2);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingBrief(false);
    }
  };

  // ── Step 2 편집 헬퍼 ────────────────────────────────
  const updateBrief = (patch: Partial<ContentBrief>) => {
    setBrief(prev => prev ? { ...prev, ...patch } : prev);
  };
  const updateSection = (idx: number, patch: Partial<ContentBrief['sections'][number]>) => {
    setBrief(prev => {
      if (!prev) return prev;
      const next = [...prev.sections];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, sections: next };
    });
  };
  const updateSectionCard = (idx: number, patch: Partial<ContentBrief['sections'][number]['card_slide']>) => {
    setBrief(prev => {
      if (!prev) return prev;
      const next = [...prev.sections];
      next[idx] = { ...next[idx], card_slide: { ...next[idx].card_slide, ...patch } };
      return { ...prev, sections: next };
    });
  };

  // ── Step 2 → 카드뉴스 생성 ──────────────────────────
  const handleCreateCardNews = async () => {
    if (!brief) return;
    setCreateError(null);
    setCreating(true);
    setStep(3);
    try {
      const body: Record<string, unknown> = {
        brief,
        mode,
        slide_count: slideCount,
        tone,
        extra_prompt: extraPrompt,
      };
      if (mode === 'product') body.package_id = packageId || briefProductId;
      else {
        body.topic = topic.trim();
        if (categoryId) body.category_id = categoryId;
      }
      const res = await fetch('/api/card-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch {
        throw new Error(
          res.status === 504 || res.status === 502
            ? '카드뉴스 생성이 오래 걸려 타임아웃됐습니다. 슬라이드 수를 줄이거나 잠시 후 다시 시도해 주세요.'
            : `카드뉴스 생성 실패 (HTTP ${res.status})`,
        );
      }
      if (!res.ok || !data?.card_news?.id) throw new Error(data?.error || `카드뉴스 생성 실패 (HTTP ${res.status})`);
      router.push(`/admin/marketing/content-hub/${data.card_news.id}?source=new`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
      setStep(2);
      setCreating(false);
    }
  };

  // ── 렌더 ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">새 카드뉴스 생성</h1>
            <p className="text-sm text-slate-500 mt-1">3단계: 입력 → Brief 검토 → 카드뉴스 생성</p>
          </div>
          <Link
            href="/admin/marketing/card-news"
            className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white"
          >
            ← 목록
          </Link>
        </div>

        {/* 진행 표시 */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex items-center gap-2 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step >= n ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}>{n}</div>
              <div className="text-sm font-medium text-slate-700">
                {n === 1 ? '입력' : n === 2 ? 'Brief 검토' : '카드뉴스 생성'}
              </div>
              {n < 3 && <div className={`flex-1 h-px ${step > n ? 'bg-blue-600' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: 입력 */}
        {step === 1 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-6 space-y-5">
            {/* 모드 */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setMode('product')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md ${mode === 'product' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
              >상품 카드뉴스</button>
              <button
                onClick={() => setMode('info')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md ${mode === 'info' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
              >정보성 카드뉴스</button>
            </div>

            {mode === 'product' ? (
              <>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">
                    상품 선택 *
                    {prefilledPackageId && (
                      <span className="ml-2 normal-case font-normal text-emerald-600">
                        (블로그에서 진입 — 잠금)
                      </span>
                    )}
                  </label>
                  {prefilledPackageId ? (
                    // 블로그 편집 → "이 글로 카드뉴스" 진입 시 다른 상품으로 실수 변경 방지
                    <div className="border border-emerald-200 bg-emerald-50 rounded px-3 py-2 text-sm flex items-center justify-between">
                      <span className="text-slate-700">
                        {packages.find(p => p.id === packageId)?.title || '(상품 정보 로딩 중)'}
                        <span className="text-slate-400 ml-2">
                          ({packages.find(p => p.id === packageId)?.destination || '-'})
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('블로그에서 지정한 상품에서 변경하시겠습니까?\n다른 상품의 카드뉴스가 만들어집니다.')) {
                            router.replace('/admin/marketing/card-news/new');
                          }
                        }}
                        className="text-xs text-slate-500 hover:text-slate-700 underline"
                      >
                        변경
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={pkgFilter}
                        onChange={e => setPkgFilter(e.target.value)}
                        placeholder="상품명/지역 검색"
                        className="w-full border border-slate-200 rounded px-3 py-2 text-sm mb-2"
                      />
                      <select
                        value={packageId}
                        onChange={e => setPackageId(e.target.value)}
                        className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                        size={Math.min(8, Math.max(4, filteredPackages.length))}
                      >
                        {filteredPackages.map(p => (
                          <option key={p.id} value={p.id}>{p.title} ({p.destination})</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">앵글</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {ANGLES.map(a => (
                      <button
                        key={a.key}
                        onClick={() => setAngle(a.key)}
                        className={`px-3 py-2 text-sm rounded-lg border transition ${
                          angle === a.key
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <div className="font-medium">{a.label}</div>
                        <div className={`text-[10px] mt-0.5 ${angle === a.key ? 'text-white/80' : 'text-slate-400'}`}>
                          {a.description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">주제 *</label>
                  <input
                    value={topic}
                    onChange={e => setTopic(e.target.value)}
                    placeholder="예: 베트남 비자 신청 방법, 다낭 여행 준비물"
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">카테고리</label>
                  <select
                    value={categoryId}
                    onChange={e => setCategoryId(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                  >
                    {categories.length === 0 ? (
                      <option value="">(카테고리 없음)</option>
                    ) : (
                      categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)
                    )}
                  </select>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">
                  슬라이드 개수: <span className="font-bold text-blue-600">{slideCount}장</span>
                </label>
                <input
                  type="range" min={3} max={10} value={slideCount}
                  onChange={e => setSlideCount(parseInt(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">톤</label>
                <select
                  value={tone} onChange={e => setTone(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                >
                  <option value="professional">전문가 (신뢰감)</option>
                  <option value="casual">캐주얼 (친근)</option>
                  <option value="emotional">감성적 (감동)</option>
                  <option value="humorous">유머러스 (재미)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">추가 지시사항 (선택)</label>
              <textarea
                value={extraPrompt} onChange={e => setExtraPrompt(e.target.value)}
                placeholder="예: 5성급 호텔 강조, 20대 타겟, 해시태그 많이..."
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm h-20 resize-none"
              />
            </div>

            {briefError && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {briefError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                onClick={handleGenerateBrief}
                disabled={!step1Valid || loadingBrief}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loadingBrief ? 'Brief 생성 중...' : 'Brief 생성 →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Brief 검토 + 편집 */}
        {step === 2 && brief && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-6 space-y-5">
            {/* 메타 */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">H1 (블로그 제목)</label>
              <input
                value={brief.h1}
                onChange={e => updateBrief({ h1: e.target.value })}
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-bold text-slate-900"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">타겟 고객층</label>
              <input
                value={brief.target_audience}
                onChange={e => updateBrief({ target_audience: e.target.value })}
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">핵심 셀링포인트</label>
              <div className="flex flex-wrap gap-2">
                {brief.key_selling_points.map((p, i) => (
                  <span key={i} className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded">{p}</span>
                ))}
              </div>
            </div>

            {/* 섹션 편집 */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase block mb-2">
                섹션 {brief.sections.length}개 (각 H2 = 카드뉴스 슬라이드 1장)
              </label>
              <div className="space-y-3">
                {brief.sections.map((s, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 bg-slate-100 rounded px-2 py-0.5">
                        {String(s.position).padStart(2, '0')}
                      </span>
                      <span className="text-xs text-slate-400">{s.role}</span>
                    </div>
                    <input
                      value={s.h2}
                      onChange={e => updateSection(i, { h2: e.target.value })}
                      placeholder="H2"
                      className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm font-semibold"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={s.card_slide.headline}
                        onChange={e => updateSectionCard(i, { headline: e.target.value })}
                        placeholder="슬라이드 헤드라인 (≤15자)"
                        maxLength={20}
                        className={`border rounded px-2 py-1.5 text-sm ${s.card_slide.headline.length > 15 ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}
                      />
                      <input
                        value={s.card_slide.body}
                        onChange={e => updateSectionCard(i, { body: e.target.value })}
                        placeholder="슬라이드 본문 (≤40자)"
                        maxLength={50}
                        className={`border rounded px-2 py-1.5 text-sm ${s.card_slide.body.length > 40 ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">템플릿:</span>
                      <select
                        value={s.card_slide.template_suggestion}
                        onChange={e => updateSectionCard(i, { template_suggestion: e.target.value as typeof TEMPLATE_IDS[number] })}
                        className="border border-slate-200 rounded px-2 py-1 text-xs"
                      >
                        {TEMPLATE_IDS.map(t => (
                          <option key={t} value={t}>{TEMPLATE_META[t].label}</option>
                        ))}
                      </select>
                      <span className="text-xs text-slate-400">Pexels: {s.card_slide.pexels_keyword}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA 슬라이드 */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">CTA 슬라이드 (마지막)</label>
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-sm">
                <div className="font-bold text-slate-800">{brief.cta_slide.headline}</div>
                <div className="text-slate-600">{brief.cta_slide.body}</div>
              </div>
            </div>

            {/* SEO */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">SEO 메타</label>
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-1 text-xs">
                <div><span className="text-slate-400">제목:</span> {brief.seo.title}</div>
                <div><span className="text-slate-400">설명:</span> {brief.seo.description}</div>
                <div><span className="text-slate-400">슬러그:</span> {brief.seo.slug_suggestion}</div>
              </div>
            </div>

            {createError && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {createError}
              </div>
            )}

            <div className="flex justify-between gap-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 border border-slate-200 text-sm text-slate-600 rounded-lg hover:bg-slate-50"
              >
                ← 재생성
              </button>
              <button
                onClick={handleCreateCardNews}
                disabled={creating}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? '생성 중...' : '카드뉴스 생성 →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: 생성 중 */}
        {step === 3 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-12 text-center">
            <div className="inline-block w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-slate-700 font-medium">카드뉴스 생성 중...</p>
            <p className="text-xs text-slate-500 mt-1">AI가 각 슬라이드 카피 + Pexels 이미지를 준비하고 있습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
