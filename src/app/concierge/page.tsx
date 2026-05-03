'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

interface MockSearchResult {
  product_id:       string;
  product_name:     string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  cost:             number;
  price:            number;
  description:      string;
  attrs?:           Record<string, unknown>;
}

interface CartItem extends MockSearchResult {
  quantity: number;
}

function resolveCategory(item: { product_category?: string; api_name?: string }): 'DYNAMIC' | 'FIXED' {
  if (item.product_category === 'FIXED')   return 'FIXED';
  if (item.product_category === 'DYNAMIC') return 'DYNAMIC';
  return item.api_name === 'tenant_product' ? 'FIXED' : 'DYNAMIC';
}

interface VoucherItem {
  code:         string;
  product_name: string;
  product_type: string;
}

const SESSION_KEY = 'concierge_session_id';

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  HOTEL:    '🏨 호텔',
  ACTIVITY: '🎭 액티비티',
  CRUISE:   '🚢 크루즈',
};

const API_LABELS: Record<string, string> = {
  agoda_mock:     'Agoda',
  klook_mock:     'Klook',
  cruise_mock:    'Cruise',
  tenant_product: '랜드사',
};

export default function ConciergePage() {
  const [query, setQuery]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [results, setResults]     = useState<MockSearchResult[]>([]);
  const [cart, setCart]           = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customer, setCustomer]   = useState({ name: '', phone: '', email: '' });
  const [paying, setPaying]       = useState(false);
  const [vouchers, setVouchers]   = useState<VoucherItem[] | null>(null);
  const [errorMsg, setErrorMsg]   = useState('');
  const [sharing,  setSharing]    = useState(false);
  const [shareToast, setShareToast] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const sessionId = getOrCreateSessionId();

  // 페이지 로드 시 장바구니 복원
  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/concierge/cart?session_id=${sessionId}`)
      .then(r => r.json())
      .then(d => setCart(d.items ?? []))
      .catch(() => {});
  }, [sessionId]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setResults([]);
    setErrorMsg('');
    try {
      const res = await fetch('/api/concierge/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results ?? []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '검색 오류');
    } finally {
      setLoading(false);
    }
  }

  async function addToCart(item: MockSearchResult) {
    const newItem: CartItem = { ...item, quantity: 1 };
    const idx = cart.findIndex(c => c.product_id === item.product_id);
    let updated: CartItem[];
    if (idx >= 0) {
      updated = cart.map((c, i) => i === idx ? { ...c, quantity: c.quantity + 1 } : c);
    } else {
      updated = [...cart, newItem];
    }
    setCart(updated);
    await fetch('/api/concierge/cart', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ session_id: sessionId, item: newItem }),
    });
  }

  async function removeFromCart(productId: string) {
    const updated = cart.filter(c => c.product_id !== productId);
    setCart(updated);
    await fetch('/api/concierge/cart', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ session_id: sessionId, product_id: productId }),
    });
  }

  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!customer.name.trim()) return;
    setPaying(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/concierge/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ session_id: sessionId, customer }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.status === 'COMPLETED') {
        setVouchers(data.vouchers ?? []);
        setCart([]);
        setCheckoutOpen(false);
      } else if (data.status === 'PARTIAL_FAIL') {
        setErrorMsg(`일부 API 오류로 결제가 취소되었습니다: ${data.errors?.join(', ')}`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '결제 오류');
    } finally {
      setPaying(false);
    }
  }

  // 공유 링크 생성
  async function handleShare() {
    if (!cart.length) return;
    setSharing(true);
    try {
      const hasDynamic = cart.some(i => resolveCategory(i) === 'DYNAMIC');
      const hasFixed   = cart.some(i => resolveCategory(i) === 'FIXED');
      let body: object;
      if (hasFixed && !hasDynamic) {
        const firstFixed = cart.find(i => resolveCategory(i) === 'FIXED')!;
        body = { share_type: 'FIXED', product_id: firstFixed.product_id, product_name: firstFixed.product_name };
      } else {
        body = { share_type: 'DYNAMIC', items: cart, search_query: query };
      }
      const res  = await fetch('/api/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.share_url) {
        await navigator.clipboard.writeText(data.share_url).catch(() => {});
        setShareToast('링크가 복사되었습니다!');
        setTimeout(() => setShareToast(''), 3000);
      }
    } catch {
      setShareToast('공유 링크 생성에 실패했습니다.');
      setTimeout(() => setShareToast(''), 3000);
    } finally {
      setSharing(false);
    }
  }

  // 바우처/탑승권 화면
  if (vouchers) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900">결제 완료!</h2>
            <p className="text-gray-500 text-sm mt-1">아래 바우처를 저장하세요.</p>
          </div>
          <div className="space-y-3">
            {vouchers.map((v, i) => (
              <div
                key={i}
                className={`rounded-xl p-4 border-2 ${
                  v.product_type === 'CRUISE'
                    ? 'border-blue-300 bg-blue-50'
                    : v.product_type === 'HOTEL'
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-green-300 bg-green-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-gray-500">
                      {PRODUCT_TYPE_LABELS[v.product_type] ?? v.product_type}
                    </span>
                    <p className="font-semibold text-gray-900 mt-0.5">{v.product_name}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-gray-500">바우처 코드</span>
                    <p className="font-mono font-bold text-lg tracking-widest text-[#1B64DA]">{v.code}</p>
                  </div>
                </div>
                {v.product_type === 'CRUISE' && (
                  <div className="mt-3 pt-3 border-t border-blue-200 text-xs text-blue-700">
                    🛳 탑승권이 이메일로 발송됩니다.
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => { setVouchers(null); setResults([]); setQuery(''); }}
            className="mt-6 w-full bg-[#3182F6] text-white py-3 rounded-xl font-semibold hover:bg-[#1B64DA]"
          >
            새 여행 계획하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between shadow-sm">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl">✈️</span>
          <span className="font-bold text-lg text-gray-900">여소남 AI 컨시어지</span>
        </Link>
        <span className="text-sm text-gray-500">자유여행 · 크루즈 · 액티비티 통합 예약</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 메인 검색 영역 */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* 검색창 */}
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">어디로 떠나실까요? 🧳</h1>
              <p className="text-gray-500">자연어로 말씀해 주세요. AI가 맞춤 상품을 찾아드립니다.</p>
            </div>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="예: 방콕 3박 4일 호텔이랑 투어 추천해줘"
                className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3182F6]/40"
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-[#3182F6] text-white px-6 py-3 rounded-xl font-semibold hover:bg-[#1B64DA] disabled:opacity-50 transition"
              >
                {loading ? '검색 중...' : '검색'}
              </button>
            </form>

            {/* 추천 검색어 */}
            {!results.length && !loading && (
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {[
                  '방콕 3박 호텔 추천',
                  '지중해 크루즈 여행',
                  '발리 리조트 + 래프팅',
                  '도쿄 호텔 액티비티',
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => { setQuery(s); setTimeout(() => inputRef.current?.form?.requestSubmit(), 50); }}
                    className="text-sm bg-white border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:bg-[#EBF3FE] hover:border-[#DBEAFE] transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {errorMsg && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMsg}
              </div>
            )}
          </div>

          {/* 검색 결과 */}
          {results.length > 0 && (
            <div className="max-w-4xl mx-auto mt-8">
              <h2 className="text-lg font-semibold text-gray-700 mb-4">
                검색 결과 {results.length}건
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {results.map(item => (
                  <div key={item.product_id} className="bg-white rounded-xl border shadow-sm p-4 flex flex-col">
                    <div className="flex items-center gap-1 flex-wrap mb-2">
                      <span className="text-xs font-medium text-[#3182F6] bg-[#EBF3FE] px-2 py-0.5 rounded-full">
                        {PRODUCT_TYPE_LABELS[item.product_type] ?? item.product_type}
                      </span>
                      {resolveCategory(item) === 'DYNAMIC' ? (
                        <span className="text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">실시간</span>
                      ) : (
                        <span className="text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">고정패키지</span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto">{API_LABELS[item.api_name] ?? item.api_name}</span>
                    </div>
                    <h3 className="font-semibold text-gray-900 text-base mb-1">{item.product_name}</h3>
                    <p className="text-sm text-gray-500 flex-1 mb-3">{item.description}</p>

                    {/* 크루즈 상세 attrs */}
                    {item.product_type === 'CRUISE' && item.attrs && (
                      <div className="text-xs text-blue-600 bg-blue-50 rounded-lg p-2 mb-3 space-y-0.5">
                        {item.attrs.ship_name     ? <div>🛳 {String(item.attrs.ship_name)}</div> : null}
                        {item.attrs.cabin_class   ? <div>🛏 {String(item.attrs.cabin_class)}</div> : null}
                        {item.attrs.dining        ? <div>🍽 {String(item.attrs.dining)}</div> : null}
                        {item.attrs.departure_port ? <div>⚓ {String(item.attrs.departure_port)} 출항</div> : null}
                      </div>
                    )}

                    <div className="flex items-end justify-between mt-auto">
                      <div>
                        <span className="text-xs text-gray-400 line-through">
                          ₩{item.cost.toLocaleString()}
                        </span>
                        <div className="text-base font-bold text-[#1B64DA]">
                          ₩{item.price.toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={() => addToCart(item)}
                        className="bg-[#3182F6] text-white text-xs px-3 py-1.5 rounded-lg hover:bg-[#1B64DA] transition"
                      >
                        + 담기
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="max-w-2xl mx-auto mt-12 text-center text-gray-400">
              <div className="text-4xl mb-3 animate-bounce">🔍</div>
              <p>AI가 최적의 상품을 검색하고 있습니다...</p>
            </div>
          )}
        </main>

        {/* 장바구니 사이드바 */}
        <aside className="w-80 bg-white border-l flex flex-col">
          <div className="p-4 border-b">
            <h2 className="font-bold text-gray-900">🛒 장바구니 {cart.length > 0 && `(${cart.length})`}</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
              <p className="text-sm text-gray-400 text-center mt-8">
                상품을 담아보세요!
              </p>
            ) : (() => {
              const dynamicItems = cart.filter(i => resolveCategory(i) === 'DYNAMIC');
              const fixedItems   = cart.filter(i => resolveCategory(i) === 'FIXED');
              const renderCard   = (item: CartItem) => (
                <div key={item.product_id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <span className="text-xs text-[#3182F6]">
                        {PRODUCT_TYPE_LABELS[item.product_type]}
                      </span>
                      <p className="text-sm font-medium text-gray-800 leading-snug">{item.product_name}</p>
                      <p className="text-sm font-bold text-[#1B64DA] mt-1">
                        ₩{(item.price * item.quantity).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.product_id)}
                      className="text-gray-300 hover:text-red-400 text-lg leading-none mt-0.5"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
              return (
                <>
                  {dynamicItems.length > 0 && (
                    <div>
                      <p className="text-xs text-blue-600 font-semibold mb-1.5 px-0.5">실시간 상품</p>
                      <div className="space-y-2">{dynamicItems.map(renderCard)}</div>
                    </div>
                  )}
                  {dynamicItems.length > 0 && fixedItems.length > 0 && (
                    <hr className="border-dashed border-gray-300" />
                  )}
                  {fixedItems.length > 0 && (
                    <div>
                      <p className="text-xs text-purple-600 font-semibold mb-1.5 px-0.5">고정 패키지</p>
                      <div className="space-y-2">{fixedItems.map(renderCard)}</div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {cart.length > 0 && (
            <div className="p-4 border-t space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">합계</span>
                <span className="font-bold text-gray-900">₩{cartTotal.toLocaleString()}</span>
              </div>
              <button
                onClick={() => setCheckoutOpen(true)}
                className="w-full bg-[#3182F6] text-white py-3 rounded-xl font-semibold hover:bg-[#1B64DA] transition"
              >
                결제하기
              </button>
              <button
                onClick={handleShare}
                disabled={sharing}
                className="w-full py-2 text-sm border border-[#DBEAFE] text-[#3182F6] rounded-xl hover:bg-[#EBF3FE] transition disabled:opacity-50"
              >
                {sharing ? '링크 생성 중...' : '이 구성 공유하기 🔗'}
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* 결제 모달 */}
      {checkoutOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">고객 정보 입력</h3>
            <form onSubmit={handleCheckout} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input
                  type="text"
                  required
                  value={customer.name}
                  onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3182F6]/40"
                  placeholder="홍길동"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                <input
                  type="tel"
                  value={customer.phone}
                  onChange={e => setCustomer(c => ({ ...c, phone: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3182F6]/40"
                  placeholder="010-0000-0000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={customer.email}
                  onChange={e => setCustomer(c => ({ ...c, email: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3182F6]/40"
                  placeholder="example@email.com"
                />
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">결제 금액</span>
                  <span className="font-bold">₩{cartTotal.toLocaleString()}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1">{cart.length}개 상품</div>
              </div>

              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setCheckoutOpen(false); setErrorMsg(''); }}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={paying}
                  className="flex-1 bg-[#3182F6] text-white py-2 rounded-xl font-semibold text-sm hover:bg-[#1B64DA] disabled:opacity-50"
                >
                  {paying ? '처리 중...' : '결제 완료'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 공유 토스트 */}
      {shareToast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50 animate-fade-in">
          {shareToast}
        </div>
      )}
    </div>
  );
}
