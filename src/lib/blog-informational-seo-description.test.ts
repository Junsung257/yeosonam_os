import { describe, expect, it } from 'vitest';
import { BLOG_INFORMATION_INTENTS } from './blog-information-contract';
import { buildBlogInformationalSeoDescription } from './blog-informational-seo-description';

describe('buildBlogInformationalSeoDescription', () => {
  it.each(BLOG_INFORMATION_INTENTS)('builds a focused %s description inside the SEO length contract', (intent) => {
    const title = `세부 6월 ${intent} 여행 가이드`;
    const description = buildBlogInformationalSeoDescription({ title, intent });

    expect(description).toContain(title);
    expect(description.length).toBeGreaterThanOrEqual(70);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it('keeps weather metadata focused on climate and clothing decisions', () => {
    const description = buildBlogInformationalSeoDescription({
      title: '세부 6월 날씨 옷차림 여행 준비물 체크리스트',
      intent: 'monthly_weather',
    });

    expect(description).toContain('평균 기온과 강수 자료');
    expect(description).toContain('월별 옷차림');
    expect(description).toContain('공식 예보');
    expect(description).not.toContain('비용, 일정');
    expect(description).not.toContain('예약 전 확인할 현지 체크 포인트');
  });

  it('removes repeated terminal punctuation from the title', () => {
    const description = buildBlogInformationalSeoDescription({
      title: '괌 입국 요건 확인!!!',
      intent: 'entry_requirements',
    });

    expect(description).toMatch(/^괌 입국 요건 확인\. 대한민국 여행자의/);
  });
});
