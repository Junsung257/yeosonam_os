import { describe, expect, it } from 'vitest';
import { normalizeFlightSegments, type FlightSegment } from './normalize-flight-segments';
import { enrichItineraryForDisplay } from '../itinerary-normalizer';

/**
 * 2026-05-19 박제 (FIX-3): normalize-flight-segments 회귀 fixture.
 *
 * 나트랑/달랏 사고: DAY 4 "23:55 출발" + DAY 5 "06:40 도착" 같은 항공편인데
 * schedule 두 day 에 쪼개져 transport=null/도착시간 누락으로 카드 깨짐.
 * 익일 도착 매칭 + flight_segments 정규화 영구 차단.
 */
describe('normalizeFlightSegments — flight pair 정규화 (FIX-3)', () => {
  describe('같은 day 내 짝 매칭', () => {
    it('출발+도착 같은 day → 1 segment, arr_day_offset=0', () => {
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '부산 국제공항 출발', time: '10:50', transport: 'BX793' },
            { type: 'flight', activity: '타이페이 국제공항 도착', time: '12:35', transport: 'BX793' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r?.flight_segments).toHaveLength(1);
      const seg = r!.flight_segments![0];
      expect(seg.leg).toBe('outbound');
      expect(seg.dep_airport).toBe('부산');
      expect(seg.arr_airport).toBe('타이페이');
      expect(seg.arr_day_offset).toBe(0);
      expect(seg.day_pair).toEqual([0, 0]);
      expect(seg.flight_no).toBe('BX793');
    });

    it('같은 day red-eye (20:40→00:30) → arr_day_offset=1 (보홀)', () => {
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '부산 김해 국제공항 출발', time: '20:40', transport: '7C2157' },
            { type: 'flight', activity: '보홀 팡라오 국제공항 도착', time: '00:30', transport: '7C2157' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r?.flight_segments?.[0].arr_day_offset).toBe(1);
    });
  });

  describe('익일 도착 매칭 (나트랑 사고 핵심)', () => {
    it('day 4 출발 + day 5 도착 → 익일 매칭, arr_day_offset=1', () => {
      const itin = {
        days: [
          { day: 1, schedule: [] },
          { day: 2, schedule: [] },
          { day: 3, schedule: [] },
          {
            day: 4,
            schedule: [
              { type: 'flight', activity: '나트랑 국제공항 출발', time: '23:55', transport: 'LJ116' },
            ],
          },
          {
            day: 5,
            schedule: [
              { type: 'flight', activity: '부산 국제공항 도착', time: '06:40', transport: 'LJ116' },
            ],
          },
        ],
      };
      const r = normalizeFlightSegments(itin);
      expect(r?.flight_segments).toHaveLength(1);
      const seg = r!.flight_segments![0];
      expect(seg.arr_day_offset).toBe(1);
      expect(seg.day_pair).toEqual([3, 4]); // 0-indexed
      expect(seg.dep_time).toBe('23:55');
      expect(seg.arr_time).toBe('06:40');
    });

    it('귀국 도착 줄이 normal이어도 meta.flight_in 기반으로 flight로 보정한다', () => {
      const itin = {
        meta: { flight_out: 'LJ115', flight_in: 'LJ116' },
        days: [
          {
            day: 4,
            schedule: [
              { type: 'flight', activity: '나트랑 국제공항 출발', time: '23:55', transport: 'LJ116' },
            ],
          },
          {
            day: 5,
            schedule: [
              { type: 'normal', activity: '부산 도착 후 해산', time: '06:40' },
            ],
          },
        ],
      };
      const r = normalizeFlightSegments(itin);
      expect(r?.days?.[1]?.schedule?.[0]?.type).toBe('flight');
      expect(r?.days?.[1]?.schedule?.[0]?.transport).toBe('LJ116');
      expect(r?.flight_segments?.[0]?.arr_time).toBe('06:40');
      expect(r?.flight_segments?.[0]?.arr_day_offset).toBe(1);
    });
  });

  describe('왕복 (outbound + inbound)', () => {
    it('day 1 부산→타이페이, day 4 타이페이→부산 → 2 segments', () => {
      const itin = {
        days: [
          {
            day: 1,
            schedule: [
              { type: 'flight', activity: '부산 출발', time: '10:50', transport: 'BX793' },
              { type: 'flight', activity: '타이페이 도착', time: '12:35', transport: 'BX793' },
            ],
          },
          { day: 2, schedule: [] },
          { day: 3, schedule: [] },
          {
            day: 4,
            schedule: [
              { type: 'flight', activity: '타이페이 출발', time: '16:40', transport: 'BX792' },
              { type: 'flight', activity: '부산 도착', time: '19:55', transport: 'BX792' },
            ],
          },
        ],
      };
      const r = normalizeFlightSegments(itin);
      expect(r?.flight_segments).toHaveLength(2);
      expect(r!.flight_segments![0].leg).toBe('outbound');
      expect(r!.flight_segments![1].leg).toBe('inbound');
      expect(r!.flight_segments![0].flight_no).toBe('BX793');
      expect(r!.flight_segments![1].flight_no).toBe('BX792');
    });
  });

  describe('짝 없는 케이스 (fallback)', () => {
    it('출발만 있고 도착 없음 → 단독 segment, arr=null', () => {
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '부산 출발', time: '10:00', transport: 'KE100' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r?.flight_segments).toHaveLength(1);
      expect(r!.flight_segments![0].dep_airport).toBe('부산');
      expect(r!.flight_segments![0].arr_airport).toBeNull();
    });

    it('도착만 있고 출발 없음 → 단독 segment, dep=null', () => {
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '부산 도착', time: '06:00', transport: 'KE200' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r?.flight_segments).toHaveLength(1);
      expect(r!.flight_segments![0].arr_airport).toBe('부산');
      expect(r!.flight_segments![0].dep_airport).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('빈 itin → 그대로 반환 (flight_segments 없음)', () => {
      const r = normalizeFlightSegments({ days: [] });
      expect(r?.flight_segments).toBeUndefined();
    });

    it('null itin → null 반환', () => {
      expect(normalizeFlightSegments(null)).toBeNull();
    });

    it('flight type 없음 → flight_segments 추가 안 함', () => {
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'normal', activity: '관광지 방문', time: '10:00' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r?.flight_segments).toBeUndefined();
    });

    it('type normal 공항 도착도 coerce 후 페어링 (enrichItineraryForDisplay 경유)', () => {
      const itin = enrichItineraryForDisplay({
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '김해 국제공항 출발', time: '20:50', transport: 'BX773' },
            { type: 'normal', activity: '다낭 국제공항 도착', time: '23:50', transport: 'BX773' },
          ],
        }],
        flight_segments: [] as FlightSegment[],
      }, normalizeFlightSegments);
      expect(itin?.flight_segments?.[0]?.arr_time).toBe('23:50');
    });

    it('두 단어 공항명 추출 ("타이페이 타오위안 국제공항 출발") → 첫 단어 "타이페이"', () => {
      // 2026-05-19 박제 (PR #135 사고 영구 차단):
      //   extractCity regex 확장으로 "X Y 국제공항" 패턴에서 X 만 캡처.
      //   [BX] 대만 카탈로그 회귀 차단.
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '타이페이 타오위안 국제공항 출발', time: '10:00', transport: 'BX793' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r!.flight_segments![0].dep_airport).toBe('타이페이');
    });

    it('"후쿠오카 신치토세 공항 도착" → "후쿠오카"', () => {
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '후쿠오카 신치토세 공항 도착', time: '14:00', transport: 'JL222' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r!.flight_segments![0].arr_airport).toBe('후쿠오카');
    });

    it('단순 공항 표기 ("부산 국제공항 출발") → 도시 정상 추출', () => {
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '부산 국제공항 출발', time: '10:00', transport: 'BX793' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r!.flight_segments![0].dep_airport).toBe('부산');
    });
  });
});
