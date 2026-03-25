/**
 * PUT /api/tax/[id]
 * 세무 관련 필드 인라인 수정
 * 허용 필드: transfer_status, transfer_receipt_url, has_tax_invoice, customer_receipt_status
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const ALLOWED_FIELDS = new Set([
  'transfer_status',
  'transfer_receipt_url',
  'has_tax_invoice',
  'customer_receipt_status',
]);

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json();

  // 허용 필드만 필터링
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(key)) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: '수정할 유효한 필드가 없습니다.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', params.id)
    .select('id, transfer_status, transfer_receipt_url, has_tax_invoice, customer_receipt_status')
    .single();

  if (error) {
    console.error('[세무 수정] 실패:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, booking: data });
}
