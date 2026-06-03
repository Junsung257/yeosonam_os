import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isAdminRequest, resolveAdminActorLabel } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { allowRateLimit, getClientIpFromRequest } from '@/lib/simple-rate-limit';
import { logError } from '@/lib/sentry-logger';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

async function requireAdminApi(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return apiResponse({ error: 'UNAUTHORIZED' }, { status: 403 });
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  const { id: bookingId } = await params;
  if (!bookingId) {
    return apiResponse({ error: 'BOOKING_ID_REQUIRED' }, { status: 400 });
  }

  const { data: booking, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id, concierge_ai_paused')
    .eq('id', bookingId)
    .maybeSingle();

  if (bErr) {
    logError('[admin/bookings/concierge-messages] booking lookup failed', bErr);
    return apiResponse({ error: sanitizeDbError(bErr) }, { status: 500 });
  }
  if (!booking) {
    return apiResponse({ error: 'BOOKING_NOT_FOUND' }, { status: 404 });
  }

  const aiPaused = Boolean((booking as { concierge_ai_paused?: boolean }).concierge_ai_paused);

  const { data, error } = await supabaseAdmin
    .from('booking_concierge_messages')
    .select('id, role, content, metadata, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true })
    .limit(400);

  if (error) {
    logError('[admin/bookings/concierge-messages] GET failed', error);
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  return apiResponse({ messages: data ?? [], aiPaused });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  const { id: bookingId } = await params;
  if (!bookingId) {
    return apiResponse({ error: 'BOOKING_ID_REQUIRED' }, { status: 400 });
  }

  let body: { aiPaused?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (typeof body.aiPaused !== 'boolean') {
    return apiResponse({ error: 'AI_PAUSED_REQUIRED' }, { status: 400 });
  }

  const { data: row, error: uErr } = await supabaseAdmin
    .from('bookings')
    .update({ concierge_ai_paused: body.aiPaused } as never)
    .eq('id', bookingId)
    .select('id, concierge_ai_paused')
    .maybeSingle();

  if (uErr) {
    logError('[admin/bookings/concierge-messages] PATCH failed', uErr);
    return apiResponse({ error: sanitizeDbError(uErr) }, { status: 500 });
  }
  if (!row) {
    return apiResponse({ error: 'BOOKING_NOT_FOUND' }, { status: 404 });
  }

  return apiResponse({
    ok: true,
    aiPaused: Boolean((row as { concierge_ai_paused?: boolean }).concierge_ai_paused),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  const { id: bookingId } = await params;
  if (!bookingId) {
    return apiResponse({ error: 'BOOKING_ID_REQUIRED' }, { status: 400 });
  }

  const ip = getClientIpFromRequest(request);
  if (!allowRateLimit(`admin_concierge_post:${bookingId}:${ip}`, 40, 60_000)) {
    return apiResponse({ error: 'RATE_LIMITED' }, { status: 429 });
  }

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return apiResponse({ error: 'CONTENT_REQUIRED' }, { status: 400 });
  }
  if (content.length > 4_000) {
    return apiResponse({ error: 'CONTENT_TOO_LONG' }, { status: 400 });
  }

  const { data: booking, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('id', bookingId)
    .maybeSingle();

  if (bErr) {
    logError('[admin/bookings/concierge-messages] POST booking lookup failed', bErr);
    return apiResponse({ error: sanitizeDbError(bErr) }, { status: 500 });
  }
  if (!booking) {
    return apiResponse({ error: 'BOOKING_NOT_FOUND' }, { status: 404 });
  }

  const actor = await resolveAdminActorLabel(request);

  const { error: insErr } = await supabaseAdmin.from('booking_concierge_messages').insert({
    booking_id: bookingId,
    role: 'staff',
    content,
    metadata: { by: actor } as never,
  } as never);

  if (insErr) {
    logError('[admin/bookings/concierge-messages] POST failed', insErr);
    return apiResponse({ error: sanitizeDbError(insErr) }, { status: 500 });
  }

  return apiResponse({ ok: true });
}
