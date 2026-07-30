import { describe, expect, it } from 'vitest';
import { readAdminDashboardList } from './admin-dashboard-response';

describe('readAdminDashboardList', () => {
  it('reads the standardized listResponse payload and its exact total', () => {
    expect(readAdminDashboardList({
      data: [{ id: 'a' }, { id: 'b' }],
      pagination: { total: 27 },
    })).toEqual({ rows: [{ id: 'a' }, { id: 'b' }], total: 27 });
  });

  it('keeps compatibility with the legacy packages payload', () => {
    expect(readAdminDashboardList({ packages: [{ id: 'legacy' }] }))
      .toEqual({ rows: [{ id: 'legacy' }], total: 1 });
  });

  it('returns an honest empty result for malformed success payloads', () => {
    expect(readAdminDashboardList({})).toEqual({ rows: [], total: 0 });
  });
});
