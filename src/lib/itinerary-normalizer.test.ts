import { describe, it, expect } from 'vitest';
import { normalizeItinerary, enrichItineraryForDisplay } from './itinerary-normalizer';
import { normalizeFlightSegments, type FlightSegment } from './parser/normalize-flight-segments';

describe('sanitizeFlightScheduleTimes (via normalizeItinerary)', () => {
  it('미팅 줄의 18:50(출발2시간전 계산값) 제거, 출발·도착 flight 시간 유지', () => {
    const itin = normalizeItinerary({
      days: [{
        day: 1,
        schedule: [
          { time: '18:50', activity: '출발2시간전 김해공항 국제선 1층에서 미팅 후 수속', type: 'normal' },
          { time: '20:50', activity: '김해 국제공항 출발', type: 'flight', transport: 'BX773' },
          { time: '23:50', activity: '다낭 국제공항 도착', type: 'flight', transport: 'BX773' },
        ],
      }],
    });

    const s = itin?.days?.[0]?.schedule ?? [];
    expect(s[0].time).toBeNull();
    expect(s[1]).toMatchObject({ time: '20:50', type: 'flight' });
    expect(s[2]).toMatchObject({ time: '23:50', type: 'flight' });
  });
});

describe('coerceAirportScheduleTypes (via normalizeItinerary + flight_segments)', () => {
  it('도착 행이 type normal → flight_segments arr_time 채움 (다낭 BX773)', () => {
    const itin = enrichItineraryForDisplay(
      {
        days: [{
          day: 1,
          schedule: [
            { time: '20:50', activity: '김해 국제공항 출발', type: 'flight', transport: 'BX773' },
            { time: '23:50', activity: '다낭 국제공항 도착', type: 'normal', transport: 'BX773' },
          ],
        }],
        flight_segments: [] as FlightSegment[],
      },
      data => normalizeFlightSegments(data as Parameters<typeof normalizeFlightSegments>[0]),
    );
    expect(itin?.days?.[0]?.schedule?.[1]?.type).toBe('flight');
    expect(itin?.flight_segments?.[0]?.arr_time).toBe('23:50');
    expect(itin?.flight_segments?.[0]?.dep_time).toBe('20:50');
  });

  it('귀국편 도착 normal → inbound segment arr_time', () => {
    const itin = enrichItineraryForDisplay(
      {
        days: [
          { day: 1, schedule: [] },
          { day: 5, schedule: [
            { time: '00:45', activity: '다낭 국제공항 출발', type: 'flight', transport: 'BX774' },
            { time: '07:20', activity: '김해 국제공항 도착', type: 'normal', transport: 'BX774' },
          ]},
        ],
        flight_segments: [] as FlightSegment[],
      },
      data => normalizeFlightSegments(data as Parameters<typeof normalizeFlightSegments>[0]),
    );
    const inbound = itin?.flight_segments?.find(s => s.leg === 'inbound') ?? itin?.flight_segments?.[0];
    expect(inbound?.arr_time).toBe('07:20');
  });
});
