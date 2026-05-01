'use client';

/**
 * LedgerViewer
 *
 * 특정 booking 의 append-only ledger_entries 시간순 + 누적 잔액 + drift 표시.
 * BookingDrawer / 결제 상세 화면에서 호출되는 모달.
 *
 * 데이터: GET /api/admin/ledger/booking/:id
 */

import { useEffect, useState, useCallback } from 'react';

interface Entry {
  id: string;
  created_at: string;
  account: 'paid_amount' | 'total_paid_out';
  entry_type: string;
  amount: number;
  source: string;
  source_ref_id: string | null;
  idempotency_key: string | null;
  memo: string | null;
  created_by: string | null;
  running_paid_balance: number;
  running_payout_balance: number;
}
interface ApiResponse {
  booking: {
    id: string; booking_no?: string;
    paid_amount: number; total_paid_out: number;
    total_price: number; total_cost: number;
    status?: string; payment_status?: string;
  };
  entries: Entry[];
  totals: {
    paid_sum: number; payout_sum: number;
    paid_balance: number; payout_balance: number;
    paid_drift: number; payout_drift: number;
  };
}

const SOURCE_LABEL: Record<string, string> = {
  slack_ingest: '🤖 Slack 자동',
  payment_match_confirm: '✅ 매칭 확정',
  land_settlement_create: '🏢 랜드사 정산',
  land_settlement_reverse: '↩️ 정산 reverse',
  admin_manual_edit: '✏️ 어드민 수동',
  booking_create_softmatch: '🔄 소급 매칭',
  bank_tx_manual_match: '🏦 통장 매칭',
  sms_payment: '📱 SMS',
  cron_resync: '⏰ 재동기화',
  seed_phase2a: '🌱 초기 시드',
};
const ACCOUNT_LABEL: Record<string, string> = {
  paid_amount: '입금',
  total_paid_out: '출금',
};
const TYPE_COLOR: Record<string, string> = {
  deposit: 'text-blue-600',
  refund: 'text-orange-600',
  payout: 'text-red-600',
  payout_reverse: 'text-purple-600',
  manual_adjust: 'text-amber-600',
  seed_backfill: 'text-slate-500',
};

function fmtTs(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

interface Props {
  bookingId: string;
  onClose: () => void;
}

export default function LedgerViewer({ bookingId, onClose }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/ledger/booking/${bookingId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '조회 실패');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-base font-bold text-slate-800">📒 원장 (append-only ledger)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {data?.booking.booking_no ?? bookingId.slice(0, 8)} · 거래는 immutable, 매 변경마다 새 entry 추가
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        {/* 컨텐츠 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-slate-500">불러오는 중…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {data && (
            <>
              {/* 잔액 카드 */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <BalanceCard
                  label="입금 (paid_amount)"
                  balance={data.totals.paid_balance}
                  ledgerSum={data.totals.paid_sum}
                  drift={data.totals.paid_drift}
                />
                <BalanceCard
                  label="랜드사 송금 (total_paid_out)"
                  balance={data.totals.payout_balance}
                  ledgerSum={data.totals.payout_sum}
                  drift={data.totals.payout_drift}
                />
              </div>

              {/* entries 테이블 */}
              {data.entries.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">
                  ledger entry 없음 (이중쓰기 시작 후 첫 거래 대기 중)
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500 border-b bg-slate-50 sticky top-0">
                    <tr>
                      <th className="p-2">시각</th>
                      <th className="p-2">계정 / 유형</th>
                      <th className="p-2">출처</th>
                      <th className="text-right p-2">금액</th>
                      <th className="text-right p-2">잔액 (paid · payout)</th>
                      <th className="p-2">메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map(e => {
                      const colorCls = TYPE_COLOR[e.entry_type] ?? 'text-slate-700';
                      return (
                        <tr key={e.id} className="border-b hover:bg-slate-50">
                          <td className="p-2 tabular-nums whitespace-nowrap">{fmtTs(e.created_at)}</td>
                          <td className="p-2">
                            <span className="text-slate-700">{ACCOUNT_LABEL[e.account] ?? e.account}</span>
                            {' · '}
                            <span className={colorCls}>{e.entry_type}</span>
                          </td>
                          <td className="p-2 text-slate-600">
                            <div>{SOURCE_LABEL[e.source] ?? e.source}</div>
                            {e.source_ref_id && (
                              <div className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]"
                                   title={e.source_ref_id}>
                                {e.source_ref_id.slice(0, 18)}{e.source_ref_id.length > 18 ? '…' : ''}
                              </div>
                            )}
                          </td>
                          <td className={`p-2 text-right tabular-nums font-semibold ${e.amount > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                            {e.amount > 0 ? '+' : ''}{e.amount.toLocaleString()}
                          </td>
                          <td className="p-2 text-right tabular-nums text-slate-500">
                            {e.running_paid_balance.toLocaleString()} · {e.running_payout_balance.toLocaleString()}
                          </td>
                          <td className="p-2 text-slate-500 max-w-[200px] truncate" title={e.memo ?? ''}>
                            {e.memo ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <div className="border-t p-3 text-right">
          <button onClick={onClose} className="px-4 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function BalanceCard({
  label, balance, ledgerSum, drift,
}: { label: string; balance: number; ledgerSum: number; drift: number }) {
  const isOk = drift === 0;
  return (
    <div className={`rounded border p-3 ${isOk ? 'border-slate-200 bg-slate-50' : 'border-red-200 bg-red-50'}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-lg font-bold tabular-nums text-slate-800 mt-1">{balance.toLocaleString()}원</p>
      <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
        ledger 합계 {ledgerSum.toLocaleString()}원
        {!isOk && (
          <span className="ml-2 text-red-600 font-semibold">
            drift {drift > 0 ? '+' : ''}{drift.toLocaleString()}
          </span>
        )}
      </p>
    </div>
  );
}
