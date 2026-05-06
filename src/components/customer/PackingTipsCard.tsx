/**
 * 짐 꾸리기 팁 카드 — 출발월 기후 + destination 특성으로 자동 생성
 *
 * 입력: monthly_normals (해당 월) + country + lat (자외선 강도) + duration (옷 수량)
 * 출력: 카테고리별 칩 (옷차림 / 비 대비 / 자외선·미용 / 필수)
 *
 * LLM 없음 — 100% 결정론적 규칙. 매 패키지마다 자동.
 */
'use client';

import { useState } from 'react';
import type { MonthlyNormal } from '@/lib/travel-fitness-score';

interface Props {
  monthlyNormal: MonthlyNormal;            // 출발월의 normals
  country: string | null;
  lat: number;                              // 자외선 강도 산출용
  durationDays?: number;                    // 옷 수량 산출 (없으면 4박5일 기준)
  monthLabel: string;                       // "7월"
  cityLabel: string;                        // "호화호특"
}

interface PackingItem {
  emoji: string;
  text: string;
  /** 강조: '필수' 빨강 / '권장' 보라 / null 회색 */
  level?: 'must' | 'recommend' | null;
}

interface PackingCategory {
  title: string;
  icon: string;
  items: PackingItem[];
}

// ─── 카테고리별 자동 생성 함수 ───────────────────────────────────

function clothing(temp: number, days: number): PackingItem[] {
  // days = 여행 일수. 옷 갯수는 "여행일수 - 1" 정도가 일반적 (마지막 날 입고 옴)
  const tops = Math.max(2, days - 1);

  if (temp <= 5) return [
    { emoji: '🧥', text: '패딩 + 두꺼운 코트', level: 'must' },
    { emoji: '🧣', text: '목도리 · 장갑 · 비니', level: 'must' },
    { emoji: '👕', text: `긴팔 이너 ${tops}장 + 두꺼운 양말`, level: 'must' },
    { emoji: '🥾', text: '방한 부츠 (눈길 미끄럼 주의)', level: 'must' },
  ];
  if (temp <= 12) return [
    { emoji: '🧥', text: '두꺼운 코트 또는 점퍼', level: 'must' },
    { emoji: '🧶', text: `니트 ${Math.max(2, days - 2)}장 · 머플러`, level: 'recommend' },
    { emoji: '👕', text: `긴팔 ${tops}장 · 두꺼운 양말`, level: 'must' },
  ];
  if (temp <= 17) return [
    { emoji: '🧥', text: '가디건 · 가벼운 자켓', level: 'must' },
    { emoji: '👕', text: `긴팔 셔츠 ${tops}장 · 얇은 니트`, level: 'recommend' },
  ];
  if (temp <= 22) return [
    { emoji: '👕', text: `긴팔 ${tops}장 (낮용)`, level: 'must' },
    { emoji: '🧥', text: '얇은 가디건 (저녁용)', level: 'recommend' },
  ];
  if (temp <= 27) return [
    { emoji: '👕', text: `반팔 ${tops}장`, level: 'must' },
    { emoji: '🧥', text: '얇은 겉옷 (실내 냉방 대비)', level: 'recommend' },
  ];
  if (temp <= 32) return [
    { emoji: '👕', text: `반팔·민소매 ${tops}장`, level: 'must' },
    { emoji: '🩳', text: '반바지 · 통풍 잘되는 소재', level: 'must' },
    { emoji: '🩴', text: '샌들 · 슬리퍼', level: 'recommend' },
  ];
  return [
    { emoji: '👕', text: `통풍 잘되는 반팔 ${tops + 1}장 (땀 대비)`, level: 'must' },
    { emoji: '🩳', text: '반바지 · 린넨 소재', level: 'must' },
    { emoji: '🧢', text: '챙 넓은 모자 · 휴대용 선풍기', level: 'must' },
  ];
}

function rainGear(rainDays: number, rainMm: number): PackingItem[] {
  if (rainDays <= 2) return []; // 비 거의 없음 → 칩 없음
  if (rainDays <= 5) return [
    { emoji: '☂️', text: '접이식 우산 (간헐적 소나기)', level: 'recommend' },
  ];
  if (rainDays <= 9) return [
    { emoji: '☂️', text: '접이식 우산 (한 달 1/3 비)', level: 'must' },
    { emoji: '🎒', text: '방수 가방 또는 커버', level: 'recommend' },
  ];
  if (rainDays <= 15) return [
    { emoji: '☂️', text: '튼튼한 우산 + 우비', level: 'must' },
    { emoji: '👟', text: '방수 신발 또는 갈아신을 신발', level: 'must' },
    { emoji: '🎒', text: '방수 가방 · 비닐 봉투 여분', level: 'recommend' },
  ];
  return [
    { emoji: '🌧️', text: '우비 + 우산 + 방수 신발 (우기)', level: 'must' },
    { emoji: '👕', text: '갈아입을 옷 여분 (젖음 대비)', level: 'must' },
    { emoji: '🎒', text: '방수 백 · 비닐 봉투 다수', level: 'must' },
  ];
}

