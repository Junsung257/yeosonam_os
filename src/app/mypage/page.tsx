'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ── 타입 ─────────────────────────────────────────────────────

interface MileageInfo {
  balance: number;
  total_earned: number;
  total_used: number;
  grade: 'BRONZE' | 'SILVER' | 'GOLD' | 'VIP';
  next_grade: string;
  next_grade_condition: string;
}

interface Booking {
  id: string;
  booking_code?: string;
  product_title: string;
  destination?: string;
  departure_date?: string;
  status: string;
  total_selling_price: number; // 판매가만 노출 (원가 미노출)
  voucher_id?: string;
  voucher_status?: string;
  created_at: string;
}

// ── 등급 설정 ─────────────────────────────────────────────────

const GRADE_CONFIG = {
  BRONZE: { label: 'BRONZE', color: 'from-amber-700 to-amber-500', icon: '🥉', min: 0,     nextMin: 300000, next: 'SILVER',  condition: '누적 판매가 30만원 달성' },
  SILVER: { label: 'SILVER', color: 'from-gray-400 to-gray-300',   icon: '🥈', min: 300000, nextMin: 1000000,next: 'GOLD',    condition: '누적 판매가 100만원 달성' },
  GOLD:   { label: 'GOLD',   color: 'from-yellow-500 to-yellow-300',icon: '🥇', min: 1000000,nextMin: 3000000,next: 'VIP',     condition: '누적 판매가 300만원 달성' },
  VIP:    { label: 'VIP',    color: 'from-purple-600 to-indigo-500',icon: '💎', min: 3000000,nextMin: Infinity,next: 'VIP',    condition: '최고 등급 달성!' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: '입금대기',  color: 'bg-yellow-100 text-yellow-700' },
  confirmed: { label: '예약확정',  color: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: '여행완료',  color: 'bg-green-100 text-green-700' },
  completed: { label: '여행완료',  color: 'bg-green-100 text-green-700' },
  cancelled: { label: '취소됨',    color: 'bg-red-100 text-red-600' },
  REFUNDED:  { label: '환불완료',  color: 'bg-gray-100 text-gray-500' },
};

const fmt = (n: number) => n.toLocaleString('ko-KR');

// ── Mock 데이터 ───────────────────────────────────────────────

const MOCK_MILEAGE: MileageInfo = {
  balance: 27500,
  total_earned: 35000,
  total_used: 7500,
  grade: 'SILVER',
  next_grade: 'GOLD',
  next_grade_condition: '누적 판매가 100만원 달성 (현재 720,000원)',
};

const MOCK_BOOKINGS: Booking[] = [
  {
    id: 'bk-1',
    booking_code: 'YS-2024-0042',
    product_title: '발리 4박 5일 허니문 패키지',
    destination: '발리',
    departure_date: '2024-08-15',
    status: 'COMPLETED',
    total_selling_price: 2400000,
    voucher_id: 'v-1',
    voucher_status: 'sent',
    created_at: '2024-07-01T10:00:00Z',
  },
  {
    id: 'bk-2',
    booking_code: 'YS-2024-0051',
    product_title: '태국 방콕·파타야 5박 6일',
    destination: '태국',
    departure_date: '2024-10-10',
    status: 'confirmed',
    total_selling_price: 1890000,
    created_at: '2024-08-20T14:30:00Z',
  },
  {
    id: 'bk-3',
    booking_code: 'YS-2024-0067',
    product_title: '유럽 서유럽 7개국 10박 11일',
    destination: '유럽',
    departure_date: '2024-12-22',
    status: 'pending',
    total_selling_price: 5600000,
    created_at: '2024-09-05T09:15:00Z',
  },
];

// ── 마일리지 카드 ─────────────────────────────────────────────

