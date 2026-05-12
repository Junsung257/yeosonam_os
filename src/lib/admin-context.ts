/**
 * 어드민 라우트에서 JWT 페이로드(sb-access-token) 를 디코딩해
 * audit/created_by 에 사용할 식별자를 추출.
 *
 * middleware 가 이미 토큰 만료를 검증함 — 여기서는 페이로드만 읽음.
 * 토큰이 없거나 파싱 실패면 null 반환 → 호출자가 'admin' fallback 사용.
 */

import type { NextRequest } from 'next/server';

export interface AdminContext {
  userId: string | null;
  email: string | null;
  /** audit log / created_by 컬럼에 적합한 식별자 (이메일 → uuid prefix → 'admin') */
  actor: string;
}

export function getAdminContext(req: NextRequest): AdminContext {
  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) return { userId: null, email: null, actor: 'admin' };
  try {
    const segments = token.split('.');
    if (segments.length !== 3) return { userId: null, email: null, actor: 'admin' };
    const padded = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(
      Buffer.from(padded + '=='.slice(0, (4 - (padded.length % 4)) % 4), 'base64').toString('utf-8'),
    ) as { sub?: string; email?: string };
    const userId = decoded.sub ?? null;
    const email = decoded.email ?? null;
    const actor = email ?? (userId ? userId.slice(0, 8) : 'admin');
    return { userId, email, actor };
  } catch {
    return { userId: null, email: null, actor: 'admin' };
  }
}
