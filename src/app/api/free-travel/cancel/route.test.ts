import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/free-travel/cancel', () => {
  it('keeps direct free-travel cancellation disabled and points to the booking platform', async () => {
    const response = await POST();
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toMatchObject({
      ok: false,
      code: 'FEATURE_NOT_ENABLED',
      feature: 'free_travel_direct_cancel',
      phase: 1,
    });
    expect(json.message).toContain('실제 예약을 완료한 플랫폼');
    expect(json.details.alternatives).toEqual(expect.arrayContaining([
      'provider_external_cancel',
      'manual_follow_up',
    ]));
  });
});
