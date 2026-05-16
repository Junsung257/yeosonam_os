/**
 * 일회용 디버그 endpoint — production 에서 destination_climate lookup 이 왜 null 인지 진단.
 *
 * 2026-05-16 박제 (사장님 "또 안 나온다" 사고 후속):
 *   PR #94 머지·배포·ISR 무효화 후에도 모바일 상세에 climate 카드 미노출.
 *   page.tsx 의 RSC payload 에 climateData=null 박힘 → 서버 측 fetch 0건.
 *   하지만 SQL 으로는 "서안"/"나트랑/달랏" 정상 hit.
 *   원인 좁히려고 production runtime 에서 lookup keys / supabase 클라이언트 상태 / hit count 직접 조회.
 *
 * 접근: GET /api/_debug/climate-render?secret=<REVALIDATE_SECRET>&dest=서안,화산
 * 보안: REVALIDATE_SECRET 와 동일 토큰 검증. 정찰 방지.
 *
 * 사용 끝나면 이 파일 삭제할 것 (별 PR).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';
import {
  resolveDestinationClimate,
  destinationLookupKeys,
} from '@/lib/destination-climate-lookup';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') ?? '';
  const dest = url.searchParams.get('dest') ?? '';

  const expected = getSecret('REVALIDATE_SECRET');
  if (!expected || !safeEqualString(secret, expected)) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }
  if (!dest) {
    return NextResponse.json({ error: 'dest required' }, { status: 400 });
  }

  const keys = destinationLookupKeys(dest);

  // env 상태 (값은 노출 X, 존재 여부만)
  const env = {
    has_supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    has_anon_key: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    has_service_role: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    isSupabaseConfigured,
    node_env: process.env.NODE_ENV ?? 'unknown',
    vercel_env: process.env.VERCEL_ENV ?? 'unknown',
  };

  // raw IN query 결과
  let rawIn: { error: string | null; rows: number; sample: string[] } = {
    error: null,
    rows: 0,
    sample: [],
  };
  try {
    const { data, error } = await supabaseAdmin
      .from('destination_climate')
      .select('destination, primary_city')
      .in('destination', keys);
    rawIn = {
      error: error ? error.message : null,
      rows: data?.length ?? 0,
      sample: ((data ?? []) as { destination: string }[]).map(r => r.destination).slice(0, 5),
    };
  } catch (e) {
    rawIn.error = e instanceof Error ? e.message : 'unknown';
  }

  // resolveDestinationClimate 결과
  const resolved = await resolveDestinationClimate(dest);

  return NextResponse.json({
    dest,
    lookup_keys: keys,
    env,
    raw_in_query: rawIn,
    resolved: resolved
      ? {
          destination: resolved.destination,
          primary_city: resolved.primary_city,
          monthly_normals_is_array: Array.isArray(resolved.monthly_normals),
          monthly_normals_len: Array.isArray(resolved.monthly_normals)
            ? (resolved.monthly_normals as unknown[]).length
            : -1,
          fitness_scores_is_array: Array.isArray(resolved.fitness_scores),
          utc_offset_minutes: resolved.utc_offset_minutes,
          timezone: resolved.timezone,
        }
      : null,
  });
}
