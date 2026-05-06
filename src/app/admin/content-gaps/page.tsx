'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface GapItem {
  id: string;
  title: string;
  destination: string | null;
  duration: number | null;
  price: number | null;
  bookings: number;
  has_blog: boolean;
  has_card_news: boolean;
  has_ad_copy: boolean;
  content_count: number;
}

interface GapStats {
  total: number;
  withContent: number;
  withoutContent: number;
  highPriority: number;
}

export default function ContentGapsPage() {
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [stats, setStats] = useState<GapStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'no-content' | 'partial' | 'complete'>('no-content');

  useEffect(() => {
    setLoading(true);
    fetch('/api/content-gaps')
      .then(r => r.json())
      .then(d => { setGaps(d.gaps || []); setStats(d.stats || null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = gaps.filter(g => {
    if (filter === 'no-content') return g.content_count === 0;
    if (filter === 'partial') return g.content_count > 0 && g.content_count < 3;
    if (filter === 'complete') return g.content_count >= 3;
    return true;
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-admin-lg font-semibold text-slate-800">콘텐츠 갭 분석</h1>
        <p className="text-[11px] text-slate-500 mt-0.5">블로그/카드뉴스/광고카피가 없는 상품을 찾아 우선 생성</p>
      </div>

      {/* KPI */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3">
            <p className="text-[10px] text-slate-400">전체 상품</p>
            <p className="text-[20px] font-bold text-slate-800">{stats.total}</p>
          </div>
          <div className="bg-white border border-red-200 rounded-lg p-3">
            <p className="text-[10px] text-red-400">콘텐츠 0개</p>
            <p className="text-[20px] font-bold text-red-600">{stats.withoutContent}</p>
          </div>
          <div className="bg-white border border-orange-200 rounded-lg p-3">
            <p className="text-[10px] text-orange-400">긴급 (예약 있음 + 콘텐츠 0)</p>
            <p className="text-[20px] font-bold text-orange-600">{stats.highPriority}</p>
          </div>
          <div className="bg-white border border-green-200 rounded-lg p-3">
            <p className="text-[10px] text-green-400">콘텐츠 보유</p>
            <p className="text-[20px] font-bold text-green-600">{stats.withContent}</p>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-1">
        {([
          { key: 'no-content' as const, label: '콘텐츠 없음', color: 'text-red-600' },
          { key: 'partial' as const, label: '부분 생성', color: 'text-orange-600' },
          { key: 'complete' as const, label: '완전 보유', color: 'text-green-600' },
          { key: 'all' as const, label: '전체', color: 'text-slate-600' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded text-admin-xs font-medium transition ${
              filter === f.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden divide-y divide-slate-50">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <div className="h-3.5 bg-slate-100 rounded animate-pulse flex-1" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-20" />
              <div className="h-3.5 bg-slate-100 rounded animate-pulse w-24" />
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full text-admin-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-left">
                <th className="px-3 py-2.5 font-medium">상품</th>
                <th className="px-3 py-2.5 font-medium">목적지</th>
                <th className="px-3 py-2.5 font-medium text-center">예약</th>
                <th className="px-3 py-2.5 font-medium text-center">블로그</th>
                <th className="px-3 py-2.5 font-medium text-center">카드뉴스</th>
                <th className="px-3 py-2.5 font-medium text-center">광고카피</th>
                <th className="px-3 py-2.5 font-medium text-center">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(g => (
                <tr key={g.id} className={`hover:bg-slate-50 transition ${g.bookings > 0 && g.content_count === 0 ? 'bg-red-50/30' : ''}`}>
                  <td className="px-3 py-2.5">
                    <p className="text-admin-xs font-medium text-slate-800 truncate max-w-xs">{g.title}</p>
                    {g.price && <p className="text-[10px] text-slate-400">{g.price.toLocaleString()}원~</p>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{g.destination || '-'}</td>
                  <td className="px-3 py-2.5 text-center">
                    {g.bookings > 0 ? (
                      <span className="font-bold text-indigo-600">{g.bookings}건</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">{g.has_blog ? '✅' : '❌'}</td>
                  <td className="px-3 py-2.5 text-center">{g.has_card_news ? '✅' : '❌'}</td>
                  <td className="px-3 py-2.5 text-center">{g.has_ad_copy ? '✅' : '❌'}</td>
                  <td className="px-3 py-2.5 text-center">
                    <Link href={`/admin/content-hub?pkg=${g.id}`}
                      className="px-2.5 py-1 bg-blue-600 text-white text-[11px] font-medium rounded hover:bg-blue-700 transition">
                      생성
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10">
              <svg className="w-8 h-8 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
              <p className="text-admin-sm font-medium text-slate-500">해당 조건의 상품이 없습니다</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
