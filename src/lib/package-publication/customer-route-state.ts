import type { SupabaseClient } from '@supabase/supabase-js';

export type CustomerRouteState =
  | {
      state: 'PUBLIC';
      catalogProductId: string;
      packageId: string;
      revisionId: string;
      snapshotId: string;
      pointerVersion: number;
    }
  | {
      state: 'UNDER_REVIEW';
      catalogProductId: string;
      packageId: string;
      pointerVersion: number;
    }
  | { state: 'NOT_FOUND' }
  | { state: 'UNAVAILABLE' };

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}
function requiredString(row: JsonObject, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pointerVersion(row: JsonObject): number | null {
  const value = Number(row.pointer_version);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Lightweight publication preflight. The backing RPC resolves aliases,
 * pointer state, and visibility overlay without selecting snapshot_json.
 */
export async function resolveCustomerRouteState(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    packageRef: string;
    channel?: string;
    locale?: string;
  },
): Promise<CustomerRouteState> {
  const { data, error } = await supabase.rpc(
    'get_product_registration_customer_route_state',
    {
      p_tenant_id: input.tenantId,
      p_route_ref: input.packageRef,
      p_channel: input.channel ?? 'customer',
      p_locale: input.locale ?? 'ko-KR',
    },
  );
  if (error) return { state: 'UNAVAILABLE' };
  const row = asObject(data);
  const state = requiredString(row ?? {}, 'state');
  if (!row || state === 'NOT_FOUND') return { state: 'NOT_FOUND' };

  const catalogProductId = requiredString(row, 'catalog_product_id');
  const packageId = requiredString(row, 'package_id');
  const version = pointerVersion(row);
  if (!catalogProductId || !packageId || version === null) return { state: 'UNAVAILABLE' };
  if (state === 'UNDER_REVIEW') {
    return { state, catalogProductId, packageId, pointerVersion: version };
  }
  if (state !== 'PUBLIC') return { state: 'UNAVAILABLE' };
  const revisionId = requiredString(row, 'revision_id');
  const snapshotId = requiredString(row, 'snapshot_id');
  if (!revisionId || !snapshotId) return { state: 'UNAVAILABLE' };
  return {
    state,
    catalogProductId,
    packageId,
    revisionId,
    snapshotId,
    pointerVersion: version,
  };
}
