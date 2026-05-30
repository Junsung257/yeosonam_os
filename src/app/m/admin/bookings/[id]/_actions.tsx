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

  async function copyKakaoMessage(kind: 'received' | 'deposit' | 'unavailable') {
    setBusy(`copy-${kind}`);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/kakao-message?kind=${kind}`, {
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.message !== 'string') {
        throw new Error(body.error || '안내문 생성 실패');
      }
      await navigator.clipboard.writeText(body.message);
      setSheetOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '복사 실패');
    } finally {
      setBusy(null);
    }
  }

  async function markSeatAvailable() {
    setBusy('seat-available');
    setError(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bookingId, seat_check_confirmed: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '좌석 확인 처리 실패');
      }
      setSheetOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(null);
    }
  }

  async function markSeatUnavailable() {
    setBusy('seat-unavailable');
    setError(null);
    try {
      const msgRes = await fetch(`/api/admin/bookings/${bookingId}/kakao-message?kind=unavailable`, {
        cache: 'no-store',
      });
      const msgBody = await msgRes.json().catch(() => ({}));
      if (msgRes.ok && typeof msgBody.message === 'string') {
        await navigator.clipboard.writeText(msgBody.message);
      }

      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bookingId, seat_check_unavailable: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '좌석 불가 처리 실패');
      }
      setSheetOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(null);
    }
  }

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

  const sheetActions: SheetAction[] = [];

  if (status === 'pending') {
    sheetActions.push(
      {
        label: '접수 안내문 복사',
        description: '고객 카카오 채팅에 붙여넣을 문구',
        disabled: busy !== null,
        onClick: () => copyKakaoMessage('received'),
      },
      {
        label: '좌석 가능 확인',
        description: '좌석 확인 task를 종료하고 계약금 안내를 허용',
        disabled: busy !== null,
        onClick: markSeatAvailable,
      },
      {
        label: '계약금 안내문 복사',
        description: '입금계좌 포함 안내문',
        disabled: busy !== null,
        onClick: () => copyKakaoMessage('deposit'),
      },
      {
        label: '좌석 불가 안내문 복사 및 기록',
        description: '좌석 불가 task를 종료하고 타임라인 기록',
        disabled: busy !== null,
        onClick: markSeatUnavailable,
      },
    );
  }

  if (status === 'waiting_deposit') {
    sheetActions.push({
      label: '계약금 안내문 복사',
      description: '좌석 가능 확인 후 고객에게 보낼 입금 안내문',
      disabled: busy !== null,
      onClick: () => copyKakaoMessage('deposit'),
    });
  }

  sheetActions.push(...transitions.map(t => ({
    label: t.label,
    description: t.isMock ? '테스트 시뮬레이션 모드' : undefined,
    badge: t.isMock ? (
      <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
        Mock
      </span>
    ) : undefined,
    disabled: busy !== null,
    onClick: () => runTransition(t.to, t.label),
  })));

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
          className="fixed left-4 right-4 z-40 bg-red-600 text-white text-sm rounded-admin-md px-4 py-3 shadow-admin-md"
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
          className="fixed right-4 z-40 bg-slate-900 text-white rounded-full shadow-admin-lg px-5 h-12 flex items-center gap-1.5 text-sm font-semibold active:scale-95 transition"
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
        description="예약 요청 안내, 좌석 확인, 다음 단계 진행을 처리합니다."
        actions={sheetActions}
      />

      <MobileActionSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="예약을 취소하시겠습니까?"
        description="취소는 되돌릴 수 없으며 연동된 작업도 종료됩니다."
        actions={[
          {
            label: busy === 'cancel' ? '취소 중...' : '예약 취소 확정',
            destructive: true,
            disabled: busy === 'cancel',
            onClick: runCancel,
          },
        ]}
        cancelLabel="돌아가기"
      />
    </>
  );
}
