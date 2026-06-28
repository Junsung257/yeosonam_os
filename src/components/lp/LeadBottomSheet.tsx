'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, Users, Calendar, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { LeadFormData } from '@/lib/submitPipeline';
import type { PriceDate } from '@/lib/price-dates';
import DepartureCalendar from '@/components/customer/DepartureCalendar';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: LeadFormData) => Promise<void>;
  defaultDate?: string;
  priceDates?: PriceDate[];
  hasSpecialTerms?: boolean;
  termsSummary?: string;
}

const TOTAL_STEPS = 3;

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export default function LeadBottomSheet({
  open,
  onClose,
  onSubmit,
  defaultDate = '',
  priceDates,
  hasSpecialTerms = false,
  termsSummary,
}: Props) {
  const [step, setStep] = useState(0);
  const [desiredDate, setDesiredDate] = useState(defaultDate);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [termsExpanded, setTermsExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDesiredDate(defaultDate);
    setAdults(2);
    setChildren(0);
    setName('');
    setPhone('');
    setPrivacy(false);
    setTerms(false);
    setTermsExpanded(false);
    setSubmitting(false);
    setSuccess(false);
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const canNext = useCallback(() => {
    if (step === 0) return Boolean(desiredDate);
    if (step === 1) return adults >= 1;
    if (step === 2) return name.trim().length >= 2 && phone.replace(/\D/g, '').length === 11 && privacy && terms;
    return false;
  }, [step, desiredDate, adults, phone, name, privacy, terms]);

  const handleNext = async () => {
    if (!canNext()) return;
    if (step < TOTAL_STEPS - 1) {
      setStep(current => current + 1);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        desiredDate,
        adults,
        children,
        name: name.trim(),
        phone,
        privacyConsent: privacy,
        termsConsent: terms,
      });
      setSuccess(true);
    } catch {
      setSuccess(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      <div
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-2xl bg-white shadow-2xl md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lp-lead-bottom-sheet-title"
        data-testid="lp-lead-bottom-sheet"
      >
        <div className="flex justify-center pb-1 pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={() => (step > 0 ? setStep(current => current - 1) : onClose())}
            className="rounded-full p-1 transition hover:bg-gray-100"
            aria-label={step > 0 ? '이전 단계' : '닫기'}
          >
            {step > 0 ? <ChevronLeft size={20} /> : <X size={20} />}
          </button>
          <div id="lp-lead-bottom-sheet-title" className="text-sm font-semibold text-gray-700">
            {success ? '신청 완료' : `상담 신청 (${step + 1}/${TOTAL_STEPS})`}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 transition hover:bg-gray-100" aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        {!success && (
          <div className="h-1 bg-gray-100">
            <div
              className="h-1 bg-yellow-400 transition-all duration-300"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {success ? (
            <SuccessView onClose={onClose} />
          ) : (
            <div
              className="flex h-full transition-transform duration-300 ease-in-out"
              style={{ transform: `translateX(-${(step / TOTAL_STEPS) * 100}%)`, width: `${TOTAL_STEPS * 100}%` }}
            >
              <StepWrapper>
                <StepIcon icon={<Calendar size={28} className="text-yellow-500" />} />
                <h2 className="text-center text-lg font-bold text-gray-900">희망 출발일을 선택해 주세요</h2>
                <p className="text-center text-sm text-gray-500">
                  {priceDates && priceDates.length > 0 ? '확정 또는 가능 출발일에서 선택하세요.' : '일정 조율을 위해 필요해요.'}
                </p>
                {priceDates && priceDates.length > 0 ? (
                  <DepartureCalendar
                    priceDates={priceDates}
                    selectedDate={desiredDate}
                    onSelect={setDesiredDate}
                  />
                ) : (
                  <input
                    type="date"
                    value={desiredDate}
                    onChange={event => setDesiredDate(event.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-center text-base transition focus:border-yellow-400 focus:outline-none"
                  />
                )}
              </StepWrapper>

              <StepWrapper>
                <StepIcon icon={<Users size={28} className="text-yellow-500" />} />
                <h2 className="text-center text-lg font-bold text-gray-900">인원을 알려주세요</h2>
                <p className="text-center text-sm text-gray-500">정확한 견적을 빠르게 확인해 드릴게요.</p>
                <CounterRow
                  label="성인"
                  subLabel="만 12세 이상"
                  value={adults}
                  onMinus={() => setAdults(value => Math.max(1, value - 1))}
                  onPlus={() => setAdults(value => value + 1)}
                />
                <CounterRow
                  label="아동"
                  subLabel="만 2-11세"
                  value={children}
                  onMinus={() => setChildren(value => Math.max(0, value - 1))}
                  onPlus={() => setChildren(value => value + 1)}
                />
              </StepWrapper>

              <StepWrapper>
                <h2 className="text-center text-lg font-bold text-gray-900">연락처를 알려주세요</h2>
                <p className="text-center text-sm text-gray-500">상담사가 빠르게 연락드릴게요.</p>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="lead-bottom-name" className="mb-1 block text-sm font-medium text-gray-700">이름</label>
                    <input
                      id="lead-bottom-name"
                      type="text"
                      value={name}
                      onChange={event => setName(event.target.value)}
                      placeholder="홍길동"
                      className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base transition focus:border-yellow-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="lead-bottom-phone" className="mb-1 block text-sm font-medium text-gray-700">휴대폰 번호</label>
                    <input
                      id="lead-bottom-phone"
                      type="tel"
                      value={phone}
                      onChange={event => setPhone(formatPhone(event.target.value))}
                      placeholder="010-0000-0000"
                      className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base transition focus:border-yellow-400 focus:outline-none"
                    />
                  </div>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <button
                      type="button"
                      aria-label="개인정보 수집 및 이용 동의"
                      aria-pressed={privacy}
                      onClick={() => setPrivacy(value => !value)}
                      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition ${
                        privacy ? 'border-yellow-400 bg-yellow-400' : 'border-gray-300'
                      }`}
                    >
                      {privacy && <Check size={12} className="text-white" strokeWidth={3} />}
                    </button>
                    <span className="text-sm leading-snug text-gray-600">
                      <span className="font-medium text-gray-800">[필수]</span> 개인정보 수집 및 이용에 동의합니다.
                      입력한 정보는 여행 상담 목적으로만 사용하며, 상담 완료 후 내부 정책에 따라 안전하게 관리합니다.
                    </span>
                  </label>

                  <div className="flex items-start gap-2.5">
                    <button
                      type="button"
                      aria-label="취소 및 약관 동의"
                      aria-pressed={terms}
                      onClick={() => setTerms(value => !value)}
                      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded border-2 transition ${
                        terms ? 'border-yellow-400 bg-yellow-400' : 'border-gray-300'
                      }`}
                    >
                      {terms && <Check size={12} className="text-white" strokeWidth={3} />}
                    </button>
                    <div className="flex-1">
                      <p className="text-sm leading-snug text-gray-600">
                        {hasSpecialTerms ? (
                          <>
                            <span className="font-medium text-red-700">[필수]</span>{' '}
                            본 상품은 특별약관 적용 상품으로, 예약 즉시 항공·호텔 정보가 확정될 수 있으며 취소 시 비용이 발생할 수 있음에 동의합니다.
                          </>
                        ) : (
                          <>
                            <span className="font-medium text-gray-800">[필수]</span>{' '}
                            취소 수수료 및 자동 발권 규정에 동의합니다.
                          </>
                        )}
                      </p>
                      {termsSummary && (
                        <button
                          type="button"
                          onClick={() => setTermsExpanded(value => !value)}
                          className="mt-1 flex items-center gap-0.5 text-xs font-medium text-yellow-600"
                        >
                          약관 보기
                          {termsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      )}
                      {termsExpanded && termsSummary && (
                        <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
                          {termsSummary}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </StepWrapper>
            </div>
          )}
        </div>

        {!success && (
          <div className="border-t border-gray-100 px-5 py-4">
            <button
              type="button"
              onClick={handleNext}
              disabled={!canNext() || submitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-yellow-400 py-4 text-base font-bold text-gray-900 transition hover:bg-yellow-500 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                  처리 중...
                </>
              ) : step < TOTAL_STEPS - 1 ? '다음' : '카카오로 상담 신청'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function StepWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-shrink-0 space-y-4 overflow-y-auto px-5 py-5" style={{ width: `${100 / TOTAL_STEPS}%` }}>
      {children}
    </div>
  );
}

function StepIcon({ icon }: { icon: React.ReactNode }) {
  return <div className="flex justify-center">{icon}</div>;
}

function CounterRow({
  label,
  subLabel,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  subLabel: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-3 last:border-0">
      <div>
        <p className="font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-400">{subLabel}</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onMinus}
          aria-label={`${label} 1명 줄이기`}
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-gray-200 text-xl font-light text-gray-600 transition hover:border-yellow-400 hover:text-yellow-600"
        >
          -
        </button>
        <span className="w-6 text-center text-lg font-bold text-gray-900">{value}</span>
        <button
          type="button"
          onClick={onPlus}
          aria-label={`${label} 1명 늘리기`}
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-gray-200 text-xl font-light text-gray-600 transition hover:border-yellow-400 hover:text-yellow-600"
        >
          +
        </button>
      </div>
    </div>
  );
}

function SuccessView({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-5 py-10">
      <div className="flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-green-100">
        <Check size={32} className="text-green-500" strokeWidth={3} />
      </div>
      <div className="space-y-1 text-center">
        <h2 className="text-xl font-bold text-gray-900">상담 신청이 완료됐어요</h2>
        <p className="text-sm text-gray-500">카카오 채널로 이동해 상담사와 바로 연결할게요.</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 text-sm text-gray-400 underline underline-offset-2"
      >
        닫기
      </button>
    </div>
  );
}
