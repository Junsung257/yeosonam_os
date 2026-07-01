'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trackLead } from '@/components/MetaPixel';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { trackEngagement } from '@/lib/tracker';

// ─── 폼 선택지 정의 ────────────────────────────────────────
const PURPOSE_OPTIONS = [
  '기업 워크샵 · 포상',
  '협회 · 기관 · 연수',
  '치목 · 골프 · 동문',
  '패밀리 · 가족',
  '기타',
] as const;

const PAX_OPTIONS = [
  '10명',
  '15명',
  '20명',
  '30명',
  '40명',
  '50명',
  '60명',
  '70명',
  '80명',
  '100명 이상',
] as const;

const BUDGET_OPTIONS = [
  '~50만원',
  '50~80만원',
  '80~120만원',
  '120만원 이상',
  '미정',
] as const;

const HOTEL_OPTIONS = ['3성', '4성', '5성', '미정'] as const;
const SHOPPING_OPTIONS = ['쇼핑 희망', '노쇼핑'] as const;

// ─── 예산 라벨 → 숫자 변환 (budget_per_person 저장용) ─────
function parseBudgetLabel(label: string): number | undefined {
  switch (label) {
    case '~50만원':
      return 400_000;
    case '50~80만원':
      return 650_000;
    case '80~120만원':
      return 1_000_000;
    case '120만원 이상':
      return 1_500_000;
    default:
      return undefined;
  }
}

