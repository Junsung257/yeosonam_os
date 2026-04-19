'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, X } from 'lucide-react';
import {
  MobileActionSheet,
  type SheetAction,
} from '@/components/admin/mobile/MobileActionSheet';
import type { TransitionDef } from '@/lib/booking-state-machine';

interface Props {
  bookingId: string;
  status: string;
  transitions: TransitionDef[];
}

export default function BookingActions({
  bookingId,
  status,
  transitions,
}: Props) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isTerminal = status === 'cancelled' || status === 'fully_paid';

  async function runTransition(to: string, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '전이 실패');
      }
      setSheetOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(null);
    }
  }

  async function runCancel() {
    setBusy('cancel');
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '모바일 관리자 취소' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '취소 실패');
      }
      setConfirmOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(null);
    }
  }

  const sheetActions: SheetAction[] = transitions.map(t => ({
    label: t.label,
    description: t.isMock ? '테스트 시뮬레이션 모드' : undefined,
    badge: t.isMock ? (
      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
        🧪 Mock
      </span>
    ) : undefined,
    disabled: busy !== null,
    onClick: () => runTransition(t.to, t.label),
  }));

  if (!isTerminal) {
    sheetActions.push({
      label: '예약 취소',
      destructive: true,
      disabled: busy !== null,
      onClick: () => {
        setSheetOpen(false);
        setConfirmOpen(true);
      },
    });
  }

  return (
    <>
      {error && (
        <div
          className="fixed left-4 right-4 z-40 bg-red-600 text-white text-sm rounded-xl px-4 py-3 shadow-lg"
          style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 opacity-80"
            aria-label="닫기"
          >
            <X size={14} className="inline" />
          </button>
        </div>
      )}

      {sheetActions.length > 0 && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="fixed right-4 z-40 bg-slate-900 text-white rounded-full shadow-xl px-5 h-12 flex items-center gap-1.5 text-sm font-semibold active:scale-95 transition"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        >
          <ChevronUp size={18} />
          액션
        </button>
      )}

      <MobileActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="예약 액션"
        description={
          transitions.length === 0
            ? '전이 가능한 상태가 없습니다'
            : '다음 단계로 진행하거나 취소할 수 있습니다'
        }
        actions={sheetActions}
      />

      <MobileActionSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="예약을 취소하시겠습니까?"
        description="취소는 되돌릴 수 없으며, 연쇄 Void 처리가 실행됩니다."
        actions={[
          {
            label: busy === 'cancel' ? '취소 중...' : '예약 취소 확정',
            destructive: true,
            disabled: busy === 'cancel',
            onClick: runCancel,
          },
        ]}
        cancelLabel="되돌아가기"
      />
    </>
  );
}
