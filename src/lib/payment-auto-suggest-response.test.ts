import { describe, expect, it } from 'vitest';
import {
  extractPaymentAutoSuggestResponse,
  getPaymentApiErrorMessage,
} from './payment-auto-suggest-response';

describe('payment auto-suggest API response', () => {
  it('unwraps the standardized response envelope', () => {
    expect(extractPaymentAutoSuggestResponse({
      ok: true,
      data: { type: 'inflow', candidates: [] },
    })).toEqual({ type: 'inflow', candidates: [] });
  });

  it('keeps compatibility with the legacy root payload', () => {
    expect(extractPaymentAutoSuggestResponse({
      type: 'outflow',
      candidates: [{ kind: 'settlement_bundle' }],
    })).toEqual({ type: 'outflow', candidates: [{ kind: 'settlement_bundle' }] });
  });

  it('returns null for an error or malformed payload', () => {
    expect(extractPaymentAutoSuggestResponse({ ok: false, error: { message: 'unauthorized' } })).toBeNull();
    expect(extractPaymentAutoSuggestResponse({ ok: true, data: {} })).toBeNull();
  });

  it('reads both string and structured API errors', () => {
    expect(getPaymentApiErrorMessage({ error: '실패' }, '기본')).toBe('실패');
    expect(getPaymentApiErrorMessage({ error: { message: '권한 없음' } }, '기본')).toBe('권한 없음');
    expect(getPaymentApiErrorMessage({}, '기본')).toBe('기본');
  });
});