function MileageCard({ info }: { info: MileageInfo }) {
  const grade = GRADE_CONFIG[info.grade];
  const progress = grade.nextMin === Infinity
    ? 100
    : Math.min(100, Math.round((info.total_earned / grade.nextMin) * 100));

  return (
    <div className={`bg-gradient-to-br ${grade.color} rounded-2xl p-5 text-white shadow-lg`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs opacity-80 font-medium">나의 여소남 마일리지</p>
          <p className="text-3xl font-extrabold mt-0.5">₩{fmt(info.balance)}</p>
        </div>
        <span className="text-4xl">{grade.icon}</span>
      </div>

      {/* 등급 뱃지 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="bg-white/20 backdrop-blur text-xs font-bold px-3 py-1 rounded-full">
          {grade.label} 회원
        </span>
        <span className="text-xs opacity-80">적립률 5%</span>
      </div>

      {/* 다음 등급 진행바 */}
      {grade.nextMin !== Infinity && (
        <div>
          <div className="flex justify-between text-xs opacity-80 mb-1.5">
            <span>다음 등급: {grade.next}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-white/20 rounded-full h-2">
            <div
              className="bg-white rounded-full h-2 transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs opacity-70 mt-1.5">{grade.condition}</p>
        </div>
      )}

      {/* 적립/사용 요약 */}
      <div className="flex gap-4 mt-4 pt-4 border-t border-white/20">
        <div>
          <p className="text-xs opacity-70">총 적립</p>
          <p className="font-bold text-sm">+₩{fmt(info.total_earned)}</p>
        </div>
        <div>
          <p className="text-xs opacity-70">총 사용</p>
          <p className="font-bold text-sm">-₩{fmt(info.total_used)}</p>
        </div>
      </div>
    </div>
  );
}

// ── 예약 카드 ─────────────────────────────────────────────────

function BookingCard({ booking }: { booking: Booking }) {
  const statusCfg = STATUS_LABELS[booking.status] ?? { label: booking.status, color: 'bg-gray-100 text-gray-600' };
  const hasVoucher = booking.voucher_id && (booking.voucher_status === 'issued' || booking.voucher_status === 'sent');
  const isCompleted = booking.status === 'COMPLETED' || booking.status === 'completed';

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      {/* 상단: 상태 + 코드 */}
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusCfg.color}`}>
          {statusCfg.label}
        </span>
        <span className="text-xs text-gray-400">{booking.booking_code ?? booking.id.slice(0, 8).toUpperCase()}</span>
      </div>

      {/* 상품명 */}
      <h3 className="font-bold text-gray-900 text-sm leading-snug mb-2">{booking.product_title}</h3>

      {/* 여행 정보 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mb-3">
        {booking.destination && <span>📍 {booking.destination}</span>}
        {booking.departure_date && (
          <span>✈️ {booking.departure_date.slice(0, 10)}</span>
        )}
      </div>

      {/* 판매가 — 원가 절대 미노출 */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-400">결제 금액</p>
          <p className="font-bold text-indigo-700">₩{fmt(booking.total_selling_price)}</p>
        </div>

        {/* 확정서 버튼 — 결제 완료 시만 활성 */}
        {isCompleted && hasVoucher ? (
          <Link
            href={`/voucher/${booking.voucher_id}`}
            className="flex items-center gap-1.5 bg-indigo-600 text-white text-xs font-semibold px-3 py-2 rounded-xl hover:bg-indigo-700 transition"
          >
            📄 확정서 보기
          </Link>
        ) : isCompleted && !hasVoucher ? (
          <span className="text-xs text-gray-400 border border-gray-200 px-3 py-2 rounded-xl">
            확정서 준비중
          </span>
        ) : (
          <Link
            href={`/rfq/${booking.id}/chat`}
            className="flex items-center gap-1.5 border border-indigo-300 text-indigo-600 text-xs font-semibold px-3 py-2 rounded-xl hover:bg-indigo-50 transition"
          >
            💬 채팅
          </Link>
        )}
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────

export default function MyPage() {
  const router = useRouter();
  const [mileage, setMileage] = useState<MileageInfo | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'upcoming' | 'completed'>('all');

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/session').then((r) => r.json()).catch(() => null),
      // 실제 API: fetch('/api/mileage/balance'), fetch('/api/bookings/my')
    ]).then(() => {
      // Mock 데이터 세팅
      setMileage(MOCK_MILEAGE);
      setBookings(MOCK_BOOKINGS);
      setLoading(false);
    });
  }, []);

  const filteredBookings = bookings.filter((b) => {
    if (activeTab === 'upcoming') return !['COMPLETED', 'completed', 'cancelled', 'REFUNDED'].includes(b.status);
    if (activeTab === 'completed') return ['COMPLETED', 'completed'].includes(b.status);
    return true;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 상단 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700 p-1">←</button>
        <h1 className="font-bold text-gray-900">나의 여행 라운지</h1>
        <div className="w-8" />
      </header>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-5 pb-20">

        {/* 마일리지 카드 */}
        {mileage && <MileageCard info={mileage} />}

        {/* 마일리지 사용 배너 */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-indigo-900 text-sm">🎁 마일리지 사용하기</p>
            <p className="text-xs text-indigo-600 mt-0.5">
              결제 시 최대 30%까지 사용 가능 · 사용해도 원가 불변
            </p>
          </div>
          <Link
            href="/packages"
            className="bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap hover:bg-indigo-700 transition"
          >
            여행 찾기
          </Link>
        </div>

        {/* 예약 내역 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900">나의 예약</h2>
            <span className="text-xs text-gray-400">{bookings.length}건</span>
          </div>

          {/* 탭 */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
            {([
              { key: 'all',       label: '전체' },
              { key: 'upcoming',  label: '예정' },
              { key: 'completed', label: '완료' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === tab.key
                    ? 'bg-white shadow-sm text-indigo-700 font-semibold'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredBookings.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-3xl mb-2">🧳</p>
              <p className="text-sm">예약 내역이 없습니다</p>
              <Link href="/packages" className="mt-3 inline-block text-indigo-600 text-sm underline">
                여행 상품 둘러보기 →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredBookings.map((b) => (
                <BookingCard key={b.id} booking={b} />
              ))}
            </div>
          )}
        </div>

        {/* 하단 유틸 링크 */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: '📋', label: '마일리지 내역', href: '/mypage/mileage' },
            { icon: '🔔', label: '알림 설정',     href: '/mypage/notifications' },
            { icon: '⚙️',  label: '계정 설정',    href: '/mypage/settings' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="bg-white rounded-2xl p-3 text-center shadow-sm border border-gray-100 hover:shadow-md transition"
            >
              <div className="text-2xl mb-1">{item.icon}</div>
              <p className="text-xs text-gray-600 font-medium">{item.label}</p>
            </Link>
          ))}
        </div>

      </div>
    </div>
  );
}
