/**
 * A4 포스터 레이아웃 빌딩 블록
 * 정형화된 하나투어/모두투어 스타일 클래식 테이블 형식
 * - print/page.tsx (서버 컴포넌트) + ItineraryTableView.tsx (클라이언트) 공유
 * - 사진 없음, 텍스트+테이블만, JPG 캡처 최적화
 * - 5열 테이블: 일자 | 지역 | 교통편 | 주요일정 | 식사
 */
import React from 'react';
import type { TravelItinerary, DaySchedule, MealInfo, ItineraryHighlights } from '@/types/itinerary';
import type { PriceListItem } from '@/lib/parser';
import { filterTiersByDepartureDays } from '@/lib/expand-date-range';

/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */

export interface PriceTier {
  departure_day?: string;
  departure_dates?: string[] | null;
  departure_day_of_week?: string;
  period_label?: string;
  date_range?: { start: string; end: string } | null;
  adult_price: number;
  status: string;
  note?: string | null;
}

/* ═══════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════ */

const NAVY = '#1a3764';
const BORDER = '#c8cdd3';
const BORDER_LIGHT = '#e5e7eb';
const ROW_EVEN = '#ffffff';
const ROW_ODD = '#f8fafb';
const ROW_HEIGHT = 21;
const TABLE_HDR_H = 26;
const A4_USABLE_H = 1055; // 1123px - 34px*2 padding

