'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  ClipboardList,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
} from 'lucide-react';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { trackEngagement } from '@/lib/tracker';

interface Message {
  role: 'user' | 'ai';
  content: string;
}

interface InterviewState {
  messages: unknown[];
  extracted: RfqExtracted;
  isComplete: boolean;
  stepsDone: string[];
}

interface RfqExtracted {
  destination?: string;
  adult_count?: number;
  child_count?: number;
  budget_per_person?: number;
  total_budget?: number;
  departure_date_from?: string;
  departure_date_to?: string;
  duration_nights?: number;
  hotel_grade?: string;
  meal_plan?: string;
  transportation?: string;
  special_requests?: string;
  customer_name?: string;
  customer_phone?: string;
  [key: string]: unknown;
}

interface IntentChip {
  label: string;
  prompt: string;
  intent: string;
  partyType: string;
  destination?: string;
  budget?: string;
}

const FIELD_GROUPS = [
  { key: 'destination', label: '목적지', keys: ['destination'] },
  { key: 'people', label: '인원', keys: ['adult_count', 'child_count'] },
  { key: 'budget', label: '예산', keys: ['budget_per_person', 'total_budget'] },
  { key: 'dates', label: '일정', keys: ['departure_date_from', 'departure_date_to', 'duration_nights'] },
  { key: 'hotel', label: '호텔', keys: ['hotel_grade'] },
  { key: 'meal', label: '식사', keys: ['meal_plan'] },
  { key: 'transport', label: '교통', keys: ['transportation'] },
  { key: 'special', label: '요청', keys: ['special_requests'] },
];

const INTENT_CHIPS: IntentChip[] = [
  {
    label: '부산 출발 60대 효도 여행',
    prompt: '부산 출발로 60대 부모님을 모시고 갈 효도 여행을 찾고 있어요. 10명 정도, 1인 120만원 안쪽이면 좋겠습니다.',
    intent: 'senior_family_trip',
    partyType: 'family',
    budget: '1인 120만원',
  },
  {
    label: '노쇼핑 동남아 가족여행',
    prompt: '노쇼핑 조건으로 동남아 가족여행을 비교하고 싶어요. 성인과 아이가 함께 가고, 호텔과 이동 동선이 편했으면 합니다.',
    intent: 'no_shopping_family_trip',
    partyType: 'family',
  },
  {
    label: '20명 단체 워크샵',
    prompt: '회사 워크샵으로 20명 단체 여행을 준비 중입니다. 세미나 가능 호텔, 단체 버스, 식사 포함 견적을 보고 싶어요.',
    intent: 'company_workshop',
    partyType: 'company',
  },
  {
    label: '3박5일 골프 비교',
    prompt: '3박5일 골프 여행 상품을 비교하고 싶어요. 항공, 호텔, 라운딩 횟수, 추가 비용 가능성을 같이 알고 싶습니다.',
    intent: 'golf_comparison',
    partyType: 'club',
  },
];

const INITIAL_AI_MESSAGE =
  '안녕하세요. 단체여행 전문 컨시어지 AI입니다. 목적지, 인원, 예산만 먼저 알려주시면 견적 요청에 필요한 조건을 빠르게 정리해드릴게요.';

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return true;
}

function formatMoney(value?: number): string {
  if (!value || value <= 0) return '미정';
  return `${value.toLocaleString('ko-KR')}원`;
}

function getSummaryValue(extracted: RfqExtracted, key: string): string {
  switch (key) {
    case 'destination':
      return extracted.destination || '미정';
    case 'people': {
      const adults = extracted.adult_count ?? 0;
      const children = extracted.child_count ?? 0;
      if (!adults && !children) return '미정';
      return `성인 ${adults || 0}명${children ? `, 아동 ${children}명` : ''}`;
    }
    case 'budget':
      return extracted.budget_per_person
        ? `1인 ${formatMoney(extracted.budget_per_person)}`
        : formatMoney(extracted.total_budget);
    case 'dates': {
      const range = [extracted.departure_date_from, extracted.departure_date_to].filter(Boolean).join(' ~ ');
      if (range && extracted.duration_nights) return `${range}, ${extracted.duration_nights}박`;
      return range || (extracted.duration_nights ? `${extracted.duration_nights}박` : '미정');
    }
    case 'hotel':
      return extracted.hotel_grade || '협의';
    case 'meal':
      return extracted.meal_plan || '협의';
    case 'transport':
      return extracted.transportation || '협의';
    case 'special':
      return extracted.special_requests || '없음';
    default:
      return '미정';
  }
}