// ─── 인원 라벨 → 숫자 변환 (adult_count 저장용) ────────────
function parsePaxLabel(label: string): number {
  const n = parseInt(label.replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

type FormState = {
  contact_name: string;
  contact_phone: string;
  group_name: string;
  purpose: string;
  destination: string;
  departure_date: string;
  pax_label: string;
  budget_label: string;
  hotel_grade: string;
  shopping: string;
  notes: string;
};

type RequiredField =
  | 'contact_name'
  | 'contact_phone'
  | 'group_name'
  | 'purpose'
  | 'destination'
  | 'departure_date'
  | 'pax_label'
  | 'budget_label';

type FieldErrorKey = RequiredField | 'privacy_consent';

const INITIAL_FORM: FormState = {
  contact_name: '',
  contact_phone: '',
  group_name: '',
  purpose: '',
  destination: '',
  departure_date: '',
  pax_label: '',
  budget_label: '',
  hotel_grade: '',
  shopping: '',
  notes: '',
};

const REQUIRED_FIELD_LABELS: Record<RequiredField, string> = {
  contact_name: '신청자 성함',
  contact_phone: '연락처',
  group_name: '단체명',
  purpose: '단체 성격',
  destination: '희망 여행지',
  departure_date: '희망 출발일',
  pax_label: '예상 인원',
  budget_label: '1인 예산',
};

const REQUIRED_FIELDS = Object.keys(REQUIRED_FIELD_LABELS) as RequiredField[];

function errorId(key: FieldErrorKey) {
  return `group-${key.replace(/_/g, '-')}-error`;
}

export default function GroupLandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});
  const [privacyConsent, setPrivacyConsent] = useState(false);

  // URL hash 에 preset 쿼리(?preset=...)가 있으면 단체 유형 자동 선택
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    const match = hash.match(/preset=([^&]+)/);
    if (match) {
      const preset = decodeURIComponent(match[1]);
      const mapped = PURPOSE_OPTIONS.find((p) => p.includes(preset.split(' ')[0]));
      if (mapped) setForm((f) => ({ ...f, purpose: mapped }));
    }
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((current) => {
      const fieldKey = key as FieldErrorKey;
      if (!current[fieldKey]) return current;
      const next = { ...current };
      delete next[fieldKey];
      return next;
    });
  }

  function fieldA11y(key: FieldErrorKey) {
    return {
      'aria-invalid': Boolean(fieldErrors[key]),
      'aria-describedby': fieldErrors[key] ? errorId(key) : undefined,
    };
  }

  function renderFieldError(key: FieldErrorKey) {
    if (!fieldErrors[key]) return null;
    return (
      <p id={errorId(key)} className="mt-1 text-xs font-semibold text-red-600">
        {fieldErrors[key]}
      </p>
    );
  }

  function validateForm() {
    const nextErrors: Partial<Record<FieldErrorKey, string>> = {};

    for (const key of REQUIRED_FIELDS) {
      if (!form[key].trim()) {
        nextErrors[key] = `${REQUIRED_FIELD_LABELS[key]}을(를) 입력해주세요.`;
      }
    }

    const adultCount = parsePaxLabel(form.pax_label);
    if (form.pax_label && adultCount === 0) {
      nextErrors.pax_label = '예상 인원을 다시 확인해주세요.';
    }

    if (!privacyConsent) {
      nextErrors.privacy_consent = '견적 상담을 위해 개인정보 안내에 동의해주세요.';
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleKakaoConsult() {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      page_url: window.location.pathname,
      intent: form.purpose || null,
      budget: form.budget_label || null,
      destination: form.destination || null,
      party_type: 'group_landing',
      metadata: {
        source: 'group_landing_form',
        pax_label: form.pax_label || null,
      },
    });

    await openKakaoChannel({
      productTitle: '단체 맞춤 견적',
      intent: form.purpose || null,
      budget: form.budget_label || null,
      destination: form.destination || null,
      party_type: 'group_landing',
      selected_products: ['단체 맞춤 견적'],
      escalationSummary: [
        `단체명: ${form.group_name || '미입력'}`,
        `단체 성격: ${form.purpose || '미입력'}`,
        `목적지: ${form.destination || '미입력'}`,
        `출발일: ${form.departure_date || '미입력'}`,
        `인원: ${form.pax_label || '미입력'}`,
        `예산: ${form.budget_label || '미입력'}`,
        `호텔: ${form.hotel_grade || '미정'}`,
        `쇼핑: ${form.shopping || '미정'}`,
        form.notes ? `요청사항: ${form.notes}` : null,
      ].filter(Boolean).join('\n'),
      leadForm: {
        name: form.contact_name || undefined,
        phone: form.contact_phone || undefined,
        adults: parsePaxLabel(form.pax_label) || undefined,
      },
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!validateForm()) {
      setError('필수 항목을 확인해주세요.');
      return;
    }

    const adultCount = parsePaxLabel(form.pax_label);
    setSubmitting(true);

    try {
      // ── UTM / 네이버 키워드 수집 ─────────────────────────
      const utm = {
        source: searchParams?.get('utm_source') ?? null,
        medium: searchParams?.get('utm_medium') ?? null,
        campaign: searchParams?.get('utm_campaign') ?? null,
        n_keyword: searchParams?.get('n_keyword') ?? null,
      };

      // ── /api/rfq 로 POST (기존 엔드포인트 재사용) ─────────
      const payload = {
        // 정규 컬럼
        customer_name: form.contact_name,
        customer_phone: form.contact_phone,
        destination: form.destination,
        departure_date_from: form.departure_date,
        adult_count: adultCount,
        child_count: 0,
        budget_per_person: parseBudgetLabel(form.budget_label),
        hotel_grade: form.hotel_grade || undefined,
        special_requests: form.notes || undefined,
        // 랜딩 전용 메타데이터는 JSONB 에 집어넣어 보존
        custom_requirements: {
          source: 'group_landing',
          segment: 'group_custom_travel',
          organization_name: form.group_name,
          organization_type: form.purpose,
          group_name: form.group_name,
          purpose: form.purpose,
          approval_view_required: true,
          shopping_preference: form.shopping || undefined,
          budget_range_label: form.budget_label,
          pax_label: form.pax_label,
          privacy_consent: privacyConsent,
          utm,
          submitted_at: new Date().toISOString(),
        },
      };

      const res = await fetch('/api/rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.rfq) {
        throw new Error(data.error || '견적 요청에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }

      // ── Meta Pixel Lead 이벤트 ───────────────────────────
      trackLead({ content_name: '단체여행 견적', value: 0 });
      trackEngagement({
        event_type: ANALYTICS_EVENTS.rfqSubmitted,
        page_url: window.location.pathname,
        intent: form.purpose || null,
        budget: form.budget_label || null,
        destination: form.destination || null,
        party_type: 'group_landing',
        metadata: {
          source: 'group_landing_submit',
          rfq_id: data.rfq.id,
          share_token: data.share_token ?? null,
          pax_label: form.pax_label,
        },
      });

      // ── 성공: 고객 전용 공유/진행 링크로 이동 ───────────────
      const nextPath = data.share_url
        ? new URL(data.share_url, window.location.origin).pathname
        : `/rfq/${data.rfq.id}`;
      router.push(nextPath);
    } catch (err) {
      console.error('견적 요청 실패:', err);
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      setSubmitting(false);
    }
  }

  return (
    <section id="group-inquiry-form" className="bg-white py-16 md:py-20 px-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">견적 요청하기</h2>
        <p className="text-center text-slate-600 mb-10 text-sm">
          접수 즉시 담당자가 확인하고 당일 내 회신드립니다
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-50 rounded-3xl p-6 md:p-10 border border-gray-100 shadow-sm space-y-5"
        >
          {/* 신청자 성함 */}
          <div>
            <label htmlFor="group-contact-name" className="block text-sm font-semibold mb-2">
              신청자 성함 <span className="text-red-500">*</span>
            </label>
            <input id="group-contact-name"
              type="text"
              value={form.contact_name}
              onChange={(e) => update('contact_name', e.target.value)}
              {...fieldA11y('contact_name')}
              placeholder="홍길동"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              required
            />
            {renderFieldError('contact_name')}
          </div>

          {/* 연락처 */}
          <div>
            <label htmlFor="group-contact-phone" className="block text-sm font-semibold mb-2">
              연락처 <span className="text-red-500">*</span>
            </label>
            <input id="group-contact-phone"
              type="tel"
              value={form.contact_phone}
              onChange={(e) => update('contact_phone', e.target.value)}
              {...fieldA11y('contact_phone')}
              placeholder="010-0000-0000"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              required
            />
            {renderFieldError('contact_phone')}
          </div>

          {/* 단체명 */}
          <div>
            <label htmlFor="group-name" className="block text-sm font-semibold mb-2">
              단체명 (회사·모임명) <span className="text-red-500">*</span>
            </label>
            <input id="group-name"
              type="text"
              value={form.group_name}
              onChange={(e) => update('group_name', e.target.value)}
              {...fieldA11y('group_name')}
              placeholder="OO 연수원"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              required
            />
            {renderFieldError('group_name')}
          </div>

          {/* 단체 성격 */}
          <div>
            <label htmlFor="group-purpose" className="block text-sm font-semibold mb-2">
              단체 성격 <span className="text-red-500">*</span>
            </label>
            <select
              id="group-purpose"
              value={form.purpose}
              onChange={(e) => update('purpose', e.target.value)}
              {...fieldA11y('purpose')}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              required
            >
              <option value="">선택해주세요</option>
              {PURPOSE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {renderFieldError('purpose')}
          </div>

          {/* 희망 여행지 */}
          <div>
            <label htmlFor="group-destination" className="block text-sm font-semibold mb-2">
              희망 여행지 <span className="text-red-500">*</span>
            </label>
            <input id="group-destination"
              type="text"
              value={form.destination}
              onChange={(e) => update('destination', e.target.value)}
              {...fieldA11y('destination')}
              placeholder="다낭, 세부, 장가계 등"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              required
            />
            {renderFieldError('destination')}
          </div>

          {/* 희망 출발일 */}
          <div>
            <label htmlFor="group-departure-date" className="block text-sm font-semibold mb-2">
              희망 출발일 <span className="text-red-500">*</span>
            </label>
            <input id="group-departure-date"
              type="date"
              value={form.departure_date}
              onChange={(e) => update('departure_date', e.target.value)}
              {...fieldA11y('departure_date')}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              required
            />
            {renderFieldError('departure_date')}
          </div>

          {/* 예상 인원 */}
          <div>
            <label htmlFor="group-pax-label" className="block text-sm font-semibold mb-2">
              예상 인원 <span className="text-red-500">*</span>
            </label>
            <select id="group-pax-label"
              value={form.pax_label}
              onChange={(e) => update('pax_label', e.target.value)}
              {...fieldA11y('pax_label')}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              required
            >
              <option value="">선택해주세요</option>
              {PAX_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {renderFieldError('pax_label')}
          </div>

          {/* 1인 예산 */}
          <div>
            <label htmlFor="group-budget-label" className="block text-sm font-semibold mb-2">
              1인 예산 <span className="text-red-500">*</span>
            </label>
            <select
              id="group-budget-label"
              value={form.budget_label}
              onChange={(e) => update('budget_label', e.target.value)}
              {...fieldA11y('budget_label')}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition"
              required
            >
              <option value="">선택해주세요</option>
              {BUDGET_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            {renderFieldError('budget_label')}
          </div>

          {/* 구분선: 선택 항목 */}
          <div className="pt-4 border-t border-gray-200">
            <p className="text-xs text-slate-500 mb-4">선택 항목 (아래는 비워두셔도 됩니다)</p>
          </div>

          {/* 호텔 등급 */}
          <div>
            <span className="block text-sm font-semibold mb-2">호텔 등급</span>
            <div className="grid grid-cols-4 gap-2">
              {HOTEL_OPTIONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={form.hotel_grade === h}
                  onClick={() => update('hotel_grade', form.hotel_grade === h ? '' : h)}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition border ${
                    form.hotel_grade === h
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* 쇼핑 포함 */}
          <div>
            <span className="block text-sm font-semibold mb-2">쇼핑 포함</span>
            <div className="grid grid-cols-2 gap-2">
              {SHOPPING_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={form.shopping === s}
                  onClick={() => update('shopping', form.shopping === s ? '' : s)}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition border ${
                    form.shopping === s
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white text-slate-700 border-gray-200 hover:border-brand/40'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* 요청사항 */}
          <div>
            <label htmlFor="group-notes" className="block text-sm font-semibold mb-2">요청사항</label>
            <textarea id="group-notes"
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="특별히 요청하실 사항이 있으시면 자유롭게 입력해주세요"
              rows={4}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition resize-none"
            />
          </div>

          <div>
            <label className="flex items-start gap-2 rounded-xl bg-white p-4 text-sm text-slate-600 border border-gray-200">
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={(e) => {
                  setPrivacyConsent(e.target.checked);
                  if (fieldErrors.privacy_consent) {
                    setFieldErrors((current) => {
                      const next = { ...current };
                      delete next.privacy_consent;
                      return next;
                    });
                  }
                }}
                {...fieldA11y('privacy_consent')}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
              />
              <span>
                견적 상담과 연락을 위해 입력한 정보를 여소남이 확인하는 데 동의합니다.
                <a href="/privacy" className="ml-1 font-bold text-brand underline underline-offset-2">
                  개인정보 안내
                </a>
              </span>
            </label>
            {renderFieldError('privacy_consent')}
          </div>

          {/* 에러 표시 */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl" role="alert">
              {error}
            </div>
          )}

          {/* 제출 버튼 */}
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-brand hover:bg-[#1B64DA] disabled:bg-slate-400 text-white font-bold py-4 px-6 rounded-2xl text-lg transition"
            >
              {submitting ? '전송 중...' : '견적 요청하기'}
            </button>
            <button
              type="button"
              onClick={() => void handleKakaoConsult()}
              className="w-full sm:w-auto bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold py-4 px-6 rounded-2xl text-base transition"
            >
              카톡 상담
            </button>
          </div>

          <p className="text-center text-xs text-slate-500">
            제출 후 전용 진행 링크로 자동 이동되며, 그곳에서 실시간 진행 상황을 확인하실 수 있습니다.
          </p>
        </form>
      </div>
    </section>
  );
}
