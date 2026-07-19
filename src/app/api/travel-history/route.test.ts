import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabase: vi.fn(),
  sanitizeDbError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : 'travel history lookup failed',
  ),
}));

vi.mock('@/lib/supabase', () => ({ getSupabase: mocks.getSupabase }));
vi.mock('@/lib/error-sanitizer', () => ({ sanitizeDbError: mocks.sanitizeDbError }));

import { GET } from './route';

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function noStore(response: Response) {
  return response.headers.get('cache-control') ?? '';
}

describe('GET /api/travel-history', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose mock travel histories when Supabase is unavailable', async () => {
    mocks.getSupabase.mockReturnValueOnce(null);

    const response = await GET();
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(noStore(response)).toContain('no-store');
    expect(body.histories).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('mock-');
  });

  it('returns an empty private response for anonymous users', async () => {
    mocks.getSupabase.mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(noStore(response)).toContain('no-store');
    expect(await json(response)).toEqual({ histories: [] });
  });

  it('looks up customer by email and returns only real travel history rows', async () => {
    const customerQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: 'customer-1' }], error: null }),
    };
    const histories = [
      {
        id: 'history-1',
        customer_id: 'customer-1',
        destination: '오사카',
      },
    ];
    const historyQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: histories, error: null }),
    };
    const from = vi.fn((table: string) => (table === 'customers' ? customerQuery : historyQuery));
    mocks.getSupabase.mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1', email: 'guest@example.com', phone: null } },
        }),
      },
      from,
    });

    const response = await GET();
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(noStore(response)).toContain('no-store');
    expect(customerQuery.eq).toHaveBeenCalledWith('email', 'guest@example.com');
    expect(historyQuery.eq).toHaveBeenCalledWith('customer_id', 'customer-1');
    expect(body.histories).toEqual(histories);
  });

  it('surfaces database lookup failures instead of silently caching an empty passport', async () => {
    const customerQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: new Error('customers failed') }),
    };
    mocks.getSupabase.mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1', email: 'guest@example.com', phone: null } },
        }),
      },
      from: vi.fn(() => customerQuery),
    });

    const response = await GET();
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(noStore(response)).toContain('no-store');
    expect(body).toEqual({
      histories: [],
      error: 'TRAVEL_HISTORY_LOOKUP_FAILED',
    });
  });
});
