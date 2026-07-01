import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDocument, type ExtractedData } from '../parser';
import { tiersToDatePrices } from '../price-dates';
import { parseDayTable } from './deterministic/day-table';
import { renderPackage, type RenderPackageInput } from '../render-contract';

const raw = readFileSync(join(__dirname, 'fixtures', 'baekdu-e2e-input.txt'), 'utf8');

const expected = [
  { type: '세이브 실속', title: '연길/백두산(북파) 2박3일', duration: 3, nights: 2, min: 2, price: 749000, p0601: 999000, p0615: 929000, p0829: 749000, hotels: ['금수학', '풋볼'], include: ['여행자보험'], exclude: ['$30'], optionalCount: 7, shopping: '2회+농산물' },
  { type: '스탠다드 품격 노노', title: '연길/백두산 (북파) 2박3일', duration: 3, nights: 2, min: 2, price: 989000, p0601: 1229000, p0615: 1149000, p0829: 999000, hotels: ['왕조성지', '연길 국제'], include: ['특식2회'], exclude: ['매너팁'], optionalCount: 0, shopping: '2회+농산물' },
  { type: '프리미엄 노노노', title: '연길/백두산 (북파) 2박3일', duration: 3, nights: 2, min: 8, price: 1159000, p0601: 1359000, p0615: 1279000, p0829: 1159000, hotels: ['왕조성지', '연길 국제'], include: ['리무진차량'], exclude: ['매너팁'], optionalCount: 0, shopping: '노쇼핑' },
  { type: '크라운 노노노+', title: '연길/백두산 (북파) 2박3일', duration: 3, nights: 2, min: 10, price: 1189000, p0601: 1439000, p0615: 1359000, p0829: 1199000, hotels: ['퓨어랜드', '카이로스'], include: ['리무진차량'], exclude: ['매너팁'], optionalCount: 0, shopping: '노쇼핑', dayText: '5D비행체험' },
  { type: '세이브 실속', title: '연길/백두산(북+서파) 3박4일', duration: 4, nights: 3, min: 2, price: 749000, p0601: 999000, p0615: 929000, p0829: 749000, hotels: ['금수학', '풋볼'], include: ['2억원여행자보험'], exclude: ['$40'], optionalCount: 7, shopping: '2회+농산물' },
  { type: '스탠다드 품격 노노', title: '연길/백두산(북+서파) 3박4일', duration: 4, nights: 3, min: 2, price: 989000, p0601: 1229000, p0615: 1149000, p0829: 999000, hotels: ['왕조성지', '연길 국제'], include: ['특식3회'], exclude: ['매너팁'], optionalCount: 0, shopping: '2회+농산물' },
  { type: '프리미엄 노노노', title: '연길/백두산(북+서파) 3박4일', duration: 4, nights: 3, min: 8, price: 1159000, p0601: 1359000, p0615: 1279000, p0829: 1159000, hotels: ['왕조성지', '연길 국제'], include: ['특식6회', '리무진차량'], exclude: ['매너팁'], optionalCount: 0, shopping: '노쇼핑' },
  { type: '크라운 노노노+', title: '연길/백두산(북+서파) 3박4일', duration: 4, nights: 3, min: 10, price: 1189000, p0601: 1439000, p0615: 1359000, p0829: 1199000, hotels: ['퓨어랜드', '카이로스'], include: ['특식6회', '리무진차량'], exclude: ['매너팁'], optionalCount: 0, shopping: '노쇼핑' },
] as const;

function sectionText(index: number): string {
  const marker = index === 0 ? expected[0].title : expected[index].type.split(' ')[0];
  const pos = raw.indexOf(marker, index === 0 ? 0 : raw.indexOf(expected[index - 1].title) + expected[index - 1].title.length);
  const next = index + 1 < expected.length
    ? raw.indexOf(expected[index + 1].type.split(' ')[0], raw.indexOf(expected[index].title) + expected[index].title.length)
    : raw.length;
  return raw.slice(Math.max(0, pos), next > 0 ? next : raw.length);
}

function priceOn(ed: ExtractedData, iso: string): number | null {
  return tiersToDatePrices(ed.price_tiers ?? []).find(d => d.date === iso)?.price ?? null;
}

function buildRenderInput(ed: ExtractedData, idx: number): RenderPackageInput {
  const itinerary = parseDayTable(sectionText(idx));
  const shopping = sectionText(idx).match(/쇼핑센터\s*\n([\s\S]*?)(?=비\s*고|일\s*자)/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  return {
    ...ed,
    price_dates: tiersToDatePrices(ed.price_tiers ?? []),
    itinerary_data: {
      ...itinerary,
      highlights: {
        ...(itinerary as { highlights?: Record<string, unknown> }).highlights,
        shopping,
      },
    },
  } as unknown as RenderPackageInput;
}

function flatActivities(view: ReturnType<typeof renderPackage>): string {
  return JSON.stringify(view.days.flatMap(day => day.schedule.map(item => item.activity)));
}

describe('Baekdu supplier catalog E2E', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T09:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses one supplier raw text into 8 customer-ready package variants', async () => {
    const parsed = await parseDocument(Buffer.from(raw, 'utf8'), 'baekdu.txt');
    expect(parsed.multiProducts).toHaveLength(8);

    parsed.multiProducts!.forEach((product, idx) => {
      const ed = product.extractedData;
      const exp = expected[idx];
      expect(ed.title).toBe(exp.title);
      expect(ed.product_type).toBe(exp.type);
      expect(ed.duration).toBe(exp.duration);
      expect(ed.nights).toBe(exp.nights);
      expect(ed.min_participants).toBe(exp.min);
      expect(ed.price).toBe(exp.price);
      expect(priceOn(ed, '2026-06-01')).toBe(exp.p0601);
      expect(priceOn(ed, '2026-06-15')).toBe(exp.p0615);
      expect(priceOn(ed, '2026-08-29')).toBe(exp.p0829);
      expect(tiersToDatePrices(ed.price_tiers ?? []).some(d => d.price > 0 && d.price < 100000)).toBe(false);
      expect(ed.optional_tours ?? []).toHaveLength(exp.optionalCount);
      if (exp.optionalCount > 0) {
        const optionPayload = JSON.stringify(ed.optional_tours);
        ['발+전신마사지', '5D비행체험', '북파 VIP', '온천욕', '무제한소불고기', '무제한양꼬치', '송이구이']
          .forEach(option => expect(optionPayload).toContain(option));
        ['$50', '$40', '$65'].forEach(price => expect(optionPayload).toContain(price));
      }

      const payload = JSON.stringify(ed);
      exp.hotels.forEach(hotel => expect(payload).toContain(hotel));
      exp.include.forEach(item => expect(payload).toContain(item));
      exp.exclude.forEach(item => expect(payload).toContain(item));
      if ('dayText' in exp) expect(sectionText(idx)).toContain(exp.dayText);

      const view = renderPackage(buildRenderInput(ed, idx));
      const viewPayload = JSON.stringify(view);
      const activities = flatActivities(view);
      expect(viewPayload).toContain(exp.shopping);
      exp.hotels.forEach(hotel => expect(viewPayload).toContain(hotel));
      ['부  산', '연  길', '북  파', '서  파', '꿔바로우', '무제한', '매운탕']
        .forEach(noise => expect(activities).not.toContain(noise));
      expect(view.days).toHaveLength(exp.duration);
    });
  });
});
