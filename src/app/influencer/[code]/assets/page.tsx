'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { useInfluencerAuth } from '../auth-context';

interface CardNewsAsset {
  id: string;
  title: string;
  package_id: string;
  slide_count: number;
  thumbnail?: string;
  created_at: string;
}

interface MarketingCopy {
  package_id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  copies?: { type: string; title: string; body: string }[];
  highlights?: string[];
  summary?: string;
}

export default function InfluencerAssets() {
  const params = useParams();
  const code = params.code as string;
  const { authenticated } = useInfluencerAuth();

  const [cardNews, setCardNews] = useState<CardNewsAsset[]>([]);
  const [copies, setCopies] = useState<MarketingCopy[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'card_news' | 'copies'>('card_news');
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/influencer/assets?code=${code}`);
      const json = await res.json();
      setCardNews(json.assets?.card_news || []);
      setCopies(json.assets?.marketing_copies || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { if (authenticated) load(); }, [authenticated, load]);

  const copyText = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedIdx(id);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  if (!authenticated) {
    return <p className="text-center text-gray-400 py-20">먼저 대시보드에서 인증해주세요</p>;
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">마케팅 소재</h1>
        <p className="text-sm text-gray-500">카드뉴스와 마케팅 카피를 활용하여 홍보하세요</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('card_news')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'card_news' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
        >
          🎨 카드뉴스 ({cardNews.length})
        </button>
        <button
          onClick={() => setTab('copies')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'copies' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
        >
          📝 마케팅 카피 ({copies.length})
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 bg-white rounded-xl animate-pulse" />)}
        </div>
      ) : tab === 'card_news' ? (
        /* ── 카드뉴스 탭 ── */
        cardNews.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-2">🎨</p>
            <p>아직 준비된 카드뉴스가 없습니다</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {cardNews.map(cn => (
              <div key={cn.id} className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                {/* 썸네일 */}
                <div className="aspect-square bg-gray-100 relative">
                  {cn.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cn.thumbnail} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl text-gray-300">🖼️</div>
                  )}
                  <span className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full font-medium">
                    {cn.slide_count}장
                  </span>
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-bold text-gray-900 line-clamp-2 break-keep">{cn.title}</h3>
                  <p className="text-xs text-gray-400 mt-1">{cn.created_at?.slice(0, 10)}</p>
                  <button
                    className="mt-2 w-full py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
                    onClick={() => {
                      // 카드뉴스 상세 보기 (추후 모달 또는 페이지)
                      window.open(`/api/card-news/${cn.id}`, '_blank');
                    }}
                  >
                    소재 보기
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* ── 마케팅 카피 탭 ── */
        copies.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-2">📝</p>
            <p>아직 준비된 마케팅 카피가 없습니다</p>
          </div>
        ) : (
          <div className="space-y-4">
            {copies.map(pkg => (
              <div key={pkg.package_id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                {/* 상품 헤더 */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900">{pkg.title}</h3>
                    <div className="flex gap-2 mt-1">
                      {pkg.destination && <span className="text-xs text-gray-500">{pkg.destination}</span>}
                      {pkg.duration && <span className="text-xs text-gray-500">{pkg.duration}일</span>}
                      {pkg.price && <span className="text-xs font-bold text-blue-600">₩{pkg.price.toLocaleString()}</span>}
                    </div>
                  </div>
                </div>

                {/* 하이라이트 */}
                {pkg.highlights && pkg.highlights.length > 0 && (
                  <div className="bg-blue-50 rounded-lg p-3 mb-3">
                    <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">핵심 포인트</p>
                    <div className="flex flex-wrap gap-1">
                      {pkg.highlights.map((h, i) => (
                        <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium">{h}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI 요약 */}
                {pkg.summary && (
                  <div className="mb-3">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">AI 요약</p>
                    <p className="text-sm text-gray-600 break-keep">{pkg.summary}</p>
                    <button
                      onClick={() => copyText(pkg.summary!, `summary_${pkg.package_id}`)}
                      className={`mt-1 text-xs font-medium ${copiedIdx === `summary_${pkg.package_id}` ? 'text-green-600' : 'text-blue-600 hover:underline'}`}
                    >
                      {copiedIdx === `summary_${pkg.package_id}` ? '복사됨 ✓' : '복사'}
                    </button>
                  </div>
                )}

                {/* 마케팅 카피 목록 */}
                {Array.isArray(pkg.copies) && pkg.copies.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">마케팅 카피</p>
                    {pkg.copies.map((copy, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-gray-700">{copy.type || `카피 ${i + 1}`}</span>
                          <button
                            onClick={() => copyText(`${copy.title}\n\n${copy.body}`, `copy_${pkg.package_id}_${i}`)}
                            className={`text-xs font-medium ${copiedIdx === `copy_${pkg.package_id}_${i}` ? 'text-green-600' : 'text-blue-600 hover:underline'}`}
                          >
                            {copiedIdx === `copy_${pkg.package_id}_${i}` ? '복사됨 ✓' : '전체 복사'}
                          </button>
                        </div>
                        <p className="text-sm font-bold text-gray-900 mb-1">{copy.title}</p>
                        <p className="text-xs text-gray-600 break-keep leading-relaxed">{copy.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
