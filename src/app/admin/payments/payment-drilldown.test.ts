import { describe, expect, it } from 'vitest';
import { parsePaymentTab, paymentTabHref, transactionMatchesDateFilter } from './payment-drilldown';

describe('payment dashboard drilldown', () => {
  it('keeps receivables and unmatched deposits as distinct work queues', () => {
    expect(parsePaymentTab(new URLSearchParams('filter=outstanding'))).toBe('outstanding');
    expect(parsePaymentTab(new URLSearchParams('filter=unmatched'))).toBe('unmatched');
  });

  it('parses explicit tabs and rejects unknown values', () => {
    expect(parsePaymentTab(new URLSearchParams('tab=outflow'))).toBe('outflow');
    expect(parsePaymentTab(new URLSearchParams('tab=wrong'))).toBe('review');
  });

  it('creates a history-safe tab URL without stale drilldown targets', () => {
    expect(paymentTabHref('/admin/payments', new URLSearchParams('filter=outstanding&tx=1&booking=2'), 'matched'))
      .toBe('/admin/payments?tab=matched');
  });

  it('applies the visible payment date filter by calendar month', () => {
    const now = new Date(2026, 6, 23, 12);
    expect(transactionMatchesDateFilter(new Date(2026, 6, 1, 0).toISOString(), '이번 달', now)).toBe(true);
    expect(transactionMatchesDateFilter(new Date(2026, 5, 30, 23).toISOString(), '이번 달', now)).toBe(false);
    expect(transactionMatchesDateFilter(new Date(2026, 5, 10, 12).toISOString(), '지난 달', now)).toBe(true);
    expect(transactionMatchesDateFilter(new Date(2026, 4, 1, 0).toISOString(), '3개월', now)).toBe(true);
    expect(transactionMatchesDateFilter('invalid', '전체', now)).toBe(true);
  });
});
