/**
 * N5 박제 (2026-05-16 Lemax 표준 — 35% 수익↑): 패키지 Template 재사용 (clone).
 *
 * 사장님 솔루션: 자주 쓰는 패키지 (계림 3박5일 → 4박6일 변형) 복제 + inline 수정.
 * Lemax: "users report producing itineraries 3x faster".
 *
 * 동작:
 *   1. source package 의 핵심 필드 복제 (itinerary_data, optional_tours, price_tiers 등)
 *   2. title 에 "(복제)" 접미사 추가
 *   3. status='pending_review' + internal_code 신규 발급
 *   4. raw_text 는 source 그대로 (Rule Zero 회피용 — 사장님이 inline 편집)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { createHash } from 'crypto';

const CLONE_FIELDS = [
  'title', 'destination', 'duration', 'price',
  'category', 'product_type', 'trip_style',
  'departure_days', 'departure_airport', 'airline', 'min_participants',
  'itinerary', 'itinerary_data', 'inclusions', 'excludes', 'accommodations',
  'special_notes', 'customer_notes', 'notices_parsed',
  'price_tiers', 'price_dates', 'price_list', 'surcharges', 'excluded_dates',
  'optional_tours', 'cancellation_policy', 'category_attrs',
  'land_operator', 'land_operator_id', 'departing_location_id',
  'commission_rate',
  'product_tags', 'product_highlights', 'product_summary',
  'raw_text',
];

export const POST = withAdminGuard(async (req: NextRequest, ctx?: { params?: Promise<{ id: string }> }) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'no_db' }, { status: 503 });
  const params = await ctx?.params;
  const sourceId = params?.id;
  if (!sourceId) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  // body 옵션: { titleSuffix?: string, modifyDuration?: number }
  let body: { titleSuffix?: string; modifyDuration?: number } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  // 1) source 패키지 조회
  const { data: source, error: srcErr } = await supabaseAdmin
    .from('travel_packages')
    .select(CLONE_FIELDS.join(','))
    .eq('id', sourceId)
    .maybeSingle();
  if (srcErr || !source) return NextResponse.json({ error: 'source not found' }, { status: 404 });

  // 2) clone payload 빌드
  const src = source as unknown as Record<string, unknown>;
  const newTitle = `${src.title ?? '복제 패키지'} ${body.titleSuffix ?? '(복제)'}`.trim();
  const newDuration = body.modifyDuration ?? src.duration;

  const cloned: Record<string, unknown> = {};
  for (const f of CLONE_FIELDS) {
    if (f === 'title') cloned[f] = newTitle;
    else if (f === 'duration') cloned[f] = newDuration;
    else cloned[f] = src[f];
  }

  // 3) raw_text_hash 재계산 (Rule Zero)
  cloned.raw_text_hash = createHash('sha256').update(String(cloned.raw_text ?? '')).digest('hex');

  // 4) clone meta
  cloned.status = 'pending_review';
  cloned.confidence = null;
  cloned.audit_status = null;

  // 5) INSERT
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('travel_packages')
    .insert(cloned)
    .select('id, title')
    .single();
  if (insErr || !inserted) return NextResponse.json({ error: insErr?.message ?? 'insert failed' }, { status: 500 });

  return NextResponse.json({
    ok: true,
    id: (inserted as { id: string }).id,
    title: (inserted as { title: string }).title,
    edit_url: `/admin/packages/${(inserted as { id: string }).id}/review`,
    message: '복제 완료 — review 페이지에서 inline 수정 후 승인하세요.',
  });
});
