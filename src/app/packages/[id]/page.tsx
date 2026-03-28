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

interface AttractionInfo { name: string; short_desc?: string; long_desc?: string; badge_type?: string; emoji?: string; country?: string; region?: string; }

const AIRLINES: Record<string, string> = { BX: '에어부산', LJ: '진에어', OZ: '아시아나', KE: '대한항공', '7C': '제주항공', TW: '티웨이', VJ: '비엣젯', ZE: '이스타항공', QV: '라오항공' };
function getAirlineName(code?: string) { if (!code) return null; const m = code.match(/^([A-Z]{2}|\d[A-Z])/); return m ? AIRLINES[m[1]] || code : code; }

const NAV_SECTIONS = ['상품정보', '요금표', '일정표', '유의사항'] as const;

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
  const [activeSection, setActiveSection] = useState<string>('상품정보');
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set([1]));
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
    fetch('/api/attractions').then(r => r.json()).then(d => setAttractions(d.attractions || [])).catch(() => {});
  }, [id]);

  // 스크롤 추적 — IntersectionObserver
  const observerCallback = useCallback((entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        setActiveSection(entry.target.getAttribute('data-section') || '상품정보');
      }
    }
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
    const text = `${pkg.title} - ₩${(displayPrice || 0).toLocaleString()}~`;
    if (navigator.share) {
      try { await navigator.share({ title: pkg.title, text, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      alert('링크가 복사되었습니다!');
    }
  };

  const scrollToSection = (section: string) => {
    sectionRefs.current[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleDay = (day: number) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-white pb-24 max-w-lg mx-auto">
      {/* ═══ 히어로 ═══ */}
      <div ref={el => { sectionRefs.current['상품정보'] = el; }} data-section="상품정보"
        className="bg-gradient-to-br from-[#001f3f] to-[#003366] text-white px-5 pt-8 pb-6 relative">
        <div className="flex justify-between items-start mb-3">
          <Link href="/packages" className="text-blue-200 text-xs">← 전체 상품</Link>
          <button onClick={handleShare} className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-sm">🔗</button>
        </div>
        <div className="flex items-center gap-2 mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="여소남" className="h-6 object-contain" />
          <span className="text-blue-200 text-[10px]">여소남 ✈️</span>
        </div>
        <h1 className="text-lg sm:text-xl font-extrabold leading-tight mb-3">{pkg.title}</h1>
        <div className="flex flex-wrap gap-1 mb-3">
          {pkg.destination && <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px]">{pkg.destination}</span>}
          {airlineName && <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px]">{airlineName}</span>}
          {pkg.duration && <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px]">{pkg.duration}일</span>}
          {pkg.min_participants && <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px]">최소 {pkg.min_participants}명</span>}
          {pkg.product_type && <span className="px-1.5 py-0.5 bg-amber-400/30 rounded text-[10px] font-bold">{pkg.product_type}</span>}
        </div>
        {displayPrice && displayPrice < Infinity && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-black">₩{displayPrice.toLocaleString()}</span>
            <span className="text-blue-200 text-xs">{selectedTier ? '' : '~'} / 1인</span>
          </div>
        )}
        {pkg.ticketing_deadline && <p className="text-red-300 text-[10px] mt-1.5 font-bold">⏰ {pkg.ticketing_deadline}까지 발권</p>}
      </div>

      {/* ═══ 핵심 특전 ═══ */}
      {pkg.product_highlights && pkg.product_highlights.length > 0 && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
          <p className="text-[10px] font-bold text-amber-700 mb-1.5">★ 핵심 특전</p>
          <div className="flex flex-wrap gap-1">
            {pkg.product_highlights.map((h, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-white border border-amber-200 rounded text-[10px] font-medium text-amber-800">{h}</span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 상단 네비바 (스크롤 추적) ═══ */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex">
          {NAV_SECTIONS.map(section => (
            <button key={section} onClick={() => scrollToSection(section)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                activeSection === section ? 'text-[#001f3f] border-b-2 border-[#001f3f]' : 'text-gray-400'
              }`}>{section}</button>
          ))}
        </div>
      </div>

      {/* ═══ 요금표 (날짜 선택) ═══ */}
      {tiers.length > 0 && (
        <div ref={el => { sectionRefs.current['요금표'] = el; }} data-section="요금표" className="px-4 py-4 border-b border-gray-100 scroll-mt-12">
          <h2 className="text-sm font-bold text-gray-900 mb-3">📋 출발일 선택</h2>
          <div className="space-y-1.5">
            {tiers.map((t, i) => {
              const isSelected = selectedTier === t;
              const isMin = t.adult_price === minPrice;
              return (
                <button key={i} onClick={() => { setSelectedTier(isSelected ? null : t); setFormData(f => ({ ...f, date: isSelected ? '' : `${t.period_label} ${t.departure_day_of_week || ''}`.trim() })); }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition ${
                    isSelected ? 'border-[#001f3f] bg-[#001f3f]/5 ring-1 ring-[#001f3f]' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-[#001f3f]' : 'border-gray-300'}`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-[#001f3f]" />}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-800">{t.period_label}</p>
                      {t.departure_day_of_week && <p className="text-[10px] text-gray-400">{t.departure_day_of_week}요일</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${isMin ? 'text-red-600' : 'text-gray-900'}`}>₩{t.adult_price?.toLocaleString()}</p>
                    {isMin && <span className="text-[9px] bg-red-100 text-red-600 px-1 py-0.5 rounded">최저가</span>}
                    {t.note && <p className="text-[9px] text-blue-600">{t.note}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ 선택관광 ═══ */}
      {pkg.optional_tours && pkg.optional_tours.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-xs font-bold text-gray-900 mb-2">🎯 선택 관광</h2>
          <div className="flex flex-wrap gap-1">
            {pkg.optional_tours.map((t, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-pink-50 text-pink-700 border border-pink-200 rounded text-[10px] font-medium">
                {t.name}{t.price_usd ? ` ($${t.price_usd})` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 포함/불포함 ═══ */}
      {(pkg.inclusions?.length || pkg.excludes?.length) ? (
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="grid grid-cols-2 gap-2">
            {pkg.inclusions && pkg.inclusions.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-2.5">
                <h3 className="text-[10px] font-bold text-blue-900 mb-1.5">포함 사항</h3>
                <ul className="space-y-0.5">
                  {pkg.inclusions.map((item, i) => (
                    <li key={i} className="text-[10px] text-blue-800 flex gap-1"><span className="shrink-0">✅</span>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {pkg.excludes && pkg.excludes.length > 0 && (
              <div className="bg-red-50 rounded-lg p-2.5">
                <h3 className="text-[10px] font-bold text-red-900 mb-1.5">불포함 사항</h3>
                <ul className="space-y-0.5">
                  {pkg.excludes.map((item, i) => (
                    <li key={i} className="text-[10px] text-red-800 flex gap-1"><span className="shrink-0">❌</span>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ═══ 일정표 (아코디언) ═══ */}
      {days.length > 0 && (
        <div ref={el => { sectionRefs.current['일정표'] = el; }} data-section="일정표" className="px-4 py-4 border-b border-gray-100 scroll-mt-12">
          <h2 className="text-sm font-bold text-gray-900 mb-3">🗓 여행 일정</h2>
          <div className="space-y-2">
            {days.map(day => {
              const isExpanded = expandedDays.has(day.day);
              const flights = day.schedule?.filter(s => s.type === 'flight') || [];
              const depFlight = flights.find(f => /출발|향발/.test(f.activity));
              const arrFlight = flights.find(f => /도착/.test(f.activity));
              const flightNo = depFlight?.transport || arrFlight?.transport || '';
              const aName = getAirlineName(flightNo);

              return (
                <div key={day.day} className="border border-gray-100 rounded-xl overflow-hidden">
                  {/* 일차 헤더 (클릭 → 펼치기/접기) */}
                  <button onClick={() => toggleDay(day.day)}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black text-[#005d90]">{String(day.day).padStart(2, '0')}</span>
                      <div className="text-left">
                        <p className="text-xs font-bold text-gray-800">{day.regions?.join(' → ') || `${day.day}일차`}</p>
                        {flights.length > 0 && (
                          <p className="text-[10px] text-blue-600">✈️ {flightNo} {aName ? `(${aName})` : ''} {depFlight?.time && arrFlight?.time ? `${depFlight.time}→${arrFlight.time}` : ''}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {/* 일정 상세 (아코디언) */}
                  {isExpanded && (
                    <>
                      <div className="px-3 py-2.5 space-y-1.5">
                        {day.schedule?.filter(s => s.type !== 'flight').map((item, sIdx) => {
                          const attr = attractions.find(a => a.name.length >= 4 && item.activity.includes(a.name));
                          return (
                            <div key={sIdx} className="flex items-start gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                                item.type === 'golf' ? 'bg-green-500' : item.type === 'optional' ? 'bg-pink-500' :
                                item.type === 'shopping' ? 'bg-purple-500' : attr ? 'bg-blue-500' : 'bg-gray-300'
                              }`} />
                              <div className="min-w-0">
                                <p className="text-[11px] text-gray-800 leading-relaxed break-keep">
                                  {item.time && <span className="text-blue-600 font-bold mr-1">{item.time}</span>}
                                  {attr?.emoji && <span className="mr-0.5">{attr.emoji}</span>}
                                  <span className={attr ? 'font-bold text-blue-900' : ''}>{item.activity}</span>
                                </p>
                                {attr?.short_desc && <p className="text-[9px] text-gray-500 mt-0.5">— {attr.short_desc}</p>}
                                {item.note && <p className="text-[9px] text-red-500 mt-0.5">{item.note}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="bg-gray-50 px-3 py-1.5 flex items-center justify-between text-[9px] text-gray-500">
                        <span>🏨 {day.hotel?.name || '일정 종료'}{day.hotel?.grade ? ` (${day.hotel.grade})` : ''}</span>
                        <span>
                          ☕{day.meals?.breakfast_note || (day.meals?.breakfast ? '호텔식' : '불포함')} |
                          🍜{day.meals?.lunch_note || (day.meals?.lunch ? '현지식' : '불포함')} |
                          🍽️{day.meals?.dinner_note || (day.meals?.dinner ? '현지식' : '불포함')}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ 유의사항 4-Type ═══ */}
      <div ref={el => { sectionRefs.current['유의사항'] = el; }} data-section="유의사항" className="scroll-mt-12">
        {(() => {
          const NOTICE_STYLES: Record<string, { bg: string; border: string; title: string; dot: string }> = {
            CRITICAL: { bg: 'bg-red-50', border: 'border-red-200', title: 'text-red-800', dot: '🔴' },
            PAYMENT: { bg: 'bg-orange-50', border: 'border-orange-200', title: 'text-orange-800', dot: '🟠' },
            POLICY: { bg: 'bg-blue-50', border: 'border-blue-200', title: 'text-blue-800', dot: '🔵' },
            INFO: { bg: 'bg-slate-50', border: 'border-slate-200', title: 'text-slate-700', dot: '⚪' },
          };
          const typedNotices = (pkg.notices_parsed || []).filter(
            (n): n is { type: string; title: string; text: string } => typeof n === 'object' && n !== null && 'type' in n
          );
          if (typedNotices.length === 0 && !pkg.special_notes) return null;
          return (
            <div className="px-4 py-4">
              <h2 className="text-xs font-bold text-gray-900 mb-2">⚠️ 유의사항</h2>
              {typedNotices.length > 0 ? (
                <div className="space-y-1.5">
                  {typedNotices.map((notice, idx) => {
                    const style = NOTICE_STYLES[notice.type] || NOTICE_STYLES.INFO;
                    const lines = (notice.text || '').split('\n').map(l => l.trim()).filter(Boolean);
                    return (
                      <div key={idx} className={`${style.bg} border ${style.border} rounded-lg p-2.5`}>
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-[10px]">{style.dot}</span>
                          <span className={`text-[10px] font-bold ${style.title}`}>{notice.title}</span>
                        </div>
                        <div className="space-y-0.5">
                          {lines.map((line, lIdx) => (
                            <p key={lIdx} className="text-[10px] text-gray-600 leading-relaxed break-keep">
                              {line.startsWith('•') ? line : `• ${line}`}
                            </p>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[8px] text-gray-400 italic mt-1">※ 공통 규정은 별도 [예약 안내문]을 확인하시기 바랍니다.</p>
                </div>
              ) : pkg.special_notes ? (
                <p className="text-[10px] text-gray-600 leading-relaxed whitespace-pre-line">{pkg.special_notes}</p>
              ) : null}
            </div>
          );
        })()}
      </div>

      {/* ═══ 하단 플로팅 바 ═══ */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 shadow-lg">
        <div className="max-w-lg mx-auto px-4 py-2.5 flex items-center justify-between">
          <div>
            {displayPrice && displayPrice < Infinity && (
              <>
                <p className="text-[9px] text-gray-400">{selectedTier ? `${selectedTier.period_label} ${selectedTier.departure_day_of_week || ''}` : '1인 기준'}</p>
                <p className="text-base font-black text-[#001f3f]">₩{displayPrice.toLocaleString()}{selectedTier ? '' : '~'}</p>
              </>
            )}
          </div>
          <button onClick={() => setShowForm(true)}
            className="px-5 py-2.5 bg-[#001f3f] text-white font-bold rounded-xl text-sm hover:bg-[#003366] transition">
            예약 문의하기
          </button>
        </div>
      </div>

      {/* ═══ 예약 문의 폼 (바텀시트) ═══ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowForm(false)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5" onClick={e => e.stopPropagation()}>
            {submitted ? (
              <div className="text-center py-6">
                <p className="text-2xl mb-2">✅</p>
                <p className="font-bold text-gray-900">문의가 접수되었습니다!</p>
                <p className="text-xs text-gray-500 mt-1">빠른 시간 내에 연락드리겠습니다.</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-base font-bold text-gray-900">예약 문의</h3>
                  <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">×</button>
                </div>
                <div className="bg-blue-50 rounded-lg p-2.5 mb-3 text-[11px] text-blue-800">
                  <p className="font-bold">{pkg.title}</p>
                  {selectedTier ? (
                    <p>📅 {selectedTier.period_label} {selectedTier.departure_day_of_week || ''} — ₩{selectedTier.adult_price?.toLocaleString()}</p>
                  ) : displayPrice && displayPrice < Infinity ? (
                    <p>₩{displayPrice.toLocaleString()}~ / 1인</p>
                  ) : null}
                </div>
                <div className="space-y-2.5">
                  <input placeholder="이름 *" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input placeholder="연락처 *" value={formData.phone} onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {!selectedTier && (
                    <input placeholder="희망 출발일" value={formData.date} onChange={e => setFormData(f => ({ ...f, date: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  )}
                  <textarea placeholder="요청사항 (선택)" value={formData.message} onChange={e => setFormData(f => ({ ...f, message: e.target.value }))}
                    rows={2} className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  <button onClick={handleSubmit} disabled={!formData.name || !formData.phone}
                    className="w-full py-2.5 bg-[#001f3f] text-white font-bold rounded-xl text-sm disabled:opacity-50">
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
