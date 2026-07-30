export type TrustedAdminRole = 'platform_admin' | 'tenant_admin' | 'tenant_staff' | 'unknown';

function appMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const value = payload.app_metadata;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Authorization claims must only come from server-controlled app_metadata. */
export function inferTrustedAdminRole(payload: Record<string, unknown>): TrustedAdminRole {
  const role = appMetadata(payload)?.role;
  if (typeof role !== 'string') return 'unknown';
  const normalized = role.trim().toLowerCase();
  if (normalized === 'platform_admin' || normalized === 'platform' || normalized === 'admin') return 'platform_admin';
  if (normalized === 'tenant_admin') return 'tenant_admin';
  if (normalized === 'tenant_staff' || normalized === 'staff') return 'tenant_staff';
  return 'unknown';
}

export function inferTrustedTenantId(payload: Record<string, unknown>): string | undefined {
  const metadata = appMetadata(payload);
  const tenantId = metadata?.tenant_id ?? metadata?.tenantId;
  return typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : undefined;
}
