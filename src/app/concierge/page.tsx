'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Package,
  Plus,
  Search,
  Send,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { trackEngagement } from '@/lib/tracker';
import { buildGroupInquiryHandoffHref } from '@/lib/group-inquiry-handoff';
import { hasHandoffContext, readHandoffContext } from '@/lib/handoff-query';

interface MockSearchResult {
  product_id: string;
  product_name: string;
  api_name: string;
  product_type: 'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  cost?: number;
  price: number;
  description: string;
  attrs?: Record<string, unknown>;
}

interface CartItem extends MockSearchResult {
  quantity: number;
}

interface VoucherItem {
  code: string;
  product_name: string;
  product_type: string;
}

interface IntentPrompt {
  label: string;
  query: string;
  intent: string;
  party_type: string;
  budget: string | null;
  destination: string | null;
  source?: string | null;
  selected_products?: string[] | null;
}

type SummaryItem = { label: string; value: string };
type MissingConditionSuggestion = {
  field: string;
  label: string;
  value: string;
};

const SESSION_KEY = 'concierge_session_id';
const SEARCH_TIMEOUT_MS = 15_000;
const srStatusProps = (enabled: boolean) => (
  enabled ? { role: 'status', 'aria-live': 'polite', 'aria-atomic': true } as const : {}
);

function mergeUniqueText(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return items
    .map((item) => item?.trim())
    .filter((item): item is string => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function buildConciergeHandoffPrompt(searchParams: { get(name: string): string | null }): IntentPrompt | null {
  const handoff = readHandoffContext(searchParams);
  const source = handoff.source ?? '';
  const intent = handoff.intent ?? '';
  const partyType = handoff.partyType ?? '';
  const query = handoff.query ?? '';
  const destination = handoff.destination;
  const budget = handoff.budget;
  const selectedProducts = handoff.selectedProducts;
  const hasHandoff = hasHandoffContext(handoff);

  if (!hasHandoff) return null;

  const fallbackQuery = [
    destination,
    budget,
    selectedProducts.length > 0 ? `\uc120\ud0dd \uc0c1\ud488 ${selectedProducts.length}\uac1c` : null,
  ].filter(Boolean).join(' ');

  return {
    label: source === 'packages' || source === 'package_detail' ? '\ud328\ud0a4\uc9c0 \uc870\uac74 \uc0c1\ub2f4' : '\uc0c1\ub2f4 \uc870\uac74',
    query: query || fallbackQuery || '\ud328\ud0a4\uc9c0 \uc870\uac74 AI \uc0c1\ub2f4',
    intent: intent || 'package_search',
    party_type: partyType || 'group',
    budget,
    destination,
    source: source || null,
    selected_products: selectedProducts.length > 0 ? selectedProducts : null,
  };
}

const INTENT_PROMPTS: IntentPrompt[] = [
  {
    label: '부산 출발 60대 효도 여행',
    query: '부산 출발 60대 부모님 효도 여행 추천해줘',
    intent: 'filial_trip',
    party_type: 'senior_family',
    budget: null,
    destination: null,
  },
  {
    label: '노쇼핑 동남아 가족여행',
    query: '노쇼핑 동남아 가족여행으로 부담 적은 상품 비교해줘',
    intent: 'no_shopping_family',
    party_type: 'family',
    budget: null,
    destination: '동남아',
  },
  {
    label: '20명 단체 워크샵',
    query: '20명 단체 워크샵 견적에 맞는 호텔과 액티비티 추천해줘',
    intent: 'group_workshop',
    party_type: 'group_20',
    budget: null,
    destination: null,
  },
  {
    label: '3박5일 골프 비교',
    query: '3박5일 해외 골프 패키지 가격과 동선을 비교해줘',
    intent: 'golf_compare',
    party_type: 'golf',
    budget: null,
    destination: null,
  },
];

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  HOTEL: '호텔',
  ACTIVITY: '액티비티',
  CRUISE: '크루즈',
};

const PRODUCT_TYPE_TONES: Record<string, string> = {
  HOTEL: 'bg-blue-50 text-blue-700 border-blue-100',
  ACTIVITY: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  CRUISE: 'bg-sky-50 text-sky-700 border-sky-100',
};

const API_LABELS: Record<string, string> = {
  agoda_mock: 'Agoda',
  klook_mock: 'Klook',
  cruise_mock: 'Cruise',
  tenant_product: '랜드사',
};

const INTENT_LABELS: Record<string, string> = {
  filial_trip: '효도 여행',
  no_shopping_family: '노쇼핑 가족여행',
  group_workshop: '단체 워크샵',
  golf_compare: '골프 비교',
  group_trip: '단체 여행',
  budget_trip: '예산 맞춤',
  package_consult: '상담 추천',
  package_search: '패키지 조건',
};

const PARTY_TYPE_LABELS: Record<string, string> = {
  senior_family: '60대 이상 가족',
  family: '가족',
  group_20: '20명 단체',
  golf: '골프팀',
  group: '단체',
};

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function resolveCategory(item: { product_category?: string; api_name?: string }): 'DYNAMIC' | 'FIXED' {
  if (item.product_category === 'FIXED') return 'FIXED';
  if (item.product_category === 'DYNAMIC') return 'DYNAMIC';
  return item.api_name === 'tenant_product' ? 'FIXED' : 'DYNAMIC';
}

function money(value: number): string {
  return `₩${value.toLocaleString('ko-KR')}`;
}

function getResultInsight(item: MockSearchResult) {
  const category = resolveCategory(item);
  if (item.product_type === 'CRUISE') {
    return {
      reason: '항공·숙박 외에 이동 경험 자체가 중요한 일정에 맞습니다.',
      caution: '항구 이동 시간과 선실 등급을 상담에서 확인하세요.',
      extraCost: '선실 업그레이드나 기항지 옵션 비용이 추가될 수 있어요.',
      action: '선실 조건 확인',
    };
  }
  if (item.product_type === 'HOTEL') {
    return {
      reason: category === 'FIXED' ? '랜드사가 검수한 고정 조건이라 상담 연결이 빠릅니다.' : '실시간 재고 기반이라 일정 조정 폭이 넓습니다.',
      caution: '객실 타입, 조식, 취소 가능 시점을 확인하면 안전합니다.',
      extraCost: '성수기·객실 업그레이드에 따라 최종가가 달라질 수 있어요.',
      action: '객실 조건 확인',
    };
  }
  return {
    reason: '여행 일정에 경험 요소를 더해 만족도를 높이기 좋습니다.',
    caution: '연령 제한, 픽업 장소, 우천 취소 조건을 확인하세요.',
    extraCost: '현장 옵션이나 교통비가 별도일 수 있어요.',
    action: '포함 조건 확인',
  };
}

const DESTINATION_HINTS = [
  '동남아',
  '다낭',
  '나트랑',
  '푸꾸옥',
  '달랏',
  '방콕',
  '파타야',
  '치앙마이',
  '세부',
  '보홀',
  '마닐라',
  '코타키나발루',
  '싱가포르',
  '대만',
  '타이베이',
  '일본',
  '오사카',
  '후쿠오카',
  '삿포로',
  '괌',
  '사이판',
  '하와이',
  '유럽',
  '호주',
];

function inferIntentFromQuery(query: string): string | null {
  if (/골프|라운딩/.test(query)) return 'golf_compare';
  if (/워크샵|워크숍/.test(query)) return 'group_workshop';
  if (/노쇼핑|쇼핑\s*없/.test(query) && /가족|아이|부모/.test(query)) return 'no_shopping_family';
  if (/효도|부모님|어머니|아버지|60대|70대|시니어/.test(query)) return 'filial_trip';
  if (/단체|모임|동호회|회사|20명|30명|40명/.test(query)) return 'group_trip';
  if (/예산|저렴|가성비|100만|150만|200만/.test(query)) return 'budget_trip';
  return null;
}

function inferPartyTypeFromQuery(query: string): string | null {
  if (/골프|라운딩/.test(query)) return 'golf';
  if (/20명/.test(query)) return 'group_20';
  if (/효도|부모님|어머니|아버지|60대|70대|시니어/.test(query)) return 'senior_family';
  if (/가족|아이|초등|중등|자녀/.test(query)) return 'family';
  if (/단체|워크샵|워크숍|모임|동호회|회사|30명|40명/.test(query)) return 'group';
  return null;
}

function inferDestinationFromQuery(query: string): string | null {
  return DESTINATION_HINTS.find((destination) => query.includes(destination)) ?? null;
}

function inferBudgetFromQuery(query: string): string | null {
  const rangeMatch = query.match(/(\d{2,4})\s*(?:~|-|에서)\s*(\d{2,4})\s*(?:만원|만\s*원|만)/);
  if (rangeMatch) return `${rangeMatch[1]}~${rangeMatch[2]}만원`;

  const manwonMatch = query.match(/(\d{2,4})\s*(?:만원|만\s*원|만)/);
  if (manwonMatch) return `${manwonMatch[1]}만원`;

  const wonMatch = query.match(/(\d{6,9})\s*원/);
  if (!wonMatch) return null;
  const won = Number(wonMatch[1]);
  if (!Number.isFinite(won) || won <= 0) return null;
  return won >= 10_000 ? `${Math.round(won / 10_000).toLocaleString('ko-KR')}만원` : `${won.toLocaleString('ko-KR')}원`;
}

function inferIntentSummary(prompt: IntentPrompt | null, query: string, cart: CartItem[]) {
  const queryText = query.trim();
  const selectedProducts = mergeUniqueText(cart.map((item) => item.product_name || item.product_id));
  const promptSelectedProducts = prompt?.selected_products?.filter(Boolean) ?? [];
  return {
    intent: prompt?.intent ?? inferIntentFromQuery(queryText),
    budget: prompt?.budget ?? inferBudgetFromQuery(queryText),
    destination: prompt?.destination ?? inferDestinationFromQuery(queryText),
    party_type: prompt?.party_type ?? inferPartyTypeFromQuery(queryText),
    selected_products: selectedProducts.length > 0
      ? selectedProducts
      : promptSelectedProducts.length > 0
        ? promptSelectedProducts
        : null,
  };
}

function buildConciergeDecisionMetadata({
  intentSummary,
  query,
  activePromptLabel,
  selectedProductCount,
}: {
  intentSummary: ReturnType<typeof inferIntentSummary>;
  query: string;
  activePromptLabel?: string | null;
  selectedProductCount: number;
}) {
  const conciergeDecisionChecklist = [
    { label: '목적', complete: Boolean(activePromptLabel || intentSummary.intent || query.trim()) },
    { label: '동행', complete: Boolean(intentSummary.party_type) },
    { label: '지역', complete: Boolean(intentSummary.destination) },
    { label: '예산', complete: Boolean(intentSummary.budget) },
    { label: '상품', complete: selectedProductCount > 0 },
  ];
  const conciergeDecisionReadyCount = conciergeDecisionChecklist.filter((item) => item.complete).length;
  const conciergeDecisionMissingLabels = conciergeDecisionChecklist.filter((item) => !item.complete).map((item) => item.label);
  const conciergeDecisionSummaryText = conciergeDecisionMissingLabels.length > 0
    ? `AI 상담 판단 요약: ${conciergeDecisionReadyCount}/${conciergeDecisionChecklist.length} 준비. 보완하면 좋은 조건은 ${conciergeDecisionMissingLabels.join(', ')}입니다.`
    : `AI 상담 판단 요약: ${conciergeDecisionReadyCount}/${conciergeDecisionChecklist.length} 준비. 상담 전달 조건을 바로 넘길 수 있습니다.`;
  const conciergeNextActionText = conciergeDecisionMissingLabels.length > 0
    ? `${conciergeDecisionMissingLabels[0]} 조건을 보완한 뒤 추천 상품이나 상담 CTA로 이어가세요.`
    : selectedProductCount > 0
      ? '선택한 상품 묶음을 카톡 상담 또는 단체 견적으로 전달하세요.'
      : 'AI 추천 결과에서 맞는 상품을 선택하거나 카톡 상담으로 이어가세요.';
  const conciergeHandoffPreviewText = [
    activePromptLabel ? `빠른 시작 ${activePromptLabel}` : null,
    query.trim() ? `검색어 ${query.trim()}` : null,
    intentSummary.destination ? `지역 ${intentSummary.destination}` : null,
    intentSummary.budget ? `예산 ${intentSummary.budget}` : null,
    selectedProductCount > 0 ? `상품 ${selectedProductCount}개` : null,
  ].filter(Boolean).join(', ');

  return {
    ready_count: conciergeDecisionReadyCount,
    missing_fields: conciergeDecisionMissingLabels,
    decision_summary: conciergeDecisionSummaryText,
    handoff_preview: conciergeHandoffPreviewText || 'AI 상담 조건이 아직 정리되지 않았습니다.',
    next_action: conciergeNextActionText,
  };
}

function getMissingConditionSuggestions(missingLabels: string[]): MissingConditionSuggestion[] {
  const suggestions: MissingConditionSuggestion[] = [];
  if (missingLabels.includes('목적')) {
    suggestions.push({ field: 'intent', label: '효도 여행', value: '부모님 효도 여행' });
  }
  if (missingLabels.includes('동행')) {
    suggestions.push({ field: 'party_type', label: '가족 4명', value: '가족 4명' });
    suggestions.push({ field: 'party_type', label: '20명 단체', value: '20명 단체' });
  }
  if (missingLabels.includes('지역')) {
    suggestions.push({ field: 'destination', label: '동남아', value: '동남아' });
    suggestions.push({ field: 'destination', label: '일본', value: '일본' });
  }
  if (missingLabels.includes('예산')) {
    suggestions.push({ field: 'budget', label: '1인 150만원대', value: '1인 150만원대' });
    suggestions.push({ field: 'budget', label: '총 300만원대', value: '총 300만원대' });
  }
  return suggestions.slice(0, 4);
}

function ModalFrame({
  title,
  onClose,
  children,
  dialogId,
  testId,
  closeTestId,
  autoFocusClose = true,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  dialogId?: string;
  testId?: string;
  closeTestId?: string;
  autoFocusClose?: boolean;
}) {
  const titleId = dialogId ? `${dialogId}-title` : undefined;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const getFocusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.getAttribute('aria-hidden'));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!autoFocusClose) return;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center">
      <button
        type="button"
        aria-label={`${title} 닫기`}
        className="absolute inset-0 bg-slate-950/45"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        id={dialogId}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[24px] bg-white shadow-2xl md:rounded-[20px]"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#EEF2F6] px-5">
          <h2 id={titleId} className="text-[17px] font-extrabold text-text-primary">{title}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="닫기"
            data-testid={closeTestId}
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded-full text-text-secondary hover:bg-[#F2F4F6] hover:text-text-primary"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function ConciergePageFallback() {
  return (
    <div className="min-h-dvh bg-[#F8FAFC] px-4 py-5 md:px-6 lg:py-7">
      <div className="mx-auto max-w-7xl rounded-[24px] bg-white p-5 shadow-card md:p-7">
        <div className="h-6 w-28 rounded-full bg-brand-light" />
        <div className="mt-4 h-9 w-full max-w-xl rounded-[12px] bg-[#E5ECF3]" />
        <div className="mt-3 h-5 w-full max-w-2xl rounded-[10px] bg-[#EEF2F6]" />
        <div className="mt-6 h-13 w-full rounded-[16px] bg-[#F2F4F6]" />
      </div>
    </div>
  );
}

