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
  Users,
} from 'lucide-react';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { GROUP_INQUIRY_PRODUCT_LABEL } from '@/lib/group-inquiry-handoff';
import { hasHandoffContext, readHandoffContext } from '@/lib/handoff-query';
import { getKakaoChannelChatUrl, openKakaoChannel } from '@/lib/kakaoChannel';
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
  budget_label?: string;
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

const KAKAO_ACTION_DESCRIPTION_ID = 'group-inquiry-kakao-action-description';
const KAKAO_STATUS_ID = 'group-inquiry-kakao-status';
const srStatusProps = (enabled: boolean) => (
  enabled ? { role: 'status', 'aria-live': 'polite', 'aria-atomic': true } as const : {}
);

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

const PARTY_SIZE_OPTIONS = [
  { label: '2명', adults: 2 },
  { label: '4명', adults: 4 },
  { label: '10명', adults: 10 },
  { label: '20명', adults: 20 },
];

const INITIAL_AI_MESSAGE =
  '안녕하세요. 단체여행 전문 컨시어지 AI입니다. 목적지, 인원, 예산만 먼저 알려주시면 견적 요청에 필요한 조건을 빠르게 정리해드릴게요.';

const INTENT_LABELS: Record<string, string> = {
  filial_trip: '효도 여행',
  senior_family_trip: '효도 여행',
  no_shopping_family: '노쇼핑 가족여행',
  no_shopping_family_trip: '노쇼핑 가족여행',
  group_workshop: '단체 워크샵',
  company_workshop: '단체 워크샵',
  golf_compare: '골프 비교',
  golf_comparison: '골프 비교',
  group_trip: '단체 여행',
  family: '부모님/가족',
  budget: '예산 맞춤',
  no_shopping: '쇼핑 없는 상품',
  consult: '상담 추천',
};

const PARTY_LABELS: Record<string, string> = {
  senior_family: '60대 이상 가족',
  family: '가족',
  group_20: '20명 단체',
  company: '기업/워크샵',
  golf: '골프팀',
  golf_group: '골프 모임',
  club: '동호회/모임',
  couple: '커플/허니문',
  group: '단체',
  group_landing: '단체 문의',
};

function resolveHandoffPartyType(intent: string | null, partyType: string | null): string | null {
  const cleanPartyType = partyType?.trim();
  if (cleanPartyType) return cleanPartyType;

  const source = String(intent ?? '').trim().toLowerCase();
  if (!source) return null;
  if (/가족|효도|family|parent/.test(source)) return 'family';
  if (/골프|golf/.test(source)) return 'golf_group';
  if (/허니문|honeymoon|신혼|couple/.test(source)) return 'couple';
  if (/단체|워크샵|workshop|group/.test(source)) return 'group';
  return null;
}

function resolveHandoffIntentLabel(intent: string | null, partyType: string | null): string {
  const cleanIntent = intent?.trim();
  if (!cleanIntent) return 'AI 상담 조건';
  if (INTENT_LABELS[cleanIntent]) return INTENT_LABELS[cleanIntent];

  const source = `${cleanIntent} ${partyType ?? ''}`.toLowerCase();
  if (/노쇼핑|no.?shopping/.test(source)) return '노쇼핑 가족여행';
  if (/효도|senior|filial|parent/.test(source)) return '효도 여행';
  if (/골프|golf/.test(source)) return '골프 비교';
  if (/허니문|honeymoon|신혼|couple/.test(source)) return '허니문/커플 여행';
  if (/단체|워크샵|workshop|group/.test(source)) return '단체 여행';
  return cleanIntent;
}

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

function parseKoreanBudget(value: string | null): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/,/g, '').trim();
  const rawNumber = normalized.match(/\d+(?:\.\d+)?/)?.[0];
  if (!rawNumber) return undefined;
  const numeric = Number(rawNumber);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  if (normalized.includes('억')) return Math.round(numeric * 100000000);
  if (normalized.includes('천만')) return Math.round(numeric * 10000000);
  if (normalized.includes('백만')) return Math.round(numeric * 1000000);
  if (normalized.includes('만원')) return Math.round(numeric * 10000);
  return Math.round(numeric);
}

