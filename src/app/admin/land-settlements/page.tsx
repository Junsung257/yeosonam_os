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
import { fmtNum as fmtKRW, fmtDateISO, fmtDateTime, fmtMonthDay } from '@/lib/admin-utils';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Download } from 'lucide-react';

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
    <div className="max-w-7xl mx-auto">
      {toast && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-admin-sm text-admin-sm font-medium text-white shadow-admin-md ${
            toast.kind === 'err' ? 'bg-danger' : 'bg-success'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <PageHeader
        title="랜드사 송금 정산 묶음"
        subtitle='은행 송금 1건 = 묶인 예약들의 합산 정산. 메인 대시보드의 "랜드사 미지급(payable)"과는 다른 배치 단위 뷰.'
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {(['all', 'pending', 'confirmed', 'reversed'] as StatusFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`h-8 px-3 text-admin-sm rounded-admin-sm font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-brand text-white'
                      : 'bg-admin-surface border border-admin-border-mid text-admin-text-2 hover:bg-admin-surface-2 hover:border-admin-border-strong'
                  }`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <a href={buildExportUrl(statusFilter)} title="이번 달 settlement CSV 다운로드 (UTF-8 BOM, Excel 호환)">
              <Button variant="secondary" size="sm">
                <Download size={14} />
                CSV
              </Button>
            </a>
          </div>
        }
      />

      {loading ? (
        <div className="text-admin-sm text-admin-muted py-12 text-center">로드 중…</div>
      ) : settlements.length === 0 ? (
        <div className="text-admin-sm text-admin-muted py-12 text-center admin-card">
          {STATUS_LABELS[statusFilter]} settlement 이 없습니다
        </div>
      ) : (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <div className="px-4 pt-3 pb-2 text-admin-xs text-admin-muted border-b border-admin-border bg-admin-surface-2">
            <span className="font-medium text-admin-muted">용어 정의:</span>
            {' '}
            <span title="실제 은행 거래에서 출금된 총액. 이체 수수료 포함.">실 출금액</span>
            {' = '}
            <span title="이 묶음에 들어간 예약들의 정산 합계. 수수료 차감 전.">묶음 합계</span>
            {' + '}
            <span title="이체 수수료. 정산 합계와 실 출금액의 차이.">수수료</span>
            <span className="text-admin-muted-2">. 펼치면 묶인 개별 예약별 배분액 확인 가능.</span>
          </div>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>생성</th>
                <th>랜드사</th>
                <th>거래처/날짜</th>
                <th className="text-right" title="실제 은행 거래에서 출금된 총액 (이체 수수료 포함)">실 출금액</th>
                <th className="text-right" title="이 묶음에 들어간 예약들의 정산 합계 (수수료 차감 전)">묶음 합계</th>
                <th className="text-right" title="이체 수수료 (실 출금액 − 묶음 합계)">수수료</th>
                <th className="text-center">예약 수</th>
                <th className="text-center">상태</th>
                <th className="text-right">액션</th>
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
      <tr>
        <td className="text-admin-xs text-admin-muted admin-num">
          {fmtMonthDay(s.created_at)}
        </td>
        <td className="font-medium text-admin-text">{s.land_operator_name ?? '—'}</td>
        <td className="text-admin-xs text-admin-muted">
          <div>{s.transaction_counterparty ?? '—'}</div>
          {s.transaction_received_at && (
            <div className="text-admin-2xs text-admin-muted-2 admin-num">
              {fmtDateISO(s.transaction_received_at)}
            </div>
          )}
        </td>
        <td className="text-right admin-num text-admin-text">{fmtKRW(s.total_amount)}</td>
        <td className="text-right admin-num text-admin-muted">{fmtKRW(s.bundled_total)}</td>
        <td className={`text-right admin-num ${s.fee_amount === 0 ? 'text-admin-muted-2' : 'text-warning'}`}>
          {s.fee_amount > 0 ? '+' : ''}
          {fmtKRW(s.fee_amount)}
        </td>
        <td className="text-center">
          <button onClick={onToggle} className="text-brand hover:text-brand-dark text-admin-xs font-medium">
            <span className="admin-num">{s.bookings.length}</span>건 {expanded ? '▴' : '▾'}
          </button>
        </td>
        <td className="text-center">
          <span className={`px-2 py-0.5 text-admin-xs rounded-admin-xs border font-semibold ${STATUS_BADGE[s.status]}`}>
            {s.status === 'pending' ? '대기' : s.status === 'confirmed' ? '확정' : '되돌림'}
          </span>
        </td>
        <td className="text-right">
          <div className="flex justify-end gap-1.5">
            {canConfirm && (
              <Button variant="secondary" size="sm" onClick={onConfirm} disabled={busy}>
                확정
              </Button>
            )}
            {canReverse && (
              <Button variant="secondary" size="sm" onClick={onReverse} disabled={busy}>
                되돌림
              </Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-admin-surface-2">
          <td colSpan={9} className="px-4 py-3" style={{ height: 'auto' }}>
            <div className="text-admin-2xs text-admin-muted uppercase tracking-wider mb-2 font-semibold">묶인 booking</div>
            <table className="w-full text-admin-xs">
              <tbody>
                {s.bookings.map((b, i) => (
                  <tr key={i} className="border-b border-admin-border last:border-0">
                    <td className="py-1.5 text-admin-text font-medium">
                      {b.customer_name ?? '이름 없음'}
                    </td>
                    <td className="py-1.5 font-mono text-admin-muted">{b.booking_no ?? '—'}</td>
                    <td className="py-1.5 text-admin-muted admin-num">
                      {b.departure_date?.slice(2, 10).replace(/-/g, '') ?? '—'}
                    </td>
                    <td className="py-1.5 text-right admin-num text-admin-text">
                      {fmtKRW(b.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.notes && (
              <div className="mt-2 text-admin-xs text-admin-muted">메모: {s.notes}</div>
            )}
            {s.reversal_reason && (
              <div className="mt-2 text-admin-xs text-danger">
                Reverse 사유: {s.reversal_reason} ({s.reversed_by ?? '?'},{' '}
                {s.reversed_at && fmtDateTime(s.reversed_at)})
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
