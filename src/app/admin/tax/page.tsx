'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { fmtNum as fmt } from '@/lib/admin-utils';

interface TaxBooking {
  id:                      string;
  booking_no:              string;
  package_title:           string;
  land_operator:           string | null;
  total_price:             number;
  total_cost:              number;
  departure_date:          string;
  booking_date:            string | null;
  payment_date:            string | null;
  notes:                   string | null;
  status:                  string;
  transfer_status:         'PENDING' | 'COMPLETED';
  transfer_receipt_url:    string | null;
  has_tax_invoice:         boolean;
  customer_receipt_status: 'ISSUED' | 'NOT_ISSUED' | 'NOT_REQUIRED';
  customers:               { name: string; phone?: string } | null;
}

interface Kpis {
  total_price:  number;
  total_cost:   number;
  net_sales:    number;
  vat_estimate: number;
}

interface Todos {
  pending_transfers:  TaxBooking[];
  not_issued_receipts: TaxBooking[];
}

// 최근 12개월 목록 생성
function getMonthOptions(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

const RECEIPT_LABEL: Record<string, string> = {
  ISSUED:       'O 발행',
  NOT_ISSUED:   'X 미발행',
  NOT_REQUIRED: 'N/A 불필요',
};

const RECEIPT_COLOR: Record<string, string> = {
  ISSUED:       'text-green-700 bg-green-50',
  NOT_ISSUED:   'text-red-700 bg-red-50',
  NOT_REQUIRED: 'text-slate-500 bg-slate-50',
};

export default function TaxPage() {
  const monthOptions        = getMonthOptions();
  const [month, setMonth]   = useState(monthOptions[0]);
  const [bookings, setBookings] = useState<TaxBooking[]>([]);
  const [kpis, setKpis]     = useState<Kpis | null>(null);
  const [todos, setTodos]   = useState<Todos | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const uploadRefs          = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/tax?month=${month}`);
      const data = await res.json();
      setBookings(data.bookings ?? []);
      setKpis(data.kpis ?? null);
      setTodos(data.todos ?? null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  async function updateField(id: string, fields: Partial<TaxBooking>) {
    setSaving(s => ({ ...s, [id]: true }));
    try {
      await fetch(`/api/tax/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      });
      // 낙관적 업데이트
      setBookings(prev =>
        prev.map(b => b.id === id ? { ...b, ...fields } : b)
      );
      // Todos 갱신
      await load();
    } finally {
      setSaving(s => ({ ...s, [id]: false }));
    }
  }

  async function handleFileUpload(bookingId: string, file: File) {
    setSaving(s => ({ ...s, [bookingId]: true }));
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res  = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      const url: string = data.url ?? data.path ?? data.publicUrl ?? '';
      if (url) {
        await updateField(bookingId, { transfer_receipt_url: url });
      }
    } finally {
      setSaving(s => ({ ...s, [bookingId]: false }));
    }
  }

  function downloadCSV() {
    const a = document.createElement('a');
    a.href = `/api/tax/export?month=${month}`;
    a.download = `세무기장_${month}.csv`;
    a.click();
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[16px] font-semibold text-slate-800">세무 / 송금 관리</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">출발일(행사일) 기준 매출 인식 / 양방향 증빙 관리</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 font-medium">출발일 기준 월:</span>
            <select
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="border border-slate-200 rounded px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {monthOptions.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <button
            onClick={downloadCSV}
            className="flex items-center gap-2 px-4 py-2 bg-[#001f3f] text-white rounded text-[13px] font-medium hover:bg-blue-900 transition"
          >
            세무사 제출용 엑셀 다운로드
          </button>
        </div>
      </div>

      {/* KPI 카드 4개 */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] text-slate-500 font-medium">총 입금액 (판매가)</p>
            <p className="text-xl font-bold text-indigo-700 mt-1">₩{fmt(kpis.total_price)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">출발일 기준</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] text-slate-500 font-medium">총 송금액 (원가)</p>
            <p className="text-xl font-bold text-orange-600 mt-1">₩{fmt(kpis.total_cost)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">랜드사 지불 원가</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] text-slate-500 font-medium">순매출</p>
            <p className="text-xl font-bold text-green-600 mt-1">₩{fmt(kpis.net_sales)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">판매가 - 원가</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] text-slate-500 font-medium">예상 부가세 (10%)</p>
            <p className="text-xl font-bold text-red-500 mt-1">₩{fmt(kpis.vat_estimate)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">순매출 x 10% 절사</p>
          </div>
        </div>
      )}

      {/* To-Do 경고 알림 */}
      {todos && (todos.pending_transfers.length > 0 || todos.not_issued_receipts.length > 0) && (
        <div className="bg-white border border-red-200 rounded-lg p-4 space-y-3">
          <h2 className="text-[13px] font-semibold text-red-700 flex items-center gap-2">
            처리 필요 항목 (To-Do)
          </h2>
          {todos.pending_transfers.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-red-600 mb-1.5">
                랜드사 원가 미송금 {todos.pending_transfers.length}건
              </p>
              <div className="flex flex-wrap gap-2">
                {todos.pending_transfers.map(b => (
                  <Link
                    key={b.id}
                    href={`/admin/bookings/${b.id}`}
                    className="text-[11px] bg-white border border-red-200 text-red-700 rounded-full px-2.5 py-1 hover:bg-red-50 transition"
                  >
                    {b.booking_no} ({b.customers?.name ?? '?'}, ₩{fmt(b.total_cost)})
                  </Link>
                ))}
              </div>
            </div>
          )}
          {todos.not_issued_receipts.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-red-600 mb-1.5">
                고객 현금영수증 미발행 {todos.not_issued_receipts.length}건
              </p>
              <div className="flex flex-wrap gap-2">
                {todos.not_issued_receipts.map(b => (
                  <Link
                    key={b.id}
                    href={`/admin/bookings/${b.id}`}
                    className="text-[11px] bg-white border border-red-200 text-red-700 rounded-full px-2.5 py-1 hover:bg-red-50 transition"
                  >
                    {b.booking_no} ({b.customers?.name ?? '?'}, ₩{fmt(b.total_price)})
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {todos &&
       todos.pending_transfers.length === 0 &&
       todos.not_issued_receipts.length === 0 &&
       bookings.length > 0 && (
        <div className="bg-green-50 border border-slate-200 rounded-lg p-3 flex items-center gap-2">
          <span className="text-green-600 text-[13px] font-medium">{month} 이 달 처리 필요 항목 없음</span>
        </div>
      )}

      {/* 예약 목록 테이블 */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-[14px]">
            예약 목록 - {month} 출발 ({bookings.length}건)
          </h2>
          {loading && <span className="text-[11px] text-slate-500 animate-pulse">로딩 중...</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {[
                  '출발일', '예약번호', '예약자', '판매가', '원가', '순매출',
                  '랜드사', '랜드사 송금', '세금계산서', '고객 영수증', '송금증',
                ].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && !loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-500 text-[13px]">
                    {month}에 출발하는 예약이 없습니다.
                  </td>
                </tr>
              ) : (
                bookings.map(b => {
                  const net = b.total_price - b.total_cost;
                  const isSaving = saving[b.id];
                  return (
                    <tr key={b.id} className={`border-b border-slate-200 hover:bg-slate-50 ${isSaving ? 'opacity-60' : ''}`}>
                      {/* 출발일 */}
                      <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                        {b.departure_date}
                      </td>

                      {/* 예약번호 */}
                      <td className="px-3 py-2">
                        <Link href={`/admin/bookings/${b.id}`} className="text-blue-600 hover:underline font-mono">
                          {b.booking_no}
                        </Link>
                      </td>

                      {/* 예약자 */}
                      <td className="px-3 py-2 whitespace-nowrap text-slate-800">
                        {b.customers?.name ?? '-'}
                      </td>

                      {/* 판매가 */}
                      <td className="px-3 py-2 text-right font-semibold text-indigo-700 whitespace-nowrap">
                        ₩{fmt(b.total_price)}
                      </td>

                      {/* 원가 */}
                      <td className="px-3 py-2 text-right text-orange-600 whitespace-nowrap">
                        ₩{fmt(b.total_cost)}
                      </td>

                      {/* 순매출 */}
                      <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ₩{fmt(net)}
                      </td>

                      {/* 랜드사 */}
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[100px] truncate">
                        {b.land_operator ?? '-'}
                      </td>

                      {/* 랜드사 송금 상태 */}
                      <td className="px-3 py-2">
                        <select
                          value={b.transfer_status}
                          disabled={isSaving}
                          onChange={e => updateField(b.id, { transfer_status: e.target.value as 'PENDING' | 'COMPLETED' })}
                          className={`text-[11px] border rounded px-2 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                            b.transfer_status === 'COMPLETED'
                              ? 'border-green-200 bg-green-50 text-green-700'
                              : 'border-red-200 bg-red-50 text-red-700'
                          }`}
                        >
                          <option value="PENDING">PENDING</option>
                          <option value="COMPLETED">완료</option>
                        </select>
                      </td>

                      {/* 세금계산서 */}
                      <td className="px-3 py-2 text-center">
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={b.has_tax_invoice}
                            disabled={isSaving}
                            onChange={e => updateField(b.id, { has_tax_invoice: e.target.checked })}
                            className="w-4 h-4 accent-blue-600"
                          />
                          <span className={`text-[11px] font-medium ${b.has_tax_invoice ? 'text-green-600' : 'text-slate-500'}`}>
                            {b.has_tax_invoice ? 'O' : 'X'}
                          </span>
                        </label>
                      </td>

                      {/* 고객 현금영수증 */}
                      <td className="px-3 py-2">
                        <select
                          value={b.customer_receipt_status}
                          disabled={isSaving}
                          onChange={e => updateField(b.id, { customer_receipt_status: e.target.value as TaxBooking['customer_receipt_status'] })}
                          className={`text-[11px] border rounded px-2 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 ${RECEIPT_COLOR[b.customer_receipt_status]}`}
                        >
                          <option value="NOT_ISSUED">X 미발행</option>
                          <option value="ISSUED">O 발행</option>
                          <option value="NOT_REQUIRED">N/A 불필요</option>
                        </select>
                      </td>

                      {/* 송금증 업로드 */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {b.transfer_receipt_url ? (
                            <a
                              href={b.transfer_receipt_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5"
                            >
                              보기
                            </a>
                          ) : (
                            <span className="text-[11px] text-slate-500">없음</span>
                          )}
                          <label className="cursor-pointer">
                            <span className="text-[11px] text-slate-500 hover:text-blue-600 transition">
                              {b.transfer_receipt_url ? '교체' : '업로드'}
                            </span>
                            <input
                              ref={el => { uploadRefs.current[b.id] = el; }}
                              type="file"
                              accept="image/*,.pdf"
                              className="hidden"
                              disabled={isSaving}
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(b.id, file);
                              }}
                            />
                          </label>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* 합계 행 */}
            {bookings.length > 0 && kpis && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-[13px]">
                  <td className="px-3 py-2 text-slate-800" colSpan={3}>합계 ({bookings.length}건)</td>
                  <td className="px-3 py-2 text-right text-indigo-700">₩{fmt(kpis.total_price)}</td>
                  <td className="px-3 py-2 text-right text-orange-600">₩{fmt(kpis.total_cost)}</td>
                  <td className={`px-3 py-2 text-right ${kpis.net_sales >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    ₩{fmt(kpis.net_sales)}
                  </td>
                  <td colSpan={5} className="px-3 py-2 text-[11px] text-slate-500 font-normal">
                    예상 부가세: ₩{fmt(kpis.vat_estimate)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 범례 */}
      <div className="text-[11px] text-slate-500 flex flex-wrap gap-4">
        <span>모든 금액은 출발일(행사일) 기준으로 집계됩니다.</span>
        <span>순매출 = 판매가 - 원가</span>
        <span>예상 부가세 = 순매출 x 10% (원 단위 절사)</span>
      </div>
    </div>
  );
}
