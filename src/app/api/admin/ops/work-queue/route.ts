import { NextRequest } from 'next/server';
import { ApiErrors, apiResponse } from '@/lib/api-response';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

type QueueItem = {
  id: string;
  kind: 'ledger_drift' | 'payment_review' | 'payment_unmatched' | 'payment_stale' | 'payment_outflow';
  priority: number;
  title: string;
  amount?: number;
  href: string;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
};

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return ApiErrors.unavailable('Supabase가 설정되지 않았습니다.');
  }

  try {
    const [driftResult, txResult, eventResult] = await Promise.all([
      supabaseAdmin.rpc('reconcile_ledger'),
      supabaseAdmin
        .from('bank_transactions')
        .select('id, amount, transaction_type, counterparty_name, received_at, match_status, is_refund, status')
        .neq('status', 'excluded')
        .in('match_status', ['unmatched', 'review', 'error'])
        .order('received_at', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('ops_events')
        .select('id, event_type, severity, title, description, booking_id, customer_id, bank_transaction_id, created_at, metadata')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (driftResult.error) {
      return ApiErrors.internalError(sanitizeDbError(driftResult.error, 'ledger reconcile failed'));
    }
    if (txResult.error) {
      return ApiErrors.internalError(sanitizeDbError(txResult.error, 'bank transaction queue failed'));
    }

    const now = Date.now();
    const items: QueueItem[] = [];
    const drifts = (driftResult.data ?? []) as Array<{
      booking_id: string;
      account: string;
      drift: number | string;
    }>;

    for (const drift of drifts.slice(0, 20)) {
      items.push({
        id: `drift:${drift.booking_id}:${drift.account}`,
        kind: 'ledger_drift',
        priority: 100,
        title: `원장 불일치 ${Number(drift.drift).toLocaleString('ko-KR')}원`,
        amount: Math.abs(Number(drift.drift) || 0),
        href: `/admin/payments/reconcile?booking=${drift.booking_id}`,
        metadata: { booking_id: drift.booking_id, account: drift.account },
      });
    }

    for (const tx of (txResult.data ?? []) as Array<{
      id: string;
      amount: number;
      transaction_type: string;
      counterparty_name: string | null;
      received_at: string;
      match_status: string | null;
      is_refund: boolean | null;
    }>) {
      const hours = (now - new Date(tx.received_at).getTime()) / 3600000;
      const isOutflow = tx.transaction_type === '출금' || tx.is_refund === true;
      const isStale = hours >= 24;
      const kind: QueueItem['kind'] =
        isStale ? 'payment_stale'
        : isOutflow ? 'payment_outflow'
        : tx.match_status === 'review' || tx.match_status === 'error' ? 'payment_review'
        : 'payment_unmatched';
      const priority =
        isStale ? 80
        : kind === 'payment_review' ? 70
        : kind === 'payment_outflow' ? 60
        : 50;
      items.push({
        id: `tx:${tx.id}`,
        kind,
        priority,
        title: `${tx.counterparty_name ?? '이름 없음'} · ${tx.transaction_type} ${tx.amount.toLocaleString('ko-KR')}원`,
        amount: tx.amount,
        href: `/admin/payments?tx=${tx.id}`,
        created_at: tx.received_at,
        metadata: {
          transaction_id: tx.id,
          match_status: tx.match_status,
          hours_stale: Math.round(hours),
        },
      });
    }

    const openEvents = (eventResult.data ?? []).map((event: Record<string, unknown>) => ({
      id: `event:${event.id}`,
      kind: 'payment_review' as const,
      priority: event.severity === 'critical' ? 90 : event.severity === 'warning' ? 75 : 40,
      title: String(event.title ?? '운영 이벤트'),
      href: event.booking_id ? `/admin/bookings/${event.booking_id}` : '/admin/payments',
      created_at: event.created_at as string | null,
      metadata: event.metadata as Record<string, unknown> | undefined,
    }));

    const sorted = [...items, ...openEvents]
      .sort((a, b) => b.priority - a.priority || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, 50);

    return apiResponse({
      items: sorted,
      summary: {
        total: sorted.length,
        ledger_drift: drifts.length,
        payment_attention: (txResult.data ?? []).length,
      },
      checked_at: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return ApiErrors.internalError(error instanceof Error ? error.message : '운영 큐 조회 실패');
  }
}
