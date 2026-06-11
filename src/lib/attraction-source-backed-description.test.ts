import { describe, expect, it } from 'vitest';

import { buildSourceBackedAttractionDescriptions } from './attraction-source-backed-description';

describe('source-backed attraction descriptions', () => {
  it('uses curated descriptions for known Baekdu/Yanji internal attractions', () => {
    const result = buildSourceBackedAttractionDescriptions({
      name: '비암산일송정',
      aliases: ['비암산 일송정'],
      region: '연길/백두산',
    });

    expect(result.shortDesc).toContain('독립의식');
    expect(result.longDesc).toContain('해란강');
  });

  it('falls back to source-backed wording without requiring photos', () => {
    const result = buildSourceBackedAttractionDescriptions({
      name: '새 관광지',
      examples: ['새 관광지 산책 및 주변 거리 관광'],
      region: '테스트',
    });

    expect(result.shortDesc).toContain('새 관광지');
    expect(result.longDesc).toContain('원문 일정');
  });
});
