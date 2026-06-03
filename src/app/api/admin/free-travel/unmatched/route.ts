import { NextRequest } from 'next/server';
import { z } from 'zod';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { requireAdminApiToken } from '@/lib/api-auth';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

const ResolveSchema = z.object({
  unmatchedId: z.string().uuid(),
  targetCommissionId: z.string().uuid(),
  reason: z.string().min(1).max(200).optional(),
});

const getHandler = async (request: NextRequest) => {
  const unauthorized = requireAdminApiToken(request);
  if (unauthorized) return unauthorized;
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ unmatched: [] });
  }

  const { data, error } = await supabaseAdmin
    .from('free_travel_commissions')
    .select('id, ota, confirmed_krw, ota_report_ref, created_at')
    .eq('status', 'unmatched')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    return apiResponse({ code: 'UNMATCHED_FETCH_FAILED', error: sanitizeDbError(error) }, { status: 500 });
  }

  const unmatched = await Promise.all((data ?? []).map(async (row: any) => {
    const baseAmount = Number(row.confirmed_krw ?? 0);
    const lower = Math.floor(baseAmount * 0.8);
    const upper = Math.ceil(baseAmount * 1.2);
    const { data: candidates } = await supabaseAdmin
      .from('free_travel_commissions')
      .select('id, session_id, estimated_krw, created_at, status')
      .eq('ota', row.ota)
      .in('status', ['pending', 'reported'])
      .gte('estimated_krw', lower)
      .lte('estimated_krw', upper)
      .order('created_at', { ascending: false })
      .limit(3);

    return {
      ...row,
      candidates: candidates ?? [],
    };
  }));

  return apiResponse({ unmatched });
}

const postHandler = async (request: NextRequest) => {
  const unauthorized = requireAdminApiToken(request);
  if (unauthorized) return unauthorized;
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ code: 'DB_NOT_CONFIGURED', error: 'DB not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ResolveSchema.safeParse(body);
  if (!parsed.success) {
    return apiResponse({ code: 'VALIDATION_ERROR', error: 'unmatchedId/targetCommissionId를 확인해주세요.' }, { status: 400 });
  }
  const { unmatchedId, targetCommissionId, reason } = parsed.data;

  const now = new Date().toISOString();
  const { data: unmatchedRows } = await supabaseAdmin
    .from('free_travel_commissions')
    .select('confirmed_krw, ota_report_ref')
    .eq('id', unmatchedId)
    .eq('status', 'unmatched')
    .limit(1);
  const unmatched = unmatchedRows?.[0];
  if (!unmatched) {
    return apiResponse({ code: 'UNMATCHED_NOT_FOUND', error: '대상 unmatched를 찾을 수 없습니다.' }, { status: 404 });
  }

  const { error: targetErr } = await supabaseAdmin
    .from('free_travel_commissions')
    .update({
      status: 'reconciled',
      confirmed_krw: unmatched.confirmed_krw,
      ota_report_ref: unmatched.ota_report_ref,
      reported_at: now,
    })
    .eq('id', targetCommissionId)
    .in('status', ['pending', 'reported']);
  if (targetErr) {
    return apiResponse({ code: 'TARGET_UPDATE_FAILED', error: sanitizeDbError(targetErr) }, { status: 500 });
  }

  const { error: unmatchedErr } = await supabaseAdmin
    .from('free_travel_commissions')
    .update({
      status: 'paid',
      commission_rate: 0,
      clicked_at: now,
      ota_report_ref: reason ? `${unmatched.ota_report_ref ?? ''} | manual:${reason}`.trim() : unmatched.ota_report_ref,
    })
    .eq('id', unmatchedId)
    .eq('status', 'unmatched');
  if (unmatchedErr) {
    return apiResponse({ code: 'UNMATCHED_RESOLVE_FAILED', error: sanitizeDbError(unmatchedErr) }, { status: 500 });
  }

  return apiResponse({ ok: true, resolvedAt: now, matchReason: 'manual' });
}

export const GET = withAdminGuard(getHandler);

export const POST = withAdminGuard(postHandler);
