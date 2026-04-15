'use client';

import { useEffect, useState } from 'react';

interface LeaderboardRow {
  rank: number;
  affiliate_id: string | null;
  name: string;
  grade: number | null;
  logo_url: string | null;
  booking_count: number;
  total_amount: number;
  final_payout: number;
}

interface Props {
  period?: string;
  anonymized?: boolean;
  limit?: number;
  title?: string;
}

const GRADE_COLORS: Record<number, string> = {
  1: 'bg-amber-700',
  2: 'bg-gray-400',
  3: 'bg-yellow-500',
  4: 'bg-cyan-500',
  5: 'bg-purple-500',
};

export function Leaderboard({
  period,
  anonymized = false,
  limit = 10,
  title = '월간 TOP 인플루언서',
}: Props) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(
    period || new Date().toISOString().slice(0, 7),
  );

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({
      period: selectedPeriod,
      anonymized: String(anonymized),
      limit: String(limit),
    });
    fetch(`/api/affiliates/leaderboard?${qs.toString()}`)
      .then((r) => r.json())
      .then((res) => setRows(res.data || []))
      .finally(() => setLoading(false));
  }, [selectedPeriod, anonymized, limit]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-gray-900">🏆 {title}</h3>
        <input
          type="month"
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1"
        />
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-4 text-center">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-400 py-4 text-center">
          {selectedPeriod} 정산 데이터가 없습니다.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={`${row.rank}-${row.name}`}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50"
            >
              <span
                className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold ${
                  row.rank === 1
                    ? 'bg-yellow-400 text-white'
                    : row.rank === 2
                      ? 'bg-gray-300 text-gray-800'
                      : row.rank === 3
                        ? 'bg-amber-600 text-white'
                        : 'bg-gray-100 text-gray-600'
                }`}
              >
                {row.rank}
              </span>
              {row.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.logo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                  {row.name.charAt(0)}
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{row.name}</span>
                  {row.grade && (
                    <span
                      className={`text-[9px] text-white px-1.5 py-0.5 rounded-full font-bold ${GRADE_COLORS[row.grade] || 'bg-gray-400'}`}
                    >
                      L{row.grade}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500">
                  예약 {row.booking_count}건 · 매출 {row.total_amount.toLocaleString()}원
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-purple-700">
                  {row.final_payout.toLocaleString()}원
                </div>
                <div className="text-[10px] text-gray-400">정산액</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
