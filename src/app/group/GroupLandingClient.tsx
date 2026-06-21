'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trackLead } from '@/components/MetaPixel';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import {
  buildGroupInquiryHandoffHref,
  GROUP_INQUIRY_PRODUCT_LABEL,
} from '@/lib/group-inquiry-handoff';
import { getKakaoChannelChatUrl, openKakaoChannel } from '@/lib/kakaoChannel';
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

const GROUP_PRESET_DEFAULTS: Record<string, Pick<FormState, 'purpose' | 'pax_label' | 'budget_label'>> = {
  '기업 워크샵': {
    purpose: '기업 워크샵 · 포상',
    pax_label: '20명',
    budget_label: '80~120만원',
  },
  '협회 연수': {
    purpose: '협회 · 기관 · 연수',
    pax_label: '15명',
    budget_label: '80~120만원',
  },
  '치목 골프': {
    purpose: '치목 · 골프 · 동문',
    pax_label: '10명',
    budget_label: '50~80만원',
  },
  '패밀리 가족': {
    purpose: '패밀리 · 가족',
    pax_label: '10명',
    budget_label: '80~120만원',
  },
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

function readLegacyHashPreset() {
  if (typeof window === 'undefined') return null;
  const match = window.location.hash.match(/preset=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function resolveGroupPresetDefaults(rawPreset: string | null): Pick<FormState, 'purpose' | 'pax_label' | 'budget_label'> | null {
  const preset = rawPreset?.trim();
  if (!preset) return null;
  const exactMatch = GROUP_PRESET_DEFAULTS[preset];
  if (exactMatch) return exactMatch;

  const normalized = preset.toLowerCase();
  if (/기업|워크샵|workshop/.test(normalized)) return GROUP_PRESET_DEFAULTS['기업 워크샵'];
  if (/협회|기관|연수/.test(normalized)) return GROUP_PRESET_DEFAULTS['협회 연수'];
  if (/골프|동문|친목|치목/.test(normalized)) return GROUP_PRESET_DEFAULTS['치목 골프'];
  if (/패밀리|가족|family/.test(normalized)) return GROUP_PRESET_DEFAULTS['패밀리 가족'];
  return null;
}

const FIELD_INPUT_IDS: Record<FieldErrorKey, string> = {
  contact_name: 'group-contact-name',
  contact_phone: 'group-contact-phone',
  group_name: 'group-name',
  purpose: 'group-purpose',
  destination: 'group-destination',
  departure_date: 'group-departure-date',
  pax_label: 'group-pax-label',
  budget_label: 'group-budget-label',
  privacy_consent: 'group-privacy-consent',
};

export default function GroupLandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [kakaoOpening, setKakaoOpening] = useState(false);
  const [kakaoStatus, setKakaoStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const kakaoActionDescriptionId = 'group-landing-kakao-action-description';
  const kakaoStatusId = 'group-landing-kakao-status';
  const kakaoDescriptionIds = kakaoStatus
    ? `${kakaoActionDescriptionId} ${kakaoStatusId}`
    : kakaoActionDescriptionId;
  const submitErrorRef = useRef<HTMLDivElement | null>(null);
  const kakaoStatusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const defaults = resolveGroupPresetDefaults(searchParams?.get('preset') ?? readLegacyHashPreset());
    if (!defaults) return;

    setForm((current) => ({
      ...current,
      purpose: defaults.purpose,
      pax_label: current.pax_label || defaults.pax_label,
      budget_label: current.budget_label || defaults.budget_label,
    }));
  }, [searchParams]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (error) setError(null);
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

  function focusFirstFieldError(nextErrors: Partial<Record<FieldErrorKey, string>>) {
    const firstErrorKey = ([...REQUIRED_FIELDS, 'privacy_consent'] as FieldErrorKey[]).find((key) => nextErrors[key]);
    if (!firstErrorKey) return;

    requestAnimationFrame(() => {
      const target = document.getElementById(FIELD_INPUT_IDS[firstErrorKey]);
      target?.focus();
    });
  }

  function buildGroupLandingInquiryHref() {
    return buildGroupInquiryHandoffHref({
      source: 'group_landing',
      intent: form.purpose || 'group_trip',
      partyType: 'group_landing',
      selectedProducts: [GROUP_INQUIRY_PRODUCT_LABEL],
      query: [
        form.purpose || '단체 맞춤 견적 상담',
        form.destination,
        form.pax_label,
        form.budget_label,
        form.departure_date ? `출발 ${form.departure_date}` : null,
      ].filter(Boolean).join(', '),
      budget: form.budget_label,
      destination: form.destination,
    });
  }

  const aiHandoffSummary = [
    { label: '성격', value: form.purpose || '미입력' },
    { label: '목적지', value: form.destination || '미입력' },
    { label: '인원', value: form.pax_label || '미입력' },
    { label: '예산', value: form.budget_label || '미입력' },
    { label: '출발', value: form.departure_date || '미입력' },
  ];
  const aiHandoffFilledCount = aiHandoffSummary.filter((item) => item.value !== '미입력').length;
  const aiHandoffMissingFields = aiHandoffSummary.filter((item) => item.value === '미입력').map((item) => item.label);
  const aiHandoffReadinessId = 'group-landing-ai-handoff-readiness';
  const aiHandoffDescriptionIds = `group-landing-ai-handoff-summary ${aiHandoffReadinessId}`;
  const aiHandoffReadinessLabel = aiHandoffFilledCount >= 4 ? '상담 품질 충분' : '조건 보완 권장';
  const aiHandoffNextActionText = aiHandoffMissingFields.length > 0
    ? `AI 상담 전 ${aiHandoffMissingFields.join(', ')}을(를) 더 입력하면 추천 정확도가 올라갑니다.`
    : 'AI 상담에 필요한 핵심 조건이 모두 준비되었습니다.';
  const groupSubmitChecklist = [
    ...REQUIRED_FIELDS.map((key) => ({
      label: REQUIRED_FIELD_LABELS[key],
      complete: Boolean(form[key].trim()),
    })),
    { label: '개인정보 동의', complete: privacyConsent },
  ];
  const groupSubmitReadyCount = groupSubmitChecklist.filter((item) => item.complete).length;
  const groupSubmitMissingLabels = groupSubmitChecklist.filter((item) => !item.complete).map((item) => item.label);
  const groupSubmitDecisionSummaryId = 'group-landing-submit-decision-summary';
  const groupSubmitDecisionSummaryText = groupSubmitMissingLabels.length > 0
    ? `견적 요청 전 ${groupSubmitMissingLabels.join(', ')}을(를) 입력하면 접수할 수 있습니다.`
    : `견적 요청 시 ${form.destination}, ${form.pax_label}, ${form.budget_label} 기준으로 전담 견적을 접수합니다.`;
  const groupSubmitConditionSummaryText = [
    `단체명 ${form.group_name || '미입력'}`,
    `성격 ${form.purpose || '미입력'}`,
    `목적지 ${form.destination || '미입력'}`,
    `출발일 ${form.departure_date || '미입력'}`,
    `인원 ${form.pax_label || '미입력'}`,
    `예산 ${form.budget_label || '미입력'}`,
    `호텔 ${form.hotel_grade || '미정'}`,
    `쇼핑 ${form.shopping || '미정'}`,
  ].join(', ');
  const groupSubmitHandoffPreviewText = `상담 전달 미리보기: ${groupSubmitConditionSummaryText}. 연락처 이름 ${form.contact_name.trim() ? '입력됨' : '미입력'}, 전화번호 ${form.contact_phone.trim() ? '입력됨' : '미입력'}, 개인정보 동의 ${privacyConsent ? '완료' : '미완료'}.`;
  const groupLandingDecisionMetadata = {
    pax_label: form.pax_label || null,
    adult_count: parsePaxLabel(form.pax_label),
    budget_per_person: parseBudgetLabel(form.budget_label),
    ready_count: groupSubmitReadyCount,
    missing_fields: groupSubmitMissingLabels,
    decision_summary: groupSubmitDecisionSummaryText,
    condition_summary: groupSubmitConditionSummaryText,
    handoff_preview: groupSubmitHandoffPreviewText,
    has_contact_name: form.contact_name.trim().length > 0,
    has_contact_phone: form.contact_phone.trim().length > 0,
    privacy_consent: privacyConsent,
  };
  const groupSubmitDescriptionIds = error
    ? `${groupSubmitDecisionSummaryId} group-landing-submit-error`
    : submitting
      ? `${groupSubmitDecisionSummaryId} group-landing-status`
      : groupSubmitDecisionSummaryId;

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
    const isValid = Object.keys(nextErrors).length === 0;
    if (!isValid) focusFirstFieldError(nextErrors);
    return isValid;
  }

  async function handleKakaoConsult() {
    setKakaoStatus(null);
    setKakaoOpening(true);
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      cta_type: 'group_landing_form',
      page_url: window.location.pathname,
      intent: form.purpose || null,
      budget: form.budget_label || null,
      destination: form.destination || null,
      party_type: 'group_landing',
      selected_products: [GROUP_INQUIRY_PRODUCT_LABEL],
      ready_count: groupSubmitReadyCount,
      missing_fields: groupSubmitMissingLabels,
      decision_summary: groupSubmitDecisionSummaryText,
      handoff_preview: groupSubmitHandoffPreviewText,
      next_action: groupSubmitReadyCount >= groupSubmitChecklist.length ? 'kakao_consult_ready' : 'complete_missing_fields',
      metadata: {
        source: 'group_landing_form',
        ...groupLandingDecisionMetadata,
      },
    });

    try {
      await openKakaoChannel({
        productTitle: GROUP_INQUIRY_PRODUCT_LABEL,
        intent: form.purpose || null,
        budget: form.budget_label || null,
        destination: form.destination || null,
        party_type: 'group_landing',
        selected_products: [GROUP_INQUIRY_PRODUCT_LABEL],
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
      setKakaoStatus({
        tone: 'success',
        message: '카톡 상담 문구를 복사했고 상담창을 열었습니다. 새 창이 보이지 않으면 아래 링크로 다시 열 수 있어요.',
      });
    } catch {
      setKakaoStatus({
        tone: 'error',
        message: '카톡 상담창을 열지 못했습니다. 아래 링크로 직접 열어 상담 문구를 붙여넣어 주세요.',
      });
      requestAnimationFrame(() => kakaoStatusRef.current?.focus());
    } finally {
      setKakaoOpening(false);
    }
  }

  function handleContinueInAiConsult() {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiPromptStarted,
      page_url: window.location.pathname,
      intent: form.purpose || 'group_trip',
      budget: form.budget_label || null,
      destination: form.destination || null,
      party_type: 'group_landing',
      selected_products: [GROUP_INQUIRY_PRODUCT_LABEL],
      ready_count: aiHandoffFilledCount,
      missing_fields: aiHandoffMissingFields,
      decision_summary: aiHandoffReadinessLabel,
      handoff_preview: groupSubmitHandoffPreviewText,
      next_action: aiHandoffNextActionText,
      metadata: {
        source: 'group_landing_ai_handoff',
        pax_label: form.pax_label || null,
        filled_count: aiHandoffFilledCount,
        missing_fields: aiHandoffMissingFields,
        readiness_label: aiHandoffReadinessLabel,
      },
    });

    router.push(buildGroupLandingInquiryHref());
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
          group_name: form.group_name,
          purpose: form.purpose,
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
        event_type: ANALYTICS_EVENTS.stickyCtaClicked,
        cta_type: 'group_landing_submit',
        page_url: window.location.pathname,
        intent: form.purpose || null,
        budget: form.budget_label || null,
        destination: form.destination || null,
        party_type: 'group_landing',
        selected_products: [GROUP_INQUIRY_PRODUCT_LABEL],
        ready_count: groupSubmitReadyCount,
        missing_fields: groupSubmitMissingLabels,
        decision_summary: groupSubmitDecisionSummaryText,
        handoff_preview: groupSubmitHandoffPreviewText,
        next_action: 'rfq_created',
        metadata: {
          source: 'group_landing_submit',
          outcome: 'rfq_created',
          rfq_id: data.rfq.id,
          ...groupLandingDecisionMetadata,
        },
      });

      // ── 성공: 고객 전용 진행 링크로 이동 ──────────────────
      router.push(`/rfq/${data.rfq.id}`);
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

        <p
          id="group-landing-status"
          className="sr-only"
          aria-atomic="true"
          {...(submitting ? { 'aria-live': 'polite' as const } : {})}
        >
          {submitting ? '견적 요청을 전송하고 있습니다.' : ''}
        </p>

        <form
          onSubmit={handleSubmit}
          noValidate
          aria-describedby={error ? 'group-landing-submit-error' : submitting ? 'group-landing-status' : undefined}
          className="bg-gray-50 rounded-3xl p-6 md:p-10 border border-gray-100 shadow-sm space-y-5"
        >
          {/* 신청자 성함 */}
          <div>
            <label htmlFor="group-contact-name" className="block text-sm font-semibold mb-2">
              신청자 성함 <span className="text-red-500">*</span>
            </label>
            <input id="group-contact-name"
              data-testid="group-landing-contact-name"
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
                id="group-privacy-consent"
                data-testid="group-landing-privacy-consent"
                type="checkbox"
                checked={privacyConsent}
                onChange={(e) => {
                  setPrivacyConsent(e.target.checked);
                  if (error) setError(null);
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
            <div
              ref={submitErrorRef}
              id="group-landing-submit-error"
              className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl"
              role="alert"
            >
              {error}
            </div>
          )}

          {/* 제출 버튼 */}
          <p
            id={groupSubmitDecisionSummaryId}
            data-testid="group-landing-submit-decision-summary"
            aria-label={groupSubmitDecisionSummaryText}
            className={`rounded-2xl border px-4 py-3 text-sm font-bold leading-relaxed ${
              groupSubmitMissingLabels.length > 0
                ? 'border-slate-200 bg-white text-slate-600'
                : 'border-blue-100 bg-blue-50 text-brand'
            }`}
          >
            <span className="font-black">
              {groupSubmitMissingLabels.length > 0 ? `접수 준비 ${groupSubmitReadyCount}/${groupSubmitChecklist.length}` : '접수 준비 완료'}
            </span>
            <span className="ml-1">{groupSubmitDecisionSummaryText}</span>
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <p id={kakaoActionDescriptionId} className="sr-only">
              현재 입력한 단체 여행 조건을 상담 문구로 정리해 카카오톡 상담창을 엽니다.
            </p>
            <button
              type="submit"
              data-testid="group-landing-submit"
              disabled={submitting}
              aria-busy={submitting}
              aria-describedby={groupSubmitDescriptionIds}
              className="w-full bg-brand hover:bg-[#1B64DA] disabled:bg-slate-400 text-white font-bold py-4 px-6 rounded-2xl text-lg transition"
            >
              {submitting ? '전송 중...' : '견적 요청하기'}
            </button>
            <button
              type="button"
              data-testid="group-landing-kakao"
              onClick={() => void handleKakaoConsult()}
              disabled={kakaoOpening}
              aria-busy={kakaoOpening}
              aria-describedby={kakaoDescriptionIds}
              className="w-full sm:w-auto bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold py-4 px-6 rounded-2xl text-base transition"
            >
              {kakaoOpening ? '카톡 여는 중...' : '카톡 상담'}
            </button>
          </div>

          {kakaoStatus && (
            <div
              ref={kakaoStatusRef}
              id={kakaoStatusId}
              data-testid="group-landing-kakao-status"
              role={kakaoStatus.tone === 'error' ? 'alert' : 'status'}
              aria-live={kakaoStatus.tone === 'error' ? 'assertive' : 'polite'}
              tabIndex={-1}
              className={`rounded-2xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
                kakaoStatus.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-yellow-200 bg-yellow-50 text-slate-800'
              }`}
            >
              <p>{kakaoStatus.message}</p>
              <a
                href={getKakaoChannelChatUrl()}
                target="_blank"
                rel="noopener"
                data-testid="group-landing-kakao-fallback"
                className="mt-2 inline-flex font-bold text-brand underline underline-offset-2"
              >
                카톡 상담창 직접 열기
              </a>
            </div>
          )}

          <button
            type="button"
            data-testid="group-landing-ai-handoff"
            onClick={handleContinueInAiConsult}
            aria-describedby={aiHandoffDescriptionIds}
            className="w-full rounded-2xl border border-brand/20 bg-white px-5 py-3.5 text-sm font-extrabold text-brand transition hover:border-brand/40 hover:bg-brand-light/40 focus:outline-none focus:ring-2 focus:ring-brand"
          >
            AI 상담에서 조건 이어가기
          </button>

          <div
            id="group-landing-ai-handoff-summary"
            data-testid="group-landing-ai-handoff-summary"
            className="rounded-2xl border border-brand/10 bg-white px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-black text-slate-800">AI에 전달될 조건</p>
              <span className="rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-black text-brand">
                {aiHandoffFilledCount}/5 입력됨
              </span>
            </div>
            <p
              id={aiHandoffReadinessId}
              data-testid="group-landing-ai-handoff-readiness"
              className="mt-2 rounded-xl border border-brand/10 bg-brand-light/30 px-3 py-2 text-xs font-bold text-slate-700"
            >
              <span className="font-black text-brand">{aiHandoffReadinessLabel}</span>
              <span className="ml-1">{aiHandoffNextActionText}</span>
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              {aiHandoffSummary.map((item) => (
                <div key={item.label} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
                  <dt className="font-bold text-slate-500">{item.label}</dt>
                  <dd className={`mt-1 truncate font-extrabold ${item.value === '미입력' ? 'text-slate-400' : 'text-slate-900'}`}>
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="text-center text-xs text-slate-500">
            제출 후 전용 진행 링크로 자동 이동되며, 그곳에서 실시간 진행 상황을 확인하실 수 있습니다.
          </p>
        </form>
      </div>
    </section>
  );
}
