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

describe('cleanSchedule option detail noise', () => {
  it('removes optional golf detail headings from day schedule', () => {
    const itin = normalizeItinerary({
      days: [{
        day: 2,
        schedule: [
          { activity: '\uD638\uD154 \uC870\uC2DD \uD6C4 \uC804\uC77C \uC790\uC720\uC77C\uC815 [\uD638\uD154 \uBD80\uB300\uC2DC\uC124 \uC774\uC6A9]' },
          { activity: '1. \uACE8\uD504\uC7A5 \uC815\uBCF4' },
          { activity: '\uCF54\uC2A4\uC815\uBCF4: 18\uD640/72\uD30C/7224\uC57C\uB4DC' },
          { activity: '1. \uACE8\uD504\uC7A5 \uC815\uBCF4' },
          { activity: '\uD734\uC2DD \uBC0F \uC790\uC720\uC77C\uC815' },
        ],
      }],
    });

    const activities = itin?.days?.[0]?.schedule?.map(item => item.activity) ?? [];
    expect(activities).toContain('\uD638\uD154 \uC870\uC2DD \uD6C4 \uC804\uC77C \uC790\uC720\uC77C\uC815 [\uD638\uD154 \uBD80\uB300\uC2DC\uC124 \uC774\uC6A9]');
    expect(activities).toContain('\uD734\uC2DD \uBC0F \uC790\uC720\uC77C\uC815');
    expect(activities).not.toContain('1. \uACE8\uD504\uC7A5 \uC815\uBCF4');
    expect(activities.some(activity => activity?.startsWith('\uCF54\uC2A4\uC815\uBCF4:'))).toBe(false);
  });
});

describe('meal and meta flight normalization', () => {
  it('normalizes string meal slots, preserves notes, and recounts included meals', () => {
    const itin = normalizeItinerary({
      days: [{
        day: 1,
        meals: {
          breakfast: '\uD638\uD154\uC2DD',
          lunch: '\uC790\uC720\uC2DD',
          dinner: null,
          dinner_note: '\uD604\uC9C0\uC2DD',
        },
      }],
    });

    const meals = itin?.days?.[0]?.meals;
    expect(meals?.breakfast).toBe(true);
    expect(meals?.breakfast_note).toBe('\uD638\uD154\uC2DD');
    expect(meals?.lunch).toBe(false);
    expect(meals?.lunch_note).toBe('\uC790\uC720\uC2DD');
    expect(meals?.dinner).toBe(true);
    expect(meals?.dinner_note).toBe('\uD604\uC9C0\uC2DD');
    expect(itin?.meta?.total_meals).toBe(2);
  });

  it('uses meta flight hints for first and last day departure rows', () => {
    const itin = normalizeItinerary({
      days: [
        {
          day: 1,
          schedule: [{ activity: '\uC778\uCC9C \uCD9C\uBC1C', type: 'normal' }],
        },
        {
          day: 4,
          schedule: [{ activity: '\uB2E4\uB0AD \uACF5\uD56D \uCD9C\uBC1C', type: 'normal' }],
        },
      ],
      meta: {
        flight_out: 'LJ001',
        flight_out_time: '08:30',
        flight_in: 'LJ002',
        flight_in_time: '22:10',
      },
    });

    expect(itin?.days?.[0]?.schedule?.[0]).toMatchObject({
      type: 'flight',
      transport: 'LJ001',
      time: '08:30',
    });
    expect(itin?.days?.[1]?.schedule?.[0]).toMatchObject({
      type: 'flight',
      transport: 'LJ002',
      time: '22:10',
    });
  });
});
