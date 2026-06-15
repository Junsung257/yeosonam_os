import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeCustomerPackageForClient } from './customer-package-payload';

describe('customer package client payload', () => {
  it('removes internal source, audit, and margin fields before client serialization', () => {
    const sanitized = sanitizeCustomerPackageForClient({
      id: 'pkg-1',
      title: '고객 상품',
      price: 1_290_000,
      raw_text: 'supplier raw source',
      raw_text_hash: 'hash',
      internal_notes: 'staff only',
      special_notes: 'supplier remark',
      land_operator_id: 'land-1',
      audit_status: 'clean',
      audit_report: { score: 90 },
      agent_audit_report: { score: 80 },
      parser_version: 'v1',
      parsed_data: { private: true },
      embedding: [0.1, 0.2],
      tenant_id: 'tenant-1',
      created_by: 'admin-1',
      net_price: 900_000,
      usd_cost: 700,
      margin_rate: 0.2,
      selling_price: 1_290_000,
      departing_location_id: 'dep-1',
      catalog_id: 'catalog-1',
      commission_rate: 9,
      data_completeness: 80,
      products: {
        internal_code: 'PUS-CEB-001',
        display_name: '세부',
        net_price: 900_000,
        margin_rate: 0.2,
        selling_price: 1_290_000,
      },
    });

    expect(sanitized).toMatchObject({
      id: 'pkg-1',
      title: '고객 상품',
      price: 1_290_000,
      products: {
        internal_code: 'PUS-CEB-001',
        display_name: '세부',
      },
    });
    expect(sanitized).not.toHaveProperty('raw_text');
    expect(sanitized).not.toHaveProperty('raw_text_hash');
    expect(sanitized).not.toHaveProperty('internal_notes');
    expect(sanitized).not.toHaveProperty('special_notes');
    expect(sanitized).not.toHaveProperty('land_operator_id');
    expect(sanitized).not.toHaveProperty('audit_status');
    expect(sanitized).not.toHaveProperty('audit_report');
    expect(sanitized).not.toHaveProperty('agent_audit_report');
    expect(sanitized).not.toHaveProperty('parser_version');
    expect(sanitized).not.toHaveProperty('parsed_data');
    expect(sanitized).not.toHaveProperty('embedding');
    expect(sanitized).not.toHaveProperty('tenant_id');
    expect(sanitized).not.toHaveProperty('created_by');
    expect(sanitized).not.toHaveProperty('net_price');
    expect(sanitized).not.toHaveProperty('usd_cost');
    expect(sanitized).not.toHaveProperty('margin_rate');
    expect(sanitized).not.toHaveProperty('selling_price');
    expect(sanitized).not.toHaveProperty('departing_location_id');
    expect(sanitized).not.toHaveProperty('catalog_id');
    expect(sanitized).not.toHaveProperty('commission_rate');
    expect(sanitized).not.toHaveProperty('data_completeness');
    expect(sanitized?.products as Record<string, unknown>).not.toHaveProperty('net_price');
    expect(sanitized?.products as Record<string, unknown>).not.toHaveProperty('margin_rate');
    expect(sanitized?.products as Record<string, unknown>).not.toHaveProperty('selling_price');
  });

  it('strips margin fields from nested product arrays as well as objects', () => {
    const sanitized = sanitizeCustomerPackageForClient({
      id: 'pkg-1',
      products: [{
        internal_code: 'PUS-CEB-001',
        display_name: '?몃?',
        net_price: 900_000,
        cost_price: 800_000,
        margin_rate: 0.2,
        selling_price: 1_290_000,
      }],
    });

    expect(sanitized?.products).toEqual([{
      internal_code: 'PUS-CEB-001',
      display_name: '?몃?',
    }]);
  });

  it('keeps only customer-safe selling price fields in product price rows', () => {
    expect(sanitizeCustomerPackageForClient({
      id: 'pkg-1',
      product_prices: [{
        target_date: '2026-07-01',
        adult_selling_price: 1_290_000,
        net_price: 900_000,
        margin_rate: 0.2,
        note: 'A 호텔',
      }],
    })?.product_prices).toEqual([{
      target_date: '2026-07-01',
      adult_selling_price: 1_290_000,
      note: 'A 호텔',
    }]);
  });

  it('uses the sanitizer at the package detail server-to-client boundary', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/page.tsx'), 'utf8');

    expect(pageSource).toContain('sanitizeCustomerPackageForClient');
    expect(pageSource).toContain('initialPackage={clientPackage}');
  });

  it('passes package detail duration and hero render facts through the customer boundary', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/page.tsx'), 'utf8');
    const detailSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/DetailClient.tsx'), 'utf8');

    expect(pageSource).toContain('trip_style');
    expect(pageSource).toContain('resolveLpHeroPhotoUrl');
    expect(pageSource).toContain('lp_hero_image_url');
    expect(detailSource).toContain('formatPackageDuration');
    expect(detailSource).toContain('lp_hero_image_url');
    expect(detailSource).toContain('isArrivalOnlyFlight');
    expect(detailSource).toContain('&& !isArrivalOnlyFlight');
  });

  it('uses the sanitizer for non-admin mixed packages API responses', () => {
    const routeSource = readFileSync(join(process.cwd(), 'src/app/api/packages/route.ts'), 'utf8');

    expect(routeSource).toContain('isAdminRequest');
    expect(routeSource).toContain('function stripPublicPackageFields');
    expect(routeSource).toContain('sanitizeCustomerPackageForClient(stripSupplierRemarkFields(row))');
    expect(routeSource).toContain(': stripPublicPackageFields(pkg as Record<string, unknown>)');
    expect(routeSource).toContain(': stripPublicPackageFields(row)');
  });
});
