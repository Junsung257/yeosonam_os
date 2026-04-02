'use client';

import { useEffect, useState } from 'react';
import ProductCard from '@/components/ProductCard';
import ProductSearch from '@/components/ProductSearch';
import { getSessionId, trackSearch } from '@/lib/tracker';
import { getMinPriceFromDates } from '@/lib/price-dates';

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  nights?: number;
  price?: number;
  price_tiers?: { period_label?: string; departure_dates?: string[]; adult_price?: number }[];
  price_dates?: { date: string; price: number; confirmed: boolean }[];
  product_type?: string;
  airline?: string;
  product_highlights?: string[];
  product_summary?: string;
  itinerary_data?: any;
  country?: string;
  view_count?: number;
}

interface Filters {
  destination: string;
  priceMin: number;
  priceMax: number;
}

export default function ProductsPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    destination: '',
    priceMin: 0,
    priceMax: 10000000,
  });

  useEffect(() => {
    loadPackages();
  }, [filters]);

  async function loadPackages() {
    setLoading(true);

    try {
      const params = new URLSearchParams({ status: 'approved', limit: '50' });
      if (filters.destination) {
        params.set('destination', filters.destination);
      }

      const res = await fetch(`/api/packages?${params}`);
      const data = await res.json();
      let pkgs: Package[] = data.data ?? data.packages ?? [];

      // 클라이언트 사이드 필터 (destination 부분매칭 + 가격대)
      if (filters.destination) {
        const q = filters.destination.toLowerCase();
        pkgs = pkgs.filter(
          (p) =>
            (p.destination || '').toLowerCase().includes(q) ||
            (p.country || '').toLowerCase().includes(q)
        );
      }

      pkgs = pkgs.filter((p) => {
        const minPrice = getMinPrice(p);
        if (minPrice <= 0) return true; // 가격 미정 상품은 항상 표시
        return minPrice >= filters.priceMin && minPrice <= filters.priceMax;
      });

      setPackages(pkgs);

      // 검색 추적
      if (filters.destination) {
        trackSearch({
          search_query: filters.destination,
          search_category: 'products',
          result_count: pkgs.length,
        });
      }
    } catch {
      /* 에러 시 빈 목록 */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-3xl font-bold mb-8">여행 상품</h1>

        <ProductSearch filters={filters} onFilterChange={setFilters} />

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="animate-pulse bg-white rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-gray-200 h-48" />
                <div className="p-4 space-y-3">
                  <div className="bg-gray-200 h-5 rounded w-3/4" />
                  <div className="bg-gray-200 h-4 rounded w-1/2" />
                  <div className="bg-gray-200 h-6 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {packages.map((pkg) => (
              <ProductCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        )}

        {!loading && packages.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg mb-2">검색 결과가 없습니다.</p>
            <button
              onClick={() => setFilters({ destination: '', priceMin: 0, priceMax: 10000000 })}
              className="text-violet-600 underline text-sm"
            >
              필터 초기화
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getMinPrice(pkg: Package): number {
  if (pkg.price_dates?.length) {
    const min = getMinPriceFromDates(pkg.price_dates as any);
    if (min > 0) return min;
  }
  const tierPrices = (pkg.price_tiers || []).map((t) => t.adult_price).filter(Boolean) as number[];
  const all = [pkg.price, ...tierPrices].filter(Boolean) as number[];
  return all.length > 0 ? Math.min(...all) : 0;
}
