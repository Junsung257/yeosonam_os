import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  sendMetaConversion: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/meta-conversions', () => ({
  sendMetaConversion: mocks.sendMetaConversion,
}));
vi.mock('@/lib/rate-limiter', () => ({
  rateLimit: mocks.rateLimit,
}));

import { POST } from './route';

describe('POST /api/tracking/meta-conversion privacy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(null);
    mocks.sendMetaConversion.mockResolvedValue({ ok: true });
  });

  it('drops client-supplied PII and query strings before Meta delivery', async () => {
    const request = new NextRequest('http://localhost/api/tracking/meta-conversion', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        referer: 'http://localhost/packages/pkg-1?email=person@example.com',
        cookie: 'ys_marketing_consent=true',
      },
      body: JSON.stringify({
        event_name: 'Lead',
        event_id: 'ys:Lead:event-1',
        event_source_url: 'https://attacker.example/path?phone=01012345678',
        content_name: 'person@example.com',
        email: 'person@example.com',
        phone: '010-1234-5678',
        test_event_code: 'CLIENT_CONTROLLED',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.sendMetaConversion).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'Lead',
      eventId: 'ys:Lead:event-1',
      eventSourceUrl: 'http://localhost/packages/pkg-1',
      contentName: null,
      email: null,
      phone: null,
      testEventCode: null,
      consentGranted: true,
    }));
  });
});
