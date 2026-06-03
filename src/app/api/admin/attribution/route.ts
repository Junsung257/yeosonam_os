import { NextRequest, type NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const getHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse(buildMockAttribution());
  }

  const { searchParams } = request.nextUrl;
  const tenantId = searchParams.get('tenant_id');
  const contentType = searchParams.get('content_type') ?? 'all';
  const parsedDays = Number.parseInt(searchParams.get('days') ?? '30', 10);
  const days = Math.min(Math.max(Number.isNaN(parsedDays) ? 30 : parsedDays, 1), 90);
  const contentId = searchParams.get('content_id');

  if (!tenantId) {
    return apiResponse({ error: 'TENANT_ID_REQUIRED' }, { status: 400 });
  }

  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    let query = supabaseAdmin
      .from('content_attribution_events')
      .select('content_id, content_type, event_type, occurred_at')
      .eq('tenant_id', tenantId)
      .gte('occurred_at', since);

    if (contentType !== 'all') query = query.eq('content_type', contentType);
    if (contentId) query = query.eq('content_id', contentId);

    const { data: events, error } = await query.limit(10_000);
    if (error) throw error;

    type EventRow = { content_id: string; content_type: string; event_type: string; occurred_at: string };
    const rows = (events ?? []) as EventRow[];

    const funnel = { view: 0, click: 0, inquiry: 0, booking: 0 };
    const byContent = new Map<string, typeof funnel>();

    for (const r of rows) {
      const k = r.event_type as keyof typeof funnel;
      if (k in funnel) {
        funnel[k]++;
        if (!byContent.has(r.content_id)) {
          byContent.set(r.content_id, { view: 0, click: 0, inquiry: 0, booking: 0 });
        }
        const c = byContent.get(r.content_id)!;
        c[k]++;
      }
    }

    const ctr = funnel.view > 0 ? (funnel.click / funnel.view) * 100 : 0;
    const inquiryCr = funnel.click > 0 ? (funnel.inquiry / funnel.click) * 100 : 0;
    const bookingCr = funnel.inquiry > 0 ? (funnel.booking / funnel.inquiry) * 100 : 0;

    const top_content = [...byContent.entries()]
      .sort((a, b) => b[1].booking - a[1].booking || b[1].inquiry - a[1].inquiry)
      .slice(0, 5)
      .map(([content_id, counts]) => ({ content_id, ...counts }));

    return apiResponse({
      period: `last_${days}d`,
      tenant_id: tenantId,
      funnel,
      rates: {
        ctr: Math.round(ctr * 10) / 10,
        inquiry_cr: Math.round(inquiryCr * 10) / 10,
        booking_cr: Math.round(bookingCr * 10) / 10,
      },
      top_content,
      total_events: rows.length,
    });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

function buildMockAttribution() {
  return {
    period: 'last_30d',
    tenant_id: 'mock',
    funnel: { view: 1240, click: 186, inquiry: 28, booking: 7 },
    rates: { ctr: 15.0, inquiry_cr: 15.1, booking_cr: 25.0 },
    top_content: [
      { content_id: 'mock-1', view: 420, click: 68, inquiry: 12, booking: 3 },
      { content_id: 'mock-2', view: 380, click: 55, inquiry: 9, booking: 2 },
      { content_id: 'mock-3', view: 240, click: 38, inquiry: 5, booking: 1 },
    ],
    total_events: 1461,
    mock: true,
  };
}

export const GET = withAdminGuard(getHandler);
