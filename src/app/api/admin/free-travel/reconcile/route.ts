/**
 * POST /api/admin/free-travel/reconcile
 *
 * OTA 커미션 리포트 업로드 + 자동 매칭.
 * Body: { ota: 'mrt', reportMonth: '2026-05', items: OtaReportItem[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { reconcileOtaReport } from '@/lib/free-travel/reconcile';

const ItemSchema = z.object({
  ref_id:       z.string().optional(),
  sub_id:       z.string().optional(),
  amount_krw:   z.number().int().min(0),
  booking_date: z.string().optional(),
});

const RequestSchema = z.object({
  ota:         z.enum(['mrt', 'agoda', 'hotels_com']),
  reportMonth: z.string().regex(/^\d{4}-\d{2}$/),
  items:       z.array(ItemSchema).min(1),
  totalKrw:    z.number().int().min(0).optional(),
});

function isAdminRequest(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) return false;
  return request.headers.get('x-admin-token') === token;
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { ota, reportMonth, items, totalKrw } = RequestSchema.parse(body);

    // 리포트 레코드 생성 (upsert)
    const { data: reportRow, error: reportErr } = await supabaseAdmin
      .from('ota_commission_reports')
      .upsert({
        ota,
        report_month: reportMonth,
        total_krw:    totalKrw ?? items.reduce((s, i) => s + i.amount_krw, 0),
        item_count:   items.length,
        raw_json:     items,
      }, { onConflict: 'ota,report_month' })
      .select('id')
      .single();

    if (reportErr || !reportRow) throw reportErr ?? new Error('리포트 생성 실패');

    const result = await reconcileOtaReport(reportRow.id, items);

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ') },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ reports: [] });
  }

  const { searchParams } = request.nextUrl;
  const ota = searchParams.get('ota');

  let query = supabaseAdmin
    .from('ota_commission_reports')
    .select('*')
    .order('report_month', { ascending: false })
    .limit(24);

  if (ota) query = query.eq('ota', ota);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json({ reports: data ?? [] });
}
