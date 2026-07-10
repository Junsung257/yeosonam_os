import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPublicPackageSnapshotAndDecision } from './repository';

type RpcResult = {
  rpcError?: Error | null;
};

function makeSupabaseMock(result: RpcResult = {}) {
  const calls: Array<{ name: string; payload?: Record<string, unknown> }> = [];
  const supabase = {
    rpc(name: string, payload: Record<string, unknown>) {
      calls.push({ name, payload });
      return Promise.resolve({ data: { ok: true }, error: result.rpcError ?? null });
    },
  };

  return { supabase, calls };
}

function publishablePackage(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    package_revision: 3,
    title: 'Tokyo 3 nights',
    destination: 'Tokyo',
    duration: 4,
    nights: 3,
    price: 1_099_000,
    product_prices: [
      { target_date: '2026-08-07', adult_selling_price: 1_099_000, note: 'save fare' },
    ],
    price_dates: [
      { date: '2026-08-07', price: 1_099_000, confirmed: false },
    ],
    inclusions: ['Round-trip airfare and TAX'],
    excludes: ['Guide fee 40,000 KRW'],
    optional_tours: [],
    itinerary_data: { days: [{ day: 1, schedule: [{ activity: 'Odaiba sightseeing' }] }] },
    ...overrides,
  };
}

describe('createPublicPackageSnapshotAndDecision', () => {
  it('publishes snapshot, decision, and package final state through one atomic RPC', async () => {
    const { supabase, calls } = makeSupabaseMock();

    const result = await createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage(),
      {},
      {
        packagePatch: {
          status: 'active',
          audit_status: 'clean',
          audit_report: { customer_open_contract: { ok: true } },
        },
      },
    );

    expect(result.publishable).toBe(true);
    expect(result.publicationState).toBe('published');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('publish_package_snapshot_atomic');
    expect(calls[0].payload).toMatchObject({
      p_package_id: '11111111-1111-4111-8111-111111111111',
      p_package_revision: 3,
      p_publication_state: 'published',
      p_publishable: true,
      p_snapshot_status: 'published',
      p_decision_source: 'publish_gate_v1',
      p_package_patch: expect.objectContaining({
        status: 'active',
        publication_state: 'published',
        package_revision: 3,
        audit_status: 'clean',
      }),
    });
  });

  it('throws when the atomic publication RPC fails', async () => {
    const { supabase, calls } = makeSupabaseMock({
      rpcError: new Error('atomic publish failed'),
    });

    await expect(createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage(),
    )).rejects.toThrow('atomic publish failed');

    expect(calls.map(call => call.name)).toEqual(['publish_package_snapshot_atomic']);
  });

  it('ships an RPC migration that atomically writes snapshot, decision, and package state', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260710153000_atomic_package_publication_rpc.sql'),
      'utf8',
    );
    const body = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.publish_package_snapshot_atomic'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.publish_package_snapshot_atomic'),
    );

    expect(sql).toContain('LANGUAGE plpgsql');
    expect(sql).toContain('SECURITY INVOKER');
    expect(body).toContain('INSERT INTO public.public_package_snapshots');
    expect(body).toContain('INSERT INTO public.package_publish_decisions');
    expect(body).toContain('UPDATE public.travel_packages AS tp');
    expect(body).toContain('GET DIAGNOSTICS v_updated_count = ROW_COUNT');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.publish_package_snapshot_atomic');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.publish_package_snapshot_atomic');
    expect(sql).toContain('TO service_role');
    expect(sql).not.toContain('SECURITY DEFINER');
  });
});
