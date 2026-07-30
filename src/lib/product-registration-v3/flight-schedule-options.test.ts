import { describe, expect, it } from 'vitest';

import { createSourceLineIndex } from './source-line-index';
import {
  buildFlightOptionCustomerNotice,
  extractSourceBackedRoundTripFlightOptions,
} from './flight-schedule-options';
import { runProductRegistrationV3 } from './index';

describe('source-backed round-trip flight schedule options', () => {
  it('keeps multiple source time options without inventing a flight number', () => {
    const raw = [
      '항공시간',
      '인천-천진 - 아시아나08:55-09:55, 대한항공10:15-11:15, 천진-인천 – 이사이나10:55-13:30, 대한항공11:30-14:20',
    ].join('\n');
    const options = extractSourceBackedRoundTripFlightOptions(createSourceLineIndex(raw));

    expect(options).toHaveLength(4);
    expect(options.map(option => ({
      leg: option.leg,
      carrier: option.carrier_name,
      dep: option.dep_time,
      arr: option.arr_time,
      route: `${option.dep_location}-${option.arr_location}`,
    }))).toEqual([
      { leg: 'outbound', carrier: '아시아나', dep: '08:55', arr: '09:55', route: '인천-천진' },
      { leg: 'outbound', carrier: '대한항공', dep: '10:15', arr: '11:15', route: '인천-천진' },
      { leg: 'inbound', carrier: '이사이나', dep: '10:55', arr: '13:30', route: '천진-인천' },
      { leg: 'inbound', carrier: '대한항공', dep: '11:30', arr: '14:20', route: '천진-인천' },
    ]);
    expect(options.every(option => option.evidence.quote.includes('인천-천진'))).toBe(true);
    expect(options.every(option => !('flight_no' in option))).toBe(true);
  });

  it('builds customer wording that marks airline and flight number as unconfirmed', () => {
    const options = extractSourceBackedRoundTripFlightOptions(createSourceLineIndex([
      '항공시간',
      '인천-천진 - 아시아나08:55-09:55, 대한항공10:15-11:15, 천진-인천 – 이사이나10:55-13:30, 대한항공11:30-14:20',
    ].join('\n')));
    const notice = buildFlightOptionCustomerNotice(options);

    expect(notice).toContain('항공사와 편명은 예약 시 최종 확정');
    expect(notice).toContain('인천→천진 08:55~09:55 또는 10:15~11:15');
    expect(notice).toContain('천진→인천 10:55~13:30 또는 11:30~14:20');
    expect(notice).not.toContain('이사이나');
  });

  it('fails closed for one-way or generic time text', () => {
    expect(extractSourceBackedRoundTripFlightOptions(createSourceLineIndex(
      '항공시간\n인천-천진 - 대한항공10:15-11:15',
    ))).toEqual([]);
    expect(extractSourceBackedRoundTripFlightOptions(createSourceLineIndex(
      '예약 시 항공 시간 확인 10:15-11:15',
    ))).toEqual([]);
  });

  it('passes the air-evidence gate with round-trip options but keeps fixed segments empty', async () => {
    const raw = `
상품: 인천출발 천진 진황도 2색 골프 3박4일
출발일 2026.08.01
판매가 999,000원
인원 2명 이상 출발 가능
포함사항 왕복항공료, 호텔, 식사, 골프비용, 여행자보험
불포함사항 미팅샌딩비용 400위안/인
항공시간
인천-천진 - 아시아나08:55-09:55, 대한항공10:15-11:15, 천진-인천 – 이사이나10:55-13:30, 대한항공11:30-14:20
제1일
인천 국제공항 출발
천진 국제공항 도착
제2일
골프 18홀 라운딩
제3일
골프 18홀 라운딩
제4일
천진 국제공항 출발
인천 국제공항 도착
`.trim();
    const result = await runProductRegistrationV3(raw);
    const variant = result.ledger.variants[0];
    const flightCheck = result.gate_result.checks.find(check => check.id.endsWith('.flight'));

    expect(variant.flight_segments).toEqual([]);
    expect(variant.flight_options).toHaveLength(4);
    expect(flightCheck?.status).toBe('pass');
    expect(result.render_contract_preview[0].notices_parsed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: '항공편 확정 안내',
        text: expect.stringContaining('항공사와 편명은 예약 시 최종 확정'),
      }),
    ]));
  });
});
