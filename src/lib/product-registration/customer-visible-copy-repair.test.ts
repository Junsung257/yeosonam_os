import { describe, expect, it } from 'vitest';

import { blockingCustomerVisibleTextIssues } from '@/lib/customer-visible-text-audit';
import { repairCustomerVisibleCopyPayload } from './customer-visible-copy-repair';

describe('repairCustomerVisibleCopyPayload', () => {
  it('normalizes safe supplier copy without dropping the product payload', () => {
    const result = repairCustomerVisibleCopyPayload({
      excludes: ['RMK 불 포 함 / 쇼 핑 2회 / P.P $60 / \\1,000 추가 됩니다.'],
    });

    expect(result.value).toEqual({
      excludes: ['참고사항 불포함 / 쇼핑 2회 / 1인 $60 / 1,000 추가됩니다.'],
    });
    expect(blockingCustomerVisibleTextIssues(result.value)).toEqual([]);
  });

  it('removes only unsafe schedule items and keeps usable itinerary rows', () => {
    const result = repairCustomerVisibleCopyPayload({
      itinerary_data: {
        days: [
          {
            day: 1,
            schedule: [
              { activity: '랜드사 NET 기준 수배 후 컨펌되면 인폼 나가주세요', type: 'normal' },
              { activity: '다낭 시내 관광', type: 'attraction' },
              { activity: '????', type: 'normal' },
            ],
          },
        ],
      },
    });

    expect(result.value).toEqual({
      itinerary_data: {
        days: [
          {
            day: 1,
            schedule: [
              { activity: '다낭 시내 관광', type: 'attraction' },
            ],
          },
        ],
      },
    });
    expect(blockingCustomerVisibleTextIssues(result.value)).toEqual([]);
  });
});
