import { describe, expect, it } from 'vitest';
import {
  ADMIN_MISSION_DEFINITIONS,
  buildAdminMissionItems,
  filterActiveMissionItems,
  getMissionTotal,
  hasMenuAccess,
} from './admin-mission-control';
import type { AdminBadgeCounts } from './admin-mission-control';

const counts: AdminBadgeCounts = {
  pendingActions: 4,
  pendingPackages: 8,
  unmatchedPending: 16,
  paymentUnmatched: 32,
  ledgerDrift: 64,
  blogQueue: 128,
  computedAt: '2026-06-04T12:00:00.000Z',
};

describe('admin mission control registry', () => {
  it('defines each urgent mission once with stable ids', () => {
    expect(ADMIN_MISSION_DEFINITIONS.map((item) => item.id)).toEqual([
      'jarvis-actions',
      'payment-matching',
      'package-review',
      'attraction-matching',
      'blog-queue',
    ]);
  });

  it('maps badge counts into priority-sorted mission items', () => {
    const items = buildAdminMissionItems(counts);

    expect(items.map((item) => item.id)).toEqual([
      'jarvis-actions',
      'payment-matching',
      'package-review',
      'attraction-matching',
      'blog-queue',
    ]);
    expect(items.map((item) => item.count)).toEqual([4, 32, 8, 16, 128]);
  });

  it('keeps owner, domain, and SLO metadata on every urgent mission', () => {
    expect(ADMIN_MISSION_DEFINITIONS.map((item) => ({
      id: item.id,
      domain: item.domain,
      owner: item.owner,
      sloMinutes: item.sloMinutes,
    }))).toEqual([
      { id: 'jarvis-actions', domain: 'ai', owner: 'jarvis-ops', sloMinutes: 30 },
      { id: 'payment-matching', domain: 'finance', owner: 'finance-ops', sloMinutes: 30 },
      { id: 'package-review', domain: 'products', owner: 'product-ops', sloMinutes: 180 },
      { id: 'attraction-matching', domain: 'products', owner: 'content-data', sloMinutes: 240 },
      { id: 'blog-queue', domain: 'marketing', owner: 'marketing-ops', sloMinutes: 1440 },
    ]);
  });

  it('uses ledgerDrift as a compatibility fallback for payment matching', () => {
    const items = buildAdminMissionItems({
      ...counts,
      paymentUnmatched: undefined,
    });

    expect(items.find((item) => item.id === 'payment-matching')?.count).toBe(64);
  });

  it('filters out zero-count missions and role-blocked missions', () => {
    const activeForStaff = filterActiveMissionItems(buildAdminMissionItems(counts), 'tenant_staff');
    const activeForTenantAdmin = filterActiveMissionItems(buildAdminMissionItems(counts), 'tenant_admin');

    expect(activeForStaff.map((item) => item.id)).toEqual([
      'package-review',
      'attraction-matching',
      'blog-queue',
    ]);
    expect(activeForTenantAdmin.map((item) => item.id)).toEqual([
      'jarvis-actions',
      'payment-matching',
      'package-review',
      'attraction-matching',
      'blog-queue',
    ]);

    const zeroed = filterActiveMissionItems(buildAdminMissionItems({
      ...counts,
      blogQueue: 0,
    }), 'tenant_admin');
    expect(zeroed.map((item) => item.id)).not.toContain('blog-queue');
  });

  it('sums visible mission work only', () => {
    const active = filterActiveMissionItems(buildAdminMissionItems(counts), 'tenant_staff');

    expect(getMissionTotal(active)).toBe(8 + 16 + 128);
  });

  it('enforces the role hierarchy consistently', () => {
    expect(hasMenuAccess('tenant_staff', undefined)).toBe(true);
    expect(hasMenuAccess('tenant_staff', 'tenant_admin')).toBe(false);
    expect(hasMenuAccess('tenant_admin', 'tenant_staff')).toBe(true);
    expect(hasMenuAccess('platform_admin', 'tenant_admin')).toBe(true);
    expect(hasMenuAccess(undefined, 'tenant_staff')).toBe(false);
  });
});