/* ═══════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════ */

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export function formatKoDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}(${DAYS_KO[d.getDay()]})`;
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} style={{ fontWeight: 700 }}>{part}</strong> : part
  );
}

/* ═══════════════════════════════════════════════════════
   Height Estimation & Page Splitting
   ═══════════════════════════════════════════════════════ */

function dayRowCount(day: DaySchedule): number {
  return day.schedule.length + (day.hotel ? 1 : 0);
}

export function estimateHeights(
  itinerary: TravelItinerary,
  tierCount: number,
  priceListRowCount: number,
) {
  const { meta, highlights } = itinerary;

  // Header
  let headerH = 68;

  // Price block
  let priceH = 8;
  if (meta.ticketing_deadline) priceH += 24;
  if (meta.hashtags?.length > 0) priceH += 22;
  priceH += 18; // title
  const effectiveTierCount = priceListRowCount > 0 ? priceListRowCount : tierCount;
  if (effectiveTierCount <= 1) {
    priceH += 52; // Mode A: single box
  } else {
    priceH += 24 + effectiveTierCount * 21; // header + rows
  }

  // Info block
  let infoH = 8;
  // 포함/불포함 각 1줄 + 비고 N줄
  infoH += 20; // 포함사항 row
  infoH += 20; // 불포함사항 row
  if (highlights.remarks?.length > 0) {
    infoH += 16 + Math.min(highlights.remarks.length, 8) * 13;
  }
  infoH += 8; // bottom gap

  const footerH = 22;

  return { headerH, priceH, infoH, footerH };
}

/** 페이지 1에 들어갈 일차 수 계산 */
export function calcPage1DayCount(
  days: DaySchedule[],
  headerH: number,
  priceH: number,
  infoH: number,
  footerH: number,
): number {
  const avail = A4_USABLE_H - headerH - priceH - infoH - TABLE_HDR_H - footerH - 4;
  let used = 0;
  let count = 0;

  for (const day of days) {
    const h = dayRowCount(day) * ROW_HEIGHT + 3; // +3 separator
    if (used + h <= avail || count === 0) {
      // count === 0: 최소 1일은 page 1에 반드시 포함
      used += h;
      count++;
    } else break;
  }
  return count;
}

/* ═══════════════════════════════════════════════════════
   PosterHeader
   ═══════════════════════════════════════════════════════ */

export function PosterHeader({ meta }: { meta: TravelItinerary['meta'] }) {
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            background: NAVY, color: '#fff', fontSize: '11px', fontWeight: 800,
            padding: '3px 10px', borderRadius: '3px', letterSpacing: '0.5px',
          }}>
            여소남
          </div>
          <span style={{ color: '#9ca3af', fontSize: '9.5px' }}>가치있는 여행을 소개하는</span>
        </div>
        {meta.departure_airport && (
          <span style={{ color: '#6b7280', fontSize: '9.5px' }}>
            {meta.airline ? `✈ ${meta.airline} · ` : ''}{meta.departure_airport} 출발
          </span>
        )}
      </div>
      <div style={{ borderBottom: `3px solid ${NAVY}`, paddingBottom: '5px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '19px', fontWeight: 900, color: '#111827', margin: 0, lineHeight: 1.3 }}>
            {meta.title}
          </h1>
          {meta.product_type && (
            <span style={{
              fontSize: '10px', fontWeight: 700, color: NAVY,
              border: `1.5px solid ${NAVY}`, padding: '1px 6px', borderRadius: '3px',
            }}>
              {meta.product_type}
            </span>
          )}
        </div>
        <p style={{ fontSize: '10px', color: '#6b7280', margin: '2px 0 0' }}>
          {[
            meta.airline,
            meta.flight_out && meta.flight_in ? `${meta.flight_out}/${meta.flight_in}` : null,
            `최소 ${meta.min_participants}명`,
            meta.room_type,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PosterPrice
   ═══════════════════════════════════════════════════════ */

export function PosterPrice({
  meta,
  priceTiers,
  priceList,
  highlightDate,
  excludedDates = [],
  singleSupplement,
  guideTip,
}: {
  meta: TravelItinerary['meta'];
  priceTiers?: PriceTier[];
  priceList?: PriceListItem[];
  highlightDate?: string | null;
  excludedDates?: string[];
  singleSupplement?: string | null;
  guideTip?: string | null;
}) {
  const tiers = filterTiersByDepartureDays(priceTiers ?? [] as any, meta.departure_days || undefined) as PriceTier[];
  const highlightDay = highlightDate ? new Date(highlightDate).getDate().toString() : null;

  // 요금 데이터 없으면 표시 안함
  if (tiers.length === 0 && (!priceList || priceList.length === 0)) {
    return null;
  }

  const usePriceList = priceList && priceList.length > 0;
  const allPrices = usePriceList
    ? priceList!.flatMap(p => p.rules.map(r => r.price).filter((v): v is number => v !== null))
    : tiers.map(t => t.adult_price);
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
  const isSinglePrice = tiers.length <= 1 && (!usePriceList || (priceList!.length === 1 && priceList![0].rules.length <= 1));

  const thS: React.CSSProperties = {
    background: NAVY, color: '#fff', padding: '5px 8px', fontSize: '10px',
    fontWeight: 700, textAlign: 'center', border: `1px solid ${NAVY}`,
  };
  const tdS: React.CSSProperties = {
    border: `1px solid ${BORDER}`, padding: '4px 8px', fontSize: '10px',
  };

  return (
    <div style={{ marginBottom: '6px' }}>
      {/* 발권 배너 */}
      {meta.ticketing_deadline && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '3px',
          padding: '3px 8px', marginBottom: '4px', fontSize: '9.5px', color: '#b91c1c', fontWeight: 600,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {meta.departure_days && <span>📢 {meta.departure_days}</span>}
          <span>● {meta.ticketing_deadline} 항공권 발권조건</span>
        </div>
      )}

      {/* 해시태그 */}
      {meta.hashtags?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '4px' }}>
          {meta.hashtags.map((tag, i) => (
            <span key={i} style={{
              fontSize: '8.5px', color: NAVY, fontWeight: 600,
              background: '#eef2ff', padding: '1.5px 5px', borderRadius: '6px',
            }}>{tag}</span>
          ))}
        </div>
      )}

      {/* 출발확정일 섹션 — price_tiers에서 status==='confirmed' 추출 */}
      {(() => {
        const confirmedDates = tiers
          .filter(t => t.status === 'confirmed')
          .flatMap(t => t.departure_dates ?? [])
          .filter(Boolean);
        if (confirmedDates.length === 0) return null;
        // 월별 그룹핑
        const byMonth: Record<string, number[]> = {};
        for (const d of confirmedDates) {
          const dt = new Date(d);
          const m = `${dt.getMonth() + 1}월`;
          if (!byMonth[m]) byMonth[m] = [];
          const day = dt.getDate();
          if (!byMonth[m].includes(day)) byMonth[m].push(day);
        }
        for (const m of Object.keys(byMonth)) byMonth[m].sort((a, b) => a - b);
        return (
          <div style={{
            background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '3px',
            padding: '3px 8px', marginBottom: '4px', fontSize: '9.5px', color: '#166534', fontWeight: 600,
          }}>
            🟢 출발확정 (바로 예약 가능)&nbsp;&nbsp;
            {Object.entries(byMonth).map(([m, days], i) => (
              <span key={m}>{i > 0 ? ' | ' : ''}{m}: {days.join(', ')}일</span>
            ))}
          </div>
        );
      })()}

      {/* 섹션 타이틀 */}
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ width: '3px', height: '12px', background: NAVY, borderRadius: '1px', display: 'inline-block', flexShrink: 0 }} />
        출발일별 요금 ({meta.nights}박{meta.days}일)
      </div>

      {/* Mode A: 단일 출발일 */}
      {isSinglePrice ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <thead>
            <tr>
              <th style={{ ...thS, width: '50%' }}>출발일</th>
              <th style={thS}>상품가</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdS, textAlign: 'center', fontSize: '15px', fontWeight: 700 }}>
                {tiers[0]?.period_label || priceList?.[0]?.period || '전 출발일'}
              </td>
              <td style={{ ...tdS, textAlign: 'center', fontSize: '18px', fontWeight: 900, color: '#1e40af' }}>
                {minPrice ? `${minPrice.toLocaleString('ko-KR')}원` : '별도문의'}
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        /* Mode B: 기간별 요금 테이블 */
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <thead>
            <tr>
              <th style={thS}>출발 기간</th>
              <th style={{ ...thS, width: '110px' }}>1인 판매가</th>
            </tr>
          </thead>
          <tbody>
            {usePriceList
              ? priceList!.flatMap((item, pi) =>
                  item.rules.map((rule, ri) => {
                    const isMin = rule.price !== null && rule.price === minPrice;
                    const bg = isMin ? '#fff1f2' : (pi + ri) % 2 === 0 ? ROW_EVEN : ROW_ODD;
                    const label = rule.condition && rule.condition !== '전 출발일'
                      ? `${item.period} ${rule.condition}`
                      : item.period;
                    return (
                      <tr key={`${pi}-${ri}`} style={{ background: bg }}>
                        <td style={tdS}>{label}</td>
                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>
                          {isMin && <span style={{ color: '#dc2626', fontSize: '8px', marginRight: '3px' }}>🔥최저가</span>}
                          <span style={{ color: isMin ? '#dc2626' : '#111' }}>{rule.price_text}</span>
                        </td>
                      </tr>
                    );
                  })
                )
              : tiers.map((tier, i) => {
                  const isMin = tier.adult_price === minPrice;
                  const isConfirmed = tier.status === 'confirmed';
                  const isSoldout = tier.status === 'soldout';
                  const isHighlighted = !!(highlightDay && (tier.departure_dates ?? []).includes(highlightDay));
                  const bg = isHighlighted ? '#fef9c3' : isSoldout ? '#fef2f2' : isMin ? '#fff1f2' : i % 2 === 0 ? ROW_EVEN : ROW_ODD;
                  const label = tier.period_label
                    ?? ((tier.departure_dates ?? []).join(', ') + '일');
                  const dayLabel = tier.departure_day_of_week ?? tier.departure_day ?? '';
                  return (
                    <tr key={i} style={{ background: bg }}>
                      <td style={tdS}>
                        {label}{dayLabel ? ` ${dayLabel}` : ''}
                        {isConfirmed && <span style={{ background: '#dcfce7', color: '#166534', fontSize: '8px', padding: '1px 3px', borderRadius: '2px', marginLeft: '4px', fontWeight: 600 }}>확정</span>}
                        {isSoldout && <span style={{ background: '#fee2e2', color: '#b91c1c', fontSize: '8px', padding: '1px 3px', borderRadius: '2px', marginLeft: '4px', fontWeight: 600 }}>마감</span>}
                        {isHighlighted && <span style={{ color: '#1e40af', marginLeft: '4px' }}>◀</span>}
                      </td>
                      <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>
                        {isMin && !isSoldout && <span style={{ color: '#dc2626', fontSize: '8px', marginRight: '3px' }}>🔥최저가</span>}
                        <span style={{ color: isSoldout ? '#9ca3af' : isMin ? '#dc2626' : '#111', textDecoration: isSoldout ? 'line-through' : 'none' }}>
                          {tier.adult_price.toLocaleString('ko-KR')}원
                        </span>
                      </td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      )}

      {/* 항공 제외일 */}
      {excludedDates.length > 0 && (
        <div style={{ fontSize: '9px', color: '#dc2626', marginBottom: '2px' }}>
          ✈ 항공 제외일: {excludedDates.map(d => {
            const dt = new Date(d);
            return `${dt.getMonth() + 1}/${dt.getDate()}`;
          }).join(', ')} — 해당 날짜 출발 불가
        </div>
      )}

      {/* 싱글차지 / 가이드팁 */}
      {(singleSupplement || guideTip) && (
        <div style={{ fontSize: '9px', color: '#4b5563', marginTop: '2px' }}>
          {singleSupplement && <span>※ 싱글차지: {singleSupplement}</span>}
          {singleSupplement && guideTip && <span> / </span>}
          {guideTip && <span>※ 가이드/기사경비: {guideTip}</span>}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PosterInfo (포함/불포함/비고 — 콤팩트)
   ═══════════════════════════════════════════════════════ */

export function PosterInfo({ highlights }: { highlights: ItineraryHighlights }) {
  const labelS: React.CSSProperties = {
    fontSize: '9.5px', fontWeight: 700, padding: '3px 6px', whiteSpace: 'nowrap',
    width: '58px', textAlign: 'center', background: '#f3f4f6', color: '#1f2937',
    verticalAlign: 'top', border: `1px solid ${BORDER}`,
  };
  const valS: React.CSSProperties = {
    fontSize: '9.5px', lineHeight: '1.5', color: '#374151', padding: '3px 6px',
    verticalAlign: 'top', border: `1px solid ${BORDER}`,
  };

  return (
    <div style={{ marginBottom: '6px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td style={labelS}>포함사항</td>
            <td style={valS}>{highlights.inclusions.map(s => renderBold(s)).reduce((acc: React.ReactNode[], cur, i) => i === 0 ? [cur] : [...acc, ', ', cur], [])}</td>
          </tr>
          <tr>
            <td style={labelS}>불포함사항</td>
            <td style={valS}>
              {highlights.excludes.map(s => renderBold(s)).reduce((acc: React.ReactNode[], cur, i) => i === 0 ? [cur] : [...acc, ', ', cur], [])}
              {highlights.shopping && <span> / 쇼핑: {renderBold(highlights.shopping)}</span>}
            </td>
          </tr>
          {(highlights.remarks?.length ?? 0) > 0 && (
            <tr>
              <td style={labelS}>비 고</td>
              <td style={valS}>
                {highlights.remarks.map((r, i) => (
                  <div key={i} style={{ marginBottom: i < highlights.remarks.length - 1 ? '1px' : 0 }}>
                    * {renderBold(r)}
                  </div>
                ))}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MealCell (식사 칸 렌더러)
   ═══════════════════════════════════════════════════════ */

function MealCell({ meals }: { meals: MealInfo }) {
  const items = [
    { label: '조', ok: meals.breakfast, note: meals.breakfast_note },
    { label: '중', ok: meals.lunch, note: meals.lunch_note },
    { label: '석', ok: meals.dinner, note: meals.dinner_note },
  ];

  return (
    <>
      {items.map(({ label, ok, note }) => {
        if (!ok) {
          return (
            <div key={label} style={{ fontSize: '9px', lineHeight: '1.5', color: '#d1d5db' }}>
              {label}:X
            </div>
          );
        }
        const display = note || (label === '조' ? '호텔식' : '현지식');
        const isSpecial = note && /무제한|특식|삼겹살|랍스터|샤부|제육|불고기|해물|전골|스키야키/.test(note);
        return (
          <div key={label} style={{
            fontSize: '9px', lineHeight: '1.5',
            color: isSpecial ? '#dc2626' : '#374151',
            fontWeight: isSpecial ? 700 : 400,
          }}>
            {label}:{display}
          </div>
        );
      })}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   PosterScheduleTable (5열 일정 테이블)
   ═══════════════════════════════════════════════════════ */

export function PosterScheduleTable({
  days,
  departureDate,
}: {
  days: DaySchedule[];
  departureDate?: string | null;
}) {
  if (days.length === 0) return null;

  const thS: React.CSSProperties = {
    background: NAVY, color: '#fff', padding: '5px 4px', fontSize: '10px',
    fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', border: `1px solid ${NAVY}`,
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', wordBreak: 'keep-all' }}>
      <thead>
        <tr>
          <th style={{ ...thS, minWidth: '36px' }}>일 자</th>
          <th style={{ ...thS, minWidth: '40px' }}>지 역</th>
          <th style={{ ...thS, minWidth: '42px' }}>교통편</th>
          <th style={{ ...thS, textAlign: 'left', paddingLeft: '8px' }}>주 요 일 정</th>
          <th style={{ ...thS, minWidth: '58px' }}>식 사</th>
        </tr>
      </thead>
      <tbody>
        {days.map((day, di) => {
          const items = day.schedule;
          const hasHotel = !!day.hotel;
          const rowCount = items.length + (hasHotel ? 1 : 0);
          const bgColor = di % 2 === 0 ? ROW_EVEN : ROW_ODD;
          const dayBorder = `2px solid ${NAVY}`;
          const resolvedDate = departureDate ? addDays(departureDate, day.day - 1) : null;
          const rows: React.ReactNode[] = [];

          // Schedule item rows
          items.forEach((item, si) => {
            const isFirst = si === 0;
            const isLastItem = si === items.length - 1 && !hasHotel;

            rows.push(
              <tr key={`d${di}-s${si}`} style={{
                background: bgColor, verticalAlign: 'top',
                borderBottom: isLastItem ? dayBorder : undefined,
              }}>
                {/* 일자 */}
                {isFirst && (
                  <td rowSpan={rowCount} style={{
                    padding: '3px 2px', textAlign: 'center', fontWeight: 800,
                    color: NAVY, verticalAlign: 'middle', fontSize: '12px', lineHeight: '1.3',
                    borderRight: `1px solid ${BORDER}`, borderBottom: dayBorder,
                  }}>
                    {day.day}일
                    {resolvedDate && (
                      <div style={{ fontWeight: 400, color: '#6b7280', fontSize: '8.5px', marginTop: '1px' }}>
                        {formatKoDate(resolvedDate)}
                      </div>
                    )}
                  </td>
                )}

                {/* 지역 */}
                {isFirst && (
                  <td rowSpan={rowCount} style={{
                    padding: '3px 3px', textAlign: 'center', fontWeight: 600,
                    color: '#374151', verticalAlign: 'middle', fontSize: '9.5px', lineHeight: '1.4',
                    borderRight: `1px solid ${BORDER}`, borderBottom: dayBorder,
                  }}>
                    {day.regions.map((r, ri) => <div key={ri}>{r}</div>)}
                  </td>
                )}

                {/* 교통편 */}
                <td style={{
                  padding: '2px 3px', textAlign: 'center', color: '#4b5563', fontSize: '9px',
                  borderRight: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
                  borderBottom: isLastItem ? dayBorder : `1px solid ${BORDER_LIGHT}`,
                }}>
                  {item.transport || ''}
                </td>

                {/* 주요일정 */}
                <td style={{
                  padding: '2px 6px',
                  borderRight: `1px solid ${BORDER}`,
                  borderBottom: isLastItem ? dayBorder : `1px solid ${BORDER_LIGHT}`,
                  color: item.type === 'optional' ? '#c2410c'
                       : item.type === 'shopping' ? '#7e22ce'
                       : item.type === 'flight' ? '#1e40af'
                       : '#111827',
                  background: item.type === 'flight' ? '#eff6ff' : undefined,
                }}>
                  {item.time && <span style={{ fontWeight: 700, marginRight: '3px' }}>{item.time}</span>}
                  <span style={{ fontWeight: item.type === 'flight' || item.type === 'shopping' ? 600 : 400 }}>
                    {item.type === 'optional' && <span style={{ fontSize: '8px', marginRight: '2px' }}>[선택]</span>}
                    {item.type === 'shopping' && <span style={{ fontSize: '8px', marginRight: '2px' }}>[쇼핑]</span>}
                    {item.activity}
                  </span>
                  {item.note && (
                    <span style={{ display: 'block', fontSize: '8.5px', color: '#9ca3af', lineHeight: '1.3', marginTop: '1px' }}>
                      {item.note}
                    </span>
                  )}
                </td>

                {/* 식사 */}
                {isFirst && (
                  <td rowSpan={rowCount} style={{
                    padding: '3px 3px', verticalAlign: 'middle', textAlign: 'center',
                    borderBottom: dayBorder,
                  }}>
                    <MealCell meals={day.meals} />
                  </td>
                )}
              </tr>
            );
          });

          // Hotel row
          if (hasHotel && day.hotel) {
            rows.push(
              <tr key={`d${di}-hotel`} style={{ background: bgColor, verticalAlign: 'top', borderBottom: dayBorder }}>
                {/* 교통편 - empty */}
                <td style={{
                  padding: '2px 3px', borderRight: `1px solid ${BORDER}`,
                  borderBottom: dayBorder,
                }} />
                {/* HOTEL */}
                <td style={{
                  padding: '2px 6px', color: '#1e40af', fontWeight: 600, fontSize: '9.5px',
                  borderRight: `1px solid ${BORDER}`, borderBottom: dayBorder,
                  background: '#f0f4ff',
                }}>
                  HOTEL: {day.hotel.name}
                  {day.hotel.grade ? ` (${day.hotel.grade})` : ''}
                  {day.hotel.note ? ` ${day.hotel.note}` : ''}
                </td>
              </tr>
            );
          }

          return <React.Fragment key={`day-${day.day}`}>{rows}</React.Fragment>;
        })}
      </tbody>
    </table>
  );
}

/* ═══════════════════════════════════════════════════════
   PosterFooter
   ═══════════════════════════════════════════════════════ */

export function PosterFooter() {
  return (
    <div style={{
      borderTop: `1px solid ${BORDER}`, paddingTop: '4px', marginTop: 'auto',
      display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#9ca3af',
    }}>
      <span>여소남 — 가치있는 여행을 소개합니다</span>
      <span style={{ color: '#dc2626' }}>
        ※ 상기 일정은 정부 인허가 조건 및 항공사와 현지 사정에 따라 변동될 수 있습니다
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PosterMiniHeader (Page 2용 간소 헤더)
   ═══════════════════════════════════════════════════════ */

export function PosterMiniHeader({ title }: { title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px',
      borderBottom: `2px solid ${NAVY}`, paddingBottom: '4px',
    }}>
      <div style={{
        background: NAVY, color: '#fff', fontSize: '10px', fontWeight: 800,
        padding: '2px 8px', borderRadius: '2px',
      }}>여소남</div>
      <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>{title}</span>
      <span style={{ fontSize: '9px', color: '#9ca3af', marginLeft: 'auto' }}>(계속)</span>
    </div>
  );
}
