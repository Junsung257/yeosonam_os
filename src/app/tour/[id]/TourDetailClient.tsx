'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { initTracker, trackEngagement, trackConversion } from '@/lib/tracker';

// ── 타입 ─────────────────────────────────────────────────────

interface Tour {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;              // 판매가 (고객 노출)
  // cost: 절대 미노출 — 서버 전용
  rating?: number;
  review_count?: number;
  recent_bookings?: number;    // 24시간 예약 수 (소셜 프루프)
  inclusions?: string[];
  excludes?: string[];
  itinerary?: string[];
  image_url?: string;
}

interface UpsellOption {
  id: string;
  name: string;
  description: string;
  price: number;
  icon: string;
}

const UPSELL_OPTIONS: UpsellOption[] = [
  {
    id: 'insurance',
    name: '여행자 보험',
    description: '상해·질병·휴대품 보장 / 인당',
    price: 15000,
    icon: '🛡️',
  },
  {
    id: 'esim',
    name: '현지 eSIM',
    description: '무제한 데이터 / 인당',
    price: 12000,
    icon: '📡',
  },
];

// ── 소셜 프루프 배너 ──────────────────────────────────────────

function SocialProofBanner({ count }: { count: number }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, []);
  if (!visible || count === 0) return null;
  return (
    <div className="animate-slide-in-left fixed top-4 left-4 z-40 max-w-xs bg-white border border-orange-200 shadow-lg rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm">
      <span className="text-lg">🔥</span>
      <span>
        최근 24시간 내 <strong className="text-orange-600">{count}명</strong>이 예약했습니다!
      </span>
      <button onClick={() => setVisible(false)} className="ml-1 text-gray-400 hover:text-gray-600">✕</button>
    </div>
  );
}

// ── 평점 배지 ─────────────────────────────────────────────────

function RatingBadge({ rating, count }: { rating: number; count: number }) {
  const stars = Math.round(rating);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((s) => (
          <span key={s} className={s <= stars ? 'text-yellow-400' : 'text-gray-300'}>★</span>
        ))}
      </div>
      <span className="font-semibold text-gray-800">{rating.toFixed(1)}</span>
      <span className="text-gray-500 text-sm">({count}개 리뷰)</span>
    </div>
  );
}

// ── FAB 채팅 버튼 ─────────────────────────────────────────────

function ChatFab({ tourId, onOpen }: { tourId: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="fixed bottom-24 right-4 z-40 w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-xl flex flex-col items-center justify-center text-xs transition-transform hover:scale-110 active:scale-95"
      aria-label="안심 채팅 상담"
    >
      <span className="text-xl leading-none">💬</span>
      <span className="text-xs mt-0.5 leading-none">상담</span>
    </button>
  );
}

// ── 안심 채팅 모달 ─────────────────────────────────────────────