function parsePartyCount(value: string | null): number | undefined {
  if (!value) return undefined;
  const directCount = value.match(/(\d+)\s*명/)?.[1] ?? value.match(/group_(\d+)/)?.[1];
  if (!directCount) return undefined;
  const count = Number(directCount);
  return Number.isFinite(count) && count > 0 ? count : undefined;
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
      if (typeof extracted.budget_label === 'string' && extracted.budget_label.trim()) return extracted.budget_label;
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
  const appliedHandoffRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contactNameRef = useRef<HTMLInputElement>(null);
  const contactPhoneRef = useRef<HTMLInputElement>(null);
  const privacyConsentRef = useRef<HTMLInputElement>(null);
  const summaryErrorRef = useRef<HTMLParagraphElement>(null);
  const summaryKakaoRef = useRef<HTMLButtonElement>(null);
  const kakaoStatusRef = useRef<HTMLDivElement | null>(null);

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
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [handoffSource, setHandoffSource] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [kakaoOpening, setKakaoOpening] = useState(false);
  const [kakaoStatus, setKakaoStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const kakaoActionDescriptionIds = kakaoStatus
    ? `${KAKAO_ACTION_DESCRIPTION_ID} ${KAKAO_STATUS_ID}`
    : KAKAO_ACTION_DESCRIPTION_ID;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading, rfqReady]);

  useEffect(() => {
    if (!rfqReady) return;
    const frame = window.requestAnimationFrame(() => contactNameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [rfqReady]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const handoffKey = searchParams.toString();
    if (!handoffKey || appliedHandoffRef.current === handoffKey) return;
    appliedHandoffRef.current = handoffKey;

    const handoff = readHandoffContext(searchParams);
    if (!hasHandoffContext(handoff)) return;

    const { intent, partyType, budget, destination, query } = handoff;
    const productNames = handoff.selectedProducts;
    const normalizedPartyType = resolveHandoffPartyType(intent, partyType);
    const matchedChip = intent ? INTENT_CHIPS.find((chip) => chip.intent === intent) : undefined;
    const nextIntent: IntentChip = matchedChip ?? {
      label: resolveHandoffIntentLabel(intent, normalizedPartyType),
      prompt: query || [destination, budget, PARTY_LABELS[normalizedPartyType ?? ''] ?? normalizedPartyType].filter(Boolean).join(', '),
      intent: intent ?? 'group_trip',
      partyType: normalizedPartyType ?? 'group',
      destination: destination ?? undefined,
      budget: budget ?? undefined,
    };
    setSelectedIntent(nextIntent);
    setSelectedProducts(productNames);
    setHandoffSource(handoff.source ?? 'concierge');

    const parsedBudget = parseKoreanBudget(budget);
    const parsedPeople = parsePartyCount(normalizedPartyType) ?? parsePartyCount(query);
    const nextExtracted: RfqExtracted = {
      destination: destination ?? undefined,
      adult_count: parsedPeople,
      budget_per_person: budget?.includes('1인') ? parsedBudget : undefined,
      total_budget: budget && !budget.includes('1인') ? parsedBudget : undefined,
      budget_label: budget ?? undefined,
      special_requests: [
        query ? `상담 요청: ${query}` : null,
        productNames.length > 0 ? `관심 상품: ${productNames.join(', ')}` : null,
      ].filter(Boolean).join('\n') || undefined,
    };
    setExtractedSummary((current) => ({ ...nextExtracted, ...current }));
    setInterviewState((current) => ({
      ...current,
      extracted: { ...nextExtracted, ...current.extracted },
      stepsDone: Array.from(new Set([...current.stepsDone, 'handoff_context'])),
    }));
    if (hasValue(nextExtracted.destination) && hasValue(nextExtracted.adult_count) && hasValue(nextExtracted.budget_label)) {
      setRfqReady(true);
    }
    setMessages((current) => {
      if (current.some((message) => message.role === 'ai' && message.content.includes('이전 상담 조건을 이어받았습니다'))) {
        return current;
      }
      return [
        ...current,
        {
          role: 'ai',
          content: '이전 상담 조건을 이어받았습니다. 부족한 항목만 채우면 바로 견적 요청으로 넘길 수 있어요.',
        },
      ];
    });
  }, []);

  const collectedCount = FIELD_GROUPS.filter((field) =>
    field.keys.some((key) => hasValue(interviewState.extracted[key])),
  ).length;
  const progressPct = Math.round((collectedCount / FIELD_GROUPS.length) * 100);
  const requiredReady = Boolean(
    hasValue(extractedSummary.destination) &&
      hasValue(extractedSummary.adult_count) &&
      (hasValue(extractedSummary.budget_per_person) || hasValue(extractedSummary.total_budget) || hasValue(extractedSummary.budget_label)),
  );
  const rfqReadinessChecklist = [
    { label: '목적지', complete: hasValue(extractedSummary.destination) },
    { label: '인원', complete: hasValue(extractedSummary.adult_count) },
    {
      label: '예산',
      complete: hasValue(extractedSummary.budget_per_person) || hasValue(extractedSummary.total_budget) || hasValue(extractedSummary.budget_label),
    },
  ];
  const rfqReadinessReadyCount = rfqReadinessChecklist.filter((item) => item.complete).length;
  const rfqReadinessMissingLabels = rfqReadinessChecklist.filter((item) => !item.complete).map((item) => item.label);
  const contactReadinessChecklist = [
    { label: '이름', complete: contactName.trim().length > 0 },
    { label: '연락처', complete: contactPhone.trim().length > 0 },
    { label: '개인정보 동의', complete: privacyConsent },
  ];
  const contactReadyCount = contactReadinessChecklist.filter((item) => item.complete).length;
  const contactMissingLabels = contactReadinessChecklist.filter((item) => !item.complete).map((item) => item.label);
  const rfqReadinessSummaryText = rfqReadinessMissingLabels.length > 0
    ? `견적 요청 준비 ${rfqReadinessReadyCount}/${rfqReadinessChecklist.length}. 보완이 필요한 조건은 ${rfqReadinessMissingLabels.join(', ')}입니다.`
    : `견적 요청 준비 ${rfqReadinessReadyCount}/${rfqReadinessChecklist.length}. 바로 견적 요청을 보낼 수 있습니다.`;
  const submitMissingLabels = [...rfqReadinessMissingLabels, ...contactMissingLabels];
  const submitReadyCount = rfqReadinessReadyCount + contactReadyCount;
  const submitTotalCount = rfqReadinessChecklist.length + contactReadinessChecklist.length;
  const submitReadinessSummaryText = submitMissingLabels.length > 0
    ? `제출 준비 ${submitReadyCount}/${submitTotalCount}. 보완 필요: ${submitMissingLabels.join(', ')}.`
    : `제출 준비 ${submitReadyCount}/${submitTotalCount}. 바로 견적 요청을 보낼 수 있습니다.`;
  const stickyNextActionId = 'group-inquiry-sticky-next-action';
  const stickyNextActionText = loading
    ? 'AI가 입력한 조건을 정리하고 있습니다.'
    : rfqReadinessMissingLabels.length > 0
      ? `다음으로 ${rfqReadinessMissingLabels[0]} 조건을 알려주세요.`
      : requiredReady
        ? '필수 조건이 준비되었습니다. 추가 요청사항을 남기거나 연락처 입력으로 넘어갈 수 있습니다.'
        : '목적지, 인원, 예산 중 아는 내용부터 알려주세요.';
  const stickyHandoffItems = [
    { label: '목적', value: selectedIntent?.label },
    { label: '지역', value: getSummaryValue(extractedSummary, 'destination') },
    { label: '예산', value: getSummaryValue(extractedSummary, 'budget') },
    selectedProducts.length > 0 ? { label: '상품', value: `${selectedProducts.length}개` } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item?.value && item.value !== '미정'));
  const rfqConditionSummaryId = 'group-inquiry-rfq-condition-summary';
  const rfqContactHelpId = 'group-inquiry-rfq-contact-help';
  const rfqSubmitDescriptionId = 'group-inquiry-rfq-submit-description';
  const submitReadinessSummaryId = 'group-inquiry-submit-readiness-summary';
  const submitDecisionSummaryId = 'group-inquiry-submit-decision-summary';
  const handoffContextDescriptionId = 'group-inquiry-handoff-context-description';
  const handoffReadinessSummaryId = 'group-inquiry-handoff-readiness-summary';
  const intentChipGroupDescriptionId = 'group-inquiry-intent-chip-group-description';
  const intentChipStatusId = 'group-inquiry-intent-chip-status';
  const handoffContextSummaryText = [
    handoffSource ? `유입 경로는 ${handoffSource}입니다.` : null,
    selectedIntent?.label ? `상담 목적은 ${selectedIntent.label}입니다.` : null,
    selectedIntent?.partyType ? `동행 유형은 ${PARTY_LABELS[selectedIntent.partyType] ?? selectedIntent.partyType}입니다.` : null,
    `지역은 ${getSummaryValue(extractedSummary, 'destination')}입니다.`,
    `예산은 ${getSummaryValue(extractedSummary, 'budget')}입니다.`,
    selectedProducts.length > 0 ? `관심 상품은 ${selectedProducts.join(', ')}입니다.` : null,
    requiredReady ? '필수 조건이 준비되어 견적 요청을 보낼 수 있습니다.' : '견적 요청에는 목적지, 인원, 예산 조건이 필요합니다.',
  ].filter(Boolean).join(' ');
  const rfqConditionSummaryText = FIELD_GROUPS
    .map((field) => `${field.label} ${getSummaryValue(extractedSummary, field.key)}`)
    .join(', ');
  const submitDecisionItems = [
    { label: '상품', value: selectedProducts.length > 0 ? `${selectedProducts.length}개` : GROUP_INQUIRY_PRODUCT_LABEL },
    { label: '목적지', value: getSummaryValue(extractedSummary, 'destination') },
    { label: '예산', value: getSummaryValue(extractedSummary, 'budget') },
  ];
  const selectedProductsPreviewText = selectedProducts.length > 0
    ? `${selectedProducts.slice(0, 3).join(', ')}${selectedProducts.length > 3 ? ` 외 ${selectedProducts.length - 3}개` : ''}`
    : GROUP_INQUIRY_PRODUCT_LABEL;
  const submitHandoffDecisionText = selectedProducts.length > 0
    ? `연결 상품: ${selectedProductsPreviewText}. 상담원이 이 후보를 기준으로 단체 가능 여부와 추가 옵션을 확인합니다.`
    : `연결 상품은 ${GROUP_INQUIRY_PRODUCT_LABEL}로 접수되며, 상담원이 조건에 맞는 후보를 찾아 안내합니다.`;
  const submitDecisionSummaryText = `최종 제출 요약: ${submitDecisionItems.map((item) => `${item.label} ${item.value}`).join(', ')}. ${submitHandoffDecisionText} ${submitReadinessSummaryText}`;
  const submitHandoffPreviewText = `상담 전달 미리보기: ${handoffContextSummaryText} 정리 조건은 ${rfqConditionSummaryText}입니다. 연락처 이름 ${contactName.trim() ? '입력됨' : '미입력'}, 전화번호 ${contactPhone.trim() ? '입력됨' : '미입력'}, 개인정보 동의 ${privacyConsent ? '완료' : '미완료'}.`;
  const groupInquiryDecisionMetadata = {
    handoff_source: handoffSource,
    selected_intent_label: selectedIntent?.label ?? null,
    rfq_ready_count: rfqReadinessReadyCount,
    contact_ready_count: contactReadyCount,
    ready_count: submitReadyCount,
    missing_fields: submitMissingLabels,
    decision_summary: submitDecisionSummaryText,
    handoff_decision: submitHandoffDecisionText,
    handoff_preview: submitHandoffPreviewText,
    next_action: stickyNextActionText,
    condition_summary: rfqConditionSummaryText,
    has_contact_name: contactName.trim().length > 0,
    has_contact_phone: contactPhone.trim().length > 0,
    privacy_consent: privacyConsent,
  };
  const intentChipStatusText = loading
    ? 'AI가 선택한 빠른 시작 조건을 정리하고 있습니다.'
    : selectedIntent
      ? `${selectedIntent.label} 조건이 선택되어 상담 전달 조건에 반영되었습니다.`
      : '빠른 시작 조건을 선택하면 AI 상담이 바로 시작됩니다.';
  const handoffReadinessLive = Boolean(rfqReady || selectedIntent || selectedProducts.length > 0 || handoffSource || messages.length > 1);
  const intentChipStatusLive = Boolean(loading || selectedIntent);
  const messageListLive = Boolean(loading || messages.length > 1);
  const rfqContactDescriptionIds = `${handoffContextDescriptionId} ${handoffReadinessSummaryId} ${rfqConditionSummaryId} ${submitReadinessSummaryId} ${rfqContactHelpId}`;
  const contactNameDescriptionIds = contactErrors.contactName
    ? `${rfqContactDescriptionIds} contact-name-error`
    : rfqContactDescriptionIds;
  const contactPhoneDescriptionIds = contactErrors.contactPhone
    ? `${rfqContactDescriptionIds} contact-phone-error`
    : rfqContactDescriptionIds;
  const privacyConsentDescriptionIds = contactErrors.privacyConsent
    ? `${rfqContactDescriptionIds} privacy-consent-error`
    : rfqContactDescriptionIds;
  const rfqSubmitDescriptionIds = [
    handoffContextDescriptionId,
    handoffReadinessSummaryId,
    rfqConditionSummaryId,
    submitReadinessSummaryId,
    submitDecisionSummaryId,
    rfqSubmitDescriptionId,
    contactErrors.submit ? 'group-inquiry-submit-error' : null,
    contactErrors.summary ? 'group-inquiry-summary-error' : null,
    submitting ? 'group-inquiry-status' : null,
  ].filter(Boolean).join(' ');

  async function sendMessage(messageOverride?: string, chip?: IntentChip) {
    if (loading) return;
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
      source: chip ? 'group_inquiry_intent_chip' : 'group_inquiry_manual_input',
      page_url: window.location.pathname,
      intent: chip?.intent ?? selectedIntent?.intent ?? null,
      budget: chip?.budget ?? null,
      destination: chip?.destination ?? null,
      party_type: chip?.partyType ?? selectedIntent?.partyType ?? null,
      selected_products: selectedProducts.length > 0 ? selectedProducts : null,
      metadata: {
        source: chip ? 'intent_chip' : 'manual_input',
        handoff_source: handoffSource,
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
          source: 'group_inquiry_ai_ready',
          page_url: window.location.pathname,
          intent: chip?.intent ?? selectedIntent?.intent ?? null,
          budget: getSummaryValue(nextState.extracted, 'budget'),
          destination: nextState.extracted.destination ?? null,
          party_type: chip?.partyType ?? selectedIntent?.partyType ?? null,
          selected_products: selectedProducts.length > 0 ? selectedProducts : null,
          ready_count: submitReadyCount,
          missing_fields: submitMissingLabels,
          decision_summary: submitDecisionSummaryText,
          handoff_preview: submitHandoffPreviewText,
          next_action: stickyNextActionText,
          metadata: {
            ...groupInquiryDecisionMetadata,
            source: 'group_inquiry_ai_ready',
            handoff_source: handoffSource,
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

  function applyPartySize(adults: number) {
    const nextExtracted: RfqExtracted = {
      ...extractedSummary,
      adult_count: adults,
    };
    setExtractedSummary(nextExtracted);
    setInterviewState((current) => ({
      ...current,
      extracted: { ...current.extracted, adult_count: adults },
      stepsDone: Array.from(new Set([...current.stepsDone, 'party_size_quick_select'])),
    }));
    setContactErrors((current) => {
      if (!current.summary && !current.submit) return current;
      const next = { ...current };
      delete next.summary;
      delete next.submit;
      return next;
    });
    setInputError('');
    setStatusMessage(`${adults}명 기준으로 견적 조건을 보완했습니다.`);
    setMessages((current) => {
      if (current.some((message) => message.role === 'user' && message.content === `인원 ${adults}명`)) return current;
      return [...current, { role: 'user', content: `인원 ${adults}명` }];
    });
    if (
      hasValue(nextExtracted.destination) &&
      hasValue(nextExtracted.adult_count) &&
      (hasValue(nextExtracted.budget_per_person) || hasValue(nextExtracted.total_budget) || hasValue(nextExtracted.budget_label))
    ) {
      setRfqReady(true);
    }
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
      source: 'group_inquiry_party_size_quick_select',
      page_url: window.location.pathname,
      intent: selectedIntent?.intent ?? null,
      budget: getSummaryValue(nextExtracted, 'budget'),
      destination: nextExtracted.destination ?? null,
      party_type: selectedIntent?.partyType ?? null,
      selected_products: selectedProducts.length > 0 ? selectedProducts : null,
      metadata: {
        selected_adult_count: adults,
        handoff_source: handoffSource,
      },
    });
  }

  function validateContact(): boolean {
    const nextErrors: Record<string, string> = {};

    if (!contactName.trim()) nextErrors.contactName = '담당자 이름을 입력해주세요.';
    if (!contactPhone.trim()) nextErrors.contactPhone = '연락 가능한 번호를 입력해주세요.';
    if (!privacyConsent) nextErrors.privacyConsent = '견적 접수를 위해 개인정보 안내에 동의해주세요.';
    if (!requiredReady) nextErrors.summary = '목적지, 인원, 예산 조건이 필요합니다. 채팅으로 한 번만 더 알려주세요.';

    setContactErrors(nextErrors);
    window.requestAnimationFrame(() => {
      if (nextErrors.contactName) {
        contactNameRef.current?.focus();
        return;
      }
      if (nextErrors.contactPhone) {
        contactPhoneRef.current?.focus();
        return;
      }
      if (nextErrors.privacyConsent) {
        privacyConsentRef.current?.focus();
        return;
      }
      if (nextErrors.summary) {
        summaryErrorRef.current?.focus();
      }
    });
    return Object.keys(nextErrors).length === 0;
  }

  function clearContactErrors(...keys: string[]) {
    setContactErrors((current) => {
      if (keys.every((key) => !current[key])) return current;
      const next = { ...current };
      keys.forEach((key) => {
        delete next[key];
      });
      return next;
    });
  }

  async function registerRfq() {
    if (!validateContact()) return;

    setSubmitting(true);
    setStatusMessage('견적 요청을 등록하고 있습니다.');

    const rfqSelectedProducts = selectedProducts.length > 0 ? selectedProducts : [GROUP_INQUIRY_PRODUCT_LABEL];

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
        handoff_source: handoffSource,
        intent: selectedIntent?.intent ?? null,
        party_type: selectedIntent?.partyType ?? null,
        budget_range_label: getSummaryValue(extractedSummary, 'budget'),
        selected_products: rfqSelectedProducts,
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
        cta_type: 'group_inquiry_rfq_submit',
        page_url: window.location.pathname,
        intent: selectedIntent?.intent ?? null,
        budget: getSummaryValue(extractedSummary, 'budget'),
      destination: extractedSummary.destination ?? null,
      party_type: selectedIntent?.partyType ?? null,
      selected_products: rfqSelectedProducts,
      ready_count: submitReadyCount,
      missing_fields: submitMissingLabels,
      decision_summary: submitDecisionSummaryText,
      handoff_preview: submitHandoffPreviewText,
      next_action: stickyNextActionText,
      metadata: {
        source: 'group_inquiry_rfq_submit',
        outcome: 'rfq_created',
          rfq_id: rfqId,
          adult_count: extractedSummary.adult_count ?? null,
          child_count: extractedSummary.child_count ?? null,
          budget_per_person: extractedSummary.budget_per_person ?? null,
          total_budget: extractedSummary.total_budget ?? null,
          ...groupInquiryDecisionMetadata,
        },
      });

      router.push(`/rfq/${rfqId}`);
    } catch {
      setStatusMessage('');
      setContactErrors({
        submit: '견적 요청 등록에 실패했습니다. 카카오톡 상담으로 조건을 보내주시면 바로 이어서 도와드릴게요.',
      });
      window.requestAnimationFrame(() => summaryKakaoRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  async function openKakaoFallback(source: string) {
    const kakaoSelectedProducts = selectedProducts.length > 0 ? selectedProducts : [GROUP_INQUIRY_PRODUCT_LABEL];
    setKakaoStatus(null);
    setKakaoOpening(true);

    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      cta_type: source,
      page_url: window.location.pathname,
      intent: selectedIntent?.intent ?? null,
      budget: getSummaryValue(extractedSummary, 'budget'),
      destination: extractedSummary.destination ?? null,
      party_type: selectedIntent?.partyType ?? null,
      selected_products: kakaoSelectedProducts,
      ready_count: submitReadyCount,
      missing_fields: submitMissingLabels,
      decision_summary: submitDecisionSummaryText,
      handoff_preview: submitHandoffPreviewText,
      next_action: stickyNextActionText,
      metadata: {
        source,
        ...groupInquiryDecisionMetadata,
      },
    });

    try {
      await openKakaoChannel({
        productTitle: GROUP_INQUIRY_PRODUCT_LABEL,
        intent: selectedIntent?.intent ?? null,
        budget: getSummaryValue(extractedSummary, 'budget'),
        destination: extractedSummary.destination ?? null,
        party_type: selectedIntent?.partyType ?? null,
        selected_products: kakaoSelectedProducts,
        escalationSummary: buildEscalationSummary(extractedSummary, messages),
        leadForm: {
          name: contactName.trim() || undefined,
          phone: contactPhone.trim() || undefined,
          adults: extractedSummary.adult_count,
          children: extractedSummary.child_count,
        },
      });
      setKakaoStatus({
        tone: 'success',
        message: '카카오 상담 문구를 복사했고 상담창을 열었습니다. 새 창이 보이지 않으면 아래 링크로 다시 열 수 있어요.',
      });
    } catch {
      setKakaoStatus({
        tone: 'error',
        message: '카카오 상담창을 열지 못했습니다. 아래 링크로 직접 열고 복사된 상담 문구를 붙여넣어 주세요.',
      });
      requestAnimationFrame(() => kakaoStatusRef.current?.focus());
    } finally {
      setKakaoOpening(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#F8FAFC] pb-[calc(env(safe-area-inset-bottom)+144px)] md:pb-0">
      <p id={handoffContextDescriptionId} className="sr-only">
        {handoffContextSummaryText}
      </p>
      <p id={handoffReadinessSummaryId} className="sr-only" {...srStatusProps(handoffReadinessLive)}>
        {rfqReadinessSummaryText}
      </p>
      <p
        id="group-inquiry-status"
        className="sr-only"
        {...(statusMessage ? { 'aria-live': 'polite' as const, 'aria-atomic': true } : {})}
      >
        {statusMessage}
      </p>
      <p id={KAKAO_ACTION_DESCRIPTION_ID} className="sr-only">
        상담 조건을 복사한 뒤 카카오톡 채널 상담창을 새 창으로 엽니다.
      </p>
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
              disabled={kakaoOpening}
              aria-busy={kakaoOpening}
              aria-describedby={kakaoActionDescriptionIds}
              className="hidden shrink-0 items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-gray-800 shadow-sm hover:border-brand/40 md:inline-flex"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {kakaoOpening ? '카톡 여는 중...' : '카톡 상담'}
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
        {kakaoStatus && (
          <div
            ref={kakaoStatusRef}
            id={KAKAO_STATUS_ID}
            data-testid="group-inquiry-kakao-status"
            role={kakaoStatus.tone === 'error' ? 'alert' : 'status'}
            aria-live={kakaoStatus.tone === 'error' ? 'assertive' : 'polite'}
            tabIndex={-1}
            className={`rounded-lg border px-4 py-3 text-sm font-semibold outline-none ${
              kakaoStatus.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-blue-100 bg-blue-50 text-blue-800'
            }`}
          >
            <p>{kakaoStatus.message}</p>
            <a
              href={getKakaoChannelChatUrl()}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="group-inquiry-kakao-fallback"
              className="mt-2 inline-flex font-extrabold underline underline-offset-4"
            >
              카카오 상담창 직접 열기
            </a>
          </div>
        )}

        {(handoffSource || selectedProducts.length > 0) && (
          <section
            data-testid="group-inquiry-handoff-summary"
            aria-labelledby="handoff-summary-title"
            aria-describedby={`${handoffContextDescriptionId} ${handoffReadinessSummaryId}`}
            className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
                <ClipboardList className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="handoff-summary-title" className="text-sm font-extrabold text-gray-950">
                    이어받은 상담 조건
                  </h2>
                  {handoffSource && (
                    <span
                      data-testid="group-inquiry-handoff-source"
                      className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-extrabold text-blue-700"
                    >
                      {handoffSource}
                    </span>
                  )}
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div data-testid="group-inquiry-handoff-intent" className="rounded-lg bg-[#F8FAFC] px-3 py-2">
                    <dt className="text-xs font-semibold text-gray-500">의도</dt>
                    <dd className="mt-1 font-bold text-gray-900">{selectedIntent?.label ?? '직접 문의'}</dd>
                  </div>
                  <div data-testid="group-inquiry-handoff-party" className="rounded-lg bg-[#F8FAFC] px-3 py-2">
                    <dt className="text-xs font-semibold text-gray-500">동행</dt>
                    <dd className="mt-1 font-bold text-gray-900">
                      {PARTY_LABELS[selectedIntent?.partyType ?? ''] ?? selectedIntent?.partyType ?? '미정'}
                    </dd>
                  </div>
                  <div data-testid="group-inquiry-handoff-destination" className="rounded-lg bg-[#F8FAFC] px-3 py-2">
                    <dt className="text-xs font-semibold text-gray-500">지역</dt>
                    <dd className="mt-1 font-bold text-gray-900">{getSummaryValue(extractedSummary, 'destination')}</dd>
                  </div>
                  <div data-testid="group-inquiry-handoff-budget" className="rounded-lg bg-[#F8FAFC] px-3 py-2">
                    <dt className="text-xs font-semibold text-gray-500">예산</dt>
                    <dd className="mt-1 font-bold text-gray-900">{getSummaryValue(extractedSummary, 'budget')}</dd>
                  </div>
                </dl>
                {selectedProducts.length > 0 && (
                  <div data-testid="group-inquiry-handoff-products" className="mt-3 rounded-lg bg-blue-50 px-3 py-2">
                    <p className="text-xs font-semibold text-blue-700">관심 상품 {selectedProducts.length}개</p>
                    <p className="mt-1 line-clamp-2 text-sm font-bold text-gray-900">{selectedProducts.join(', ')}</p>
                  </div>
                )}
                <div
                  data-testid="group-inquiry-handoff-readiness-summary"
                  aria-label={rfqReadinessSummaryText}
                  className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${
                    requiredReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  <span>견적 요청 준비 {rfqReadinessReadyCount}/{rfqReadinessChecklist.length}</span>
                  <span className="ml-2 font-medium">
                    {rfqReadinessMissingLabels.length > 0 ? `보완 필요: ${rfqReadinessMissingLabels.join(', ')}` : '바로 등록 가능'}
                  </span>
                </div>
                {handoffSource && !hasValue(extractedSummary.adult_count) && (
                  <div
                    data-testid="group-inquiry-party-size-quick-select"
                    className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-brand" aria-hidden="true" />
                      <p className="text-xs font-extrabold text-gray-700">인원만 선택하면 견적 준비가 빨라집니다</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="빠른 인원 선택">
                      {PARTY_SIZE_OPTIONS.map((option) => (
                        <button
                          key={option.adults}
                          type="button"
                          data-testid="group-inquiry-party-size-chip"
                          onClick={() => applyPartySize(option.adults)}
                          className="inline-flex min-h-8 items-center rounded-full border border-[#D7E3F3] bg-white px-3 text-[12px] font-extrabold text-gray-800 transition hover:border-brand/60 hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {!rfqReady && (messages.length <= 1 || loading) && (
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />
              <h2 id="group-inquiry-intent-chip-title" className="text-sm font-bold text-gray-950">빠른 시작</h2>
            </div>
            <p id={intentChipGroupDescriptionId} className="sr-only">
              빠른 시작 칩을 선택하면 해당 상담 조건이 메시지로 전송되고, 목적과 여행 유형이 상담 전달 조건에 반영됩니다.
            </p>
            <p id={intentChipStatusId} className="sr-only" {...srStatusProps(intentChipStatusLive)}>
              {intentChipStatusText}
            </p>
            <div
              className="grid gap-2 sm:grid-cols-2"
              role="group"
              aria-labelledby="group-inquiry-intent-chip-title"
              aria-describedby={`${intentChipGroupDescriptionId} ${intentChipStatusId}`}
            >
              {INTENT_CHIPS.map((chip) => {
                const selected = selectedIntent?.intent === chip.intent;
                const intentChipDescriptionId = `group-inquiry-intent-chip-${chip.intent}-description`;
                return (
                  <button
                    key={chip.intent}
                    type="button"
                    data-testid="group-inquiry-intent-chip"
                    aria-pressed={selected}
                    aria-busy={loading && selected}
                    aria-describedby={`${intentChipGroupDescriptionId} ${intentChipDescriptionId} ${intentChipStatusId}`}
                    onClick={() => void sendMessage(chip.prompt, chip)}
                    disabled={loading}
                    className={`group flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left text-sm font-bold transition disabled:opacity-50 ${
                      selected
                        ? 'border-brand bg-brand text-white shadow-sm'
                        : 'border-[#E5E7EB] bg-white text-gray-800 hover:border-brand/50 hover:bg-brand-light/40'
                    }`}
                  >
                    <span id={intentChipDescriptionId} className="sr-only">
                      {chip.label} 조건으로 AI 상담을 시작합니다. 여행 유형은 {PARTY_LABELS[chip.partyType] ?? chip.partyType}이고{chip.budget ? ` 예산은 ${chip.budget}` : ''}{chip.destination ? ` 목적지는 ${chip.destination}` : ''}입니다.
                    </span>
                    <span>{chip.label}</span>
                    <ArrowRight className={`h-4 w-4 shrink-0 ${selected ? 'text-white' : 'text-gray-400 group-hover:text-brand'}`} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-4" {...(messageListLive ? { 'aria-live': 'polite' as const } : {})}>
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
              data-testid="group-inquiry-rfq-summary"
              aria-labelledby="rfq-summary-title"
              aria-describedby={`${rfqContactHelpId} ${rfqConditionSummaryId}`}
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
                  <p id={rfqContactHelpId} className="mt-1 text-sm text-gray-500">
                    담당자가 연락드릴 수 있도록 기본 연락처만 확인해주세요.
                  </p>
                </div>
              </div>

              {contactErrors.summary && (
                <p
                  ref={summaryErrorRef}
                  id="group-inquiry-summary-error"
                  className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 outline-none focus:ring-2 focus:ring-red-200"
                  role="alert"
                  tabIndex={-1}
                >
                  {contactErrors.summary}
                </p>
              )}

              <p id={rfqConditionSummaryId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                현재 견적 조건은 {rfqConditionSummaryText}입니다.
              </p>

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
                    ref={contactNameRef}
                    data-testid="group-inquiry-contact-name"
                    value={contactName}
                    onChange={(event) => {
                      setContactName(event.target.value);
                      clearContactErrors('contactName', 'submit');
                    }}
                    aria-invalid={Boolean(contactErrors.contactName)}
                    aria-describedby={contactNameDescriptionIds}
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
                    ref={contactPhoneRef}
                    data-testid="group-inquiry-contact-phone"
                    value={contactPhone}
                    onChange={(event) => {
                      setContactPhone(event.target.value);
                      clearContactErrors('contactPhone', 'submit');
                    }}
                    aria-invalid={Boolean(contactErrors.contactPhone)}
                    aria-describedby={contactPhoneDescriptionIds}
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
                    ref={privacyConsentRef}
                    data-testid="group-inquiry-privacy-consent"
                    checked={privacyConsent}
                    onChange={(event) => {
                      setPrivacyConsent(event.target.checked);
                      clearContactErrors('privacyConsent', 'submit');
                    }}
                    aria-invalid={Boolean(contactErrors.privacyConsent)}
                    aria-describedby={privacyConsentDescriptionIds}
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

              <div
                id={submitReadinessSummaryId}
                data-testid="group-inquiry-submit-readiness-summary"
                aria-label={submitReadinessSummaryText}
                className="mt-4 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-extrabold text-gray-950">
                    제출 준비 {submitReadyCount}/{submitTotalCount}
                  </p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    submitMissingLabels.length > 0 ? 'bg-white text-gray-500 ring-1 ring-gray-200' : 'bg-brand-light text-brand'
                  }`}
                  >
                    {submitMissingLabels.length > 0 ? '보완 필요' : '바로 제출 가능'}
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  <div data-testid="group-inquiry-submit-condition-readiness">
                    <p className="mb-1.5 text-[11px] font-extrabold text-gray-500">견적 조건</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {rfqReadinessChecklist.map((item) => (
                        <span
                          key={`condition:${item.label}`}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold ${
                            item.complete ? 'bg-white text-brand ring-1 ring-brand/20' : 'bg-white text-gray-500 ring-1 ring-gray-200'
                          }`}
                        >
                          {item.complete && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div data-testid="group-inquiry-submit-contact-readiness">
                    <p className="mb-1.5 text-[11px] font-extrabold text-gray-500">연락 준비</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {contactReadinessChecklist.map((item) => (
                        <span
                          key={`contact:${item.label}`}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold ${
                            item.complete ? 'bg-white text-brand ring-1 ring-brand/20' : 'bg-white text-gray-500 ring-1 ring-gray-200'
                          }`}
                        >
                          {item.complete && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                {submitMissingLabels.length > 0 ? (
                  <p className="mt-2 text-xs font-semibold text-gray-500">
                    남은 항목: {submitMissingLabels.join(', ')}
                  </p>
                ) : (
                  <p className="mt-2 text-xs font-semibold text-brand">
                    조건과 연락처가 준비되어 바로 견적 요청을 보낼 수 있습니다.
                  </p>
                )}
                <div
                  id={submitDecisionSummaryId}
                  data-testid="group-inquiry-submit-decision-summary"
                  aria-label={submitDecisionSummaryText}
                  className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2"
                >
                  {submitDecisionItems.map((item) => (
                    <div key={`${item.label}-${item.value}`} className="min-w-0 rounded-md bg-[#F8FAFC] px-2 py-1.5">
                      <p className="text-[10px] font-extrabold text-gray-500">{item.label}</p>
                      <p className="mt-0.5 truncate text-[11px] font-black text-gray-950">{item.value}</p>
                    </div>
                  ))}
                  <p
                    data-testid="group-inquiry-submit-handoff-decision"
                    className="col-span-3 rounded-md bg-blue-50 px-2.5 py-2 text-xs font-bold leading-relaxed text-blue-800"
                  >
                    {submitHandoffDecisionText}
                  </p>
                </div>
              </div>

              {contactErrors.submit && (
                <p
                  id="group-inquiry-submit-error"
                  className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                  role="alert"
                >
                  {contactErrors.submit}
                </p>
              )}

              <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]">
                <p id={rfqSubmitDescriptionId} className="sr-only">
                  제출하면 현재 정리된 견적 조건과 연락처가 상담 접수로 전달됩니다.
                </p>
                <button
                  type="button"
                  data-testid="group-inquiry-rfq-submit"
                  onClick={registerRfq}
                  disabled={submitting}
                  aria-busy={submitting}
                  aria-describedby={rfqSubmitDescriptionIds}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-extrabold text-white hover:bg-[#1B64DA] disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                  {submitting ? '등록 중...' : '견적 요청 등록'}
                </button>
                <button
                  type="button"
                  ref={summaryKakaoRef}
                  data-testid="group-inquiry-summary-kakao"
                  onClick={() => void openKakaoFallback('summary_kakao')}
                  disabled={kakaoOpening}
                  aria-busy={kakaoOpening}
                  aria-describedby={kakaoActionDescriptionIds}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-5 py-3 text-sm font-extrabold text-gray-800 hover:border-brand/40"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {kakaoOpening ? '카톡 여는 중...' : '카톡으로 이어가기'}
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
            {stickyHandoffItems.length > 0 && (
              <div
                className="mb-2 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-2 no-scrollbar"
                aria-label="상담 전달 조건"
                aria-describedby={`${handoffContextDescriptionId} ${handoffReadinessSummaryId} ${stickyNextActionId}`}
                data-testid="group-inquiry-sticky-handoff-summary"
              >
                <span
                  data-testid="group-inquiry-sticky-readiness"
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                    requiredReady ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  준비 {rfqReadinessReadyCount}/{rfqReadinessChecklist.length}
                </span>
                {stickyHandoffItems.map((item) => (
                  <span key={`${item.label}:${item.value}`} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-gray-800 shadow-sm">
                    <span className="text-gray-500">{item.label}</span>
                    <span className="mx-1 text-gray-300">/</span>
                    {item.value}
                  </span>
                ))}
              </div>
            )}
            <p
              id={stickyNextActionId}
              data-testid="group-inquiry-sticky-next-action"
              className="mb-2 rounded-2xl border border-brand/15 bg-brand-light px-3 py-2 text-xs font-extrabold leading-5 text-brand"
            >
              {stickyNextActionText}
            </p>
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
                aria-describedby={inputError ? `${handoffContextDescriptionId} ${stickyNextActionId} group-inquiry-message-error` : `${handoffContextDescriptionId} ${stickyNextActionId} group-inquiry-message-help`}
                placeholder="예: 부산 출발, 성인 20명, 1인 100만원대, 베트남 다낭"
                rows={2}
                className="min-h-14 flex-1 resize-none rounded-lg border border-[#E5E7EB] px-4 py-3 text-sm leading-relaxed outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                aria-describedby={loading ? `${handoffContextDescriptionId} ${stickyNextActionId} group-inquiry-message-help group-inquiry-status` : `${handoffContextDescriptionId} ${stickyNextActionId} group-inquiry-message-help`}
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
          </div>
        </form>
      )}
    </main>
  );
}
