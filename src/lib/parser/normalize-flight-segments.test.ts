import { describe, expect, it } from 'vitest';
import { normalizeFlightSegments } from './normalize-flight-segments';

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

    it('국제공항 표기 + 한글 도시 추출 — 현재 동작 박제 (dep_airport=null)', () => {
      // 2026-05-19 박제 (사고 발견): extractCity regex `[\w가-힣]+?` 가 공백 미포함 →
      // "타이페이 타오위안 국제공항" 같은 두 단어 공항명 매칭 실패 → dep_airport=null.
      // 사장님 [BX] 대만 카탈로그 같은 경우 dep_airport 누락 사고 회귀 가능성.
      // 별도 PR 수정 후보 — extractCity 개선해서 "타이페이" 만 추출.
      const itin = {
        days: [{
          day: 1,
          schedule: [
            { type: 'flight', activity: '타이페이 타오위안 국제공항 출발', time: '10:00', transport: 'BX793' },
          ],
        }],
      };
      const r = normalizeFlightSegments(itin);
      expect(r!.flight_segments![0].dep_airport, '현재 동작: 두 단어 공항명 매칭 실패').toBeNull();
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
