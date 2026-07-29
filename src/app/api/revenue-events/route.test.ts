import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  validate: vi.fn(),
  persist: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  rateLimitMutation: mocks.rateLimit,
}));

vi.mock('@/lib/revenue-funnel-events', () => ({
  validateRevenueFunnelEventInput: mocks.validate,
  persistRevenueFunnelEvent: mocks.persist,
}));

import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/revenue-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

describe('POST /api/revenue-events', () => {
  beforeEach(() => {
    mocks.rateLimit.mockReset().mockResolvedValue(null);
    mocks.validate.mockReset();
    mocks.persist.mockReset();
  });

  it('accepts a validated canonical event with no-store', async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        eventType: 'kakao_clicked',
        source: 'direct',
        consentState: 'unknown',
        dedupeKey: 'click-1',
      },
    });
    mocks.persist.mockResolvedValue({ ok: true });

    const response = await POST(request({ eventType: 'kakao_clicked' }));

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it('rejects invalid events before persistence', async () => {
    mocks.validate.mockReturnValue({
      ok: false,
      code: 'INVALID_EVENT',
      message: '지원하지 않는 이벤트입니다.',
    });

    const response = await POST(request({ eventType: 'ad_budget_mutated' }));

    expect(response.status).toBe(400);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('returns a stable error without exposing database details', async () => {
    mocks.validate.mockReturnValue({
      ok: true,
      value: {
        eventType: 'offer_viewed',
        source: 'direct',
        consentState: 'unknown',
        dedupeKey: 'view-1',
      },
    });
    mocks.persist.mockResolvedValue({ ok: false, error: new Error('postgres secret detail') });

    const response = await POST(request({ eventType: 'offer_viewed' }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('EVENT_SAVE_FAILED');
    expect(JSON.stringify(body)).not.toContain('postgres secret detail');
  });
});
