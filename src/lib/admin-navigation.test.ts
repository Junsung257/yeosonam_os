import { describe, expect, it } from 'vitest';
import {
  adminNavGroups,
  allAdminNavItems,
  filterNavGroups,
  flattenNavItems,
  getNavItemBadge,
} from './admin-navigation';
import type { AdminBadgeCounts } from './admin-mission-control';

const counts: AdminBadgeCounts = {
  pendingActions: 2,
  pendingPackages: 3,
  unmatchedPending: 5,
  paymentUnmatched: 7,
  ledgerDrift: 11,
  blogQueue: 13,
};

function findItem(href: string) {
  const item = allAdminNavItems.find((navItem) => navItem.href === href);
  if (!item) throw new Error(`Missing nav item: ${href}`);
  return item;
}

describe('admin navigation registry', () => {
  it('keeps the sidebar source flattenable and unique by href', () => {
    const flattened = flattenNavItems(adminNavGroups);
    const hrefs = flattened.map((item) => item.href);

    expect(flattened.length).toBeGreaterThan(40);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(allAdminNavItems.map((item) => item.href)).toEqual(hrefs);
  });

  it('keeps task queues discoverable from the route registry', () => {
    expect(findItem('/admin/packages?status=pending').badgeKey).toBe('pendingPackages');
    expect(findItem('/admin/attractions/unmatched').badgeKey).toBe('unmatchedPending');
    expect(findItem('/admin/payments').badgeKey).toBe('paymentUnmatched');
    expect(findItem('/admin/blog/queue').badgeKey).toBe('blogQueue');
    expect(findItem('/admin/jarvis').badgeKey).toBe('pendingActions');
  });

  it('resolves nav badges from metadata rather than route-specific conditionals', () => {
    expect(getNavItemBadge(findItem('/admin/packages?status=pending'), counts)).toBe(3);
    expect(getNavItemBadge(findItem('/admin/attractions/unmatched'), counts)).toBe(5);
    expect(getNavItemBadge(findItem('/admin/payments'), counts)).toBe(7);
    expect(getNavItemBadge(findItem('/admin/blog/queue'), counts)).toBe(13);
    expect(getNavItemBadge(findItem('/admin/jarvis'), counts)).toBe(2);
  });

  it('falls back to ledgerDrift for payment badge during mixed deployments', () => {
    expect(getNavItemBadge(findItem('/admin/payments'), {
      ...counts,
      paymentUnmatched: undefined,
    })).toBe(11);
  });

  it('hides zero badges', () => {
    expect(getNavItemBadge(findItem('/admin/blog/queue'), {
      ...counts,
      blogQueue: 0,
    })).toBeUndefined();
  });

  it('filters menu groups by role without leaking tenant or platform-only routes', () => {
    const staffHrefs = flattenNavItems(filterNavGroups(adminNavGroups, 'tenant_staff')).map((item) => item.href);
    const tenantHrefs = flattenNavItems(filterNavGroups(adminNavGroups, 'tenant_admin')).map((item) => item.href);
    const platformHrefs = flattenNavItems(filterNavGroups(adminNavGroups, 'platform_admin')).map((item) => item.href);

    expect(staffHrefs).toContain('/admin');
    expect(staffHrefs).not.toContain('/admin/payments');
    expect(staffHrefs).not.toContain('/admin/control-tower');

    expect(tenantHrefs).toContain('/admin/payments');
    expect(tenantHrefs).toContain('/admin/jarvis');
    expect(tenantHrefs).not.toContain('/admin/control-tower');

    expect(platformHrefs).toContain('/admin/control-tower');
    expect(platformHrefs).toContain('/admin/platform-learning');
  });

  it('adds search metadata to operational queue routes', () => {
    const payment = findItem('/admin/payments');
    const attractions = findItem('/admin/attractions/unmatched');

    expect(payment.primaryAction).toBe('수동 매칭');
    expect(payment.searchKeywords).toContain('미매칭 입금');
    expect(attractions.primaryAction).toBe('DB 연결');
    expect(attractions.searchKeywords).toContain('미매칭 관광지');
  });
});
