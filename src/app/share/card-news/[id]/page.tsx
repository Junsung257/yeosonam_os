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

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getNullableString(value: unknown): string | null {
  const text = getString(value).trim();
  return text ? text : null;
}

function safeImageUrl(input?: string | null): string | null {
  const value = input?.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) || value.startsWith('/') ? value : null;
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function getAffiliateHref(code?: string | null): string | null {
  const value = code?.trim();
  return value ? `/link/${encodeURIComponent(value)}` : null;
}

function normalizeCardNewsDetail(value: unknown): CardNewsDetail | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const id = getString(record.id).trim();
  const title = getString(record.title).trim();
  if (!id || !title) return null;

  const rawSlides = Array.isArray(record.slides) ? record.slides : [];
  const slides = rawSlides.flatMap(slide => {
    if (!slide || typeof slide !== 'object') return [];

    const slideRecord = slide as Record<string, unknown>;
    const heading = getString(slideRecord.heading).trim();
    const body = getString(slideRecord.body).trim();
    if (!heading && !body) return [];

    return [{
      heading,
      body,
      image_url: safeImageUrl(getString(slideRecord.image_url)) ?? undefined,
    }];
  });

  const affiliateRecord = record.affiliate && typeof record.affiliate === 'object'
    ? record.affiliate as Record<string, unknown>
    : null;
  const affiliateName = getString(affiliateRecord?.name).trim();
  const referralCode = getString(affiliateRecord?.referral_code).trim();

  return {
    id,
    title,
    status: getString(record.status),
    slides,
    ig_slide_urls: Array.isArray(record.ig_slide_urls)
      ? record.ig_slide_urls.map(safeImageUrl).filter((url): url is string => url != null)
      : null,
    template_family: getNullableString(record.template_family),
    variant_angle: getNullableString(record.variant_angle),
    engagement_score: typeof record.engagement_score === 'number' && Number.isFinite(record.engagement_score)
      ? record.engagement_score
      : null,
    created_at: getString(record.created_at),
    created_by_affiliate_id: getNullableString(record.created_by_affiliate_id),
    affiliate: affiliateName && referralCode
      ? {
          name: affiliateName,
          referral_code: referralCode,
          logo_url: safeImageUrl(getString(affiliateRecord?.logo_url)),
        }
      : null,
  };
}

export default function SharedCardNewsPage() {
  const params = useParams<{ id?: string | string[] }>();
  const cardNewsId = getRouteParam(params?.id);
  const [data, setData] = useState<CardNewsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        if (!cardNewsId) throw new Error('카드뉴스 ID가 올바르지 않습니다');

        const res = await fetch(`/api/card-news/${encodeURIComponent(cardNewsId)}`);
        if (!res.ok) throw new Error('카드뉴스를 찾을 수 없습니다');
        const json = await res.json();
        const normalized = normalizeCardNewsDetail(json);
        if (!normalized) throw new Error('카드뉴스 데이터가 올바르지 않습니다');
        setData(normalized);
        setCurrentSlide(0);

        // 조회수 증가 (조용히)
        fetch(`/api/card-news/${encodeURIComponent(cardNewsId)}`, {
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
  }, [cardNewsId]);

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

  const slides = Array.isArray(data.slides) ? data.slides : [];
  const totalSlides = slides.length;
  const currentSlideIndex = totalSlides > 0 ? Math.min(currentSlide, totalSlides - 1) : 0;
  const current = slides[currentSlideIndex] ?? null;
  const currentImageUrl = safeImageUrl(current?.image_url);
  const affiliateLogoUrl = safeImageUrl(data.affiliate?.logo_url);
  const affiliateHref = getAffiliateHref(data.affiliate?.referral_code);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-6 px-4">
      {/* 헤더 */}
      <div className="w-full max-w-md mb-4">
        <h1 className="text-lg font-bold text-gray-800">{data.title}</h1>
        {data.affiliate && affiliateHref && (
          <Link
            href={affiliateHref}
            className="inline-flex items-center gap-1.5 mt-1 text-xs text-indigo-600 hover:text-indigo-800"
          >
            {affiliateLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={affiliateLogoUrl}
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
        {current ? (
          <div className="h-full flex flex-col p-6 relative">
            {/* 배경 그라디언트 */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-purple-50" />

            {/* 이미지 (있으면) */}
            {currentImageUrl && (
              <div className="relative w-full h-48 mb-4 rounded-xl overflow-hidden z-10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentImageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* 텍스트 */}
            <div className="relative z-10 flex-1 flex flex-col justify-center">
              <h2 className="text-xl font-bold text-gray-800 mb-3 leading-snug">
                {current.heading}
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {current.body}
              </p>
            </div>

            {/* 페이지 인디케이터 */}
            <div className="relative z-10 flex justify-center gap-1.5 pb-2">
              {Array.from({ length: totalSlides }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentSlide(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentSlideIndex
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
            disabled={currentSlideIndex === 0}
            className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← 이전
          </button>
          <span className="text-xs text-gray-500">
            {currentSlideIndex + 1} / {totalSlides}
          </span>
          <button
            onClick={() => setCurrentSlide((p) => Math.min(totalSlides - 1, p + 1))}
            disabled={currentSlideIndex === totalSlides - 1}
            className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            다음 →
          </button>
        </div>
      )}

      {/* 푸터 */}
      <div className="mt-6 text-center">
        {data.affiliate && affiliateHref ? (
          <Link
            href={affiliateHref}
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
