'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
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
import { trackEngagement } from '@/lib/tracker';

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
}

const SESSION_KEY = 'concierge_session_id';
const KAKAO_URL = 'https://pf.kakao.com/_xcFxkBG/chat';

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

function inferIntentSummary(prompt: IntentPrompt | null, query: string, cart: CartItem[]) {
  const selectedProducts = cart.map((item) => item.product_id);
  return {
    intent: prompt?.intent ?? (query.includes('골프') ? 'golf_compare' : query.includes('단체') ? 'group_trip' : null),
    budget: prompt?.budget ?? null,
    destination: prompt?.destination ?? null,
    party_type: prompt?.party_type ?? null,
    selected_products: selectedProducts.length > 0 ? selectedProducts : null,
  };
}

function ModalFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center">
      <button
        type="button"
        aria-label={`${title} 닫기`}
        className="absolute inset-0 bg-slate-950/45"
        onClick={onClose}
      />
      <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[24px] bg-white shadow-2xl md:rounded-[20px]">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#EEF2F6] px-5">
          <h2 className="text-[17px] font-extrabold text-text-primary">{title}</h2>
          <button
            type="button"
            aria-label="닫기"
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

export default function ConciergePage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MockSearchResult[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [paying, setPaying] = useState(false);
  const [vouchers, setVouchers] = useState<VoucherItem[] | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareToast, setShareToast] = useState('');
  const [activePrompt, setActivePrompt] = useState<IntentPrompt | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionId = getOrCreateSessionId();

  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const dynamicItems = useMemo(() => cart.filter((item) => resolveCategory(item) === 'DYNAMIC'), [cart]);
  const fixedItems = useMemo(() => cart.filter((item) => resolveCategory(item) === 'FIXED'), [cart]);
  const intentSummary = useMemo(() => inferIntentSummary(activePrompt, query, cart), [activePrompt, cart, query]);

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

  async function performSearch(rawQuery: string, prompt: IntentPrompt | null = null) {
    const normalized = rawQuery.trim();
    if (!normalized) {
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setResults([]);
    setErrorMsg('');
    setActivePrompt(prompt);
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiPromptStarted,
      page_url: '/concierge',
      intent: prompt?.intent ?? null,
      budget: prompt?.budget ?? null,
      destination: prompt?.destination ?? null,
      party_type: prompt?.party_type ?? null,
    });

    try {
      const response = await fetch('/api/concierge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: normalized, ...inferIntentSummary(prompt, normalized, cart) }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results ?? []);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '검색 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

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
    trackEngagement({
      event_type: 'cart_added',
      product_id: item.product_id,
      product_name: item.product_name,
      page_url: '/concierge',
      ...inferIntentSummary(activePrompt, query, updated),
    });
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
    if (!customer.name.trim()) return;
    setPaying(true);
    setErrorMsg('');
    trackEngagement({
      event_type: 'checkout_start',
      page_url: '/concierge',
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
        setErrorMsg(`일부 API 오류로 결제가 취소되었습니다: ${data.errors?.join(', ')}`);
      }
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '결제 오류가 발생했습니다.');
    } finally {
      setPaying(false);
    }
  }

  async function handleShare() {
    if (!cart.length) return;
    setSharing(true);
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
      page_url: '/concierge',
      metadata: { action: 'share_cart' },
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

  function openKakaoConsult(source: string) {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      page_url: '/concierge',
      metadata: { source },
      ...intentSummary,
    });
    window.open(KAKAO_URL, '_blank', 'noopener,noreferrer');
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
            }}
            className="mt-6 h-12 w-full rounded-full bg-brand text-[15px] font-bold text-white hover:bg-brand-dark"
          >
            새 여행 계획하기
          </button>
        </div>
      </div>
    );
  }

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
            className="hidden h-9 items-center gap-1.5 rounded-full border border-[#D1DCE8] bg-white px-3 text-[13px] font-bold text-text-primary hover:border-brand/60 hover:text-brand sm:inline-flex"
          >
            <MessageCircle size={16} />
            카톡 상담
          </button>
        </div>
      </header>

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
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="예: 부산 출발 부모님 효도 여행 추천해줘"
                  className="h-13 w-full rounded-[16px] border border-[#D1DCE8] bg-white py-3 pl-11 pr-4 text-[15px] text-text-primary placeholder:text-[#B0B8C1] focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="h-13 rounded-[16px] bg-brand px-6 text-[15px] font-bold text-white transition hover:bg-brand-dark disabled:opacity-50"
              >
                {loading ? '검색 중' : '검색'}
              </button>
            </form>

            <div className="mt-4">
              <p className="mb-2 text-[13px] font-bold text-text-primary">빠른 시작</p>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {INTENT_PROMPTS.map((prompt) => (
                  <button
                    key={prompt.intent}
                    type="button"
                    onClick={() => {
                      setQuery(prompt.query);
                      void performSearch(prompt.query, prompt);
                    }}
                    className="shrink-0 rounded-full border border-[#D1DCE8] bg-white px-4 py-2 text-[13px] font-bold text-text-body transition hover:border-brand/60 hover:text-brand"
                  >
                    {prompt.label}
                  </button>
                ))}
              </div>
            </div>

            {errorMsg && (
              <div className="mt-4 flex items-start gap-2 rounded-[14px] border border-danger/20 bg-danger-light p-3 text-[13px] text-danger">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}
          </div>

          {loading && (
            <div className="rounded-[20px] border border-[#EEF2F6] bg-white p-6 text-center shadow-card">
              <Sparkles className="mx-auto mb-3 animate-pulse text-brand" size={32} />
              <p className="text-[15px] font-bold text-text-primary">조건에 맞는 상품을 비교하고 있습니다</p>
              <p className="mt-1 text-[13px] text-text-secondary">가격, 조건, 주의사항을 함께 정리할게요.</p>
            </div>
          )}

          {results.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-extrabold text-text-primary">추천 결과 {results.length}건</h2>
                  <p className="mt-1 text-[13px] text-text-secondary">추천 이유와 확인할 점을 같이 보세요.</p>
                </div>
                <button
                  type="button"
                  onClick={() => openKakaoConsult('results_header')}
                  className="hidden rounded-full border border-[#D1DCE8] px-4 py-2 text-[13px] font-bold text-text-primary hover:border-brand/60 hover:text-brand md:inline-flex"
                >
                  상담으로 확인
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {results.map((item) => (
                  <ResultCard
                    key={item.product_id}
                    item={item}
                    onAdd={() => addToCart(item)}
                    onConsult={() => {
                      trackEngagement({
                        event_type: ANALYTICS_EVENTS.aiRecommendationClicked,
                        product_id: item.product_id,
                        product_name: item.product_name,
                        page_url: '/concierge',
                        metadata: { action: 'kakao_from_result' },
                        ...intentSummary,
                      });
                      openKakaoConsult('result_card');
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
              cartCount={cart.length}
              cartTotal={cartTotal}
              sharing={sharing}
              onShare={handleShare}
              onCheckout={() => setCheckoutOpen(true)}
              onKakao={() => openKakaoConsult('desktop_cart')}
            />
          </div>
        </aside>
      </main>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[#E5E7EB] bg-white/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-lg items-center gap-3 px-4">
            <button
              type="button"
              onClick={() => setCartSheetOpen(true)}
              className="min-w-0 flex-1 rounded-[16px] bg-[#F8FAFC] px-4 py-3 text-left"
            >
              <span className="block text-[12px] font-bold text-text-secondary">선택한 구성 {cart.length}개</span>
              <span className="block truncate text-[16px] font-extrabold text-text-primary">{money(cartTotal)}</span>
            </button>
            <button
              type="button"
              onClick={() => openKakaoConsult('mobile_cart_bar')}
              className="flex size-12 items-center justify-center rounded-full bg-[#FEE500] text-[#3C1E1E]"
              aria-label="카카오톡 상담"
            >
              <MessageCircle size={21} />
            </button>
            <button
              type="button"
              onClick={() => setCartSheetOpen(true)}
              className="h-12 rounded-full bg-brand px-5 text-[14px] font-bold text-white"
            >
              보기
            </button>
          </div>
        </div>
      )}

      {cartSheetOpen && (
        <ModalFrame title="선택한 구성" onClose={() => setCartSheetOpen(false)}>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{renderCartItems()}</div>
          <CartActions
            cartCount={cart.length}
            cartTotal={cartTotal}
            sharing={sharing}
            onShare={handleShare}
            onCheckout={() => setCheckoutOpen(true)}
            onKakao={() => openKakaoConsult('mobile_cart_sheet')}
          />
        </ModalFrame>
      )}

      {checkoutOpen && (
        <ModalFrame title="고객 정보 입력" onClose={() => { setCheckoutOpen(false); setErrorMsg(''); }}>
          <form onSubmit={handleCheckout} className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-4">
              <div>
                <label htmlFor="concierge-customer-name" className="mb-1 block text-[13px] font-bold text-text-primary">
                  이름 *
                </label>
                <input
                  id="concierge-customer-name"
                  type="text"
                  required
                  value={customer.name}
                  onChange={(event) => setCustomer((current) => ({ ...current, name: event.target.value }))}
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

              {errorMsg && (
                <div className="rounded-[14px] border border-danger/20 bg-danger-light p-3 text-[13px] text-danger">
                  {errorMsg}
                </div>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setCheckoutOpen(false); setErrorMsg(''); }}
                className="h-11 rounded-full border border-[#D1DCE8] text-[14px] font-bold text-text-body hover:bg-[#F8FAFC]"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={paying || !customer.name.trim()}
                className="h-11 rounded-full bg-brand text-[14px] font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {paying ? '처리 중' : '결제 완료'}
              </button>
            </div>
          </form>
        </ModalFrame>
      )}

      {shareToast && (
        <div className="fixed bottom-[calc(104px+env(safe-area-inset-bottom))] left-1/2 z-[90] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2.5 text-[13px] font-bold text-white shadow-lg">
          {shareToast}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  item,
  onAdd,
  onConsult,
}: {
  item: MockSearchResult;
  onAdd: () => void;
  onConsult: () => void;
}) {
  const insight = getResultInsight(item);
  const tone = PRODUCT_TYPE_TONES[item.product_type] ?? 'bg-brand-light text-brand border-blue-100';
  const categoryLabel = resolveCategory(item) === 'DYNAMIC' ? '실시간' : '고정패키지';

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
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={onAdd}
            aria-label={`${item.product_name} 담기`}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-brand text-[14px] font-bold text-white hover:bg-brand-dark"
          >
            <Plus size={17} />
            담기
          </button>
          <button
            type="button"
            onClick={onConsult}
            aria-label={`${item.product_name} 카카오톡 상담`}
            className="flex size-11 items-center justify-center rounded-full bg-[#FEE500] text-[#3C1E1E]"
          >
            <MessageCircle size={19} />
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
  cartCount,
  cartTotal,
  sharing,
  onShare,
  onCheckout,
  onKakao,
}: {
  cartCount: number;
  cartTotal: number;
  sharing: boolean;
  onShare: () => void;
  onCheckout: () => void;
  onKakao: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-[#EEF2F6] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold text-text-secondary">총 {cartCount}개 상품</p>
          <p className="text-[20px] font-extrabold text-text-primary">{money(cartTotal)}</p>
        </div>
        <button
          type="button"
          onClick={onKakao}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#FEE500] px-3 text-[13px] font-bold text-[#3C1E1E]"
        >
          <MessageCircle size={16} />
          상담
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onShare}
          disabled={cartCount === 0 || sharing}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-[#D1DCE8] text-[14px] font-bold text-text-primary hover:border-brand/60 hover:text-brand disabled:opacity-40"
        >
          <Send size={17} />
          {sharing ? '생성 중' : '공유'}
        </button>
        <button
          type="button"
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