function buildEscalationSummary(extracted: RfqExtracted, messages: Message[]): string {
  const summary = [
    `목적지: ${getSummaryValue(extracted, 'destination')}`,
    `인원: ${getSummaryValue(extracted, 'people')}`,
    `예산: ${getSummaryValue(extracted, 'budget')}`,
    `일정: ${getSummaryValue(extracted, 'dates')}`,
    `호텔: ${getSummaryValue(extracted, 'hotel')}`,
    `식사: ${getSummaryValue(extracted, 'meal')}`,
    `교통: ${getSummaryValue(extracted, 'transport')}`,
    `요청: ${getSummaryValue(extracted, 'special')}`,
  ];
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content;
  return lastUserMessage ? `${summary.join('\n')}\n\n최근 고객 메시지: ${lastUserMessage}` : summary.join('\n');
}

export default function GroupInquiryPage() {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: INITIAL_AI_MESSAGE },
  ]);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [interviewState, setInterviewState] = useState<InterviewState>({
    messages: [],
    extracted: {},
    isComplete: false,
    stepsDone: [],
  });
  const [rfqReady, setRfqReady] = useState(false);
  const [extractedSummary, setExtractedSummary] = useState<RfqExtracted>({});
  const [selectedIntent, setSelectedIntent] = useState<IntentChip | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading, rfqReady]);

  const collectedCount = FIELD_GROUPS.filter((field) =>
    field.keys.some((key) => hasValue(interviewState.extracted[key])),
  ).length;
  const progressPct = Math.round((collectedCount / FIELD_GROUPS.length) * 100);
  const requiredReady = Boolean(
    hasValue(extractedSummary.destination) &&
      hasValue(extractedSummary.adult_count) &&
      (hasValue(extractedSummary.budget_per_person) || hasValue(extractedSummary.total_budget)),
  );

  async function sendMessage(messageOverride?: string, chip?: IntentChip) {
    const text = (messageOverride ?? input).trim();

    if (!text) {
      setInputError('목적지, 인원, 예산 중 아는 내용부터 적어주세요.');
      textareaRef.current?.focus();
      return;
    }

    setInputError('');
    setStatusMessage('AI가 조건을 정리하고 있습니다.');
    if (chip) setSelectedIntent(chip);

    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiPromptStarted,
      page_url: window.location.pathname,
      intent: chip?.intent ?? selectedIntent?.intent ?? null,
      budget: chip?.budget ?? null,
      destination: chip?.destination ?? null,
      party_type: chip?.partyType ?? selectedIntent?.partyType ?? null,
      metadata: {
        source: chip ? 'intent_chip' : 'manual_input',
        message_length: text.length,
      },
    });

    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/rfq/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, state: interviewState }),
      });

      if (!res.ok) throw new Error('RFQ interview failed');

      const data = await res.json() as { reply?: string; state?: InterviewState };
      const nextState = data.state ?? interviewState;
      const nextMessages = [...newMessages, { role: 'ai' as const, content: data.reply ?? '조건을 조금 더 알려주세요.' }];

      setMessages(nextMessages);
      setInterviewState(nextState);
      setStatusMessage('');

      if (nextState.isComplete) {
        setRfqReady(true);
        setExtractedSummary(nextState.extracted);
        trackEngagement({
          event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
          page_url: window.location.pathname,
          intent: chip?.intent ?? selectedIntent?.intent ?? null,
          budget: getSummaryValue(nextState.extracted, 'budget'),
          destination: nextState.extracted.destination ?? null,
          party_type: chip?.partyType ?? selectedIntent?.partyType ?? null,
          metadata: {
            source: 'group_inquiry_ai_ready',
            collected_fields: FIELD_GROUPS.filter((field) => field.keys.some((key) => hasValue(nextState.extracted[key]))).map((field) => field.key),
          },
        });
      }
    } catch {
      setStatusMessage('');
      setMessages([
        ...newMessages,
        {
          role: 'ai',
          content: '잠시 연결이 매끄럽지 않습니다. 알고 계신 조건을 한 번 더 보내주시거나, 카카오톡 상담으로 바로 이어가셔도 됩니다.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function validateContact(): boolean {
    const nextErrors: Record<string, string> = {};

    if (!contactName.trim()) nextErrors.contactName = '담당자 이름을 입력해주세요.';
    if (!contactPhone.trim()) nextErrors.contactPhone = '연락 가능한 번호를 입력해주세요.';
    if (!privacyConsent) nextErrors.privacyConsent = '견적 접수를 위해 개인정보 안내에 동의해주세요.';
    if (!requiredReady) nextErrors.summary = '목적지, 인원, 예산 조건이 필요합니다. 채팅으로 한 번만 더 알려주세요.';

    setContactErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function registerRfq() {
    if (!validateContact()) return;

    setSubmitting(true);
    setStatusMessage('견적 요청을 등록하고 있습니다.');

    const payload = {
      ...extractedSummary,
      customer_name: contactName.trim(),
      customer_phone: contactPhone.trim(),
      ai_interview_log: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      custom_requirements: {
        source: 'group_inquiry_ai',
        intent: selectedIntent?.intent ?? null,
        party_type: selectedIntent?.partyType ?? null,
        budget_range_label: getSummaryValue(extractedSummary, 'budget'),
        privacy_consent: privacyConsent,
      },
    };

    try {
      const res = await fetch('/api/rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('RFQ registration failed');

      const data = await res.json() as { id?: string; rfq?: { id?: string } };
      const rfqId = data.id ?? data.rfq?.id;
      if (!rfqId) throw new Error('RFQ id missing');

      trackEngagement({
        event_type: ANALYTICS_EVENTS.stickyCtaClicked,
        page_url: window.location.pathname,
        intent: selectedIntent?.intent ?? null,
        budget: getSummaryValue(extractedSummary, 'budget'),
        destination: extractedSummary.destination ?? null,
        party_type: selectedIntent?.partyType ?? null,
        metadata: {
          source: 'group_inquiry_rfq_submit',
          rfq_id: rfqId,
        },
      });

      router.push(`/rfq/${rfqId}`);
    } catch {
      setStatusMessage('');
      setContactErrors({
        submit: '견적 요청 등록에 실패했습니다. 카카오톡 상담으로 조건을 보내주시면 바로 이어서 도와드릴게요.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function openKakaoFallback(source: string) {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      page_url: window.location.pathname,
      intent: selectedIntent?.intent ?? null,
      budget: getSummaryValue(extractedSummary, 'budget'),
      destination: extractedSummary.destination ?? null,
      party_type: selectedIntent?.partyType ?? null,
      metadata: { source },
    });

    await openKakaoChannel({
      productTitle: '단체 맞춤 견적',
      intent: selectedIntent?.intent ?? null,
      budget: getSummaryValue(extractedSummary, 'budget'),
      destination: extractedSummary.destination ?? null,
      party_type: selectedIntent?.partyType ?? null,
      selected_products: ['단체 맞춤 견적'],
      escalationSummary: buildEscalationSummary(extractedSummary, messages),
      leadForm: {
        name: contactName.trim() || undefined,
        phone: contactPhone.trim() || undefined,
        adults: extractedSummary.adult_count,
        children: extractedSummary.child_count,
      },
    });
  }

  return (
    <main className="min-h-dvh bg-[#F8FAFC] pb-[calc(env(safe-area-inset-bottom)+88px)] md:pb-0">
      <header className="sticky top-0 z-20 border-b border-[#E5E7EB] bg-white/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-brand">단체·맞춤 견적</p>
              <h1 className="mt-1 text-xl font-extrabold text-gray-950 sm:text-2xl">
                AI가 조건을 정리하고 담당자가 견적으로 이어받습니다
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                목적지, 인원, 예산만 먼저 알려주세요. 모르는 항목은 상담 중에 채워도 됩니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void openKakaoFallback('header_kakao')}
              className="hidden shrink-0 items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-gray-800 shadow-sm hover:border-brand/40 md:inline-flex"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              카톡 상담
            </button>
          </div>

          <div className="mt-4" aria-label="견적 정보 수집 진행률">
            <div className="mb-1 flex justify-between text-xs text-gray-500">
              <span>조건 정리 진행률</span>
              <span>{collectedCount}/{FIELD_GROUPS.length}개 확인</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {FIELD_GROUPS.map((field) => {
                const collected = field.keys.some((key) => hasValue(interviewState.extracted[key]));
                return (
                  <span
                    key={field.key}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      collected ? 'bg-brand-light text-brand' : 'bg-white text-gray-400 ring-1 ring-gray-200'
                    }`}
                  >
                    {collected && <Check className="h-3 w-3" aria-hidden="true" />}
                    {field.label}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5">
        {!rfqReady && messages.length <= 1 && (
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-bold text-gray-950">빠른 시작</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {INTENT_CHIPS.map((chip) => (
                <button
                  key={chip.intent}
                  type="button"
                  onClick={() => void sendMessage(chip.prompt, chip)}
                  disabled={loading}
                  className="group flex min-h-14 items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-white px-3 py-3 text-left text-sm font-bold text-gray-800 hover:border-brand/50 hover:bg-brand-light/40 disabled:opacity-50"
                >
                  <span>{chip.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-brand" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4" aria-live="polite">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'ai' && (
                <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </div>
              )}
              <div
                className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'rounded-tr-sm bg-brand text-white'
                    : 'rounded-tl-sm bg-white text-text-primary shadow-sm ring-1 ring-gray-100'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100">
                <Loader2 className="h-4 w-4 animate-spin text-brand" aria-label="AI 답변 준비 중" />
              </div>
            </div>
          )}

          {rfqReady && (
            <section
              aria-labelledby="rfq-summary-title"
              className="rounded-lg border border-blue-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
                  <ClipboardList className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="rfq-summary-title" className="text-base font-extrabold text-gray-950">
                    견적 요청 조건이 정리되었습니다
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    담당자가 연락드릴 수 있도록 기본 연락처만 확인해주세요.
                  </p>
                </div>
              </div>

              {contactErrors.summary && (
                <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">
                  {contactErrors.summary}
                </p>
              )}

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                {FIELD_GROUPS.map((field) => (
                  <div key={field.key} className="rounded-lg bg-[#F8FAFC] px-3 py-3">
                    <dt className="text-xs font-semibold text-gray-500">{field.label}</dt>
                    <dd className="mt-1 font-bold text-gray-900">{getSummaryValue(extractedSummary, field.key)}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="contact-name" className="text-sm font-bold text-gray-900">
                    담당자 이름
                  </label>
                  <input
                    id="contact-name"
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    aria-invalid={Boolean(contactErrors.contactName)}
                    aria-describedby={contactErrors.contactName ? 'contact-name-error' : undefined}
                    autoComplete="name"
                    className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    placeholder="홍길동"
                  />
                  {contactErrors.contactName && (
                    <p id="contact-name-error" className="mt-1 text-xs font-semibold text-red-600">
                      {contactErrors.contactName}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="contact-phone" className="text-sm font-bold text-gray-900">
                    연락처
                  </label>
                  <input
                    id="contact-phone"
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                    aria-invalid={Boolean(contactErrors.contactPhone)}
                    aria-describedby={contactErrors.contactPhone ? 'contact-phone-error' : undefined}
                    autoComplete="tel"
                    inputMode="tel"
                    className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    placeholder="010-0000-0000"
                  />
                  {contactErrors.contactPhone && (
                    <p id="contact-phone-error" className="mt-1 text-xs font-semibold text-red-600">
                      {contactErrors.contactPhone}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <label className="flex items-start gap-2 rounded-lg bg-[#F8FAFC] p-3 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={privacyConsent}
                    onChange={(event) => setPrivacyConsent(event.target.checked)}
                    aria-invalid={Boolean(contactErrors.privacyConsent)}
                    aria-describedby={contactErrors.privacyConsent ? 'privacy-consent-error' : undefined}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                  />
                  <span>
                    견적 상담과 연락을 위해 입력한 정보를 여소남이 확인하는 데 동의합니다.
                    <a href="/privacy" className="ml-1 font-bold text-brand underline underline-offset-2">
                      개인정보 안내
                    </a>
                  </span>
                </label>
                {contactErrors.privacyConsent && (
                  <p id="privacy-consent-error" className="mt-1 text-xs font-semibold text-red-600">
                    {contactErrors.privacyConsent}
                  </p>
                )}
              </div>

              {contactErrors.submit && (
                <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">
                  {contactErrors.submit}
                </p>
              )}

              <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]">
                <button
                  type="button"
                  onClick={registerRfq}
                  disabled={submitting}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-extrabold text-white hover:bg-[#1B64DA] disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                  견적 요청 등록
                </button>
                <button
                  type="button"
                  onClick={() => void openKakaoFallback('summary_kakao')}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-5 py-3 text-sm font-extrabold text-gray-800 hover:border-brand/40"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  카톡으로 이어가기
                </button>
              </div>
            </section>
          )}

          <div ref={bottomRef} />
        </div>
      </section>

      {!rfqReady && (
        <form
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E5E7EB] bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] md:sticky md:shadow-none"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <div className="mx-auto max-w-3xl">
            <label htmlFor="group-inquiry-message" className="sr-only">
              단체여행 견적 문의 메시지
            </label>
            <div className="flex gap-2">
              <textarea
                id="group-inquiry-message"
                ref={textareaRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  if (inputError) setInputError('');
                }}
                onKeyDown={handleKeyDown}
                disabled={loading}
                aria-invalid={Boolean(inputError)}
                aria-describedby={inputError ? 'group-inquiry-message-error' : 'group-inquiry-message-help'}
                placeholder="예: 부산 출발, 성인 20명, 1인 100만원대, 베트남 다낭"
                rows={2}
                className="min-h-14 flex-1 resize-none rounded-lg border border-[#E5E7EB] px-4 py-3 text-sm leading-relaxed outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-brand text-white hover:bg-[#1B64DA] disabled:opacity-50"
                aria-label="메시지 보내기"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
            <p id="group-inquiry-message-help" className="mt-1 text-xs text-gray-500">
              Enter로 전송, Shift+Enter로 줄바꿈
            </p>
            {inputError && (
              <p id="group-inquiry-message-error" className="mt-1 text-xs font-semibold text-red-600" role="alert">
                {inputError}
              </p>
            )}
            <p className="sr-only" aria-live="polite">
              {statusMessage}
            </p>
          </div>
        </form>
      )}
    </main>
  );
}
