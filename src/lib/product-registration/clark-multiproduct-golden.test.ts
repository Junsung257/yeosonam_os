import { describe, expect, it } from 'vitest';
import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';
import { inferAccommodationsFromRawText } from './accommodations';
import { inferDepartureDaysFromRawText } from './departure-days';
import type { ItineraryDataLike } from './itinerary-normalization';
import { registerProductFromRaw } from './register-product-from-raw';
import {
  CLARK_MULTIPRODUCT_EXPECTED,
  CLARK_MULTIPRODUCT_RAW,
} from './golden-corpus/clark-multiproduct-fixture';

describe('Clark multi-product registration golden path', () => {
  it('splits four PKG products and validates each product through the standard registration object', async () => {
    const products = recoverCatalogSplitFromRawText(CLARK_MULTIPRODUCT_RAW);
    const expectedByTitle = new Map(CLARK_MULTIPRODUCT_EXPECTED.map(expected => [expected.title, expected]));

    expect(products.map(product => product.extractedData.title)).toEqual(CLARK_MULTIPRODUCT_EXPECTED.map(expected => expected.title));

    for (const product of products) {
      const title = product.extractedData.title ?? '';
      const expected = expectedByTitle.get(title);
      expect(expected).toBeDefined();
      if (!expected) continue;

      const sectionRawText = product.sectionRawText ?? '';
      const departureDays = inferDepartureDaysFromRawText(sectionRawText);
      const accommodations = inferAccommodationsFromRawText(sectionRawText);
      const registration = await registerProductFromRaw({
        rawText: sectionRawText,
        documentRawText: CLARK_MULTIPRODUCT_RAW,
        extractedData: {
          ...product.extractedData,
          departure_days: departureDays ?? undefined,
          accommodations,
        },
        itineraryData: product.itineraryData as unknown as ItineraryDataLike | null,
        title,
        activeAttractions: [],
        destinationResolution: {
          destination: product.extractedData.destination ?? null,
          source: 'existing',
          departureRaw: '',
          departureCode: 'PUS',
          departureRegion: '',
          destinationCode: 'CRK',
          durationDays: product.extractedData.duration ?? expected.duration,
          failures: [],
        },
        destinationCode: 'CRK',
        internalCode: `PUS-ETC-CRK-${expected.duration === 6 ? '06' : '05'}-0001`,
        enableGeminiFallback: false,
        priceYear: 2026,
      });
      const recovered = registration.priceRecovery;

      expect(departureDays).toBe(expected.departureDays);
      expect(accommodations).toContain(expected.hotel);
      expect(recovered.ok).toBe(true);
      expect(recovered.source).toBe('deterministic:spot_weekday_table');
      expect(recovered.minPrice).toBe(expected.minPrice);
      expect(recovered.priceDates).toHaveLength(expected.count);
      expect(recovered.priceDates.find(row => row.date === expected.sampleDate)?.price).toBe(expected.samplePrice);
      expect(recovered.priceDates.find(row => row.date === expected.forbiddenDate)).toBeUndefined();
      expect(recovered.priceRows).toHaveLength(recovered.priceDates.length);
      expect(recovered.priceRows.map(row => [row.target_date, row.net_price])).toEqual(
        recovered.priceDates.map(row => [row.date, row.price]),
      );
      for (const forbiddenPrice of expected.forbiddenPrices) {
        expect(recovered.priceRows.some(row => row.net_price === forbiddenPrice)).toBe(false);
        expect(recovered.priceDates.some(row => row.price === forbiddenPrice)).toBe(false);
      }
      expect(registration.deliverability.ok).toBe(true);
      expect(registration.publishable).toBe(true);
    }
  });
});
