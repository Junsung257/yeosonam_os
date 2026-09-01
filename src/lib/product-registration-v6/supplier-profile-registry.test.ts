import { describe, expect, it } from 'vitest';

import {
  parseCatalogSegmentationProfileHints,
  resolveQualifiedSupplierLayoutProfile,
  supplierProfileBenchmarkQualification,
} from './supplier-profile-registry';

describe('supplier profile qualification', () => {
  it('allows only reviewed profiles with enough sections, lineages and no critical defects', () => {
    expect(supplierProfileBenchmarkQualification({
      passed: true,
      metrics: { sectionCount: 30, lineageCount: 10 },
      criticalFalsePublishCount: 0,
      exactMatchRate: 0.995,
    })).toEqual({ sectionCount: 30, lineageCount: 10, criticalFalsePublishCount: 0, exactMatchRate: 0.995 });
    expect(supplierProfileBenchmarkQualification({
      passed: true,
      metrics: { sectionCount: 29, lineageCount: 10 },
      criticalFalsePublishCount: 0,
      exactMatchRate: 1,
    })).toBeNull();
    expect(supplierProfileBenchmarkQualification({
      passed: true,
      metrics: { sectionCount: 40, lineageCount: 12 },
      criticalFalsePublishCount: 1,
      exactMatchRate: 1,
    })).toBeNull();
  });

  it('accepts only bounded literal header tokens', () => {
    expect(parseCatalogSegmentationProfileHints({
      product_header_tokens: ['상품 구분', '', 'A', '상품 구분', 'x'.repeat(81)],
    })).toEqual({ productHeaderTokens: ['상품 구분'] });
  });

  it('reads qualified internal profiles only through the service RPC boundary', async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      from(name: string) {
        expect(name).toBe('land_operators');
        return {
          select: async () => ({
            data: [{ id: 'supplier-1', name: '테스트랜드', aliases: [] }],
            error: null,
          }),
        };
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return {
          data: {
            id: 'profile-1',
            supplier_key: 'supplier-1',
            document_family: 'paste',
            profile_version: 'profile-v1',
            profile_hash: 'a'.repeat(64),
            segmentation_rules: { product_header_tokens: ['상품 구분'] },
            benchmark: {
              passed: true,
              metrics: { sectionCount: 30, lineageCount: 10 },
              critical_false_publish_count: 0,
              exact_match_rate: 0.995,
            },
          },
          error: null,
        };
      },
    } as never;

    await expect(resolveQualifiedSupplierLayoutProfile({
      supabase,
      tenantId: 'tenant-1',
      supplierName: '테스트랜드',
      documentFamily: 'paste',
    })).resolves.toMatchObject({
      reason: 'profile_qualified',
      profile: {
        id: 'profile-1',
        segmentationHints: { productHeaderTokens: ['상품 구분'] },
      },
    });
    expect(rpcCalls).toEqual([{
      name: 'get_qualified_product_registration_supplier_profile',
      args: {
        p_tenant_id: 'tenant-1',
        p_supplier_key: 'supplier-1',
        p_document_family: 'paste',
      },
    }]);
  });

  it('uses the generic parser while the read RPC is not yet in the schema cache', async () => {
    const supabase = {
      from() {
        return {
          select: async () => ({
            data: [{ id: 'supplier-1', name: '테스트랜드', aliases: [] }],
            error: null,
          }),
        };
      },
      async rpc() {
        return { data: null, error: { code: 'PGRST202', message: 'missing function' } };
      },
    } as never;

    await expect(resolveQualifiedSupplierLayoutProfile({
      supabase,
      tenantId: 'tenant-1',
      supplierName: '테스트랜드',
      documentFamily: 'paste',
    })).resolves.toMatchObject({ reason: 'profile_not_found', profile: null });
  });
});
