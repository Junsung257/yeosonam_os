import { describe, expect, it } from 'vitest';
import { registerProductFromRaw } from '../register-product-from-raw';

const TOKYO_PASTE_RAW = [
  '7\uC6D4',
  '\u26057/24\uAE4C\uC9C0 \uC120\uBC1C\uAD8C \uC870\uAC74\u2605',
  '\u2665\uD2B9\uAC00\u2665 7/20',
  '899,000\uC6D0',
  '7/21, 22',
  '999,000\uC6D0',
  '7/19, 24',
  '1,099,000\uC6D0',
  '7/23',
  '1,149,000\uC6D0',
  '7/26,27,28,29',
  '1,199,000\uC6D0',
  '7/17,18,25,30',
  '1,249,000\uC6D0',
  '7/31',
  '1,299,000\uC6D0',
  '8\uC6D4',
  '\u26057/24\uAE4C\uC9C0 \uC120\uBC1C\uAD8C \uC870\uAC74\u2605',
  '\u2665\uD2B9\uAC00\u2665 8/24, 31',
  '899,000\uC6D0',
  '\u2665\uD2B9\uAC00\u2665 8/17,18,19,23,25,26,30',
  '969,000\uC6D0',
  '\u2665\uD2B9\uAC00\u2665 8/3,4,5',
  '999,000\uC6D0',
  '\u2665\uD2B9\uAC00\u2665 8/9,10,11,21,22,28,29',
  '1,019,000\uC6D0',
  '8/2,7,8,12,16,20,27',
  '1,069,000\uC6D0',
  '8/7,8,16,20',
  '1,099,000\uC6D0',
  '8/6',
  '1,119,000\uC6D0',
  '8/13',
  '1,149,000\uC6D0',
  '8/14',
  '1,249,000\uC6D0',
  '8/15',
  '1,199,00\uC6D0',
  '8/1',
  '1,299,000\uC6D0',
  '9\uC6D4',
  '\u26057/24\uAE4C\uC9C0 \uC120\uBC1C\uAD8C \uC870\uAC74\u2605',
  '\u2665\uD2B9\uAC00\u2665 9/7,14',
  '799,000\uC6D0',
  '\u2665\uD2B9\uAC00\u2665 9/28',
  '899,000\uC6D0',
  '\u2665\uD2B9\uAC00\u2665 9/27',
  '919,000\uC6D0',
  '9/1,2,6,8,9,13,15,16,29,30',
  '969,000\uC6D0',
  '9/22',
  '1,069,000\uC6D0',
  '9/4,5,10,11,12,17,21',
  '1,019,000\uC6D0',
  '9/3,18,20,21',
  '1,049,000\uC6D0',
  '9/19',
  '1,099,000\uC6D0',
  '9/23',
  '1,399,000\uC6D0',
  '9/26',
  '1,419,000\uC6D0',
  '9/24,25',
  '1,499,000\uC6D0',
  '10\uC6D4',
  '\u26057/24\uAE4C\uC9C0 \uC120\uBC1C\uAD8C \uC870\uAC74\u2605',
  '\u2665\uD2B9\uAC00\u2665 10/19, 26',
  '989,000\uC6D0',
  '10/5,6,7,12,13,14,20,21,27,28',
  '1,069,000\uC6D0',
  '10/11,18,25',
  '1,119,000\uC6D0',
  '10/10,16,17,23,24,30,31',
  '1,149,000\uC6D0',
  '10/1,4,15,22,29',
  '1,199,000\uC6D0',
  '10/2,3,8,9',
  '1,369,000\uC6D0',
  '',
  '\uBD80\uC0B0 \u2013 \uB3C4\uCFC4 3\uBC154\uC77C PKG',
  '\uD3EC\uD568 \uC0AC\uD56D',
  '\uC655\uBCF5\uD56D\uACF5\uAD8C+TAX, \uC804\uC77C\uC815, \uD638\uD154 \uC219\uBC15, \uAE30\uBCF8 \uAD00\uAD11\uC9C0 \uC785\uC7A5\uB8CC, \uC2DD\uC0AC, \uC804\uC6A9 \uCC28\uB7C9, \uC5EC\uD589\uC790 \uBCF4\uD5D8',
  '\uBD88\uD3EC\uD568 \uC0AC\uD56D',
  '\uC720\uB958\uC138(7\uC6D4 \uC57D 92,200\uC6D0), \uAC00\uC774\uB4DC \uACBD\uBE44(4\uB9CC\uC6D0 \uC131\uC778/\uC544\uB3D9 \uB3D9\uC77C), \uAE30\uD0C0 \uAC1C\uC778 \uACBD\uBE44',
  '\uBE44\uACE0',
  '10\uBA85 \uC774\uC0C1 \uCD9C\uBC1C \uD655\uC815',
  'HOTEL : \uACE0\uD6C4 \uB3C4\uBBF8\uC778 \uB9C8\uB8E8\uB178\uC6B0\uCE58, \uC774\uC0AC\uC640 \uCE74\uC774\uB9AC\uC870\uD2B8 \uB610\uB294 \uB3D9\uAE09',
  'BX112 07:50 \uBD80\uC0B0 \uCD9C\uBC1C 10:00 \uB098\uB9AC\uD0C0 \uB3C4\uCC29',
  'BX111 10:55 \uB098\uB9AC\uD0C0 \uCD9C\uBC1C 13:15 \uBD80\uC0B0 \uB3C4\uCC29',
  '\uC624\uB2E4\uC774\uBC14 \uB808\uC778\uBCF4\uC6B0 \uBE0C\uB9BF\uC9C0, \uC544\uC0AC\uCFE0\uC0AC \uC13C\uC18C\uC9C0, \uCE74\uC640\uAD6C\uCE58 \uD638\uC218, \uC624\uC2DC\uB178\uD56B\uCE74\uC774, \uC624\uC624\uC640\uCFE0\uB2E4\uB2C8, \uC544\uC2DC\uD638\uC218',
].join('\n');

