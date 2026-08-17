import { describe, it, expect } from 'vitest';
import { attachSourceBackedGolfRemarks, postProcessItineraryData, postProcessCatalogFields } from './package-post-process';
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

  it('aligns legacy day flight codes to source-backed flight segments', () => {
    const out = postProcessItineraryData({
      days: [
        {
          day: 1,
          schedule: [
            { type: 'flight', activity: '김해공항 국제선 출발', transport: 'BX148' },
            { type: 'flight', activity: '후쿠오카 국제선 도착', transport: 'BX148' },
          ],
        },
        {
          day: 2,
          schedule: [
            { type: 'flight', activity: '후쿠오카 국제선 출발', transport: 'BX143' },
            { type: 'flight', activity: '김해공항 국제선 도착', transport: 'BX143' },
          ],
        },
      ],
      flight_segments: [
        { leg: 'outbound', flight_no: 'BX501', day_pair: [0, 0] },
        { leg: 'inbound', flight_no: 'BX516', day_pair: [1, 1] },
      ],
    });

    expect(out.days?.[0]?.schedule?.map(item => item.transport)).toEqual(['BX501', 'BX501']);
    expect(out.days?.[1]?.schedule?.map(item => item.transport)).toEqual(['BX516', 'BX516']);
  });

  it('does not re-expose a V6-hidden flight time from legacy day rows', () => {
    const out = postProcessItineraryData({
      days: [{
        day: 1,
        schedule: [{
          time: '20:05',
          type: 'flight',
          activity: '부산 김해 국제공항 출발 (목,일 20:05 출발)',
          transport: 'LJ119',
        }],
      }],
      flight_segments: [{
        leg: 'outbound',
        flight_no: 'LJ119',
        dep_airport: '부산',
        dep_time: null,
        arr_airport: null,
        arr_time: null,
        arr_day_offset: 0,
        day_pair: [0, 0],
        v6_fact_state: 'degraded',
        v6_schedule_notice: '운항일 기준 상담 시 최종 확인',
      }] as FlightSegment[],
    });
    expect(out?.flight_segments?.[0]?.dep_time).toBeNull();
    expect(out?.days?.[0]?.schedule?.[0]).not.toHaveProperty('time');
    expect(out?.days?.[0]?.schedule?.[0]?.activity).not.toContain('20:05');
  });

  it('removes optional-tour fragments from saved schedule rows before public snapshot generation', () => {
    const out = postProcessItineraryData({
      days: [{
        day: 2,
        schedule: [
          { activity: '\uD638\uD154 \uC870\uC2DD \uD6C4' },
          { activity: '[\uC120\uD0DD\uC635\uC158] \uBC1C+\uC804\uC2E0\uB9C8\uC0AC\uC9C0 90\uBD84 : $??' },
          { activity: '\uD314\uB300\uAD00 \uAD00\uAD11' },
        ],
      }],
    });

    expect(out?.days?.[0]?.schedule?.map(item => item.activity)).toEqual([
      '\uD638\uD154 \uC870\uC2DD \uD6C4',
      '\uD314\uB300\uAD00 \uAD00\uAD11',
    ]);
  });

  it('repairs mojibake attraction names only from source-backed schedule context', () => {
    const out = postProcessItineraryData({
      days: [{
        day: 2,
        schedule: [
          {
            activity: '\uBC14\uB2E4\uC640 \uBC14\uC704\uAC00 \uC808\uACBD\uC744 \uC774\uB8E8\uB294 \uD63C\uCD1D\uACEF \uC790\uC720\uC77C\uC815',
            attraction_names: ['????? ?????'],
          },
          {
            activity: '\uD604\uC9C0 \uC0AC\uC815\uC5D0 \uB530\uB77C \uC77C\uC815\uC774 \uBCC0\uACBD\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
            attraction_names: ['????'],
          },
        ],
      }],
    });

    expect(out?.days?.[0]?.schedule?.[0]?.attraction_names).toEqual(['\uD63C\uCD1D\uACEF']);
    expect(out?.days?.[0]?.schedule?.[1]).not.toHaveProperty('attraction_names');
  });
});

describe('attachSourceBackedGolfRemarks', () => {
  it('adds source course names and round length without inventing schedule items', () => {
    const out = attachSourceBackedGolfRemarks({
      days: [{ day: 1, schedule: [{ activity: '골프장 이동' }] }],
      highlights: { remarks: [] },
    }, '예정 골프장\n센트럴 18H/파72/5,954야드\n니조 18H/파72/6,615야드');

    expect(out.highlights?.remarks).toEqual([
      '일정표 기준 예정 골프장: 센트럴, 니조',
      '일정표 기준 골프 라운딩은 18홀입니다.',
    ]);
    expect(out.days?.[0]?.schedule?.[0]?.activity).toBe('골프장 이동');
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
