'use client';

import { useState, useEffect } from 'react';

interface TravelHistory {
  id: string;
  destination: string;
  destination_country?: string;
  departure_date?: string;
  duration_nights?: number;
  trip_type?: string;
  tenant_name?: string;
  proposal_title?: string;
  total_price?: number;
  total_pax?: number;
  stamp_image_url?: string | null;
  review_submitted?: boolean;
}

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

const TRIP_ICONS: Record<string, string> = {
  '가족여행': '👨‍👩‍👧‍👦',
  '친구·모임': '👫',
  '회사 단체': '🏢',
  '동호회·동문': '🎯',
  '특별한 날': '🎉',
  '혼자 여행': '🧳',
};

export function TravelPassport() {
  const [histories, setHistories] = useState<TravelHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    fetch('/api/travel-history')
      .then((r) => {
        if (!r.ok) throw new Error('API 오류');
        return r.json();
      })
      .then((d) => setHistories(d.histories ?? []))
      .catch(() => { setFetchError(true); setHistories([]); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-16 bg-gray-100 rounded-xl mb-2" />
        <div className="h-16 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="font-bold text-gray-900 mb-3">📕 여행 Passport</h2>
        <div className="text-center py-6">
          <p className="text-3xl mb-2">⚠️</p>
          <p className="text-sm text-red-400 mb-1">여행 기록을 불러올 수 없습니다</p>
          <p className="text-xs text-gray-300">잠시 후 다시 시도해주세요.</p>
        </div>
      </div>
    );
  }

  if (histories.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="font-bold text-gray-900 mb-3">📕 여행 Passport</h2>
        <div className="text-center py-6">
          <p className="text-3xl mb-2">🛂</p>
          <p className="text-sm text-gray-400 mb-1">아직 여행 기록이 없습니다</p>
          <p className="text-xs text-gray-300">첫 여행을 다녀오시면 Passport에 스탬프가 찍힙니다!</p>
        </div>
      </div>
    );
  }

  // 정렬 (최신순)
  const sorted = [...histories].sort((a, b) => {
    if (a.departure_date && b.departure_date) {
      return b.departure_date.localeCompare(a.departure_date);
    }
    return 0;
  });

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-gray-900">📕 여행 Passport</h2>
        <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
          🏆 {histories.length}개 스탬프
        </span>
      </div>

      <div className="space-y-3">
        {sorted.map((h, idx) => {
          const tripIcon = TRIP_ICONS[h.trip_type ?? ''] ?? '✈️';
          const year = h.departure_date?.slice(0, 4);
          const stampRotation = [-2, 1, -1, 2, 0][idx % 5]; // 약간 기울어진 스탬프 효과
          const stampColors = [
            'from-amber-50 to-orange-50 border-amber-100',
            'from-sky-50 to-blue-50 border-sky-100',
            'from-emerald-50 to-teal-50 border-emerald-100',
            'from-rose-50 to-pink-50 border-rose-100',
            'from-violet-50 to-purple-50 border-violet-100',
          ];
          const colorClass = stampColors[idx % stampColors.length];

          return (
            <div
              key={h.id}
              className={`flex items-start gap-3 p-3 rounded-xl bg-gradient-to-r ${colorClass}`}
            >
              {/* 스탬프 */}
              <div
                className="w-12 h-12 rounded-full bg-white border-2 border-current flex items-center justify-center text-xl shadow-sm shrink-0 text-amber-500"
                style={{ transform: `rotate(${stampRotation}deg)` }}
              >
                {h.stamp_image_url ? (
                  <img src={h.stamp_image_url} alt={`${h.destination} 여행 스탬프`} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <span role="img" aria-label={`${h.destination} 여행`}>{tripIcon}</span>
                )}
              </div>

              {/* 내용 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-bold text-gray-900 text-sm truncate">{h.destination}</span>
                  {h.destination_country && (
                    <span className="text-xs text-gray-400 shrink-0">{h.destination_country}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-500">
                  {year && <span>{year}</span>}
                  {h.duration_nights && <span>{h.duration_nights}박</span>}
                  {h.trip_type && <span>{h.trip_type}</span>}
                  {h.total_pax && <span>{h.total_pax}명</span>}
                  {h.total_price != null && (
                    <span className="text-brand font-semibold">₩{fmt(h.total_price)}</span>
                  )}
                </div>
                {h.tenant_name && (
                  <p className="text-xs text-gray-400 mt-0.5">🏢 {h.tenant_name}</p>
                )}
              </div>

              {/* 리뷰 상태 */}
              {h.review_submitted && (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full shrink-0">
                  후기완료
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
