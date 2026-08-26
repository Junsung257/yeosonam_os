import { describe, expect, it } from 'vitest';
import { createStructuredLogger, sanitizeLogContext } from './structured-logger.server';

describe('structured server logger', () => {
  it('redacts nested credentials and Korean PII before serialization', () => {
    const sanitized = sanitizeLogContext({
      authorization: 'Bearer top-secret-token',
      nested: {
        cookie: 'session=abc',
        note: '고객 010-1234-5678, test@example.com, 900101-1234567',
      },
    }) as Record<string, unknown>;

    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.nested).toEqual({
      cookie: '[REDACTED]',
      note: '[NAME] [PHONE], [EMAIL], [RESIDENT_ID]',
    });
  });

  it('redacts secret-shaped values even when the field name is harmless', () => {
    const sanitized = sanitizeLogContext({
      message: 'failed with Bearer abc.def.ghi and ysn_live_1234567890abcdef',
    }) as { message: string };

    expect(sanitized.message).not.toContain('abc.def.ghi');
    expect(sanitized.message).not.toContain('ysn_live_1234567890abcdef');
    expect(sanitized.message).toContain('[REDACTED]');
  });

  it('emits newline-delimited JSON without raw secrets', () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      level: 'info',
      destination: { write: chunk => lines.push(String(chunk)) },
    });

    logger.info({
      event: 'api.test',
      token: 'raw-token',
      customer_note: '010-9876-5432',
    });

    const entry = JSON.parse(lines.join('').trim()) as Record<string, unknown>;
    expect(entry.event).toBe('api.test');
    expect(entry.token).toBe('[REDACTED]');
    expect(entry.customer_note).toBe('[PHONE]');
    expect(lines.join('')).not.toContain('raw-token');
    expect(lines.join('')).not.toContain('010-9876-5432');
  });
});
