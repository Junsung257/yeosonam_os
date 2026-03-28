'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

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
  notices_parsed?: (string | { type: string; title: string; text: string })[];
  itinerary_data?: { days?: DaySchedule[]; highlights?: { remarks?: string[] } } | DaySchedule[];
}

interface AttractionInfo { name: string; short_desc?: string; long_desc?: string; badge_type?: string; emoji?: string; }

const AIRLINES: Record<string, string> = { BX: '에어부산', LJ: '진에어', OZ: '아시아나', KE: '대한항공', '7C': '제주항공', TW: '티웨이', VJ: '비엣젯', ZE: '이스타항공', QV: '라오항공' };
function getAirlineName(code?: string) { if (!code) return null; const m = code.match(/^([A-Z]{2}|\d[A-Z])/); return m ? AIRLINES[m[1]] || code : code; }

const NAV_SECTIONS = ['상품정보', '요금표', '일정표', '유의사항'] as const;

function getTimelineIcon(type?: string, activity?: string) {
  if (type === 'flight' && activity && /출발|향발/.test(activity)) return { icon: '🛫', bg: 'bg-[#001f3f]' };
  if (type === 'flight') return { icon: '🛬', bg: 'bg-gray-400' };
  if (type === 'golf') return { icon: '⛳', bg: 'bg-green-500' };
  if (type === 'optional') return { icon: '💎', bg: 'bg-pink-500' };
  if (type === 'shopping') return { icon: '🛍️', bg: 'bg-purple-500' };
  if (type === 'cruise' || type === 'spa') return { icon: '✨', bg: 'bg-cyan-500' };
  if (activity && /호텔.*체크|투숙|휴식/.test(activity)) return { icon: '🏨', bg: 'bg-indigo-400' };
  if (activity && /이동|출발|공항/.test(activity)) return { icon: '🚌', bg: 'bg-gray-400' };
  return { icon: '📍', bg: 'bg-[#005d90]' };
}

