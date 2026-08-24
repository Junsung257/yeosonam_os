import { describe, expect, it, vi } from 'vitest';

import {
  loadAdminPackagePublicationTruth,
  requestProductRegistrationPublication,
} from './publication';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const HASH = 'a'.repeat(64);

describe('product registration publication authority', () => {
  it('normalizes the admin truth RPC without exposing raw revision payloads', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        tenant_id: TENANT_ID,
        catalog_product_id: 'catalog-1',
        product_key: 'supplier:product-1',
        package_id: 'package-1',
        latest_revision_id: 'revision-3',
        latest_revision_no: 3,
        latest_revision_status: 'verified',
        source_hash: HASH,
        pointer_state: 'published',
        pointer_version: 4,
        pointer_revision_id: 'revision-3',
        pointer_snapshot_id: 'snapshot-3',
        snapshot_status: 'published',
        snapshot_hash: HASH,
        renderer_build_id: 'build-1',
        proof_id: 'proof-1',
        proof_status: 'passed',
        customer_visibility_state: 'public',
        sale_state: 'available',
        actual_customer_public: true,
        blocker_codes: [],
        next_action: '현재 고객 공개 상태를 유지하고 정기 검증을 확인하세요.',
        canonical_payload: { internal: true },
      }],
      error: null,
    });

    const rows = await loadAdminPackagePublicationTruth({
      supabase: { rpc } as never,
      tenantId: TENANT_ID,
    });

    expect(rows).toEqual([expect.objectContaining({
      catalogProductId: 'catalog-1',
      latestRevisionNo: 3,
      actualCustomerPublic: true,
      blockerCodes: [],
    })]);
    expect(rows[0]).not.toHaveProperty('canonicalPayload');
  });

  it('creates a server-attributed three-channel publication request', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        request_id: 'request-1',
        status: 'requested',
        request_hash: HASH,
        replayed: false,
      },
      error: null,
    });

    const result = await requestProductRegistrationPublication({
      supabase: { rpc } as never,
      request: {
        tenantId: TENANT_ID,
        catalogProductId: 'catalog-1',
        packageId: 'package-1',
        expectedRevisionId: 'revision-3',
        expectedRevisionNo: 3,
        expectedSourceHash: HASH,
        expectedPointerVersions: { customer: 4, b2b: 2, partner: 2 },
        requestedBy: '11111111-1111-4111-8111-111111111111',
        requestedActor: 'owner@example.com',
        requestReason: '모바일 검수 완료',
        idempotencyKey: 'publish:catalog-1:revision-3',
      },
    });

    expect(result).toEqual({
      requestId: 'request-1',
      status: 'requested',
      requestHash: HASH,
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      'request_product_registration_publication',
      expect.objectContaining({
        p_payload: expect.objectContaining({
          channels: ['customer', 'b2b', 'partner'],
          requested_actor: 'owner@example.com',
          expected_pointer_versions: { customer: 4, b2b: 2, partner: 2 },
        }),
      }),
    );
  });
});
