/**
 * 동반자 fan-out 입력 페이지 — `/m/companion/[token]`.
 *
 * 시나리오: 대표 예약자가 동반자별 매직링크를 보냄 (action_type='companion_input').
 * 각 동반자는 자기 정보를 직접 입력. 정보는 magic_action_tokens.metadata.companion_profile 에 저장.
 * 어드민이 어드민 UI 에서 검토 후 bookings 에 반영 (S1 시점에는 검토 UI 도 dev 사이드).
 *
 * 토큰 metadata 스키마 (어드민 mint 시):
 *   {
 *     leadCustomerName: '홍길동',
 *     companionRole: 'spouse' | 'child' | 'parent' | 'friend' | 'other',
 *     bookingNo: 'YS-2026-...',
 *   }
 */

import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '동반자 정보 등록',
  robots: { index: false, follow: false },
};

type PageParams = { params: Promise<{ token?: string | string[] }> };

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

interface CompanionMetadata {
  leadCustomerName?: string;
  companionRole?: 'spouse' | 'child' | 'parent' | 'friend' | 'other';
  bookingNo?: string;
  companion_profile?: SubmittedProfile;
}

interface SubmittedProfile {
  name_ko: string;
  name_en?: string;
  birth_date?: string;
  phone?: string;
  notes?: string;
  submitted_at: string;
}

const ROLE_LABELS: Record<NonNullable<CompanionMetadata['companionRole']>, string> = {
  spouse: '배우자',
  child: '자녀',
  parent: '부모님',
  friend: '동반자',
  other: '동반자',
};

export default async function CompanionPage({ params }: PageParams) {
  const { token: rawToken } = await params;
  const tokenIdFromUrl = getRouteParam(rawToken);
  if (!tokenIdFromUrl) return <Err msg="안내 메시지의 링크를 다시 열어 주세요." />;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok) return <Err msg="안내 메시지의 링크를 다시 눌러 주세요." />;
  if (session.payload.aid !== tokenIdFromUrl) return <Err msg="다른 안내 링크로 접근하셨어요." />;
  if (!session.payload.scope.includes('companion:input')) return <Err msg="이 링크로는 동반자 정보를 입력할 수 없어요." />;
  if (session.payload.act !== 'companion_input') return <Err msg="이 링크는 동반자 입력용이 아니에요." />;

  const { data } = await supabaseAdmin
    .from('magic_action_tokens')
    .select('metadata, used_at')
    .eq('id', tokenIdFromUrl)
    .limit(1);
  const row = data?.[0] as { metadata: Record<string, unknown> | null; used_at: string | null } | undefined;
  if (!row) return <Err msg="안내 정보를 찾을 수 없어요." />;

  const meta = (row.metadata ?? {}) as CompanionMetadata;
  const submitted = meta.companion_profile;

  if (submitted) {
    return <Submitted profile={submitted} role={meta.companionRole} />;
  }

  const roleLabel = meta.companionRole ? ROLE_LABELS[meta.companionRole] : '동반자';
  const leadName = meta.leadCustomerName ?? '대표 예약자님';

  return (
    <main className="min-h-screen bg-gray-50 pb-6">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="text-xs text-gray-500 mb-1">여소남</div>
        <h1 className="text-xl font-bold text-gray-900">{roleLabel} 정보 등록</h1>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          {leadName}의 예약에 함께하실 분의 정보를 입력해 주세요.
          {meta.bookingNo && <> (예약번호 {meta.bookingNo})</>}
        </p>
      </header>

      <form
        method="POST"
        action={`/api/m/companion/${encodeURIComponent(tokenIdFromUrl)}`}
        className="mt-2 bg-white px-4 py-5 space-y-4"
      >
        <Field
          label="이름 (한글)"
          name="name_ko"
          placeholder="예) 홍길동"
          required
          autoComplete="name"
        />
        <Field
          label="영문 이름 (여권과 동일하게)"
          name="name_en"
          placeholder="예) HONG GIL DONG"
          required={false}
          autoComplete="off"
          uppercase
        />
        <Field
          label="생년월일"
          name="birth_date"
          type="date"
          required={false}
        />
        <Field
          label="휴대폰 번호"
          name="phone"
          type="tel"
          placeholder="010-0000-0000"
          required={false}
          autoComplete="tel"
        />

        <div>
          <label className="block text-xs text-gray-600 mb-1.5" htmlFor="notes">
            특이사항 (알레르기·동행 인원·요청 사항 등 — 선택)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            placeholder="알레르기, 식이 제한, 거동 불편 여부 등"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-gray-900 text-white rounded-2xl py-4 font-semibold text-base hover:bg-gray-800 mt-2"
        >
          정보 제출하기
        </button>

        <p className="text-[11px] text-gray-500 leading-relaxed">
          입력하신 정보는 항공권 발권·여행 준비 외 용도로 사용되지 않으며,
          여행 종료 후 일정 기간 후 자동 파기됩니다.
        </p>
      </form>
    </main>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  uppercase?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1.5" htmlFor={props.name}>
        {props.label}
        {props.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? 'text'}
        required={props.required}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        className={`w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 ${props.uppercase ? 'uppercase' : ''}`}
      />
    </div>
  );
}

function Submitted({
  profile,
  role,
}: {
  profile: SubmittedProfile;
  role?: CompanionMetadata['companionRole'];
}) {
  const roleLabel = role ? ROLE_LABELS[role] : '동반자';
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 text-center">
        <div className="text-3xl mb-3" aria-hidden>
          ✓
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">제출이 완료되었어요</h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">
          {roleLabel} 정보가 담당자에게 전달되었어요. 추가 안내가 있으면 카카오톡으로 알려 드릴게요.
        </p>
        <div className="text-left text-xs text-gray-500 space-y-1 bg-gray-50 rounded-lg p-3">
          <div>이름 (한글): {profile.name_ko}</div>
          {profile.name_en && <div>영문 이름: {profile.name_en}</div>}
          {profile.birth_date && <div>생년월일: {profile.birth_date}</div>}
          {profile.phone && <div>휴대폰: {profile.phone}</div>}
          <div className="mt-2 text-[10px] text-gray-400">제출 시각 {profile.submitted_at}</div>
        </div>
      </div>
    </main>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-6 text-center">
        <div className="text-sm text-gray-500 mb-2">여소남</div>
        <h1 className="text-xl font-bold text-gray-900 mb-3">접근할 수 없어요</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{msg}</p>
      </div>
    </main>
  );
}
