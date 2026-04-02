'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { matchAttraction } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { trackEngagement } from '@/lib/tracker';

interface PriceTier {
  period_label: string;
  departure_dates?: string[];
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
  nights?: number;
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
  product_summary?: string;
  special_notes?: string;
  notices_parsed?: (string | { type: string; title: string; text: string })[];
  itinerary_data?: { days?: DaySchedule[]; highlights?: { remarks?: string[] } } | DaySchedule[];
  country?: string;
  view_count?: number;
}

interface AttractionInfo {
  name: string; short_desc?: string; long_desc?: string; badge_type?: string; emoji?: string;
  aliases?: string[]; photos?: { src_medium: string; src_large: string; photographer: string }[];
  country?: string; region?: string;
}

const AIRLINES: Record<string, string> = {
  BX: '에어부산', LJ: '진에어', OZ: '아시아나', KE: '대한항공',
  '7C': '제주항공', TW: '티웨이', VJ: '비엣젯', ZE: '이스타항공',
  QV: '라오항공', D7: '에어아시아', OD: '바틱에어', '5J': '세부퍼시픽',
  VN: '베트남항공', MU: '중국동방항공', SC: '산동항공',
};

function getAirlineName(code?: string) {
  if (!code) return null;
  const m = code.match(/^([A-Z]{2}|\d[A-Z])/);
  return m ? AIRLINES[m[1]] || code : code;
}

const NAV_SECTIONS = ['상품정보', '요금표', '일정표', '포함/불포함'] as const;

function getTimelineIcon(type?: string, activity?: string) {
  if (type === 'flight' && activity && /출발|향발/.test(activity)) return { icon: '✈️', bg: 'bg-violet-600' };
  if (type === 'flight') return { icon: '🛬', bg: 'bg-violet-400' };
  if (type === 'golf') return { icon: '⛳', bg: 'bg-emerald-500' };
  if (type === 'optional') return { icon: '💎', bg: 'bg-pink-500' };
  if (type === 'shopping') return { icon: '🛍️', bg: 'bg-purple-400' };
  if (activity && /호텔.*체크|투숙|휴식/.test(activity)) return { icon: '🏨', bg: 'bg-indigo-400' };
  if (activity && /식사|중식|석식|조식/.test(activity)) return { icon: '🍽️', bg: 'bg-orange-400' };
  if (activity && /이동|출발|공항/.test(activity)) return { icon: '🚌', bg: 'bg-gray-400' };
  return { icon: '📍', bg: 'bg-violet-500' };
}

