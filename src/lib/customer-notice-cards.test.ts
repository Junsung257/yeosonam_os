import { describe, expect, it } from 'vitest';
import { extractCustomerNoticeCards } from './customer-notice-cards';

describe('extractCustomerNoticeCards', () => {
  it('keeps customer-facing safety notices and removes internal-only rows', () => {
    expect(extractCustomerNoticeCards([
      {
        type: 'INFO',
        title: '항공편 확정 안내',
        text: '항공사와 편명은 예약 시 최종 확정됩니다.',
      },
      {
        type: 'PAYMENT',
        title: '변동 추가비용 확정 절차',
        text: '예약 확정 전에 금액을 안내하고 고객 동의를 받은 경우에만 반영합니다.',
      },
      {
        type: 'INTERNAL',
        title: '운영자 메모',
        text: '고객에게 노출하면 안 됩니다.',
      },
    ])).toEqual([
      {
        type: 'INFO',
        title: '항공편 확정 안내',
        text: '항공사와 편명은 예약 시 최종 확정됩니다.',
      },
      {
        type: 'PAYMENT',
        title: '변동 추가비용 확정 절차',
        text: '예약 확정 전에 금액을 안내하고 고객 동의를 받은 경우에만 반영합니다.',
      },
    ]);
  });

  it('supports legacy string notices without duplicating identical content', () => {
    expect(extractCustomerNoticeCards(['여권 유효기간을 확인해 주세요.', '여권 유효기간을 확인해 주세요.']))
      .toEqual([{
        type: 'INFO',
        title: '예약 전 안내',
        text: '여권 유효기간을 확인해 주세요.',
      }]);
  });
});
