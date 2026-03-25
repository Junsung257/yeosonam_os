'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const COMMISSION_RATE = 9;
function applyCommission(price: number) {
  return Math.round(price * (1 + COMMISSION_RATE / 100));
}

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  confidence?: number;
  file_type?: string;
  created_at?: string;
  status?: string;
}

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [filtered, setFiltered] = useState<Package[]>([]);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [selectedDest, setSelectedDest] = useState('전체');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/packages')
      .then(r => r.json())
      .then(data => {
        const pkgs: Package[] = data.packages ?? [];
        setPackages(pkgs);
        setFiltered(pkgs);
        const dests = Array.from(new Set(pkgs.map(p => p.destination).filter(Boolean))) as string[];
        setDestinations(dests);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  function filterBy(dest: string) {
    setSelectedDest(dest);
    setFiltered(dest === '전체' ? packages : packages.filter(p => p.destination?.includes(dest)));
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-1">여행 상품 목록</h1>
            <p className="text-gray-500 text-sm">승인된 상품 {filtered.length}개 · 커미션 {COMMISSION_RATE}% 포함 판매가</p>
          </div>
          <Link href="/admin/qa" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition">
            AI 상담 문의
          </Link>
        </div>

        {/* 목적지 필터 */}
        <div className="flex gap-2 flex-wrap mb-6">
          {['전체', ...destinations].map(d => (
            <button
              key={d}
              onClick={() => filterBy(d)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                selectedDest === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:border-blue-400'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center py-20 text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg mb-2">등록된 상품이 없습니다</p>
            <Link href="/admin/upload" className="text-blue-600 underline text-sm">문서 업로드하러 가기</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map(pkg => (
              <Link key={pkg.id} href={`/packages/${pkg.id}`}>
                <div className="bg-white rounded-xl shadow hover:shadow-lg transition cursor-pointer overflow-hidden border border-gray-100">
                  {/* 카드 헤더 */}
                  <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-4 text-white">
                    <div className="flex items-start justify-between">
                      <h2 className="font-semibold text-sm leading-tight line-clamp-2 flex-1 mr-2">
                        {pkg.title}
                      </h2>
                      {pkg.confidence !== undefined && (
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                          pkg.confidence >= 0.8 ? 'bg-green-400/80' :
                          pkg.confidence >= 0.6 ? 'bg-yellow-400/80' : 'bg-red-400/80'
                        } text-white`}>
                          {Math.round(pkg.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 카드 본문 */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      {pkg.destination && (
                        <span className="flex items-center gap-1">
                          <span>📍</span> {pkg.destination}
                        </span>
                      )}
                      {pkg.duration && (
                        <span className="flex items-center gap-1">
                          <span>🗓</span> {pkg.duration}일
                        </span>
                      )}
                    </div>

                    {pkg.price ? (
                      <div className="pt-2 border-t border-gray-100">
                        <p className="text-xs text-gray-400">기본가 {pkg.price.toLocaleString()}원</p>
                        <p className="text-lg font-bold text-blue-700">
                          {applyCommission(pkg.price).toLocaleString()}원
                          <span className="text-xs font-normal text-gray-500 ml-1">/ 1인</span>
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 pt-2 border-t border-gray-100">가격 미정</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
