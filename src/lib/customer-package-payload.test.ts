import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeCustomerPackageForClient } from './customer-package-payload';

describe('customer package client payload', () => {
  it('removes internal source, audit, and margin fields before client serialization', () => {
    const sanitized = sanitizeCustomerPackageForClient({
      id: 'pkg-1',
      title: 'customer package',
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
      expected_contribution_margin: 120000,
      selling_price: 1_290_000,
      departing_location_id: 'dep-1',
      catalog_id: 'catalog-1',
      commission_rate: 9,
      data_completeness: 80,
      internal_code: 'LAND-SECRET',
      products: {
        internal_code: 'PUS-CEB-001',
        display_name: 'public product',
        net_price: 900_000,
        margin_rate: 0.2,
        selling_price: 1_290_000,
      },
    });

    expect(sanitized).toMatchObject({
      id: 'pkg-1',
      title: 'customer package',
      price: 1_290_000,
      products: {
        display_name: 'public product',
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
    expect(sanitized).not.toHaveProperty('expected_contribution_margin');
    expect(sanitized).not.toHaveProperty('selling_price');
    expect(sanitized).not.toHaveProperty('departing_location_id');
    expect(sanitized).not.toHaveProperty('catalog_id');
    expect(sanitized).not.toHaveProperty('commission_rate');
    expect(sanitized).not.toHaveProperty('data_completeness');
    expect(sanitized).not.toHaveProperty('internal_code');
    expect(sanitized?.products as Record<string, unknown>).not.toHaveProperty('net_price');
    expect(sanitized?.products as Record<string, unknown>).not.toHaveProperty('margin_rate');
    expect(sanitized?.products as Record<string, unknown>).not.toHaveProperty('selling_price');
    expect(sanitized?.products as Record<string, unknown>).not.toHaveProperty('internal_code');
  });

  it('strips internal product fields from nested product arrays as well as objects', () => {
    const sanitized = sanitizeCustomerPackageForClient({
      id: 'pkg-1',
      products: [{
        internal_code: 'PUS-CEB-001',
        display_name: 'public product',
        net_price: 900_000,
        cost_price: 800_000,
        margin_rate: 0.2,
        selling_price: 1_290_000,
      }],
    });

    expect(sanitized?.products).toEqual([{
      display_name: 'public product',
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
        note: 'A option',
      }],
    })?.product_prices).toEqual([{
      target_date: '2026-07-01',
      adult_selling_price: 1_290_000,
      note: 'A option',
    }]);
  });

  it('removes internal price and operator fields from nested customer payloads', () => {
    const sanitized = sanitizeCustomerPackageForClient({
      id: 'pkg-1',
      itinerary_data: {
        days: [{
          day: 1,
          schedule: [{
            activity: 'public attraction visit',
            source_activity: 'public attraction visit',
            internal_note: 'supplier commission 9%',
            net_price: 900_000,
            margin_rate: 0.1,
            supplier_code: 'LAND-SECRET',
            internal_code: 'ATTR-SECRET',
          }],
        }],
      },
      optional_tours: [{
        name: 'night city tour',
        price: '$40',
        commission_rate: 9,
        supplier_note: 'supplier only',
        internal_code: 'OPT-SECRET',
      }],
    });

    const schedule = (((sanitized?.itinerary_data as Record<string, unknown>).days as Array<Record<string, unknown>>)[0]
      ?.schedule as Array<Record<string, unknown>>)[0];
    const optionalTour = (sanitized?.optional_tours as Array<Record<string, unknown>>)[0];

    expect(schedule).toMatchObject({
      activity: 'public attraction visit',
      source_activity: 'public attraction visit',
    });
    expect(schedule).not.toHaveProperty('internal_note');
    expect(schedule).not.toHaveProperty('net_price');
    expect(schedule).not.toHaveProperty('margin_rate');
    expect(schedule).not.toHaveProperty('supplier_code');
    expect(schedule).not.toHaveProperty('internal_code');
    expect(optionalTour).toMatchObject({
      name: 'night city tour',
      price: '$40',
    });
    expect(optionalTour).not.toHaveProperty('commission_rate');
    expect(optionalTour).not.toHaveProperty('supplier_note');
    expect(optionalTour).not.toHaveProperty('internal_code');
  });

  it('uses the sanitizer at the package detail server-to-client boundary', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/page.tsx'), 'utf8');

    expect(pageSource).toContain('sanitizeCustomerPackageForClient');
    expect(pageSource).toContain('initialPackage={clientPackage}');
  });

  it('keeps package detail pages dynamically rendered from the latest saved row', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/page.tsx'), 'utf8');

    expect(pageSource).toContain("export const dynamic = 'force-dynamic'");
    expect(pageSource).toContain('export const revalidate = 0');
    expect(pageSource).not.toContain('export async function generateStaticParams');
  });

  it('does not post-process already published public snapshot rows on the package detail page', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/page.tsx'), 'utf8');

    expect(pageSource).toContain('const writeTimeProcessed = Boolean(publicSnapshot) || parserVersion.includes(POSTPROCESS_VERSION)');
    expect(pageSource).toContain('const processed = writeTimeProcessed ? pkgBase : postProcessPackageRow');
  });

  it('uses the public snapshot canonical view before recalculating package render data on the client', () => {
    const detailSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/DetailClient.tsx'), 'utf8');

    expect(detailSource).toContain('_canonical_view?: CanonicalView | null');
    expect(detailSource).toContain('return pkg._canonical_view ?? renderPackage');
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
    expect(routeSource).toContain('fetchLatestPublicPackageSnapshot');
    expect(routeSource).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(routeSource).toContain('isCustomerPublicSnapshotCandidate');
    expect(routeSource).toContain(': stripPublicPackageFields(row)');
  });

  it('uses public snapshots before rendering package detail rival comparison titles', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/page.tsx'), 'utf8');
    const rivalScoreIndex = pageSource.indexOf("label: 'package.score-rivals'");
    const rivalPackageIndex = pageSource.indexOf("label: 'package.score-rival-packages'");
    const snapshotMergeIndex = pageSource.indexOf('const publicRivals = await fetchAndMergeCurrentPublicPackageCardSnapshots', rivalPackageIndex);
    const titleMapIndex = pageSource.indexOf('const titleByRivalId = new Map', snapshotMergeIndex);
    const pushIndex = pageSource.indexOf('title: publicTitle', titleMapIndex);

    expect(pageSource).not.toContain('travel_packages!inner(title)');
    expect(pageSource).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(rivalPackageIndex).toBeGreaterThan(rivalScoreIndex);
    expect(snapshotMergeIndex).toBeGreaterThan(rivalPackageIndex);
    expect(titleMapIndex).toBeGreaterThan(snapshotMergeIndex);
    expect(pushIndex).toBeGreaterThan(titleMapIndex);
  });
});
