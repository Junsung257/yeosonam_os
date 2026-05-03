import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';

export const dynamic = 'force-dynamic';

interface DeleteBody {
  customerId: string;
  adminNote?: string;
}

interface StepResult {
  step: string;
  ok: boolean;
  affected?: number;
  error?: string;
}

/**
 * POST /api/admin/gdpr/delete
 *
 * 잊힐 권리 연쇄 삭제 파이프라인.
 * 어드민 인증 필수. 각 단계 결과를 상세 로그로 반환.
 *
 * 삭제 순서:
 *  1. conversations 메시지 null화 (소프트)
 *  2. customers soft delete (PII null화 + deleted_at)
 *  3. bookings.actual_payer_name null화
 *  4. booking_companions 여권정보 null화
 *  5. agent_tasks anonymize
 *  6. gdpr_deletion_log 기록
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  // 어드민 인증
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  let adminEmail = 'unknown';
  try {
    const verified = await verifySupabaseAccessToken(token);
    if (!verified.ok) {
      return NextResponse.json({ error: '유효하지 않은 토큰' }, { status: 401 });
    }
    adminEmail = (verified.payload.email as string | undefined) ?? 'unknown';

    // super_admin만 GDPR 삭제 허용
    const userId = (verified.payload.sub as string | undefined);
    if (userId) {
      const { data: adminRow } = await supabaseAdmin
        .from('admin_users')
        .select('role')
        .eq('user_id', userId)
        .limit(1);
      const role = adminRow?.[0]?.role;
      if (role !== 'super_admin') {
        return NextResponse.json({ error: 'super_admin 권한 필요' }, { status: 403 });
      }
    }
  } catch {
    return NextResponse.json({ error: '유효하지 않은 토큰' }, { status: 401 });
  }

  let body: DeleteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  const { customerId, adminNote } = body;
  if (!customerId) {
    return NextResponse.json({ error: 'customerId 필수' }, { status: 400 });
  }

  const steps: StepResult[] = [];

  // ── Step 1: conversations 메시지 null화 ────────────────────────────────────
  try {
    const { error, count } = await supabaseAdmin
      .from('conversations')
      .update({ messages: null, anonymized_at: new Date().toISOString() })
      .eq('customer_id', customerId);
    steps.push({
      step: '1_conversations_anonymize',
      ok: !error,
      affected: count ?? undefined,
      error: error?.message,
    });
  } catch (e) {
    steps.push({ step: '1_conversations_anonymize', ok: false, error: String(e) });
  }

  // ── Step 2: customers soft delete (PII null화) ─────────────────────────────
  try {
    const { error, count } = await supabaseAdmin
      .from('customers')
      .update({
        name: null,
        email: null,
        phone: null,
        passport_no: null,
        passport_expiry: null,
        birth_date: null,
        memo: null,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', customerId);
    steps.push({
      step: '2_customers_soft_delete',
      ok: !error,
      affected: count ?? undefined,
      error: error?.message,
    });
  } catch (e) {
    steps.push({ step: '2_customers_soft_delete', ok: false, error: String(e) });
  }

  // ── Step 3: bookings actual_payer_name null화 ──────────────────────────────
  try {
    const { error, count } = await supabaseAdmin
      .from('bookings')
      .update({ actual_payer_name: null })
      .eq('lead_customer_id', customerId);
    steps.push({
      step: '3_bookings_payer_anonymize',
      ok: !error,
      affected: count ?? undefined,
      error: error?.message,
    });
  } catch (e) {
    steps.push({ step: '3_bookings_payer_anonymize', ok: false, error: String(e) });
  }

  // ── Step 4: booking_companions 여권정보 null화 ─────────────────────────────
  try {
    // 먼저 해당 고객의 booking id 목록 조회
    const { data: bookingRows } = await supabaseAdmin
      .from('bookings')
      .select('id')
      .eq('lead_customer_id', customerId);

    const bookingIds = (bookingRows ?? []).map((b: { id: string }) => b.id);

    if (bookingIds.length > 0) {
      const { error, count } = await supabaseAdmin
        .from('booking_companions')
        .update({
          passport_no: null,
          passport_expiry: null,
          name: null,
          birth_date: null,
        })
        .in('booking_id', bookingIds);
      steps.push({
        step: '4_booking_companions_anonymize',
        ok: !error,
        affected: count ?? undefined,
        error: error?.message,
      });
    } else {
      steps.push({ step: '4_booking_companions_anonymize', ok: true, affected: 0 });
    }
  } catch (e) {
    steps.push({ step: '4_booking_companions_anonymize', ok: false, error: String(e) });
  }

  // ── Step 5: agent_tasks anonymize ─────────────────────────────────────────
  try {
    const { error, count } = await supabaseAdmin
      .from('agent_tasks')
      .update({ input_data: null, output_data: null })
      .eq('customer_id', customerId);
    steps.push({
      step: '5_agent_tasks_anonymize',
      ok: !error,
      affected: count ?? undefined,
      error: error?.message,
    });
  } catch (e) {
    steps.push({ step: '5_agent_tasks_anonymize', ok: false, error: String(e) });
  }

  // ── Step 6: gdpr_deletion_log 기록 ────────────────────────────────────────
  const allOk = steps.every((s) => s.ok);
  try {
    await supabaseAdmin.from('gdpr_deletion_log').insert({
      customer_id: customerId,
      initiated_by: adminEmail,
      steps_completed: steps,
      completed_at: allOk ? new Date().toISOString() : null,
    });
    steps.push({ step: '6_audit_log_written', ok: true });
  } catch (e) {
    steps.push({ step: '6_audit_log_written', ok: false, error: String(e) });
  }

  return NextResponse.json({
    ok: allOk,
    customerId,
    adminNote: adminNote ?? null,
    steps,
    summary: {
      total: steps.length,
      succeeded: steps.filter((s) => s.ok).length,
      failed: steps.filter((s) => !s.ok).length,
    },
  });
}
