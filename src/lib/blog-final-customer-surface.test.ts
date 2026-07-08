import { describe, expect, it } from 'vitest';
import { repairBlogFinalCustomerSurface } from './blog-final-customer-surface';

describe('repairBlogFinalCustomerSurface', () => {
  it('normalizes destination placeholders and generated residue', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '몽골',
      primaryKeyword: '몽골 7월 날씨',
      markdown: [
        '# 몽골 7월 날씨',
        '',
        '몽골 날씨, 출발 7일 전 무엇을 다시 봐야 할까요? 낮과 밤 기온을 비교하면 짐 실수를 줄일 수 있습니다.',
        '',
        '여소남에서는 현재 3개의 현지 관련 상품을 비교할 수 있습니다.',
        '',
        '### 여행 정보를 볼 때 가장 먼저 확인할 항목은 무엇인가요?',
        '현지 날씨와 현지 이동 조건을 같이 확인하세요.',
        '',
        '#몽골 #여행정보 #몽골 #여행정보 #날씨 #몽골',
      ].join('\n'),
    });

    expect(result.changed).toBe(true);
    expect(result.markdown).not.toContain('현지 관련 상품');
    expect(result.markdown).not.toContain('여행 정보를 볼 때');
    expect(result.markdown).toContain('몽골 정보를 볼 때');
    expect(result.markdown).toContain('몽골 날씨');
    expect(result.markdown.match(/#몽골/g)?.length).toBe(1);
  });

  it('repairs broken markdown URL residue without exposing utm fragments', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '세부',
      markdown: [
        '# 세부 여행',
        '',
        '세부, 먼저 무엇을 확인해야 할까요? 이동 시간과 비용을 같이 보면 가족 일정 선택이 쉬워집니다.',
        '',
        '[내 일정 기준으로 확인](/group-inquiry?utm_source=blog',
        'utm_medium=article)',
      ].join('\n'),
    });

    expect(result.markdown).toContain('[내 일정 기준으로 확인](/group-inquiry?utm_source=blogutm_medium=article)');
    expect(result.markdown).not.toMatch(/^\s*utm_medium=/m);
  });

  it('keeps one answer-first lead before the first section', () => {
    const result = repairBlogFinalCustomerSurface({
      destination: '클락',
      primaryKeyword: '클락 날씨',
      markdown: [
        '# 클락 여행 가이드',
        '',
        '클락 날씨, 출발 7일 전 무엇을 다시 봐야 할까요? 낮과 밤 기온, 비 예보, 필요한 옷차림을 먼저 비교하면 현지에서 짐과 동선 실수를 줄일 수 있습니다.',
        '',
        '같은 가격처럼 보여도 차량 이동 1-2시간과 클락 결제 조건에 따라 체감 만족도가 달라질 수 있습니다.',
        '',
        '## 핵심 요약',
        '',
        '- 우기에는 우산을 챙깁니다.',
      ].join('\n'),
    });

    const beforeFirstSection = result.markdown.split('\n## 핵심 요약')[0];
    expect(beforeFirstSection.match(/클락 날씨/g)?.length).toBe(1);
    expect(beforeFirstSection).not.toContain('같은 가격처럼 보여도');
  });

  it('splits only long paragraph walls and preserves short answer leads', () => {
    const longParagraph = Array.from({ length: 45 }, (_, index) => `문장 ${index + 1}입니다`).join(' ');
    const lead = '발리, 먼저 무엇을 확인해야 할까요? 일정과 비용, 이동 조건을 함께 비교하면 출발 전 바뀔 수 있는 조건을 줄이고 가족 여행 준비도 훨씬 쉬워집니다.';
    const result = repairBlogFinalCustomerSurface({
      destination: '발리',
      markdown: [
        '# 발리 여행',
        '',
        lead,
        '',
        longParagraph,
      ].join('\n'),
    });

    expect(result.markdown).toContain(lead);
    expect(result.markdown).toContain('문장 1입니다\n\n문장 2입니다');
  });
});
