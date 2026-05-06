/**
 * 세션 가드 — 어드민 쓰기 라우트의 2차 방어선
 *
 * 미들웨어(`src/middleware.ts`)가 1차로 cookie+JWT 만료 체크를 수행하지만,
 * 미들웨어 우회 시(설정 실수, matcher 누락, /api 직접 호출 등) 라우트가 무방어 상태가 됨.
 * 이 모듈은 라우트 진입부에서 세션 토큰의 **서명까지 검증**하는 두 번째 게이트를 제공.
 *
 * 사용:
 *   const guard = await requireAuthenticatedRoute(request);
 *   if (guard instanceof NextResponse) return guard;  // 401
 *   const { userId, email } = guard;
 *
 * 주의:
 *   - 쿠키 이름은 미들웨어와 동일한 'sb-access-token'.
 *   - Supabase Anon Key 로 토큰 검증 (서버사이드).
 *   - dev 환경: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY 미설정 시 통과 (개발 편의).
 *     prod 환경: 미설정 시 500 으로 fail.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicConfig } from '@/lib/app-config';

export interface AuthGuardSuccess {
  userId: string;
  email: string | null;
}

/**
 * 라우트 진입부에서 호출. 인증 실패 시 401 NextResponse 반환.
 * 통과 시 { userId, email } 반환.
 */
export async function requireAuthenticatedRoute(
  request: NextRequest
): Promise<AuthGuardSuccess | NextResponse> {
  const { url, anonKey: key } = getSupabasePublicConfig();

  if (!url || !key) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Supabase 인증 설정 누락 (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY)' },
        { status: 500 }
      );
    }
    // 개발 환경 — 우회 (미들웨어 자체도 비활성화 가능성)
    return { userId: 'dev-bypass', email: null };
  }

  // 1) cookie 우선
  let token: string | undefined = request.cookies.get('sb-access-token')?.value;
  // 2) Authorization Bearer fallback (서버-to-서버, 외부 API 호출용)
  if (!token) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return NextResponse.json({ error: '인증 토큰 없음' }, { status: 401 });
  }

  try {
    const client = createClient(url, key);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
      return NextResponse.json(
        { error: '세션 만료 또는 유효하지 않은 토큰' },
        { status: 401 }
      );
    }
    return { userId: data.user.id, email: data.user.email ?? null };
  } catch {
    return NextResponse.json({ error: '인증 확인 실패' }, { status: 401 });
  }
}
