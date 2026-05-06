'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';

export interface RankingItem {
  id: string;
  title: string;
  destination?: string | null;
  image?: string | null;
  minPrice?: number;
  duration?: string | null;
  isOverseas?: boolean;
  /** 메인 등: 임계값 통과 시만 세팅 */
  socialBadge?: { kind: 'bookings' | 'interest'; text: string };
}

interface Props {
  domestic: RankingItem[];
  overseas: RankingItem[];
  className?: string;
}

export default function RankingSection({ domestic, overseas, className = '' }: Props) {
  const [tab, setTab] = useState<'overseas' | 'domestic'>('overseas');
  const items = tab === 'overseas' ? overseas : domestic;

  return (
    <div className={className}>
      {/* 탭 */}
      <div className="flex gap-2 px-5 mb-4">
        {([['overseas', '해외'], ['domestic', '국내']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`text-[13px] font-semibold px-4 py-1.5 rounded-full transition-colors ${
              tab === key
                ? 'bg-brand text-white'
                : 'bg-bg-section text-text-secondary hover:bg-brand-light hover:text-brand'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 가로 스크롤 카드 */}
      <div className="scroll-x flex gap-3 px-5 pb-1">
        {items.slice(0, 7).map((item, i) => (
          <Link
            key={item.id}
            href={`/packages/${item.id}`}
            className="flex-shrink-0 w-[160px] md:w-[190px] rounded-[16px] overflow-hidden shadow-card bg-white card-touch hover:shadow-card-hover transition-shadow"
          >
            {/* 이미지 + 랭킹 번호 오버레이 */}
            <div className="relative aspect-[4/3] bg-bg-section overflow-hidden">
              {item.socialBadge && (
                <span
                  className={`absolute top-2 left-2 z-10 max-w-[calc(100%-1rem)] truncate text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-sm ${
                    item.socialBadge.kind === 'bookings'
                      ? 'bg-rose-50 text-rose-900 border-rose-100'
                      : 'bg-violet-50 text-violet-900 border-violet-100'
                  }`}
                >
                  {item.socialBadge.kind === 'bookings' ? '🔥 ' : '⭐ '}
                  {item.socialBadge.text}
                </span>
              )}
              <SafeCoverImg
                src={item.image}
                alt={item.title}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
                fallback={
                  <div className="absolute inset-0 bg-gradient-to-br from-brand-light to-[#F2F4F6] flex items-center justify-center text-3xl">
                    🌍
                  </div>
                }
              />
              {/* 어두운 그라데이션 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
              {/* 랭킹 번호 */}
              <span className="absolute left-3 bottom-2 text-[36px] font-extrabold text-white leading-none [text-shadow:0_2px_8px_rgba(0,0,0,0.5)]">
                {i + 1}
              </span>
            </div>

            {/* 텍스트 */}
            <div className="p-3">
              {item.destination && (
                <p className="text-[11px] font-bold text-brand mb-0.5">{item.destination}</p>
              )}
              <h3 className="text-[13px] font-semibold text-text-primary leading-snug line-clamp-2 tracking-[-0.01em]">
                {item.title}
              </h3>
              {item.minPrice && item.minPrice > 0 && (
                <div className="mt-2 flex items-baseline gap-0.5">
                  <span className="text-[15px] font-extrabold text-brand tabular-nums">
                    {item.minPrice.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-text-secondary font-medium ml-0.5">원~</span>
                </div>
              )}
            </div>
          </Link>
        ))}

        {/* 더보기 카드 */}
        <Link
          href="/packages"
          className="flex-shrink-0 w-[160px] md:w-[190px] rounded-[16px] border-2 border-dashed border-[#E5E7EB] flex flex-col items-center justify-center gap-2 text-text-secondary hover:text-brand hover:border-brand transition-colors p-4"
        >
          <span className="text-2xl">→</span>
          <span className="text-[13px] font-medium">전체 보기</span>
        </Link>
      </div>
    </div>
  );
}
