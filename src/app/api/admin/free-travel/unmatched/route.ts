import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

function isAdminRequest(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) return false;
  return request.headers.get('x-admin-token') === token;
}

const ResolveSchema = z.object({
  unmatchedId: z.string().uuid(),
  targetCommissionId: z.string().uuid(),
  reason: z.string().min(1).max(200).optional(),
});

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ unmatched: [] });
  }

  const { data, error } = await supabaseAdmin
    .from('free_travel_commissions')
    .select('id, ota, confirmed_krw, ota_report_ref, created_at')
    .eq('status', 'unmatched')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ code: 'UNMATCHED_FETCH_FAILED', error: error.message }, { status: 500 });
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

  return NextResponse.json({ unmatched });
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ code: 'DB_NOT_CONFIGURED', error: 'DB 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ResolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', error: 'unmatchedId/targetCommissionId를 확인해주세요.' }, { status: 400 });
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
    return NextResponse.json({ code: 'UNMATCHED_NOT_FOUND', error: '대상 unmatched를 찾을 수 없습니다.' }, { status: 404 });
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
    return NextResponse.json({ code: 'TARGET_UPDATE_FAILED', error: targetErr.message }, { status: 500 });
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
    return NextResponse.json({ code: 'UNMATCHED_RESOLVE_FAILED', error: unmatchedErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, resolvedAt: now, matchReason: 'manual' });
}