export default function PackageDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const [pkg, setPkg] = useState<Package | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', message: '', date: '' });
  const [submitted, setSubmitted] = useState(false);
  const [attractions, setAttractions] = useState<AttractionInfo[]>([]);
  const [selectedTier, setSelectedTier] = useState<PriceTier | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [calMonth, setCalMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [activeSection, setActiveSection] = useState('상품정보');
  const [activeDay, setActiveDay] = useState(1);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) fetch(`/api/influencer/track?ref=${ref}&pkg=${id}`).catch(() => {});
  }, [id, searchParams]);

  useEffect(() => {
    fetch(`/api/packages?id=${id}`).then(r => r.json()).then(data => setPkg(data.package ?? null)).catch(console.error).finally(() => setIsLoading(false));
    fetch('/api/attractions').then(r => r.json()).then(d => setAttractions(d.attractions || [])).catch(() => {});
  }, [id]);

  const observerCallback = useCallback((entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) { if (entry.isIntersecting) setActiveSection(entry.target.getAttribute('data-section') || '상품정보'); }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(observerCallback, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
    Object.values(sectionRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [pkg, observerCallback]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>;
  if (!pkg) return <div className="min-h-screen flex flex-col items-center justify-center text-gray-500"><p className="text-lg mb-4">상품을 찾을 수 없습니다.</p><Link href="/packages" className="text-blue-600 underline">목록으로</Link></div>;

  const days: DaySchedule[] = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
  const tiers = pkg.price_tiers || [];
  const minPrice = tiers.length > 0 ? Math.min(...tiers.map(t => t.adult_price || Infinity)) : pkg.price;
  const displayPrice = selectedTier?.adult_price || minPrice;
  const airlineName = getAirlineName(pkg.airline);

  const handleSubmit = () => {
    if (!formData.name || !formData.phone) return;
    setSubmitted(true);
    setTimeout(() => { setShowForm(false); setSubmitted(false); setFormData({ name: '', phone: '', message: '', date: '' }); }, 3000);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) { try { await navigator.share({ title: pkg.title, url }); } catch {} }
    else { await navigator.clipboard.writeText(url); alert('링크가 복사되었습니다!'); }
  };

  const scrollToSection = (section: string) => sectionRefs.current[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const currentDay = days.find(d => d.day === activeDay) || days[0];

  return (
    <div className="min-h-screen bg-[#f9f9f9] pb-28 max-w-lg mx-auto">

      {/* ═══ 히어로 (Voyager Style) ═══ */}
      <div ref={el => { sectionRefs.current['상품정보'] = el; }} data-section="상품정보"
        className="relative h-[320px] w-full overflow-hidden bg-gradient-to-br from-[#001f3f] via-[#003366] to-[#005d90]">
        {/* 상단 네비 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-5 pt-5">
          <Link href="/packages" className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <span className="text-white text-sm">←</span>
          </Link>
          <div className="flex gap-2">
            <button onClick={handleShare} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
              <span className="text-white text-sm">🔗</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
              <span className="text-white text-sm">♡</span>
            </button>
          </div>
        </div>
        {/* 그라데이션 오버레이 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        {/* 히어로 콘텐츠 */}
        <div className="absolute bottom-6 left-5 right-5">
          {pkg.product_type && (
            <span className="bg-red-500 text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 inline-block">{pkg.product_type}</span>
          )}
          <h1 className="text-white text-xl font-extrabold leading-tight tracking-tight mb-1">{pkg.title}</h1>
          <div className="flex flex-wrap gap-1 mt-2">
            {pkg.destination && <span className="text-white/70 text-[10px]">#{pkg.destination}</span>}
            {airlineName && <span className="text-white/70 text-[10px]">#{airlineName}</span>}
            {pkg.duration && <span className="text-white/70 text-[10px]">#{pkg.duration}일</span>}
          </div>
        </div>
      </div>

      {/* ═══ 가격 카드 (Voyager -mt-6 플로팅) ═══ */}
      <section className="px-5 -mt-8 relative z-10">
        <div className="bg-white rounded-2xl p-5 shadow-[0_20px_40px_rgba(0,0,0,0.08)]">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-gray-400 text-xs mb-1">Price starts from</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-[#001f3f]">₩{(displayPrice || 0).toLocaleString()}</span>
                {selectedTier ? '' : <span className="text-gray-400 text-sm">~</span>}
              </div>
              {pkg.ticketing_deadline && (
                <p className="text-red-500 text-[10px] font-bold mt-1">⏰ {pkg.ticketing_deadline}까지 발권</p>
              )}
            </div>
          </div>
          {/* 퀵 정보 pill 배지 */}
          <div className="flex flex-wrap gap-2 mb-3">
            {pkg.duration && (
              <div className="bg-gray-100 px-3 py-1.5 rounded-full flex items-center gap-1.5">
                <span className="text-[10px]">🗓</span>
                <span className="text-[10px] font-bold text-gray-700">{pkg.duration}일</span>
              </div>
            )}
            {airlineName && (
              <div className="bg-gray-100 px-3 py-1.5 rounded-full flex items-center gap-1.5">
                <span className="text-[10px]">✈️</span>
                <span className="text-[10px] font-bold text-gray-700">{airlineName}</span>
              </div>
            )}
            {pkg.min_participants && (
              <div className="bg-gray-100 px-3 py-1.5 rounded-full flex items-center gap-1.5">
                <span className="text-[10px]">👥</span>
                <span className="text-[10px] font-bold text-gray-700">최소 {pkg.min_participants}명</span>
              </div>
            )}
          </div>
          {/* 핵심 특전 태그 */}
          {pkg.product_highlights && pkg.product_highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-3 border-t border-gray-100">
              {pkg.product_highlights.map((h, i) => (
                <span key={i} className="border border-gray-200 px-2.5 py-1 rounded-lg text-[10px] font-medium text-gray-500">{h}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══ 스티키 탭 (Voyager Style) ═══ */}
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl mt-6 border-b border-gray-100 shadow-sm">
        <div className="flex gap-6 px-5 overflow-x-auto">
          {NAV_SECTIONS.map(section => (
            <button key={section} onClick={() => scrollToSection(section)}
              className={`py-3 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 ${
                activeSection === section ? 'text-[#001f3f] border-[#001f3f]' : 'text-gray-400 border-transparent hover:text-gray-600'
              }`}>{section}</button>
          ))}
        </div>
      </div>

      {/* ═══ 요금표 (달력형) ═══ */}
      {tiers.length > 0 && (
        <div ref={el => { sectionRefs.current['요금표'] = el; }} data-section="요금표" className="px-5 py-8 scroll-mt-12">
          <h2 className="text-lg font-extrabold tracking-tight mb-4">출발일 선택</h2>
          {(() => {
            const dateMap = new Map<string, { price: number; tier: PriceTier; note?: string }>();
            for (const t of tiers) {
              if (t.departure_dates?.length) {
                for (const d of t.departure_dates) {
                  const date = new Date(d);
                  if (!isNaN(date.getTime())) {
                    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
                    dateMap.set(key, { price: t.adult_price || 0, tier: t, note: t.note || undefined });
                  }
                }
              }
            }
            if (dateMap.size === 0) {
              return (
                <div className="space-y-2">
                  {tiers.map((t, i) => {
                    const isSelected = selectedTier === t;
                    const isMin = t.adult_price === minPrice;
                    return (
                      <button key={i} onClick={() => { setSelectedTier(isSelected ? null : t); setSelectedDate(isSelected ? '' : t.period_label); setFormData(f => ({ ...f, date: isSelected ? '' : `${t.period_label} ${t.departure_day_of_week || ''}`.trim() })); }}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition ${isSelected ? 'border-[#001f3f] bg-[#001f3f]/5 ring-1 ring-[#001f3f]' : 'border-gray-200 bg-white'}`}>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{t.period_label}</p>
                          {t.departure_day_of_week && <p className="text-[10px] text-gray-400">{t.departure_day_of_week}</p>}
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${isMin ? 'text-red-600' : 'text-gray-900'}`}>₩{t.adult_price?.toLocaleString()}</p>
                          {isMin && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">최저가</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            }
            const year = calMonth.getFullYear(); const month = calMonth.getMonth();
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const WEEKDAYS = ['일','월','화','수','목','금','토'];
            const cells: (number | null)[] = [];
            for (let i = 0; i < firstDay; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);
            while (cells.length % 7 !== 0) cells.push(null);
            return (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => setCalMonth(new Date(year, month - 1, 1))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">◀</button>
                  <span className="text-sm font-bold">{year}년 {month + 1}월</span>
                  <button onClick={() => setCalMonth(new Date(year, month + 1, 1))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">▶</button>
                </div>
                <div className="grid grid-cols-7 mb-2">
                  {WEEKDAYS.map(w => (
                    <div key={w} className={`text-center text-[10px] font-medium py-1 ${w === '일' ? 'text-red-400' : w === '토' ? 'text-blue-400' : 'text-gray-400'}`}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((d, i) => {
                    if (d === null) return <div key={i} />;
                    const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                    const info = dateMap.get(key);
                    const isSelected = selectedDate === key;
                    const isMin = info && info.price === minPrice;
                    return (
                      <button key={i} disabled={!info}
                        onClick={() => { if (!info) return; setSelectedTier(isSelected ? null : info.tier); setSelectedDate(isSelected ? '' : key); setFormData(f => ({ ...f, date: isSelected ? '' : `${month+1}/${d}` })); }}
                        className={`flex flex-col items-center py-2 rounded-xl transition min-h-[52px] justify-center ${
                          isSelected ? 'bg-[#001f3f] text-white shadow-lg' : info ? 'hover:bg-gray-100' : 'opacity-20'
                        }`}>
                        <span className="text-xs font-medium">{d}</span>
                        {info && <span className={`text-[8px] mt-0.5 font-bold ${isSelected ? 'text-white/80' : isMin ? 'text-red-600' : 'text-gray-400'}`}>{Math.round(info.price / 10000)}만</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══ 포함/불포함 ═══ */}
      {(pkg.inclusions?.length || pkg.excludes?.length) ? (
        <div className="px-5 py-6 space-y-4">
          {pkg.inclusions && pkg.inclusions.length > 0 && (
            <div className="bg-blue-50/50 rounded-2xl p-4">
              <h3 className="text-xs font-bold text-blue-900 mb-3">포함 사항</h3>
              <ul className="space-y-1.5">
                {pkg.inclusions.map((item, i) => (
                  <li key={i} className="text-xs text-blue-800 flex gap-2"><span className="shrink-0">✅</span>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {pkg.excludes && pkg.excludes.length > 0 && (
            <div className="bg-red-50/50 rounded-2xl p-4">
              <h3 className="text-xs font-bold text-red-900 mb-3">불포함 사항</h3>
              <ul className="space-y-1.5">
                {pkg.excludes.map((item, i) => (
                  <li key={i} className="text-xs text-red-800 flex gap-2"><span className="shrink-0">❌</span>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {/* ═══ 일정표 (Voyager Timeline) ═══ */}
      {days.length > 0 && (
        <div ref={el => { sectionRefs.current['일정표'] = el; }} data-section="일정표" className="px-5 py-8 scroll-mt-12">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-extrabold tracking-tight">여행 일정</h2>
          </div>

          {/* 일차별 카드 탭 (Voyager Style — 가로 스크롤) */}
          <div className="flex gap-3 overflow-x-auto pb-4 mb-8 -mx-5 px-5">
            {days.map(day => (
              <button key={day.day} onClick={() => setActiveDay(day.day)}
                className={`flex-shrink-0 flex flex-col items-center px-5 py-3 rounded-2xl transition-all ${
                  activeDay === day.day
                    ? 'bg-[#001f3f] text-white shadow-lg shadow-[#001f3f]/30'
                    : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                }`}>
                <span className="text-[9px] font-bold uppercase tracking-widest opacity-80 mb-0.5">Day {day.day}</span>
                <span className="font-bold text-base leading-none">{String(day.day).padStart(2, '0')}</span>
                <span className="text-[10px] mt-1 opacity-70">{day.regions?.[0]?.slice(0, 4) || ''}</span>
              </button>
            ))}
          </div>

          {/* 선택된 일차 타임라인 (Voyager Style) */}
          {currentDay && (
            <div className="relative">
              {/* 세로선 */}
              <div className="absolute left-[18px] top-4 bottom-4 w-[2px] bg-gray-200" />

              <div className="space-y-8">
                {currentDay.schedule?.map((item, sIdx) => {
                  const { icon, bg } = getTimelineIcon(item.type, item.activity);
                  const attr = attractions.find(a => a.name.length >= 4 && item.activity.includes(a.name));
                  const isHotel = /호텔.*체크|투숙|휴식/.test(item.activity);

                  return (
                    <div key={sIdx} className="relative pl-12">
                      {/* 아이콘 dot */}
                      <div className={`absolute left-0 top-1 w-9 h-9 rounded-full ${bg} flex items-center justify-center ring-4 ring-[#f9f9f9] z-10`}>
                        <span className="text-sm">{icon}</span>
                      </div>

                      <div className="flex flex-col">
                        {/* 시간 */}
                        {item.time && (
                          <span className={`font-bold text-sm tracking-tight mb-1 ${item.type === 'flight' ? 'text-[#001f3f]' : 'text-gray-400'}`}>{item.time}</span>
                        )}
                        {/* 활동명 */}
                        <h3 className="font-bold text-base text-gray-900 leading-tight">
                          {attr?.emoji && <span className="mr-1">{attr.emoji}</span>}
                          {item.activity}
                        </h3>
                        {/* 부가 정보 */}
                        {item.transport && item.type === 'flight' && (
                          <p className="text-gray-400 text-xs mt-1">{getAirlineName(item.transport) || ''} {item.transport}</p>
                        )}
                        {attr?.short_desc && (
                          <p className="text-gray-400 text-xs mt-1">— {attr.short_desc}</p>
                        )}
                        {item.note && (
                          <p className="text-red-500 text-xs mt-1 font-medium">{item.note}</p>
                        )}

                        {/* 호텔 카드 (Voyager Style) */}
                        {isHotel && currentDay.hotel && (
                          <div className="bg-gray-100 rounded-xl p-3 flex gap-3 items-center mt-3">
                            <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-blue-200 to-blue-400 flex items-center justify-center text-2xl shrink-0">🏨</div>
                            <div>
                              {currentDay.hotel.grade && (
                                <div className="flex gap-0.5 mb-0.5">
                                  {Array.from({ length: parseInt(currentDay.hotel.grade) || 4 }).map((_, i) => (
                                    <span key={i} className="text-amber-400 text-[10px]">★</span>
                                  ))}
                                </div>
                              )}
                              <h4 className="font-bold text-xs text-gray-800">{currentDay.hotel.name}</h4>
                              {currentDay.hotel.note && <p className="text-[10px] text-gray-400">{currentDay.hotel.note}</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* 식사 정보 (하단) */}
                {currentDay.meals && (
                  <div className="relative pl-12">
                    <div className="absolute left-0 top-1 w-9 h-9 rounded-full bg-red-400 flex items-center justify-center ring-4 ring-[#f9f9f9] z-10">
                      <span className="text-sm">🍽️</span>
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-gray-900 mb-2">식사 안내</h3>
                      <div className="flex gap-3">
                        <div className="bg-white rounded-xl px-3 py-2 flex-1 text-center border border-gray-100">
                          <p className="text-[9px] text-gray-400 mb-0.5">조식</p>
                          <p className="text-xs font-bold text-gray-700">{currentDay.meals.breakfast_note || (currentDay.meals.breakfast ? '호텔식' : '불포함')}</p>
                        </div>
                        <div className="bg-white rounded-xl px-3 py-2 flex-1 text-center border border-gray-100">
                          <p className="text-[9px] text-gray-400 mb-0.5">중식</p>
                          <p className="text-xs font-bold text-gray-700">{currentDay.meals.lunch_note || (currentDay.meals.lunch ? '현지식' : '불포함')}</p>
                        </div>
                        <div className="bg-white rounded-xl px-3 py-2 flex-1 text-center border border-gray-100">
                          <p className="text-[9px] text-gray-400 mb-0.5">석식</p>
                          <p className="text-xs font-bold text-gray-700">{currentDay.meals.dinner_note || (currentDay.meals.dinner ? '현지식' : '불포함')}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ 유의사항 ═══ */}
      <div ref={el => { sectionRefs.current['유의사항'] = el; }} data-section="유의사항" className="px-5 py-8 scroll-mt-12">
        {(() => {
          const NOTICE_STYLES: Record<string, { bg: string; border: string; title: string; dot: string }> = {
            CRITICAL: { bg: 'bg-red-50', border: 'border-red-200', title: 'text-red-800', dot: '🔴' },
            PAYMENT: { bg: 'bg-orange-50', border: 'border-orange-200', title: 'text-orange-800', dot: '🟠' },
            POLICY: { bg: 'bg-blue-50', border: 'border-blue-200', title: 'text-blue-800', dot: '🔵' },
            INFO: { bg: 'bg-gray-50', border: 'border-gray-200', title: 'text-gray-700', dot: '⚪' },
          };
          const typedNotices = (pkg.notices_parsed || []).filter(
            (n): n is { type: string; title: string; text: string } => typeof n === 'object' && n !== null && 'type' in n
          );
          if (typedNotices.length === 0 && !pkg.special_notes) return null;
          return (
            <div>
              <h2 className="text-lg font-extrabold tracking-tight mb-4">유의사항</h2>
              {typedNotices.length > 0 ? (
                <div className="space-y-3">
                  {typedNotices.map((notice, idx) => {
                    const style = NOTICE_STYLES[notice.type] || NOTICE_STYLES.INFO;
                    const lines = (notice.text || '').split('\n').map(l => l.trim()).filter(Boolean);
                    return (
                      <div key={idx} className={`${style.bg} border ${style.border} rounded-2xl p-4`}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs">{style.dot}</span>
                          <span className={`text-xs font-bold ${style.title}`}>{notice.title}</span>
                        </div>
                        <div className="space-y-1">
                          {lines.map((line, lIdx) => (
                            <p key={lIdx} className="text-[11px] text-gray-600 leading-relaxed">{line.startsWith('•') ? line : `• ${line}`}</p>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[9px] text-gray-400 italic">※ 공통 규정은 별도 [예약 안내문]을 확인하시기 바랍니다.</p>
                </div>
              ) : pkg.special_notes ? (
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{pkg.special_notes}</p>
              ) : null}
            </div>
          );
        })()}
      </div>

      {/* ═══ 하단 플로팅 바 (Voyager Style) ═══ */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-2xl z-50 rounded-t-[28px] shadow-[0_-10px_40px_rgba(0,0,0,0.08)]">
        <div className="max-w-lg mx-auto px-5 pb-6 pt-4 flex items-center gap-3">
          <a href="tel:051-000-0000" className="w-12 h-12 flex flex-col items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition shrink-0">
            <span className="text-sm">📞</span>
            <span className="text-[7px] font-bold text-gray-500 mt-0.5">CALL</span>
          </a>
          <a href="https://pf.kakao.com/_여소남" target="_blank" rel="noopener noreferrer" className="w-12 h-12 flex flex-col items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition shrink-0">
            <span className="text-sm">💬</span>
            <span className="text-[7px] font-bold text-gray-500 mt-0.5">CHAT</span>
          </a>
          <button onClick={() => setShowForm(true)}
            className="flex-1 bg-gradient-to-r from-[#001f3f] to-[#003366] h-12 rounded-full text-white font-bold text-sm shadow-lg shadow-[#001f3f]/20 active:scale-[0.98] transition-all">
            예약 문의하기
          </button>
        </div>
      </div>

      {/* ═══ 예약 폼 바텀시트 ═══ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowForm(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-6" onClick={e => e.stopPropagation()}>
            {submitted ? (
              <div className="text-center py-8">
                <p className="text-3xl mb-2">✅</p>
                <p className="font-bold text-gray-900 text-lg">문의가 접수되었습니다!</p>
                <p className="text-sm text-gray-500 mt-1">빠른 시간 내에 연락드리겠습니다.</p>
              </div>
            ) : (
              <>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-900 mb-3">예약 문의</h3>
                <div className="bg-[#001f3f]/5 rounded-xl p-3 mb-4 text-xs text-[#001f3f]">
                  <p className="font-bold">{pkg.title}</p>
                  {selectedTier ? (
                    <p className="mt-1">📅 {selectedTier.period_label} {selectedTier.departure_day_of_week || ''} — ₩{selectedTier.adult_price?.toLocaleString()}</p>
                  ) : displayPrice && displayPrice < Infinity ? (
                    <p className="mt-1">₩{displayPrice.toLocaleString()}~ / 1인</p>
                  ) : null}
                </div>
                <div className="space-y-3">
                  <input placeholder="이름 *" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001f3f]" />
                  <input placeholder="연락처 *" value={formData.phone} onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001f3f]" />
                  {!selectedTier && <input placeholder="희망 출발일" value={formData.date} onChange={e => setFormData(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001f3f]" />}
                  <textarea placeholder="요청사항 (선택)" value={formData.message} onChange={e => setFormData(f => ({ ...f, message: e.target.value }))}
                    rows={2} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001f3f] resize-none" />
                  <button onClick={handleSubmit} disabled={!formData.name || !formData.phone}
                    className="w-full py-3 bg-gradient-to-r from-[#001f3f] to-[#003366] text-white font-bold rounded-xl text-sm disabled:opacity-50 shadow-lg">
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
