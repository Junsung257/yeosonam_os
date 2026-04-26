'use client';

/**
 * PIPA(2026-09 개정) + GDPR 호환 동의 배너.
 *
 * 두 카테고리:
 *   - analytics: 자체 트래커, GA, PostHog (체류시간/스크롤)
 *   - marketing: Meta Pixel, gclid/fbclid, 어필리에이트 30일 쿠키(aff_ref)
 *
 * 미동의 시:
 *   - aff_ref 가 30분 세션 쿠키로만 발급 → 어필리에이터 어트리뷰션 윈도우 매우 짧음
 *   - 동의 시 30일 (여행업 리드타임 대응)
 *
 * 표시 조건: localStorage에 동의/거부 결정이 한 번도 없을 때만 표시.
 * 한 번 결정 후에는 사용자가 우측 하단 ⚙️ 버튼으로 재설정 가능.
 */

import { useEffect, useState } from 'react';
import {
  hasAnalyticsConsent,
  hasMarketingConsent,
  setAnalyticsConsent,
  setMarketingConsent,
} from '@/lib/consent';

const DECIDED_KEY = 'ys_consent_decided';

export default function ConsentBanner() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(true);
  const [marketingOn, setMarketingOn] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const decided = localStorage.getItem(DECIDED_KEY);
      if (!decided) {
        setShow(true);
      }
      setAnalyticsOn(hasAnalyticsConsent());
      setMarketingOn(hasMarketingConsent());
    } catch { /* */ }
  }, []);

  const finalize = (analytics: boolean, marketing: boolean) => {
    setAnalyticsConsent(analytics);
    setMarketingConsent(marketing);
    try { localStorage.setItem(DECIDED_KEY, '1'); } catch { /* */ }
    setShow(false);
    setOpen(false);
  };

  const acceptAll = () => finalize(true, true);
  const rejectAll = () => finalize(false, false);
  const saveCustom = () => finalize(analyticsOn, marketingOn);

  // 우측 하단 재설정 버튼 (배너 닫힌 후에도 항상 노출)
  if (!show && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="쿠키 동의 설정"
        className="fixed bottom-4 left-4 z-40 w-9 h-9 rounded-full bg-white border border-gray-200 shadow-md text-gray-500 hover:text-gray-900 hover:border-gray-300 transition-colors flex items-center justify-center text-sm"
      >
        🍪
      </button>
    );
  }

  return (
    <>
      {/* 백드롭 (open=true: 상세 설정 모달) */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* 배너 */}
      <div className="fixed bottom-0 inset-x-0 z-[70] flex justify-center px-3 pb-3 sm:pb-4">
        <div
          className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🍪</span>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-gray-900 text-sm">쿠키 사용 동의 (PIPA)</h2>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  더 나은 서비스를 위해 쿠키를 사용합니다. 마케팅 쿠키 동의 시 추천 링크를 30일간 추적하여 정상적인 어필리에이트 정산이 가능합니다. 미동의 시에도 핵심 기능은 정상 작동합니다.
                </p>
              </div>
            </div>

            {open && (
              <div className="mt-4 space-y-2.5 border-t border-gray-100 pt-4">
                {/* 필수 */}
                <ConsentRow
                  title="필수"
                  desc="로그인·예약·세션 유지 (거부 불가)"
                  checked={true}
                  disabled
                />
                {/* 분석 */}
                <ConsentRow
                  title="분석"
                  desc="체류시간·스크롤 등 비식별 통계 (자체 트래커)"
                  checked={analyticsOn}
                  onChange={setAnalyticsOn}
                />
                {/* 마케팅 */}
                <ConsentRow
                  title="마케팅 (어필리에이트)"
                  desc="Meta Pixel · 추천 링크 30일 쿠키. 미동의 시 30분 세션 쿠키만 발급됩니다."
                  checked={marketingOn}
                  onChange={setMarketingOn}
                />
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 justify-end">
              {!open ? (
                <>
                  <button
                    onClick={() => setOpen(true)}
                    className="px-3 py-2 text-xs text-gray-600 hover:text-gray-900 font-medium"
                  >
                    상세 설정
                  </button>
                  <button
                    onClick={rejectAll}
                    className="px-3 py-2 text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"
                  >
                    필수만 허용
                  </button>
                  <button
                    onClick={acceptAll}
                    className="px-4 py-2 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-bold"
                  >
                    모두 동의
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setOpen(false)}
                    className="px-3 py-2 text-xs text-gray-600 hover:text-gray-900 font-medium"
                  >
                    취소
                  </button>
                  <button
                    onClick={saveCustom}
                    className="px-4 py-2 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-bold"
                  >
                    선택 저장
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ConsentRow({
  title,
  desc,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <button
        type="button"
        onClick={() => !disabled && onChange?.(!checked)}
        disabled={disabled}
        aria-pressed={checked}
        className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors relative ${
          disabled ? 'bg-gray-300' : checked ? 'bg-blue-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-4' : 'left-0.5'
          }`}
        />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-gray-800">
          {title}
          {disabled && <span className="ml-1.5 text-[10px] text-gray-400 font-normal">필수</span>}
        </p>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
