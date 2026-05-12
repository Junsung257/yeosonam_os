/**
 * Phase 2-G: B2B 패키지 단건 상세 API
 * GET /api/b2b/packages/{id}
 *
 * 인증: Authorization: Bearer {api_key} (목록 API와 동일)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

function extractBearerKey(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

async function authenticateB2bKey(
  rawKey: string,
): Promise<{ ok: boolean; keyId?: string; error?: string }> {
  const keyHash = hashKey(rawKey);

  const { data, error } = await supabaseAdmin
    .from('b2b_api_keys')
    .select('id, is_active')
    .eq('key_hash', keyHash)
    .limit(1);

  if (error) return { ok: false, error: '인증 오류' };
  if (!data?.[0]) return { ok: false, error: '유효하지 않은 API 키' };
  if (!data[0].is_active) return { ok: false, error: '비활성화된 API 키' };

  // total_calls 증가 + last_used_at 갱신
  const { data: cur } = await supabaseAdmin
    .from('b2b_api_keys')
    .select('total_calls')
    .eq('id', data[0].id)
    .limit(1);

  await supabaseAdmin
    .from('b2b_api_keys')
    .update({
      total_calls: ((cur?.[0]?.total_calls as number) ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', data[0].id)
    .catch(() => {});

  return { ok: true, keyId: data[0].id as string };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const rawKey = extractBearerKey(request);
  if (!rawKey) {
    return NextResponse.json(
      { error: 'Authorization 헤더가 필요합니다 (Bearer {api_key})' },
      { status: 401 },
    );
  }

  const auth = await authenticateB2bKey(rawKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: '패키지 ID가 필요합니다' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('travel_packages')
      .select(
        `id, title, destination, duration_nights, duration_days,
         status, product_summary, product_highlights,
         display_title, hero_tagline,
         price_dates, price_tiers,
         itinerary_data, special_notes,
         created_at, updated_at`,
      )
      .eq('id', id)
      .eq('status', 'approved')
      .limit(1);

    if (error) throw error;

    const pkg = data?.[0] ?? null;
    if (!pkg) {
      return NextResponse.json({ error: '패키지를 찾을 수 없거나 미승인 상태입니다' }, { status: 404 });
    }

    return NextResponse.json({ data: pkg });
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
