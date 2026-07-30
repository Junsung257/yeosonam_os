import { describe, expect, it } from 'vitest';

import { planProductRegistrationV3 } from './structure-planner';
import type { V3SourceLine } from './types';

function sourceLines(...quotes: string[]): V3SourceLine[] {
  let charStart = 0;
  return quotes.map((quote, index) => {
    const line = {
      lineNumber: index + 1,
      charStart,
      charEnd: charStart + quote.length,
      quote,
    };
    charStart += quote.length + 1;
    return line;
  });
}

describe('product registration V3 shopping-section safety', () => {
  it('does not treat customs and duty-free warnings as a shopping itinerary', () => {
    const plan = planProductRegistrationV3(sourceLines(
      '클락 국제공항 도착',
      '기내에서 세관 신고서를 작성해야 하며 현지 공항 세관에서 과세가 심하니 면세품을 조심해야 합니다.',
      '호텔로 이동',
    ));

    expect(plan.shopping_section_locations).toEqual([]);
  });

  it.each([
    '나리타노모리 플레이 시 공항 도착 후 이온몰 쇼핑 후 골프장 이동',
    '깜란 자유시간 (마사지, 이발소, 커피숍, 멀티숍쇼핑, 마트 등 개별 자유시간)',
    '면세점 1회 방문',
  ])('keeps a real shopping visit in the review gate: %s', quote => {
    const plan = planProductRegistrationV3(sourceLines(quote));

    expect(plan.shopping_section_locations).toHaveLength(1);
  });
});
