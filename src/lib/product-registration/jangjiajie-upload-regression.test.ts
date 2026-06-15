import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import { splitCatalogByItineraryHeaders } from '@/lib/parser/catalog-pre-split';
import { extractSupplierRawDeterministicFacts } from '@/lib/supplier-raw-deterministic-facts';
import { recoverUploadPriceData } from './price-recovery';

const JANGJIAJIE_RAW = `3. 부산출발 장가계 3박4일 실속특가 PKG
출발날짜
6월8일 월요일,
6월27일 토요일
7월11일 토요일,
8월8일 토요일
출발인원
성인 6명 이상 / 인솔자 미동행
상 품 가
499,000/인
599,000/인
룸 타 입
2인1실 기준
포   함
왕복항공료, 유류할증료(6월), TAX, 호텔(2인1실), 식사, 전용차량, 기사, 가이드, 관광지 입장료, 여행자보험
불 포 함
유류변동분, 싱글차지($80/인/전일정), 개인경비 및 매너팁, 기사&가이드팁 $40/인

일자
지역
교통
시간
상세일정
부 산
장가계
BX371
09:00
11:20
부산 김해국제공항 출발
장가계 국제공항 도착
호텔 투숙 및 휴식
장가계
전용차량
전일
호텔 조식 후 천문산 관광
장가계
전용차량
전일
호텔 조식 후 천자산 관광
장가계
부 산
BX372
12:20
16:35
호텔 조식 후 공항으로 이동
장가계 국제공항 출발
부산 김해국제공항 도착

부산출발 장가계 4박5일 실속특가 PKG
출발날짜
6월30일 화요일
상 품 가
479,000/인`;

describe('Jangjiajie BX371 upload regression', () => {
  it('splits the 3-night and 4-night PKG sections before itinerary parsing', () => {
    const { sections } = splitCatalogByItineraryHeaders(JANGJIAJIE_RAW);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('3박4일 실속특가 PKG');
    expect(sections[0]).not.toContain('4박5일 실속특가 PKG');
    expect(sections[1]).toContain('4박5일 실속특가 PKG');
  });

  it('recovers stacked BX371/BX372 flight segments', () => {
    const facts = extractSupplierRawDeterministicFacts(JANGJIAJIE_RAW);

    expect(facts.outbound).toEqual({
      code: 'BX371',
      departure: { time: '09:00', airport: '부산' },
      arrival: { time: '11:20', airport: '장가계' },
    });
    expect(facts.inbound).toEqual({
      code: 'BX372',
      departure: { time: '12:20', airport: '장가계' },
      arrival: { time: '16:35', airport: '부산' },
    });
  });

  it('recovers source-backed grouped departure prices without AI fallback', async () => {
    const ed: ExtractedData = {
      title: '장가계 · 3박4일 · BX371',
      category: 'package',
      product_type: 'package',
      destination: '장가계',
      duration: 4,
      rawText: JANGJIAJIE_RAW,
      price_tiers: [],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText: JANGJIAJIE_RAW,
      title: ed.title,
      durationDays: 4,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('supplier_grouped_departure_price_table');
    expect(result.minPrice).toBe(499000);
    expect(result.priceDates).toEqual([
      { date: '2026-06-08', price: 499000, confirmed: false },
      { date: '2026-06-27', price: 499000, confirmed: false },
      { date: '2026-07-11', price: 599000, confirmed: false },
      { date: '2026-08-08', price: 599000, confirmed: false },
    ]);
  });
});
