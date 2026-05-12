/**
 * 매직링크 자비스 챗 진입 페이지 — `/m/chat/[token]`.
 *
 * 동작:
 *   1. URL token = magic_action_tokens.id (POST-confirm 후 액션 페이지 URL 에 박힘)
 *   2. magic-session 쿠키 검증 (POST-confirm 단에서 발급)
 *   3. token 과 쿠키의 aid 가 일치하는지 확인 (defense in depth)
 *   4. booking 컨텍스트 로드 → MagicLinkChat 위젯에 주입
 *   5. 쿠키 없거나 mismatch → /m/link/[?] 재진입 안내
 *
 * 라우팅 보호: middleware.ts 의 PUBLIC_PREFIXES 에 /m/chat/ 자동 포함 안 되므로
 * 별도 추가 필요. 단 자비스 API (/api/jarvis*) 는 magic-session 으로 인증되므로 OK.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import { actionDescriptionFor } from '@/lib/magic-link-routing';
import MagicLinkChat, { type MagicLinkChatContext } from '@/components/jarvis/MagicLinkChat';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '여소남 안내 채팅',
  robots: { index: false, follow: false },
};

type PageParams = { params: Promise<{ token: string }> };

export default async function MagicLinkChatPage({ params }: PageParams) {
  const { token: tokenIdFromUrl } = await params;

  // ── 1) magic-session 쿠키 검증 ──────────────────────────────
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok) {
    // 쿠키 없거나 만료 — 토큰 ID 로는 다시 입장할 수 없으므로 안내
    return <EnterpriseError reason="session_required" />;
  }

  const { payload } = session;

  // ── 2) URL token 과 쿠키 aid mismatch 방어 ──────────────────
  if (payload.aid !== tokenIdFromUrl) {
    return <EnterpriseError reason="mismatch" />;
  }

  // ── 3) 자비스 채팅 스코프 확인 ───────────────────────────────
  if (!payload.scope.includes('jarvis:chat:read') && !payload.scope.includes('jarvis:chat:assist')) {
    return <EnterpriseError reason="no_scope" />;
  }

  // ── 4) booking 컨텍스트 로드 (선택) ─────────────────────────
  let bookingCtx: Pick<MagicLinkChatContext, 'bookingNo' | 'bookingDestination' | 'bookingDepartureDate' | 'customerName'> = {};

  if (payload.bid) {
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('booking_no, destination, departure_date, lead_customer_id, customers:lead_customer_id(name)')
      .eq('id', payload.bid)
      .limit(1);
    const b = data?.[0] as
      | {
          booking_no?: string | null;
          destination?: string | null;
          departure_date?: string | null;
          customers?: { name?: string | null } | null;
        }
      | undefined;
    if (b) {
      bookingCtx = {
        bookingNo: b.booking_no ?? null,
        bookingDestination: b.destination ?? null,
        bookingDepartureDate: b.departure_date ?? null,
        customerName: b.customers?.name ?? null,
      };
    }
  }

  const actionCopy = actionDescriptionFor(payload.act);

  const ctx: MagicLinkChatContext = {
    ...bookingCtx,
    actionLabel: actionCopy.title,
    actionType: payload.act,
  };

  return <MagicLinkChat context={ctx} />;
}

function EnterpriseError({ reason }: { reason: 'session_required' | 'mismatch' | 'no_scope' }) {
  const messages: Record<typeof reason, { title: string; body: string }> = {
    session_required: {
      title: '안내 페이지 접근',
      body: '안내 메시지의 링크를 직접 눌러 다시 들어와 주세요. 보안을 위해 시간이 지나면 자동으로 만료됩니다.',
    },
    mismatch: {
      title: '잘못된 접근',
      body: '다른 링크로 들어오신 것 같아요. 받으신 메시지의 링크를 그대로 눌러 주세요.',
    },
    no_scope: {
      title: '채팅 접근 권한 없음',
      body: '이 링크로는 채팅을 사용할 수 없어요. 안내 메시지의 다른 버튼을 사용하시거나 담당자에게 문의해 주세요.',
    },
  };
  const m = messages[reason];

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 text-center">
        <div className="mb-2 text-sm font-medium text-gray-500">여소남</div>
        <h1 className="text-xl font-bold text-gray-900 mb-3">{m.title}</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{m.body}</p>
      </div>
    </main>
  );
}
