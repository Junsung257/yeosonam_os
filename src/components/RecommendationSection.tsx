'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Recommendation {
  package_id: string;
  package_name: string;
  destination: string;
  price: number;
  score: number;
  reason: string;
}

interface Props {
  customerId?: string;
  destination?: string;
  title?: string;
}

export default function RecommendationSection({ customerId, destination, title = '추천 여행 상품' }: Props) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [algorithm, setAlgorithm] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (customerId) params.set('customer_id', customerId);
    if (destination) params.set('destination', destination);

    fetch(`/api/recommendations?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setRecs(data.recommendations);
          setAlgorithm(data.algorithm);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [customerId, destination]);

  const handleClick = (packageId: string) => {
    const sid = document.cookie.match(/(?:^|;\s*)ys_session_id=([^;]*)/)?.[1];
    if (sid) {
      fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, packageId }),
      }).catch(() => {});
    }
  };

  if (loading) {
    return (
      <section className="py-8">
        <div className="px-4 max-w-6xl mx-auto">
          <div className="h-6 bg-gray-200 rounded w-40 mb-4 animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="animate-pulse bg-white rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-gray-200 h-32" />
                <div className="p-3 space-y-2">
                  <div className="bg-gray-200 h-4 rounded w-3/4" />
                  <div className="bg-gray-200 h-5 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (!recs.length) return null;

  const ALGO_LABELS: Record<string, string> = {
    similar_customers: '유사 고객 추천',
    trending: '인기 상품',
    personalized: '맞춤 추천',
  };

  return (
    <section className="py-8">
      <div className="px-4 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold text-gray-900">{title}</h2>
          {algorithm && (
            <span className="text-[10px] bg-violet-50 text-violet-600 px-2 py-1 rounded-full font-medium">
              {ALGO_LABELS[algorithm] || algorithm}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {recs.slice(0, 8).map(rec => (
            <Link
              key={rec.package_id}
              href={`/packages/${rec.package_id}`}
              onClick={() => handleClick(rec.package_id)}
              className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-all"
            >
              <div className="h-32 bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center text-2xl">
                🌍
              </div>
              <div className="p-3">
                <p className="text-[10px] text-violet-600 font-medium mb-0.5">{rec.destination}</p>
                <h3 className="text-xs font-bold text-gray-900 line-clamp-2 mb-1.5">{rec.package_name}</h3>
                {rec.price > 0 && (
                  <p className="text-sm font-black text-gray-900">₩{rec.price.toLocaleString()}<span className="text-[10px] font-normal text-gray-400">~</span></p>
                )}
                <p className="text-[9px] text-gray-400 mt-1">{rec.reason}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
