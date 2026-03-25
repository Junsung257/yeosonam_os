'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, Users, Calendar, Check } from 'lucide-react';
import type { LeadFormData } from '@/lib/submitPipeline';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: LeadFormData) => Promise<void>;
  defaultDate?: string;
}

const TOTAL_STEPS = 3;

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export default function LeadBottomSheet({ open, onClose, onSubmit, defaultDate = '' }: Props) {
  const [step, setStep] = useState(0);          // 0-indexed
  const [desiredDate, setDesiredDate] = useState(defaultDate);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // 열릴 때마다 초기화
  useEffect(() => {
    if (open) {
      setStep(0);
      setDesiredDate(defaultDate);
      setAdults(2);
      setChildren(0);
      setName('');
      setPhone('');
      setPrivacy(false);
      setSubmitting(false);
      setSuccess(false);
    }
  }, [open, defaultDate]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // body scroll lock
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const canNext = useCallback(() => {
    if (step === 0) return !!desiredDate;
    if (step === 1) return adults >= 1;
    if (step === 2) return name.trim().length >= 2 && phone.replace(/\D/g, '').length === 11 && privacy;
    return false;
  }, [step, desiredDate, adults, phone, name, privacy]);

  const handleNext = async () => {
    if (!canNext()) return;
    if (step < TOTAL_STEPS - 1) {
      setStep(s => s + 1);
    } else {
      setSubmitting(true);
      try {
        await onSubmit({
          desiredDate,
          adults,
          children,
          name: name.trim(),
          phone,
          privacyConsent: privacy,
        });
        setSuccess(true);
      } catch {
        // 에러는 onSubmit 내부에서 처리 (pipeline은 실패해도 진행)
        setSuccess(true);
      } finally {
        setSubmitting(false);
      }
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl shadow-2xl max-h-[90dvh] md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md md:rounded-2xl">
        {/* Handle bar (모바일) */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <button
            onClick={() => step > 0 ? setStep(s => s - 1) : onClose()}
            className="p-1 rounded-full hover:bg-gray-100 transition"
            aria-label="뒤로"
          >
            {step > 0 ? <ChevronLeft size={20} /> : <X size={20} />}
          </button>
          <div className="text-sm font-semibold text-gray-700">
            {success ? '신청 완료' : `상담 신청 (${step + 1}/${TOTAL_STEPS})`}
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 transition">
            <X size={20} />
          </button>
        </div>

        {/* Progress bar */}
        {!success && (
          <div className="h-1 bg-gray-100">
            <div
              className="h-1 bg-yellow-400 transition-all duration-300"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {success ? (
            <SuccessView onClose={onClose} />
          ) : (
            <div
              className="flex transition-transform duration-300 ease-in-out h-full"
              style={{ transform: `translateX(-${(step / TOTAL_STEPS) * 100}%)`, width: `${TOTAL_STEPS * 100}%` }}
            >
              {/* Step 1: 희망 출발일 */}
              <StepWrapper>
                <StepIcon icon={<Calendar size={28} className="text-yellow-500" />} />
                <h2 className="text-lg font-bold text-gray-900 text-center">희망 출발일을 선택해주세요</h2>
                <p className="text-sm text-gray-500 text-center">일정 조율을 위해 필요해요</p>
                <input
                  type="date"
                  value={desiredDate}
                  onChange={e => setDesiredDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-yellow-400 transition text-center"
                />
              </StepWrapper>

              {/* Step 2: 인원 선택 */}
              <StepWrapper>
                <StepIcon icon={<Users size={28} className="text-yellow-500" />} />
                <h2 className="text-lg font-bold text-gray-900 text-center">인원을 알려주세요</h2>
                <p className="text-sm text-gray-500 text-center">정확한 견적을 드릴게요</p>
                <CounterRow
                  label="성인"
                  subLabel="만 12세 이상"
                  value={adults}
                  onMinus={() => setAdults(v => Math.max(1, v - 1))}
                  onPlus={() => setAdults(v => v + 1)}
                />
                <CounterRow
                  label="소아"
                  subLabel="만 2-11세"
                  value={children}
                  onMinus={() => setChildren(v => Math.max(0, v - 1))}
                  onPlus={() => setChildren(v => v + 1)}
                />
              </StepWrapper>

              {/* Step 3: 이름/전화번호 */}
              <StepWrapper>
                <h2 className="text-lg font-bold text-gray-900 text-center">연락처를 알려주세요</h2>
                <p className="text-sm text-gray-500 text-center">상담사가 빠르게 연락드릴게요</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="홍길동"
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-yellow-400 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">휴대폰 번호</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(formatPhone(e.target.value))}
                      placeholder="010-0000-0000"
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-yellow-400 transition"
                    />
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <div
                      onClick={() => setPrivacy(v => !v)}
                      className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition ${
                        privacy ? 'bg-yellow-400 border-yellow-400' : 'border-gray-300'
                      }`}
                    >
                      {privacy && <Check size={12} className="text-white" strokeWidth={3} />}
                    </div>
                    <span className="text-sm text-gray-600 leading-snug">
                      <span className="font-medium text-gray-800">[필수]</span> 개인정보 수집 및 이용에 동의합니다.
                      수집된 정보는 여행 상담 목적으로만 사용되며, 상담 완료 후 즉시 파기됩니다.
                    </span>
                  </label>
                </div>
              </StepWrapper>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        {!success && (
          <div className="px-5 py-4 border-t border-gray-100">
            <button
              onClick={handleNext}
              disabled={!canNext() || submitting}
              className="w-full py-4 rounded-2xl font-bold text-base transition bg-yellow-400 text-gray-900 hover:bg-yellow-500 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  처리 중...
                </>
              ) : step < TOTAL_STEPS - 1 ? '다음' : '💬 카카오로 상담 신청'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function StepWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-shrink-0 px-5 py-5 space-y-4 overflow-y-auto" style={{ width: `${100 / TOTAL_STEPS}%` }}>
      {children}
    </div>
  );
}

function StepIcon({ icon }: { icon: React.ReactNode }) {
  return <div className="flex justify-center">{icon}</div>;
}

function CounterRow({
  label, subLabel, value, onMinus, onPlus,
}: {
  label: string; subLabel: string; value: number; onMinus: () => void; onPlus: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div>
        <p className="font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-400">{subLabel}</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={onMinus}
          className="w-9 h-9 rounded-full border-2 border-gray-200 flex items-center justify-center text-gray-600 hover:border-yellow-400 hover:text-yellow-600 transition text-xl font-light"
        >
          −
        </button>
        <span className="w-6 text-center text-lg font-bold text-gray-900">{value}</span>
        <button
          onClick={onPlus}
          className="w-9 h-9 rounded-full border-2 border-gray-200 flex items-center justify-center text-gray-600 hover:border-yellow-400 hover:text-yellow-600 transition text-xl font-light"
        >
          +
        </button>
      </div>
    </div>
  );
}

function SuccessView({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10 px-5">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center animate-bounce">
        <Check size={32} className="text-green-500" strokeWidth={3} />
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-gray-900">상담 신청이 완료됐어요!</h2>
        <p className="text-sm text-gray-500">카카오 채널로 이동하여 상담사와 바로 연결할게요.</p>
      </div>
      <button
        onClick={onClose}
        className="mt-4 text-sm text-gray-400 underline underline-offset-2"
      >
        닫기
      </button>
    </div>
  );
}
