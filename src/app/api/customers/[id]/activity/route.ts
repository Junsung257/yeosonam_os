import { NextRequest } from 'next/server';
import { ApiErrors, apiResponse } from '@/lib/api-response';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

type ActivityItem = {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  created_at: string;
  severity?: 'info' | 'warning' | 'critical';
  status?: string | null;
  booking_id?: string | null;
  bank_transaction_id?: string | null;
  amount?: number | null;
  href?: string;
  metadata?: Record<string, unknown>;
};

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return ApiErrors.unavailable('Supabase가 설정되지 않았습니다.');
  }

  const { id } = await props.params;
  if (!id) return ApiErrors.badRequest('id 필요');

  try {
    const [eventsResult, bookingsResult, notesResult, mileageResult] = await Promise.all([
      supabaseAdmin
        .from('ops_events')
        .select('id, event_type, severity, status, title, description, booking_id, bank_transaction_id, created_at, metadata')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(80),
      supabaseAdmin
        .from('bookings')
        .select('id, booking_no, package_title, status, total_price, paid_amount, departure_date, created_at')
        .eq('lead_customer_id', id)
        .order('created_at', { ascending: false })
        .limit(80),
      supabaseAdmin
        .from('customer_notes')
        .select('id, content, channel, created_at')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(80),
      supabaseAdmin
        .from('mileage_transactions')
        .select('id, booking_id, amount, type, memo, created_at')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(80),
    ]);

    for (const result of [eventsResult, bookingsResult, notesResult, mileageResult]) {
      if (result.error) return ApiErrors.internalError(sanitizeDbError(result.error));
    }

    const bookingIds = ((bookingsResult.data ?? []) as Array<{ id: string }>).map(b => b.id);
    const eventPaymentTxIds = new Set(
      ((eventsResult.data ?? []) as Array<Record<string, unknown>>)
        .filter(event => String(event.event_type ?? '').startsWith('payment_') && event.bank_transaction_id)
        .map(event => String(event.bank_transaction_id)),
    );
    const paymentItems: ActivityItem[] = [];
    if (bookingIds.length > 0) {
      const { data: allocations, error: allocationError } = await supabaseAdmin
        .from('bank_transaction_allocations')
        .select('id, booking_id, bank_transaction_id, allocation_type, allocated_amount, ledger_delta, created_at')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: false })
        .limit(80);
      if (!allocationError) {
        const txIds = Array.from(new Set(((allocations ?? []) as Array<{ bank_transaction_id?: string | null }>)
          .map(row => row.bank_transaction_id)
          .filter((value): value is string => !!value)));
        const txMap = new Map<string, { id: string; counterparty_name: string | null; transaction_type: string | null; received_at: string | null }>();
        if (txIds.length > 0) {
          const { data: txRows } = await supabaseAdmin
            .from('bank_transactions')
            .select('id, counterparty_name, transaction_type, received_at')
            .in('id', txIds);
          for (const tx of (txRows ?? []) as Array<{ id: string; counterparty_name: string | null; transaction_type: string | null; received_at: string | null }>) {
            txMap.set(tx.id, tx);
          }
        }
        for (const row of (allocations ?? []) as Array<Record<string, unknown>>) {
          const tx = txMap.get(String(row.bank_transaction_id));
          const txId = tx?.id ?? String(row.bank_transaction_id ?? '');
          if (txId && eventPaymentTxIds.has(txId)) continue;
          paymentItems.push({
            id: `payment:${row.id}`,
            type: 'payment_matched',
            title: `${tx?.counterparty_name ?? '입출금'} · ${Number(row.allocated_amount ?? 0).toLocaleString('ko-KR')}원`,
            description: String(row.allocation_type ?? ''),
            created_at: String(row.created_at ?? tx?.received_at ?? new Date().toISOString()),
            severity: 'info',
            booking_id: String(row.booking_id ?? ''),
            bank_transaction_id: txId,
            amount: Number(row.allocated_amount ?? 0),
            href: `/admin/payments?tx=${txId}`,
            metadata: {
              booking_id: row.booking_id,
              bank_transaction_id: txId,
              ledger_delta: row.ledger_delta,
              transaction_type: tx?.transaction_type,
            },
          });
        }
      }
    }

    const items: ActivityItem[] = [
      ...((eventsResult.data ?? []) as Array<Record<string, unknown>>).map(event => ({
        id: `ops:${event.id}`,
        type: String(event.event_type ?? 'ops_event'),
        title: String(event.title ?? event.event_type ?? '운영 이벤트'),
        description: event.description as string | null,
        created_at: String(event.created_at),
        severity: event.severity as 'info' | 'warning' | 'critical' | undefined,
        status: event.status as string | null | undefined,
        booking_id: event.booking_id as string | null | undefined,
        bank_transaction_id: event.bank_transaction_id as string | null | undefined,
        href: event.booking_id ? `/admin/bookings/${event.booking_id}` : undefined,
        metadata: event.metadata as Record<string, unknown> | undefined,
      })),
      ...((bookingsResult.data ?? []) as Array<Record<string, unknown>>).map(booking => ({
        id: `booking:${booking.id}`,
        type: 'booking_created',
        title: `${booking.booking_no ?? '예약'} · ${booking.package_title ?? '상품 미지정'}`,
        description: `${booking.status ?? '-'} · 판매가 ${Number(booking.total_price ?? 0).toLocaleString('ko-KR')}원`,
        created_at: String(booking.created_at),
        severity: 'info' as const,
        status: booking.status as string | null | undefined,
        booking_id: String(booking.id),
        amount: Number(booking.total_price ?? 0),
        href: `/admin/bookings/${booking.id}`,
        metadata: {
          departure_date: booking.departure_date,
          paid_amount: booking.paid_amount,
        },
      })),
      ...((notesResult.data ?? []) as Array<Record<string, unknown>>).map(note => ({
        id: `note:${note.id}`,
        type: 'customer_note',
        title: `${note.channel ?? '상담'} 메모`,
        description: note.content as string | null,
        created_at: String(note.created_at),
        severity: 'info' as const,
      })),
      ...((mileageResult.data ?? []) as Array<Record<string, unknown>>).map(mileage => ({
        id: `mileage:${mileage.id}`,
        type: 'mileage_adjusted',
        title: `${mileage.type ?? 'MILEAGE'} ${Number(mileage.amount ?? 0).toLocaleString('ko-KR')}P`,
        description: mileage.memo as string | null,
        created_at: String(mileage.created_at),
        severity: 'info' as const,
        booking_id: mileage.booking_id as string | null | undefined,
        amount: Number(mileage.amount ?? 0),
        href: mileage.booking_id ? `/admin/bookings/${mileage.booking_id}` : undefined,
      })),
      ...paymentItems,
    ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 120);

    return apiResponse({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return ApiErrors.internalError(error instanceof Error ? error.message : '고객 활동 조회 실패');
  }
}
