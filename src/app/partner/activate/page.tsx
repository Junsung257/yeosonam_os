'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function ActivationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() || '';
  const [step, setStep] = useState<'ready' | 'otp'>('ready');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function requestOtp() {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/partner/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '인증번호를 보낼 수 없습니다.');
      setStep('otp');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '인증번호를 보낼 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!/^\d{6}$/.test(otp)) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/partner/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, otp }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '계정을 활성화할 수 없습니다.');
      router.replace('/partner');
      router.refresh();
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : '계정을 활성화할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <section className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold text-amber-700">초대 링크를 확인해 주세요</p>
        <h1 className="mt-2 text-2xl font-black">활성화 정보가 없습니다</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">승인 안내에 포함된 파트너 활성화 링크를 다시 열어 주세요.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">계정 활성화</span>
      <h1 className="mt-4 text-2xl font-black">본인 확인 후 바로 시작하세요</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        링크만 열어서는 계정이 활성화되지 않습니다. 등록된 휴대폰으로 받은 6자리 인증번호를 확인해 주세요.
      </p>

      {step === 'ready' ? (
        <button
          type="button"
          onClick={requestOtp}
          disabled={busy}
          className="mt-6 min-h-12 w-full rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '보내는 중...' : '인증번호 받기'}
        </button>
      ) : (
        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="partner-otp" className="text-sm font-bold text-slate-700">인증번호 6자리</label>
            <input
              id="partner-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={event => setOtp(event.target.value.replace(/\D/g, ''))}
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-center text-xl font-black tracking-[0.35em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            type="button"
            onClick={activate}
            disabled={busy || otp.length !== 6}
            className="min-h-12 w-full rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '확인 중...' : '계정 활성화'}
          </button>
          <button type="button" onClick={requestOtp} disabled={busy} className="min-h-11 w-full text-sm font-semibold text-slate-600">
            인증번호 다시 받기
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <p className="mt-6 text-xs leading-5 text-slate-500">초대 링크는 발급 후 30분, 인증번호는 발송 후 5분 동안 유효합니다.</p>
    </section>
  );
}

export default function PartnerActivatePage() {
  return (
    <Suspense fallback={<div className="mx-auto h-72 max-w-md animate-pulse rounded-2xl bg-slate-200" />}>
      <ActivationForm />
    </Suspense>
  );
}

