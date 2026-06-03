import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const ALLOWED_FIELDS = new Set([
  'transfer_status',
  'transfer_receipt_url',
  'has_tax_invoice',
  'customer_receipt_status',
]);

export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(key)) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 1) {
    return apiResponse({ error: '수정할 유효한 필드가 없습니다.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', params.id)
    .select('id, transfer_status, transfer_receipt_url, has_tax_invoice, customer_receipt_status')
    .single();

  if (error) {
    console.error('[tax update] failed:', sanitizeDbError(error));
    return apiResponse({ error: sanitizeDbError(error, '수정 실패') }, { status: 500 });
  }

  return apiResponse({ ok: true, booking: data });
}
