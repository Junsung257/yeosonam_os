'use client';

/**
 * 출금 정산(land_settlements) 묶음 history + 운영 액션 (Phase 5).
 * 어필리에이터 정산(/admin/settlements) 과 별개 — 랜드사 송금/환불 묶음 추적용.
 *
 * - 묶음 history (pending / confirmed / reversed)
 * - confirm(회계 마감) / reverse(잘못 묶었을 때 되돌림) 액션
 * - 묶인 booking 펼치기
 * - CSV 다운로드 (UTF-8 BOM, Excel 호환)
 *
 * 정책: reverse 는 reversed 제외 모든 status 허용. confirm 은 pending → confirmed 단방향.
 */

import { useState, useEffect, useCallback } from 'react';
import { LAND_SETTLEMENT_STATUS_COLOR } from '@/lib/status-colors';
import { fmtNum as fmtKRW } from '@/lib/admin-utils';

interface SettlementBookingRef {
  id: string | null;
  booking_no: string | null;
  customer_name: string | null;
  departure_date: string | null;
  amount: number;
}

interface Settlement {
  id: string;
  land_operator_id: string;
  land_operator_name: string | null;
  bank_transaction_id: string;
  transaction_received_at: string | null;
  transaction_counterparty: string | null;
  total_amount: number;
  bundled_total: number;
  fee_amount: number;
  is_refund: boolean;
  status: 'pending' | 'confirmed' | 'reversed';
  notes: string | null;
  created_at: string;
  created_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  bookings: SettlementBookingRef[];
}

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'reversed';

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: '전체',
  pending: '대기',
  confirmed: '확정',
  reversed: '되돌림',
};
const STATUS_BADGE = LAND_SETTLEMENT_STATUS_COLOR as Record<Settlement['status'], string>;

