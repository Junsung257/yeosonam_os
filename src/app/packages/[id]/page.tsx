'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

interface PriceTier {
  period_label: string;
  departure_day_of_week?: string;
  adult_price?: number;
  child_price?: number;
  status?: string;
  note?: string;
}

interface DaySchedule {
  day: number;
  regions?: string[];
  meals?: { breakfast?: boolean; lunch?: boolean; dinner?: boolean; breakfast_note?: string; lunch_note?: string; dinner_note?: string };
  schedule?: { time?: string; activity: string; type?: string; transport?: string; note?: string; badge?: string }[];
  hotel?: { name: string; grade?: string; note?: string } | null;
}

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  airline?: string;
  departure_airport?: string;
  departure_days?: string;
  min_participants?: number;
  ticketing_deadline?: string;
  product_type?: string;
  price_tiers?: PriceTier[];
  inclusions?: string[];
  excludes?: string[];
  optional_tours?: { name: string; price_usd?: number }[];
  product_highlights?: string[];
  special_notes?: string;
  itinerary_data?: { days?: DaySchedule[] } | DaySchedule[];
}

// IATA → 항공사명
const AIRLINES: Record<string, string> = { BX: '에어부산', LJ: '진에어', OZ: '아시아나', KE: '대한항공', '7C': '제주항공', TW: '티웨이', VJ: '비엣젯', ZE: '이스타항공', QV: '라오항공' };
function getAirlineName(code?: string) { if (!code) return null; const m = code.match(/^([A-Z]{2}|\d[A-Z])/); return m ? AIRLINES[m[1]] || code : code; }

