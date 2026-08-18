import { describe, expect, it } from 'vitest';

import {
  partitionProductSectionsBySalePrice,
  resolveSourceSalePriceDisposition,
} from './source-sale-price-disposition';

function canonical(prices: unknown[] = []) {
  return {
    v3: {
      ledger: {
        variants: [{ price_calendar: prices }],
      },
    },
  };
}

describe('source sale-price disposition', () => {
  it('keeps a canonical price candidate even when its date scope still needs validation', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '상품가 899,000원',
      canonicalSection: canonical([{ amount: 899_000, currency: 'KRW' }]),
    });
    expect(result.state).toBe('canonical_price_present');
    expect(result.shouldDiscard).toBe(false);
  });

  it('does not reject a sale amount when the evidence cell also contains a following fuel note', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '2026년 9월 23일, 24일 예정\n▶ \\1,499,000\n상기요금은 유류할증료 기준',
      canonicalSection: canonical([{
        amount: 1_499_000,
        currency: 'KRW',
        evidence: {
          quote: '2026년 9월 23일, 24일 예정\n▶ \\1,499,000\n상기요금은 유류할증료 기준',
        },
      }]),
    });
    expect(result.state).toBe('canonical_price_present');
    expect(result.canonicalPriceCandidateCount).toBe(1);
  });

  it('never promotes a canonical value whose evidence is NET-only to customer sale price', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '랜드 NET 799,000원\n커미션 9%',
      canonicalSection: canonical([{
        amount: 799_000,
        currency: 'KRW',
        label: 'NET',
        evidence: { quote: '랜드 NET 799,000원' },
      }]),
    });
    expect(result.state).toBe('source_price_absent');
    expect(result.shouldDiscard).toBe(true);
  });

  it('keeps an explicit source sale price as a resolver error instead of discarding it', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '성인 상품가 : 1,159,000원',
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_requires_resolution');
    expect(result.explicitSourceCandidateCount).toBe(1);
  });

  it('keeps a bare thousand-won sale shorthand from the title for resolution', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '[0729발권] 0830 장가계 풀만특가 799 - 컴 9%',
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_requires_resolution');
    expect(result.explicitSourceCandidateCount).toBe(1);
  });

  it('uses the canonical title hint when segmentation removed the file title', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '장가계 3박 4일 일정',
      canonicalSection: {
        ...canonical(),
        titleHint: '[BX전세기] 장가계 499 특가',
      },
    });
    expect(result.state).toBe('source_price_requires_resolution');
  });

  it('keeps an unread price-table source as a parser error instead of discarding it', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '★[BX] 서안똑딱 요금표 (7월 프로모션)',
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_requires_resolution');
    expect(result.sourcePriceStructureHintCount).toBe(1);
  });

  it('keeps a standalone HWP table amount for parser resolution', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '출발일\n10/12\n899,000\n호텔 예정',
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_requires_resolution');
    expect(result.unlabeledSourceCandidateCount).toBe(1);
  });

  it.each(['899,', '699,---', '839.000'])('keeps supplier price notation %s for deterministic resolution', sourcePrice => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: `출발일\n10/12\n${sourcePrice}\n호텔 예정`,
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_requires_resolution');
    expect(result.shouldDiscard).toBe(false);
  });

  it('discards a source with no sale amount', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '다낭 3박 5일\n판매가는 별도 문의\n호텔 동급 예정',
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_absent');
    expect(result.shouldDiscard).toBe(true);
  });

  it('discards an itinerary that only points at an unattached companion price sheet', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: '여행 경비\n요금표 참고\n부산 내몽고 4일 일정',
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_absent');
    expect(result.shouldDiscard).toBe(true);
    expect(result.sourcePriceStructureHintCount).toBe(0);
  });

  it('does not mistake non-sale commercial amounts for an adult selling price', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: [
        '아동 300,000원',
        '싱글차지 250,000원',
        '예약금 500,000원',
        '취소수수료 900,000원',
      ].join('\n'),
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_absent');
    expect(result.ignoredNonSaleAmountCount).toBe(4);
  });

  it('discards an itinerary that only contains guide costs and a per-person single supplement', () => {
    const result = resolveSourceSalePriceDisposition({
      sourceText: [
        '기사/가이드 경비 30,000원',
        '싱글차지 1인/박 120,000원',
        '호텔 동급 예정',
      ].join('\n'),
      canonicalSection: canonical(),
    });
    expect(result.state).toBe('source_price_absent');
    expect(result.shouldDiscard).toBe(true);
    expect(result.ignoredNonSaleAmountCount).toBe(2);
  });

  it('discards a truly price-less single-product source', () => {
    const result = partitionProductSectionsBySalePrice({
      sections: [
        { index: 0, rawText: '나트랑 일정표\n가격 별도 문의' },
      ],
      canonicalSections: [canonical()],
    });
    expect(result.eligibleSections).toEqual([]);
    expect(result.discardedSectionIndexes).toEqual([0]);
  });

  it('does not discard one section of a multi-product source when a shared price table may apply', () => {
    const result = partitionProductSectionsBySalePrice({
      sections: [
        { index: 0, rawText: '말레이시아 3박 5일 일정' },
        { index: 1, rawText: '싱가포르 3박 5일 일정' },
      ],
      canonicalSections: [canonical(), canonical()],
      documentText: '공통 요금표\n성인 판매가 899,000원\n말레이시아 일정\n싱가포르 일정',
    });
    expect(result.discardedSectionIndexes).toEqual([]);
    expect(result.dispositions.map(item => item.disposition.state)).toEqual([
      'source_price_requires_resolution',
      'source_price_requires_resolution',
    ]);
  });

  it('protects a bound single section when the original source had multiple product sections', () => {
    const result = partitionProductSectionsBySalePrice({
      sections: [{ index: 1, rawText: '싱가포르 3박 5일 일정' }],
      canonicalSections: [canonical(), canonical()],
      documentText: '공통 요금표\n성인 판매가 899,000원\n말레이시아 일정\n싱가포르 일정',
      sourceSectionCount: 2,
    });
    expect(result.discardedSectionIndexes).toEqual([]);
    expect(result.dispositions[0]?.disposition.state).toBe('source_price_requires_resolution');
  });

  it('discards every section only when the complete multi-product source has no sale price', () => {
    const result = partitionProductSectionsBySalePrice({
      sections: [
        { index: 0, rawText: '다낭 3박 5일 일정' },
        { index: 1, rawText: '호이안 3박 5일 일정' },
      ],
      canonicalSections: [canonical(), canonical()],
      documentText: '다낭 일정\n호이안 일정\n호텔 동급 예정',
    });
    expect(result.discardedSectionIndexes).toEqual([0, 1]);
  });
});
