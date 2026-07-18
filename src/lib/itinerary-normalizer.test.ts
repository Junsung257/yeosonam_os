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
  it('downgrades unsupported flight rows before they can become customer-visible flight facts', () => {
    const itin = normalizeItinerary({
      days: [{
        day: 5,
        schedule: [
          { time: '08:00', activity: '\uC5F0\uAE38 \uD575\uC2EC\uAD00\uAD11', type: 'flight', entity_kind: 'flight' },
          { time: '12:00', activity: '\uC5F0\uAE38 \uACF5\uD56D \uCD9C\uBC1C', type: 'flight', transport: 'BX3185' },
        ],
      }],
    });

    const schedule = itin?.days?.[0]?.schedule ?? [];
    expect(schedule[0]).toMatchObject({
      activity: '\uC5F0\uAE38 \uD575\uC2EC\uAD00\uAD11',
      type: 'normal',
      entity_kind: 'unknown',
    });
    expect(schedule[1]).toMatchObject({
      activity: '\uC5F0\uAE38 \uACF5\uD56D \uCD9C\uBC1C',
      type: 'flight',
      transport: 'BX3185',
    });
  });

  it('keeps airport and flight-code evidence as flight while leaving airport transfer rows normal', () => {
    const itin = normalizeItinerary({
      days: [{
        day: 1,
        schedule: [
          { time: '18:00', activity: '\uACF5\uD56D\uC73C\uB85C \uC774\uB3D9', type: 'flight' },
          { time: '20:50', activity: '\uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uCD9C\uBC1C', type: 'normal', transport: 'BX773' },
          { time: '23:50', activity: 'BX773 \uB2E4\uB0AD \uB3C4\uCC29', type: 'normal' },
        ],
      }],
    });

    const schedule = itin?.days?.[0]?.schedule ?? [];
    expect(schedule[0]).toMatchObject({ activity: '\uACF5\uD56D\uC73C\uB85C \uC774\uB3D9', type: 'normal' });
    expect(schedule[1]).toMatchObject({ activity: '\uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uCD9C\uBC1C', type: 'flight' });
    expect(schedule[2]).toMatchObject({ activity: 'BX773 \uB2E4\uB0AD \uB3C4\uCC29', type: 'flight' });
  });

  it('does not treat minimum-departure conditions as flights even when entity_kind was polluted', () => {
    const itin = normalizeItinerary({
      days: [{
        day: 5,
        schedule: [
          { activity: '\uC131\uC778 8\uBA85 \uC774\uC0C1 \uCD9C\uBC1C\uAC00\uB2A5', type: 'flight', entity_kind: 'flight', transport: 'VN428' },
        ],
      }],
      meta: {
        flight_in: 'VN428',
        flight_in_time: '01:15',
      },
    });

    expect(itin?.days?.[0]?.schedule?.[0]).toMatchObject({
      activity: '\uC131\uC778 8\uBA85 \uC774\uC0C1 \uCD9C\uBC1C\uAC00\uB2A5',
      type: 'normal',
      entity_kind: 'unknown',
      transport: 'VN428',
    });
  });

  it('trims customer courtesy tails from arrival rows while keeping the flight fact', () => {
    const itin = normalizeItinerary({
      days: [{
        day: 5,
        schedule: [
          {
            activity: '\uBD80\uC0B0 \uB3C4\uCC29 \u263A\u263A \uC990\uAC70\uC6B4 \uC5EC\uD589\uC774 \uB418\uC168\uAE30\uB97C \uBC14\uB78D\uB2C8\uB2E4',
            type: 'flight',
            transport: 'LJ002',
          },
        ],
      }],
    });

    expect(itin?.days?.[0]?.schedule?.[0]).toMatchObject({
      activity: '\uBD80\uC0B0 \uB3C4\uCC29',
      type: 'flight',
      transport: 'LJ002',
    });
  });

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
