import { describe, expect, it } from 'vitest';
import { applyDeterministicExtractedDataFixes, validateExtractedProduct } from './upload-validator';
import type { ExtractedData } from './parser';

function baseEd(over: Partial<ExtractedData>): ExtractedData {
  return {
    rawText: '치앙마이 5일\n상품 제목입니다',
    title: 'x',
    ...over,
  } as ExtractedData;
}

describe('applyDeterministicExtractedDataFixes', () => {
  it('항공 시각 한 자리 시를 0패딩', () => {
    const ed = baseEd({
      title: '테스트',
      flight_info: { depart: '9:05', arrive: '18:30' },
    });
    applyDeterministicExtractedDataFixes(ed);
    expect(ed.flight_info?.depart).toBe('09:05');
    expect(ed.flight_info?.arrive).toBe('18:30');
  });

  it('duration 범위 클램프', () => {
    const ed = baseEd({ title: 't', duration: 99 });
    applyDeterministicExtractedDataFixes(ed);
    expect(ed.duration).toBe(60);
  });

  it('title 비었을 때 rawText에서 후보', () => {
    const ed = baseEd({ title: '', rawText: '\n\n치앙마이 특가 5일\n내용' });
    applyDeterministicExtractedDataFixes(ed);
    expect(ed.title).toContain('치앙마이');
  });

  it('패딩 후 Zod 통과 가능', () => {
    const ed = baseEd({
      title: '상품',
      price: 500_000,
      flight_info: { depart: '7:15', arrive: '12:05' },
    });
    applyDeterministicExtractedDataFixes(ed);
    const v = validateExtractedProduct(ed);
    expect(v.isValid).toBe(true);
  });
});