export default function ConciergePage() {
  return (
    <Suspense fallback={<ConciergePageFallback />}>
      <ConciergePageContent />
    </Suspense>
  );
}

function ConciergePageContent() {
  const searchParams = useSearchParams();
  const urlPrompt = useMemo(() => buildConciergeHandoffPrompt(searchParams), [searchParams]);
  const [query, setQuery] = useState(urlPrompt?.query ?? '');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(Boolean(urlPrompt));
  const [results, setResults] = useState<MockSearchResult[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [paying, setPaying] = useState(false);
  const [vouchers, setVouchers] = useState<VoucherItem[] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareToast, setShareToast] = useState('');
  const [activePrompt, setActivePrompt] = useState<IntentPrompt | null>(urlPrompt);
  const inputRef = useRef<HTMLInputElement>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);
  const cartSheetReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const handoffAutoSearchStartedRef = useRef(false);
  const sessionId = getOrCreateSessionId();

  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const dynamicItems = useMemo(() => cart.filter((item) => resolveCategory(item) === 'DYNAMIC'), [cart]);
  const fixedItems = useMemo(() => cart.filter((item) => resolveCategory(item) === 'FIXED'), [cart]);
  const intentSummary = useMemo(() => inferIntentSummary(activePrompt, query, cart), [activePrompt, cart, query]);
  const groupInquiryHref = useMemo(() => {
    const productNames = cart.map((item) => item.product_name).filter(Boolean);
    const handoffProductNames = productNames.length > 0 ? productNames : intentSummary.selected_products ?? [];
    return buildGroupInquiryHandoffHref({
      source: 'concierge',
      intent: intentSummary.intent ?? undefined,
      partyType: intentSummary.party_type ?? undefined,
      query: query.trim() || activePrompt?.query || 'AI 상담 장바구니 단체 견적',
      destination: intentSummary.destination,
      budget: intentSummary.budget || (cartTotal > 0 ? `총 ${cartTotal.toLocaleString('ko-KR')}원` : null),
      selectedProducts: handoffProductNames.length > 0 ? handoffProductNames : undefined,
    });
  }, [activePrompt?.query, cart, cartTotal, intentSummary, query]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (cart.length === 0) return;
      try {
        navigator.sendBeacon(
          '/api/tracking',
          JSON.stringify({
            type: 'engagement',
            session_id: sessionId,
            event_type: 'cart_abandon_exit',
            page_url: '/concierge',
            ...intentSummary,
          }),
        );
      } catch {
        // noop
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [cart.length, intentSummary, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/concierge/cart?session_id=${sessionId}`)
      .then((response) => response.json())
      .then((data) => setCart(data.items ?? []))
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!checkoutOpen) return;
    const frame = window.requestAnimationFrame(() => customerNameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [checkoutOpen]);

  function openCartSheet(trigger: HTMLButtonElement | null) {
    cartSheetReturnFocusRef.current = trigger;
    setCartSheetOpen(true);
  }

  function closeCartSheet(restoreFocus = true) {
    setCartSheetOpen(false);
    if (!restoreFocus) return;
    const trigger = cartSheetReturnFocusRef.current;
    window.requestAnimationFrame(() => trigger?.focus());
  }

  const performSearch = useCallback(async (rawQuery: string, prompt: IntentPrompt | null = null) => {
    const normalized = rawQuery.trim();
    if (!normalized) {
      setSearchError('찾고 싶은 여행 조건을 한 문장으로 입력해 주세요.');
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setHasSearched(true);
    setResults([]);
    setSearchError('');
    setActivePrompt(prompt);
    const nextIntentSummary = inferIntentSummary(prompt, normalized, cart);
    const decisionMetadata = buildConciergeDecisionMetadata({
      intentSummary: nextIntentSummary,
      query: normalized,
      activePromptLabel: prompt?.label,
      selectedProductCount: nextIntentSummary.selected_products?.length ?? 0,
    });
    const promptSource = prompt?.source;
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiPromptStarted,
      source: promptSource === 'packages'
        ? 'packages_handoff_auto_search'
        : promptSource === 'package_detail'
          ? 'package_detail_handoff_auto_search'
          : prompt
          ? 'concierge_intent_prompt'
          : 'concierge_manual_search',
      page_url: '/concierge',
      ...decisionMetadata,
      metadata: decisionMetadata,
      ...nextIntentSummary,
    });

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const response = await fetch('/api/concierge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ query: normalized, ...nextIntentSummary }),
      });
      if (!response.ok) {
        throw new Error('검색 응답을 불러오지 못했습니다. 다시 시도하거나 카톡 상담으로 이어가 주세요.');
      }
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results ?? []);
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      setSearchError(
        isAbortError
          ? '검색이 오래 걸리고 있어요. 다시 검색하거나 카톡 상담으로 이어가 주세요.'
          : error instanceof Error
            ? error.message
            : '검색 오류가 발생했습니다.',
      );
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [cart]);

  useEffect(() => {
    if (!urlPrompt || handoffAutoSearchStartedRef.current) return;
    handoffAutoSearchStartedRef.current = true;
    void performSearch(urlPrompt.query, urlPrompt);
  }, [performSearch, urlPrompt]);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    await performSearch(query, activePrompt);
  }

  async function addToCart(item: MockSearchResult) {
    const newItem: CartItem = { ...item, quantity: 1 };
    const idx = cart.findIndex((existing) => existing.product_id === item.product_id);
    const updated =
      idx >= 0
        ? cart.map((existing, index) => (index === idx ? { ...existing, quantity: existing.quantity + 1 } : existing))
        : [...cart, newItem];

    setCart(updated);
    await fetch('/api/concierge/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, item: newItem }),
    });
    const nextIntentSummary = inferIntentSummary(activePrompt, query, updated);
    const recommendationRank = results.findIndex((result) => result.product_id === item.product_id) + 1;
    const decisionMetadata = buildConciergeDecisionMetadata({
      intentSummary: nextIntentSummary,
      query,
      activePromptLabel: activePrompt?.label,
      selectedProductCount: nextIntentSummary.selected_products?.length ?? 0,
    });
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
      source: 'concierge_add_to_cart',
      product_id: item.product_id,
      product_name: item.product_name,
      page_url: '/concierge',
      recommended_rank: recommendationRank > 0 ? recommendationRank : null,
      ...decisionMetadata,
      metadata: {
        ...decisionMetadata,
        action: 'add_to_cart',
        apiName: item.api_name,
        productType: item.product_type,
        cartCount: updated.length,
      },
      ...nextIntentSummary,
    });
    trackEngagement({
      event_type: ANALYTICS_EVENTS.cartAdded,
      product_id: item.product_id,
      product_name: item.product_name,
      page_url: '/concierge',
      ...nextIntentSummary,
    });
  }

  async function addResultBundleToCart() {
    const bundleItems = results.slice(0, 3);
    const addableItems = bundleItems.filter(
      (item) => !cart.some((existing) => existing.product_id === item.product_id),
    );
    if (addableItems.length === 0) {
      setShareToast('상위 추천 상품이 이미 선택 구성에 담겨 있습니다.');
      setTimeout(() => setShareToast(''), 3000);
      return;
    }

    const newItems: CartItem[] = addableItems.map((item) => ({ ...item, quantity: 1 }));
    const updated = [...cart, ...newItems];
    setCart(updated);
    await Promise.all(newItems.map((item) => fetch('/api/concierge/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, item }),
    }).catch(() => null)));

    const nextIntentSummary = inferIntentSummary(activePrompt, query, updated);
    const selectedProductNames = bundleItems.map((item) => item.product_name);
    const decisionMetadata = buildConciergeDecisionMetadata({
      intentSummary: nextIntentSummary,
      query,
      activePromptLabel: activePrompt?.label,
      selectedProductCount: nextIntentSummary.selected_products?.length ?? 0,
    });
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
      source: 'concierge_result_bundle_add_to_cart',
      page_url: '/concierge',
      ...nextIntentSummary,
      selected_products: selectedProductNames,
      ...decisionMetadata,
      metadata: {
        ...decisionMetadata,
        action: 'add_result_bundle_to_cart',
        addedCount: newItems.length,
        bundleCount: bundleItems.length,
        selectedProductNames,
      },
    });
    trackEngagement({
      event_type: ANALYTICS_EVENTS.cartAdded,
      page_url: '/concierge',
      ...nextIntentSummary,
      selected_products: selectedProductNames,
      metadata: {
        source: 'concierge_result_bundle_add_to_cart',
        addedCount: newItems.length,
        bundleCount: bundleItems.length,
      },
    });
    setShareToast(`${newItems.length}개 추천 상품을 선택 구성에 담았습니다.`);
    setTimeout(() => setShareToast(''), 3000);
  }

  async function removeFromCart(productId: string) {
    const updated = cart.filter((item) => item.product_id !== productId);
    setCart(updated);
    await fetch('/api/concierge/cart', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, product_id: productId }),
    });
  }

  async function handleCheckout(event: React.FormEvent) {
    event.preventDefault();
    if (!customer.name.trim()) {
      setCheckoutError('예약 확인을 위해 이름을 입력해 주세요.');
      customerNameRef.current?.focus();
      return;
    }
    setPaying(true);
    setCheckoutError('');
    trackEngagement({
      event_type: ANALYTICS_EVENTS.checkoutStart,
      page_url: '/concierge',
      ready_count: checkoutSubmitReadyCount,
      missing_fields: checkoutSubmitMissingLabels,
      decision_summary: checkoutSubmitDecisionSummaryText,
      metadata: {
        ready_count: checkoutSubmitReadyCount,
        missing_fields: checkoutSubmitMissingLabels,
        decision_summary: checkoutSubmitDecisionSummaryText,
      },
      ...intentSummary,
    });

    try {
      const response = await fetch('/api/concierge/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, customer, ...intentSummary }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (data.status === 'COMPLETED') {
        setVouchers(data.vouchers ?? []);
        setCart([]);
        setCheckoutOpen(false);
        setCartSheetOpen(false);
      } else if (data.status === 'PARTIAL_FAIL') {
        setCheckoutError(`일부 API 오류로 결제가 취소되었습니다: ${data.errors?.join(', ')}`);
      }
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : '결제 오류가 발생했습니다.');
    } finally {
      setPaying(false);
    }
  }

  async function handleShare() {
    if (!cart.length) return;
    setSharing(true);
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
      source: 'concierge_share_cart',
      page_url: '/concierge',
      ...currentConciergeDecisionMetadata,
      metadata: {
        ...currentConciergeDecisionMetadata,
        action: 'share_cart',
      },
      ...intentSummary,
    });
    try {
      const hasDynamic = cart.some((item) => resolveCategory(item) === 'DYNAMIC');
      const hasFixed = cart.some((item) => resolveCategory(item) === 'FIXED');
      const body =
        hasFixed && !hasDynamic
          ? {
              share_type: 'FIXED',
              product_id: cart.find((item) => resolveCategory(item) === 'FIXED')!.product_id,
              product_name: cart.find((item) => resolveCategory(item) === 'FIXED')!.product_name,
              ...intentSummary,
            }
          : { share_type: 'DYNAMIC', items: cart, search_query: query, ...intentSummary };
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (data.share_url) {
        await navigator.clipboard.writeText(data.share_url).catch(() => {});
        setShareToast('링크가 복사되었습니다.');
        setTimeout(() => setShareToast(''), 3000);
      }
    } catch {
      setShareToast('공유 링크 생성에 실패했습니다.');
      setTimeout(() => setShareToast(''), 3000);
    } finally {
      setSharing(false);
    }
  }

  function handleGroupInquiryClick(source: string) {
    const selectedProductNames = mergeUniqueText([
      ...cart.map((item) => item.product_name),
      ...(intentSummary.selected_products ?? []),
    ]);
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
      source,
      page_url: '/concierge',
      ...intentSummary,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : intentSummary.selected_products,
      ...currentConciergeDecisionMetadata,
      metadata: {
        ...currentConciergeDecisionMetadata,
        action: 'group_inquiry_handoff',
        source,
        cartCount: cart.length,
        selectedProductNames,
      },
    });
  }

  async function openKakaoConsult(source: string, focusedProduct?: MockSearchResult, handoffProducts: string[] = []) {
    const selectedProductNames = mergeUniqueText([
      focusedProduct?.product_name,
      ...handoffProducts,
      ...cart.map((item) => item.product_name),
      ...(intentSummary.selected_products ?? []),
    ]);
    const trimmedQuery = query.trim();
    const queryHasDestination = Boolean(intentSummary.destination && trimmedQuery.includes(intentSummary.destination));
    const queryHasBudget = Boolean(intentSummary.budget && trimmedQuery.includes(intentSummary.budget));
    const escalationSummary = [
      trimmedQuery ? `검색어: ${trimmedQuery}` : null,
      activePrompt?.label ? `빠른 시작: ${activePrompt.label}` : null,
      intentSummary.destination && !queryHasDestination ? `목적지: ${intentSummary.destination}` : null,
      intentSummary.budget && !queryHasBudget ? `예산: ${intentSummary.budget}` : null,
      intentSummary.party_type ? `동행 유형: ${intentSummary.party_type}` : null,
      focusedProduct ? `현재 추천: ${focusedProduct.product_name}` : null,
      selectedProductNames.length > 0 ? `선택 구성: ${selectedProductNames.join(' / ')}` : null,
    ].filter(Boolean).join('\n');
    const decisionMetadata = buildConciergeDecisionMetadata({
      intentSummary,
      query,
      activePromptLabel: activePrompt?.label,
      selectedProductCount: selectedProductNames.length,
    });
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      cta_type: source,
      page_url: '/concierge',
      ...decisionMetadata,
      metadata: {
        ...decisionMetadata,
        source,
        focusedProductId: focusedProduct?.product_id ?? null,
        selectedProductNames,
      },
      ...intentSummary,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : intentSummary.selected_products,
    });
    const copied = await openKakaoChannel({
      productTitle: focusedProduct?.product_name,
      intent: intentSummary.intent,
      budget: intentSummary.budget,
      destination: intentSummary.destination,
      party_type: intentSummary.party_type,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : intentSummary.selected_products,
      escalationSummary,
    });
    if (copied) {
      setShareToast('상담 조건이 복사되었습니다. 카톡에 붙여넣어 주세요.');
      setTimeout(() => setShareToast(''), 3000);
    }
  }

  const renderCartItems = () => (
    <div className="space-y-5">
      {cart.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-[#D1DCE8] bg-[#F8FAFC] px-4 py-8 text-center">
          <Package className="mx-auto mb-3 text-text-secondary" size={28} />
          <p className="text-[14px] font-bold text-text-primary">아직 담은 상품이 없습니다</p>
          <p className="mt-1 text-[13px] text-text-secondary">AI 추천 결과에서 필요한 상품을 담아보세요.</p>
        </div>
      ) : (
        <>
          {dynamicItems.length > 0 && (
            <CartGroup title="실시간 상품" items={dynamicItems} onRemove={removeFromCart} />
          )}
          {fixedItems.length > 0 && (
            <CartGroup title="고정 패키지" items={fixedItems} onRemove={removeFromCart} />
          )}
        </>
      )}
    </div>
  );

  if (vouchers) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F8FAFC] p-5">
        <div className="w-full max-w-lg rounded-[24px] border border-[#E5E7EB] bg-white p-6 shadow-card">
          <div className="mb-6 text-center">
            <CheckCircle2 className="mx-auto mb-3 text-success" size={44} />
            <h1 className="text-[24px] font-extrabold text-text-primary">결제 완료</h1>
            <p className="mt-1 text-[14px] text-text-secondary">아래 바우처 정보를 확인해 주세요.</p>
          </div>
          <div className="space-y-3">
            {vouchers.map((voucher, index) => (
              <div key={`${voucher.code}-${index}`} className="rounded-[16px] border border-[#D1DCE8] bg-[#F8FAFC] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-brand">
                      {PRODUCT_TYPE_LABELS[voucher.product_type] ?? voucher.product_type}
                    </p>
                    <p className="mt-1 break-keep text-[15px] font-bold text-text-primary">{voucher.product_name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-text-secondary">바우처 코드</p>
                    <p className="font-mono text-[18px] font-extrabold text-brand">{voucher.code}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setVouchers(null);
              setResults([]);
              setQuery('');
              setHasSearched(false);
            }}
            className="mt-6 h-12 w-full rounded-full bg-brand text-[15px] font-bold text-white hover:bg-brand-dark"
          >
            새 여행 계획하기
          </button>
        </div>
      </div>
    );
  }

  const selectedProductCount = intentSummary.selected_products?.length ?? 0;
  const currentConciergeDecisionMetadata = buildConciergeDecisionMetadata({
    intentSummary,
    query,
    activePromptLabel: activePrompt?.label,
    selectedProductCount,
  });
  const showIntentSummary = Boolean(activePrompt || query.trim() || selectedProductCount > 0);
  const summaryItems = [
    {
      label: '목적',
      value: activePrompt?.label ?? (intentSummary.intent ? INTENT_LABELS[intentSummary.intent] ?? '직접 입력' : null),
    },
    { label: '동행', value: intentSummary.party_type ? PARTY_TYPE_LABELS[intentSummary.party_type] ?? intentSummary.party_type : null },
    { label: '지역', value: intentSummary.destination },
    { label: '예산', value: intentSummary.budget },
    { label: '담은 상품', value: selectedProductCount > 0 ? `${selectedProductCount}개` : null },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
  const canGroupInquiryFromCartActions = cart.length > 0 || summaryItems.length > 0;
  const checkoutSummaryId = 'concierge-checkout-summary';
  const checkoutHandoffSummaryId = 'concierge-checkout-handoff-summary';
  const handoffReadinessSummaryId = 'concierge-handoff-readiness-summary';
  const handoffChecklist = [
    { label: '목적', complete: Boolean(activePrompt || intentSummary.intent || query.trim()) },
    { label: '동행', complete: Boolean(intentSummary.party_type) },
    { label: '지역', complete: Boolean(intentSummary.destination) },
    { label: '예산', complete: Boolean(intentSummary.budget) },
    { label: '상품', complete: selectedProductCount > 0 },
  ];
  const handoffReadyCount = handoffChecklist.filter((item) => item.complete).length;
  const handoffMissingLabels = handoffChecklist.filter((item) => !item.complete).map((item) => item.label);
  const handoffReadinessText = handoffMissingLabels.length > 0
    ? `상담 전달 준비 ${handoffReadyCount}/${handoffChecklist.length}. 보완하면 좋은 조건: ${handoffMissingLabels.join(', ')}.`
    : `상담 전달 준비 ${handoffReadyCount}/${handoffChecklist.length}. 바로 상담으로 넘길 수 있습니다.`;
  const missingConditionSuggestions = getMissingConditionSuggestions(handoffMissingLabels);
  const checkoutSubmitChecklist = [
    { label: '이름', complete: Boolean(customer.name.trim()) },
    { label: '담은 상품', complete: cart.length > 0 },
  ];
  const checkoutSubmitReadyCount = checkoutSubmitChecklist.filter((item) => item.complete).length;
  const checkoutSubmitMissingLabels = checkoutSubmitChecklist.filter((item) => !item.complete).map((item) => item.label);
  const checkoutSubmitDecisionSummaryId = 'concierge-checkout-submit-decision-summary';
  const checkoutSubmitDecisionSummaryText = checkoutSubmitMissingLabels.length > 0
    ? `결제 완료 전 ${checkoutSubmitMissingLabels.join(', ')}을(를) 확인하면 제출할 수 있습니다.`
    : `결제 완료 시 ${cart.length}개 상품, ${money(cartTotal)} 기준으로 예약 확인을 접수합니다.`;
  const checkoutDescriptionIds = checkoutError
    ? `${checkoutSummaryId} ${checkoutHandoffSummaryId} ${checkoutSubmitDecisionSummaryId} concierge-checkout-error`
    : `${checkoutSummaryId} ${checkoutHandoffSummaryId} ${checkoutSubmitDecisionSummaryId}`;
  const kakaoIntentSummaryId = 'concierge-kakao-intent-summary';
  const topbarKakaoDescriptionId = 'concierge-topbar-kakao-description';
  const summaryKakaoDescriptionId = 'concierge-summary-kakao-description';
  const topbarKakaoDescriptionIds = `${topbarKakaoDescriptionId} ${kakaoIntentSummaryId}`;
  const summaryKakaoDescriptionIds = `${summaryKakaoDescriptionId} ${kakaoIntentSummaryId} ${handoffReadinessSummaryId}`;
  const cartSummaryText = [
    cart.length > 0 ? `선택한 구성은 ${cart.length}개 상품입니다.` : '선택한 상품이 없습니다.',
    cartTotal > 0 ? `총 금액은 ${money(cartTotal)}입니다.` : null,
    summaryItems.length > 0 ? `상담 전달 조건은 ${summaryItems.map((item) => `${item.label} ${item.value}`).join(', ')}입니다.` : null,
  ].filter(Boolean).join(' ');
  const kakaoIntentSummaryText = summaryItems.length > 0
    ? `현재 상담 전달 조건은 ${summaryItems.map((item) => `${item.label} ${item.value}`).join(', ')}입니다.`
    : '아직 정리된 상담 전달 조건이 없으며, 현재 입력한 검색 조건을 기준으로 카카오 상담을 시작합니다.';
  const resultSummaryId = 'concierge-result-summary';
  const resultSummaryText = loading
    ? '여행 조건에 맞는 추천 상품을 비교하고 있습니다.'
    : results.length > 0
      ? `추천 결과 ${results.length}건이 준비되었습니다. 비교표에서 가격과 주의할 점을 확인한 뒤 상세 보기, 견적, 담기, 카톡 상담을 선택할 수 있습니다.`
      : searchError
        ? searchError
        : hasSearched
          ? '현재 조건에 맞는 추천 결과가 없습니다. 조건을 조금 넓히거나 카카오톡 상담 또는 맞춤 견적으로 이어갈 수 있습니다.'
          : '검색 조건을 입력하면 추천 결과와 비교표가 이 영역에 표시됩니다.';
  const cartSummaryLive = cart.length > 0 || summaryItems.length > 0;
  const kakaoIntentLive = summaryItems.length > 0;
  const resultSummaryLive = loading || results.length > 0 || Boolean(searchError);
  const resultBriefItems = results.slice(0, 3).map((item, index) => {
    const insight = getResultInsight(item);
    return {
      rank: index + 1,
      name: item.product_name,
      price: money(item.price),
      reason: insight.reason,
      caution: insight.caution,
      extraCost: insight.extraCost,
      action: insight.action,
    };
  });
  const resultBundleItems = results.slice(0, 3);
  const resultBundleAddableCount = resultBundleItems.filter(
    (item) => !cart.some((existing) => existing.product_id === item.product_id),
  ).length;
  const resultBundleAddToCartText = resultBundleAddableCount > 0
    ? `상위 추천 ${resultBundleAddableCount}개를 선택 구성에 담습니다. 담은 뒤 모바일 하단 상담바에서 카톡 상담, 구성 보기, 결제로 이어갈 수 있습니다.`
    : '상위 추천 상품이 이미 선택 구성에 담겨 있습니다. 모바일 하단 상담바에서 카톡 상담, 구성 보기, 결제로 이어갈 수 있습니다.';
  const resultBriefSummaryId = 'concierge-result-brief-summary';
  const resultBriefSummaryText = resultBriefItems.length > 0
    ? `AI 추천 브리핑입니다. 상위 ${resultBriefItems.length}개 상품 기준으로 추천 이유, 주의할 점, 추가 비용 가능성, 다음 액션을 정리했습니다. ${resultBriefItems.map((item) => `${item.rank}순위 ${item.name}, ${item.price}, 다음 액션 ${item.action}`).join(' ')}`
    : resultSummaryText;
  const resultHandoffProductNames = resultBriefItems.map((item) => item.name);
  const resultBundleSummaryId = 'concierge-result-bundle-summary';
  const resultBundleSummaryText = resultHandoffProductNames.length > 0
    ? `상위 추천 ${resultHandoffProductNames.length}개 상품을 상담 조건과 함께 전달합니다. 선택 상품은 ${resultHandoffProductNames.join(', ')}입니다.`
    : resultSummaryText;
  const resultBundleNextActionId = 'concierge-result-bundle-next-action';
  const resultBundleNextActionText = handoffMissingLabels.length > 0
    ? `상담 전 ${handoffMissingLabels.join(', ')} 정보를 보완하면 추천 묶음 전달이 더 정확해집니다.`
    : resultHandoffProductNames.length > 1
      ? `상위 ${resultHandoffProductNames.length}개를 비교한 뒤 카톡 상담 또는 단체 견적으로 이어가세요.`
      : '추천 이유와 주의할 점을 확인한 뒤 카톡 상담 또는 단체 견적으로 이어가세요.';
  const resultBundleRiskNoteId = 'concierge-result-bundle-risk-note';
  const resultBundleRiskNoteText = resultHandoffProductNames.length > 0
    ? `최종가 체크: ${resultHandoffProductNames.length}개 추천의 항공, 객실, 성수기, 옵션 비용은 상담에서 다시 확인해야 합니다.`
    : '최종가 체크: AI 추천은 예상 조건 기준이므로 항공, 객실, 옵션 비용은 상담에서 다시 확인해야 합니다.';
  const resultBundleAddToCartId = 'concierge-result-bundle-add-to-cart-note';
  const resultBundleHandoffItems = [
    ...summaryItems,
    resultHandoffProductNames.length > 0 ? { label: '상품', value: `${resultHandoffProductNames.length}개` } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item?.value));
  const resultBundleConfirmId = 'concierge-result-bundle-handoff-confirm';
  const resultBundleConfirmItems = [
    {
      label: '상품',
      value: resultHandoffProductNames.length > 0 ? `${resultHandoffProductNames.length}개` : '추천 없음',
    },
    {
      label: '목적',
      value: activePrompt?.label ?? (intentSummary.intent ? INTENT_LABELS[intentSummary.intent] ?? '직접 상담' : '직접 상담'),
    },
    {
      label: '예산',
      value: intentSummary.budget || (resultBriefItems[0] ? `${resultBriefItems[0].price}부터` : '상담 확인'),
    },
  ];
  const resultBundleConfirmText = `카톡 또는 견적 CTA를 누르면 ${resultBundleConfirmItems.map((item) => `${item.label} ${item.value}`).join(', ')} 조건이 함께 전달됩니다.`;
  const resultBundleDescriptionIds = `${resultSummaryId} ${resultBundleSummaryId} ${resultBundleConfirmId} ${resultBundleNextActionId} ${resultBundleRiskNoteId} ${resultBundleAddToCartId}`;
  const resultBundleGroupInquiryHref = buildGroupInquiryHandoffHref({
    source: 'concierge_results_bundle',
    intent: intentSummary.intent ?? undefined,
    partyType: intentSummary.party_type ?? undefined,
    query: query.trim() || activePrompt?.query || 'AI 추천 결과 단체 견적',
    destination: intentSummary.destination,
    budget: intentSummary.budget || (resultBriefItems[0] ? `상위 추천 ${resultBriefItems[0].price}부터` : null),
    selectedProducts: resultHandoffProductNames.length > 0 ? resultHandoffProductNames : undefined,
  });
  const intentPromptGroupLabelId = 'concierge-intent-prompt-group-label';
  const intentPromptGroupDescriptionId = 'concierge-intent-prompt-group-description';
  const intentPromptDescriptionId = (intent: string) => `concierge-intent-prompt-description-${intent}`;
  const applyMissingConditionSuggestion = (suggestion: MissingConditionSuggestion) => {
    const currentQuery = query.trim();
    const nextQuery = currentQuery.includes(suggestion.value)
      ? currentQuery
      : `${currentQuery}${currentQuery ? ' ' : ''}${suggestion.value}`;
    setQuery(nextQuery);
    if (activePrompt && nextQuery !== activePrompt.query) setActivePrompt(null);
    if (searchError) setSearchError('');
    trackEngagement({
      event_type: ANALYTICS_EVENTS.packageFilterApplied,
      source: 'concierge_missing_condition_chip',
      page_url: '/concierge',
      filter_name: suggestion.field,
      filter_value: suggestion.value,
      ...currentConciergeDecisionMetadata,
      metadata: {
        ...currentConciergeDecisionMetadata,
        action: 'append_missing_condition',
        field: suggestion.field,
        value: suggestion.value,
      },
      ...intentSummary,
    });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="min-h-dvh bg-[#F8FAFC] pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-[#EEF2F6] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 md:px-6">
          <Link href="/" className="min-w-0 text-[18px] font-black text-brand">
            여소남 AI 컨시어지
          </Link>
          <button
            type="button"
            onClick={() => openKakaoConsult('topbar')}
            aria-describedby={topbarKakaoDescriptionIds}
            className="hidden h-9 items-center gap-1.5 rounded-full border border-[#D1DCE8] bg-white px-3 text-[13px] font-bold text-text-primary hover:border-brand/60 hover:text-brand sm:inline-flex"
          >
            <MessageCircle size={16} />
            카톡 상담
          </button>
        </div>
      </header>
      <p id={checkoutSummaryId} className="sr-only" {...srStatusProps(cartSummaryLive)}>
        {cartSummaryText}
      </p>
      <p id={kakaoIntentSummaryId} className="sr-only" {...srStatusProps(kakaoIntentLive)}>
        {kakaoIntentSummaryText}
      </p>
      <p id={topbarKakaoDescriptionId} className="sr-only">
        현재 검색 조건과 선택 상품을 기준으로 카카오톡 상담창을 엽니다.
      </p>
      <p id={summaryKakaoDescriptionId} className="sr-only">
        화면에 정리된 상담 조건을 카카오톡 상담 문구로 넘깁니다.
      </p>
      <p id={resultSummaryId} className="sr-only" {...srStatusProps(resultSummaryLive)}>
        {resultSummaryText}
      </p>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-7">
        <section className="min-w-0 space-y-5">
          <div className="rounded-[24px] bg-white p-5 shadow-card md:p-7">
            <div className="mb-5">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-[12px] font-bold text-brand">
                <Sparkles size={14} />
                탐색 · 비교 · 상담 연결
              </p>
              <h1 className="mt-3 text-balance text-[28px] font-extrabold leading-tight text-text-primary md:text-[36px]">
                어떤 여행을 찾는지 말해주시면, 비교해서 담아드릴게요
              </h1>
              <p className="mt-2 max-w-2xl text-pretty text-[15px] leading-7 text-text-secondary">
                호텔, 액티비티, 크루즈, 랜드사 상품을 한 번에 보고 카톡 상담이나 결제로 이어갈 수 있습니다.
              </p>
            </div>

            <form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="concierge-search">
                AI 여행 상품 검색어
              </label>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
                <input
                  id="concierge-search"
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (searchError) setSearchError('');
                    if (activePrompt && event.target.value !== activePrompt.query) setActivePrompt(null);
                  }}
                  aria-invalid={Boolean(searchError)}
                  aria-describedby={searchError ? 'concierge-search-error' : 'concierge-search-help'}
                  placeholder="예: 부산 출발 부모님 효도 여행 추천해줘"
                  className="h-13 w-full rounded-[16px] border border-[#D1DCE8] bg-white py-3 pl-11 pr-4 text-[15px] text-text-primary placeholder:text-[#B0B8C1] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                aria-describedby={resultSummaryId}
                className="h-13 rounded-[16px] bg-brand px-6 text-[15px] font-bold text-white transition hover:bg-brand-dark disabled:opacity-50"
              >
                {loading ? '검색 중' : '검색'}
              </button>
            </form>
            <p id="concierge-search-help" className="mt-2 text-[12px] font-medium text-text-secondary">
              목적지, 출발지, 인원, 예산 중 아는 조건만 적어도 추천을 시작할 수 있어요.
            </p>

            <div className="mt-4">
              <p id={intentPromptGroupLabelId} className="mb-2 text-[13px] font-bold text-text-primary">빠른 시작</p>
              <p id={intentPromptGroupDescriptionId} className="sr-only">
                칩을 선택하면 예시 문장이 검색창에 입력되고 추천 검색이 바로 시작됩니다. 선택한 의도는 카카오 상담과 단체 견적에 함께 전달됩니다.
              </p>
              <div
                className="flex max-w-full flex-wrap gap-2 pb-1"
                role="group"
                aria-labelledby={intentPromptGroupLabelId}
                aria-describedby={intentPromptGroupDescriptionId}
              >
                {INTENT_PROMPTS.map((prompt) => {
                  const selected = activePrompt?.intent === prompt.intent;
                  const promptDescriptionId = intentPromptDescriptionId(prompt.intent);
                  return (
                    <div key={prompt.intent} className="min-w-0">
                      <button
                        type="button"
                        data-testid="concierge-intent-prompt"
                        aria-pressed={selected}
                        aria-describedby={promptDescriptionId}
                        onClick={() => {
                          setQuery(prompt.query);
                          void performSearch(prompt.query, prompt);
                        }}
                        className={`max-w-full rounded-full border px-4 py-2 text-[13px] font-bold transition ${
                          selected
                            ? 'border-brand bg-brand text-white shadow-sm'
                            : 'border-[#D1DCE8] bg-white text-text-body hover:border-brand/60 hover:text-brand'
                        }`}
                      >
                        {prompt.label}
                      </button>
                      <span id={promptDescriptionId} className="sr-only">
                        {prompt.query} 조건으로 검색하고 상담 전달 조건에 {PARTY_TYPE_LABELS[prompt.party_type] ?? prompt.party_type}
                        {prompt.destination ? `, ${prompt.destination}` : ''} 정보를 저장합니다.
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {showIntentSummary && (
              <div className="mt-4 rounded-[18px] border border-[#D1DCE8] bg-[#F8FAFC] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[13px] font-extrabold text-text-primary">상담에 전달될 조건</p>
                    <p className="mt-1 text-[12px] text-text-secondary">
                      검색어와 담은 상품을 요약해 상담원이 바로 이어받을 수 있게 보냅니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="concierge-summary-kakao"
                    onClick={() => openKakaoConsult('intent_summary')}
                    aria-describedby={summaryKakaoDescriptionIds}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#FEE500] px-4 text-[13px] font-bold text-[#3C1E1E]"
                  >
                    <MessageCircle size={16} />
                    카톡으로 넘기기
                  </button>
                </div>
                {summaryItems.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {summaryItems.map((item) => (
                      <span key={item.label} className="rounded-full border border-white bg-white px-2.5 py-1 text-[12px] font-bold text-text-body shadow-sm">
                        {item.label}: {item.value}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-[12px] font-medium text-text-secondary">빠른 시작을 누르거나 검색어를 입력하면 조건이 자동으로 정리됩니다.</p>
                )}
                <div
                  id={handoffReadinessSummaryId}
                  data-testid="concierge-handoff-readiness-summary"
                  aria-label={handoffReadinessText}
                  className="mt-3 rounded-[14px] border border-white bg-white px-3 py-2 text-[12px] font-bold text-text-secondary shadow-sm"
                >
                  <span className="text-text-primary">상담 전달 준비 {handoffReadyCount}/{handoffChecklist.length}</span>
                  <span className="ml-2 font-medium">
                    {handoffMissingLabels.length > 0 ? `보완 추천: ${handoffMissingLabels.join(', ')}` : '바로 상담 가능'}
                  </span>
                </div>
                {missingConditionSuggestions.length > 0 && (
                  <div
                    data-testid="concierge-missing-condition-suggestions"
                    className="mt-2 flex flex-wrap items-center gap-1.5"
                    aria-label={`빠르게 추가할 조건: ${missingConditionSuggestions.map((item) => item.label).join(', ')}`}
                  >
                    <span className="text-[11px] font-bold text-text-secondary">빠른 추가</span>
                    {missingConditionSuggestions.map((suggestion) => (
                      <button
                        key={`${suggestion.field}-${suggestion.value}`}
                        type="button"
                        onClick={() => applyMissingConditionSuggestion(suggestion)}
                        aria-label={`${suggestion.label} 조건을 검색어에 추가`}
                        className="rounded-full border border-[#D1DCE8] bg-white px-2.5 py-1 text-[11px] font-bold text-text-body shadow-sm transition hover:border-brand/60 hover:bg-brand-light hover:text-brand"
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {searchError && (
              <div id="concierge-search-error" className="mt-4 flex items-start gap-2 rounded-[14px] border border-danger/20 bg-danger-light p-3 text-[13px] text-danger" role="alert">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p>{searchError}</p>
              </div>
            )}
          </div>

          {loading && (
            <div className="rounded-[20px] border border-[#EEF2F6] bg-white p-6 text-center shadow-card" role="status" aria-live="polite" aria-atomic="true">
              <Sparkles className="mx-auto mb-3 animate-pulse text-brand" size={32} />
              <p className="text-[15px] font-bold text-text-primary">조건에 맞는 상품을 비교하고 있습니다</p>
              <p className="mt-1 text-[13px] text-text-secondary">가격, 조건, 주의사항을 함께 정리할게요.</p>
            </div>
          )}

          {hasSearched && !loading && !searchError && results.length === 0 && (
            <section
              data-testid="concierge-empty-results"
              aria-describedby={`${resultSummaryId} ${handoffReadinessSummaryId}`}
              className="rounded-[20px] border border-[#D1DCE8] bg-white p-5 text-center shadow-card"
            >
              <Search className="mx-auto mb-3 text-text-tertiary" size={32} aria-hidden="true" />
              <h2 className="text-[17px] font-extrabold text-text-primary">지금 조건으로는 추천 결과가 없습니다</h2>
              <p className="mx-auto mt-1 max-w-xl text-[13px] leading-6 text-text-secondary">
                조건을 조금 넓히거나, 현재 입력한 내용을 상담원에게 넘겨 맞는 상품을 찾아볼 수 있습니다.
              </p>
              {summaryItems.length > 0 && (
                <div className="mt-3 flex justify-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {summaryItems.slice(0, 4).map((item) => (
                    <span
                      key={`empty:${item.label}:${item.value}`}
                      className="shrink-0 rounded-full border border-[#E5ECF3] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-text-body"
                    >
                      {item.label}: {item.value}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  data-testid="concierge-empty-kakao"
                  onClick={() => openKakaoConsult('empty_results')}
                  aria-describedby={`${resultSummaryId} ${summaryKakaoDescriptionIds}`}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-[#FEE500] px-4 text-[13px] font-bold text-[#3C1E1E]"
                >
                  <MessageCircle size={16} aria-hidden="true" />
                  카톡 상담
                </button>
                <Link
                  href={groupInquiryHref}
                  data-testid="concierge-empty-group-inquiry"
                  onClick={() => handleGroupInquiryClick('concierge_empty_results_group_inquiry')}
                  aria-describedby={`${resultSummaryId} ${handoffReadinessSummaryId}`}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-[#D1DCE8] bg-white px-4 text-[13px] font-bold text-text-primary hover:border-brand/60 hover:text-brand"
                >
                  맞춤 견적
                </Link>
                <button
                  type="button"
                  data-testid="concierge-empty-reset"
                  onClick={() => {
                    setQuery('');
                    setActivePrompt(null);
                    setSearchError('');
                    setHasSearched(false);
                    setResults([]);
                    window.requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  aria-describedby={resultSummaryId}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-[#D1DCE8] bg-[#F8FAFC] px-4 text-[13px] font-bold text-text-primary hover:border-brand/60 hover:text-brand"
                >
                  조건 다시 입력
                </button>
              </div>
            </section>
          )}

          {results.length > 0 && (
            <section className="space-y-3" aria-labelledby="concierge-results-title" aria-describedby={resultSummaryId}>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 id="concierge-results-title" className="text-[20px] font-extrabold text-text-primary">추천 결과 {results.length}건</h2>
                  <p className="mt-1 text-[13px] text-text-secondary">추천 이유와 확인할 점을 같이 보세요.</p>
                </div>
                <button
                  type="button"
                  onClick={() => openKakaoConsult('results_header')}
                  aria-describedby={resultSummaryId}
                  className="hidden rounded-full border border-[#D1DCE8] px-4 py-2 text-[13px] font-bold text-text-primary hover:border-brand/60 hover:text-brand md:inline-flex"
                >
                  상담으로 확인
                </button>
              </div>
              <div
                id={resultBundleSummaryId}
                data-testid="concierge-result-bundle-handoff"
                aria-label={resultBundleSummaryText}
                className="rounded-[20px] border border-[#D1DCE8] bg-white p-4 shadow-card"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-text-primary">
                      <ClipboardList size={16} aria-hidden="true" />
                      상위 추천 묶어서 상담
                    </p>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-text-secondary">
                      {resultHandoffProductNames.slice(0, 3).join(' · ')} 조건을 상담원에게 바로 넘깁니다.
                    </p>
                    {resultBundleHandoffItems.length > 0 && (
                      <div
                        className="mt-2 flex flex-wrap gap-1.5"
                        data-testid="concierge-result-bundle-handoff-summary"
                      >
                        {resultBundleHandoffItems.slice(0, 5).map((item) => (
                          <span
                            key={`${item.label}-${item.value}`}
                            className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#F8FAFC] px-2 py-1 text-[11px] font-bold text-text-secondary ring-1 ring-[#E5ECF3]"
                          >
                            <span className="text-text-tertiary">{item.label}</span>
                            <span className="max-w-[8rem] truncate text-text-primary">{item.value}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      id={resultBundleConfirmId}
                      data-testid="concierge-result-bundle-handoff-confirm"
                      aria-label={resultBundleConfirmText}
                      className="mt-3 grid grid-cols-3 gap-2 rounded-[14px] border border-[#E5ECF3] bg-[#F8FAFC] p-2"
                    >
                      {resultBundleConfirmItems.map((item) => (
                        <div key={`${item.label}-${item.value}`} className="min-w-0 rounded-[12px] bg-white px-2 py-1.5">
                          <p className="text-[10px] font-bold text-text-tertiary">{item.label}</p>
                          <p className="mt-0.5 truncate text-[11px] font-black text-text-primary">{item.value}</p>
                        </div>
                      ))}
                    </div>
                    <p
                      id={resultBundleNextActionId}
                      data-testid="concierge-result-bundle-next-action"
                      className="mt-3 rounded-[14px] bg-brand-light px-3 py-2 text-[12px] font-bold leading-5 text-brand"
                    >
                      {resultBundleNextActionText}
                    </p>
                    <p
                      id={resultBundleRiskNoteId}
                      data-testid="concierge-result-bundle-risk-note"
                      aria-label={resultBundleRiskNoteText}
                      className="mt-2 rounded-[14px] border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] font-bold leading-5 text-amber-800"
                    >
                      {resultBundleRiskNoteText}
                    </p>
                    <p id={resultBundleAddToCartId} className="sr-only">
                      {resultBundleAddToCartText}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 md:flex md:shrink-0">
                    <button
                      type="button"
                      data-testid="concierge-result-bundle-add-to-cart"
                      onClick={addResultBundleToCart}
                      disabled={resultBundleItems.length === 0 || resultBundleAddableCount === 0}
                      aria-describedby={resultBundleDescriptionIds}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-brand px-3 text-[13px] font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-[#D1DCE8] disabled:text-text-secondary"
                    >
                      <Plus size={16} aria-hidden="true" />
                      담기
                    </button>
                    <button
                      type="button"
                      data-testid="concierge-result-bundle-kakao"
                      onClick={() => openKakaoConsult('results_bundle', undefined, resultHandoffProductNames)}
                      aria-describedby={resultBundleDescriptionIds}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#FEE500] px-4 text-[13px] font-bold text-[#3C1E1E]"
                    >
                      <MessageCircle size={16} aria-hidden="true" />
                      카톡
                    </button>
                    <Link
                      href={resultBundleGroupInquiryHref}
                      data-testid="concierge-result-bundle-group-inquiry"
                      onClick={() => {
                        trackEngagement({
                          event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
                          source: 'concierge_results_bundle_group_inquiry',
                          page_url: '/concierge',
                          ...intentSummary,
                          selected_products: resultHandoffProductNames,
                          metadata: {
                            action: 'group_inquiry_handoff',
                            selectedProductNames: resultHandoffProductNames,
                          },
                        });
                      }}
                      aria-describedby={resultBundleDescriptionIds}
                      className="inline-flex h-10 items-center justify-center rounded-full border border-[#D1DCE8] bg-white px-4 text-[13px] font-bold text-text-primary hover:border-brand/60 hover:text-brand"
                    >
                      견적
                    </Link>
                  </div>
                </div>
              </div>
              <RecommendationBrief
                items={resultBriefItems}
                summaryId={resultBriefSummaryId}
                summaryText={resultBriefSummaryText}
              />
              <ResultComparisonTable
                results={results}
                summaryId={resultSummaryId}
                getGroupInquiryHref={(item) => buildGroupInquiryHandoffHref({
                  source: 'concierge_comparison',
                  intent: intentSummary.intent ?? undefined,
                  partyType: intentSummary.party_type ?? undefined,
                  query: query.trim() || activePrompt?.query || `${item.product_name} 단체 견적`,
                  destination: intentSummary.destination,
                  budget: intentSummary.budget || `예상가 ${money(item.price)}`,
                  selectedProducts: [item.product_name],
                })}
                onAdd={(item) => addToCart(item)}
                onViewDetail={(item) => {
                  const recommendationRank = results.findIndex((result) => result.product_id === item.product_id) + 1;
                  trackEngagement({
                    event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
                    source: 'concierge_comparison_detail',
                    product_id: item.product_id,
                    product_name: item.product_name,
                    page_url: '/concierge',
                    recommended_rank: recommendationRank > 0 ? recommendationRank : null,
                    metadata: {
                      ...buildConciergeDecisionMetadata({
                        intentSummary,
                        query,
                        activePromptLabel: activePrompt?.label,
                        selectedProductCount: Math.max(intentSummary.selected_products?.length ?? 0, 1),
                      }),
                      action: 'view_detail_from_comparison',
                      resultIndex: recommendationRank > 0 ? recommendationRank : null,
                      apiName: item.api_name,
                      productType: item.product_type,
                    },
                    ...intentSummary,
                  });
                }}
                onConsult={(item) => openKakaoConsult('comparison_table', item)}
                onGroupInquiry={(item) => {
                  const recommendationRank = results.findIndex((result) => result.product_id === item.product_id) + 1;
                  trackEngagement({
                    event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
                    source: 'concierge_comparison_group_inquiry',
                    product_id: item.product_id,
                    product_name: item.product_name,
                    page_url: '/concierge',
                    recommended_rank: recommendationRank > 0 ? recommendationRank : null,
                    ...intentSummary,
                    selected_products: [item.product_name],
                    metadata: {
                      ...buildConciergeDecisionMetadata({
                        intentSummary,
                        query,
                        activePromptLabel: activePrompt?.label,
                        selectedProductCount: Math.max(intentSummary.selected_products?.length ?? 0, 1),
                      }),
                      action: 'group_inquiry_from_comparison',
                      resultIndex: recommendationRank > 0 ? recommendationRank : null,
                      apiName: item.api_name,
                      productType: item.product_type,
                    },
                  });
                }}
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {results.map((item, index) => (
                  <ResultCard
                    key={item.product_id}
                    item={item}
                    summaryId={resultSummaryId}
                    groupInquiryHref={buildGroupInquiryHandoffHref({
                      source: 'concierge_result',
                      intent: intentSummary.intent ?? undefined,
                      partyType: intentSummary.party_type ?? undefined,
                      query: query.trim() || activePrompt?.query || `${item.product_name} 단체 견적`,
                      destination: intentSummary.destination,
                      budget: intentSummary.budget || `예상가 ${money(item.price)}`,
                      selectedProducts: [item.product_name],
                    })}
                    onAdd={() => addToCart(item)}
                    onViewDetail={() => {
                      trackEngagement({
                        event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
                        source: 'concierge_result_detail',
                        product_id: item.product_id,
                        product_name: item.product_name,
                        page_url: '/concierge',
                        recommended_rank: index + 1,
                        metadata: {
                          ...buildConciergeDecisionMetadata({
                            intentSummary,
                            query,
                            activePromptLabel: activePrompt?.label,
                            selectedProductCount: Math.max(intentSummary.selected_products?.length ?? 0, 1),
                          }),
                          action: 'view_detail',
                          resultIndex: index + 1,
                          apiName: item.api_name,
                          productType: item.product_type,
                        },
                        ...intentSummary,
                      });
                    }}
                    onConsult={() => {
                      trackEngagement({
                        event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
                        source: 'concierge_result_kakao',
                        product_id: item.product_id,
                        product_name: item.product_name,
                        page_url: '/concierge',
                        recommended_rank: index + 1,
                        metadata: {
                          ...buildConciergeDecisionMetadata({
                            intentSummary,
                            query,
                            activePromptLabel: activePrompt?.label,
                            selectedProductCount: Math.max(intentSummary.selected_products?.length ?? 0, 1),
                          }),
                          action: 'kakao_from_result',
                        },
                        ...intentSummary,
                      });
                      openKakaoConsult('result_card', item);
                    }}
                    onGroupInquiry={() => {
                      trackEngagement({
                        event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
                        source: 'concierge_result_group_inquiry',
                        product_id: item.product_id,
                        product_name: item.product_name,
                        page_url: '/concierge',
                        recommended_rank: index + 1,
                        ...intentSummary,
                        selected_products: [item.product_name],
                        metadata: {
                          ...buildConciergeDecisionMetadata({
                            intentSummary,
                            query,
                            activePromptLabel: activePrompt?.label,
                            selectedProductCount: Math.max(intentSummary.selected_products?.length ?? 0, 1),
                          }),
                          action: 'group_inquiry_handoff',
                          resultIndex: index + 1,
                          apiName: item.api_name,
                          productType: item.product_type,
                        },
                      });
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </section>

        <aside className="hidden min-w-0 lg:block">
          <div className="sticky top-[76px] overflow-hidden rounded-[24px] border border-[#E5E7EB] bg-white shadow-card">
            <div className="border-b border-[#EEF2F6] px-5 py-4">
              <h2 className="flex items-center gap-2 text-[17px] font-extrabold text-text-primary">
                <Package size={19} />
                선택한 구성
              </h2>
              <p className="mt-1 text-[12px] text-text-secondary">담은 상품을 공유하거나 상담으로 넘길 수 있어요.</p>
            </div>
            <div className="max-h-[calc(100dvh-280px)] overflow-y-auto p-5">{renderCartItems()}</div>
            <CartActions
              surface="desktop"
              cartCount={cart.length}
              cartTotal={cartTotal}
              summaryItems={summaryItems}
              handoffReadinessText={handoffReadinessText}
              handoffReadyCount={handoffReadyCount}
              handoffTotalCount={handoffChecklist.length}
              groupInquiryHref={groupInquiryHref}
              canGroupInquiry={canGroupInquiryFromCartActions}
              sharing={sharing}
              checkoutOpen={checkoutOpen}
              onShare={handleShare}
              onCheckout={() => setCheckoutOpen(true)}
              onKakao={() => openKakaoConsult('desktop_cart')}
              onGroupInquiry={() => handleGroupInquiryClick('desktop_cart')}
            />
          </div>
        </aside>
      </main>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[#E5E7EB] bg-white/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-lg items-center gap-3 px-4">
            <button
              type="button"
              data-testid="concierge-mobile-cart-open"
              aria-haspopup="dialog"
              aria-expanded={cartSheetOpen}
              aria-controls="concierge-cart-sheet"
              aria-describedby={checkoutSummaryId}
              onClick={(event) => openCartSheet(event.currentTarget)}
              className="min-w-0 flex-1 rounded-[16px] bg-[#F8FAFC] px-4 py-3 text-left"
            >
              <span className="block text-[12px] font-bold text-text-secondary">선택한 구성 {cart.length}개</span>
              <span className="block truncate text-[16px] font-extrabold text-text-primary">{money(cartTotal)} · 보기</span>
            </button>
            <button
              type="button"
              onClick={() => openKakaoConsult('mobile_cart_bar')}
              className="flex size-12 items-center justify-center rounded-full bg-[#FEE500] text-[#3C1E1E]"
              aria-label="카카오톡 상담"
              aria-describedby={checkoutSummaryId}
            >
              <MessageCircle size={21} />
            </button>
            <Link
              href={groupInquiryHref}
              data-testid="concierge-mobile-cart-group-inquiry"
              aria-describedby={checkoutSummaryId}
              onClick={() => handleGroupInquiryClick('mobile_cart_bar')}
              className="flex h-12 items-center justify-center rounded-full bg-brand px-5 text-[14px] font-bold text-white"
            >
              견적
            </Link>
          </div>
        </div>
      )}

      {cartSheetOpen && (
        <ModalFrame
          title="선택한 구성"
          dialogId="concierge-cart-sheet"
          testId="concierge-cart-sheet"
          closeTestId="concierge-cart-sheet-close"
          onClose={() => closeCartSheet()}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{renderCartItems()}</div>
          <CartActions
            surface="mobile"
            cartCount={cart.length}
            cartTotal={cartTotal}
            summaryItems={summaryItems}
            handoffReadinessText={handoffReadinessText}
            handoffReadyCount={handoffReadyCount}
            handoffTotalCount={handoffChecklist.length}
            groupInquiryHref={groupInquiryHref}
            canGroupInquiry={canGroupInquiryFromCartActions}
            sharing={sharing}
            checkoutOpen={checkoutOpen}
            onShare={handleShare}
            onCheckout={() => {
              closeCartSheet(false);
              setCheckoutOpen(true);
            }}
            onKakao={() => openKakaoConsult('mobile_cart_sheet')}
            onGroupInquiry={() => handleGroupInquiryClick('mobile_cart_sheet')}
          />
        </ModalFrame>
      )}

      {checkoutOpen && (
        <ModalFrame
          title="고객 정보 입력"
          dialogId="concierge-checkout-dialog"
          testId="concierge-checkout-dialog"
          closeTestId="concierge-checkout-close"
          autoFocusClose={false}
          onClose={() => { setCheckoutOpen(false); setCheckoutError(''); }}
        >
          <form onSubmit={handleCheckout} className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-4">
              <div>
                <label htmlFor="concierge-customer-name" className="mb-1 block text-[13px] font-bold text-text-primary">
                  이름 *
                </label>
                <input
                  id="concierge-customer-name"
                  ref={customerNameRef}
                  type="text"
                  required
                  value={customer.name}
                  onChange={(event) => {
                    setCustomer((current) => ({ ...current, name: event.target.value }));
                    if (checkoutError) setCheckoutError('');
                  }}
                  aria-invalid={Boolean(checkoutError && !customer.name.trim())}
                  aria-describedby={checkoutDescriptionIds}
                  className="h-11 w-full rounded-[12px] border border-[#D1DCE8] px-3 text-[15px] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  placeholder="홍길동"
                />
              </div>
              <div>
                <label htmlFor="concierge-customer-phone" className="mb-1 block text-[13px] font-bold text-text-primary">
                  연락처
                </label>
                <input
                  id="concierge-customer-phone"
                  type="tel"
                  value={customer.phone}
                  onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))}
                  aria-describedby={checkoutSummaryId}
                  className="h-11 w-full rounded-[12px] border border-[#D1DCE8] px-3 text-[15px] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  placeholder="010-0000-0000"
                />
              </div>
              <div>
                <label htmlFor="concierge-customer-email" className="mb-1 block text-[13px] font-bold text-text-primary">
                  이메일
                </label>
                <input
                  id="concierge-customer-email"
                  type="email"
                  value={customer.email}
                  onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))}
                  aria-describedby={checkoutSummaryId}
                  className="h-11 w-full rounded-[12px] border border-[#D1DCE8] px-3 text-[15px] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  placeholder="example@email.com"
                />
              </div>

              <div className="rounded-[14px] bg-[#F8FAFC] p-4 text-[14px]">
                <div className="flex justify-between gap-3">
                  <span className="text-text-secondary">결제 금액</span>
                  <span className="font-extrabold text-text-primary">{money(cartTotal)}</span>
                </div>
                <p className="mt-1 text-[12px] text-text-secondary">{cart.length}개 상품</p>
              </div>

              <div
                id={checkoutHandoffSummaryId}
                data-testid="concierge-checkout-handoff-summary"
                className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-extrabold text-text-secondary">상담 전달 조건</p>
                    <p className="mt-1 text-[12px] font-semibold leading-5 text-text-primary">{handoffReadinessText}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-extrabold text-brand">
                    {handoffReadyCount}/{handoffChecklist.length}
                  </span>
                </div>
                {summaryItems.length > 0 && (
                  <dl className="mt-3 grid grid-cols-2 gap-2">
                    {summaryItems.slice(0, 4).map((item) => (
                      <div key={`checkout:${item.label}`} className="min-w-0 rounded-[10px] bg-[#F8FAFC] px-2.5 py-2">
                        <dt className="text-[10px] font-bold text-text-secondary">{item.label}</dt>
                        <dd className="mt-0.5 truncate text-[12px] font-extrabold text-text-primary">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              <p
                id={checkoutSubmitDecisionSummaryId}
                data-testid="concierge-checkout-submit-decision-summary"
                aria-label={checkoutSubmitDecisionSummaryText}
                className={`rounded-[14px] border px-3 py-2.5 text-[12px] font-bold leading-5 ${
                  checkoutSubmitMissingLabels.length > 0
                    ? 'border-[#E5E7EB] bg-white text-text-secondary'
                    : 'border-brand/15 bg-brand-light text-brand'
                }`}
              >
                <span className="font-extrabold">
                  {checkoutSubmitMissingLabels.length > 0
                    ? `결제 준비 ${checkoutSubmitReadyCount}/${checkoutSubmitChecklist.length}`
                    : '결제 준비 완료'}
                </span>
                <span className="ml-1">{checkoutSubmitDecisionSummaryText}</span>
              </p>

              {checkoutError && (
                <div id="concierge-checkout-error" className="rounded-[14px] border border-danger/20 bg-danger-light p-3 text-[13px] text-danger" role="alert">
                  {checkoutError}
                </div>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setCheckoutOpen(false); setCheckoutError(''); }}
                className="h-11 rounded-full border border-[#D1DCE8] text-[14px] font-bold text-text-body hover:bg-[#F8FAFC]"
              >
                취소
              </button>
              <button
                type="submit"
                data-testid="concierge-checkout-submit"
                disabled={paying}
                aria-busy={paying}
                aria-describedby={checkoutDescriptionIds}
                className="h-11 rounded-full bg-brand text-[14px] font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {paying ? '처리 중' : '결제 완료'}
              </button>
            </div>
          </form>
        </ModalFrame>
      )}

      {shareToast && (
        <div
          className="fixed bottom-[calc(104px+env(safe-area-inset-bottom))] left-1/2 z-[90] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2.5 text-[13px] font-bold text-white shadow-lg"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="concierge-share-toast"
        >
          {shareToast}
        </div>
      )}
    </div>
  );
}

function ResultComparisonTable({
  results,
  summaryId,
  getGroupInquiryHref,
  onAdd,
  onViewDetail,
  onConsult,
  onGroupInquiry,
}: {
  results: MockSearchResult[];
  summaryId: string;
  getGroupInquiryHref: (item: MockSearchResult) => string;
  onAdd: (item: MockSearchResult) => void | Promise<void>;
  onViewDetail: (item: MockSearchResult) => void;
  onConsult: (item: MockSearchResult) => void;
  onGroupInquiry: (item: MockSearchResult) => void;
}) {
  if (results.length < 2) return null;

  const comparisonItems = results.slice(0, 5);

  return (
    <section aria-labelledby="concierge-comparison-title" aria-describedby={summaryId} className="overflow-hidden rounded-[20px] border border-[#E5E7EB] bg-white shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-[#EEF2F6] px-4 py-3">
        <div>
          <h3 id="concierge-comparison-title" className="text-[15px] font-extrabold text-text-primary">
            추천 비교표
          </h3>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            가격, 추가 비용, 다음 액션을 먼저 좁혀보세요.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[#F2F4F6] px-2.5 py-1 text-[11px] font-bold text-text-secondary">
          상위 {comparisonItems.length}개
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead className="bg-[#F8FAFC] text-[11px] font-extrabold text-text-secondary">
            <tr>
              <th scope="col" className="px-4 py-3">
                상품
              </th>
              <th scope="col" className="px-3 py-3">
                유형
              </th>
              <th scope="col" className="px-3 py-3">
                예상가
              </th>
              <th scope="col" className="px-3 py-3">
                확인 포인트
              </th>
              <th scope="col" className="px-3 py-3">
                추가 비용 가능성
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                다음 액션
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF2F6]">
            {comparisonItems.map((item) => {
              const insight = getResultInsight(item);
              const category = resolveCategory(item);
              const categoryLabel = category === 'DYNAMIC' ? '실시간 조건' : '고정 패키지';
              const detailHref = category === 'FIXED' ? `/packages/${encodeURIComponent(item.product_id)}` : null;
              const groupInquiryHref = getGroupInquiryHref(item);
              const rowHandoffSummaryId = `concierge-comparison-handoff-${item.product_id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
              const rowHandoffSummaryText = `상담 전달 조건: 상품 ${item.product_name}, 예상가 ${money(item.price)}, 유형 ${categoryLabel}.`;
              const rowActionDescriptionIds = `${summaryId} ${rowHandoffSummaryId}`;

              return (
                <tr key={item.product_id} className="align-top">
                  <th scope="row" className="max-w-[220px] px-4 py-3 font-bold text-text-primary">
                    <span className="block line-clamp-2">{item.product_name}</span>
                    <span className="mt-1 block text-[11px] font-bold text-text-secondary">{API_LABELS[item.api_name] ?? item.api_name}</span>
                    <span
                      id={rowHandoffSummaryId}
                      data-testid="concierge-comparison-handoff-summary"
                      aria-label={rowHandoffSummaryText}
                      className="mt-2 flex flex-wrap gap-1"
                    >
                      <span className="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-extrabold text-brand">
                        상담 전달
                      </span>
                      <span className="rounded-full bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-bold text-text-secondary ring-1 ring-[#E5ECF3]">
                        상품
                      </span>
                      <span className="rounded-full bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-bold text-text-primary ring-1 ring-[#E5ECF3]">
                        {money(item.price)}
                      </span>
                    </span>
                  </th>
                  <td className="px-3 py-3">
                    <span className="inline-flex rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-text-secondary">
                      {PRODUCT_TYPE_LABELS[item.product_type] ?? item.product_type}
                    </span>
                    <span className="mt-1 block text-[11px] font-bold text-text-secondary">{categoryLabel}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-extrabold text-brand">{money(item.price)}</td>
                  <td className="max-w-[150px] px-3 py-3 font-bold text-text-primary">{insight.action}</td>
                  <td className="max-w-[220px] px-3 py-3 leading-5 text-text-secondary">{insight.extraCost}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {detailHref && (
                        <Link
                          href={detailHref}
                          onClick={() => onViewDetail(item)}
                          aria-label={`${item.product_name} 비교표에서 상세 보기`}
                          aria-describedby={rowActionDescriptionIds}
                          className="inline-flex h-9 items-center justify-center rounded-full border border-[#D1DCE8] bg-white px-3 text-[12px] font-bold text-text-primary hover:border-brand/60 hover:text-brand"
                        >
                          상세
                        </Link>
                      )}
                      <Link
                        href={groupInquiryHref}
                        onClick={() => onGroupInquiry(item)}
                        data-testid="concierge-comparison-group-inquiry"
                        aria-label={`${item.product_name} 비교표에서 단체 견적 문의`}
                        aria-describedby={rowActionDescriptionIds}
                        className="inline-flex h-9 items-center justify-center rounded-full border border-[#D1DCE8] bg-white px-3 text-[12px] font-bold text-text-primary hover:border-brand/60 hover:text-brand"
                      >
                        견적
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          void onAdd(item);
                        }}
                        aria-label={`${item.product_name} 비교표에서 담기`}
                        aria-describedby={rowActionDescriptionIds}
                        className="h-9 rounded-full bg-brand px-3 text-[12px] font-bold text-white hover:bg-brand-dark"
                      >
                        담기
                      </button>
                      <button
                        type="button"
                        onClick={() => onConsult(item)}
                        aria-label={`${item.product_name} 비교표에서 카카오톡 상담`}
                        aria-describedby={rowActionDescriptionIds}
                        className="flex size-9 items-center justify-center rounded-full bg-[#FEE500] text-[#3C1E1E]"
                      >
                        <MessageCircle size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecommendationBrief({
  items,
  summaryId,
  summaryText,
}: {
  items: Array<{
    rank: number;
    name: string;
    price: string;
    reason: string;
    caution: string;
    extraCost: string;
    action: string;
  }>;
  summaryId: string;
  summaryText: string;
}) {
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="concierge-result-brief-title"
      aria-describedby={summaryId}
      data-testid="concierge-result-brief"
      className="rounded-[20px] border border-[#E5E7EB] bg-white p-4 shadow-card"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 id="concierge-result-brief-title" className="text-[15px] font-extrabold text-text-primary">
            AI 추천 브리핑
          </h3>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            이유, 주의점, 추가 비용, 다음 액션을 먼저 좁혀보세요.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-extrabold text-brand">
          상위 {items.length}개
        </span>
      </div>
      <p id={summaryId} className="sr-only">
        {summaryText}
      </p>
      <div className="grid gap-3">
        {items.map((item) => (
          <article
            key={`${item.rank}:${item.name}`}
            data-testid="concierge-result-brief-item"
            className="rounded-[16px] border border-[#EEF2F6] bg-[#F8FAFC] p-3"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold text-brand">{item.rank}순위</p>
                <h4 className="mt-0.5 line-clamp-1 text-[14px] font-extrabold text-text-primary">{item.name}</h4>
              </div>
              <p className="shrink-0 text-[13px] font-extrabold text-brand">{item.price}</p>
            </div>
            <dl className="grid gap-2 text-[12px] leading-5 md:grid-cols-2">
              <BriefLine icon="reason" label="추천 이유" value={item.reason} />
              <BriefLine icon="caution" label="주의할 점" value={item.caution} />
              <BriefLine icon="cost" label="추가 비용" value={item.extraCost} />
              <BriefLine icon="action" label="다음 액션" value={item.action} />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function BriefLine({
  icon,
  label,
  value,
}: {
  icon: 'reason' | 'caution' | 'cost' | 'action';
  label: string;
  value: string;
}) {
  const Icon =
    icon === 'reason'
      ? CheckCircle2
      : icon === 'caution'
        ? AlertTriangle
        : icon === 'cost'
          ? Wallet
          : Send;
  const tone =
    icon === 'reason'
      ? 'text-emerald-600'
      : icon === 'caution'
        ? 'text-amber-600'
        : icon === 'cost'
          ? 'text-blue-600'
          : 'text-brand';

  return (
    <div className="grid grid-cols-[18px_64px_1fr] gap-2">
      <Icon className={`mt-0.5 h-4 w-4 ${tone}`} aria-hidden="true" />
      <dt className="font-extrabold text-text-primary">{label}</dt>
      <dd className="min-w-0 text-text-secondary">{value}</dd>
    </div>
  );
}

function ResultCard({
  item,
  summaryId,
  groupInquiryHref,
  onAdd,
  onViewDetail,
  onConsult,
  onGroupInquiry,
}: {
  item: MockSearchResult;
  summaryId: string;
  groupInquiryHref: string;
  onAdd: () => void;
  onViewDetail: () => void;
  onConsult: () => void;
  onGroupInquiry: () => void;
}) {
  const insight = getResultInsight(item);
  const tone = PRODUCT_TYPE_TONES[item.product_type] ?? 'bg-brand-light text-brand border-blue-100';
  const category = resolveCategory(item);
  const categoryLabel = category === 'DYNAMIC' ? '실시간' : '고정패키지';
  const detailHref = category === 'FIXED' ? `/packages/${encodeURIComponent(item.product_id)}` : null;
  const actionChecklist = [
    { label: '추천 이유', value: insight.reason },
    { label: '주의할 점', value: insight.caution },
    { label: '추가 비용', value: insight.extraCost },
    { label: '다음 액션', value: insight.action },
  ];
  const actionChecklistId = `concierge-result-action-checklist-${item.product_id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const actionChecklistSummary = `상담 전 체크: ${actionChecklist.map((item) => `${item.label} ${item.value}`).join(', ')}`;
  const resultCtaDecisionSummaryId = `concierge-result-cta-decision-${item.product_id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const resultCtaDecisionSummaryText = detailHref
    ? 'CTA 선택 기준: 상세는 일정과 포함 조건 확인, 견적은 단체 조건 전달, 담기는 비교 저장, 카톡은 바로 상담으로 이어집니다.'
    : 'CTA 선택 기준: 견적은 단체 조건 전달, 담기는 비교 저장, 카톡은 바로 상담으로 이어집니다.';
  const resultActionDescriptionIds = `${summaryId} ${actionChecklistId} ${resultCtaDecisionSummaryId}`;
  const ctaGridClass = detailHref
    ? 'grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto]'
    : 'grid-cols-2 sm:grid-cols-[1fr_1fr_auto]';
  const kakaoCtaClass = detailHref
    ? 'flex h-11 w-full items-center justify-center rounded-full bg-[#FEE500] text-[#3C1E1E] sm:size-11 sm:w-11'
    : 'col-span-2 flex h-11 w-full items-center justify-center rounded-full bg-[#FEE500] text-[#3C1E1E] sm:col-span-1 sm:size-11 sm:w-11';

  return (
    <article className="flex min-h-[360px] flex-col rounded-[20px] border border-[#E5E7EB] bg-white p-4 shadow-card">
      <div className="mb-3 flex items-center gap-1.5">
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone}`}>
          {PRODUCT_TYPE_LABELS[item.product_type] ?? item.product_type}
        </span>
        <span className="rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-text-secondary">
          {categoryLabel}
        </span>
        <span className="ml-auto text-[11px] font-bold text-text-secondary">{API_LABELS[item.api_name] ?? item.api_name}</span>
      </div>

      <h3 className="text-balance text-[17px] font-extrabold leading-snug text-text-primary">{item.product_name}</h3>
      <p className="mt-2 line-clamp-2 text-pretty text-[13px] leading-6 text-text-secondary">{item.description}</p>

      <div className="mt-4 space-y-2 text-[12px] leading-5">
        <InfoLine label="왜 추천" value={insight.reason} />
        <InfoLine label="주의" value={insight.caution} />
        <InfoLine label="추가 비용" value={insight.extraCost} />
      </div>

      {item.product_type === 'CRUISE' && item.attrs && (
        <div className="mt-3 rounded-[14px] bg-sky-50 p-3 text-[12px] leading-5 text-sky-800">
          {item.attrs.ship_name ? <p>선박: {String(item.attrs.ship_name)}</p> : null}
          {item.attrs.cabin_class ? <p>선실: {String(item.attrs.cabin_class)}</p> : null}
          {item.attrs.departure_port ? <p>출항: {String(item.attrs.departure_port)}</p> : null}
        </div>
      )}

      <div className="mt-auto pt-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-text-secondary">예상가</p>
            <p className="text-[20px] font-extrabold text-brand">{money(item.price)}</p>
          </div>
          <p className="text-right text-[11px] font-bold text-text-secondary">{insight.action}</p>
        </div>
        <div
          id={actionChecklistId}
          data-testid="concierge-result-action-checklist"
          aria-label={actionChecklistSummary}
          className="mb-3 rounded-[16px] border border-[#EEF2F6] bg-[#F8FAFC] p-3"
        >
          <p className="text-[11px] font-extrabold text-text-primary">상담 전 체크</p>
          <dl className="mt-2 grid gap-1.5 text-[11px] leading-5">
            {actionChecklist.map((check) => (
              <div key={check.label} className="grid grid-cols-[64px_1fr] gap-2">
                <dt className="font-bold text-text-secondary">{check.label}</dt>
                <dd className="line-clamp-1 font-semibold text-text-primary">{check.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p
          id={resultCtaDecisionSummaryId}
          data-testid="concierge-result-cta-decision-summary"
          aria-label={resultCtaDecisionSummaryText}
          className="mb-3 rounded-[14px] border border-brand/10 bg-brand-light px-3 py-2 text-[11px] font-bold leading-5 text-brand"
        >
          {resultCtaDecisionSummaryText}
        </p>
        <div className={`grid gap-2 ${ctaGridClass}`}>
          {detailHref && (
            <Link
              href={detailHref}
              onClick={onViewDetail}
              aria-label={`${item.product_name} 상세 보기`}
              aria-describedby={resultActionDescriptionIds}
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#D1DCE8] bg-white px-3 text-[14px] font-bold text-text-primary hover:border-brand/60 hover:text-brand"
            >
              상세 보기
            </Link>
          )}
          <Link
            href={groupInquiryHref}
            onClick={onGroupInquiry}
            data-testid="concierge-result-group-inquiry"
            aria-label={`${item.product_name} 단체 견적 문의`}
            aria-describedby={resultActionDescriptionIds}
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#D1DCE8] bg-white px-3 text-[14px] font-bold text-text-primary hover:border-brand/60 hover:text-brand"
          >
            견적
          </Link>
          <button
            type="button"
            onClick={onAdd}
            data-testid="concierge-result-add"
            aria-label={`${item.product_name} 담기`}
            aria-describedby={resultActionDescriptionIds}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-brand text-[14px] font-bold text-white hover:bg-brand-dark"
          >
            <Plus size={17} />
            담기
          </button>
          <button
            type="button"
            onClick={onConsult}
            aria-label={`${item.product_name} 카카오톡 상담`}
            aria-describedby={resultActionDescriptionIds}
            className={kakaoCtaClass}
          >
            <MessageCircle size={19} />
            <span className="ml-1.5 text-[14px] font-bold sm:sr-only">상담</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[58px_1fr] gap-2">
      <span className="font-bold text-text-primary">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  );
}

function CartGroup({
  title,
  items,
  onRemove,
}: {
  title: string;
  items: CartItem[];
  onRemove: (productId: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-extrabold text-text-secondary">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.product_id} className="rounded-[16px] bg-[#F8FAFC] p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-brand">{PRODUCT_TYPE_LABELS[item.product_type]}</p>
                <p className="mt-0.5 line-clamp-2 text-[13px] font-bold leading-5 text-text-primary">{item.product_name}</p>
                <p className="mt-1 text-[14px] font-extrabold text-brand">{money(item.price * item.quantity)}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(item.product_id)}
                aria-label={`${item.product_name} 제거`}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-white hover:text-danger"
              >
                <X size={17} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CartActions({
  surface,
  cartCount,
  cartTotal,
  summaryItems,
  handoffReadinessText,
  handoffReadyCount,
  handoffTotalCount,
  groupInquiryHref,
  canGroupInquiry,
  sharing,
  checkoutOpen,
  onShare,
  onCheckout,
  onKakao,
  onGroupInquiry,
}: {
  surface: 'desktop' | 'mobile';
  cartCount: number;
  cartTotal: number;
  summaryItems: SummaryItem[];
  handoffReadinessText: string;
  handoffReadyCount: number;
  handoffTotalCount: number;
  groupInquiryHref: string;
  canGroupInquiry: boolean;
  sharing: boolean;
  checkoutOpen: boolean;
  onShare: () => void;
  onCheckout: () => void;
  onKakao: () => void;
  onGroupInquiry: () => void;
}) {
  const cartActionSummaryId = `concierge-cart-action-summary-${surface}`;
  const cartShareDescriptionId = `concierge-cart-share-description-${surface}`;
  const cartKakaoDescriptionId = `concierge-cart-kakao-description-${surface}`;
  const cartGroupInquiryDescriptionId = `concierge-cart-group-inquiry-description-${surface}`;
  const cartCheckoutDescriptionId = `concierge-cart-checkout-description-${surface}`;
  const cartReadinessSummaryId = `concierge-cart-readiness-summary-${surface}`;
  const cartShareDescriptionIds = `${cartShareDescriptionId} ${cartActionSummaryId} ${cartReadinessSummaryId}`;
  const cartKakaoDescriptionIds = `${cartKakaoDescriptionId} ${cartActionSummaryId} ${cartReadinessSummaryId}`;
  const cartGroupInquiryDescriptionIds = `${cartGroupInquiryDescriptionId} ${cartActionSummaryId} ${cartReadinessSummaryId}`;
  const cartCheckoutDescriptionIds = `${cartCheckoutDescriptionId} ${cartActionSummaryId} ${cartReadinessSummaryId}`;
  const cartActionSummaryLive = cartCount > 0 || summaryItems.length > 0;
  const cartActionSummaryText = [
    cartCount > 0 ? `선택한 구성은 ${cartCount}개 상품입니다.` : '선택한 상품이 없습니다.',
    cartTotal > 0 ? `총 금액은 ${money(cartTotal)}입니다.` : null,
    handoffReadinessText,
    summaryItems.length > 0 ? `상담 전달 조건은 ${summaryItems.map((item) => `${item.label} ${item.value}`).join(', ')}입니다.` : null,
  ].filter(Boolean).join(' ');

  return (
    <div className="shrink-0 border-t border-[#EEF2F6] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <p id={cartActionSummaryId} className="sr-only" {...srStatusProps(cartActionSummaryLive)}>
        {cartActionSummaryText}
      </p>
      <p id={cartShareDescriptionId} className="sr-only">
        선택 상품과 상담 조건을 복사해 다른 상담 채널에 붙여넣을 수 있게 합니다.
      </p>
      <p id={cartKakaoDescriptionId} className="sr-only">
        선택 상품과 상담 조건을 상담 문구로 정리해 카카오톡 상담창으로 이어갑니다.
      </p>
      <p id={cartGroupInquiryDescriptionId} className="sr-only">
        선택 상품과 상담 조건을 단체 맞춤 견적 문의로 이어갑니다.
      </p>
      <p id={cartCheckoutDescriptionId} className="sr-only">
        선택 상품과 상담 조건을 바탕으로 결제 요청 입력창을 엽니다.
      </p>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold text-text-secondary">총 {cartCount}개 상품</p>
          <p className="text-[20px] font-extrabold text-text-primary">{money(cartTotal)}</p>
        </div>
        <button
          type="button"
          onClick={onKakao}
          aria-describedby={cartKakaoDescriptionIds}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#FEE500] px-3 text-[13px] font-bold text-[#3C1E1E]"
        >
          <MessageCircle size={16} />
          상담
        </button>
      </div>
      <div
        id={cartReadinessSummaryId}
        data-testid="concierge-cart-readiness-summary"
        aria-label={handoffReadinessText}
        className="mb-4 rounded-[14px] border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold text-text-secondary">상담 준비</p>
            <p className="mt-0.5 text-[12px] font-semibold leading-5 text-text-primary">{handoffReadinessText}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-brand ring-1 ring-[#E5ECF3]">
            {handoffReadyCount}/{handoffTotalCount}
          </span>
        </div>
      </div>
      {summaryItems.length > 0 && (
        <div
          className="mb-4 rounded-[14px] border border-[#E5E7EB] bg-[#F8FAFC] p-3"
          aria-label="상담 전달 조건"
          aria-describedby={cartActionSummaryId}
          data-testid="concierge-cart-handoff-summary"
        >
          <p className="mb-2 text-[11px] font-extrabold text-text-secondary">상담 전달 조건</p>
          <dl className="grid grid-cols-2 gap-2">
            {summaryItems.slice(0, 4).map((item) => (
              <div key={item.label} className="min-w-0 rounded-[10px] bg-white px-2.5 py-2">
                <dt className="text-[10px] font-bold text-text-secondary">{item.label}</dt>
                <dd className="mt-0.5 truncate text-[12px] font-extrabold text-text-primary">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onShare}
          disabled={cartCount === 0 || sharing}
          aria-busy={sharing}
          aria-describedby={cartShareDescriptionIds}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-[#D1DCE8] text-[14px] font-bold text-text-primary hover:border-brand/60 hover:text-brand disabled:opacity-40"
        >
          <Send size={17} />
          {sharing ? '생성 중' : '공유'}
        </button>
        {!canGroupInquiry ? (
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-describedby={cartGroupInquiryDescriptionIds}
            data-testid="concierge-cart-group-inquiry"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-[#D1DCE8] text-[14px] font-bold text-text-primary opacity-40 disabled:cursor-not-allowed"
          >
            <ClipboardList size={17} />
            견적
          </button>
        ) : (
          <Link
            href={groupInquiryHref}
            onClick={onGroupInquiry}
            data-testid="concierge-cart-group-inquiry"
            aria-describedby={cartGroupInquiryDescriptionIds}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-[#D1DCE8] text-[14px] font-bold text-text-primary hover:border-brand/60 hover:text-brand"
          >
            <ClipboardList size={17} />
            견적
          </Link>
        )}
        <button
          type="button"
          data-testid="concierge-cart-checkout"
          aria-haspopup="dialog"
          aria-expanded={checkoutOpen}
          aria-controls="concierge-checkout-dialog"
          aria-describedby={cartCheckoutDescriptionIds}
          onClick={onCheckout}
          disabled={cartCount === 0}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-brand text-[14px] font-bold text-white hover:bg-brand-dark disabled:opacity-40"
        >
          <Wallet size={17} />
          결제
        </button>
      </div>
    </div>
  );
}
