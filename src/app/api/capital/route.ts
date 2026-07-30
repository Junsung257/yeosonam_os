/**
 * /api/capital
 *
 * GET  — 자본금 투입 목록 + 합계
 * POST — 자본금 항목 추가
 * DELETE — 자본금 항목 삭제
 */

import { NextRequest } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import { apiResponse } from '@/lib/api-response';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseAdminConfigured)
    return apiResponse({ error: 'Supabase admin connection is not configured.' }, { status: 503, headers: NO_STORE_HEADERS });

  const { searchParams } = new URL(request.url);
  const summaryOnly = searchParams.get('summary') === '1';
  if (summaryOnly) {
    const { data, error } = await supabaseAdmin.rpc('get_capital_total');

    if (error) return apiResponse({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });

    return apiResponse(data ?? { entries: [], total: 0 }, { headers: NO_STORE_HEADERS });
  }

  const { data, error } = await supabaseAdmin
    .from('capital_entries')
    .select('*')
    .order('entry_date', { ascending: false });

  if (error) return apiResponse({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });

  const total = (data || []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  return apiResponse({ entries: data || [], total }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseAdminConfigured)
    return apiResponse({ error: 'Supabase admin connection is not configured.' }, { status: 503, headers: NO_STORE_HEADERS });

  const body = await request.json();
  const { amount, note, entry_date } = body;

  if (!amount || amount <= 0)
    return apiResponse({ error: 'amount는 양수여야 합니다.' }, { status: 400, headers: NO_STORE_HEADERS });

  const { data, error } = await supabaseAdmin
    .from('capital_entries')
    .insert({
      amount:     Math.round(amount),
      note:       note ?? null,
      entry_date: entry_date ?? new Date().toISOString().slice(0, 10),
    })
    .select('*')
    .single();

  if (error) return apiResponse({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  return apiResponse({ entry: data }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseAdminConfigured)
    return apiResponse({ error: 'Supabase admin connection is not configured.' }, { status: 503, headers: NO_STORE_HEADERS });

  const { searchParams } = new URL(request.url);
  const queryId = searchParams.get('id');
  const body = queryId ? null : await request.json();
  const id = queryId ?? body?.id;
  if (!id) return apiResponse({ error: 'id 필요' }, { status: 400, headers: NO_STORE_HEADERS });

  const { error } = await supabaseAdmin
    .from('capital_entries')
    .delete()
    .eq('id', id);

  if (error) return apiResponse({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  return apiResponse({ success: true }, { headers: NO_STORE_HEADERS });
}
