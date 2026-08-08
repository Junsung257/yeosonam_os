import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { authAffiliate } from '@/lib/affiliate/auth-service';
import { recordAffiliateFunnelEvent } from '@/lib/affiliate/funnel-events';
import { isAllowedPartnerWriteOrigin } from '@/lib/affiliate/write-origin';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidUuid } from '@/lib/supabase-filter-safe';

const DISPUTE_TYPES = new Set(['ATTRIBUTION', 'COMMISSION', 'SETTLEMENT', 'PAYOUT']);

function commandKey(request: NextRequest): string | null {
  const key = request.headers.get('idempotency-key')?.trim() || '';
  return /^[A-Za-z0-9:_-]{8,100}$/.test(key) ? key : null;
}

function evidenceUrls(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 5) return null;
  const urls: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 2_000) return null;
    try {
      const url = new URL(item);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      urls.push(url.toString());
    } catch {
      return null;
    }
  }
  return urls;
}

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  const { data, error } = await supabaseAdmin
    .from('affiliate_disputes')
    .select('id, booking_id, settlement_run_id, settlement_line_id, dispute_type, status, reason, evidence_urls, resolution, opened_at, due_at, resolved_at, updated_at')
    .eq('affiliate_id', String(auth.affiliate.id))
    .order('opened_at', { ascending: false });
  if (error) return apiResponse({ error: sanitizeDbError(error), code: 'DISPUTES_UNAVAILABLE' }, { status: 503 });
  return apiResponse({ disputes: data || [], updated_at: new Date().toISOString() });
}

export async function POST(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request)) return apiResponse({ error: 'ORIGIN_REJECTED' }, { status: 403 });
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  const idempotencyKey = commandKey(request);
  if (!idempotencyKey) return apiResponse({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const disputeType = typeof body.dispute_type === 'string' ? body.dispute_type.toUpperCase() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2_000) : '';
  const bookingId = typeof body.booking_id === 'string' && isValidUuid(body.booking_id) ? body.booking_id : null;
  const runId = typeof body.settlement_run_id === 'string' && isValidUuid(body.settlement_run_id) ? body.settlement_run_id : null;
  const lineId = typeof body.settlement_line_id === 'string' && isValidUuid(body.settlement_line_id) ? body.settlement_line_id : null;
  const urls = evidenceUrls(body.evidence_urls);
  if (!DISPUTE_TYPES.has(disputeType) || reason.length < 10 || !urls || (!bookingId && !runId && !lineId)) {
    return apiResponse({ error: 'INVALID_DISPUTE_INPUT' }, { status: 400 });
  }

  const affiliateId = String(auth.affiliate.id);
  const ownershipChecks = [];
  if (bookingId) {
    ownershipChecks.push(supabaseAdmin.from('bookings').select('id').eq('id', bookingId).eq('affiliate_id', affiliateId).maybeSingle());
  }
  if (runId) {
    ownershipChecks.push(supabaseAdmin.from('settlement_runs').select('id').eq('id', runId).eq('affiliate_id', affiliateId).maybeSingle());
  }
  if (lineId) {
    ownershipChecks.push(
      supabaseAdmin.from('settlement_lines').select('id, settlement_runs!inner(affiliate_id)')
        .eq('id', lineId).eq('settlement_runs.affiliate_id', affiliateId).maybeSingle(),
    );
  }
  const ownership = await Promise.all(ownershipChecks);
  if (ownership.some(result => result.error)) {
    return apiResponse({ error: 'DISPUTE_TARGET_UNAVAILABLE' }, { status: 503 });
  }
  if (ownership.some(result => !result.data)) {
    return apiResponse({ error: 'DISPUTE_TARGET_FORBIDDEN' }, { status: 403 });
  }

  const row = {
    affiliate_id: affiliateId,
    booking_id: bookingId,
    settlement_run_id: runId,
    settlement_line_id: lineId,
    dispute_type: disputeType,
    status: 'OPEN',
    idempotency_key: idempotencyKey,
    reason,
    evidence_urls: urls,
    opened_by: `affiliate:${affiliateId}`,
  };
  const { data, error } = await supabaseAdmin
    .from('affiliate_disputes')
    .insert(row as never)
    .select('id, booking_id, settlement_run_id, settlement_line_id, dispute_type, status, reason, evidence_urls, opened_at')
    .single();
  if (error) {
    const { data: replay } = await supabaseAdmin
      .from('affiliate_disputes')
      .select('id, booking_id, settlement_run_id, settlement_line_id, dispute_type, status, reason, evidence_urls, opened_at')
      .eq('affiliate_id', affiliateId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (replay) return apiResponse({ dispute: replay, idempotent_replay: true });
    return apiResponse({ error: sanitizeDbError(error), code: 'DISPUTE_CREATE_FAILED' }, { status: 500 });
  }
  await recordAffiliateFunnelEvent({
    eventName: 'affiliate_dispute_opened',
    affiliateId,
    bookingId,
    settlementRunId: runId,
    actorType: 'affiliate',
    traceId: idempotencyKey,
    idempotencyKey: `dispute-opened:${data.id}`,
    payload: {
      dispute_type: disputeType,
      has_evidence: urls.length > 0,
    },
  });
  return apiResponse({ dispute: data, idempotent_replay: false }, { status: 201 });
}
