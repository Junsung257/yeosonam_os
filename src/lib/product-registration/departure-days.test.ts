import { describe, expect, it } from 'vitest';
import { inferDepartureDaysFromRawText } from './departure-days';

describe('inferDepartureDaysFromRawText', () => {
  it('recovers weekday text from departure sections preserving source order', () => {
    expect(inferDepartureDaysFromRawText('출 발 일\n6/1~10/24 (수,목)')).toBe('수,목');
    expect(inferDepartureDaysFromRawText('출 발 일\n6/1~10/24 (토,일)')).toBe('토,일');
  });

  it('prefers the departure section over cancellation-rule date text', () => {
    expect(inferDepartureDaysFromRawText(`
출 발 일
매일출발
판 매 가
요금표참조
취소시기
출발일 14일 ~ 7일전까지 취소
`)).toBe('매일');
  });
});
