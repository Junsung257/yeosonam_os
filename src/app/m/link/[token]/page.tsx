/**
 * 매직링크 POST-confirm 착지 페이지 (S1)
 *
 * 동작:
 *   1. GET 으로 진입 — 토큰을 verify (read-only, 소진 X)
 *   2. SafeLinks/Slackbot/Gmail prefetch 가 토큰을 burn 시키지 못함
 *   3. 사용자가 "확인" 버튼 클릭 → POST /api/m/[token]/confirm
 *      → confirmed_at 기록 + magic-session 쿠키 발급 + 액션 페이지 302
 *
 * 만료/사용됨/폐기 상태는 각각 다른 메시지 + 재발급 안내.
 */

import { verifyMagicToken } from '@/lib/magic-link';
import { actionDescriptionFor } from '@/lib/magic-link-routing';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '여소남 안내 페이지',
  // 검색엔진·SafeLinks 가 토큰 URL 을 인덱싱 못하게
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
};

type PageParams = { params: Promise<{ token?: string | string[] }> };

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export default async function MagicLinkLandingPage({ params }: PageParams) {
  const { token: rawToken } = await params;
  const token = getRouteParam(rawToken);
  if (!token) {
    return <ErrorView reason="not_found" />;
  }

  const result = await verifyMagicToken(token);

  if (!result.ok) {
    return <ErrorView reason={result.reason} />;
  }

  const t = result.token;
  const copy = actionDescriptionFor(t.actionType);

  // 이미 confirm 된 토큰 — 곧바로 다음 단계 안내 (멱등)
  // single_use 인데 used_at 있으면 verifyMagicToken 에서 'used' 반환되므로 여기 안 옴.

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
        <div className="mb-2 text-sm font-medium text-gray-500">여소남</div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">{copy.title}</h1>
        <p className="text-sm sm:text-base text-gray-600 leading-relaxed mb-6">
          {copy.description}
        </p>

        <form method="POST" action={`/api/m/${encodeURIComponent(token)}/confirm`}>
          <button
            type="submit"
            className="w-full bg-gray-900 text-white rounded-xl py-3.5 font-semibold text-base hover:bg-gray-800 active:bg-black transition-colors"
          >
            {copy.cta}
          </button>
        </form>

        <p className="text-xs text-gray-400 mt-6 leading-relaxed">
          본인 확인을 위해 "확인" 버튼을 눌러 주세요. 링크는 일정 시간 후 자동으로 만료됩니다.
          만료된 경우 안내 메시지에 적힌 번호로 연락 주시면 재발급해 드립니다.
        </p>
      </div>
    </main>
  );
}

function ErrorView({ reason }: { reason: 'not_found' | 'expired' | 'revoked' | 'used' | 'requires_confirm' }) {
  const messages: Record<typeof reason, { title: string; body: string }> = {
    not_found: {
      title: '잘못된 링크입니다',
      body: '링크가 변조되었거나 존재하지 않습니다. 메시지에 있는 링크를 그대로 눌러 주세요.',
    },
    expired: {
      title: '링크가 만료되었습니다',
      body: '안전을 위해 일정 시간 후 자동 만료됩니다. 새 링크가 필요하시면 담당자에게 연락 주세요.',
    },
    revoked: {
      title: '사용 중지된 링크입니다',
      body: '이 링크는 더 이상 사용할 수 없도록 처리되었습니다. 자세한 사항은 담당자에게 문의해 주세요.',
    },
    used: {
      title: '이미 사용된 링크입니다',
      body: '이 링크는 1회용으로 이미 사용되었습니다. 추가 작업이 필요하시면 담당자에게 문의해 주세요.',
    },
    requires_confirm: {
      title: '확인이 필요합니다',
      body: '링크의 본문 페이지로 이동해 확인 버튼을 눌러 주세요.',
    },
  };
  const msg = messages[reason];

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 text-center">
        <div className="mb-2 text-sm font-medium text-gray-500">여소남</div>
        <h1 className="text-xl font-bold text-gray-900 mb-3">{msg.title}</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{msg.body}</p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="mt-6 inline-block text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
        >
          홈으로 이동
        </a>
      </div>
    </main>
  );
}
