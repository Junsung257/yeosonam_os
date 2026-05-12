/**
 * POST /api/attractions/bulk-import
 *
 * MRT sync 스크립트(db/sync_mrt_attractions.js)에서 호출하는
 * 배치 upsert 엔드포인트. 서비스 역할 키로만 접근 가능.
 *
 * Body: { rows: AttractionImportRow[] }
 * Response: { upserted: number; errors: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { z } from 'zod';
import { getSecret } from '@/lib/secret-registry';

const RowSchema = z.object({
  mrt_gid:          z.string(),
  mrt_category:     z.enum(['stay', 'tna', 'flight']),
  mrt_rating:       z.number().nullable().optional(),
  mrt_review_count: z.number().int().nullable().optional(),
  mrt_min_price:    z.number().int().nullable().optional(),
  mrt_synced_at:    z.string().optional(),
  name:             z.string().min(1),
  badge_type:       z.string().optional(),
  region:           z.string().optional(),
  country:          z.string().optional(),
  is_active:        z.boolean().optional().default(true),
});

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1).max(500),
});

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  // 서비스 역할 키 인증
  const auth = request.headers.get('authorization');
  const svcKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  if (svcKey && auth !== `Bearer ${svcKey}`) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const rows = parsed.data.rows.map(r => ({
    ...r,
    mrt_synced_at: r.mrt_synced_at ?? new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('attractions')
    .upsert(rows, { onConflict: 'mrt_gid', ignoreDuplicates: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: rows.length });
}
