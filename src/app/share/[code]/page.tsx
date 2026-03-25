'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface CartItem {
  product_id:       string;
  product_name:     string;
  api_name:         string;
  product_type:     'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'DYNAMIC' | 'FIXED';
  cost:             number;
  price:            number;
  quantity:         number;
  description:      string;
  attrs?:           Record<string, unknown>;
}

interface InventoryBlock {
  id:              string;
  date:            string;
  available_seats: number;
  price_override?: number;
  status:          string;
}

interface SharedItinerary {
  id:            string;
  share_code:    string;
  share_type:    'DYNAMIC' | 'FIXED';
  items?:        CartItem[];
  search_query?: string;
  product_id?:   string;
  product_name?: string;
  review_text?:  string;
  creator_name:  string;
  view_count:    number;
  expires_at:    string;
  created_at:    string;
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  HOTEL: '🏨 호텔', ACTIVITY: '🎫 액티비티', CRUISE: '🛳 크루즈',
};

export default function SharePage() {
  const params  = useParams<{ code: string }>();
  const router  = useRouter();
  const code    = params.code;

  const [shared,     setShared]     = useState<SharedItinerary | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [sessionId]                 = useState(() => `share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // DYNAMIC 전용 — 오늘의 가격 재조회
  const [refreshedPrices, setRefreshedPrices] = useState<Map<string, number>>(new Map());
  const [refreshing, setRefreshing]           = useState(false);

  // FIXED 전용 — 재고 달력
  const [blocks,       setBlocks]       = useState<InventoryBlock[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [addingToCart, setAddingToCart] = useState(false);

  useEffect(() => {
    fetch(`/api/share?code=${code}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else {
          setShared(d.shared);
          // FIXED: 재고 조회
          if (d.shared.share_type === 'FIXED' && d.shared.product_id) {
            const today = new Date().toISOString().slice(0, 10);
            fetch(`/api/packages/${d.shared.product_id}/inventory?from=${today}`)
              .then(r => r.json())
              .then(inv => setBlocks(inv.blocks ?? []))
              .catch(() => {});
          }
        }
      })
      .catch(() => setError('공유 정보를 불러오는 데 실패했습니다.'))
      .finally(() => setLoading(false));
  }, [code]);

  // DYNAMIC: 오늘의 가격으로 재조회
  async function handleRefreshPrices() {
    if (!shared?.search_query) return;
    setRefreshing(true);
    try {
      const res  = await fetch('/api/concierge/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: shared.search_query }),
      });
      const data = await res.json();
      const map  = new Map<string, number>();
      for (const r of (data.results ?? [])) {
        map.set(r.product_id, r.price);
      }
      setRefreshedPrices(map);
    } catch {
      // 재조회 실패 시 무시
    } finally {
      setRefreshing(false);
    }
  }

  // DYNAMIC: 이 구성으로 예약하기
  async function handleAddAllToCart() {
    if (!shared?.items?.length) return;
    setAddingToCart(true);
    try {
      await fetch('/api/concierge/cart', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body:    JSON.stringify({ items: shared.items }),
      });
      router.push('/concierge');
    } catch {
      setAddingToCart(false);
    }
  }

  // FIXED: 날짜 선택 후 예약하기
  async function handleFixedBook() {
    if (!shared?.product_id || !selectedDate) return;
    const block = blocks.find(b => b.date === selectedDate);
    if (!block) return;
    setAddingToCart(true);
    const item: CartItem = {
      product_id:       shared.product_id,
      product_name:     shared.product_name ?? '패키지 상품',
      api_name:         'tenant_product',
      product_type:     'ACTIVITY',
      product_category: 'FIXED',
      cost:             block.price_override ?? 0,
      price:            block.price_override ?? 0,
      quantity:         1,
      description:      `${selectedDate} 출발`,
      attrs:            { date: selectedDate, available_seats: block.available_seats },
    };
    try {
      await fetch('/api/concierge/cart', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body:    JSON.stringify({ item }),
      });
      router.push('/concierge');
    } catch {
      setAddingToCart(false);
    }
  }

  // ── 로딩/에러 ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm animate-pulse">링크 불러오는 중...</div>
      </div>
    );
  }

  if (error || !shared) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center bg-white rounded-2xl shadow-sm border p-8 max-w-sm w-full">
          <p className="text-4xl mb-4">🔗</p>
          <h1 className="text-lg font-bold text-gray-900 mb-2">만료되거나 존재하지 않는 링크입니다</h1>
          <p className="text-sm text-gray-500 mb-6">{error}</p>
          <a
            href="/concierge"
            className="inline-block bg-indigo-600 text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition"
          >
            AI 컨시어지로 이동 →
          </a>
        </div>
      </div>
    );
  }

  const isDynamic = shared.share_type === 'DYNAMIC';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* 헤더 */}
        <div className="bg-white rounded-2xl border shadow-sm p-6">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
              isDynamic ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
            }`}>
              {isDynamic ? '실시간 자유여행' : '고정 패키지'}
            </span>
            <span className="text-xs text-gray-400">조회 {shared.view_count}회</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">
            {isDynamic
              ? `${shared.creator_name}님의 여행 구성`
              : (shared.product_name ?? '패키지 상품')}
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            공유일: {shared.created_at.slice(0, 10)} · 만료: {shared.expires_at.slice(0, 10)}
          </p>
        </div>

        {/* DYNAMIC: 스냅샷 아이템 테이블 */}
        {isDynamic && shared.items && (
          <>
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 text-sm">구성 상품 ({shared.items.length}건)</h2>
                <button
                  onClick={handleRefreshPrices}
                  disabled={refreshing}
                  className="text-xs text-blue-600 border border-blue-300 px-3 py-1 rounded-full hover:bg-blue-50 transition disabled:opacity-50"
                >
                  {refreshing ? '조회 중...' : '오늘의 가격으로 재조회'}
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    {['유형', '상품명', '수량', '스냅샷 가격', '오늘 가격'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shared.items.map((item, i) => {
                    const todayPrice = refreshedPrices.get(item.product_id);
                    const diff       = todayPrice != null ? todayPrice - item.price : null;
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {PRODUCT_TYPE_LABELS[item.product_type] ?? item.product_type}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 max-w-[160px] truncate">
                          {item.product_name}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{item.quantity}개</td>
                        <td className="px-4 py-3 text-gray-600">₩{fmt(item.price * item.quantity)}</td>
                        <td className="px-4 py-3">
                          {todayPrice != null ? (
                            <span className={`font-semibold ${diff! > 0 ? 'text-red-500' : diff! < 0 ? 'text-green-600' : 'text-gray-700'}`}>
                              ₩{fmt(todayPrice * item.quantity)}
                              {diff !== 0 && (
                                <span className="text-xs ml-1">({diff! > 0 ? '+' : ''}{fmt(diff! * item.quantity)})</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-indigo-50 font-bold">
                    <td colSpan={3} className="px-4 py-3 text-indigo-800">합계</td>
                    <td className="px-4 py-3 text-indigo-700">
                      ₩{fmt(shared.items.reduce((s, i) => s + i.price * i.quantity, 0))}
                    </td>
                    <td className="px-4 py-3 text-indigo-700">
                      {refreshedPrices.size > 0 && (
                        `₩${fmt([...refreshedPrices.entries()].reduce((s, [pid, p]) => {
                          const item = shared.items!.find(i => i.product_id === pid);
                          return item ? s + p * item.quantity : s;
                        }, 0))}`
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <button
              onClick={handleAddAllToCart}
              disabled={addingToCart}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {addingToCart ? '장바구니에 추가 중...' : '이 구성으로 예약하기 →'}
            </button>
          </>
        )}

        {/* FIXED: 원작자 후기 + 달력 */}
        {!isDynamic && (
          <>
            {/* 원작자 후기 */}
            {shared.review_text && (
              <div className="bg-white rounded-xl border shadow-sm p-5">
                <h2 className="font-semibold text-gray-900 text-sm mb-2">
                  💬 {shared.creator_name}님의 후기
                </h2>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                  {shared.review_text}
                </p>
              </div>
            )}

            {/* 예약 가능 날짜 */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b">
                <h2 className="font-semibold text-gray-900 text-sm">예약 가능 날짜 선택</h2>
                <p className="text-xs text-gray-400 mt-0.5">날짜를 선택하면 해당일 가격이 표시됩니다</p>
              </div>
              <div className="p-4">
                {blocks.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">현재 예약 가능한 날짜가 없습니다.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {blocks.map(b => (
                      <button
                        key={b.date}
                        onClick={() => setSelectedDate(b.date)}
                        className={`px-3 py-2 rounded-lg text-sm border transition ${
                          selectedDate === b.date
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400 hover:text-purple-700'
                        }`}
                      >
                        <div className="font-medium">{b.date}</div>
                        <div className="text-xs opacity-70">잔여 {b.available_seats}석</div>
                      </button>
                    ))}
                  </div>
                )}

                {selectedDate && (() => {
                  const block = blocks.find(b => b.date === selectedDate);
                  return block ? (
                    <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-purple-900">{selectedDate} 출발</p>
                          <p className="text-xs text-purple-600">잔여 좌석 {block.available_seats}석</p>
                        </div>
                        {block.price_override != null && (
                          <p className="text-lg font-bold text-purple-700">₩{fmt(block.price_override)}</p>
                        )}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>

            <button
              onClick={handleFixedBook}
              disabled={!selectedDate || addingToCart}
              className="w-full bg-purple-600 text-white py-3 rounded-xl font-semibold hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addingToCart ? '장바구니에 추가 중...' : selectedDate ? `${selectedDate} 예약하기 →` : '날짜를 선택해 주세요'}
            </button>
          </>
        )}

        {/* 푸터 */}
        <div className="text-center">
          <a href="/concierge" className="text-sm text-indigo-500 hover:underline">
            여소남 AI 컨시어지로 돌아가기
          </a>
        </div>

      </div>
    </div>
  );
}