function uvCare(lat: number, month: number, tempMax: number): PackingItem[] {
  const absLat = Math.abs(lat);
  // 적도 근처 (위도 < 25): 1년 내내 자외선 매우 강함
  if (absLat < 25) return [
    { emoji: '🧴', text: '선크림 SPF 50+ · 2-3시간마다 덧바름', level: 'must' },
    { emoji: '🕶️', text: '선글라스 (UV 차단)', level: 'must' },
    { emoji: '🧢', text: '챙 넓은 모자', level: 'recommend' },
  ];
  // 중위도 (25-45): 4-9월 강한 자외선
  if (absLat < 45) {
    if (month >= 4 && month <= 9 && tempMax >= 22) return [
      { emoji: '🧴', text: '선크림 SPF 30~50', level: 'must' },
      { emoji: '🕶️', text: '선글라스', level: 'recommend' },
    ];
    return [];
  }
  // 고위도 (45+): 자외선 약함, 겨울엔 거의 무시
  if (month >= 5 && month <= 8) return [
    { emoji: '🧴', text: '가벼운 선크림 (여름에만)', level: 'recommend' },
  ];
  return [];
}

function comfortItems(temp: number, humidity: number): PackingItem[] {
  const items: PackingItem[] = [];
  // 고온 + 고습 = 더위·땀 대비
  if (temp >= 28 && humidity >= 70) {
    items.push({ emoji: '💨', text: '휴대용 선풍기 · 손수건', level: 'recommend' });
    items.push({ emoji: '💧', text: '물병 (상시 수분 보충)', level: 'must' });
  }
  // 고습 단독
  else if (humidity >= 75) {
    items.push({ emoji: '💨', text: '드라이어 (호텔 비치 약할 수 있음)', level: 'recommend' });
  }
  // 건조
  if (humidity <= 45) {
    items.push({ emoji: '💄', text: '보습 크림 · 립밤 (건조 주의)', level: 'recommend' });
  }
  // 추위
  if (temp <= 10) {
    items.push({ emoji: '🤲', text: '핫팩 (실외 활동 시)', level: 'recommend' });
  }
  return items;
}

function essentials(country: string | null): PackingItem[] {
  const items: PackingItem[] = [
    { emoji: '🛂', text: '여권 (유효기간 6개월 이상)', level: 'must' },
    { emoji: '💳', text: '환전 + 신용카드 1장', level: 'must' },
    { emoji: '🔌', text: '멀티 어댑터 · 보조배터리', level: 'recommend' },
  ];
  // country별 비자/특이사항 — 향후 확장 가능
  if (country === '중국') {
    items.push({ emoji: '📱', text: 'VPN 앱 (구글·카톡 차단 대비)', level: 'recommend' });
  }
  if (country === '베트남' || country === '필리핀' || country === '태국' || country === '라오스' || country === '인도네시아') {
    items.push({ emoji: '💊', text: '지사제 · 모기약', level: 'recommend' });
  }
  return items;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────

export default function PackingTipsCard({ monthlyNormal, country, lat, durationDays = 5, monthLabel, cityLabel }: Props) {
  const [open, setOpen] = useState(false); // 기본 접힌 상태 (사장님 피드백 2026-04-29)

  const m = monthlyNormal;
  const categories: PackingCategory[] = [
    { title: '옷차림', icon: '👕', items: clothing(m.temp_mean, durationDays) },
    { title: '비 대비', icon: '☔', items: rainGear(m.rain_days, m.rain_mm) },
    { title: '자외선·미용', icon: '🧴', items: [...uvCare(lat, m.month, m.temp_max), ...comfortItems(m.temp_mean, m.humidity)] },
    { title: '필수 준비물', icon: '🎒', items: essentials(country) },
  ].filter(c => c.items.length > 0);

  // 한 줄 요약 (대표 핵심 3개) — must 우선 추출
  const oneLineSummary = categories
    .flatMap(c => c.items)
    .filter(i => i.level === 'must')
    .slice(0, 3)
    .map(i => i.text.split(/[·,(]/)[0].trim())
    .join(' + ');

  return (
    <section className="px-4 mt-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* 토글 헤더 — 닫혔을 때는 한 줄 요약만 보이고 클릭 시 펼침 */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-slate-50/50 transition"
          aria-expanded={open}
        >
          <span className="text-xl flex-shrink-0">🎒</span>
          <div className="flex-1 min-w-0">
            <p className="text-body font-extrabold text-slate-900 truncate">
              짐 꾸리기 팁 ({monthLabel} 출발 · {durationDays}일)
            </p>
            {oneLineSummary && (
              <p className="text-[11.5px] text-slate-500 mt-0.5 truncate break-keep">
                💡 {oneLineSummary} — 꼭 챙기세요
              </p>
            )}
          </div>
          <span className={`text-slate-400 text-sm flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </button>

        {/* 펼친 상태 */}
        {open && (
          <>
            <div className="px-5 pb-4 space-y-3 border-t border-slate-100">
              {categories.map((cat, i) => (
                <div key={i} className="pt-3 border-t border-slate-50 first:border-t-0">
                  <p className="text-[11px] font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                    <span className="text-base">{cat.icon}</span>
                    <span>{cat.title}</span>
                  </p>
                  <ul className="space-y-1.5">
                    {cat.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-2 break-keep">
                        <span className="text-base flex-shrink-0 leading-tight">{item.emoji}</span>
                        <span className={`text-[12.5px] leading-snug flex-1 ${
                          item.level === 'must' ? 'text-slate-900 font-semibold' :
                          item.level === 'recommend' ? 'text-slate-700' :
                          'text-slate-500'
                        }`}>
                          {item.text}
                          {item.level === 'must' && (
                            <span className="ml-1.5 text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">필수</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 px-5 pb-3 border-t border-slate-50 pt-2">
              ※ {cityLabel} {monthLabel} 평균 기후·위도·여행 일수 기반 자동 생성. 개인 차이가 있을 수 있어요.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
