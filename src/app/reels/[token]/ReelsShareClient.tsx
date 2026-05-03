'use client';

import { useState } from 'react';
import Image from 'next/image';

interface ReelPhoto {
  url: string;
  caption?: string;
}

interface ReelRecord {
  id: string;
  destination: string | null;
  template_id: string;
  photos: ReelPhoto[];
  created_at: string;
  share_token: string;
}

interface Props {
  reel: ReelRecord;
}

export default function ReelsShareClient({ reel }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [sharing, setSharing] = useState(false);

  const photos: ReelPhoto[] = Array.isArray(reel.photos) ? reel.photos : [];
  const shareUrl =
    typeof window !== 'undefined'
      ? window.location.href
      : `https://yeosonam.com/reels/${reel.share_token}`;

  const handleShare = async () => {
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `여소남 여행 추억 — ${reel.destination ?? ''}`,
          text: '여소남과 함께한 여행 순간을 공유합니다 ✈️',
          url: shareUrl,
        });
      } else {
        // Web Share API 미지원 시 클립보드 복사 fallback
        await navigator.clipboard.writeText(shareUrl);
        alert('링크가 클립보드에 복사되었습니다!');
      }
    } catch (err) {
      // 사용자가 공유를 취소한 경우 무시
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('공유 실패:', err);
      }
    } finally {
      setSharing(false);
    }
  };

  const prev = () => setCurrentIdx((i) => (i === 0 ? photos.length - 1 : i - 1));
  const next = () => setCurrentIdx((i) => (i === photos.length - 1 ? 0 : i + 1));

  const travelDate = new Date(reel.created_at).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-between py-8 px-4">
      {/* 헤더 — 여소남 브랜딩 */}
      <div className="w-full max-w-md flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-xl tracking-tight">여소남</span>
          <span className="text-gray-400 text-sm">여행 추억</span>
        </div>
        {reel.destination && (
          <span className="bg-white/10 text-white text-xs px-3 py-1 rounded-full">
            ✈ {reel.destination}
          </span>
        )}
      </div>

      {/* 사진 갤러리 */}
      {photos.length > 0 ? (
        <div className="w-full max-w-md flex-1 flex flex-col items-center">
          {/* 메인 사진 */}
          <div className="relative w-full aspect-[9/16] max-h-[60vh] rounded-2xl overflow-hidden bg-gray-900">
            <Image
              src={photos[currentIdx].url}
              alt={photos[currentIdx].caption ?? `여행 사진 ${currentIdx + 1}`}
              fill
              className="object-cover"
              sizes="(max-width: 448px) 100vw, 448px"
              priority={currentIdx === 0}
            />

            {/* 좌우 네비게이션 */}
            {photos.length > 1 && (
              <>
                <button
                  onClick={prev}
                  className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-black/70 transition"
                  aria-label="이전 사진"
                >
                  ‹
                </button>
                <button
                  onClick={next}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-black/70 transition"
                  aria-label="다음 사진"
                >
                  ›
                </button>
              </>
            )}

            {/* 캡션 오버레이 */}
            {photos[currentIdx].caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                <p className="text-white text-sm">{photos[currentIdx].caption}</p>
              </div>
            )}
          </div>

          {/* 인디케이터 */}
          {photos.length > 1 && (
            <div className="flex gap-1.5 mt-3">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIdx(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentIdx ? 'bg-white w-5' : 'bg-white/40'
                  }`}
                  aria-label={`사진 ${i + 1}로 이동`}
                />
              ))}
            </div>
          )}

          {/* 썸네일 스트립 */}
          {photos.length > 1 && (
            <div className="flex gap-2 mt-3 w-full overflow-x-auto pb-1 scrollbar-hide">
              {photos.map((photo, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIdx(i)}
                  className={`flex-shrink-0 relative w-14 h-14 rounded-lg overflow-hidden border-2 transition ${
                    i === currentIdx ? 'border-white' : 'border-transparent'
                  }`}
                >
                  <Image
                    src={photo.url}
                    alt={photo.caption ?? `썸네일 ${i + 1}`}
                    fill
                    className="object-cover"
                    sizes="56px"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">사진이 없습니다.</p>
        </div>
      )}

      {/* 하단 정보 + 공유 버튼 */}
      <div className="w-full max-w-md mt-6 flex flex-col gap-3">
        <div className="text-center">
          <p className="text-gray-400 text-xs">{travelDate} 여행 추억</p>
          <p className="text-white/60 text-xs mt-0.5">
            {photos.length}장의 사진
          </p>
        </div>

        {/* 인스타그램 공유 버튼 */}
        <button
          onClick={handleShare}
          disabled={sharing}
          className="w-full bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 text-white font-semibold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
          </svg>
          {sharing ? '공유 중...' : '인스타에 공유하기'}
        </button>

        {/* 여소남 홈 링크 */}
        <a
          href="https://yeosonam.com"
          className="text-center text-gray-500 text-xs hover:text-gray-400 transition"
        >
          여소남 여행 더 보기
        </a>
      </div>
    </div>
  );
}
