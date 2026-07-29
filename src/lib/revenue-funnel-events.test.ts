import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: { from: mocks.from },
}));

import {
  persistRevenueFunnelEvent,
  validateRevenueFunnelEventInput,
} from './revenue-funnel-events';

describe('revenue funnel event ledger', () => {
  beforeEach(() => {
    mocks.upsert.mockReset().mockResolvedValue({ error: null });
    mocks.from.mockReset().mockReturnValue({ upsert: mocks.upsert });
  });

  it('normalizes the bounded attribution fields and drops unknown PII fields', () => {
    const result = validateRevenueFunnelEventInput({
      eventType: 'kakao_clicked',
      source: 'meta',
      offerId: '11111111-1111-4111-8111-111111111111',
      consentState: 'not_required',
      dedupeKey: 'kakao:session:offer',
      medium: 'paid_social',
      clickIds: { fbclid: 'real-click-id', invented: 'do-not-store' },
      name: 'must not be stored',
      phone: '010-0000-0000',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clickIds).toEqual({ fbclid: 'real-click-id' });
    expect(result.value).not.toHaveProperty('name');
    expect(result.value).not.toHaveProperty('phone');
  });

  it('uses one canonical source + dedupe key conflict target', async () => {
    await persistRevenueFunnelEvent({
      eventType: 'offer_viewed',
      source: 'direct',
      offerId: '11111111-1111-4111-8111-111111111111',
      sessionId: 'session-1',
      consentState: 'not_required',
      dedupeKey: 'offer_viewed:session-1:offer-1',
    });

    expect(mocks.from).toHaveBeenCalledWith('customer_events');
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'offer_viewed',
        source: 'direct',
        dedupe_key: 'offer_viewed:session-1:offer-1',
      }),
      {
        onConflict: 'source,dedupe_key',
        ignoreDuplicates: true,
      },
    );
  });

  it('rejects unsupported event names and malformed identifiers', () => {
    expect(validateRevenueFunnelEventInput({
      eventType: 'ad_budget_mutated',
      source: 'meta',
      consentState: 'unknown',
      dedupeKey: 'x',
    })).toMatchObject({ ok: false, code: 'INVALID_EVENT' });

    expect(validateRevenueFunnelEventInput({
      eventType: 'offer_viewed',
      source: 'direct',
      offerId: 'not-a-uuid',
      consentState: 'not_required',
      dedupeKey: 'x',
    })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });

  it('fails closed without throwing into the lead submission path', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(persistRevenueFunnelEvent({
      eventType: 'lead_submitted',
      source: 'direct',
      consentState: 'granted',
      dedupeKey: 'lead_submitted:lead-1',
    })).resolves.toMatchObject({ ok: false });
  });
});