export default function LandSettlementsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/payments/settlements?status=${statusFilter}&limit=100`);
      const data = await res.json();
      setSettlements(data.settlements ?? []);
    } catch (err: any) {
      setToast({ kind: 'err', msg: `조회 실패: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleConfirm = useCallback(
    async (s: Settlement) => {
      setBusy(s.id);
      try {
        const res = await fetch('/api/payments/settlement-confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settlementId: s.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'confirm 실패');
        showToast('ok', `✅ ${s.land_operator_name ?? '랜드사'} 정산 확정`);
        await load();
      } catch (err: any) {
        showToast('err', err.message);
      } finally {
        setBusy(null);
      }
    },
    [load, showToast],
  );

  const handleReverse = useCallback(
    async (s: Settlement) => {
      const reason = window.prompt('Reverse 사유 (선택):', '');
      if (reason === null) return;
      if (!window.confirm(`정말 ${s.land_operator_name ?? '랜드사'} 정산 ${fmtKRW(s.total_amount)}을 되돌릴까요?\n묶인 ${s.bookings.length}건 booking 의 정산금이 차감되고 거래는 미매칭 상태로 복원됩니다.`)) {
        return;
      }
      setBusy(s.id);
      try {
        const res = await fetch('/api/payments/settlement-reverse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settlementId: s.id, reason: reason || null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'reverse 실패');
        showToast('ok', `↩ ${s.land_operator_name ?? '랜드사'} 정산 reverse 완료`);
        await load();
      } catch (err: any) {
        showToast('err', err.message);
      } finally {
        setBusy(null);
      }
    },
    [load, showToast],
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {toast && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-lg text-sm font-medium text-white ${
            toast.kind === 'err' ? 'bg-red-500' : 'bg-emerald-600'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-admin-lg font-semibold text-slate-800">랜드사 송금 정산 묶음</h1>
          <p className="text-admin-sm text-slate-500 mt-0.5">
            은행 송금 1건 = 묶인 예약들의 합산 정산. 메인 대시보드의 "랜드사 미지급(payable)"과는 다른 배치 단위 뷰.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            {(['all', 'pending', 'confirmed', 'reversed'] as StatusFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-admin-sm rounded transition ${
                  statusFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <a
            href={buildExportUrl(statusFilter)}
            className="px-3 py-1 text-admin-sm bg-emerald-50 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-100 transition whitespace-nowrap"
            title="이번 달 settlement CSV 다운로드 (UTF-8 BOM, Excel 호환)"
          >
            📥 CSV 다운로드
          </a>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 py-12 text-center">로드 중…</div>
      ) : settlements.length === 0 ? (
        <div className="text-sm text-slate-500 py-12 text-center bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          {STATUS_LABELS[statusFilter]} settlement 이 없습니다
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-4 pt-3 pb-2 text-[11px] text-slate-500 border-b border-slate-100 bg-slate-50/60">
            <span className="font-medium text-slate-600">용어 정의:</span>
            {' '}
            <span title="실제 은행 거래에서 출금된 총액. 이체 수수료 포함.">실 출금액</span>
            {' = '}
            <span title="이 묶음에 들어간 예약들의 정산 합계. 수수료 차감 전.">묶음 합계</span>
            {' + '}
            <span title="이체 수수료. 정산 합계와 실 출금액의 차이.">수수료</span>
            <span className="text-slate-400">. 펼치면 묶인 개별 예약별 배분액 확인 가능.</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[11px] text-slate-500 uppercase bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2.5">생성</th>
                <th className="text-left py-2.5">랜드사</th>
                <th className="text-left py-2.5">거래처/날짜</th>
                <th className="text-right py-2.5" title="실제 은행 거래에서 출금된 총액 (이체 수수료 포함)">실 출금액</th>
                <th className="text-right py-2.5" title="이 묶음에 들어간 예약들의 정산 합계 (수수료 차감 전)">묶음 합계</th>
                <th className="text-right py-2.5" title="이체 수수료 (실 출금액 − 묶음 합계)">수수료</th>
                <th className="text-center py-2.5">예약 수</th>
                <th className="text-center py-2.5">상태</th>
                <th className="text-right px-4 py-2.5">액션</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map(s => (
                <SettlementRow
                  key={s.id}
                  s={s}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  onConfirm={() => handleConfirm(s)}
                  onReverse={() => handleReverse(s)}
                  busy={busy === s.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettlementRow({
  s,
  expanded,
  onToggle,
  onConfirm,
  onReverse,
  busy,
}: {
  s: Settlement;
  expanded: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onReverse: () => void;
  busy: boolean;
}) {
  const canConfirm = s.status === 'pending';
  const canReverse = s.status !== 'reversed';

  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-4 py-2.5 text-xs text-slate-600 tabular-nums">
          {new Date(s.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
        </td>
        <td className="py-2.5 font-medium text-slate-800">{s.land_operator_name ?? '—'}</td>
        <td className="py-2.5 text-xs text-slate-600">
          <div>{s.transaction_counterparty ?? '—'}</div>
          {s.transaction_received_at && (
            <div className="text-[11px] text-slate-400">
              {new Date(s.transaction_received_at).toLocaleDateString('ko-KR')}
            </div>
          )}
        </td>
        <td className="py-2.5 text-right tabular-nums text-slate-800">{fmtKRW(s.total_amount)}</td>
        <td className="py-2.5 text-right tabular-nums text-slate-600">{fmtKRW(s.bundled_total)}</td>
        <td
          className={`py-2.5 text-right tabular-nums ${
            s.fee_amount === 0 ? 'text-slate-400' : 'text-amber-600'
          }`}
        >
          {s.fee_amount > 0 ? '+' : ''}
          {fmtKRW(s.fee_amount)}
        </td>
        <td className="py-2.5 text-center">
          <button
            onClick={onToggle}
            className="text-blue-600 hover:underline text-xs"
          >
            {s.bookings.length}건 {expanded ? '▴' : '▾'}
          </button>
        </td>
        <td className="py-2.5 text-center">
          <span
            className={`px-2 py-0.5 text-[11px] rounded border ${STATUS_BADGE[s.status]}`}
          >
            {s.status === 'pending' ? '대기' : s.status === 'confirmed' ? '확정' : '되돌림'}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex justify-end gap-1">
            {canConfirm && (
              <button
                onClick={onConfirm}
                disabled={busy}
                className="px-2 py-1 text-[11px] bg-emerald-50 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-100 disabled:opacity-40"
              >
                확정
              </button>
            )}
            {canReverse && (
              <button
                onClick={onReverse}
                disabled={busy}
                className="px-2 py-1 text-[11px] bg-white border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-40"
              >
                되돌림
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={9} className="px-4 py-3">
            <div className="text-[11px] text-slate-500 uppercase mb-1.5">묶인 booking</div>
            <table className="w-full text-xs">
              <tbody>
                {s.bookings.map((b, i) => (
                  <tr key={i} className="border-b border-slate-200 last:border-0">
                    <td className="py-1.5 text-slate-700 font-medium">
                      {b.customer_name ?? '이름 없음'}
                    </td>
                    <td className="py-1.5 font-mono text-slate-500">{b.booking_no ?? '—'}</td>
                    <td className="py-1.5 text-slate-500">
                      {b.departure_date?.slice(2, 10).replace(/-/g, '') ?? '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-800">
                      {fmtKRW(b.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.notes && (
              <div className="mt-2 text-[11px] text-slate-500">메모: {s.notes}</div>
            )}
            {s.reversal_reason && (
              <div className="mt-2 text-[11px] text-red-600">
                Reverse 사유: {s.reversal_reason} ({s.reversed_by ?? '?'},{' '}
                {s.reversed_at && new Date(s.reversed_at).toLocaleString('ko-KR')})
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function buildExportUrl(status: StatusFilter): string {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const last = today.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    type: 'settlements',
    status,
    from: first,
    to: last,
  });
  return `/api/payments/export?${params.toString()}`;
}
