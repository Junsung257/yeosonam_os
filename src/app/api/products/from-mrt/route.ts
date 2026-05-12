/**
 * POST /api/products/from-mrt
 *
 * MRT 호텔·투어 상품을 여소남 products 테이블에 등록 (REVIEW_NEEDED 상태).
 *
 * CS 필터 강제: reviewRating >= 4.5 AND reviewCount >= 100
 * 미충족 시 400 반환.
 *
 * Body: { type: 'stay'|'tna', item: StayResult|ActivityResult, destination: string, nights?: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { mrtStayToProductDraft, mrtTnaToProductDraft } from '@/lib/mrt-to-product';
import type { StayResult, ActivityResult } from '@/lib/travel-providers/types';
import { z } from 'zod';

const BodySchema = z.object({
  type:        z.enum(['stay', 'tna']),
  item:        z.record(z.unknown()),
  destination: z.string().min(1),
  nights:      z.number().int().min(1).optional().default(3),
});

async function getNextInternalCode(
  departureCode: string,
  supplierCode: string,
  destinationCode: string,
  durationDays: number,
): Promise<string> {
  if (!supabaseAdmin) throw new Error('DB 미설정');
  const prefix =
    departureCode.toUpperCase()
    + '-' + supplierCode.toUpperCase()
    + '-' + destinationCode.toUpperCase()
    + '-' + String(durationDays).padStart(2, '0')
    + '-';

  const { data } = await supabaseAdmin
    .from('products')
    .select('internal_code')
    .like('internal_code', `${prefix}%`)
    .order('internal_code', { ascending: false })
    .limit(1);

  let lastSeq = 0;
  if (data && data.length > 0) {
    const seqStr = (data[0] as { internal_code: string }).internal_code.slice(prefix.length);
    const parsed = parseInt(seqStr, 10);
    if (!isNaN(parsed)) lastSeq = parsed;
  }
  return prefix + String(lastSeq + 1).padStart(4, '0');
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { type, item, destination, nights } = parsed.data;

  const draft = type === 'stay'
    ? mrtStayToProductDraft(item as unknown as StayResult, destination, nights)
    : mrtTnaToProductDraft(item as unknown as ActivityResult, destination);

  // CS 필터 강제
  if (!draft.cs_filter_passed) {
    return NextResponse.json(
      { error: `CS 필터 미충족: ${draft.cs_filter_reason}`, cs_filter_passed: false },
      { status: 400 },
    );
  }

  // 중복 확인 (mrt_gid 기준)
  const { data: existing } = await supabaseAdmin
    .from('products')
    .select('internal_code')
    .eq('internal_memo', draft.internal_memo)
    .limit(1);

  if (existing && existing.length > 0) {
    const code = (existing[0] as { internal_code: string }).internal_code;
    return NextResponse.json({ error: `이미 등록됨 (${code})`, existing_code: code }, { status: 409 });
  }

  // internal_code 시퀀스 할당
  const internalCode = await getNextInternalCode(
    draft.departure_region_code,
    draft.supplier_code,
    draft.destination_code,
    draft.duration_days,
  );

  const { mrt_gid, mrt_category, mrt_rating, mrt_review_count, mrt_image_url, cs_filter_passed, cs_filter_reason, ...productFields } = draft;
  void mrt_gid; void mrt_category; void mrt_rating; void mrt_review_count; void mrt_image_url; void cs_filter_passed; void cs_filter_reason;

  const { data: row, error } = await supabaseAdmin
    .from('products')
    .insert({
      ...productFields,
      internal_code: internalCode,
      net_price:     Math.round(draft.net_price),
    })
    .select('internal_code, display_name, status')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, product: row }, { status: 201 });
}
