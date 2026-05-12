/**
 * Jarvis 인증 통합 — sb-access-token (staff) + magic-session (guest customer).
 *
 * 결정 (S1, 매직링크 통합):
 *   - 기본 staff 인증 흐름(verifySupabaseAccessToken)은 무수정 유지.
 *   - 매직링크로 진입한 게스트 고객은 'magic-session' 쿠키(HMAC)를 가짐.
 *     자비스 endpoint 는 staff 쿠키 없을 때만 magic-session 시도 → 게스트 컨텍스트로 진입.
 *   - 게스트는 read-only / assist 스코프만 부여 (chat:read · chat:assist).
 *     mutating 액션은 HITL 또는 폼 페이지로만. Air Canada 패턴 방지.
 */

import type { NextRequest } from 'next/server';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import {
  verifyMagicSessionToken,
  MAGIC_SESSION_COOKIE,
  hasScope,
  type MagicSessionPayload,
  type MagicSessionScope,
} from '@/lib/magic-session';
import { resolveJarvisContext } from '@/lib/jarvis/context';
import type { JarvisContext } from '@/lib/jarvis/types';

export type JarvisAuthResult =
  | {
      type: 'staff';
      ctx: JarvisContext;
    }
  | {
      type: 'guest';
      ctx: JarvisContext;
      magicSession: MagicSessionPayload;
    }
  | {
      type: 'unauthenticated';
      reason: string;
    };

export async function resolveJarvisAuth(
  req: NextRequest,
  body: { context?: Record<string, unknown> } = {},
): Promise<JarvisAuthResult> {
  // ── Path 1: Supabase staff/admin 토큰 ───────────────────────────
  const sbToken = req.cookies.get('sb-access-token')?.value;
  if (sbToken) {
    const verified = await verifySupabaseAccessToken(sbToken);
    if (verified.ok) {
      const ctx = resolveJarvisContext(req, body);
      return { type: 'staff', ctx };
    }
  }

  // ── Path 2: magic-session 게스트 쿠키 ────────────────────────────
  const magicCookie = req.cookies.get(MAGIC_SESSION_COOKIE)?.value;
  if (magicCookie) {
    const res = verifyMagicSessionToken(magicCookie, {
      ip: req.headers.get('x-vercel-forwarded-for') ?? undefined,
      ua: req.headers.get('user-agent') ?? undefined,
    });
    if (res.ok) {
      const ms = res.payload;

      // 자비스 채팅 스코프 강제 (read 또는 assist 중 하나라도 있어야 진입 허용)
      if (!hasScope(ms, 'jarvis:chat:read') && !hasScope(ms, 'jarvis:chat:assist')) {
        return { type: 'unauthenticated', reason: 'magic_session_no_jarvis_scope' };
      }

      // 게스트 컨텍스트: 요청 바디의 tenant/role/surface 덮어쓰기 차단 (스푸핑 방지)
      const fromBody = (body.context ?? {}) as Record<string, unknown>;
      const blocked = ['tenantId', 'userId', 'userRole', 'surface'] as const;
      const safeBody = { ...fromBody };
      for (const k of blocked) delete safeBody[k];

      const ctx: JarvisContext = {
        ...(safeBody as Partial<JarvisContext>),
        tenantId: ms.tid ?? undefined,
        // 게스트는 실제 Supabase user 아님 — magic_action_tokens.id 를 의사 식별자로
        userId: `magic:${ms.aid}`,
        userRole: 'customer',
        surface: 'customer',
        // 컨텍스트에 booking_id 등 자동 주입
        bookingId: ms.bid ?? undefined,
        customerId: ms.cid ?? undefined,
      };

      return { type: 'guest', ctx, magicSession: ms };
    }
  }

  return { type: 'unauthenticated', reason: 'no_valid_credential' };
}

/**
 * 게스트 세션이 mutating 액션을 시도할 때 권한 체크.
 * 자비스 V2 의 도구 디스패치(tool dispatch) 단에서 호출 권장.
 */
export function guestCanRequestAssist(magicSession: MagicSessionPayload): boolean {
  return hasScope(magicSession, 'jarvis:chat:assist');
}

/** 게스트 스코프 체크 (특정 액션 권한) */
export function guestHasScope(
  auth: JarvisAuthResult,
  scope: MagicSessionScope,
): boolean {
  return auth.type === 'guest' && hasScope(auth.magicSession, scope);
}

/**
 * 세션 행이 현재 인증 컨텍스트로 접근 가능한지 검증.
 * 게스트가 다른 booking 의 sessionId 를 body 에 넣어 이어쓰는 정보 유출 방지.
 *
 * 정책:
 *   - staff: 항상 허용 (어드민 RBAC 은 별도)
 *   - guest:
 *       · session.context.bookingId 가 있으면 magic-session.bid 와 동일해야 허용
 *       · session.context.tenantId 가 있으면 magic-session.tid 와 동일해야 허용
 *       · 둘 다 없으면 (legacy 빈 세션) → 보수적으로 거부 → 새 세션 생성됨
 */
export function canAccessSession(
  auth: JarvisAuthResult,
  sessionRow: { context?: Record<string, unknown> | null } | null | undefined,
): boolean {
  if (!sessionRow) return false;
  if (auth.type !== 'guest') return true;

  const ctx = (sessionRow.context ?? {}) as Record<string, unknown>;
  const sessionBookingId = typeof ctx.bookingId === 'string' ? ctx.bookingId : null;
  const sessionTenantId = typeof ctx.tenantId === 'string' ? ctx.tenantId : null;
  const ms = auth.magicSession;

  if (sessionBookingId && ms.bid && sessionBookingId !== ms.bid) return false;
  if (sessionTenantId && ms.tid && sessionTenantId !== ms.tid) return false;
  if (!sessionBookingId && !sessionTenantId) return false;
  return true;
}
