import { describe, expect, it } from 'vitest';
import { buildUploadPersistenceRows } from './persistence-rows';

describe('buildUploadPersistenceRows', () => {
  it('fills customer selling prices for product price rows before persistence', () => {
    const rows = buildUploadPersistenceRows({
      registration: {
        extractedData: {
          title: 'Cebu hotel matrix',
          destination: 'Cebu',
          duration: 5,
          price: 859000,
          rawText: 'raw',
        },
      } as never,
      finalized: {
        draftRow: {
          inclusions: [],
          excludes: [],
          notices_parsed: [],
          itinerary_data: { days: [{ day: 1, schedule: [] }] },
        },
        confidenceV3: 0.9,
        productStatus: 'REVIEW_NEEDED',
        pkgStatus: 'pending',
      } as never,
      title: 'Cebu hotel matrix',
      internalCode: 'PUS-ETC-CEB-05-0001',
      departureRegion: 'Busan',
      supplierCode: 'ETC',
      netPrice: 859000,
      marginRate: 0.09,
      sourceFilename: 'cebu.txt',
      landOperatorId: null,
      departingLocationId: null,
      fileType: 'txt',
      productRawText: 'raw',
      documentRawText: 'raw',
      priceRows: [
        {
          target_date: '2026-07-24',
          day_of_week: null,
          net_price: 859000,
          adult_selling_price: null,
          child_price: null,
          note: 'Solea',
        },
      ],
      priceDates: [{ date: '2026-07-24', price: 859000, confirmed: false }],
      marketingCopies: [],
      catalogGroupId: null,
    });

    expect(rows.productPriceRows).toEqual([
      {
        product_id: 'PUS-ETC-CEB-05-0001',
        target_date: '2026-07-24',
        day_of_week: null,
        net_price: 859000,
        adult_selling_price: 859000,
        child_price: null,
        note: 'Solea',
      },
    ]);
  });

  it('persists nights from trip_style before falling back to duration minus one', () => {
    const rows = buildUploadPersistenceRows({
      registration: {
        extractedData: {
          title: 'Nha Trang golf 3n5d',
          destination: 'Nha Trang',
          duration: 5,
          trip_style: '3박5일',
          price: 1099000,
          rawText: 'raw',
        },
      } as never,
      finalized: {
        draftRow: {
          inclusions: [],
          excludes: [],
          notices_parsed: [],
          itinerary_data: { meta: { nights: 3, days: 5 }, days: [{ day: 1, schedule: [] }] },
        },
        confidenceV3: 0.9,
        productStatus: 'REVIEW_NEEDED',
        pkgStatus: 'pending',
      } as never,
      title: 'Nha Trang golf 3n5d',
      internalCode: 'PUS-ETC-CXR-05-0001',
      departureRegion: 'Busan',
      supplierCode: 'ETC',
      netPrice: 1099000,
      marginRate: 0.09,
      sourceFilename: 'nha-trang.txt',
      landOperatorId: null,
      departingLocationId: null,
      fileType: 'txt',
      productRawText: 'raw',
      documentRawText: 'raw',
      priceRows: [],
      priceDates: [{ date: '2026-06-30', price: 1099000, confirmed: false }],
      marketingCopies: [],
      catalogGroupId: null,
    });

    expect(rows.travelPackageRow.nights).toBe(3);
  });

  it('strips supplier distribution markers from customer title and summary fields', () => {
    const rows = buildUploadPersistenceRows({
      registration: {
        extractedData: {
          title: 'BX 나트랑 다이아몬드베이 골프텔 *선발특가 6/25 까지 6/4 배포',
          destination: '나트랑',
          duration: 5,
          trip_style: '3박5일',
          price: 1099000,
          product_summary: 'BX 5일 나트랑 다이아몬드베이 골프텔 *선발특가 6/ 까지 6/4 배포 스팟특가 여행',
          rawText: 'raw',
        },
      } as never,
      finalized: {
        draftRow: {
          inclusions: [],
          excludes: [],
          notices_parsed: [],
          itinerary_data: { meta: { nights: 3, days: 5 }, days: [{ day: 1, schedule: [] }] },
        },
        confidenceV3: 0.9,
        productStatus: 'REVIEW_NEEDED',
        pkgStatus: 'pending',
      } as never,
      title: 'BX 나트랑 다이아몬드베이 골프텔 *선발특가 6/25 까지 6/4 배포',
      internalCode: 'PUS-ETC-CXR-05-0004',
      departureRegion: 'Busan',
      supplierCode: 'ETC',
      netPrice: 1099000,
      marginRate: 0.09,
      sourceFilename: 'nha-trang.txt',
      landOperatorId: null,
      departingLocationId: null,
      fileType: 'txt',
      productRawText: 'raw',
      documentRawText: 'raw',
      priceRows: [],
      priceDates: [],
      marketingCopies: [],
      catalogGroupId: null,
    });

    expect(rows.travelPackageRow.display_title).toBe('BX 나트랑 다이아몬드베이 골프텔');
    expect(String(rows.travelPackageRow.product_summary)).toContain('나트랑 다이아몬드베이 골프텔');
    expect(String(rows.travelPackageRow.product_summary)).not.toContain('배포');
    expect(String(rows.travelPackageRow.product_summary)).not.toContain('6/ 까지');
  });
});
