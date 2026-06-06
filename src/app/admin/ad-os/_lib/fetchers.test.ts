import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAdminSurfaceQa,
  fetchOperatingInventory,
  fetchStagingSmoke,
  fetchStagingValidation,
  fetchSummary,
} from './fetchers';

function mockFetch(payload: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ad-os fetchers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps page fetch endpoints centralized', async () => {
    const payload = { ok: true, channel_budgets: [] };
    const fetchMock = mockFetch(payload);

    await expect(fetchSummary()).resolves.toBe(payload);

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/ad-os/summary');
  });

  it('rejects summary-like endpoints when ok is false', async () => {
    mockFetch({ ok: false, error: 'blocked' });

    await expect(fetchSummary()).rejects.toThrow('blocked');
  });

  it('rejects with HTTP status when an endpoint returns invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new SyntaxError('bad json')),
    }));

    await expect(fetchSummary()).rejects.toThrow('HTTP 502');
  });

  it('keeps safety validation fetchers on read-only status endpoints', async () => {
    mockFetch({ ok: true });

    await fetchStagingSmoke();
    await fetchOperatingInventory();
    await fetchStagingValidation();
    await fetchAdminSurfaceQa();

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/admin/ad-os/staging-smoke');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/ad-os/operating-inventory');
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/admin/ad-os/staging-validation');
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/admin/ad-os/admin-surface-qa');
  });

  it('preserves staging validation behavior that only requires an HTTP ok response', async () => {
    const payload = { ok: false, validation: { status: 'fail' } };
    mockFetch(payload);

    await expect(fetchStagingValidation()).resolves.toBe(payload);
  });
});
