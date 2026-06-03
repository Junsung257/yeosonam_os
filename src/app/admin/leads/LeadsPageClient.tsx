'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import type { AdminInquiryRow } from '@/app/api/admin/leads/route';
import { maskPhone } from '@/lib/pii-mask';

type Filter = 'all' | 'lead' | 'qa';

export default function LeadsPageClient() {
  const [rows, setRows] = useState<AdminInquiryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/leads', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '조회 실패');
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter(r => r.source === filter);
  }, [rows, filter]);

  const counts = useMemo(() => ({
    all: rows.length,
    lead: rows.filter(r => r.source === 'lead').length,
    qa: rows.filter(r => r.source === 'qa').length,
  }), [rows]);

  const fmtDate = (iso: string) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">예약문의 / 상담신청</h1>
          <p className="text-sm text-gray-500 mt-1">모바일 랜딩 + 챗봇 문의 통합 노출 (최신순, 500건 한도)</p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium"
        >
          ↻ 새로고침
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {(['all', 'lead', 'qa'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === f
                ? 'bg-brand text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? '전체' : f === 'lead' ? '예약문의(폼)' : 'QA 챗봇'} ({counts[f]})
          </button>
        ))}
      </div>

      {loading && <div className="py-12 text-center text-gray-500">불러오는 중…</div>}
      {error && (
        <div className="py-6 text-center text-red-600 bg-red-50 rounded-lg">
          <p className="font-semibold">조회 실패</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="py-12 text-center text-gray-400">
          {filter === 'lead' ? '아직 모바일 폼 예약문의가 없습니다.' :
           filter === 'qa' ? '아직 QA 챗봇 문의가 없습니다.' :
           '예약문의가 없습니다.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3 text-left">구분</th>
                <th className="px-3 py-3 text-left">접수시간</th>
                <th className="px-3 py-3 text-left">이름</th>
                <th className="px-3 py-3 text-left">연락처</th>
                <th className="px-3 py-3 text-left">상품/문의</th>
                <th className="px-3 py-3 text-left">희망일</th>
                <th className="px-3 py-3 text-left">유입</th>
                <th className="px-3 py-3 text-left">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(r => (
                <tr key={`${r.source}-${r.id}`} className="hover:bg-gray-50">
                  <td className="px-3 py-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                      r.source === 'lead' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                    }`}>
                      {r.source === 'lead' ? '폼' : 'QA'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="px-3 py-3 font-medium text-gray-900">{r.name ?? '-'}</td>
                  <td className="px-3 py-3 text-gray-700 tabular-nums">{maskPhone(r.phone, 'marketer') ?? '-'}</td>
                  <td className="px-3 py-3 max-w-md">
                    {r.product_id && r.product_title ? (
                      <Link href={`/packages/${encodeURIComponent(r.product_id)}`} target="_blank" className="text-brand hover:underline">
                        {r.product_title}
                      </Link>
                    ) : r.message ? (
                      <span className="text-gray-700 line-clamp-2">{r.message}</span>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{r.desired_date ?? '-'}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {r.utm_source && (
                      <div>{r.utm_source}{r.utm_medium ? ` / ${r.utm_medium}` : ''}</div>
                    )}
                    {r.channel && !r.utm_source && <div>{r.channel}</div>}
                  </td>
                  <td className="px-3 py-3">
                    {r.status ? (
                      <span className="inline-block px-2 py-1 rounded text-xs bg-gray-100 text-gray-700">{r.status}</span>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
