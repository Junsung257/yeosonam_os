'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { fmtNum as fmt } from '@/lib/admin-utils';
import { PageHeader, KpiCard } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Download, Wallet, Coins, TrendingUp, Receipt, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { calcSettlementAccounting } from '@/lib/settlement-accounting';

interface TaxBooking {
  id:                      string;
  booking_no:              string;
  package_title:           string;
  land_operator:           string | null;
  total_price:             number;
  total_cost:              number;
  paid_amount:             number;
  total_paid_out:          number;
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
  total_paid:   number;
  total_paid_out: number;
  receivable:   number;
  payable:      number;
  net_sales:    number;
  vat_estimate: number;
  net_profit_estimate: number;
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
  NOT_REQUIRED: 'text-admin-muted bg-admin-bg',
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
    <div className="space-y-5">
      <PageHeader
        title="세무 / 송금 관리"
        subtitle="출발일(행사일) 기준 매출 인식 / 양방향 증빙 관리"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-admin-xs text-admin-muted font-medium">출발일 기준 월</span>
            <select
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-sm bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            >
              {monthOptions.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <Button variant="primary" size="sm" onClick={downloadCSV}>
              <Download size={14} />
              세무사 제출용 엑셀
            </Button>
          </div>
        }
      />

      {/* KPI 카드 */}
      {kpis && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <KpiCard
            label="고객에게 받은 돈"
            value={`₩${fmt(kpis.total_paid)}`}
            icon={Wallet}
            tone="positive"
            hint={`미수 ₩${fmt(kpis.receivable)}`}
          />
          <KpiCard
            label="랜드사에 보낸 돈"
            value={`₩${fmt(kpis.total_paid_out)}`}
            icon={Coins}
            tone="negative"
            hint={`미송금 ₩${fmt(kpis.payable)}`}
          />
          <KpiCard
            label="예상 우리수익"
            value={`₩${fmt(kpis.net_sales)}`}
            icon={TrendingUp}
            tone="positive"
            hint="상품가 − 랜드사 예정액"
          />
          <KpiCard
            label="예상 순수익"
            value={`₩${fmt(kpis.net_profit_estimate)}`}
            icon={Receipt}
            hint={`세금 추정 ₩${fmt(kpis.vat_estimate)}`}
          />
        </div>
      )}

      {/* To-Do 경고 알림 */}
      {todos && (todos.pending_transfers.length > 0 || todos.not_issued_receipts.length > 0) && (
        <div className="admin-card p-4 space-y-3 border-danger/30">
          <h2 className="text-admin-base font-semibold text-danger flex items-center gap-2">
            <AlertTriangle size={16} />
            처리 필요 항목 (To-Do)
          </h2>
          {todos.pending_transfers.length > 0 && (
            <div>
              <p className="text-admin-xs font-semibold text-danger mb-2">
                랜드사 원가 미송금 <span className="admin-num">{todos.pending_transfers.length}</span>건
              </p>
              <div className="flex flex-wrap gap-1.5">
                {todos.pending_transfers.map(b => (
                  <Link
                    key={b.id}
                    href={`/admin/bookings/${b.id}`}
                    className="text-admin-xs bg-admin-surface border border-danger/30 text-danger rounded-full px-2.5 py-1 hover:bg-danger-light transition-colors admin-num"
                  >
                    {b.booking_no} ({b.customers?.name ?? '?'}, ₩{fmt(b.total_cost)})
                  </Link>
                ))}
              </div>
            </div>
          )}
          {todos.not_issued_receipts.length > 0 && (
            <div>
              <p className="text-admin-xs font-semibold text-danger mb-2">
                고객 현금영수증 미발행 <span className="admin-num">{todos.not_issued_receipts.length}</span>건
              </p>
              <div className="flex flex-wrap gap-1.5">
                {todos.not_issued_receipts.map(b => (
                  <Link
                    key={b.id}
                    href={`/admin/bookings/${b.id}`}
                    className="text-admin-xs bg-admin-surface border border-danger/30 text-danger rounded-full px-2.5 py-1 hover:bg-danger-light transition-colors admin-num"
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
        <div className="bg-status-successBg border border-success/20 rounded-admin-sm p-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-status-successFg" />
          <span className="text-status-successFg text-admin-sm font-medium admin-num">{month} 이 달 처리 필요 항목 없음</span>
        </div>
      )}

      {/* 예약 목록 테이블 */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-admin-border flex items-center justify-between">
          <h2 className="text-admin-h3 text-admin-text">
            예약 목록 — <span className="admin-num">{month}</span> 출발 (<span className="admin-num">{bookings.length}</span>건)
          </h2>
          {loading && <span className="text-admin-xs text-admin-muted animate-pulse">로딩 중…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="admin-data-table">
            <thead>
              <tr>
                {[
                  '출발일', '예약번호', '예약자', '판매가', '입금', '미수',
                  '랜드사 예정', '송금액', '미송금', '우리수익',
                  '랜드사', '랜드사 송금', '세금계산서', '고객 영수증', '송금증',
                ].map(h => (
                  <th key={h} className="whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && !loading ? (
                <tr>
                  <td colSpan={15} className="px-3 py-10 text-center text-admin-muted text-admin-sm" style={{ height: 'auto' }}>
                    <span className="admin-num">{month}</span>에 출발하는 예약이 없습니다.
                  </td>
                </tr>
              ) : (
                bookings.map(b => {
                  const accounting = calcSettlementAccounting({
                    totalPrice: b.total_price,
                    totalCost: b.total_cost,
                    paidAmount: b.paid_amount,
                    totalPaidOut: b.total_paid_out,
                  });
                  const isSaving = saving[b.id];
                  return (
                    <tr key={b.id} className={`border-b border-admin-border-mid hover:bg-admin-bg ${isSaving ? 'opacity-60' : ''}`}>
                      {/* 출발일 */}
                      <td className="px-3 py-2 font-medium text-admin-text-2 whitespace-nowrap">
                        {b.departure_date}
                      </td>

                      {/* 예약번호 */}
                      <td className="px-3 py-2">
                        <Link href={`/admin/bookings/${b.id}`} className="text-blue-600 hover:underline font-mono">
                          {b.booking_no}
                        </Link>
                      </td>

                      {/* 예약자 */}
                      <td className="px-3 py-2 whitespace-nowrap text-admin-text-2">
                        {b.customers?.name ?? '-'}
                      </td>

                      {/* 판매가 */}
                      <td className="px-3 py-2 text-right font-semibold text-indigo-700 whitespace-nowrap">
                        ₩{fmt(b.total_price)}
                      </td>

                      {/* 입금 */}
                      <td className="px-3 py-2 text-right font-semibold text-blue-700 whitespace-nowrap">
                        ₩{fmt(b.paid_amount || 0)}
                      </td>

                      {/* 미수 */}
                      <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${accounting.receivable > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        ₩{fmt(accounting.receivable)}
                      </td>

                      {/* 랜드사 예정 */}
                      <td className="px-3 py-2 text-right text-orange-600 whitespace-nowrap">
                        ₩{fmt(b.total_cost)}
                      </td>

                      {/* 송금액 */}
                      <td className="px-3 py-2 text-right text-orange-700 whitespace-nowrap">
                        ₩{fmt(b.total_paid_out || 0)}
                      </td>

                      {/* 미송금 */}
                      <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${accounting.payable > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        ₩{fmt(accounting.payable)}
                      </td>

                      {/* 우리수익 */}
                      <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${accounting.grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ₩{fmt(accounting.grossProfit)}
                      </td>

                      {/* 랜드사 */}
                      <td className="px-3 py-2 text-admin-muted whitespace-nowrap max-w-[100px] truncate">
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
                          <span className={`text-[11px] font-medium ${b.has_tax_invoice ? 'text-green-600' : 'text-admin-muted'}`}>
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
                            <span className="text-[11px] text-admin-muted">없음</span>
                          )}
                          <label className="cursor-pointer">
                            <span className="text-[11px] text-admin-muted hover:text-blue-600 transition">
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
                <tr className="border-t-2 border-admin-border-mid bg-admin-bg font-bold text-admin-sm">
                  <td className="px-3 py-2 text-admin-text-2" colSpan={3}>합계 ({bookings.length}건)</td>
                  <td className="px-3 py-2 text-right text-indigo-700">₩{fmt(kpis.total_price)}</td>
                  <td className="px-3 py-2 text-right text-blue-700">₩{fmt(kpis.total_paid)}</td>
                  <td className="px-3 py-2 text-right text-red-600">₩{fmt(kpis.receivable)}</td>
                  <td className="px-3 py-2 text-right text-orange-600">₩{fmt(kpis.total_cost)}</td>
                  <td className="px-3 py-2 text-right text-orange-700">₩{fmt(kpis.total_paid_out)}</td>
                  <td className="px-3 py-2 text-right text-red-600">₩{fmt(kpis.payable)}</td>
                  <td className={`px-3 py-2 text-right ${kpis.net_sales >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    ₩{fmt(kpis.net_sales)}
                  </td>
                  <td colSpan={5} className="px-3 py-2 text-[11px] text-admin-muted font-normal">
                    예상 부가세: ₩{fmt(kpis.vat_estimate)} / 예상 순수익: ₩{fmt(kpis.net_profit_estimate)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 범례 */}
      <div className="text-[11px] text-admin-muted flex flex-wrap gap-4">
        <span>모든 금액은 출발일(행사일) 기준으로 집계됩니다.</span>
        <span>미수 = 판매가 - 고객 입금액</span>
        <span>미송금 = 랜드사 예정액 - 송금액</span>
        <span>우리수익 = 판매가 - 랜드사 예정액</span>
        <span>예상 순수익 = 우리수익 - 예상 부가세</span>
      </div>
    </div>
  );
}
