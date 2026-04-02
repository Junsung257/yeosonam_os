'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CardNews } from '@/lib/supabase';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  LAUNCHED: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-red-100 text-red-500',
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안', CONFIRMED: '컨펌됨', LAUNCHED: '런치됨', ARCHIVED: '보관',
};

interface Package { id: string; title: string; destination: string; }

export default function CardNewsListPage() {
  const router = useRouter();
  const [list, setList] = useState<CardNews[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createSlideCount, setCreateSlideCount] = useState(6);
  const [createRatio, setCreateRatio] = useState('1:1');
  const [createTone, setCreateTone] = useState('professional');
  const [createExtra, setCreateExtra] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/card-news');
      if (res.ok) {
        const data = await res.json();
        setList(data.card_news ?? []);
      } else {
        console.warn('카드뉴스 목록 로드 실패:', res.status);
        setList([]);
      }
    } catch (err) {
      console.error('카드뉴스 fetch 에러:', err);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => {
        const all = d.data ?? d.packages ?? [];
        setPackages(all.filter((p: { status: string }) =>
          ['approved', 'active', 'pending_review', 'REVIEW_NEEDED'].includes(p.status)
        ));
      });
  }, [fetchList]);

  const handleCreate = async () => {
    if (!selectedPkg) return;
    setCreating(true);
    try {
      const res = await fetch('/api/card-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: selectedPkg, slide_count: createSlideCount, ratio: createRatio, tone: createTone, extra_prompt: createExtra }),
      });
      const data = await res.json();
      if (res.ok && data.card_news?.id) {
        router.push(`/admin/marketing/card-news/${data.card_news.id}`);
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
          <h1 className="text-2xl font-bold text-gray-900">카드뉴스 관리</h1>
          <p className="text-sm text-gray-500">상품 데이터 기반 자동 생성 → Meta Ads 즉시 배포</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/admin/marketing')}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            ← 대시보드
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            + 새 카드뉴스
          </button>
        </div>
      </div>

      {/* 카드뉴스 그리드 */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">불러오는 중...</div>
      ) : list.length === 0 ? (
        <div className="py-20 text-center text-sm text-gray-400">
          카드뉴스가 없습니다. 상품을 선택해 첫 카드뉴스를 만들어보세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {list.map(cn => {
            const cover = cn.slides?.[0];
            return (
              <div key={cn.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* 커버 이미지 미리보기 */}
                <div
                  className="relative h-40 bg-gray-200 flex items-center justify-center overflow-hidden"
                  style={cover?.bg_image_url ? { backgroundImage: `url(${cover.bg_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                >
                  {cover?.bg_image_url ? (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  ) : (
                    <span className="text-gray-400 text-sm">이미지 없음</span>
                  )}
                  <div className="absolute bottom-2 left-3 right-3">
                    <p className="text-white text-sm font-bold truncate drop-shadow">{cover?.headline}</p>
                  </div>
                  <div className="absolute top-2 right-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_BADGE[cn.status]}`}>
                      {STATUS_LABELS[cn.status]}
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <p className="font-semibold text-gray-800 text-sm truncate">{cn.title}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {cn.package_destination ?? '—'} · {cn.slides?.length ?? 0}장
                  </p>
                  <p className="text-xs text-gray-300 mt-0.5">{cn.created_at?.slice(0, 10)}</p>

                  <div className="flex gap-2 mt-3">
                    <Link
                      href={`/admin/marketing/card-news/${cn.id}`}
                      className="flex-1 text-center text-xs py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium"
                    >
                      편집
                    </Link>
                    {cn.status !== 'ARCHIVED' && (
                      <button
                        onClick={() => handleArchive(cn.id)}
                        className="text-xs px-3 py-1.5 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100"
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
              <h2 className="text-[16px] font-bold text-slate-800">새 카드뉴스 생성</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600 text-xl">x</button>
            </div>
            <div className="p-6 space-y-5 flex-1 overflow-y-auto">
            <p className="text-[12px] text-slate-500">
              AI가 상품 데이터를 분석해 슬라이드 카피와 배경 이미지를 자동 생성합니다.
            </p>

            {/* 상품 선택 */}
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">상품 선택 *</label>
              <select
                value={selectedPkg}
                onChange={e => setSelectedPkg(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:ring-1 focus:ring-[#005d90]"
              >
                <option value="">상품 선택...</option>
                {packages.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.destination})
                  </option>
                ))}
              </select>
            </div>

            {/* 슬라이드 개수 */}
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">
                슬라이드 개수: <span className="text-[#001f3f] font-bold">{createSlideCount}장</span>
              </label>
              <input type="range" min={3} max={10} value={createSlideCount}
                onChange={e => setCreateSlideCount(parseInt(e.target.value))}
                className="w-full accent-[#001f3f]" />
            </div>

            {/* 이미지 비율 */}
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">이미지 비율</label>
              <div className="flex gap-2">
                {(['1:1', '4:5', '9:16'] as const).map(r => (
                  <button key={r} onClick={() => setCreateRatio(r)}
                    className={`px-3 py-1.5 rounded text-[12px] transition ${createRatio === r ? 'bg-[#001f3f] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {r === '1:1' ? '1:1 피드' : r === '4:5' ? '4:5 세로' : '9:16 릴스'}
                  </button>
                ))}
              </div>
            </div>

            {/* 톤 선택 */}
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">톤</label>
              <select value={createTone} onChange={e => setCreateTone(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]">
                <option value="professional">전문가 (신뢰감)</option>
                <option value="casual">캐주얼 (친근)</option>
                <option value="emotional">감성적 (감동)</option>
                <option value="humorous">유머러스 (재미)</option>
              </select>
            </div>

            {/* 추가 지시사항 */}
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">추가 지시사항 (선택)</label>
              <textarea value={createExtra} onChange={e => setCreateExtra(e.target.value)}
                placeholder="예: 5성급 호텔 강조, 마감임박 느낌으로, 20대 타겟..."
                className="w-full border border-slate-200 rounded px-3 py-2 text-[12px] h-20 resize-none focus:ring-1 focus:ring-[#005d90]" />
            </div>

            </div>

            {/* 하단 버튼 */}
            <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 border border-slate-200 text-[13px] text-slate-600 py-2.5 rounded-lg hover:bg-slate-50"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={!selectedPkg || creating}
                className="flex-1 bg-[#001f3f] text-white text-[13px] py-2.5 rounded-lg hover:bg-blue-900 disabled:opacity-50 font-medium"
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