describe('Tokyo supplier paste regression', () => {
  it('keeps corrected duplicate prices and typo-repaired price through registration', async () => {
    const result = await registerProductFromRaw({
      rawText: TOKYO_PASTE_RAW,
      originalRawText: TOKYO_PASTE_RAW,
      parserRawText: TOKYO_PASTE_RAW,
      documentRawText: TOKYO_PASTE_RAW,
      analysisNormalizedText: TOKYO_PASTE_RAW,
      extractedData: {
        title: '\uBD80\uC0B0 \u2013 \uB3C4\uCFC4 3\uBC154\uC77C PKG',
        destination: '\uB3C4\uCFC4',
        duration: 4,
        rawText: TOKYO_PASTE_RAW,
        price_tiers: [],
      },
      itineraryData: {
        days: [
          { day: 1, regions: ['\uB3C4\uCFC4', '\uACE0\uD6C4'], meals: {}, schedule: [{ type: 'activity', activity: '\uC624\uB2E4\uC774\uBC14 \uBC0F \uC544\uC0AC\uCFE0\uC0AC \uAD00\uAD11' }] },
          { day: 2, regions: ['\uD6C4\uC9C0\uC0B0'], meals: {}, schedule: [{ type: 'activity', activity: '\uCE74\uC640\uAD6C\uCE58 \uD638\uC218 \uBC0F \uC624\uC2DC\uB178\uD56B\uCE74\uC774 \uAD00\uAD11' }] },
          { day: 3, regions: ['\uD558\uCF54\uB124', '\uB3C4\uCFC4'], meals: {}, schedule: [{ type: 'activity', activity: '\uC624\uC624\uC640\uCFE0\uB2E4\uB2C8 \uBC0F \uC544\uC2DC\uD638\uC218 \uAD00\uAD11' }] },
          { day: 4, regions: ['\uB098\uB9AC\uD0C0', '\uBD80\uC0B0'], meals: {}, schedule: [{ type: 'flight', activity: 'BX111 \uB098\uB9AC\uD0C0 \uCD9C\uBC1C \uBD80\uC0B0 \uB3C4\uCC29' }] },
        ],
        flight_segments: [
          { leg: 'outbound', flight_no: 'BX112', dep_time: '07:50', arr_time: '10:00', day_pair: [1, 1] },
          { leg: 'inbound', flight_no: 'BX111', dep_time: '10:55', arr_time: '13:15', day_pair: [4, 4] },
        ],
      },
      title: '\uBD80\uC0B0 \u2013 \uB3C4\uCFC4 3\uBC154\uC77C PKG',
      activeAttractions: [],
      destinationCode: 'TYO',
      internalCode: 'PUS-JP-TYO-04-TOKYO-PASTE',
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    const priceByDate = new Map(result.priceRecovery.priceDates.map(row => [row.date, row.price]));

    expect(result.priceRecovery.ok).toBe(true);
    expect(result.priceRecovery.source).toBe('deterministic:pdf_date_price_table');
    expect(result.pricing.minPrice).toBe(799_000);
    expect(priceByDate.get('2026-08-07')).toBe(1_099_000);
    expect(priceByDate.get('2026-08-08')).toBe(1_099_000);
    expect(priceByDate.get('2026-08-16')).toBe(1_099_000);
    expect(priceByDate.get('2026-08-20')).toBe(1_099_000);
    expect(priceByDate.get('2026-08-15')).toBe(1_199_000);
    expect(priceByDate.get('2026-09-21')).toBe(1_049_000);
    expect(result.priceRecovery.priceRows.filter(row => row.target_date === '2026-08-07')).toHaveLength(1);
    expect(result.priceRecovery.priceRows.filter(row => row.target_date === '2026-09-21')).toHaveLength(1);
  });
});
