import { describe, expect, it } from 'vitest';

import { LEAK_PATTERNS } from './customer-leak-sanitizer';

function internalPhoneMatches(value: string): string[] {
  const pattern = LEAK_PATTERNS.find(rule => rule.id === 'internal_phone')?.pattern;
  if (!pattern) throw new Error('internal_phone pattern missing');
  pattern.lastIndex = 0;
  return [...value.matchAll(pattern)].map(match => match[0]);
}

describe('customer leak sanitizer', () => {
  it('does not treat UUID fragments as internal phone numbers', () => {
    expect(internalPhoneMatches('7c6a6ba4-8c01-4561-9921-cde1fa5db56c')).toEqual([]);
  });

  it('still detects standalone internal phone numbers', () => {
    expect(internalPhoneMatches('담당자 연락처 01-4561-9921')).toEqual(['01-4561-9921']);
    expect(internalPhoneMatches('상담 02-1234-5678 가능')).toEqual(['02-1234-5678']);
  });
});
