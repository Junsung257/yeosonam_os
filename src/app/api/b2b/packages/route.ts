/**
 * Phase 2-G: B2B 패키지 공급 API
 * GET /api/b2b/packages?page=1&limit=20
 *
 * 인증: Authorization: Bearer {api_key}
 * - SHA-256(api_key) → b2b_api_keys.key_hash 매칭 + is_active 확인
 * - 성공 시 total_calls++, last_used_at = now()
 * - 반환: 승인된 travel_packages 목록 (민감 정보 제외)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Authorization: Bearer {key} 에서 raw key 추출 */
function extractBearerKey(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** raw key → SHA-256 hex */
function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/** B2B 인증 + 호출 카운터 증가 */
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

  // total_calls 증가 + last_used_at 갱신 (실패해도 요청은 허용)
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

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  // 인증
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

  // 페이지네이션 파라미터
  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)));
  const offset = (page - 1) * limit;

  try {
    const { data, count, error } = await supabaseAdmin
      .from('travel_packages')
      .select(
        `id, title, destination, duration_nights, duration_days,
         status, product_summary, product_highlights,
         display_title, hero_tagline,
         price_dates, price_tiers,
         itinerary_data,
         created_at, updated_at`,
        { count: 'exact' },
      )
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json({
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: count ? Math.ceil(count / limit) : 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
