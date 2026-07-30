import { describe, expect, it } from 'vitest';
import { inspectOptionalTourSource, isPublicPackage } from './product-source-drift';

describe('product source drift inspection', () => {
  it('uses raw context as the strongest region evidence', () => {
    const [item] = inspectOptionalTourSource({
      id: 'pkg-1',
      title: '방콕 패키지',
      raw_text: '제4일 파타야 추천옵션: 전통마사지 2시간 $40/인',
      raw_text_hash: 'hash',
      optional_tours: [{ name: '전통마사지 2시간' }],
    });
    expect(item.suggested_region).toBe('태국');
    expect(item.confidence).toBe('source_context');
    expect(item.name_found_in_raw_text).toBe(true);
  });

  it('does not infer from package destination when source is ambiguous', () => {
    const [item] = inspectOptionalTourSource({
      id: 'pkg-2',
      destination: '방콕',
      raw_text: '선택관광: 마사지 또는 쇼핑',
      optional_tours: [{ name: '마사지' }],
    });
    expect(item.suggested_region).toBeNull();
    expect(item.confidence).toBe('needs_review');
  });

  it('matches source when punctuation and spacing differ', () => {
    const [item] = inspectOptionalTourSource({
      id: 'pkg-3',
      raw_text: '선택관광 ※ 마사지 : 발+전신마사지(90분) $50/인',
      optional_tours: [{ name: '발 + 전신마사지 90분' }],
    });
    expect(item.name_found_in_raw_text).toBe(true);
    expect(item.normalized_name_match).toBe(true);
    expect(item.context_excerpt).toContain('발+전신마사지');
  });

  it('marks public packages so the API can fail closed', () => {
    expect(isPublicPackage({ status: 'active', publication_state: 'blocked' })).toBe(true);
    expect(isPublicPackage({ status: 'pending_review', publication_state: 'blocked' })).toBe(false);
  });
});
