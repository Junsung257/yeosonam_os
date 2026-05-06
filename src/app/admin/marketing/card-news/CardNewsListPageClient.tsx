'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CardNews } from '@/lib/supabase';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  RENDERING: 'bg-yellow-100 text-yellow-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  LAUNCHED: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-red-100 text-red-500',
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안', RENDERING: '렌더중', CONFIRMED: '컨펌됨', LAUNCHED: '런치됨', ARCHIVED: '보관',
};

interface Package { id: string; title: string; destination: string; }
interface Category { id: string; key: string; label: string; scope: string; }

interface Props {
  initialList?: CardNews[];
  initialPackages?: Package[];
  initialCategories?: Category[];
}

export default function CardNewsListPage({ initialList, initialPackages, initialCategories }: Props = {}) {
  const router = useRouter();
  const [list, setList] = useState<CardNews[]>(initialList ?? []);
  const [packages, setPackages] = useState<Package[]>(initialPackages ?? []);
  const [loading, setLoading] = useState(!initialList);
  const [creating, setCreating] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createSlideCount, setCreateSlideCount] = useState(6);
  const [createRatio, setCreateRatio] = useState('1:1');
  const [createTone, setCreateTone] = useState('professional');
  const [createExtra, setCreateExtra] = useState('');
  const [createMode, setCreateMode] = useState<'product' | 'info'>('product');
  const [createTopic, setCreateTopic] = useState('');
  const [createCategoryId, setCreateCategoryId] = useState('');
  const [categories, setCategories] = useState<Category[]>(initialCategories ?? []);

  const _skipInitialFetch = useRef(!!initialList);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/card-news');
      if (res.ok) {
        const data = await res.json();
        setList(data.card_news ?? []);
      } else {
        setList([]);
      }
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (_skipInitialFetch.current) {
      _skipInitialFetch.current = false;
      // packages/categories already provided by server — no fetch needed
      if (!initialPackages) {
        fetch('/api/packages?limit=200')
          .then(r => r.json())
          .then(d => {
            const all = d.data ?? d.packages ?? [];
            setPackages(all.filter((p: { status: string }) =>
              ['approved', 'active', 'pending', 'pending_review', 'draft'].includes(p.status)
            ));
          });
      }
      if (!initialCategories) {
        fetch('/api/blog-categories?scope=info')
          .then(r => r.json())
          .then(d => {
            const cats = d.categories || [];
            setCategories(cats);
            if (cats.length > 0 && !createCategoryId) setCreateCategoryId(cats[0].id);
          })
          .catch(() => {});
      } else if (initialCategories.length > 0 && !createCategoryId) {
        setCreateCategoryId(initialCategories[0].id);
      }
      return;
    }
    fetchList();
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => {
        const all = d.data ?? d.packages ?? [];
        setPackages(all.filter((p: { status: string }) =>
          ['approved', 'active', 'pending', 'pending_review', 'draft'].includes(p.status)
        ));
      });
    fetch('/api/blog-categories?scope=info')
      .then(r => r.json())
      .then(d => {
        const cats = d.categories || [];
        setCategories(cats);
        if (cats.length > 0 && !createCategoryId) setCreateCategoryId(cats[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchList]);

  const handleCreate = async () => {
    if (createMode === 'product' && !selectedPkg) return;
    if (createMode === 'info' && !createTopic.trim()) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        slide_count: createSlideCount,
        ratio: createRatio,
        tone: createTone,
        extra_prompt: createExtra,
        mode: createMode,
      };
      if (createMode === 'product') {
        body.package_id = selectedPkg;
      } else {
        body.topic = createTopic.trim();
        body.category_id = createCategoryId || null;
      }
      const res = await fetch('/api/card-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.card_news?.id) {
        router.push(`/admin/marketing/content-hub/${data.card_news.id}?source=new`);
      } else {
        alert(data.error ?? '생성 실패');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('이 카드뉴스를 보관 처리하시겠습니까?')) return;
    await fetch(`/api/card-news/${id}`, {
      method: 'DELETE',
    });
    fetchList();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">카드뉴스 관리</h1>
          <p className="text-sm text-slate-500">상품 데이터 기반 자동 생성 → Meta Ads 즉시 배포</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/admin/marketing')}
            className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            ← 대시보드
          </button>
          <button
            onClick={() => router.push('/admin/marketing/card-news/campaign/new')}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600"
            title="상품 선택 → 각도 선택 → 원클릭으로 카드뉴스+렌더+블로그큐 자동 생성"
          >
            🚀 캠페인 시작
          </button>
          <button
            onClick={() => router.push('/admin/marketing/card-news/new')}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            + 새 카드뉴스
          </button>
          <button
            onClick={() => router.push('/admin/marketing/card-news/new-html')}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700"
            title="Claude Sonnet 4.6 + Puppeteer · 6장 1080×1080 HTML carousel"
          >
            + HTML 단건
          </button>
          <button
            onClick={() => router.push('/admin/marketing/card-news/variants/new')}
            className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
            title="한 상품에 여러 각도 변형 5장 동시 생성 → Cover Critic 자동 점수 → 비교 → winner 발행"
          >
            + 변형 5장 (A/B)
          </button>
        </div>
      </div>

      {/* 카드뉴스 그리드 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="aspect-[9/16] bg-slate-100 animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-3.5 bg-slate-100 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="py-20 text-center text-sm text-slate-400">
          카드뉴스가 없습니다. 상품을 선택해 첫 카드뉴스를 만들어보세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {list.map(cn => {
            const cover = cn.slides?.[0];
            return (
              <div key={cn.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div
                  className="relative h-40 bg-slate-200 flex items-center justify-center overflow-hidden"
                  style={cover?.bg_image_url ? { backgroundImage: `url(${cover.bg_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                >
                  {cover?.bg_image_url ? (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  ) : (
                    <span className="text-slate-400 text-sm">이미지 없음</span>
                  )}
                  <div className="absolute bottom-2 left-3 right-3">
                    <p className="text-white text-sm font-bold truncate drop-shadow">{cover?.headline}</p>
                  </div>
                  <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_BADGE[cn.status]}`}>
                      {STATUS_LABELS[cn.status]}
                    </span>
                    {cn.ig_publish_status && (
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          cn.ig_publish_status === 'published' ? 'bg-green-100 text-green-700'
                          : cn.ig_publish_status === 'queued' ? 'bg-amber-100 text-amber-700'
                          : cn.ig_publish_status === 'publishing' ? 'bg-blue-100 text-blue-700'
                          : 'bg-red-100 text-red-700'
                        }`}
                        title={cn.ig_error ?? undefined}
                      >
                        {cn.ig_publish_status === 'published' ? '🟢 IG 게시됨'
                          : cn.ig_publish_status === 'queued' ? `🟡 IG 예약${cn.ig_scheduled_for ? ` · ${cn.ig_scheduled_for.slice(5, 10)}` : ''}`
                          : cn.ig_publish_status === 'publishing' ? '🔵 IG 발행 중'
                          : '🔴 IG 실패'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4">
                  <p className="font-semibold text-slate-800 text-sm truncate">{cn.title}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {cn.package_destination ?? '—'} · {cn.slides?.length ?? 0}장
                  </p>
                  <p className="text-xs text-slate-300 mt-0.5">{cn.created_at?.slice(0, 10)}</p>

                  <div className="flex gap-2 mt-3">
                    <Link
                      href={`/admin/marketing/content-hub/${cn.id}`}
                      className="flex-1 text-center text-xs py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                    >
                      Content Hub
                    </Link>
                    <Link
                      href={`/admin/marketing/card-news/${cn.id}`}
                      className="text-xs px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 font-medium"
                    >
                      편집
                    </Link>
                    {cn.status !== 'ARCHIVED' && (
                      <button
                        onClick={() => handleArchive(cn.id)}
                        className="text-xs px-3 py-1.5 bg-slate-50 text-slate-500 rounded-lg hover:bg-slate-100"
                      >
                        보관
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 신규 생성 슬라이드 패널 */}
      {showCreate && (
        <>
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50" onClick={() => setShowCreate(false)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 flex flex-col border-l border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-admin-lg font-bold text-slate-800">새 카드뉴스 생성</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600 text-xl">x</button>
            </div>
            <div className="p-6 space-y-5 flex-1 overflow-y-auto">
            <p className="text-admin-xs text-slate-500">
              AI가 상품 또는 주제를 분석해 슬라이드 카피와 배경 이미지를 자동 생성합니다.
            </p>

            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setCreateMode('product')}
                className={`flex-1 px-3 py-1.5 text-admin-xs font-medium rounded-md transition ${createMode === 'product' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                상품 카드뉴스
              </button>
              <button
                onClick={() => setCreateMode('info')}
                className={`flex-1 px-3 py-1.5 text-admin-xs font-medium rounded-md transition ${createMode === 'info' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                정보성 카드뉴스
              </button>
            </div>

            {createMode === 'product' ? (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">상품 선택 *</label>
                <select
                  value={selectedPkg}
                  onChange={e => setSelectedPkg(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-admin-sm focus:ring-1 focus:ring-[#005d90]"
                >
                  <option value="">상품 선택...</option>
                  {packages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.destination})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">주제 *</label>
                  <input
                    value={createTopic}
                    onChange={e => setCreateTopic(e.target.value)}
                    placeholder="예: 베트남 비자 신청 방법, 다낭 여행 준비물"
                    className="w-full border border-slate-200 rounded px-3 py-2 text-admin-sm focus:ring-1 focus:ring-[#005d90]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">카테고리</label>
                  <select
                    value={createCategoryId}
                    onChange={e => setCreateCategoryId(e.target.value)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-admin-sm"
                  >
                    {categories.length === 0 ? (
                      <option value="">(카테고리 없음)</option>
                    ) : (
                      categories.map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))
                    )}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">
                    카테고리는 <Link href="/admin/blog/categories" className="text-blue-600 hover:underline">/admin/blog/categories</Link>에서 관리합니다.
                  </p>
                </div>
              </>
            )}

            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">
                슬라이드 개수: <span className="text-blue-600 font-bold">{createSlideCount}장</span>
              </label>
              <input type="range" min={3} max={10} value={createSlideCount}
                onChange={e => setCreateSlideCount(parseInt(e.target.value))}
                className="w-full accent-blue-600" />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">이미지 비율</label>
              <div className="flex gap-2">
                {(['1:1', '4:5', '9:16'] as const).map(r => (
                  <button key={r} onClick={() => setCreateRatio(r)}
                    className={`px-3 py-1.5 rounded text-admin-xs transition ${createRatio === r ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {r === '1:1' ? '1:1 피드' : r === '4:5' ? '4:5 세로' : '9:16 릴스'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">톤</label>
              <select value={createTone} onChange={e => setCreateTone(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm">
                <option value="professional">전문가 (신뢰감)</option>
                <option value="casual">캐주얼 (친근)</option>
                <option value="emotional">감성적 (감동)</option>
                <option value="humorous">유머러스 (재미)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">추가 지시사항 (선택)</label>
              <textarea value={createExtra} onChange={e => setCreateExtra(e.target.value)}
                placeholder="예: 5성급 호텔 강조, 마감임박 느낌으로, 20대 타겟..."
                className="w-full border border-slate-200 rounded px-3 py-2 text-admin-xs h-20 resize-none focus:ring-1 focus:ring-[#005d90]" />
            </div>

            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 border border-slate-200 text-admin-sm text-slate-600 py-2.5 rounded-lg hover:bg-slate-50"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || (createMode === 'product' ? !selectedPkg : !createTopic.trim())}
                className="flex-1 bg-blue-600 text-white text-admin-sm py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {creating ? 'AI 생성 중...' : `AI 카드뉴스 ${createSlideCount}장 생성`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
