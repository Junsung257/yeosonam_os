import { describe, expect, it } from 'vitest';
import { regionsWithFlightEndpoints } from './ir-to-package';

describe('regionsWithFlightEndpoints', () => {
  it('keeps flight departure and arrival in day regions', () => {
    expect(regionsWithFlightEndpoints(['나트랑'], {
      code: 'LJ115',
      departure: { airport: '부산', time: '21:35' },
      arrival: { airport: '나트랑', time: '00:25' },
    })).toEqual(['부산', '나트랑']);
  });
});
