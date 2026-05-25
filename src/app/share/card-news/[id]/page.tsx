'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface CardNewsDetail {
  id: string;
  title: string;
  status: string;
  slides: Array<{
    heading: string;
    body: string;
    image_url?: string;
  }>;
  ig_slide_urls: string[] | null;
  template_family: string | null;
  variant_angle: string | null;
  engagement_score: number | null;
  created_at: string;
  created_by_affiliate_id: string | null;
  affiliate?: {
    name: string;
    referral_code: string;
    logo_url: string | null;
  } | null;
}

export default function SharedCardNewsPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<CardNewsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/card-news/${params.id}`);
        if (!res.ok) throw new Error('카드뉴스를 찾을 수 없습니다');
        const json = await res.json();
        setData(json);

        // 조회수 증가 (조용히)
        fetch(`/api/card-news/${params.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _track_view: true }),
        }).catch(() => {});
      } catch (err) {
        setError(err instanceof Error ? err.message : '로드 실패');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-gray-500">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8">
          <div className="text-4xl mb-3">📄</div>
          <h1 className="text-lg font-bold text-gray-700 mb-2">카드뉴스를 찾을 수 없습니다</h1>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  const slides = data.slides as Array<{ heading: string; body: string; image_url?: string }> | null;
  const totalSlides = slides?.length ?? 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-6 px-4">
      {/* 헤더 */}
      <div className="w-full max-w-md mb-4">
        <h1 className="text-lg font-bold text-gray-800">{data.title}</h1>
        {data.affiliate && (
          <Link
            href={`/link/${data.affiliate.referral_code}`}
            className="inline-flex items-center gap-1.5 mt-1 text-xs text-indigo-600 hover:text-indigo-800"
          >
            {data.affiliate.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.affiliate.logo_url}
                alt={data.affiliate.name}
                className="w-4 h-4 rounded-full"
              />
            )}
            <span>{data.affiliate.name}님의 카드뉴스</span>
          </Link>
        )}
      </div>

      {/* 카드뉴스 뷰어 (모바일 퍼스트) */}
      <div className="w-full max-w-sm aspect-[9/16] bg-white rounded-2xl shadow-lg overflow-hidden relative">
        {/* 슬라이드 컨텐츠 */}
        {slides && slides[currentSlide] ? (
          <div className="h-full flex flex-col p-6 relative">
            {/* 배경 그라디언트 */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-purple-50" />

            {/* 이미지 (있으면) */}
            {slides[currentSlide].image_url && (
              <div className="relative w-full h-48 mb-4 rounded-xl overflow-hidden z-10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slides[currentSlide].image_url!}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* 텍스트 */}
            <div className="relative z-10 flex-1 flex flex-col justify-center">
              <h2 className="text-xl font-bold text-gray-800 mb-3 leading-snug">
                {slides[currentSlide].heading}
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {slides[currentSlide].body}
              </p>
            </div>

            {/* 페이지 인디케이터 */}
            <div className="relative z-10 flex justify-center gap-1.5 pb-2">
              {Array.from({ length: totalSlides }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentSlide(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentSlide
                      ? 'bg-indigo-600 w-4'
                      : 'bg-gray-300 hover:bg-gray-400'
                  }`}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            슬라이드 데이터 없음
          </div>
        )}
      </div>

      {/* 네비게이션 */}
      {totalSlides > 1 && (
        <div className="flex items-center gap-4 mt-4">
          <button
            onClick={() => setCurrentSlide((p) => Math.max(0, p - 1))}
            disabled={currentSlide === 0}
            className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← 이전
          </button>
          <span className="text-xs text-gray-500">
            {currentSlide + 1} / {totalSlides}
          </span>
          <button
            onClick={() => setCurrentSlide((p) => Math.min(totalSlides - 1, p + 1))}
            disabled={currentSlide === totalSlides - 1}
            className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            다음 →
          </button>
        </div>
      )}

      {/* 푸터 */}
      <div className="mt-6 text-center">
        {data.affiliate ? (
          <Link
            href={`/link/${data.affiliate.referral_code}`}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            🔗 {data.affiliate.name}님의 다른 콘텐츠 보기
          </Link>
        ) : (
          <span className="text-xs text-gray-400">Powered by 여소남</span>
        )}
      </div>
    </div>
  );
}
