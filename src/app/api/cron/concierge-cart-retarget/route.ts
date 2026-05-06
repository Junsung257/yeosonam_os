import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { sendConciergeCartRetarget } from '@/lib/kakao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://yeosonam.com';

interface CartRow {
  session_id: string;
  items: Array<{ product_name?: string }>;
  updated_at: string;
}

interface TxnRow {
  session_id: string;
  customer_name: string | null;
  customer_phone: string | null;
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 24h
  const until = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2h

  const { data: abandonSignals, error: abandonError } = await supabaseAdmin
    .from('ad_engagement_logs')
    .select('session_id, created_at')
    .eq('event_type', 'cart_abandon_exit')
    .gt('created_at', since)
    .lt('created_at', until)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (abandonError) {
    return NextResponse.json({ error: abandonError.message }, { status: 500 });
  }

  const sessionIds = Array.from(
    new Set((abandonSignals ?? []).map((s: { session_id: string }) => s.session_id).filter(Boolean)),
  );
  if (sessionIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: '이탈 신호 없음' });
  }

  const [{ data: carts, error: cartsError }, { data: txns, error: txnsError }, { data: sentLogs, error: sentLogError }] =
    await Promise.all([
      supabaseAdmin
        .from('carts')
        .select('session_id, items, updated_at')
        .in('session_id', sessionIds)
        .gt('updated_at', since)
        .lt('updated_at', until),
      supabaseAdmin
        .from('transactions')
        .select('session_id, customer_name, customer_phone, created_at')
        .in('session_id', sessionIds)
        .not('customer_phone', 'is', null)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('ad_engagement_logs')
        .select('session_id, created_at')
        .eq('event_type', 'cart_abandon_retarget_sent')
        .in('session_id', sessionIds)
        .gt('created_at', since),
    ]);

  if (cartsError) return NextResponse.json({ error: cartsError.message }, { status: 500 });
  if (txnsError) return NextResponse.json({ error: txnsError.message }, { status: 500 });
  if (sentLogError) return NextResponse.json({ error: sentLogError.message }, { status: 500 });

  const sentSet = new Set((sentLogs ?? []).map((r: { session_id: string }) => r.session_id));

  const latestTxnBySession = new Map<string, TxnRow>();
  for (const t of (txns ?? []) as TxnRow[]) {
    if (!t.session_id || latestTxnBySession.has(t.session_id)) continue;
    latestTxnBySession.set(t.session_id, t);
  }

  const targets = ((carts ?? []) as CartRow[])
    .filter(c => Array.isArray(c.items) && c.items.length > 0)
    .filter(c => latestTxnBySession.has(c.session_id))
    .filter(c => !sentSet.has(c.session_id));

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: '발송 대상 없음', sessions: sessionIds.length });
  }

  let sent = 0;
  let failed = 0;

  for (const cart of targets.slice(0, 100)) {
    const txn = latestTxnBySession.get(cart.session_id);
    if (!txn?.customer_phone) continue;
    try {
      await sendConciergeCartRetarget({
        phone: txn.customer_phone,
        name: txn.customer_name ?? undefined,
        itemCount: cart.items.length,
        cartUrl: `${BASE_URL}/concierge`,
      });

      await supabaseAdmin.from('ad_engagement_logs').insert({
        session_id: cart.session_id,
        user_id: null,
        event_type: 'cart_abandon_retarget_sent',
        product_id: null,
        product_name: cart.items[0]?.product_name ?? null,
        cart_added: false,
        page_url: '/concierge',
        lead_time_days: null,
      });
      sent++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    totalTargets: targets.length,
    sampledSessions: sessionIds.length,
  });
}
