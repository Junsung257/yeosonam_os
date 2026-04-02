'use client';

import Link from 'next/link';
import Image from 'next/image';
import { trackEngagement } from '@/lib/tracker';

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  nights?: number;
  price?: number;
  price_tiers?: { period_label?: string; departure_dates?: string[]; adult_price?: number }[];
  product_type?: string;
  airline?: string;
  product_highlights?: string[];
  product_summary?: string;
  view_count?: number;
}

const AIRLINES: Record<string, string> = {
  BX: '에어부산', LJ: '진에어', OZ: '아시아나', KE: '대한항공',
  '7C': '제주항공', TW: '티웨이', VJ: '비엣젯', ZE: '이스타항공',
  CA: '중국국제항공', CZ: '중국남방항공', MU: '중국동방항공',
};

export default function ProductCard({ pkg }: { pkg: Package }) {
  const minPrice = getMinPrice(pkg);
  const nextDate = getNextDeparture(pkg);
  const airlineName = AIRLINES[pkg.airline || ''] || pkg.airline;

  function handleClick() {
    trackEngagement({
      event_type: 'product_view',
      product_id: pkg.id,
      product_name: pkg.title,
      page_url: `/packages/${pkg.id}`,
    });
  }

  return (
    <Link
      href={`/packages/${pkg.id}`}
      onClick={handleClick}
      className="block bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-lg hover:border-violet-300 border border-gray-100 transition-all"
    >
      {/* 이미지 */}
      <div className="relative h-48 bg-gradient-to-br from-violet-100 to-purple-200">
        <div className="w-full h-full flex items-center justify-center text-4xl">🌍</div>

        {/* 뱃지 */}
        {(pkg.nights || pkg.duration) && (
          <div className="absolute top-3 right-3 bg-black/60 text-white px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm">
            {pkg.nights ? `${pkg.nights}박${pkg.nights + 1}일` : `${pkg.duration}일`}
          </div>
        )}

        {pkg.product_type && (
          <div className="absolute top-3 left-3 bg-violet-500/90 text-white px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm">
            {pkg.product_type.split('|')[0]}
          </div>
        )}
      </div>

      {/* 내용 */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          {pkg.destination && (
            <span className="text-xs text-violet-600 font-semibold">{pkg.destination}</span>
          )}
          {airlineName && <span className="text-xs text-gray-400">· {airlineName}</span>}
        </div>

        <h3 className="font-bold text-sm text-gray-900 leading-snug line-clamp-2 mb-2">
          {pkg.title}
        </h3>

        {pkg.product_highlights && pkg.product_highlights.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {pkg.product_highlights.slice(0, 3).map((h, i) => (
              <span key={i} className="text-[10px] bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full">
                {h}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end justify-between">
          <div>
            {minPrice > 0 ? (
              <p className="text-lg font-black text-gray-900">
                ₩{minPrice.toLocaleString()}
                <span className="text-xs font-normal text-gray-400">~ /인</span>
              </p>
            ) : (
              <p className="text-sm text-gray-400">가격 문의</p>
            )}
          </div>

          {nextDate && (
            <span className="text-[10px] text-violet-600 font-medium bg-violet-50 px-2 py-1 rounded-full">
              {nextDate.slice(5).replace('-', '/')} 출발
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function getMinPrice(pkg: Package): number {
  const tierPrices = (pkg.price_tiers || []).map((t) => t.adult_price).filter(Boolean) as number[];
  const all = [pkg.price, ...tierPrices].filter(Boolean) as number[];
  return all.length > 0 ? Math.min(...all) : 0;
}

function getNextDeparture(pkg: Package): string | null {
  const today = new Date().toISOString().split('T')[0];
  const allDates = (pkg.price_tiers || [])
    .flatMap((t) => t.departure_dates || [])
    .filter((d) => d >= today)
    .sort();
  return allDates[0] || null;
}