export default function PackageDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const [pkg, setPkg] = useState<Package | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  // 어필리에이트 추적
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) fetch(`/api/influencer/track?ref=${ref}&pkg=${id}`).catch(() => {});
  }, [id, searchParams]);

  useEffect(() => {
    fetch(`/api/packages?id=${id}`)
      .then(r => r.json())
      .then(data => setPkg(data.package ?? null))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>;
  if (!pkg) return <div className="min-h-screen flex flex-col items-center justify-center text-gray-500"><p className="text-lg mb-4">상품을 찾을 수 없습니다.</p><Link href="/packages" className="text-blue-600 underline">목록으로</Link></div>;

  const days: DaySchedule[] = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
  const tiers = pkg.price_tiers || [];
  const minPrice = tiers.length > 0 ? Math.min(...tiers.map(t => t.adult_price || Infinity)) : pkg.price;
  const airlineName = getAirlineName(pkg.airline);

  const handleSubmit = () => {
    if (!formData.name || !formData.phone) return;
    // TODO: API 연동
    setSubmitted(true);
    setTimeout(() => { setShowForm(false); setSubmitted(false); setFormData({ name: '', phone: '', message: '' }); }, 3000);
  };

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* 히어로 */}
      <div className="bg-gradient-to-br from-[#001f3f] to-[#003366] text-white px-5 pt-10 pb-8">
        <Link href="/packages" className="text-blue-200 text-sm mb-3 inline-block">← 전체 상품</Link>
        <div className="flex items-center gap-2 mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="여소남" className="h-7 object-contain" />
          <span className="text-blue-200 text-xs">여소남 ✈️</span>
        </div>
        <h1 className="text-xl font-extrabold leading-tight mb-3">{pkg.title}</h1>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {pkg.destination && <span className="px-2 py-0.5 bg-white/20 rounded text-xs">{pkg.destination}</span>}
          {airlineName && <span className="px-2 py-0.5 bg-white/20 rounded text-xs">{airlineName}</span>}
          {pkg.duration && <span className="px-2 py-0.5 bg-white/20 rounded text-xs">{pkg.duration}일</span>}
          {pkg.min_participants && <span className="px-2 py-0.5 bg-white/20 rounded text-xs">최소 {pkg.min_participants}명</span>}
          {pkg.product_type && <span className="px-2 py-0.5 bg-amber-400/30 rounded text-xs font-bold">{pkg.product_type}</span>}
        </div>
        {minPrice && minPrice < Infinity && (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black">₩{minPrice.toLocaleString()}</span>
            <span className="text-blue-200 text-sm">~ / 1인</span>
          </div>
        )}
        {pkg.ticketing_deadline && (
          <p className="text-red-300 text-xs mt-2 font-bold">⏰ {pkg.ticketing_deadline}까지 발권</p>
        )}
      </div>

      {/* 핵심 특전 */}
      {pkg.product_highlights && pkg.product_highlights.length > 0 && (
        <div className="px-5 py-4 bg-amber-50 border-b border-amber-100">
          <p className="text-xs font-bold text-amber-700 mb-2">★ 핵심 특전</p>
          <div className="flex flex-wrap gap-1.5">
            {pkg.product_highlights.map((h, i) => (
              <span key={i} className="px-2 py-1 bg-white border border-amber-200 rounded-lg text-xs font-medium text-amber-800">{h}</span>
            ))}
          </div>
        </div>
      )}

      {/* 요금표 */}
      {tiers.length > 0 && (
        <div className="px-5 py-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900 mb-3">📋 출발일별 요금</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#001f3f] text-white">
                  <th className="py-2 px-3 text-left text-xs font-semibold">출발 기간</th>
                  {tiers.some(t => t.departure_day_of_week) && <th className="py-2 px-3 text-center text-xs font-semibold">요일</th>}
                  <th className="py-2 px-3 text-right text-xs font-semibold">요금</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t, i) => {
                  const isMin = t.adult_price === minPrice;
                  return (
                    <tr key={i} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50' : ''}`}>
                      <td className="py-2.5 px-3 text-xs text-gray-700">{t.period_label}</td>
                      {tiers.some(t => t.departure_day_of_week) && <td className="py-2.5 px-3 text-center text-xs text-gray-500">{t.departure_day_of_week || '-'}</td>}
                      <td className={`py-2.5 px-3 text-right text-sm font-bold ${isMin ? 'text-red-600' : 'text-gray-900'}`}>
                        ₩{t.adult_price?.toLocaleString() || '-'}
                        {isMin && <span className="ml-1 text-[10px] bg-red-100 text-red-600 px-1 py-0.5 rounded">최저가</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 선택관광 */}
      {pkg.optional_tours && pkg.optional_tours.length > 0 && (
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 mb-2">🎯 선택 관광</h2>
          <div className="flex flex-wrap gap-1.5">
            {pkg.optional_tours.map((t, i) => (
              <span key={i} className="px-2 py-1 bg-pink-50 text-pink-700 border border-pink-200 rounded-lg text-xs font-medium">
                {t.name}{t.price_usd ? ` ($${t.price_usd})` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 포함/불포함 */}
      {(pkg.inclusions?.length || pkg.excludes?.length) && (
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="grid grid-cols-2 gap-3">
            {pkg.inclusions && pkg.inclusions.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-3">
                <h3 className="text-xs font-bold text-blue-900 mb-2">포함 사항</h3>
                <ul className="space-y-1">
                  {pkg.inclusions.map((item, i) => (
                    <li key={i} className="text-xs text-blue-800 flex gap-1"><span className="shrink-0">✅</span>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {pkg.excludes && pkg.excludes.length > 0 && (
              <div className="bg-red-50 rounded-lg p-3">
                <h3 className="text-xs font-bold text-red-900 mb-2">불포함 사항</h3>
                <ul className="space-y-1">
                  {pkg.excludes.map((item, i) => (
                    <li key={i} className="text-xs text-red-800 flex gap-1"><span className="shrink-0">❌</span>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 일정표 */}
      {days.length > 0 && (
        <div className="px-5 py-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900 mb-4">🗓 여행 일정</h2>
          <div className="space-y-4">
            {days.map(day => (
              <div key={day.day} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black text-[#005d90]">{String(day.day).padStart(2, '0')}</span>
                    <span className="text-xs text-gray-500">{day.day}일차</span>
                  </div>
                  {day.regions && <span className="text-xs text-gray-600">{day.regions.join(' → ')}</span>}
                </div>
                <div className="px-4 py-3 space-y-2">
                  {day.schedule?.map((item, sIdx) => (
                    <div key={sIdx} className="flex items-start gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        item.type === 'flight' ? 'bg-blue-500' :
                        item.type === 'golf' ? 'bg-green-500' :
                        item.type === 'optional' ? 'bg-pink-500' :
                        item.type === 'shopping' ? 'bg-purple-500' : 'bg-gray-300'
                      }`} />
                      <div>
                        <p className="text-xs text-gray-800 leading-relaxed">
                          {item.time && <span className="text-blue-600 font-bold mr-1">{item.time}</span>}
                          {item.activity}
                        </p>
                        {item.note && <p className="text-[10px] text-red-500 mt-0.5">{item.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {/* 호텔+식사 */}
                <div className="bg-gray-50 px-4 py-2 flex items-center justify-between text-[10px] text-gray-500">
                  <span>🏨 {day.hotel?.name || '일정 종료'}{day.hotel?.grade ? ` (${day.hotel.grade})` : ''}</span>
                  <span>
                    ☕{day.meals?.breakfast_note || (day.meals?.breakfast ? '호텔식' : '불포함')} |
                    🍜{day.meals?.lunch_note || (day.meals?.lunch ? '현지식' : '불포함')} |
                    🍽️{day.meals?.dinner_note || (day.meals?.dinner ? '현지식' : '불포함')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 유의사항 */}
      {pkg.special_notes && (
        <div className="px-5 py-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">⚠️ 유의사항</h2>
          <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{pkg.special_notes}</p>
        </div>
      )}

      {/* 하단 플로팅 예약 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-3 flex items-center justify-between z-50 shadow-lg">
        <div>
          {minPrice && minPrice < Infinity && (
            <>
              <p className="text-[10px] text-gray-400">1인 기준</p>
              <p className="text-lg font-black text-[#001f3f]">₩{minPrice.toLocaleString()}~</p>
            </>
          )}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-6 py-3 bg-[#001f3f] text-white font-bold rounded-xl text-sm hover:bg-[#003366] transition"
        >
          예약 문의하기
        </button>
      </div>

      {/* 예약 문의 폼 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center">
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-6 animate-slide-up">
            {submitted ? (
              <div className="text-center py-8">
                <p className="text-2xl mb-2">✅</p>
                <p className="font-bold text-gray-900">문의가 접수되었습니다!</p>
                <p className="text-sm text-gray-500 mt-1">빠른 시간 내에 연락드리겠습니다.</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-gray-900">예약 문의</h3>
                  <button onClick={() => setShowForm(false)} className="text-gray-400 text-2xl">×</button>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 mb-4 text-xs text-blue-800">
                  <p className="font-bold">{pkg.title}</p>
                  {minPrice && minPrice < Infinity && <p>₩{minPrice.toLocaleString()}~ / 1인</p>}
                </div>
                <div className="space-y-3">
                  <input
                    placeholder="이름 *"
                    value={formData.name}
                    onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                    className="w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    placeholder="연락처 *"
                    value={formData.phone}
                    onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    placeholder="요청사항 (선택)"
                    value={formData.message}
                    onChange={e => setFormData(f => ({ ...f, message: e.target.value }))}
                    rows={3}
                    className="w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!formData.name || !formData.phone}
                    className="w-full py-3 bg-[#001f3f] text-white font-bold rounded-xl text-sm disabled:opacity-50"
                  >
                    문의 접수하기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
