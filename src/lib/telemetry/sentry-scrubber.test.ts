import { describe, expect, it } from 'vitest';
import { scrubSentryEvent } from './sentry-scrubber';

describe('Sentry event scrubber', () => {
  it('redacts credentials and Korean PII recursively', () => {
    const result = scrubSentryEvent({
      request: {
        headers: { authorization: 'Bearer secret-token', cookie: 'session=abc' },
        data: '고객 010-1234-5678 / person@example.com / M12345678',
      },
      user: { id: 'safe-user-id', email: 'person@example.com', ip_address: '127.0.0.1' },
      extra: { api_key: 'sk-example-secret-value' },
    });

    expect(result.request.headers).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
    });
    expect(result.request.data).toContain('[PHONE]');
    expect(result.request.data).toContain('[EMAIL]');
    expect(result.request.data).toContain('[PASSPORT]');
    expect(result.user).toEqual({
      id: 'safe-user-id',
      email: '[REDACTED]',
      ip_address: '[REDACTED]',
    });
    expect(result.extra.api_key).toBe('[REDACTED]');
  });

  it('bounds cyclic and oversized payloads', () => {
    const cyclic: Record<string, unknown> = { message: 'x'.repeat(5_000) };
    cyclic.self = cyclic;

    const result = scrubSentryEvent(cyclic);
    expect(result.message).toMatch(/\[truncated\]$/);
    expect(result.self).toBe('[CIRCULAR]');
  });

  it('redacts common OAuth and API credential field names', () => {
    const result = scrubSentryEvent({
      access_token: 'access-value',
      refreshToken: 'refresh-value',
      client_secret: 'client-value',
      'x-api-key': 'api-value',
      service_role_key: 'service-value',
    });

    expect(result).toEqual({
      access_token: '[REDACTED]',
      refreshToken: '[REDACTED]',
      client_secret: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      service_role_key: '[REDACTED]',
    });
  });
});
