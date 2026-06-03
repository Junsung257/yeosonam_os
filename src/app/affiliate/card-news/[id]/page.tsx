'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { fmtDateISO } from '@/lib/admin-utils';

interface Slide {
  id: string;
  position: number;
  headline: string;
  body: string;
  badge?: string | null;
  bg_image_url?: string;
}

interface CardNewsDetail {
  id: string;
  title: string;
  slides: Slide[];
  status: string;
  views: number;
  clicks: number;
  created_at: string;
  scheduled_at?: string;
  template_family?: string;
  branding_level?: string;
}

const getRouteParam = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value ?? '').trim();

export default function AffiliateCardNewsDetailPage() {
  const router = useRouter();
  const params = useParams();
  const cardNewsId = getRouteParam(params?.id);
  const [cardNews, setCardNews] = useState<CardNewsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const loadCardNews = useCallback(async () => {
    if (!cardNewsId) {
      setError('카드뉴스 ID가 올바르지 않습니다.');
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('affiliate_token');
    if (!token) {
      router.replace('/affiliate/login');
      return;
    }

    try {
      const res = await fetch(`/api/affiliate/card-news/${cardNewsId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || '불러오기 실패');
        return;
      }
      const json = await res.json();
      setCardNews(json.card_news);
    } catch {
      setError('네트워크 오류');
    } finally {
      setLoading(false);
    }
  }, [cardNewsId, router]);

  useEffect(() => {
    loadCardNews();
  }, [loadCardNews]);

  const handleShare = () => {
    if (!cardNewsId) return;

    const shareUrl = `${window.location.origin}/share/card-news/${cardNewsId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('affiliate_token');
    localStorage.removeItem('affiliate_info');
    router.replace('/affiliate/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">로딩 중...</div>
      </div>
    );
  }

  if (error || !cardNews) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 text-sm mb-3">{error || '카드뉴스를 찾을 수 없습니다.'}</p>
          <Link href="/affiliate/card-news" className="text-amber-600 text-sm underline">목록으로</Link>
        </div>
      </div>
    );
  }

  const slides = cardNews.slides || [];
  const current = slides[currentSlide];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 상단바 */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/affiliate/card-news" className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            목록
          </Link>
          <h1 className="text-sm font-semibold text-gray-900 truncate max-w-[200px]">{cardNews.title}</h1>
          <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-gray-600">로그아웃</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {/* 성과 요약 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{cardNews.views ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">조회수</div>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{cardNews.clicks ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">클릭</div>
          </div>
          <div className="bg-white rounded-xl border p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {cardNews.clicks && cardNews.views ? ((cardNews.clicks / cardNews.views) * 100).toFixed(1) : '0'}%
            </div>
            <div className="text-[10px] text-gray-400 mt-1">CTR</div>
          </div>
        </div>

        {/* 카드뉴스 슬라이드 뷰어 */}
        <div className="bg-white rounded-xl border overflow-hidden">
          {/* 슬라이드 내비게이션 */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to slide ${i + 1}`}
                  onClick={() => setCurrentSlide(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentSlide ? 'bg-amber-500 w-4' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] text-gray-400">
              {currentSlide + 1} / {slides.length}
            </span>
          </div>

          {/* 슬라이드 내용 */}
          <div className="p-6 min-h-[300px] flex flex-col items-center justify-center">
            {current ? (
              <div className="w-full max-w-sm">
                {/* 배경 이미지 */}
                {current.bg_image_url && (
                  <img
                    src={current.bg_image_url}
                    alt=""
                    className="w-full h-40 object-cover rounded-lg mb-4"
                  />
                )}
                {/* 배지 */}
                {current.badge && (
                  <span className="inline-block bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full mb-2">
                    {current.badge}
                  </span>
                )}
                {/* 헤드라인 */}
                <h2 className="text-lg font-bold text-gray-900 mb-2">{current.headline}</h2>
                {/* 본문 */}
                {current.body && (
                  <p className="text-sm text-gray-600 leading-relaxed">{current.body}</p>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">슬라이드가 없습니다.</p>
            )}
          </div>

          {/* 슬라이드 이동 버튼 */}
          <div className="flex justify-between px-4 py-3 border-t">
            <button
              onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
              disabled={currentSlide === 0}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30"
            >
              이전
            </button>
            <button
              onClick={() => setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))}
              disabled={currentSlide === slides.length - 1}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-30"
            >
              다음
            </button>
          </div>
        </div>

        {/* 정보 + 액션 */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>생성일: {fmtDateISO(cardNews.created_at)}</span>
            <span className={`px-2 py-0.5 rounded-full ${
              cardNews.status === 'published' ? 'bg-green-100 text-green-700' :
              cardNews.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
              'bg-gray-100 text-gray-500'
            }`}>
              {cardNews.status === 'published' ? '발행됨' :
               cardNews.status === 'scheduled' ? '예약됨' : '임시'}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleShare}
              className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 transition-colors"
            >
              {copied ? '링크 복사됨!' : '공유 링크 복사'}
            </button>
            <a
              href={`/share/card-news/${cardNews.id}`}
              target="_blank"
              className="px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              미리보기
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
