import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/free-travel/book', () => {
  it('keeps direct free-travel booking disabled with external/manual alternatives', async () => {
    const response = await POST();
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toMatchObject({
      ok: false,
      code: 'FEATURE_NOT_ENABLED',
      feature: 'free_travel_direct_booking',
      phase: 1,
    });
    expect(json.message).toContain('마이리얼트립');
    expect(json.details.alternatives).toEqual(expect.arrayContaining([
      'mrt_external_booking',
      'yeosonam_package_consultation',
      'manual_follow_up',
    ]));
  });
});
