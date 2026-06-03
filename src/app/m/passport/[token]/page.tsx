/**
 * 여권 정보 등록 페이지 — `/m/passport/[token]`.
 *
 * 동작:
 *   1. magic-session 검증 + scope='passport:upload'
 *   2. 영문 이름 (Last, First) + 여권번호 + 만료일 + 여권 사본 1장
 *   3. 사진 → customer-uploads/passport_upload/<tokenId>/
 *   4. 여권번호는 AES-GCM 암호화 후 metadata.passport.encrypted 저장 (평문 X)
 *   5. single_use=true 토큰 → 한 번 제출 후 잠금
 *
 * OCR 자동화는 별도 모듈 (CLOVA OCR 등 wire 후 활성화).
 */

import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import type { Metadata } from 'next';
import { fmtDateTime } from '@/lib/admin-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '여권 정보 등록',
  robots: { index: false, follow: false },
};

type PageParams = { params: Promise<{ token?: string | string[] }> };

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

interface PassportMeta {
  surname?: string;
  given_names?: string;
  // 여권번호는 평문 미저장 — encrypted_no 만
  passport_no_last4?: string;     // 마스킹 표시용 마지막 4자리
  expiry_date?: string;
  scan?: { path: string; size: number; contentType: string };
  submitted_at?: string;
}

export default async function PassportPage({ params }: PageParams) {
  const { token: rawToken } = await params;
  const tokenIdFromUrl = getRouteParam(rawToken);
  if (!tokenIdFromUrl) return <Err msg="안내 메시지의 링크를 다시 열어 주세요." />;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok) return <Err msg="안내 메시지의 링크를 다시 눌러 주세요." />;
  if (session.payload.aid !== tokenIdFromUrl) return <Err msg="다른 안내 링크로 접근하셨어요." />;
  if (!session.payload.scope.includes('passport:upload')) return <Err msg="이 링크로는 여권 정보를 등록할 수 없어요." />;
  if (session.payload.act !== 'passport_upload') return <Err msg="이 링크는 여권 등록용이 아니에요." />;

  const { data } = await supabaseAdmin
    .from('magic_action_tokens')
    .select('metadata, used_at')
    .eq('id', tokenIdFromUrl)
    .limit(1);
  const row = data?.[0] as { metadata: Record<string, unknown> | null; used_at: string | null } | undefined;
  if (!row) return <Err msg="안내 정보를 찾을 수 없어요." />;

  const passport = (row.metadata?.passport ?? {}) as PassportMeta;
  if (passport.submitted_at && row.used_at) {
    return <Submitted info={passport} />;
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-6">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="text-xs text-gray-500 mb-1">여소남</div>
        <h1 className="text-xl font-bold text-gray-900">여권 정보 등록</h1>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          출입국 신고에 필요한 정보입니다. 입력 정보는 암호화되어 보관되며 출국 후 일정 기간 후 자동 파기돼요.
        </p>
      </header>

      <form
        method="POST"
        action={`/api/m/passport/${encodeURIComponent(tokenIdFromUrl)}`}
        encType="multipart/form-data"
        className="mt-2 bg-white px-4 py-5 space-y-4"
      >
        <Field
          label="성 (Last name, 영문 대문자)"
          name="surname"
          placeholder="HONG"
          required
          uppercase
          maxLength={40}
        />
        <Field
          label="이름 (Given names, 영문 대문자)"
          name="given_names"
          placeholder="GIL DONG"
          required
          uppercase
          maxLength={60}
        />
        <Field
          label="여권번호"
          name="passport_no"
          placeholder="M12345678"
          required
          uppercase
          maxLength={20}
          help="입력하신 여권번호는 즉시 암호화되어 저장됩니다."
        />
        <Field
          label="여권 만료일"
          name="expiry_date"
          type="date"
          required
        />

        <div>
          <label htmlFor="scan" className="block text-xs text-gray-600 mb-1.5">
            여권 사본 (인적사항 페이지) <span className="text-red-500">*</span>
          </label>
          <input
            id="scan"
            name="scan"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            required
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-900 file:text-white file:font-semibold"
          />
          <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            여권 인적사항면 (이름·여권번호·사진이 있는 면) 만 촬영해 주세요. 다른 페이지는 업로드하지 마세요.
          </p>
        </div>

        <button
          type="submit"
          className="w-full bg-gray-900 text-white rounded-2xl py-4 font-semibold text-base hover:bg-gray-800"
        >
          여권 정보 제출하기
        </button>

        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 leading-relaxed">
          ⚠ 이 페이지에서만 여권 정보를 입력해 주세요. 자비스 채팅이나 일반 카카오톡에 여권번호·사진을 입력·전송하지 마세요.
        </div>
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
  uppercase?: boolean;
  maxLength?: number;
  help?: string;
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
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        className={`w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 ${props.uppercase ? 'uppercase tracking-wide' : ''}`}
      />
      {props.help && <p className="text-[11px] text-gray-500 mt-1">{props.help}</p>}
    </div>
  );
}

function Submitted({ info }: { info: PassportMeta }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-6 sm:p-8">
        <div className="text-3xl mb-3 text-center" aria-hidden>
          ✓
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2 text-center">제출 완료</h1>
        <p className="text-sm text-gray-600 leading-relaxed text-center mb-4">
          여권 정보가 안전하게 보관되었어요.
        </p>
        <dl className="text-xs text-gray-500 space-y-1.5 bg-gray-50 rounded-lg p-3">
          <div>
            <dt className="inline">영문 이름: </dt>
            <dd className="inline font-medium text-gray-700">{info.surname ?? '—'}, {info.given_names ?? '—'}</dd>
          </div>
          <div>
            <dt className="inline">여권번호: </dt>
            <dd className="inline font-medium text-gray-700">
              {info.passport_no_last4 ? `********${info.passport_no_last4}` : '—'} (암호화 저장)
            </dd>
          </div>
          <div>
            <dt className="inline">만료일: </dt>
            <dd className="inline font-medium text-gray-700">{info.expiry_date ?? '—'}</dd>
          </div>
          <div className="text-[10px] text-gray-400 mt-2">
            제출 시각 {info.submitted_at ? fmtDateTime(info.submitted_at) : '—'}
          </div>
        </dl>
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
