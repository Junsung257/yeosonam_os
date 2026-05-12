/**
 * 일정 변경 동의 페이지 — `/m/consent/[token]`.
 *
 * 동작:
 *   1. magic-session 검증 + scope='consent:sign' 강제
 *   2. token.metadata 의 변경 사항(diff) 표시
 *   3. 사용자가 "동의" / "거절" 버튼 클릭 → POST /api/m/consent/[token]
 *   4. API 가 consumeMagicToken + decision 기록 + 확정 페이지 redirect
 *
 * 메타 데이터 스키마(어드민이 mint 시 채움):
 *   {
 *     changeReason: '항공편 시간 변경',
 *     summary: '인천 출발 시간 09:00 → 10:30 (90분 지연)',
 *     details: [ '...', '...' ],  // 선택, 추가 설명
 *     deadline: '2026-05-20',     // 선택
 *   }
 */

import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '일정 변경 동의',
  robots: { index: false, follow: false },
};

type PageParams = { params: Promise<{ token: string }> };

interface ConsentMetadata {
  changeReason?: string;
  summary?: string;
  details?: string[];
  deadline?: string;
}

interface DecisionRow {
  metadata: Record<string, unknown> | null;
  used_at: string | null;
  confirmed_at: string | null;
}

export default async function ConsentPage({ params }: PageParams) {
  const { token: tokenIdFromUrl } = await params;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok) return <NotAllowed reason="session_required" />;
  if (session.payload.aid !== tokenIdFromUrl) return <NotAllowed reason="mismatch" />;
  if (!session.payload.scope.includes('consent:sign')) {
    return <NotAllowed reason="no_scope" />;
  }
  if (session.payload.act !== 'itinerary_consent') {
    return <NotAllowed reason="wrong_action" />;
  }

  // 토큰 메타 + 사용 여부 로드
  const { data } = await supabaseAdmin
    .from('magic_action_tokens')
    .select('metadata, used_at, confirmed_at')
    .eq('id', tokenIdFromUrl)
    .limit(1);
  const row = (data?.[0] as DecisionRow | undefined) ?? null;
  if (!row) return <NotAllowed reason="not_found" />;

  const meta: ConsentMetadata = (row.metadata ?? {}) as ConsentMetadata;
  const previousDecision = readDecision(row.metadata);

  // 이미 결정 완료
  if (previousDecision) {
    return <Resolved decision={previousDecision} summary={meta.summary} />;
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-6">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="text-xs text-gray-500 mb-1">여소남</div>
        <h1 className="text-xl font-bold text-gray-900">일정 변경 안내</h1>
      </header>

      <section className="bg-white mt-2 px-4 py-5">
        <div className="text-xs text-gray-500 mb-1">변경 사유</div>
        <div className="text-base font-semibold text-gray-900 mb-4">
          {meta.changeReason ?? '여행 일정 일부 조정'}
        </div>

        <div className="text-xs text-gray-500 mb-1">변경 내용</div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
          {meta.summary ?? '상세 변경 사항이 표시되지 않았어요. 담당자에게 확인 부탁드려요.'}
        </div>

        {meta.details && meta.details.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm text-gray-700">
            {meta.details.map((d, i) => (
              <li key={i} className="pl-3 border-l-2 border-gray-200">
                {d}
              </li>
            ))}
          </ul>
        )}

        {meta.deadline && (
          <p className="text-xs text-gray-500 mt-4">
            동의 회신 마감: <span className="font-medium text-gray-700">{meta.deadline}</span>
          </p>
        )}
      </section>

      <section className="mt-4 px-4 space-y-3">
        <form method="POST" action={`/api/m/consent/${encodeURIComponent(tokenIdFromUrl)}`}>
          <input type="hidden" name="decision" value="accepted" />
          <button
            type="submit"
            className="w-full bg-gray-900 text-white rounded-2xl py-4 font-semibold text-base hover:bg-gray-800"
          >
            변경 내용에 동의합니다
          </button>
        </form>

        <form method="POST" action={`/api/m/consent/${encodeURIComponent(tokenIdFromUrl)}`}>
          <input type="hidden" name="decision" value="declined" />
          <button
            type="submit"
            className="w-full bg-white text-gray-900 border border-gray-300 rounded-2xl py-4 font-semibold text-base hover:bg-gray-50"
          >
            동의하지 않습니다 (담당자와 협의)
          </button>
        </form>

        <p className="text-[11px] text-gray-500 leading-relaxed text-center px-2">
          동의 시 변경 내용에 따라 일정이 적용됩니다. 거절하시면 담당자가 카카오톡으로 별도 안내드릴게요.
          본 동의 기록은 일정·법적 증빙 용도로 보관됩니다.
        </p>
      </section>
    </main>
  );
}

function readDecision(meta: Record<string, unknown> | null): 'accepted' | 'declined' | null {
  const v = meta?.decision;
  if (v === 'accepted' || v === 'declined') return v;
  return null;
}

function Resolved({
  decision,
  summary,
}: {
  decision: 'accepted' | 'declined';
  summary?: string;
}) {
  const isAccept = decision === 'accepted';
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 text-center">
        <div className="text-3xl mb-3" aria-hidden>
          {isAccept ? '✓' : '!'}
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {isAccept ? '동의가 접수되었습니다' : '거절 의사가 접수되었습니다'}
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          {isAccept
            ? '변경 내용에 따라 일정이 적용될 예정이에요. 추가 안내가 있으면 카카오톡으로 알려 드릴게요.'
            : '담당자가 곧 연락드려서 다음 단계를 안내해 드릴 예정이에요.'}
        </p>
        {summary && (
          <p className="text-xs text-gray-400 mt-4 leading-relaxed">
            접수된 변경 내용: {summary}
          </p>
        )}
      </div>
    </main>
  );
}

function NotAllowed({
  reason,
}: {
  reason: 'session_required' | 'mismatch' | 'no_scope' | 'wrong_action' | 'not_found';
}) {
  const messages: Record<typeof reason, string> = {
    session_required: '안내 메시지의 링크를 다시 눌러 주세요.',
    mismatch: '다른 안내 링크로 들어오신 것 같아요. 받으신 링크를 그대로 사용해 주세요.',
    no_scope: '이 링크로는 동의 페이지에 접근할 수 없어요.',
    wrong_action: '이 링크는 일정 동의 용이 아니에요. 받으신 다른 링크를 확인해 주세요.',
    not_found: '안내 정보를 찾을 수 없어요. 담당자에게 문의해 주세요.',
  };
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 text-center">
        <div className="text-sm text-gray-500 mb-2">여소남</div>
        <h1 className="text-xl font-bold text-gray-900 mb-3">접근할 수 없어요</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{messages[reason]}</p>
      </div>
    </main>
  );
}
