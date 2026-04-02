'use client';

import type { TravelItinerary } from '@/types/itinerary';
import {
  PosterHeader,
  PosterInfo,
  PosterScheduleTable,
  PosterFooter,
} from '@/components/itinerary/A4PosterLayout';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  itinerary: TravelItinerary;
  departureDate?: string | null;
  confirmedPrice?: number | null;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function ItineraryTableView({ itinerary, departureDate }: Props) {
  const { days, optional_tours } = itinerary;
  const optTours = optional_tours ?? [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif",
      }}
    >
      <PosterHeader meta={itinerary.meta} />
      <PosterInfo highlights={itinerary.highlights} />

      {/* 일정 테이블 */}
      {days && days.length > 0 && (
        <div>
          <div style={{
            fontSize: '11px', fontWeight: 700, color: '#374151',
            marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '4px',
          }}>
            <span style={{
              width: '3px', height: '12px', background: '#1a3764',
              borderRadius: '1px', display: 'inline-block', flexShrink: 0,
            }} />
            상세 일정표
          </div>
          <PosterScheduleTable days={days} departureDate={departureDate} />
        </div>
      )}

      {/* 선택관광 */}
      {optTours.length > 0 && (
        <div style={{
          border: '1px solid #fed7aa', borderRadius: '4px',
          background: '#fffbeb', padding: '4px 8px', fontSize: '9.5px',
        }}>
          <span style={{ fontWeight: 700, color: '#c2410c', marginRight: '6px' }}>
            선택관광 (별도판매가)
          </span>
          {optTours.map((t, i) => (
            <span key={i} style={{ color: '#374151', marginRight: '8px' }}>
              ▪ {t.name}
              {t.price_usd ? ` $${t.price_usd}` : ''}
              {t.price_krw ? ` ₩${t.price_krw.toLocaleString()}` : ''}
              {t.note ? ` (${t.note})` : ''}
            </span>
          ))}
        </div>
      )}

      <PosterFooter />
    </div>
  );
}