export default function ProductDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [pkg, setPkg] = useState<Package | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [attractions, setAttractions] = useState<AttractionInfo[]>([]);
  const [activeSection, setActiveSection] = useState('상품정보');
  const [activeDay, setActiveDay] = useState(1);
  const [selectedTier, setSelectedTier] = useState<PriceTier | null>(null);
  const [showInquiry, setShowInquiry] = useState(false);
  const [inquiryForm, setInquiryForm] = useState({ name: '', phone: '', message: '' });
  const [inquirySubmitted, setInquirySubmitted] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 데이터 로드
  useEffect(() => {
    fetch(`/api/packages?id=${id}`)
      .then(r => r.json())
      .then(data => {
        const p = data.package ?? null;
        setPkg(p);
        if (p) {
          trackEngagement({
            event_type: 'product_view',
            product_id: p.id,
            product_name: p.title,
            page_url: `/products/${p.id}`,
          });
          // view_count 증가
          fetch('/api/packages/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packageId: p.id, type: 'view' }),
          }).catch(() => {});
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));

    fetch('/api/attractions?detail=1')
      .then(r => r.json())
      .then(d => setAttractions(d.attractions || []))
      .catch(() => {});
  }, [id]);

  // 섹션 스크롤 감지
  const observerCallback = useCallback((entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      if (entry.isIntersecting) setActiveSection(entry.target.getAttribute('data-section') || '상품정보');
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(observerCallback, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
    Object.values(sectionRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [pkg, observerCallback]);

  const scrollToSection = (section: string) =>
    sectionRefs.current[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // 문의 제출
  const handleInquirySubmit = async () => {
    if (!inquiryForm.name || !inquiryForm.phone) return;
    try {
      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: id,
          channel: 'product_detail',
          form: {
            name: inquiryForm.name,
            phone: inquiryForm.phone,
            message: inquiryForm.message,
            desiredDate: selectedTier?.period_label || null,
            privacyConsent: true,
          },
          submittedAt: new Date().toISOString(),
        }),
      });
      // inquiry_count 증가
      await fetch('/api/packages/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: id, type: 'inquiry' }),
      });
    } catch { /* 실패해도 UI 정상 */ }
    setInquirySubmitted(true);
    setTimeout(() => {
      setShowInquiry(false);
      setInquirySubmitted(false);
      setInquiryForm({ name: '', phone: '', message: '' });
    }, 3000);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) { try { await navigator.share({ title: pkg?.title, url }); } catch {} }
    else { await navigator.clipboard.writeText(url); alert('링크가 복사되었습니다!'); }
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>;
  if (!pkg) return (
    <div className="min-h-screen flex flex-col items-center justify-center text-gray-500">
      <p className="text-lg mb-4">상품을 찾을 수 없습니다.</p>
      <Link href="/products" className="text-violet-600 underline">목록으로</Link>
    </div>
  );

  const days: DaySchedule[] = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
  const tiers = pkg.price_tiers || [];
  const minPrice = tiers.length > 0 ? Math.min(...tiers.map(t => t.adult_price || Infinity)) : pkg.price;
  const displayPrice = selectedTier?.adult_price || minPrice;
  const airlineName = getAirlineName(pkg.airline);
  const heroPhoto = attractions.find(a => a.photos?.length && a.country && pkg.destination?.includes(a.country))?.photos?.[0];
  const currentDay = days.find(d => d.day === activeDay) || days[0];

  return (
    <div className="min-h-screen bg-white pb-24 max-w-4xl mx-auto">

      {/* 히어로 이미지 */}
      <div ref={el => { sectionRefs.current['상품정보'] = el; }} data-section="상품정보"
        className="relative h-[360px] md:h-[480px] w-full overflow-hidden">
        {heroPhoto ? (
          <Image src={heroPhoto.src_large || heroPhoto.src_medium} alt={pkg.destination || ''} fill className="object-cover" sizes="100vw" priority />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-violet-900 via-violet-700 to-purple-500" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* 상단 네비 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-12">
          <Link href="/products" className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md">
            <span className="text-white text-lg">←</span>
          </Link>
          <button onClick={handleShare} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md">
            <span className="text-white">↗</span>
          </button>
        </div>

        {/* 히어로 콘텐츠 */}
        <div className="absolute bottom-0 left-0 right-0 p-5 pb-8">
          {pkg.product_type && (
            <span className="bg-violet-600 text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3 inline-block">
              {pkg.product_type.split('|')[0]}
            </span>
          )}
          <h1 className="text-white text-[22px] md:text-3xl font-extrabold leading-tight mb-2">{pkg.title}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pkg.destination && <span className="bg-white/20 backdrop-blur-sm text-white/90 text-[10px] px-2.5 py-1 rounded-full">#{pkg.destination}</span>}
            {airlineName && <span className="bg-white/20 backdrop-blur-sm text-white/90 text-[10px] px-2.5 py-1 rounded-full">#{airlineName}</span>}
            {pkg.duration && <span className="bg-white/20 backdrop-blur-sm text-white/90 text-[10px] px-2.5 py-1 rounded-full">#{pkg.duration}일</span>}
          </div>
        </div>
      </div>

      {/* 가격 카드 */}
      <section className="px-4 -mt-6 relative z-10">
        <div className="bg-white rounded-2xl p-5 shadow-lg border border-gray-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-400 text-[11px] mb-1">판매가</p>
              <div className="flex items-baseline gap-1">
                <span className="text-[28px] font-black text-gray-900">₩{(displayPrice || 0).toLocaleString()}</span>
                <span className="text-gray-400 text-sm">~</span>
              </div>
            </div>
            {pkg.ticketing_deadline && (() => {
              const deadline = new Date(pkg.ticketing_deadline);
              const today = new Date(); today.setHours(0,0,0,0); deadline.setHours(0,0,0,0);
              const diffDays = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              const dDayText = diffDays <= 0 ? '마감' : `D-${diffDays}`;
              const urgentColor = diffDays <= 3 ? 'bg-red-500 text-white' : diffDays <= 7 ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600';
              return <span className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg ${urgentColor}`}>⏰ {dDayText}</span>;
            })()}
          </div>
          {pkg.product_highlights && pkg.product_highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-gray-100">
              {pkg.product_highlights.slice(0, 4).map((h, i) => (
                <span key={i} className="bg-violet-50 text-violet-700 px-2.5 py-1 rounded-lg text-[10px] font-medium">{h}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 아이콘 정보바 */}
      <div className="flex justify-around py-5 px-4 mt-4 border-b border-gray-100">
        {pkg.duration && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl">📅</span>
            <span className="text-[11px] font-bold text-gray-700">{pkg.duration}일</span>
          </div>
        )}
        {airlineName && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl">✈️</span>
            <span className="text-[11px] font-bold text-gray-700">{airlineName}</span>
          </div>
        )}
        {pkg.min_participants && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl">👥</span>
            <span className="text-[11px] font-bold text-gray-700">최소 {pkg.min_participants}명</span>
          </div>
        )}
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl">🏷️</span>
          <span className="text-[11px] font-bold text-gray-700">{pkg.product_type?.split('|')[0] || '단체'}</span>
        </div>
      </div>

      {/* 스티키 탭 */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl border-b border-gray-100">
        <div className="flex gap-0 px-4">
          {NAV_SECTIONS.map(section => (
            <button key={section} onClick={() => scrollToSection(section)}
              className={`flex-1 py-3.5 text-xs font-semibold text-center transition-colors border-b-2 ${
                activeSection === section ? 'text-violet-700 border-violet-600' : 'text-gray-400 border-transparent'
              }`}>{section}</button>
          ))}
        </div>
      </div>

      {/* 요금표 */}
      {tiers.length > 0 && (
        <div ref={el => { sectionRefs.current['요금표'] = el; }} data-section="요금표" className="px-4 py-8 scroll-mt-12">
          <h2 className="text-lg font-extrabold text-gray-900 mb-5">출발일 · 요금</h2>
          <div className="space-y-2">
            {tiers.map((t, i) => {
              const isSelected = selectedTier === t;
              const isMin = t.adult_price === minPrice;
              return (
                <button key={i} onClick={() => setSelectedTier(isSelected ? null : t)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-left transition ${
                    isSelected ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-gray-200 bg-white'
                  }`}>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t.period_label}</p>
                    {t.departure_day_of_week && <p className="text-[10px] text-gray-400">{t.departure_day_of_week}</p>}
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${isMin ? 'text-violet-700' : 'text-gray-900'}`}>₩{t.adult_price?.toLocaleString()}</p>
                    {isMin && <span className="text-[9px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">최저가</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 일정표 */}
      {days.length > 0 && (
        <div ref={el => { sectionRefs.current['일정표'] = el; }} data-section="일정표" className="px-4 py-8 scroll-mt-12">
          <h2 className="text-lg font-extrabold text-gray-900 mb-5">여행 일정</h2>

          {/* 일차 탭 */}
          <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-hide">
            {days.map(d => (
              <button key={d.day} onClick={() => setActiveDay(d.day)}
                className={`shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition ${
                  activeDay === d.day ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}>
                Day {d.day}
              </button>
            ))}
          </div>

          {/* 타임라인 */}
          {currentDay && (
            <div className="space-y-0">
              {currentDay.regions && currentDay.regions.length > 0 && (
                <p className="text-xs text-gray-400 mb-3">{currentDay.regions.join(' → ')}</p>
              )}
              {currentDay.schedule?.map((item, idx) => {
                const { icon, bg } = getTimelineIcon(item.type, item.activity);
                const attr = matchAttraction(item.activity, attractions as AttractionData[], pkg.destination);
                const photo = attr?.photos?.[0];
                return (
                  <div key={idx} className="flex gap-3 pb-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center text-sm`}>{icon}</div>
                      {idx < (currentDay.schedule?.length || 0) - 1 && <div className="w-px flex-1 bg-gray-200 mt-1" />}
                    </div>
                    <div className="flex-1 pb-2">
                      {item.time && <p className="text-[10px] text-gray-400 mb-0.5">{item.time}</p>}
                      <p className="text-sm font-semibold text-gray-900">{item.activity}</p>
                      {item.note && <p className="text-xs text-gray-500 mt-0.5">{item.note}</p>}
                      {attr?.short_desc && <p className="text-xs text-gray-400 mt-1">{attr.short_desc}</p>}
                      {photo && (
                        <div className="mt-2 rounded-xl overflow-hidden h-32 relative">
                          <Image src={photo.src_medium} alt={item.activity} fill className="object-cover" sizes="300px" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 식사 & 숙소 */}
              {currentDay.meals && (
                <div className="flex gap-3 text-xs text-gray-500 mt-2 pt-3 border-t border-gray-100">
                  {currentDay.meals.breakfast && <span>🍳 조식{currentDay.meals.breakfast_note ? ` (${currentDay.meals.breakfast_note})` : ''}</span>}
                  {currentDay.meals.lunch && <span>🍱 중식{currentDay.meals.lunch_note ? ` (${currentDay.meals.lunch_note})` : ''}</span>}
                  {currentDay.meals.dinner && <span>🍽️ 석식{currentDay.meals.dinner_note ? ` (${currentDay.meals.dinner_note})` : ''}</span>}
                </div>
              )}
              {currentDay.hotel && (
                <div className="text-xs text-gray-500 mt-2">
                  🏨 {currentDay.hotel.name}{currentDay.hotel.grade ? ` (${currentDay.hotel.grade})` : ''}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 포함/불포함 */}
      <div ref={el => { sectionRefs.current['포함/불포함'] = el; }} data-section="포함/불포함" className="px-4 py-8 scroll-mt-12">
        {pkg.inclusions && pkg.inclusions.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">포함 사항</h3>
            <ul className="space-y-1.5">
              {pkg.inclusions.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {pkg.excludes && pkg.excludes.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">불포함 사항</h3>
            <ul className="space-y-1.5">
              {pkg.excludes.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-500">
                  <span className="text-red-400 mt-0.5">✗</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {pkg.optional_tours && pkg.optional_tours.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-extrabold text-gray-900 mb-3">선택 관광</h3>
            <div className="space-y-2">
              {pkg.optional_tours.map((tour, i) => (
                <div key={i} className="flex justify-between items-center px-4 py-3 bg-gray-50 rounded-xl">
                  <span className="text-sm text-gray-700">{tour.name}</span>
                  {tour.price_usd && <span className="text-xs font-bold text-violet-600">${tour.price_usd}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {pkg.special_notes && (
          <div className="mt-6 p-4 bg-amber-50 rounded-xl">
            <h3 className="text-sm font-extrabold text-amber-800 mb-2">특이사항</h3>
            <p className="text-xs text-amber-700 whitespace-pre-line">{pkg.special_notes}</p>
          </div>
        )}
      </div>

      {/* 문의 바텀시트 */}
      {showInquiry && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setShowInquiry(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-3xl p-6 pb-8" onClick={e => e.stopPropagation()}>
            {inquirySubmitted ? (
              <div className="text-center py-8">
                <p className="text-2xl mb-2">✅</p>
                <p className="text-lg font-bold text-gray-900">문의가 접수되었습니다</p>
                <p className="text-sm text-gray-500 mt-1">빠른 시일 내 연락드리겠습니다</p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-extrabold text-gray-900 mb-4">상담 문의</h3>
                <div className="space-y-3">
                  <input
                    type="text" placeholder="이름"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                    value={inquiryForm.name} onChange={e => setInquiryForm(f => ({ ...f, name: e.target.value }))}
                  />
                  <input
                    type="tel" placeholder="연락처"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                    value={inquiryForm.phone} onChange={e => setInquiryForm(f => ({ ...f, phone: e.target.value }))}
                  />
                  <textarea
                    placeholder="문의 내용 (선택)"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    value={inquiryForm.message} onChange={e => setInquiryForm(f => ({ ...f, message: e.target.value }))}
                  />
                </div>
                <button onClick={handleInquirySubmit}
                  disabled={!inquiryForm.name || !inquiryForm.phone}
                  className="w-full mt-4 bg-violet-600 text-white py-3.5 rounded-xl text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed">
                  문의하기
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 플로팅 CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl z-40 border-t border-gray-100 safe-area-bottom">
        <div className="max-w-4xl mx-auto px-4 pb-5 pt-3 flex items-center gap-3">
          <a href="tel:051-000-0000"
            className="w-12 h-12 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 shrink-0">
            <span className="text-lg">📞</span>
          </a>
          <button onClick={() => setShowInquiry(true)}
            className="flex-1 bg-violet-600 h-12 rounded-full text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all">
            💬 문의하기
          </button>
        </div>
      </div>
    </div>
  );
}
