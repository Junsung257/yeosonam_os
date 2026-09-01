'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  consentStateToPreferences,
  readConsentState,
  setConsentPreferences,
} from '@/lib/analytics/consent';

export interface InitialConsentPreferences {
  decided: boolean;
  analytics: boolean;
  advertising: boolean;
}

export default function ConsentBanner({
  initialConsent,
}: {
  initialConsent: InitialConsentPreferences;
}) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(!initialConsent.decided);
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(initialConsent.analytics);
  const [advertising, setAdvertising] = useState(initialConsent.advertising);

  useEffect(() => {
    const state = readConsentState();
    if (!state.decided && initialConsent.decided) return;
    const preferences = consentStateToPreferences(state);
    setAnalytics(preferences.analytics);
    setAdvertising(preferences.advertising);
    setVisible(!state.decided);
  }, [initialConsent.decided]);

  if (pathname?.startsWith('/admin') || pathname?.startsWith('/m/admin')) return null;

  const save = (nextAnalytics: boolean, nextAdvertising: boolean) => {
    setConsentPreferences({
      analytics: nextAnalytics,
      advertising: nextAdvertising,
    });
    setAnalytics(nextAnalytics);
    setAdvertising(nextAdvertising);
    setVisible(false);
    setCustomizing(false);
  };

  if (!visible && !customizing) {
    return (
      <button
        type="button"
        onClick={() => setCustomizing(true)}
        aria-label="쿠키 설정 열기"
        className="fixed bottom-4 left-4 z-40 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-md hover:bg-slate-50"
      >
        쿠키 설정
      </button>
    );
  }

  return (
    <>
      {customizing && (
        <button
          type="button"
          aria-label="쿠키 설정 닫기"
          className="fixed inset-0 z-[60] bg-black/30"
          onClick={() => setCustomizing(false)}
        />
      )}
      <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <section
          role="dialog"
          aria-modal={customizing}
          aria-labelledby="consent-title"
          className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        >
          <h2 id="consent-title" className="text-base font-bold text-slate-900">
            분석·광고 쿠키 설정
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            필수 쿠키는 상담·예약 등 서비스 기능에만 사용합니다. 분석 및 광고 쿠키는 선택이며,
            거부해도 사이트를 이용할 수 있습니다. 자세한 내용은{' '}
            <Link href="/privacy" className="font-semibold text-blue-700 underline">
              개인정보처리방침
            </Link>
            에서 확인할 수 있습니다.
          </p>

          {customizing && (
            <div className="mt-4 space-y-3 border-y border-slate-100 py-4">
              <ConsentOption
                title="필수 쿠키"
                description="보안, 세션, 상담·예약 기능에 필요합니다."
                checked
                disabled
              />
              <ConsentOption
                title="분석 쿠키"
                description="방문 및 상품 이용 흐름을 익명 통계로 확인합니다."
                checked={analytics}
                onChange={setAnalytics}
              />
              <ConsentOption
                title="광고 쿠키"
                description="광고 유입과 전환 측정, 맞춤 광고에 사용될 수 있습니다."
                checked={advertising}
                onChange={setAdvertising}
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {!customizing && (
              <button
                type="button"
                onClick={() => setCustomizing(true)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700"
              >
                선택 설정
              </button>
            )}
            <button
              type="button"
              onClick={() => save(false, false)}
              className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200"
            >
              필수만 허용
            </button>
            {customizing ? (
              <button
                type="button"
                onClick={() => save(analytics, advertising)}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                선택 저장
              </button>
            ) : (
              <button
                type="button"
                onClick={() => save(true, true)}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                모두 허용
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function ConsentOption({
  title,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-600">{description}</span>
      </span>
      <input
        type="checkbox"
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onChange={event => onChange?.(event.target.checked)}
        className="mt-1 h-5 w-5 rounded border-slate-300 text-blue-700"
      />
    </label>
  );
}
