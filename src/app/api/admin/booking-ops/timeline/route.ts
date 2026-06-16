import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { getBookingTaskTypeLabel } from '@/lib/booking-ops';
import {
  sortBookingOpsTimelineItems,
  type BookingOpsTimelineItem,
  type BookingOpsTimelineResponse,
} from '@/lib/booking-ops-timeline';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type BookingRow = {
  id: string;
  booking_no: string | null;
  status: string | null;
  created_at: string | null;
  departure_date: string | null;
  total_price: number | null;
  paid_amount: number | null;
  total_paid_out: number | null;
  settlement_confirmed_at: string | null;
};

type BankTxRow = {
  id: string;
  transaction_type: string | null;
  amount: number | null;
  counterparty_name: string | null;
  received_at: string | null;
  match_status: string | null;
  is_refund: boolean | null;
};

type TaskRow = {
  id: string;
  task_type: string | null;
  title: string | null;
  status: string | null;
  priority: number | null;
  created_at: string | null;
  resolved_at: string | null;
  snoozed_until: string | null;
  resolution: string | null;
};

type MessageRow = {
  id: string;
  log_type: string | null;
  event_type: string | null;
  title: string | null;
  content: string | null;
  created_at: string | null;
  created_by: string | null;
};

async function safe<T>(promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  try {
    const result = await promise;
    return result.error ? null : result.data ?? null;
  } catch {
    return null;
  }
}

function money(value: number | null | undefined): string {
  return `${Math.round(value ?? 0).toLocaleString('ko-KR')}원`;
}

function taskTone(status: string | null): BookingOpsTimelineItem['tone'] {
  if (status === 'resolved' || status === 'auto_resolved') return 'emerald';
  if (status === 'snoozed') return 'amber';
  return 'red';
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const bookingId = request.nextUrl.searchParams.get('booking_id');
  if (!bookingId) {
    return NextResponse.json({ error: 'booking_id is required' }, { status: 400 });
  }

  const empty: BookingOpsTimelineResponse = {
    bookingId,
    generatedAt: new Date().toISOString(),
    items: [],
  };

  if (!isSupabaseConfigured) {
    return NextResponse.json(empty);
  }

  const [booking, transactions, tasks, messages] = await Promise.all([
    safe<BookingRow>(
      supabaseAdmin
        .from('bookings')
        .select('id, booking_no, status, created_at, departure_date, total_price, paid_amount, total_paid_out, settlement_confirmed_at')
        .eq('id', bookingId)
        .maybeSingle(),
    ),
    safe<BankTxRow[]>(
      supabaseAdmin
        .from('bank_transactions')
        .select('id, transaction_type, amount, counterparty_name, received_at, match_status, is_refund')
        .eq('booking_id', bookingId)
        .order('received_at', { ascending: false })
        .limit(30),
    ),
    safe<TaskRow[]>(
      supabaseAdmin
        .from('booking_tasks')
        .select('id, task_type, title, status, priority, created_at, resolved_at, snoozed_until, resolution')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false })
        .limit(50),
    ),
    safe<MessageRow[]>(
      supabaseAdmin
        .from('message_logs')
        .select('id, log_type, event_type, title, content, created_at, created_by')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false })
        .limit(30),
    ),
  ]);

  const items: BookingOpsTimelineItem[] = [];

  if (booking?.created_at) {
    items.push({
      id: `booking:${booking.id}`,
      kind: 'booking',
      at: booking.created_at,
      title: `예약 생성${booking.booking_no ? ` · ${booking.booking_no}` : ''}`,
      detail: `상태 ${booking.status ?? '-'} · 판매 ${money(booking.total_price)} · 입금 ${money(booking.paid_amount)}`,
      tone: 'blue',
      href: `/admin/bookings/${booking.id}`,
    });
  }

  if (booking?.settlement_confirmed_at) {
    items.push({
      id: `settlement:${booking.id}`,
      kind: 'settlement',
      at: booking.settlement_confirmed_at,
      title: '정산 확정',
      detail: `입금 ${money(booking.paid_amount)} · 랜드 송금 ${money(booking.total_paid_out)}`,
      tone: 'purple',
      href: `/admin/bookings/${booking.id}`,
    });
  }

  for (const tx of transactions ?? []) {
    if (!tx.received_at) continue;
    const isOut = tx.transaction_type === '출금';
    const isRefund = tx.is_refund === true;
    items.push({
      id: `payment:${tx.id}`,
      kind: 'payment',
      at: tx.received_at,
      title: isRefund ? '환불 거래 매칭' : isOut ? '랜드 송금 매칭' : '고객 입금 매칭',
      detail: `${tx.counterparty_name ?? '거래처 미상'} · ${money(tx.amount)} · ${tx.match_status ?? '-'}`,
      tone: isOut ? 'red' : 'emerald',
      href: `/admin/payments?tx=${encodeURIComponent(tx.id)}`,
    });
  }

  for (const task of tasks ?? []) {
    if (task.created_at) {
      items.push({
        id: `task:${task.id}:created`,
        kind: 'task',
        at: task.created_at,
        title: task.title ?? getBookingTaskTypeLabel(task.task_type ?? 'unknown'),
        detail: `${getBookingTaskTypeLabel(task.task_type ?? 'unknown')} · ${task.status ?? 'open'} · 우선순위 ${task.priority ?? '-'}`,
        tone: taskTone(task.status),
        href: `/admin/inbox?type=${encodeURIComponent(task.task_type ?? 'all')}`,
      });
    }
    if (task.resolved_at) {
      items.push({
        id: `task:${task.id}:resolved`,
        kind: 'task',
        at: task.resolved_at,
        title: '액션큐 처리 완료',
        detail: `${getBookingTaskTypeLabel(task.task_type ?? 'unknown')} · ${task.resolution ?? 'resolution 없음'}`,
        tone: 'emerald',
        href: `/admin/inbox?type=${encodeURIComponent(task.task_type ?? 'all')}`,
      });
    }
    if (task.snoozed_until) {
      items.push({
        id: `task:${task.id}:snoozed`,
        kind: 'task',
        at: task.snoozed_until,
        title: '액션큐 보류 만료',
        detail: `${getBookingTaskTypeLabel(task.task_type ?? 'unknown')} 다시 확인 예정`,
        tone: 'amber',
        href: `/admin/inbox?type=${encodeURIComponent(task.task_type ?? 'all')}`,
      });
    }
  }

  for (const message of messages ?? []) {
    if (!message.created_at) continue;
    items.push({
      id: `message:${message.id}`,
      kind: 'message',
      at: message.created_at,
      title: message.title ?? message.event_type ?? '메시지 기록',
      detail: message.content ?? message.created_by ?? message.log_type ?? null,
      tone: message.log_type === 'kakao' ? 'amber' : 'slate',
      href: null,
    });
  }

  return NextResponse.json({
    bookingId,
    generatedAt: new Date().toISOString(),
    items: sortBookingOpsTimelineItems(items).slice(0, 80),
  } satisfies BookingOpsTimelineResponse);
}
