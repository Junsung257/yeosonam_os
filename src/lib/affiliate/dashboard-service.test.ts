import { describe, expect, it } from 'vitest';
import {
  buildSubIdTrackingUrl,
  calculateClickToBookingRate,
  resolveAttributionMethod,
  summarizeCommissions,
} from './dashboard-service';

describe('affiliate dashboard service helpers', () => {
  describe('resolveAttributionMethod', () => {
    it('prefers promo-code attribution when a booking has a promo owner', () => {
      expect(resolveAttributionMethod({
        id: 'b1',
        promo_code: 'SAVE10',
        promo_affiliate_id: 'aff-1',
        attribution_model: 'promo_priority',
      })).toEqual({
        method: 'promo_code',
        label: 'Promo code',
        detail: 'SAVE10',
        model: 'promo_priority',
      });
    });

    it('uses attribution snapshot source before referral-code fallback', () => {
      expect(resolveAttributionMethod({
        id: 'b2',
        referral_code: 'REF123',
        attribution_snapshot: { source: 'cookie', method: 'first_touch' },
      })).toEqual({
        method: 'cookie',
        label: 'Cookie',
        detail: 'first_touch',
        model: 'first_touch',
      });
    });

    it('falls back to referral link and then manual attribution', () => {
      expect(resolveAttributionMethod({ id: 'b3', referral_code: 'REF123' })).toEqual({
        method: 'referral_link',
        label: 'Referral link',
        detail: 'REF123',
        model: 'last_touch',
      });

      expect(resolveAttributionMethod({ id: 'b4' })).toEqual({
        method: 'manual',
        label: 'Manual attribution',
        detail: '',
        model: 'last_touch',
      });
    });
  });

  describe('summarizeCommissions', () => {
    it('summarizes totals and status buckets', () => {
      const summary = summarizeCommissions([
        { id: 's1', status: 'READY', total_amount: 100000, final_payout: 90000 },
        { id: 's2', status: 'COMPLETED', total_amount: 50000, final_payout: 45000 },
        { id: 's3', status: 'PENDING', total_amount: 20000, final_payout: 0 },
        { id: 's4', status: 'HOLD', total_amount: 30000, final_payout: 0 },
      ]);

      expect(summary.total_gross).toBe(200000);
      expect(summary.total_payout).toBe(135000);
      expect(summary.pending_amount).toBe(50000);
      expect(summary.ready_payout).toBe(90000);
      expect(summary.completed_payout).toBe(45000);
      expect(summary.by_status.READY).toEqual({ count: 1, total_amount: 100000, final_payout: 90000 });
    });
  });

  it('builds encoded Sub-ID tracking URLs', () => {
    expect(buildSubIdTrackingUrl('https://example.com', 'REF 123', 'kakao banner')).toBe(
      'https://example.com/with/REF%20123?sub_id=kakao%20banner',
    );
  });

  it('calculates click-to-booking rate with zero-click protection', () => {
    expect(calculateClickToBookingRate(40, 5)).toBe(12.5);
    expect(calculateClickToBookingRate(0, 5)).toBe(0);
  });
});
