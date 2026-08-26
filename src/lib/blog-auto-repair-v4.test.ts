import { describe, expect, it } from 'vitest';
import { repairBlogQualityV4 } from './blog-auto-repair-v4';

describe('blog auto repair V4', () => {
  it('replaces a sales-led informational preparation opening with source-neutral guidance', () => {
    const result = repairBlogQualityV4({
      blogType: 'info',
      title: '괌 가족여행 준비물 체크리스트',
      primaryKeyword: '괌 가족여행 준비물 체크리스트',
      destination: '괌',
      markdown: [
        '# 괌 가족여행 준비물 체크리스트',
        '',
        '가격과 예약 조건을 먼저 비교하면 가족여행 준비가 쉬워집니다.',
        '',
        '## 준비 기준',
        '',
        '필요한 기준을 정리합니다.',
      ].join('\n'),
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('repaired_info_intro_intent');
    expect(result.markdown).toContain('어떤 기준을 먼저 비교할까요?');
    expect(result.markdown).not.toMatch(/가격과 예약 조건을 먼저 비교/);
  });

  it('adds a source-neutral checklist when explicit checklist intent has no checklist heading', () => {
    const result = repairBlogQualityV4({
      blogType: 'info',
      title: '괌 가족여행 준비물 체크리스트',
      primaryKeyword: '괌 가족여행 준비물 체크리스트',
      markdown: '# 괌 가족여행 준비물 체크리스트\n\n준비 기준을 비교하세요.',
    });

    expect(result.changes).toContain('repaired_checklist_shape');
    expect(result.markdown).toContain('## 확인 목록');
    expect(result.markdown.match(/^[-*] /gm)).toHaveLength(3);
  });

  it('splits a collapsed numbered checklist without changing its words', () => {
    const result = repairBlogQualityV4({
      blogType: 'info',
      title: '여행 준비 체크리스트',
      primaryKeyword: '여행 준비 체크리스트',
      markdown: [
        '# 여행 준비 체크리스트',
        '',
        '## 확인 목록',
        '',
        '- 1. 여권을 확인합니다. 2. 공식 안내를 다시 확인합니다. 3. 필요한 기준을 표시합니다.',
      ].join('\n'),
    });

    expect(result.changes).toContain('repaired_checklist_shape');
    expect(result.markdown).toContain('- 여권을 확인합니다.');
    expect(result.markdown).toContain('- 공식 안내를 다시 확인합니다.');
    expect(result.markdown).toContain('- 필요한 기준을 표시합니다.');
  });

  it('can vary a persisted informational opening without adding factual claims', () => {
    const result = repairBlogQualityV4({
      blogType: 'info',
      destination: '괌',
      title: '괌 숙소 지역 비교',
      forceOpeningVariation: true,
      markdown: [
        '# 괌 숙소 지역 비교',
        '',
        '숙소 후보를 개별 호텔 단위로 먼저 고르지 말고, 일정의 중심이 되는 지역부터 정하세요.',
        '',
        '## 비교 기준',
        '',
        '일정에 맞는 기준을 확인합니다.',
      ].join('\n'),
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toContain('repaired_opening_variation');
    expect(result.markdown).toContain('확인된 근거');
    expect(result.markdown).not.toContain('개별 호텔 단위로 먼저 고르지');
  });
});
