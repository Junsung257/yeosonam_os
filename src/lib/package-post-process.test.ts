import { describe, it, expect } from 'vitest';
import { postProcessItineraryData, postProcessCatalogFields } from './package-post-process';
import type { FlightSegment } from './parser/normalize-flight-segments';

const DANANG_RAW = `비    고 
 * 2인실 1명이 쓰시는 경우 싱글차지 $120/인 발생합니다.
주의사항
 * 본 행사는 쇼핑샵이 들어 가는 패키지 일정으로 쇼핑샵 일정에 참여 하지 않을 경우 패널티 $150/인 발생합니다.
일 자
`;

describe('postProcessItineraryData', () => {
  it('type normal 공항 도착 → flight_segments arr_time', () => {
    const out = postProcessItineraryData({
      days: [{
        day: 1,
        schedule: [
          { time: '20:50', activity: '김해 국제공항 출발', type: 'flight', transport: 'BX773' },
          { time: '23:50', activity: '다낭 국제공항 도착', type: 'normal', transport: 'BX773' },
        ],
      }],
      flight_segments: [] as FlightSegment[],
    });
    expect(out?.flight_segments?.[0]?.arr_time).toBe('23:50');
  });

  it('does not re-promote minimum-departure condition rows through flight segment normalization', () => {
    const out = postProcessItineraryData({
      days: [{
        day: 5,
        schedule: [
          {
            time: '01:15',
            activity: '\uC131\uC778 8\uBA85 \uC774\uC0C1 \uCD9C\uBC1C\uAC00\uB2A5',
            type: 'flight',
            entity_kind: 'unknown',
            transport: 'VN428',
          },
        ],
      }],
      meta: {
        flight_in: 'VN428',
        flight_in_time: '01:15',
      },
      flight_segments: [] as FlightSegment[],
    });

    expect(out?.days?.[0]?.schedule?.[0]).toMatchObject({
      activity: '\uC131\uC778 8\uBA85 \uC774\uC0C1 \uCD9C\uBC1C\uAC00\uB2A5',
      type: 'normal',
      entity_kind: 'unknown',
      transport: 'VN428',
    });
    expect(out?.flight_segments ?? []).toEqual([]);
  });
});

describe('postProcessCatalogFields', () => {
  it('쇼핑 패널티는 excludes에 넣지 않고 싱글차지는 넣음', () => {
    const r = postProcessCatalogFields({
      title: '노팁,노옵션 BX 다낭',
      excludes: ['개인경비'],
      raw_text: DANANG_RAW,
    });
    expect(r.excludes.some(l => /120/.test(l))).toBe(true);
    expect(r.excludes.some(l => /150/.test(l) && /쇼핑|패널티/.test(l))).toBe(false);
    expect(r.notices_parsed.some(n => n.type === 'POLICY')).toBe(true);
  });
});
