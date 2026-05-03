'use client';

import { useEffect, useState } from 'react';

interface BookingInfo {
  departure_date: string | null;
  product_title: string | null;
}

interface PageProps {
  params: { token: string };
}

export default function CompanionOnboardingPage({ params }: PageProps) {
  const { token } = params;

  const [bookingInfo, setBookingInfo] = useState<BookingInfo | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // 폼 필드
  const [name, setName] = useState('');
  const [passportName, setPassportName] = useState('');
  const [passportNo, setPassportNo] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    fetch(`/api/join/${token}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setLoadError(json.error ?? '링크가 유효하지 않습니다.');
          return;
        }
        setAlreadySubmitted(json.alreadySubmitted ?? false);
        setBookingInfo(json.booking ?? null);
      })
      .catch(() => setLoadError('서버에 연결할 수 없습니다.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/join/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          passport_name: passportName,
          passport_no: passportNo,
          birth_date: birthDate,
          phone,
          ...(email ? { email } : {}),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error ?? '제출에 실패했습니다.');
        return;
      }

      setDone(true);
    } catch {
      setSubmitError('서버에 연결할 수 없습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── 로딩 중 ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">로딩 중...</p>
      </div>
    );
  }

  // ── 링크 오류 ────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-2xl mb-2">⚠️</p>
          <p className="text-gray-700 font-medium">{loadError}</p>
          <p className="text-gray-500 text-sm mt-2">초대 링크를 다시 확인해주세요.</p>
        </div>
      </div>
    );
  }

  // ── 이미 제출됨 ──────────────────────────────────────────────
  if (alreadySubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-gray-800 font-semibold text-lg">이미 정보를 제출하셨습니다.</p>
          <p className="text-gray-500 text-sm mt-2">중복 제출은 불가합니다. 수정이 필요하면 예약 담당자에게 문의해주세요.</p>
        </div>
      </div>
    );
  }

  // ── 제출 완료 ────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-5xl mb-4">🎉</p>
          <p className="text-gray-800 font-bold text-xl">입력 완료!</p>
          <p className="text-gray-500 text-sm mt-2">
            여권 정보가 안전하게 저장되었습니다.
            <br />
            여행 출발 전까지 변경이 필요하면 담당자에게 연락해주세요.
          </p>
        </div>
      </div>
    );
  }

  // ── 메인 폼 ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        {/* 헤더 */}
        <div className="mb-6 text-center">
          <p className="text-xs text-gray-400 mb-1">여소남 동행자 정보 입력</p>
          {bookingInfo?.product_title && (
            <p className="text-gray-800 font-semibold text-base">{bookingInfo.product_title}</p>
          )}
          {bookingInfo?.departure_date && (
            <p className="text-gray-500 text-sm mt-0.5">
              출발일: {bookingInfo.departure_date}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 한글 이름 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              한글 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 여권 영문 이름 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              여권 영문 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={passportName}
              onChange={(e) => setPassportName(e.target.value.toUpperCase())}
              placeholder="HONG GILDONG"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
            />
            <p className="text-xs text-gray-400 mt-1">여권에 기재된 영문 이름 그대로 입력 (성+이름)</p>
          </div>

          {/* 여권 번호 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              여권 번호 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={passportNo}
              onChange={(e) => setPassportNo(e.target.value.toUpperCase())}
              placeholder="M12345678"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
            />
          </div>

          {/* 생년월일 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              생년월일 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 전화번호 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              전화번호 <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-0000-0000"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 이메일 (선택) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              이메일 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 에러 메시지 */}
          {submitError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>
          )}

          {/* 제출 버튼 */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white rounded-lg py-3 font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? '저장 중...' : '정보 제출하기'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          입력하신 정보는 항공·비자 수속 목적으로만 사용됩니다.
        </p>
      </div>
    </div>
  );
}