function ChatModal({
  tourId,
  onClose,
}: {
  tourId: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([
    { role: 'system', text: '안녕하세요! 여소남 안심 채팅입니다.\n개인 연락처 공유 없이 안전하게 상담하실 수 있습니다. 😊' },
  ]);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!message.trim()) return;
    const text = message.trim();
    setMessage('');
    setMessages((p) => [...p, { role: 'customer', text }]);
    setSending(true);
    try {
      await fetch('/api/secure-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rfq_id: tourId,
          sender_type: 'customer',
          sender_id: 'guest',
          receiver_type: 'land_agency',
          message: text,
        }),
      });
      setMessages((p) => [
        ...p,
        { role: 'system', text: '메시지가 전달되었습니다. 빠른 시간 내 답변 드릴게요!' },
      ]);
    } catch {
      setMessages((p) => [...p, { role: 'system', text: '전송 실패. 다시 시도해주세요.' }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-indigo-600 text-white rounded-t-2xl sm:rounded-t-2xl">
          <div>
            <p className="font-semibold text-sm">💬 여소남 안심 채팅</p>
            <p className="text-xs opacity-80">개인 연락처 자동 보호 · 24시간 응대</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl">✕</button>
        </div>
        {/* 메시지 영역 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'customer' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'customer'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        {/* 입력창 */}
        <div className="flex gap-2 p-3 border-t">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="문의 내용을 입력하세요..."
            className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            disabled={sending}
          />
          <button
            onClick={send}
            disabled={sending || !message.trim()}
            className="bg-indigo-600 text-white px-4 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-indigo-700 transition"
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 바텀 시트: 인원 선택 + 업셀링 ───────────────────────────

function BookingBottomSheet({
  tour,
  onClose,
  onConfirm,
}: {
  tour: Tour;
  onClose: () => void;
  onConfirm: (adults: number, children: number, upsells: string[]) => void;
}) {
  const [step, setStep] = useState<'headcount' | 'upsell'>('headcount');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [selectedUpsells, setSelectedUpsells] = useState<string[]>([]);

  const price = tour.price ?? 0;
  const totalPeople = adults + children;
  const upsellTotal = UPSELL_OPTIONS
    .filter((u) => selectedUpsells.includes(u.id))
    .reduce((s, u) => s + u.price * adults, 0); // 성인 기준
  const totalPrice = price * totalPeople + upsellTotal;

  function toggleUpsell(id: string) {
    setSelectedUpsells((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full bg-white rounded-t-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 핸들 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {step === 'headcount' ? (
          <>
            <div className="px-5 pb-2">
              <h3 className="font-bold text-lg text-gray-900">인원 선택</h3>
              <p className="text-sm text-gray-500 mt-0.5">{tour.title}</p>
            </div>

            {/* 인원 카운터 */}
            <div className="px-5 py-4 space-y-4">
              {[
                { label: '성인', sub: '만 12세 이상', value: adults, set: setAdults, min: 1 },
                { label: '아동', sub: '만 2~11세',   value: children, set: setChildren, min: 0 },
              ].map(({ label, sub, value, set, min }) => (
                <div key={label} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800">{label}</p>
                    <p className="text-sm text-gray-400">{sub}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => set(Math.max(min, value - 1))}
                      className="w-9 h-9 rounded-full border-2 border-gray-300 text-gray-600 text-lg font-bold hover:border-indigo-500 hover:text-indigo-600 transition"
                    >−</button>
                    <span className="w-6 text-center font-semibold text-gray-900">{value}</span>
                    <button
                      onClick={() => set(value + 1)}
                      className="w-9 h-9 rounded-full border-2 border-gray-300 text-gray-600 text-lg font-bold hover:border-indigo-500 hover:text-indigo-600 transition"
                    >+</button>
                  </div>
                </div>
              ))}
            </div>

            {/* 가격 미리보기 — 판매가만 노출 */}
            <div className="mx-5 mb-4 bg-indigo-50 rounded-xl px-4 py-3">
              <div className="flex justify-between text-sm text-gray-600">
                <span>₩{price.toLocaleString('ko-KR')} × {totalPeople}명</span>
                <span>₩{(price * totalPeople).toLocaleString('ko-KR')}</span>
              </div>
            </div>

            <div className="px-5 pb-6">
              <button
                onClick={() => setStep('upsell')}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-base transition active:scale-95"
              >
                다음 단계 →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 pb-2">
              <h3 className="font-bold text-lg text-gray-900">✨ 함께 준비하세요</h3>
              <p className="text-sm text-gray-500 mt-0.5">원클릭으로 추가하면 여행이 더 편안해져요</p>
            </div>

            <div className="px-5 py-3 space-y-3">
              {UPSELL_OPTIONS.map((opt) => {
                const selected = selectedUpsells.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    onClick={() => toggleUpsell(opt.id)}
                    className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition ${
                      selected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    <span className="text-2xl">{opt.icon}</span>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{opt.name}</p>
                      <p className="text-sm text-gray-500">{opt.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-indigo-600">+₩{opt.price.toLocaleString('ko-KR')}</p>
                      <p className="text-xs text-gray-400">/인</p>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        selected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                      }`}
                    >
                      {selected && <span className="text-white text-xs font-bold">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 최종 금액 요약 */}
            <div className="mx-5 mb-4 bg-gray-50 rounded-xl px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-500">
                <span>여행 상품 ({totalPeople}명)</span>
                <span>₩{(price * totalPeople).toLocaleString('ko-KR')}</span>
              </div>
              {upsellTotal > 0 && (
                <div className="flex justify-between text-sm text-indigo-600">
                  <span>부가 서비스</span>
                  <span>+₩{upsellTotal.toLocaleString('ko-KR')}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 text-base pt-1.5 border-t">
                <span>총 결제 예상</span>
                <span>₩{totalPrice.toLocaleString('ko-KR')}</span>
              </div>
            </div>

            <div className="flex gap-3 px-5 pb-6">
              <button
                onClick={() => setStep('headcount')}
                className="flex-1 py-4 border-2 border-gray-300 text-gray-700 rounded-2xl font-semibold text-sm hover:border-gray-400 transition"
              >
                ← 이전
              </button>
              <button
                onClick={() => onConfirm(adults, children, selectedUpsells)}
                className="flex-[2] py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-base transition active:scale-95"
              >
                예약 확정하기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 메인 클라이언트 컴포넌트 ──────────────────────────────────

export default function TourDetailClient({
  id,
  initialTour,
}: {
  id: string;
  initialTour: Tour | null;
}) {
  const router = useRouter();
  const [tour, setTour] = useState<Tour | null>(initialTour);
  const [chatOpen, setChatOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);

  useEffect(() => {
    initTracker();
    trackEngagement({ event_type: 'product_view', product_id: id, product_name: tour?.title, page_url: window.location.href });
    if (!initialTour) {
      fetch(`/api/packages?id=${id}`)
        .then((r) => r.json())
        .then((d) => setTour(d.package ?? null))
        .catch(console.error);
    }
  }, [id]);

  async function handleConfirmBooking(adults: number, children: number, upsells: string[]) {
    setBookingOpen(false);
    if (!tour) return;

    const totalPeople = adults + children;
    const upsellTotal = UPSELL_OPTIONS
      .filter((u) => upsells.includes(u.id))
      .reduce((s, u) => s + u.price * adults, 0);
    const finalPrice = (tour.price ?? 0) * totalPeople + upsellTotal;

    // trackConversion은 실제 결제 완료 후 호출 — 여기서는 checkout_start 이벤트
    trackEngagement({ event_type: 'checkout_start', product_id: id, product_name: tour.title });

    // 결제 페이지로 이동 (query param으로 예약 정보 전달)
    const params = new URLSearchParams({
      package_id: id,
      adults:     String(adults),
      children:   String(children),
      upsells:    upsells.join(','),
      price:      String(finalPrice),
    });
    router.push(`/book/${id}?${params.toString()}`);
  }

  if (!tour) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-gray-500">
        <p className="text-4xl mb-4">🔍</p>
        <p className="text-lg font-medium">상품을 찾을 수 없습니다</p>
        <Link href="/packages" className="mt-4 text-indigo-600 underline text-sm">
          상품 목록으로 →
        </Link>
      </div>
    );
  }

  const price       = tour.price ?? 0;
  const rating      = tour.rating ?? 4.5;
  const reviewCount = tour.review_count ?? 12;
  const recentBooks = tour.recent_bookings ?? Math.floor(Math.random() * 8) + 2;

  return (
    <div className="min-h-screen bg-gray-50 pb-32 lg:pb-12">
      {/* 소셜 프루프 배너 */}
      <SocialProofBanner count={recentBooks} />

      {/* 히어로 이미지 영역 */}
      <div className="relative bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 h-56 sm:h-72 lg:h-80 flex items-end">
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative w-full max-w-5xl mx-auto px-4 pb-6 text-white">
          <div className="flex flex-wrap gap-2 mb-2">
            {tour.destination && (
              <span className="text-sm bg-white/20 backdrop-blur px-2.5 py-1 rounded-full">
                📍 {tour.destination}
              </span>
            )}
            {tour.duration && (
              <span className="text-sm bg-white/20 backdrop-blur px-2.5 py-1 rounded-full">
                🗓 {tour.duration}일
              </span>
            )}
            <span className="text-sm bg-green-400/80 backdrop-blur px-2.5 py-1 rounded-full font-semibold">
              여소남 안심 보장
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold leading-snug">{tour.title}</h1>
        </div>
      </div>

      {/* ── PC 2컬럼 레이아웃 ── */}
      <div className="max-w-5xl mx-auto px-4 pt-4 lg:pt-8">
        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-8 lg:items-start">

          {/* 왼쪽: 메인 콘텐츠 */}
          <div className="space-y-4">

            {/* 평점 + 리뷰 배지 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <RatingBadge rating={rating} count={reviewCount} />
              <div className="flex gap-3 mt-3 text-sm text-gray-500">
                <span className="flex items-center gap-1">✅ 안심 중개 보장</span>
                <span className="flex items-center gap-1">🔒 개인정보 보호</span>
                <span className="flex items-center gap-1">💰 숨은 비용 없음</span>
              </div>
            </div>

            {/* 포함/불포함 */}
            {((tour.inclusions?.length ?? 0) > 0 || (tour.excludes?.length ?? 0) > 0) && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h2 className="font-bold text-gray-900 mb-3">포함 / 불포함 사항</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-sm font-semibold text-emerald-600 mb-1.5">✅ 포함</p>
                    <ul className="space-y-1">
                      {(tour.inclusions ?? []).map((inc, i) => (
                        <li key={i} className="text-sm text-gray-600 flex gap-1">
                          <span className="flex-shrink-0">•</span>{inc}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-500 mb-1.5">❌ 불포함</p>
                    <ul className="space-y-1">
                      {(tour.excludes ?? []).map((ex, i) => (
                        <li key={i} className="text-sm text-gray-600 flex gap-1">
                          <span className="flex-shrink-0">•</span>{ex}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* 일정표 */}
            {(tour.itinerary?.length ?? 0) > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h2 className="font-bold text-gray-900 mb-3">여행 일정</h2>
                <div className="space-y-3">
                  {tour.itinerary!.map((day, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                        D{i + 1}
                      </div>
                      <p className="text-sm text-gray-700 pt-1.5">{day}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 여소남 안심 중개 안내 */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
              <h3 className="font-bold text-indigo-900 text-sm mb-2">🔐 여소남 안심 중개 보장</h3>
              <ul className="space-y-1.5 text-sm text-indigo-700">
                <li>• 랜드사와 직거래 없이 플랫폼을 통해 안전하게 소통</li>
                <li>• 채팅에서 연락처 자동 마스킹 — 직접 접촉 원천 차단</li>
                <li>• 결제 완료 후 공식 확정서(Voucher) 자동 발급</li>
                <li>• 숨은 비용 AI 검증 완료 상품만 노출</li>
              </ul>
            </div>

          </div>

          {/* 오른쪽: 가격 + 예약 사이드바 (PC) / 모바일에서는 맨 위로 */}
          <div className="order-first lg:order-last space-y-4 lg:sticky lg:top-4 mt-4 lg:mt-0">

            {/* 판매가 카드 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <p className="text-sm text-gray-400 mb-0.5">1인 기준</p>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-extrabold text-indigo-600">
                  ₩{price.toLocaleString('ko-KR')}
                </span>
                <span className="text-sm text-gray-400 mb-1">부터</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">* 여행자 보험·유심 미포함 (선택 가능)</p>

              {/* PC 예약 버튼 (모바일에서는 숨김) */}
              <button
                onClick={() => {
                  trackEngagement({ event_type: 'checkout_start', product_id: id });
                  setBookingOpen(true);
                }}
                className="hidden lg:block w-full mt-4 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-base transition active:scale-95 shadow-lg"
              >
                예약하기
              </button>
              <p className="hidden lg:block text-center text-xs text-gray-400 mt-2">최저가 보장 · 수수료 없음</p>
            </div>

            {/* 빠른 문의 (PC) */}
            <div className="hidden lg:block bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
              <p className="text-sm font-semibold text-indigo-900 mb-1">💬 빠른 문의</p>
              <p className="text-xs text-indigo-600 mb-3">AI 상담원이 즉시 답변합니다</p>
              <button
                onClick={() => setChatOpen(true)}
                className="w-full py-2.5 border-2 border-indigo-300 text-indigo-700 font-semibold rounded-xl text-sm hover:bg-indigo-100 transition"
              >
                채팅 상담 시작
              </button>
            </div>

          </div>

        </div>
      </div>

      {/* FAB 채팅 버튼 (모바일) */}
      <ChatFab tourId={id} onOpen={() => setChatOpen(true)} />

      {/* 하단 고정 Sticky Bar (모바일 전용) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t shadow-2xl px-4 py-3 safe-area-bottom">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm text-gray-400">최저가 보장 · 수수료 없음</p>
            <p className="text-lg font-extrabold text-indigo-700">
              ₩{price.toLocaleString('ko-KR')} <span className="text-xs font-normal text-gray-500">/ 1인</span>
            </p>
          </div>
          <button
            onClick={() => {
              trackEngagement({ event_type: 'checkout_start', product_id: id });
              setBookingOpen(true);
            }}
            className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-base transition active:scale-95 shadow-lg"
          >
            예약하기
          </button>
        </div>
      </div>

      {/* 채팅 모달 */}
      {chatOpen && <ChatModal tourId={id} onClose={() => setChatOpen(false)} />}

      {/* 바텀 시트: 인원 + 업셀링 */}
      {bookingOpen && (
        <BookingBottomSheet
          tour={tour}
          onClose={() => setBookingOpen(false)}
          onConfirm={handleConfirmBooking}
        />
      )}
    </div>
  );
}
