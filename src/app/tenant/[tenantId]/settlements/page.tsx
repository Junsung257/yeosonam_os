'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface SettlementRow {
  order_id:     string;
  product_name: string;
  date:         string;
  quantity:     number;
  cost:         number;
}

function getMonthOptions() {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function TenantSettlementsPage() {
  const params   = useParams();
  const tenantId = params.tenantId as string;
  const monthOptions = getMonthOptions();

  const [month,      setMonth]      = useState(monthOptions[0]);
  const [rows,       setRows]       = useState<SettlementRow[]>([]);
  const [totalCost,  setTotalCost]  = useState(0);
  const [loading,    setLoading]    = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/tenant/settlements?tenant_id=${tenantId}&month=${month}`);
    const data = await res.json();
    setRows(data.rows ?? []);
    setTotalCost(data.total_cost ?? 0);
    setLoading(false);
  }, [tenantId, month]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">정산 조회</h1>
          <p className="text-sm text-gray-500 mt-0.5">판매된 자사 상품의 정산 원가를 확인합니다.</p>
        </div>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium">총 정산 예정 원가</p>
          <p className="text-2xl font-bold text-indigo-700 mt-1">₩{fmt(totalCost)}</p>
          <p className="text-xs text-gray-400 mt-0.5">여소남 OS가 지급 예정인 금액</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium">판매 건수</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{rows.length}건</p>
          <p className="text-xs text-gray-400 mt-0.5">{month} 완료된 주문</p>
        </div>
      </div>

      {/* 안내 배너 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
        💡 본 화면은 여소남 OS가 귀사에 정산해 드릴 <strong>원가</strong>만 표시됩니다. 플랫폼 수수료 및 판매가는 계약서에 따라 별도 관리됩니다.
      </div>

      {/* 정산 내역 테이블 */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b">
          <h2 className="font-semibold text-gray-900 text-sm">{month} 정산 내역 ({rows.length}건)</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              {['주문일', '상품명', '수량', '정산 원가', '합계'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">로딩 중...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">{month}에 판매된 자사 상품이 없습니다.</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.order_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600 text-xs">{r.date}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.product_name}</td>
                  <td className="px-4 py-3 text-gray-600">{r.quantity}개</td>
                  <td className="px-4 py-3 text-indigo-700 font-semibold">₩{fmt(r.cost / r.quantity)}</td>
                  <td className="px-4 py-3 font-bold text-indigo-700">₩{fmt(r.cost)}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-indigo-50 font-bold">
                <td colSpan={4} className="px-4 py-3 text-indigo-700">합계</td>
                <td className="px-4 py-3 text-indigo-700 font-bold">₩{fmt(totalCost)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
