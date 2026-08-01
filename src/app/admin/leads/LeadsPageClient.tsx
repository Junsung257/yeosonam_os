'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import type { AdminInquiryRow } from '@/app/api/admin/leads/route';
import { maskPhone } from '@/lib/pii-mask';

type Filter = 'all' | 'lead' | 'qa' | 'rfq';

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
      if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? '조회 실패');
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
    rfq: rows.filter(r => r.source === 'rfq').length,
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
          <h1 className="text-2xl font-bold text-gray-900">오늘 처리할 일</h1>
          <p className="text-sm text-gray-500 mt-1">
            신규 상담부터 입금 확인까지, 우선순위와 다음 행동을 한 화면에 표시합니다.
          </p>
        </div>
        <button type="button"
          onClick={load}
          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium"
        >
          ↻ 새로고침
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {(['all', 'lead', 'qa', 'rfq'] as Filter[]).map(f => (
          <button type="button"
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === f
                ? 'bg-brand text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? '전체' : f === 'lead' ? '예약문의(폼)' : f === 'qa' ? 'QA 챗봇' : '단체 RFQ'} ({counts[f]})
          </button>
        ))}
      </div>

      {loading && (
        <div className="rounded-lg border border-gray-100 bg-white p-4 space-y-3" aria-label="업무 큐 불러오는 중">
          {[0, 1, 2, 3].map(row => (
            <div key={row} className="h-12 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      )}
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
           filter === 'rfq' ? '아직 단체 RFQ가 없습니다.' :
           '예약문의가 없습니다.'}
          <p className="text-sm mt-2">공개 상품의 상담 CTA와 리드 저장 상태를 먼저 확인해 주세요.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3 text-left">구분</th>
                <th className="px-3 py-3 text-left">우선순위</th>
                <th className="px-3 py-3 text-left">접수시간</th>
                <th className="px-3 py-3 text-left">이름</th>
                <th className="px-3 py-3 text-left">연락처</th>
                <th className="px-3 py-3 text-left">상품/문의</th>
                <th className="px-3 py-3 text-left">희망일</th>
                <th className="px-3 py-3 text-left">유입</th>
                <th className="px-3 py-3 text-left">다음 행동</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(r => (
                <tr key={`${r.source}-${r.id}`} className="hover:bg-gray-50">
                  <td className="px-3 py-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                      r.source === 'lead'
                        ? 'bg-blue-50 text-blue-700'
                        : r.source === 'qa'
                          ? 'bg-purple-50 text-purple-700'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {r.source === 'lead' ? '폼' : r.source === 'qa' ? 'QA' : 'RFQ'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-gray-900">{r.queue_label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{r.waiting_minutes}분 경과</div>
                  </td>
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="px-3 py-3 font-medium text-gray-900">{r.name ?? '-'}</td>
                  <td className="px-3 py-3 text-gray-700 tabular-nums">{maskPhone(r.phone, 'marketer') ?? '-'}</td>
                  <td className="px-3 py-3 max-w-md">
                    {r.source === 'rfq' && r.product_id ? (
                      <Link href={`/admin/rfqs/${encodeURIComponent(r.product_id)}`} target="_blank" className="text-brand hover:underline">
                        {r.product_title ?? '단체 RFQ'}
                      </Link>
                    ) : r.product_id && r.product_title ? (
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
                    {r.action_href ? (
                      <a
                        href={r.action_href}
                        className="inline-flex min-w-24 items-center justify-center rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                      >
                        {r.next_action}
                      </a>
                    ) : (
                      <span className="inline-flex min-w-24 items-center justify-center rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-500">
                        {r.next_action}
                      </span>
                    )}
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
