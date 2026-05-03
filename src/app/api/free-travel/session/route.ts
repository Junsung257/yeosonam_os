/**
 * POST /api/free-travel/session
 *
 * 플래닝 세션 저장 + 고객 연락처 확보.
 * 고객이 이름/전화번호를 입력했을 때 호출.
 *
 * GET /api/free-travel/session?id=...
 * 세션 조회 (플래닝 결과 복원).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const PHONE_RE = /^01[0-9]-?\d{3,4}-?\d{4}$/;

const UpsertSchema = z.object({
  sessionId:     z.string().uuid(),
  customerPhone: z.string().regex(PHONE_RE, '유효한 휴대폰 번호를 입력해주세요.'),
  customerName:  z.string().optional(),
});

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return '***';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function assertAdminApiToken(request: NextRequest): boolean {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) return false;
  return request.headers.get('x-admin-token') === token;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { sessionId, customerPhone, customerName } = UpsertSchema.parse(body);

    const { error, count } = await supabaseAdmin
      .from('free_travel_sessions')
      .update({
        customer_phone: customerPhone,
        customer_name:  customerName ?? null,
      })
      .eq('id', sessionId)
      .select('id', { count: 'exact', head: true });

    if (error) throw error;
    if (!count) {
      return NextResponse.json(
        { code: 'SESSION_NOT_FOUND', error: '세션이 만료되었거나 존재하지 않습니다. 다시 검색 후 시도해주세요.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', error: err.errors.map(e => e.message).join(', ') },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 'SESSION_UPDATE_FAILED', error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ session: null, sessions: [] });
  }

  const { searchParams } = request.nextUrl;
  const id   = searchParams.get('id');
  const list = searchParams.get('list') === '1';

  // 목록 조회 모드 (어드민 페이지용)
  if (list) {
    if (!assertAdminApiToken(request)) {
      return NextResponse.json(
        { code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' },
        { status: 403 },
      );
    }
    try {
      const limit  = Math.min(Number(searchParams.get('limit') ?? 100), 500);
      const status = searchParams.get('status') ?? undefined;

      let query = supabaseAdmin
        .from('free_travel_sessions')
        .select('id, destination, customer_name, customer_phone, plan_json, status, mrt_booking_ref, booked_at, admin_notes, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status) query = query.eq('status', status);

      const { data, count, error } = await query;
      if (error) throw error;
      const masked = (data ?? []).map((row: any) => ({
        ...row,
        customer_phone: maskPhone(row.customer_phone ?? null),
      }));
      return NextResponse.json({ sessions: masked, totalCount: count ?? 0 });
    } catch (err) {
      return NextResponse.json(
        { code: 'SESSION_LIST_FAILED', error: err instanceof Error ? err.message : '처리 실패' },
        { status: 500 },
      );
    }
  }

  // 단건 조회 모드
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: '유효하지 않은 세션 ID' }, { status: 400 });

  try {
    const { data, error } = await supabaseAdmin
      .from('free_travel_sessions')
      .select('*')
      .eq('id', id)
      .limit(1);

    if (error) throw error;
    return NextResponse.json({ session: data?.[0] ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
