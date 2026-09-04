import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const supabaseMocks = vi.hoisted(() => ({
  configured: false,
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return supabaseMocks.configured;
  },
  supabaseAdmin: {
    rpc: supabaseMocks.rpc,
  },
}));

import { GET } from './route';

function request(window = '7d', admin = true): NextRequest {
  return new NextRequest(`http://localhost/api/admin/agent/office/kpi?window=${window}`, {
    headers: admin ? { cookie: 'ys-dev-admin=1' } : undefined,
  });
}

describe('/api/admin/agent/office/kpi', () => {
  beforeEach(() => {
    supabaseMocks.configured = false;
    supabaseMocks.rpc.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects unauthenticated requests before the aggregate RPC', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await GET(request('7d', false));
    expect(response.status).toBe(401);
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('reports the KPI contract as unavailable until the migration is applied', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const response = await GET(request('30d'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'unavailable', reason: 'SUPABASE_NOT_CONFIGURED' });
    expect(body.metrics).toHaveLength(8);
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('maps a missing Preview RPC to a safe, explicit unavailable result', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    supabaseMocks.configured = true;
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });

    const response = await GET(request('24h'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'unavailable', reason: 'KPI_RPC_NOT_APPLIED' });
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('get_agent_office_kpi_v1', expect.objectContaining({
      p_window_start: expect.any(String),
      p_window_end: expect.any(String),
    }));
  });

  it('normalizes valid RPC rows into the versioned snapshot', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    supabaseMocks.configured = true;
    supabaseMocks.rpc.mockResolvedValue({
      data: [{
        metric_key: 'agent.tasks.completed',
        value: '3',
        source_updated_at: '2026-09-04T00:00:00.000Z',
      }],
      error: null,
    });

    const response = await GET(request('7d'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: 'agent-office-kpi-snapshot-v1',
      calculationVersion: 'agent-office-kpi-v1',
      status: 'available',
    });
    expect(body.metrics.find((metric: { key: string }) => metric.key === 'agent.tasks.completed')).toMatchObject({
      value: 3,
      status: 'available',
    });
  });
});
