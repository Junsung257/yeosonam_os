import { describe, expect, it } from 'vitest';
import { renderPackage, type RenderPackageInput } from './render-contract';

describe('renderPackage ferry regression', () => {
  it('does not build flight headers for ferry products without a named vessel', () => {
    const pkg: RenderPackageInput = {
      title: '대마도 자연과 역사탐방 2일',
      product_type: 'cruise',
      airline: null,
      departure_airport: '부산',
      destination: '대마도',
      itinerary_data: {
        days: [
          {
            day: 1,
            regions: ['부산', '이즈하라'],
            schedule: [
              { activity: '부산 출발 / 이즈하라 향발 [약 2시간 20분 소요]' },
              { activity: '이즈하라 국제여객터미널 도착' },
            ],
          },
          {
            day: 2,
            regions: ['히타카츠', '부산'],
            schedule: [
              { activity: '히타카츠 출발 / 부산 향발 [약 1시간 30분 소요]' },
              { activity: '부산 도착' },
            ],
          },
        ],
      },
    };

    const view = renderPackage(pkg);

    expect(view.airlineHeader.flightNumber).toBeNull();
    expect(view.airlineHeader.airlineName).toBeNull();
    expect(view.flightHeader.outbound).toBeNull();
    expect(view.flightHeader.inbound).toBeNull();
    expect(view.cruiseSchedule).toEqual({
      outboundLabel: '부산 → 대마도',
      inboundLabel: '대마도 → 부산',
      vesselName: null,
      cabinNote: '다인실 기준',
    });
  });
});
