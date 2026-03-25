'use client';

import type { TravelItinerary, DaySchedule, MealInfo } from '@/types/itinerary';

// ── 유틸 ──────────────────────────────────────────────────────────────────────

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function formatKoDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}(${DAYS_KO[d.getDay()]})`;
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-bold">{part}</strong> : part
  );
}

// ── 지역 Cross-Day Rowspan 계산 ───────────────────────────────────────────────

type RegionSpanInfo = { show: boolean; rowspan: number };

function computeRegionSpans(
  days: (DaySchedule & { resolvedDate: string | null })[]
): RegionSpanInfo[] {
  const spans: RegionSpanInfo[] = days.map(() => ({ show: true, rowspan: 0 }));
  let i = 0;
  while (i < days.length) {
    if (days[i].regions.length === 1) {
      const region = days[i].regions[0];
      let j = i + 1;
      while (
        j < days.length &&
        days[j].regions.length === 1 &&
        days[j].regions[0] === region
      ) {
        j++;
      }
      const totalRows = days
        .slice(i, j)
        .reduce((sum, d) => sum + d.schedule.length, 0);
      spans[i] = { show: true, rowspan: totalRows };
      for (let k = i + 1; k < j; k++) {
        spans[k] = { show: false, rowspan: 0 };
      }
      i = j;
    } else {
      spans[i] = { show: true, rowspan: days[i].schedule.length };
      i++;
    }
  }
  return spans;
}

// ── 식사 셀 ──────────────────────────────────────────────────────────────────

function MealCell({ meals }: { meals: MealInfo }) {
  const items = [
    { label: '조', included: meals.breakfast, note: meals.breakfast_note },
    { label: '중', included: meals.lunch,     note: meals.lunch_note     },
    { label: '석', included: meals.dinner,    note: meals.dinner_note    },
  ];
  return (
    <>
      {items.map(({ label, included, note }) => {
        if (!included) {
          return (
            <div key={label} style={{ color: '#d1d5db', fontSize: '10px', lineHeight: '1.6' }}>
              {label}: X
            </div>
          );
        }
        const displayNote = note || (label === '조' ? '호텔식' : '현지식');
        const isSpecial =
          note &&
          (note.includes('무제한') || note.includes('특식') ||
           note.includes('삼겹살') || note.includes('랍스터') ||
           note.includes('샤부'));
        return (
          <div
            key={label}
            style={{
              fontSize: '10px',
              lineHeight: '1.6',
              color: isSpecial ? '#ea580c' : '#374151',
              fontWeight: isSpecial ? 'bold' : 'normal',
            }}
          >
            {label}: {displayNote}
          </div>
        );
      })}
    </>
  );
}

// ── 공통 헤더 ─────────────────────────────────────────────────────────────────

function PageHeader({ itinerary, subtitle }: { itinerary: TravelItinerary; subtitle?: string }) {
  const { meta } = itinerary;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="bg-blue-700 text-white text-xs font-bold px-3 py-1 rounded">여소남</div>
          <span className="text-gray-400 text-xs">가치있는 여행을 소개하는</span>
        </div>
        <span className="text-gray-400 text-xs">{meta.departure_airport} 출발</span>
      </div>
      <div className="border-b-2 border-blue-700 pb-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-black text-gray-900">{meta.title}</h1>
          {meta.product_type && (
            <span className="text-sm font-bold text-blue-700 border border-blue-700 px-2 py-0.5 rounded">
              {meta.product_type}
            </span>
          )}
        </div>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

interface Props {
  itinerary: TravelItinerary;
  departureDate?: string | null;
  confirmedPrice?: number | null;
}

export default function ItineraryTableView({ itinerary, departureDate, confirmedPrice }: Props) {
  const { meta, highlights, days, optional_tours } = itinerary;

  const daysWithDates = (days ?? []).map((d, i) => ({
    ...d,
    resolvedDate: departureDate ? addDays(departureDate, i) : null,
  }));

  const regionSpans = computeRegionSpans(daysWithDates);

  return (
    <div
      className="flex flex-col gap-3"
      style={{ fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif" }}
    >
      <PageHeader
        itinerary={itinerary}
        subtitle={
          departureDate && confirmedPrice
            ? `출발일: ${formatKoDate(departureDate)}  |  ₩${confirmedPrice.toLocaleString()}/인  |  ${meta.airline} ${meta.flight_out}`
            : `${meta.airline} ${meta.flight_out}/${meta.flight_in} · 최소 ${meta.min_participants}명`
        }
      />

      {/* 포함/불포함/쇼핑/비고 */}
      <div className="text-xs flex flex-col gap-1.5">
        <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
          <span className="font-bold text-green-700">✅ 포함 사항 </span>
          <ul className="text-gray-700 mt-0.5">
            {highlights.inclusions.map((item, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-gray-400 flex-shrink-0">•</span>
                <span>{renderBold(item)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-red-50 border border-red-100 rounded px-2 py-1.5">
          <span className="font-bold text-red-600">❌ 불포함 사항 </span>
          <ul className="text-gray-700 mt-0.5">
            {highlights.excludes.map((item, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-gray-400 flex-shrink-0">•</span>
                <span>{renderBold(item)}</span>
              </li>
            ))}
          </ul>
        </div>
        {highlights.shopping && (
          <div className="bg-purple-50 border border-purple-100 rounded px-2 py-1.5">
            <span className="font-bold text-orange-600">🛍 쇼핑: </span>
            <span className="text-gray-700">{renderBold(highlights.shopping)}</span>
          </div>
        )}
        {highlights.remarks.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded px-2 py-1.5">
            <span className="font-bold text-orange-700">⚠️ 비고 및 필수 안내 </span>
            <ul className="text-gray-700 mt-0.5">
              {highlights.remarks.map((r, i) => (
                <li key={i} className="flex gap-1">
                  <span className="text-orange-400 flex-shrink-0">•</span>
                  <span>{renderBold(r)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 일정표 본문 */}
      <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
        <table className="w-full border-collapse text-xs" style={{ wordBreak: 'keep-all' }}>
          <thead>
            <tr className="bg-blue-700 text-white">
              <th style={{ minWidth: '48px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid #3b82f6' }}>일자</th>
              <th style={{ minWidth: '44px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid #3b82f6' }}>지역</th>
              <th style={{ minWidth: '52px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid #3b82f6' }}>교통편</th>
              <th style={{ minWidth: '44px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid #3b82f6' }}>시간</th>
              <th style={{ padding: '6px 16px', textAlign: 'left', borderRight: '1px solid #3b82f6' }}>일&nbsp;&nbsp;정</th>
              <th style={{ minWidth: '64px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>식사</th>
            </tr>
          </thead>
          <tbody>
            {daysWithDates.map((day, di) => {
              const bgColor = di % 2 === 0 ? '#ffffff' : '#eff6ff';
              const dayRowspan = day.schedule.length;

              return day.schedule.map((item, si) => {
                const isFirst = si === 0;
                const isLastRow = si === day.schedule.length - 1;
                const rowBorderBottom = isLastRow ? '2px solid #9ca3af' : '1px dashed #e5e7eb';
                const spanCellBorder  = '2px solid #9ca3af';

                return (
                  <tr
                    key={`${di}-${si}`}
                    style={{ backgroundColor: bgColor, verticalAlign: 'top', borderBottom: rowBorderBottom }}
                  >
                    {/* 일자 */}
                    {isFirst && (
                      <td
                        rowSpan={dayRowspan}
                        style={{
                          minWidth: '48px', padding: '6px 4px', textAlign: 'center',
                          fontWeight: 'bold', color: '#1e40af', verticalAlign: 'middle',
                          whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb',
                          borderBottom: spanCellBorder,
                        }}
                      >
                        제{day.day}일
                        {day.resolvedDate && (
                          <div style={{ fontWeight: 'normal', color: '#6b7280', fontSize: '10px', marginTop: '2px' }}>
                            {formatKoDate(day.resolvedDate)}
                          </div>
                        )}
                      </td>
                    )}

                    {/* 지역 — cross-day rowspan */}
                    {isFirst && regionSpans[di].show && (
                      <td
                        rowSpan={regionSpans[di].rowspan}
                        style={{
                          minWidth: '44px', padding: '6px 4px', textAlign: 'center',
                          color: '#374151', fontWeight: '600', verticalAlign: 'middle',
                          whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb',
                          borderBottom: spanCellBorder,
                        }}
                      >
                        {day.regions.map((r, ri) => <div key={ri}>{r}</div>)}
                      </td>
                    )}

                    {/* 교통편 */}
                    <td style={{ minWidth: '52px', padding: '4px 6px', textAlign: 'center', color: '#4b5563', whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb' }}>
                      {item.transport || ''}
                    </td>

                    {/* 시간 */}
                    <td style={{ minWidth: '44px', padding: '4px 6px', textAlign: 'center', color: '#4b5563', whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb' }}>
                      {item.time || ''}
                    </td>

                    {/* 일정 */}
                    <td
                      style={{
                        paddingTop: '5px', paddingBottom: '5px',
                        paddingLeft: '14px', paddingRight: '8px',
                        borderRight: '1px solid #e5e7eb',
                        backgroundColor: item.type === 'hotel' && day.hotel ? '#eff6ff' : undefined,
                      }}
                    >
                      {item.type === 'hotel' && day.hotel ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#1e40af', fontWeight: '600' }}>
                          <span>🏨</span>
                          <span>
                            {day.hotel.name}
                            {day.hotel.grade ? ` (${day.hotel.grade})` : ''}
                            {day.hotel.note  ? ` ${day.hotel.note}` : ''}
                          </span>
                        </div>
                      ) : (
                        <div
                          style={{
                            color: item.type === 'optional' ? '#c2410c'
                                 : item.type === 'shopping'  ? '#7e22ce'
                                 : undefined,
                          }}
                        >
                          <span style={{ fontWeight: 'bold' }}>{item.activity}</span>
                          {item.note && (
                            <span style={{ display: 'block', fontSize: '10px', color: '#9ca3af', lineHeight: '1.4', marginTop: '2px' }}>
                              {item.note}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 식사 */}
                    {isFirst && (
                      <td
                        rowSpan={dayRowspan}
                        style={{ minWidth: '64px', padding: '6px 6px', verticalAlign: 'middle', borderBottom: spanCellBorder }}
                      >
                        <MealCell meals={day.meals} />
                      </td>
                    )}
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>

      {/* 선택관광 */}
      {optional_tours.length > 0 && (
        <div className="text-xs border border-orange-200 rounded bg-orange-50 px-3 py-1.5">
          <span className="font-bold text-orange-700 mr-2">선택관광 (별도판매가)</span>
          {optional_tours.map((t, i) => (
            <span key={i} className="mr-3 text-gray-700">
              ▪ {t.name}
              {t.price_usd && ` $${t.price_usd}`}
              {t.price_krw && ` ₩${t.price_krw.toLocaleString()}`}
              {t.note && ` (${t.note})`}
            </span>
          ))}
        </div>
      )}

      {/* 푸터 */}
      <div className="pt-2 border-t border-gray-200 flex justify-between text-xs text-gray-400">
        <span>여소남 — 가치있는 여행을 소개합니다</span>
        <span>※ 상기 일정은 현지 및 항공사 사정에 의해 변경될 수 있습니다.</span>
      </div>
    </div>
  );
}
